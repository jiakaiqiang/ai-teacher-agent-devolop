import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { RedisService } from './redis.service.js';

// 三种缓存问题的防护（D24），按需打开
export interface CacheOptions {
  // 雪崩：过期时间再加 0 到 jitterSeconds 秒的随机数，同一批写进去的键不会在同一秒过期
  jitterSeconds?: number;
  // 穿透：数据库里也没有时，缓存一个空值这么多秒；不传就不缓存空值
  nullTtlSeconds?: number;
  // 击穿：未命中时只让一个请求查数据库，其余请求等它把缓存写好
  rebuildLock?: boolean;
}

// 重建锁最多占用 5 秒：查数据库的请求挂了，锁也会自己过期
const LOCK_TTL_MS = 5000;
// 没拿到锁的请求最多等 1 秒，每 20 毫秒看一次缓存；等不到就自己查，宁可多查一次也不让请求一直等
const LOCK_WAIT_MS = 1000;
const LOCK_POLL_MS = 20;

type CacheRead<T> = { hit: true; value: T } | { hit: false };

// 旁路缓存（Cache-Aside）的读路径（D22）：先读缓存，没有再读数据库，并把结果写回缓存
// 缓存只是加速，任何缓存错误都不能让请求失败：出错就当没命中，直接走数据库
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  // 命中、未命中（也就是查了数据库）的次数，D27 用来算命中率
  readonly stats = { hits: 0, misses: 0, errors: 0 };

  constructor(private readonly redis: RedisService) {}

  // 写路径（D23）：数据库提交成功之后调用，删掉相关的缓存，下一次读会从数据库重新加载
  // 删失败只记日志：数据库已经改好了，不能因为缓存让写请求失败；最坏等到过期时间自动恢复
  async invalidate(...keys: string[]): Promise<void> {
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.stats.errors++;
      this.logger.warn(`删缓存失败，等过期后恢复：${keys.join(', ')}，${(error as Error).message}`);
    }
  }

  async getOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, options: CacheOptions = {}): Promise<T> {
    const cached = await this.read<T>(key);
    if (cached.hit) {
      return cached.value;
    }
    return options.rebuildLock
      ? this.loadWithLock(key, ttlSeconds, loader, options)
      : this.loadAndFill(key, ttlSeconds, loader, options);
  }

  // 缓存里的空值存成字符串 'null'，读出来是 null，也算命中
  private async read<T>(key: string): Promise<CacheRead<T>> {
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        const value = JSON.parse(raw) as T;
        this.stats.hits++;
        return { hit: true, value };
      }
    } catch (error) {
      // Redis 不可用、超时、缓存里的内容不是合法的 JSON：都按未命中处理
      this.stats.errors++;
      this.logger.warn(`读缓存失败，回退到数据库：${key}，${(error as Error).message}`);
    }
    return { hit: false };
  }

  private async loadAndFill<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, options: CacheOptions): Promise<T> {
    this.stats.misses++;
    const value = await loader();
    const empty = value === null || value === undefined;
    const jitter = Math.floor(Math.random() * ((options.jitterSeconds ?? 0) + 1));
    const seconds = empty ? options.nullTtlSeconds : ttlSeconds + jitter;
    if (seconds) {
      try {
        await this.redis.set(key, JSON.stringify(empty ? null : value), 'EX', seconds);
      } catch (error) {
        this.stats.errors++;
        this.logger.warn(`写缓存失败：${key}，${(error as Error).message}`);
      }
    }
    return value;
  }

  private async loadWithLock<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, options: CacheOptions): Promise<T> {
    const lockKey = `lock:${key}`;
    let locked: boolean;
    try {
      locked = (await this.redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
    } catch (error) {
      // Redis 不可用：没法加锁，直接查数据库
      this.stats.errors++;
      this.logger.warn(`加重建锁失败，直接查数据库：${key}，${(error as Error).message}`);
      return this.loadAndFill(key, ttlSeconds, loader, options);
    }

    if (locked) {
      try {
        return await this.loadAndFill(key, ttlSeconds, loader, options);
      } finally {
        // 这里直接删锁：最坏情况是多一个请求去查数据库。D25 讲这样释放锁为什么可能删掉别人的锁
        await this.redis.del(lockKey).catch(() => 0);
      }
    }

    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(LOCK_POLL_MS);
      const cached = await this.read<T>(key);
      if (cached.hit) {
        return cached.value;
      }
    }
    return this.loadAndFill(key, ttlSeconds, loader, options);
  }
}
