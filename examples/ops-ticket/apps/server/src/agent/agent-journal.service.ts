import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { RunLiveHub } from './run-live.hub.js';
import { RunFailure } from './run-errors.js';

export const stepPhases = ['plan', 'tool', 'answer'] as const;
export type StepPhase = (typeof stepPhases)[number];
export const eventTypes = ['run_started', 'step_started', 'step_finished', 'run_finished'] as const;
export type EventType = (typeof eventTypes)[number];
export const STEP_LIMIT = 8;

const payloadSchema = z.record(z.string().max(32), z.union([z.string().max(500), z.number().finite(),
  z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 8, 'PAYLOAD_TOO_WIDE');
export type EventPayload = z.infer<typeof payloadSchema>;

type Journal = Pick<TransactionClient, 'agentRun' | 'agentStep' | 'agentEvent' | '$queryRaw'>;

@Injectable()
export class AgentJournalService {
  constructor(private readonly db: PrismaService, private readonly live: RunLiveHub) {}

  // 事件序号由 Run 行上的计数器分配：同一事务内 UPDATE ... RETURNING 保证不重号，
  // 并发写第二个事务会等锁，拿到的一定是递增后的值。
  private async append(tx: Journal, runId: string, type: EventType, stepId: string | null,
    payload: EventPayload) {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) throw new RunFailure('RUN_EVENT_INVALID');
    const [row] = await tx.$queryRaw<{ event_seq: number }[]>`
      UPDATE agent_runs SET event_seq = event_seq + 1 WHERE id = ${runId}::uuid RETURNING event_seq`;
    if (!row) throw new RunFailure('RUN_NOT_FOUND');
    return tx.agentEvent.create({
      data: { runId, stepId, seq: row.event_seq, type, payload: parsed.data },
    });
  }

  // 终态与最后一帧共用提交点。
  async finishRun<T>(runId: string, payload: EventPayload, finish: (tx: TransactionClient) => Promise<T>) {
    const result = await this.db.$transaction(async tx => {
      const run = await finish(tx);
      await this.append(tx, runId, 'run_finished', null, payload);
      return run;
    });
    this.live.publish(runId);
    return result;
  }

  async record(runId: string, type: EventType, payload: EventPayload = {}, stepId: string | null = null) {
    const event = await this.db.$transaction(tx => this.append(tx, runId, type, stepId, payload));
    // 事务提交之后再广播：订阅者醒来时一定能读到这条事件。
    this.live.publish(runId);
    return event;
  }

  // 开一步：序号由库里的现有步数决定，并和 step_started 事件写在同一个事务里。
  async beginStep(runId: string, phase: StepPhase, summary = '') {
    if (!stepPhases.includes(phase)) throw new RunFailure('RUN_STEP_PHASE_INVALID');
    return this.db.serializable(async tx => {
      const run = await tx.agentRun.findUnique({ where: { id: runId }, select: { status: true, stepCount: true } });
      if (!run) throw new RunFailure('RUN_NOT_FOUND');
      if (run.status !== 'running') throw new RunFailure('RUN_NOT_RUNNING');
      if (run.stepCount >= STEP_LIMIT) throw new RunFailure('RUN_STEP_LIMIT');
      const ordinal = run.stepCount + 1;
      const step = await tx.agentStep.create({
        data: { runId, ordinal, phase, summary: summary.slice(0, 500) },
      });
      await tx.agentRun.update({ where: { id: runId }, data: { stepCount: { increment: 1 } } });
      const event = await this.append(tx, runId, 'step_started', step.id, { ordinal, phase });
      return { step, event };
    }).then(result => { this.live.publish(runId); return result; });
  }

  // 收一步：只允许 running → succeeded/failed，失败才带错误码。
  async endStep(stepId: string, outcome: { status: 'succeeded' | 'failed'; summary?: string; errorCode?: string }) {
    return this.db.$transaction(async tx => {
      const changed = await tx.agentStep.updateMany({
        where: { id: stepId, status: 'running' },
        data: {
          status: outcome.status, endedAt: new Date(),
          errorCode: outcome.status === 'failed' ? outcome.errorCode ?? 'STEP_FAILED' : null,
          ...(outcome.summary === undefined ? {} : { summary: outcome.summary.slice(0, 500) }),
        },
      });
      if (changed.count !== 1) throw new RunFailure('RUN_STEP_STATE_CONFLICT');
      const step = await tx.agentStep.findUniqueOrThrow({ where: { id: stepId } });
      const event = await this.append(tx, step.runId, 'step_finished', step.id,
        { ordinal: step.ordinal, phase: step.phase, status: step.status, errorCode: step.errorCode });
      return { step, event };
    }).then(result => { this.live.publish(result.step.runId); return result; });
  }

  async steps(runId: string) {
    return this.db.agentStep.findMany({ where: { runId }, orderBy: { ordinal: 'asc' }, take: STEP_LIMIT });
  }

  // 读事件：按序号升序，支持 after 增量拉取（D110 的事件流用同一个口径）。
  async events(runId: string, after = 0, take = 100) {
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(take) || take < 1 || take > 200) {
      throw new RunFailure('RUN_INPUT_INVALID');
    }
    return this.db.agentEvent.findMany({
      where: { runId, seq: { gt: after } }, orderBy: { seq: 'asc' }, take,
    });
  }
}
