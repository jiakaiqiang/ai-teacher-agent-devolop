import { BudgetError, budgetReasons, defaultBudget, exhausted, isBudgetReason, parseBudget,
  stepDeadlineMs } from './run-budget.js';
import { runLoop, type StepOutcome, type StepRequest } from './run-loop.js';

const spend = (overrides: Partial<{ steps: number; elapsedMs: number; tokens: number }> = {}) =>
  ({ steps: 0, elapsedMs: 0, tokens: 0, ...overrides });

describe('三种预算', () => {
  it('默认值与上限都有边界，非法输入直接拒绝', () => {
    expect(parseBudget()).toEqual(defaultBudget);
    expect(parseBudget({ maxSteps: 3 })).toEqual({ ...defaultBudget, maxSteps: 3 });
    for (const bad of [{ maxSteps: 0 }, { maxSteps: 9 }, { maxMs: 120_001 }, { maxTokens: 60_001 },
      { maxMs: 1.5 }, { maxTokens: Number.NaN }]) {
      expect(() => parseBudget(bad)).toThrow(BudgetError);
    }
  });

  it('任意一项用完都停，并给出对应原因', () => {
    expect(exhausted(defaultBudget, spend())).toBeNull();
    expect(exhausted(defaultBudget, spend({ steps: 7, elapsedMs: 59_999, tokens: 19_999 }))).toBeNull();
    expect(exhausted(defaultBudget, spend({ steps: 8 }))).toBe('step_limit');
    expect(exhausted(defaultBudget, spend({ elapsedMs: 60_000 }))).toBe('time_limit');
    expect(exhausted(defaultBudget, spend({ tokens: 20_000 }))).toBe('token_limit');
    // 同时用完时报最紧的一项：时间 > token > 步数
    expect(exhausted(defaultBudget, spend({ steps: 8, elapsedMs: 60_000, tokens: 20_000 }))).toBe('time_limit');
    expect(exhausted(defaultBudget, spend({ steps: 8, tokens: 20_000 }))).toBe('token_limit');
    expect(() => exhausted(defaultBudget, spend({ steps: -1 }))).toThrow('RUN_SPEND_INVALID');
  });

  it('单步时限不超过整个运行的剩余时间', () => {
    expect(stepDeadlineMs(defaultBudget, spend())).toBe(20_000);
    expect(stepDeadlineMs(defaultBudget, spend({ elapsedMs: 55_000 }))).toBe(5_000);
    expect(stepDeadlineMs(defaultBudget, spend({ elapsedMs: 30_000 }), 45_000)).toBe(30_000);
    expect(() => stepDeadlineMs(defaultBudget, spend({ elapsedMs: 60_000 }))).toThrow('RUN_TIME_EXHAUSTED');
  });

  it('预算类停止原因与故障类分开', () => {
    expect(budgetReasons).toEqual(['step_limit', 'time_limit', 'token_limit']);
    expect(isBudgetReason('tool_failed')).toBe(false);
    expect(isBudgetReason('user_cancelled')).toBe(false);
    expect(isBudgetReason('answered')).toBe(false);
  });
});

describe('推理-行动循环', () => {
  // 固定时钟：每次读时间都前进一个固定值，耗时可预测。
  function clock(stepMs: number) {
    let value = 1_000;
    return () => { const current = value; value += stepMs; return current; };
  }
  function recorder() {
    const steps: { request: StepRequest; outcome: StepOutcome }[] = [];
    return { steps, onStep: async (outcome: StepOutcome, request: StepRequest) => { steps.push({ request, outcome }); } };
  }

  it('给出答案就停，步数与 token 据实累计', async () => {
    const log = recorder();
    const result = await runLoop({
      budget: parseBudget(), now: clock(0), onStep: log.onStep,
      think: async request => request.ordinal < 3
        ? { phase: 'tool', summary: `查第 ${request.ordinal} 项`, tokens: 100 }
        : { phase: 'answer', summary: '给出结论', tokens: 150, answer: '重新绑定动态口令' },
    });
    expect(result).toMatchObject({ reason: 'answered', answer: '重新绑定动态口令' });
    expect(result.spend).toMatchObject({ steps: 3, tokens: 350 });
    expect(log.steps.map(item => item.request.ordinal)).toEqual([1, 2, 3]);
  });

  it('步数用完时停在上限，不会多走一步', async () => {
    const log = recorder();
    const result = await runLoop({
      budget: parseBudget({ maxSteps: 2 }), now: clock(0), onStep: log.onStep,
      think: async () => ({ phase: 'tool', summary: '继续查', tokens: 10 }),
    });
    expect(result.reason).toBe('step_limit');
    expect(result.spend.steps).toBe(2);
    expect(log.steps).toHaveLength(2);
  });

  it('时间与 token 用完时各报各的原因', async () => {
    const slow = await runLoop({
      budget: parseBudget({ maxMs: 2_000 }), now: clock(900), onStep: async () => {},
      think: async () => ({ phase: 'tool', summary: '慢工具', tokens: 1 }),
    });
    expect(slow.reason).toBe('time_limit');
    expect(slow.spend.steps).toBeLessThan(8);
    const greedy = await runLoop({
      budget: parseBudget({ maxTokens: 250 }), now: clock(0), onStep: async () => {},
      think: async () => ({ phase: 'plan', summary: '长提示词', tokens: 200 }),
    });
    expect(greedy.reason).toBe('token_limit');
    expect(greedy.spend.tokens).toBe(400);
  });

  it('单步时限随剩余时间收紧', async () => {
    const log = recorder();
    // 时间只在每一步执行时前进 8 秒，便于逐步核对剩余时间。
    let elapsed = 0;
    await runLoop({
      budget: parseBudget({ maxMs: 30_000 }), now: () => 1_000 + elapsed, onStep: log.onStep,
      think: async () => { elapsed += 8_000; return { phase: 'tool', summary: '查设备', tokens: 1 }; },
    });
    expect(log.steps.map(item => item.request.deadlineMs)).toEqual([20_000, 20_000, 14_000, 6_000]);
    expect(log.steps).toHaveLength(4);
  });

  it('单步异常与工具失败分别对应不同原因，并且都记一步', async () => {
    const log = recorder();
    const thrown = await runLoop({
      budget: parseBudget(), now: clock(0), onStep: log.onStep,
      think: async () => { throw new Error('MODEL_TRUNCATED'); },
    });
    expect(thrown.reason).toBe('model_failed');
    expect(thrown.spend.steps).toBe(1);
    expect(log.steps[0]!.outcome.failure).toBe('MODEL_TRUNCATED');
    const failed = await runLoop({
      budget: parseBudget(), now: clock(0), onStep: async () => {},
      think: async () => ({ phase: 'tool', summary: '工具超时', tokens: 20, failure: 'TOOL_TIMEOUT' }),
    });
    expect(failed).toMatchObject({ reason: 'tool_failed', answer: null });
    expect(failed.spend).toMatchObject({ steps: 1, tokens: 20 });
  });
});
