import { Logger } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import type { RedisService } from './redis.service.js';

// 用一个假的 Redis：只实现 get、set、del，可以控制它返回什么、是否报错
function fakeRedis(store = new Map<string, string>(), broken = false) {
  return {
    store,
    get: vi.fn(async (key: string) => {
      if (broken) throw new Error('Connection is closed.');
      return store.get(key) ?? null;
    }),
    // 支持 SET key value PX 5000 NX：键已经存在时不写、返回 null（D24 重建锁）
    set: vi.fn(async (key: string, value: string, ...args: (string | number)[]) => {
      if (broken) throw new Error('Connection is closed.');
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      if (broken) throw new Error('Connection is closed.');
      return keys.filter((key) => store.delete(key)).length;
    }),
  };
}

describe('CacheService.getOrLoad（D22）', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('第一次未命中：调用 loader 并写回缓存；第二次命中：不再调用 loader', async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as RedisService);
    const loader = vi.fn().mockResolvedValue({ code: 'srv-001', name: '订单服务器' });

    expect(await cache.getOrLoad('device:srv-001', 300, loader)).toEqual({ code: 'srv-001', name: '订单服务器' });
    expect(await cache.getOrLoad('device:srv-001', 300, loader)).toEqual({ code: 'srv-001', name: '订单服务器' });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('device:srv-001', '{"code":"srv-001","name":"订单服务器"}', 'EX', 300);
    expect(cache.stats).toEqual({ hits: 1, misses: 1, errors: 0 });
  });

  it('Redis 不可用：每次都直接走数据库，请求照样成功', async () => {
    const cache = new CacheService(fakeRedis(new Map(), true) as unknown as RedisService);
    const loader = vi.fn().mockResolvedValue({ code: 'srv-001' });

    expect(await cache.getOrLoad('device:srv-001', 300, loader)).toEqual({ code: 'srv-001' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.stats.errors).toBe(2); // 读失败一次、写失败一次
  });

  it('缓存里的内容不是合法 JSON：当作未命中，用数据库的结果覆盖', async () => {
    const redis = fakeRedis(new Map([['device:srv-001', '{坏掉的']]));
    const cache = new CacheService(redis as unknown as RedisService);
    const loader = vi.fn().mockResolvedValue({ code: 'srv-001' });

    expect(await cache.getOrLoad('device:srv-001', 300, loader)).toEqual({ code: 'srv-001' });
    expect(redis.store.get('device:srv-001')).toBe('{"code":"srv-001"}');
  });

  it('数据库里也没有（null）：不写缓存', async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as RedisService);
    expect(await cache.getOrLoad('device:nope', 300, async () => null)).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('CacheService.invalidate（D23）', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('删掉以后下一次读重新调用 loader，拿到数据库里的新值', async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as RedisService);
    await cache.getOrLoad('device:srv-001', 300, async () => ({ name: '旧名字' }));

    await cache.invalidate('device:srv-001');
    expect(await cache.getOrLoad('device:srv-001', 300, async () => ({ name: '新名字' }))).toEqual({ name: '新名字' });
  });

  it('Redis 不可用：删缓存失败不抛错，只记一次错误', async () => {
    const cache = new CacheService(fakeRedis(new Map(), true) as unknown as RedisService);
    await expect(cache.invalidate('device:srv-001')).resolves.toBeUndefined();
    expect(cache.stats.errors).toBe(1);
  });
});

describe('CacheService 的三种防护（D24）', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('防穿透：数据库里没有，也缓存一个空值；第二次命中空值，不再调用 loader', async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as RedisService);
    const loader = vi.fn().mockResolvedValue(null);

    expect(await cache.getOrLoad('device:nope', 300, loader, { nullTtlSeconds: 30 })).toBeNull();
    expect(await cache.getOrLoad('device:nope', 300, loader, { nullTtlSeconds: 30 })).toBeNull();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('device:nope', 'null', 'EX', 30);
    expect(cache.stats).toEqual({ hits: 1, misses: 1, errors: 0 });
  });

  it('防雪崩：过期时间在 60 到 70 秒之间，并且不是都一样', async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as RedisService);
    for (let i = 0; i < 200; i++) {
      await cache.getOrLoad(`k${i}`, 60, async () => i, { jitterSeconds: 10 });
    }
    const ttls = redis.set.mock.calls.map((call) => call[3] as number);
    expect(Math.min(...ttls)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...ttls)).toBeLessThanOrEqual(70);
    expect(new Set(ttls).size).toBeGreaterThan(1);
  });

  it('防击穿：20 个请求同时未命中，只有一个调用 loader，其余等它写好缓存', async () => {
    const cache = new CacheService(fakeRedis() as unknown as RedisService);
    const loader = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50)); // 模拟一个慢查询
      return { total: 42 };
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => cache.getOrLoad('ticket-stats:all', 60, loader, { rebuildLock: true })),
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.total === 42)).toBe(true);
  });

  it('等不到别人写好缓存（锁被占着、缓存一直是空的）：等 1 秒后自己查', async () => {
    const redis = fakeRedis(new Map([['lock:ticket-stats:all', '1']]));
    const cache = new CacheService(redis as unknown as RedisService);
    const loader = vi.fn().mockResolvedValue({ total: 1 });

    const start = Date.now();
    expect(await cache.getOrLoad('ticket-stats:all', 60, loader, { rebuildLock: true })).toEqual({ total: 1 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('Redis 不可用时加不了锁：直接查数据库，请求照样成功', async () => {
    const cache = new CacheService(fakeRedis(new Map(), true) as unknown as RedisService);
    const loader = vi.fn().mockResolvedValue({ total: 1 });
    expect(await cache.getOrLoad('ticket-stats:all', 60, loader, { rebuildLock: true })).toEqual({ total: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
