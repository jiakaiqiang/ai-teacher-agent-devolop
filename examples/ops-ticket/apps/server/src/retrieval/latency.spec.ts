import { LatencyTrace, p95, summarizeLatency } from './latency.js';

describe('流式请求延迟口径', () => {
  it('元数据与空文本不抢占首字', () => {
    let now = 100;
    const trace = new LatencyTrace(() => now);
    now = 110; trace.observe('meta');
    now = 120; trace.observe('text', '');
    now = 150; trace.observe('text', '中😀');
    now = 160; trace.observe('text', '文');
    now = 200;
    expect(trace.finish('completed')).toEqual({
      outcome: 'completed', firstTextMs: 50, totalMs: 100, codePoints: 3,
    });
  });
  it('主动停止与故障分开计数', () => {
    const samples = (['completed', 'cancelled', 'failed'] as const)
      .map(outcome => new LatencyTrace(() => 0).finish(outcome));
    expect(summarizeLatency(samples)).toMatchObject({
      settled: 3, completed: 1, cancelled: 1, failed: 1, failureRate: 0.5,
      completedWithText: 0, completedFirstTextP95Ms: null,
    });
  });
  it('无样本的分位数不是零', () => {
    expect(p95([])).toBeNull();
    expect(summarizeLatency([]).failureRate).toBeNull();
    expect(summarizeLatency([new LatencyTrace(() => 0).finish('cancelled')]))
      .toMatchObject({ failureRate: null, completedTotalP95Ms: null });
  });
  it('终态只能结算一次且迟到文本无效', () => {
    let now = 0;
    const trace = new LatencyTrace(() => now);
    now = 20;
    const first = trace.finish('cancelled');
    now = 40; trace.observe('text', '迟到');
    expect(trace.finish('completed')).toBe(first);
    expect(first.codePoints).toBe(0);
    expect(Object.isFrozen(first)).toBe(true);
  });
  it('时钟回退与非法输入不会成为负延迟', () => {
    let now = 10;
    const trace = new LatencyTrace(() => now);
    now = 9;
    expect(() => trace.finish('completed')).toThrow('BAD_CLOCK');
    expect(() => new LatencyTrace(() => NaN)).toThrow('BAD_CLOCK');
    expect(() => p95([NaN])).toThrow('BAD_DURATION');
  });
  it('nearest rank不修改输入并只聚合成功耗时', () => {
    const values = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(p95(values)).toBe(19);
    expect(values[0]).toBe(20);
    const sample = { firstTextMs: 2, totalMs: 10, codePoints: 2 };
    expect(summarizeLatency([
      { ...sample, outcome: 'completed' },
      { ...sample, totalMs: 1000, outcome: 'failed' },
    ]).completedTotalP95Ms).toBe(10);
  });
});
