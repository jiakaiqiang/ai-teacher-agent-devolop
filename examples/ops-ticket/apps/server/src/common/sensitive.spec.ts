import { maskPhone, maskSensitive, redactForLog } from './sensitive.js';

describe('敏感字段脱敏', () => {
  it('手机号保留前 3 位和后 4 位', () => {
    expect(maskPhone('13800000001')).toBe('138****0001');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('12345')).toBe('*****');
  });

  it('不管嵌套在第几层、在数组里还是对象里，叫 phone 的字段都被脱敏；其他字段和日期原样保留', () => {
    const createdAt = new Date('2026-11-15T00:00:00.000Z');
    const input = {
      ticketNo: 'T1',
      createdAt,
      reporter: { username: 'alice', phone: '13800000001' },
      assignee: null,
      events: [{ actor: { displayName: '李四', phone: '13800000002' } }],
    };
    const output = maskSensitive(input);
    expect(output).toEqual({
      ticketNo: 'T1',
      createdAt,
      reporter: { username: 'alice', phone: '138****0001' },
      assignee: null,
      events: [{ actor: { displayName: '李四', phone: '138****0002' } }],
    });
    // 不修改原来的对象
    expect(input.reporter.phone).toBe('13800000001');
  });

  it('日志里的手机号、令牌、密码哈希被擦掉', () => {
    const text =
      'Invalid `prisma.user.update()` invocation: { phone: "13800000001" } Authorization: Bearer aaa.bbb.ccc hash scrypt$32768$8$1$c2FsdA==$aGFzaA==';
    expect(redactForLog(text)).toBe(
      'Invalid `prisma.user.update()` invocation: { phone: "138****0001" } Authorization: Bearer [已隐藏] hash scrypt$[已隐藏]',
    );
  });
});
