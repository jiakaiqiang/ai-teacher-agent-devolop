import { exhausted, stepDeadlineMs, type RunBudget, type RunSpend } from './run-budget.js';
import type { StepPhase } from './agent-journal.service.js';
import type { StopReason } from './run-state.js';

export interface StepRequest { ordinal: number; deadlineMs: number; spend: RunSpend; }
export interface StepOutcome {
  phase: StepPhase;
  summary: string;
  tokens: number;
  // Trace 用：这一步实际发给模型/工具的内容与拿回的结果，以及分项用量。
  trace?: { kind: 'model' | 'tool'; input: string; output: string; inputTokens?: number; outputTokens?: number };
  // answer 非空表示本步给出了最终答案，循环就此结束。
  answer?: string;
  failure?: string;
  failureReason?: 'model_failed' | 'tool_failed';
}
export interface LoopHooks {
  budget: RunBudget;
  now?: () => number;
  think: (request: StepRequest) => Promise<StepOutcome>;
  onStep: (outcome: StepOutcome, request: StepRequest) => Promise<void>;
}
export interface LoopResult { reason: StopReason; spend: RunSpend; answer: string | null; }

// 推理-行动循环：每一步之前检查三种预算，任何一项用完就停并给出原因。
// 这里不碰数据库，也不认识模型：think 由调用方注入（测试注入假实现，D111 注入真实链路）。
export async function runLoop(hooks: LoopHooks): Promise<LoopResult> {
  const now = hooks.now ?? (() => Date.now());
  const startedAt = now();
  const spend: RunSpend = { steps: 0, elapsedMs: 0, tokens: 0 };
  for (;;) {
    spend.elapsedMs = now() - startedAt;
    const stop = exhausted(hooks.budget, spend);
    if (stop) return { reason: stop, spend, answer: null };
    const request: StepRequest = {
      ordinal: spend.steps + 1,
      deadlineMs: stepDeadlineMs(hooks.budget, spend),
      spend: { ...spend },
    };
    let outcome: StepOutcome;
    try {
      outcome = await hooks.think(request);
    } catch (error) {
      // 单步异常也要先记账：这一步已经发生过，步数和耗时都算。
      spend.steps += 1;
      spend.elapsedMs = now() - startedAt;
      await hooks.onStep({ phase: 'plan', summary: '单步异常', tokens: 0,
        failure: error instanceof Error ? error.message : 'STEP_FAILED' }, request);
      return { reason: 'model_failed', spend, answer: null };
    }
    spend.steps += 1;
    spend.tokens += Math.max(0, Math.trunc(outcome.tokens));
    spend.elapsedMs = now() - startedAt;
    await hooks.onStep(outcome, request);
    if (outcome.failure) return { reason: outcome.failureReason ?? 'tool_failed', spend, answer: null };
    if (outcome.answer) return { reason: 'answered', spend, answer: outcome.answer };
  }
}
