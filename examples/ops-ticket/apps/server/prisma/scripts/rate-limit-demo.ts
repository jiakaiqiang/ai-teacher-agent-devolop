// 三种限流算法对比（D26）：同样“每秒 5 次”，在窗口边界前后各来 5 个请求，各放行几个
// 运行：pnpm exec tsx prisma/scripts/rate-limit-demo.ts（只连开发用的 Redis，键前缀 demo:，结束时清理）
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { keyPrefix: 'demo:' });
const LIMIT = 5;
const WINDOW_MS = 1000;
const NOW = `local t = redis.call('time') local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)`;

// 固定窗口：按“第几秒”分桶计数，每个桶独立
const FIXED = `${NOW}
local key = KEYS[1] .. ':' .. math.floor(now / tonumber(ARGV[1]))
local n = redis.call('incr', key)
if n == 1 then redis.call('pexpire', key, ARGV[1]) end
return n <= tonumber(ARGV[2]) and 1 or 0`;

// 滑动窗口：和 RateLimitService.consume 同一个算法
const SLIDING = `${NOW}
redis.call('zremrangebyscore', KEYS[1], '-inf', now - tonumber(ARGV[1]))
if redis.call('zcard', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('zadd', KEYS[1], now, ARGV[3])
  redis.call('pexpire', KEYS[1], ARGV[1])
  return 1
end
return 0`;

// 令牌桶：桶里最多 capacity 个令牌，每毫秒补 rate 个；请求拿走一个令牌，没有令牌就拒绝
const BUCKET = `${NOW}
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local b = redis.call('hmget', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or capacity
local ts = tonumber(b[2]) or now
tokens = math.min(capacity, tokens + (now - ts) * rate)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('hset', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('pexpire', KEYS[1], math.ceil(capacity / rate))
return allowed`;

const algorithms = {
  固定窗口: () => redis.eval(FIXED, 1, 'fixed', WINDOW_MS, LIMIT),
  滑动窗口: () => redis.eval(SLIDING, 1, 'sliding', WINDOW_MS, LIMIT, randomUUID()),
  令牌桶: () => redis.eval(BUCKET, 1, 'bucket', LIMIT, LIMIT / WINDOW_MS),
};

// 等到某一秒的第 ms 毫秒（用 Redis 服务器的时间，和脚本里的时间一致）
async function waitUntilMsOfSecond(ms: number) {
  const [, micro] = await redis.time();
  const current = Math.floor(Number(micro) / 1000);
  await sleep((ms - current + 1000) % 1000);
}

async function burst(run: () => Promise<unknown>) {
  let ok = 0;
  for (let i = 0; i < 5; i++) if ((await run()) === 1) ok++;
  return ok;
}

try {
  for (const [name, run] of Object.entries(algorithms)) {
    await waitUntilMsOfSecond(850);
    const first = await burst(run);
    await waitUntilMsOfSecond(50); // 下一秒的第 50ms，离上一批只隔 200ms
    const second = await burst(run);
    console.log(`${name}：第 850ms 来 5 个放行 ${first} 个，200ms 后（跨过整秒）再来 5 个放行 ${second} 个，合计 ${first + second} 个`);
    await sleep(1500);
  }

  console.log('\n令牌桶的匀速请求：每 200ms 来 1 个，共 10 个');
  await redis.del('bucket');
  let ok = 0;
  for (let i = 0; i < 10; i++) {
    if ((await algorithms.令牌桶()) === 1) ok++;
    await sleep(200);
  }
  console.log(`  放行 ${ok} 个`);
} finally {
  const keys = (await redis.keys('demo:fixed:*')).map((k) => k.slice('demo:'.length));
  await redis.del('sliding', 'bucket', ...keys);
  redis.disconnect();
}
