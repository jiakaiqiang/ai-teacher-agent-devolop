import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Permission } from '@ops-ticket/shared';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { visibleTickets as scopeOf, type ScopeUser } from '../tickets/scope.js';
import { redactForLog } from '../common/sensitive.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ToolFailure, toolNameSchema, type ToolCall, type ToolMessage } from './tool-protocol.js';

const ticketNo = z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/);
const limit = z.number().int().min(1).max(5);
const schemas = {
  find_ticket: z.object({ ticketNo }).strict(),
  list_ticket_logs: z.object({ ticketNo, limit }).strict(),
  list_ticket_history: z.object({ ticketNo, limit }).strict(),
};
const descriptions = {
  find_ticket: '按完整工单编号查询当前用户可见工单，只读；编号须来自用户或已有结果，不猜测。',
  list_ticket_logs: '按工单号读取本单脱敏日志，只读，limit为1到5。',
  list_ticket_history: '按完整工单编号查询当前用户可见工单最近处理记录，只读，limit为1到5。',
};
export const readToolDefinitions = Object.entries(schemas).map(([name, schema]) => ({
  type: 'function' as const,
  function: { name, description: descriptions[name as keyof typeof schemas], strict: true, parameters: z.toJSONSchema(schema) },
}));

export interface ToolAccess { user: AuthUser & ScopeUser; fingerprint: string; }
export async function readAccess(db: Pick<TransactionClient, 'user'>, userId: string): Promise<ToolAccess> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true, registrationStatus:true, companyId:true, departmentId:true,
    roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } },
  } });
  const permissions = [...new Set(user?.roles.flatMap(r => r.role.permissions.map(p => p.permission.code as Permission)) ?? [])].sort();
  if (!user || user.registrationStatus !== 'approved' || !permissions.includes('ticket:report')) throw new ToolFailure('TOOL_FORBIDDEN');
  return { user: { id: user.id, username: user.username, role: user.role, companyId:user.companyId, departmentId:user.departmentId, permissions },
    fingerprint: createHash('sha256').update(JSON.stringify([user.id,user.companyId,user.departmentId,user.role,permissions])).digest('hex') };
}

@Injectable()
export class ReadToolsService {
  constructor(private readonly db: PrismaService) {}
  // 工具不沿用30秒缓存，每次执行重新读取数据库中的权限和班组。
  access(userId: string) { return readAccess(this.db, userId); }
  // 历史回显和再次发给模型前，批量复核直接查询过的资源；不重跑工具或刷新历史结果。
  async assertReferences(userId: string, messages: ToolMessage[], expectedFingerprint: string) {
    const tickets = new Set<string>();
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const call of message.tool_calls ?? []) {
        let raw: unknown;
        try { raw = JSON.parse(call.function.arguments); } catch { throw new ToolFailure('CONVERSATION_HISTORY_INVALID'); }
        const parsed = schemas[call.function.name].safeParse(raw);
        if (!parsed.success) throw new ToolFailure('CONVERSATION_HISTORY_INVALID');
        if ('ticketNo' in parsed.data) tickets.add(parsed.data.ticketNo);
      }
    }
    if (tickets.size > 120) throw new ToolFailure('CONVERSATION_HISTORY_INVALID');
    await this.db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      const access = await readAccess(tx, userId);
      if (access.fingerprint !== expectedFingerprint) throw new ToolFailure('CONVERSATION_SCOPE_CHANGED');
      const scope = scopeOf(access.user);
      const visibleTickets = await tx.ticket.count({ where: { ticketNo: { in: [...tickets] }, ...scope } });
      if (visibleTickets !== tickets.size) throw new ToolFailure('CONVERSATION_RESOURCE_CHANGED');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 2000, maxWait: 1000 });
  }

  async execute(call: ToolCall, userId: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const name = toolNameSchema.safeParse(call.function.name);
    if (!name.success) throw new ToolFailure('TOOL_NOT_ALLOWED');
    let raw: unknown;
    try { raw = JSON.parse(call.function.arguments); } catch { throw new ToolFailure('TOOL_ARGUMENTS_INVALID'); }
    const parsed = schemas[name.data].safeParse(raw);
    if (!parsed.success) throw new ToolFailure('TOOL_ARGUMENTS_INVALID');
    const input = parsed.data;
    const result = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      const { user } = await readAccess(tx, userId);
      const scope = scopeOf(user);
      signal.throwIfAborted();
      if (!('ticketNo' in input)) throw new ToolFailure('TOOL_ARGUMENTS_INVALID');
      const ticket = await tx.ticket.findFirst({ where: { ticketNo: input.ticketNo, ...scope },
        select: { id: true, ticketNo: true, title: true, description: true, status: true, category: {select:{name:true}} } });
      if (!ticket) throw new ToolFailure('TOOL_NOT_FOUND');
      if (name.data === 'find_ticket') return { ticketNo: ticket.ticketNo, title: redactForLog(ticket.title).slice(0,160), description: redactForLog(ticket.description).slice(0, 500), clipped: ticket.title.length > 160 || ticket.description.length > 500, status: ticket.status, category:ticket.category.name };
      if (!('limit' in input) || typeof input.limit !== 'number') throw new ToolFailure('TOOL_ARGUMENTS_INVALID');
      if (name.data === 'list_ticket_logs') {
        const rows = await tx.ticketMaterial.findMany({where:{ticketId:ticket.id},orderBy:{id:'asc'},take:input.limit+1});
        return {ticketNo:ticket.ticketNo,more:rows.length>input.limit,logs:rows.slice(0,input.limit).map(r=>redactForLog(r.logText).slice(0,160))};
      }
      const rows = await tx.ticketEvent.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1,
        select: { action: true, comment: true, createdAt: true } });
      return { ticketNo: ticket.ticketNo, more: rows.length > input.limit, rows: rows.slice(0, input.limit).map(r => ({ type: r.action, content: redactForLog(r.comment).slice(0, 120), clipped: r.comment.length > 120, createdAt: r.createdAt.toISOString() })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 2000, maxWait: 1000 });
    signal.throwIfAborted();
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 4096) throw new ToolFailure('TOOL_RESULT_LIMIT');
    return result;
  }
}
