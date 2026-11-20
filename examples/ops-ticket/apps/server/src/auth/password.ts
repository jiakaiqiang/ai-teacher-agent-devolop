import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 密码哈希：用 Node 自带的 scrypt，不引入需要编译的原生依赖
// 存储格式：scrypt$N$r$p$盐(base64)$哈希(base64)。参数存在哈希里，以后调高强度时旧密码仍能校验
const N = 2 ** 15; // CPU 和内存成本，越大越慢、越难暴力破解
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
// scrypt 需要约 128 * N * r 字节内存（这里是 32MB），Node 默认上限也是 32MB，放宽一点
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  // 每个密码一个随机盐：同样的密码两次哈希结果不同，彩虹表没用
  const salt = randomBytes(16);
  const hash = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  // 用恒定时间比较：普通的 === 在第一个不同的字节就返回，耗时会泄露“前几个字节对了”
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
