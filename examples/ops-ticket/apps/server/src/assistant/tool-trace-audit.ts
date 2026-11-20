import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sessionTurnSchema, toolSessionEventSchema, type ToolSessionEvent } from '@ops-ticket/shared';
import { ToolFailure } from './tool-protocol.js';

const receiptSchema = z.object({ status: z.enum(['exact','estimated']), units: z.number().int().min(0) }).strict();
// 离线核验输入之间是否一致；不查询数据库、不授予权限，也不能证明供应商账单正确。
export function auditToolTrace(rawEvents: unknown, rawTurn: unknown, rawReceipt?: unknown) {
  const trace = z.array(toolSessionEventSchema).min(1).max(16).safeParse(rawEvents), saved = sessionTurnSchema.safeParse(rawTurn);
  if (!trace.success || !saved.success) throw new ToolFailure('TRACE_INVALID');
  const events = trace.data, turn = saved.data, first = events[0]!;
  if (first.type !== 'meta') throw new ToolFailure('TRACE_INVALID');
  const calls = new Map<string, { callId: string; name: string; arguments: string; content: string | null }>();
  let text: string | undefined, terminal: ToolSessionEvent | undefined;
  for (const [index, event] of events.entries()) {
    if (terminal || event.runId !== turn.id || event.seq !== index + 1 || (index > 0 && event.type === 'meta')) throw new ToolFailure('TRACE_INVALID');
    if (event.type === 'tool-start') {
      if (calls.has(event.callId) || calls.size >= 3 || text !== undefined) throw new ToolFailure('TRACE_INVALID');
      calls.set(event.callId, { callId: event.callId, name: event.name, arguments: event.arguments, content: null });
    } else if (event.type === 'tool-result') {
      const call = calls.get(event.callId);
      if (!call || call.content !== null || call.name !== event.name || text !== undefined) throw new ToolFailure('TRACE_INVALID');
      call.content = event.content;
    } else if (event.type === 'answer') {
      if (text !== undefined || [...calls.values()].some(call => call.content === null)) throw new ToolFailure('TRACE_INVALID');
      text = event.text;
    } else if (event.type === 'done' || event.type === 'error') terminal = event;
  }
  const base = { storedStatus: turn.status, observedTools: calls.size, replay: first.replay, recoverable: turn.status === 'completed' };
  if (!terminal) return { ...base, delivery: 'incomplete' as const, units: null };
  if (terminal.type === 'error') {
    if (turn.status === 'failed' && terminal.code !== turn.errorCode) throw new ToolFailure('TRACE_MISMATCH');
    return { ...base, delivery: 'error' as const, units: null };
  }
  if (terminal.type !== 'done' || text === undefined || turn.status !== 'completed') throw new ToolFailure('TRACE_INVALID');
  if (text !== turn.answer) throw new ToolFailure('TRACE_MISMATCH');
  if (first.mode !== turn.mode) throw new ToolFailure('TRACE_MISMATCH');
  if (first.replay ? calls.size !== 0 : !isDeepStrictEqual([...calls.values()], turn.tools)) throw new ToolFailure('TRACE_MISMATCH');
  const receipt = receiptSchema.safeParse(rawReceipt);
  if (!receipt.success || receipt.data.status !== terminal.billing.status || receipt.data.units !== terminal.billing.units) throw new ToolFailure('TRACE_MISMATCH');
  return { ...base, delivery: 'matched' as const, units: receipt.data.units };
}
