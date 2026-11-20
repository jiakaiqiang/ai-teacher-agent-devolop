import { createHash } from 'node:crypto';
import type { TransactionClient } from '../prisma/prisma.service.js';
import { CallError, noteArgs, pageArgs } from './tool-catalog.js';
import { pageOf, shortText } from './ticket-tool-read.js';

// 调用方已在同一事务中核对工单可见范围。笔记只属于当前用户。
export async function saveNote(tx: TransactionClient, userId: string, ticketId: string, input: unknown) {
  const { requestKey, text } = noteArgs.parse(input);
  const hash = createHash('sha256').update(JSON.stringify([1, ticketId, text])).digest('hex');
  const inserted = await tx.agentToolNote.createMany({ data: [{ userId, ticketId, requestKey, hash, text }],
    skipDuplicates: true });
  const receipt = await tx.agentToolNote.findUniqueOrThrow({ where: { userId_requestKey: { userId, requestKey } },
    select: { id: true, hash: true } });
  if (receipt.hash !== hash) throw new CallError('TOOL_KEY_CONFLICT');
  return { noteId: receipt.id, replay: inserted.count === 0 };
}
export async function listNotes(tx: TransactionClient, userId: string, ticketId: string, input: unknown) {
  const { limit, after } = pageArgs.parse(input);
  const rows = await tx.agentToolNote.findMany({ where: { userId, ticketId, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, text: true } });
  return pageOf(rows.map(r => ({ id: r.id, ...shortText(r.text) })), limit);
}
