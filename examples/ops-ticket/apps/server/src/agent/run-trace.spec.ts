import { prepareField, TRACE_FIELD_LIMIT } from './run-trace.service.js';

describe('Trace 字段处理', () => {
  it('先脱敏再截断：手机号、令牌、口令哈希都不会留半截', () => {
    const text = '联系人 13800000001，Bearer aaa.bbb.ccc，口令 scrypt$16384$8$1$abcdef';
    const { text: masked, truncated } = prepareField(text);
    expect(truncated).toBe(false);
    expect(masked).toContain('138****0001');
    expect(masked).toContain('Bearer [已隐藏]');
    expect(masked).toContain('scrypt$[已隐藏]');
    expect(masked).not.toContain('13800000001');
    expect(masked).not.toContain('aaa.bbb.ccc');
    // 截断发生在脱敏之后：先截断会把手机号切成明文片段
    const long = '联系人 13800000001；'.repeat(200);
    const result = prepareField(long, 40);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('138****0001');
    expect(result.text).not.toMatch(/\d{11}/);
  });

  it('超长按码点截断并标注省略数量', () => {
    const emoji = '😀'.repeat(TRACE_FIELD_LIMIT + 5);
    const { text, truncated } = prepareField(emoji);
    expect(truncated).toBe(true);
    // 总长度不超过列宽：省略提示也算在 limit 里面
    expect(Array.from(text)).toHaveLength(TRACE_FIELD_LIMIT);
    expect(text.endsWith('…（省略 5 个字符）')).toBe(true);
    // 不切断代理对：保留下来的每个码点都仍是完整的表情
    const kept = text.slice(0, text.indexOf('…'));
    expect(Array.from(kept).every(point => point === '😀')).toBe(true);
    const exact = prepareField('一'.repeat(TRACE_FIELD_LIMIT));
    expect(exact.truncated).toBe(false);
  });
});
