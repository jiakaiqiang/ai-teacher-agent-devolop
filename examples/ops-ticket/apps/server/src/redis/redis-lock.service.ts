import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service.js';

// 一次加锁的凭证：token 是这次加锁时生成的唯一值，只有加锁的人知道
export interface Lock {
  key: string;
  token: string;
}

// 值还是自己的 token 才删除 / 续期。判断和操作写在同一个 Lua 脚本里，Redis 执行脚本期间不会插入别的命令
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;
const EXTEND_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

// 单个 Redis 上的分布式锁（D25）：多个应用实例之间互斥
// 锁只用来“避免重复干活”，不能作为正确性的唯一保证：锁可能在持有者不知情时过期，正确性要靠数据库的条件更新
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(private readonly redis: RedisService) {}

  // 拿到锁返回凭证，锁被别人占着返回 null；Redis 不可用时抛错，由调用方决定怎么办
  async acquire(name: string, ttlMs: number): Promise<Lock | null> {
    const lock = { key: `lock:${name}`, token: randomUUID() };
    const ok = await this.redis.set(lock.key, lock.token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? lock : null;
  }

  // 只释放自己的锁：锁已经过期、被别人重新拿到时返回 false，不会删掉别人的锁
  async release(lock: Lock): Promise<boolean> {
    return (await this.redis.eval(RELEASE_SCRIPT, 1, lock.key, lock.token)) === 1;
  }

  // 续期：锁还是自己的，就把过期时间重新设成 ttlMs
  async extend(lock: Lock, ttlMs: number): Promise<boolean> {
    return (await this.redis.eval(EXTEND_SCRIPT, 1, lock.key, lock.token, ttlMs)) === 1;
  }

  // 拿到锁才执行 fn，执行期间每过 ttl 的三分之一续期一次，fn 执行多久锁就保持多久
  // 进程崩溃时不再续期，锁最多 ttlMs 后自动释放
  async runExclusive<T>(
    name: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const lock = await this.acquire(name, ttlMs);
    if (!lock) {
      return { ran: false };
    }
    const timer = setInterval(() => {
      this.extend(lock, ttlMs)
        .then((ok) => {
          if (!ok) this.logger.warn(`锁 ${name} 已经不是自己的了，续期失败`);
        })
        .catch((error: Error) => this.logger.warn(`锁 ${name} 续期出错：${error.message}`));
    }, Math.floor(ttlMs / 3));
    try {
      return { ran: true, result: await fn() };
    } finally {
      clearInterval(timer);
      await this.release(lock).catch(() => false);
    }
  }
}
