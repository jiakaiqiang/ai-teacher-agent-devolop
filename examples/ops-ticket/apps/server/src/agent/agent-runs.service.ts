import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { visibleTickets } from '../tickets/scope.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ReadToolsService } from '../assistant/read-tools.service.js';
import { assertTransition, statusForReason, type RunStatus, type StopReason } from './run-state.js';
import { RunFailure } from './run-errors.js';

const startSchema = z.object({
  requestKey: z.uuid(),
  ticketNo: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(500),
}).strict();
export type StartInput = z.infer<typeof startSchema>;
export const RUN_LIMIT = 20;

@Injectable()
export class AgentRunsService {
  constructor(private readonly db: PrismaService, private readonly tools: ReadToolsService) {}

  // 开跑前先确认工单在当前用户的数据权限范围内；范围由 W3 的 groupScope 决定。
  private async target(user: AuthUser, ticketNo: string) {
    const ticket = await this.db.ticket.findFirst({
      where: { ...visibleTickets((await this.tools.access(user.id)).user), ticketNo }, select: { ticketNo: true },
    });
    if (!ticket) throw new RunFailure('RUN_TICKET_NOT_FOUND');
    return ticket.ticketNo;
  }

  async start(user: AuthUser, input: unknown) {
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
    const { requestKey, goal } = parsed.data;
    const ticketNo = await this.target(user, parsed.data.ticketNo);
    const { fingerprint } = await this.tools.access(user.id);
    // 同一用户同一请求键只建一次：重试拿回原来的 Run，不会重复开跑。
    const existing = await this.db.agentRun.findUnique({ where: { userId_requestKey: { userId: user.id, requestKey } } });
    if (existing) {
      if (existing.ticketNo !== ticketNo || existing.goal !== goal) throw new RunFailure('RUN_REQUEST_KEY_CONFLICT');
      return { run: existing, replay: true };
    }
    return this.db.serializable(async tx => {
      const live = await tx.agentRun.count({ where: { userId: user.id, status: { in: ['queued', 'running'] } } });
      if (live >= RUN_LIMIT) throw new RunFailure('RUN_LIMIT');
      const run = await tx.agentRun.create({
        data: { userId: user.id, requestKey, ticketNo, goal, scopeHash: fingerprint },
      });
      return { run, replay: false };
    });
  }

  async get(user: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new RunFailure('RUN_INPUT_INVALID');
    const run = await this.db.agentRun.findFirst({ where: { id, userId: user.id } });
    if (!run) throw new RunFailure('RUN_NOT_FOUND');
    await this.target(user,run.ticketNo);
    return run;
  }

  async list(user: AuthUser) {
    return this.db.agentRun.findMany({
      where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30,
    });
  }

  // 状态推进统一走条件更新：WHERE 带上旧状态和版本，影响 0 行就是被别人改过。
  private async move(id: string, from: RunStatus, to: RunStatus, version: number,
    reason?: StopReason, extra: { startedAt?: Date; endedAt?: Date } = {}, db: TransactionClient | PrismaService = this.db) {
    assertTransition(from, to, reason);
    const result = await db.agentRun.updateMany({
      where: { id, status: from, version },
      data: { status: to, version: { increment: 1 }, stopReason: reason ?? null, ...extra },
    });
    if (result.count !== 1) throw new RunFailure('RUN_STATE_CONFLICT');
    return db.agentRun.findUniqueOrThrow({ where: { id } });
  }

  // 认领：把 queued 变成 running。多个工作者同时认领只有一个成功。
  async claim(user: AuthUser, id: string, version: number) {
    const run = await this.get(user, id);
    if (run.scopeHash !== (await this.tools.access(user.id)).fingerprint) throw new RunFailure('RUN_SCOPE_CHANGED');
    return this.move(run.id, run.status as RunStatus, 'running', version, undefined, { startedAt: new Date() });
  }

  // 收尾：停止原因决定终态，不让调用方自己挑状态。
  async finish(id: string, version: number, reason: StopReason, from: RunStatus = 'running', tx?: TransactionClient) {
    return this.move(id, from, statusForReason(reason), version, reason, { endedAt: new Date() }, tx);
  }

  async cancel(user: AuthUser, id: string, version: number) {
    const run = await this.get(user, id);
    return this.finish(run.id, version, 'user_cancelled', run.status as RunStatus);
  }
}
