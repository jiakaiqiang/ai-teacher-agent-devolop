import { hashPassword, verifyPassword } from './password.js';

describe('密码哈希', () => {
  it('正确的密码校验通过，错误的不通过', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
  });

  it('同一个密码两次哈希结果不同（随机盐），存储里没有明文', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(a).not.toContain('same-password');
  });

  it('格式不对的存储值直接返回 false，不抛错', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$abc')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$32768$8$1$c2FsdA==')).toBe(false);
  });
});
