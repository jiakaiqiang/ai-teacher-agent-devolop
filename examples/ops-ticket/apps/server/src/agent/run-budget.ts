import { stopReasons, type StopReason } from './run-state.js';

// 三种预算：步数、挂钟时间、token。任意一项用完就停，并给出对应的停止原因。
export interface RunBudget { maxSteps: number; maxMs: number; maxTokens: number; }
export interface RunSpend { steps: number; elapsedMs: number; tokens: number; }

export const defaultBudget: RunBudget = { maxSteps: 8, maxMs: 60_000, maxTokens: 20_000 };
const limits: RunBudget = { maxSteps: 8, maxMs: 120_000, maxTokens: 60_000 };

export class BudgetError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function parseBudget(input: Partial<RunBudget> = {}): RunBudget {
  const budget = { ...defaultBudget, ...input };
  const bounded = (value: number, max: number) =>
    Number.isSafeInteger(value) && value >= 1 && value <= max;
  if (!bounded(budget.maxSteps, limits.maxSteps) || !bounded(budget.maxMs, limits.maxMs)
    || !bounded(budget.maxTokens, limits.maxTokens)) throw new BudgetError('RUN_BUDGET_INVALID');
  return budget;
}

// 开下一步之前问一次：还有余量吗？没有就返回该报的停止原因。
export function exhausted(budget: RunBudget, spend: RunSpend): StopReason | null {
  if (!Number.isSafeInteger(spend.steps) || spend.steps < 0 || !Number.isFinite(spend.elapsedMs)
    || spend.elapsedMs < 0 || !Number.isSafeInteger(spend.tokens) || spend.tokens < 0) {
    throw new BudgetError('RUN_SPEND_INVALID');
  }
  // 顺序固定：先报时间，再报 token，最后报步数。同时用完时报告最紧的那个。
  if (spend.elapsedMs >= budget.maxMs) return 'time_limit';
  if (spend.tokens >= budget.maxTokens) return 'token_limit';
  if (spend.steps >= budget.maxSteps) return 'step_limit';
  return null;
}

// 留给单步的时间：不能超过整个 Run 的剩余时间，也给单步一个上限。
export function stepDeadlineMs(budget: RunBudget, spend: RunSpend, perStepMs = 20_000) {
  const remaining = budget.maxMs - spend.elapsedMs;
  if (remaining <= 0) throw new BudgetError('RUN_TIME_EXHAUSTED');
  return Math.min(remaining, perStepMs);
}

export function isBudgetReason(reason: StopReason) {
  return reason === 'step_limit' || reason === 'time_limit' || reason === 'token_limit';
}

export const budgetReasons = stopReasons.filter(isBudgetReason);
