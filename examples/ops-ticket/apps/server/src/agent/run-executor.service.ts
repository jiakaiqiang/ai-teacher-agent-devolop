import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';

import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';
import { RunTraceService } from './run-trace.service.js';

import { parseBudget, type RunBudget } from './run-budget.js';
import { runLoop, type StepOutcome, type StepRequest } from './run-loop.js';
import { RunFailure } from './run-errors.js';

export type Think = (request: StepRequest, context: { ticketNo: string; goal: string }) => Promise<StepOutcome>;

@Injectable()
export class RunExecutorService {
  constructor(private readonly runs: AgentRunsService, private readonly journal: AgentJournalService,
    private readonly traces: RunTraceService, 
    ) {}

  // 认领 → 逐步执行 → 把停止原因写进 Run。每一步的状态与事件由 journal 落库。
  async execute(user: AuthUser, runId: string, think: Think, budget: Partial<RunBudget> = {}) {
    const limits = parseBudget(budget);
    const claimed = await this.runs.claim(user, runId, (await this.runs.get(user, runId)).version);
    await this.journal.record(claimed.id, 'run_started',
      { ticketNo: claimed.ticketNo, maxSteps: limits.maxSteps, maxMs: limits.maxMs, maxTokens: limits.maxTokens });
    const context = { ticketNo: claimed.ticketNo, goal: claimed.goal };
    const result = await runLoop({
      budget: limits,
      think: request => think(request, context),
      onStep: async (outcome, request) => {
        const startedAt = Date.now();
        const { step } = await this.journal.beginStep(claimed.id, outcome.phase, outcome.summary);
        if (step.ordinal !== request.ordinal) throw new RunFailure('RUN_STEP_ORDINAL_MISMATCH');
        if (outcome.trace) {
          // Trace 与步骤一一对应；内容先脱敏再截断，正文不进事件。
          await this.traces.record(claimed.id, {
            stepId: step.id, ordinal: step.ordinal, kind: outcome.trace.kind,
            input: outcome.trace.input, output: outcome.trace.output,
            inputTokens: outcome.trace.inputTokens, outputTokens: outcome.trace.outputTokens,
            durationMs: Date.now() - startedAt,
          });
        }
        await this.journal.endStep(step.id, outcome.failure
          ? { status: 'failed', errorCode: outcome.failure }
          : { status: 'succeeded' });
      },
    });
    const current = await this.runs.get(user, runId);
    const finished = await this.journal.finishRun(current.id, {
      stopReason: result.reason, steps: result.spend.steps, tokens: result.spend.tokens,
      elapsedMs: Math.trunc(result.spend.elapsedMs), answer: result.answer?.slice(0, 500) ?? null,
    }, tx => this.runs.finish(current.id, current.version, result.reason, 'running', tx));
    const usage = await this.traces.usage(finished.id);
    return { run: finished, result, usage };
  }
}
