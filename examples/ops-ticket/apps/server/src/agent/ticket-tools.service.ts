import { makePacket, type PacketMessage } from './context-packet.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { readAccess } from '../assistant/read-tools.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunFailure } from './run-errors.js';
import { AgentRunsService } from './agent-runs.service.js';
import { CallError, catalog, parseCall } from './tool-catalog.js';
import { saveNote, listNotes } from './ticket-tool-note.js';
import { readTicketTool, visibleTicket } from './ticket-tool-read.js';
import { decideTool, type ToolScene } from './agent-permission.js';
import { checkGrant } from './diagnosis-grant.js';
import { ToolPolicy } from './tool-policy.js';

export const batchSchema = z.object({ calls: z.array(z.unknown()).min(1).max(3) }).strict();
function describe(input: unknown) {
  const value = z.object({ name: z.string().regex(/^[a-z_]{1,50}$/), version: z.number().int() }).safeParse(input);
  return value.success ? value.data : { name: 'invalid', version: 0 };
}
function errorCode(error: unknown) {
  if (error instanceof CallError) return error.code;
  if (error instanceof Error && error.message === 'TOOL_FORBIDDEN') return 'TOOL_FORBIDDEN';
  return 'TOOL_FAILED';
}
@Injectable()
export class TicketToolsService {
  private readonly policy = new ToolPolicy();
  constructor(private readonly db: PrismaService, private readonly runs: AgentRunsService, private readonly audit: AuditService) {}

  async owned(user: AuthUser, id: string) {
    try { return await this.runs.get(user, id); }
    catch (error) {
      if (error instanceof RunFailure && error.code.endsWith('NOT_FOUND')) throw new NotFoundException('运行不可见');
      if (error instanceof RunFailure && error.code === 'RUN_INPUT_INVALID') throw new BadRequestException('运行编号无效');
      throw error;
    }
  }
  async saveContext(user: AuthUser, runId: string, ordinal: number, messages: PacketMessage[]) {
    await this.owned(user, runId);
    const packet = makePacket(messages);
    await this.db.agentContextPacket.create({ data: { runId, ordinal, snapshot: packet } });
    return packet;
  }

  async history(user: AuthUser, id: string, after?: string) {
    await this.owned(user, id);
    const page = await this.db.auditLog.findMany({
      where: { entityType: 'user', entityKey: user.id, actorId: user.id, action: 'agent.tool_call',
        before: { path: ['runId'], equals: id }, ...(after ? { id: { lt: after } } : {}) },
      select: { id: true, actorUsername: true, occurredAt: true, requestId: true, before: true, after: true },
      take: 21, orderBy: { id: 'desc' },
    });
    const items = page.slice(0, 20);
    return { items, next: page.length > 20 ? items.at(-1)!.id : null };
  }
  async batch(user: AuthUser, runId: string, inputs: unknown[], signal: AbortSignal, allowWrites = false, grant?: object) {
    const run = await this.owned(user, runId);
    batchSchema.parse({ calls: inputs });
    // 每个槽独立结束。写工具只接受单项调用，避免用并行顺序表达依赖。
    return Promise.all(inputs.map(input => this.invoke(user, run.id, run.ticketNo, input, signal, allowWrites ? 'workbench' : 'diagnosis', allowWrites && inputs.length === 1, grant)));
  }
  private async invoke(user: AuthUser, runId: string, ticketNo: string, input: unknown, signal: AbortSignal, scene: ToolScene, allowWrites: boolean, grant?: object) {
    const description = describe(input);
    const argsHash = createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
    let parameters: Prisma.InputJsonObject = {};
    const base = { actorId: user.id, actorUsername: user.username, action: 'agent.tool_call',
      entityType: 'user' as const, entityKey: user.id };
    try {
      const call = parseCall(input);
      if (call.effect === 'write' && !allowWrites) throw new CallError('TOOL_WRITE_REQUIRES_SINGLE');
      // 审计展示可检索的非正文参数。笔记正文仅记录摘要和长度。
      const args = call.args as { limit?: number; after?: string | null; requestKey?: string; text?: string };
      parameters = args.requestKey ? { requestKey: args.requestKey, chars: args.text?.length ?? 0 } :
        args.limit ? { limit: args.limit, after: args.after ?? null } : {};
      const result = await this.policy.run(call.name, call.effect === 'read' || call.name === 'save_private_note', signal, async child => {
        try {
          return await this.db.$transaction(async tx => {
            child.throwIfAborted();
            await tx.$executeRaw`SET LOCAL statement_timeout = '1200ms'`;
            const access = await readAccess(tx, user.id);
            const bound = await tx.agentRun.findFirst({ where: { id: runId, userId: user.id, ticketNo }, select: { id: true } });
            if (!bound) throw new CallError('TOOL_FORBIDDEN');
            if (decideTool(access.user.permissions ?? [], scene, call.name) !== 'allow') throw new CallError('TOOL_FORBIDDEN');
            if (scene === 'diagnosis') checkGrant(grant ?? {}, user.id, runId, call.name);
            let value: unknown;
            if (call.name === 'save_private_note' || call.name === 'list_private_notes') {
              const target = await visibleTicket(tx, access.user, ticketNo);
              value = call.name === 'save_private_note' ? await saveNote(tx, user.id, target.id, call.args) :
                await listNotes(tx, user.id, target.id, call.args);
            } else value = await readTicketTool(tx, access.user, ticketNo, call.name, call.args);
            await this.audit.record(tx, { ...base, before: { runId, ...description, argsHash, parameters },
              after: { ok: true, effect: catalog[call.name].effect, resultBytes: Buffer.byteLength(JSON.stringify(value)) } });
            child.throwIfAborted();
            return value;
          }, { maxWait: 500, timeout: 1600, isolationLevel: 'RepeatableRead' });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (['P2024', 'P2034'].includes(error.code)) throw new CallError('TOOL_TEMPORARY');
            if (error.code === 'P2028') throw new CallError('TOOL_TIMEOUT');
          }
          throw error;
        }
      });
      return { ...description, ok: true as const, data: result.value, attempts: result.attempts };
    } catch (error) {
      const code = errorCode(error);
      try {
        await this.db.$transaction(tx => this.audit.record(tx, { ...base, before: { runId, ...description, argsHash, parameters },
          after: { ok: false, code } }), { maxWait: 500, timeout: 1000 });
      } catch { return { ...description, ok: false as const, code: 'TOOL_AUDIT_UNAVAILABLE' }; }
      return { ...description, ok: false as const, code };
    }
  }
}
