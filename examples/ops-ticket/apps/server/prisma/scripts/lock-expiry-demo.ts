// 分布式锁演示（D25）：锁在持有者不知情时过期，会发生什么；唯一值、续期、fencing token 各解决什么
// 运行：pnpm exec tsx prisma/scripts/lock-expiry-demo.ts（只连开发用的 Redis，键前缀 demo:，结束时清理）
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { keyPrefix: 'demo:' });
const KEY = 'lock:job';
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;
const EXTEND = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`;

const acquire = async (who: string, ttlMs: number) => {
  const token = randomUUID();
  const ok = (await redis.set(KEY, token, 'PX', ttlMs, 'NX')) === 'OK';
  console.log(`  ${who}：加锁 → ${ok ? '成功' : '失败（被占着）'}`);
  return ok ? token : null;
};

async function scenario1() {
  console.log('\n== 1 直接 DEL 释放：A 的锁过期后，A 删掉了 B 的锁');
  await redis.del(KEY);
  await acquire('A', 200);
  console.log('  A：开始干活，卡住了 300ms（比如一次很慢的数据库查询）');
  await sleep(300);
  console.log(`  （锁已经过期：${(await redis.exists(KEY)) ? '还在' : '不在了'}）`);
  await acquire('B', 5000);
  await redis.del(KEY);
  console.log('  A：干完了，DEL 释放锁');
  await acquire('C', 5000);
  console.log('  结果：B 和 C 都以为自己持有锁，在同时干活');
}

async function scenario2() {
  console.log('\n== 2 唯一值 + Lua 释放：同样的顺序');
  await redis.del(KEY);
  const a = await acquire('A', 200);
  await sleep(300);
  await acquire('B', 5000);
  const released = await redis.eval(RELEASE, 1, KEY, a!);
  console.log(`  A：用自己的 token 释放 → ${released === 1 ? '删掉了' : '没删（锁已经不是自己的）'}`);
  await acquire('C', 5000);
  console.log('  结果：B 的锁还在，C 拿不到。但 A 和 B 在 A 卡住的那段时间里仍然同时干过活');
}

async function scenario3() {
  console.log('\n== 3 续期：锁 200ms，每 70ms 续一次，A 干活 600ms');
  await redis.del(KEY);
  const a = await acquire('A', 200);
  const timer = setInterval(() => void redis.eval(EXTEND, 1, KEY, a!, 200), 70);
  let attempts = 0;
  let stolen = 0;
  const deadline = Date.now() + 600;
  while (Date.now() < deadline) {
    await sleep(100);
    attempts++;
    if ((await redis.set(KEY, 'B', 'PX', 5000, 'NX')) === 'OK') stolen++;
  }
  clearInterval(timer);
  await redis.eval(RELEASE, 1, KEY, a!);
  console.log(`  B 在这 600ms 里尝试加锁 ${attempts} 次，成功 ${stolen} 次`);
  console.log('  结果：只要 A 的进程还活着、还能连上 Redis，锁就不会过期；A 的进程整个卡住（比如长时间的垃圾回收）时，续期也会停');
}

async function scenario4() {
  console.log('\n== 4 fencing token：每次加锁拿一个递增的号码，存储只接受比上次大的号码');
  await redis.del(KEY, 'fence:job');
  // 模拟数据库里的一行：真实系统里是 UPDATE ... SET ..., last_fence = $1 WHERE last_fence < $1
  const storage = { value: '初始值', lastFence: 0 };
  const write = (who: string, fence: number, value: string) => {
    if (fence <= storage.lastFence) {
      console.log(`  ${who}：带着号码 ${fence} 写入 → 拒绝（已经有人用 ${storage.lastFence} 写过）`);
      return;
    }
    storage.value = value;
    storage.lastFence = fence;
    console.log(`  ${who}：带着号码 ${fence} 写入 → 成功，值 = ${value}`);
  };

  await acquire('A', 200);
  const fenceA = await redis.incr('fence:job');
  console.log(`  A：拿到号码 ${fenceA}，然后卡住了 300ms`);
  await sleep(300);
  await acquire('B', 5000);
  const fenceB = await redis.incr('fence:job');
  console.log(`  B：拿到号码 ${fenceB}`);
  write('B', fenceB, 'B 写的');
  write('A', fenceA, 'A 写的（过期的锁）');
  console.log(`  结果：存储里是“${storage.value}”。锁失效了，但旧的持有者写不进去`);
}

try {
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
} finally {
  await redis.del(KEY, 'fence:job');
  redis.disconnect();
}
