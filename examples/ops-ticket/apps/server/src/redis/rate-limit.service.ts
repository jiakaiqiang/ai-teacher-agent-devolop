import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service.js';

export interface RateLimitResult {
  allowed: boolean;
  // 被拒绝时，多少秒后可以再试（向上取整，至少 1）
  retryAfterSeconds: number;
}

// 计数加一；第一次计数时设置过期时间。两步放在一个脚本里：INCR 之后进程崩了，也不会留下永不过期的计数
const COUNT_SCRIPT = `
local n = redis.call('incr', KEYS[1])
if n == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
return n`;

// 滑动窗口：有序集合里每个成员是一次请求，分数是请求时间（毫秒）
// 先删掉窗口之外的旧请求，再数窗口里还有几个；时间用 Redis 服务器的，多个实例的时钟不一致也没关系
const SLIDING_WINDOW_SCRIPT = `
local t = redis.call('time')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('zremrangebyscore', KEYS[1], '-inf', now - window)
if redis.call('zcard', KEYS[1]) < limit then
  redis.call('zadd', KEYS[1], now, ARGV[3])
  redis.call('pexpire', KEYS[1], window)
  return 0
end
local oldest = redis.call('zrange', KEYS[1], 0, 0, 'WITHSCORES')
return tonumber(oldest[2]) + window - now`;

// 限流（D26）。Redis 出错时一律放行：限流是保护措施，Redis 挂了不能让登录、评论都不可用
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  // 滑动窗口：任意 windowMs 毫秒内最多 limit 次，这一次算在里面
  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    try {
      const waitMs = Number(await this.redis.eval(SLIDING_WINDOW_SCRIPT, 1, key, windowMs, limit, randomUUID()));
      return waitMs > 0
        ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
        : { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.logger.warn(`限流检查失败，放行：${key}，${(error as Error).message}`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  // 固定窗口计数（登录失败次数）：从第一次计数开始算 windowMs，到期后整体清零
  async count(key: string, windowMs: number): Promise<void> {
    try {
      await this.redis.eval(COUNT_SCRIPT, 1, key, windowMs);
    } catch (error) {
      this.logger.warn(`计数失败：${key}，${(error as Error).message}`);
    }
  }

  // 当前计数是否已经达到 limit；达到时返回还要等多少秒
  async check(key: string, limit: number): Promise<RateLimitResult> {
    try {
      const [count, ttlMs] = await Promise.all([this.redis.get(key), this.redis.pttl(key)]);
      return Number(count ?? 0) >= limit && ttlMs > 0
        ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) }
        : { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.logger.warn(`限流检查失败，放行：${key}，${(error as Error).message}`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`清除计数失败：${key}，${(error as Error).message}`);
    }
  }
}
