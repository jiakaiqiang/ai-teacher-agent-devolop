import { embeddingUsage, quoteUsage } from './cost-quote.js';
import { UsageMeter } from './usage-meter.js';

describe('演示报价与用量核对', () => {
  it('缺失用量不是零费用', () => {
    const meter = new UsageMeter();
    meter.start();
    expect(quoteUsage(meter.summary())).toMatchObject({
      status: 'unknown', amount: null, knownAmount: '0.000000',
    });
  });
  it('输入输出分价且不把额度当货币', () => {
    expect(quoteUsage({ inputTokens: 10, outputTokens: 3, exact: true, attempts: 1 }))
      .toMatchObject({ amount: '0.000038', tariffKind: 'synthetic', tariffId: 'demo-linear-v1' });
  });
  it('本机embedding计输入token而非维度', () => {
    const usage = embeddingUsage({ prompt_eval_count: 12, embeddings: [Array(1024).fill(0)] });
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 0, exact: true, attempts: 1 });
    expect(quoteUsage(usage).amount).toBe('0.000024');
  });
  it('重试已知部分不能伪装完整账单', () => {
    const meter = new UsageMeter();
    meter.start(); // 第一次失败且没有usage。
    meter.start();
    meter.record({ usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } });
    expect(quoteUsage(meter.summary())).toMatchObject({
      attempts: 2, amount: null, knownAmount: '0.000038',
    });
  });
  it('整数微元累计不提前截断小额', () => {
    expect(quoteUsage({ inputTokens: 1, outputTokens: 1, exact: true, attempts: 1 }).amount).toBe('0.000008');
    expect(quoteUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, exact: true, attempts: 2 }).amount).toBe('8.000000');
  });
  it('非法计数与不可能的零尝试被拒绝', () => {
    for (const count of [NaN, -1, 0.5, 1_000_001]) {
      expect(embeddingUsage({ prompt_eval_count: count }).exact).toBe(false);
    }
    expect(embeddingUsage({}).exact).toBe(false);
    expect(() => quoteUsage({ inputTokens: 1, outputTokens: 0, exact: true, attempts: 0 })).toThrow('USAGE_INVALID');
  });
});
