import { z } from 'zod';

export const toolNameSchema = z.enum(['find_ticket', 'list_ticket_logs', 'list_ticket_history']);
export type ToolName = z.infer<typeof toolNameSchema>;
export const callSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  type: z.literal('function'),
  function: z.object({ name: toolNameSchema, arguments: z.string().max(1024) }).strict(),
}).strict();
export type ToolCall = z.infer<typeof callSchema>;
export type ToolMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export class ToolFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

// 供应商的外围元数据可以存在；只抽取经过验证的消息字段进入下一轮。
const envelope = z.object({ choices: z.array(z.object({
  index: z.literal(0), finish_reason: z.enum(['stop', 'length', 'tool_calls']),
  message: z.object({ content: z.string().max(8192).nullable().optional(),
    refusal: z.string().nullable().optional(), tool_calls: z.array(callSchema).max(3).optional() }),
})).length(1) });

export function parseToolReply(raw: unknown):
  { kind: 'answer'; text: string } | { kind: 'tools'; calls: ToolCall[]; content: string | null } {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) throw new ToolFailure('TOOL_PROTOCOL_ERROR');
  const choice = parsed.data.choices[0]!;
  if (choice.message.refusal) throw new ToolFailure('MODEL_REFUSED');
  if (choice.finish_reason === 'length') throw new ToolFailure('MODEL_TRUNCATED');
  const calls = choice.message.tool_calls ?? [];
  if (choice.finish_reason === 'stop') {
    if (calls.length || !choice.message.content?.trim()) throw new ToolFailure('TOOL_PROTOCOL_ERROR');
    return { kind: 'answer', text: choice.message.content };
  }
  if (!calls.length || new Set(calls.map(call => call.id)).size !== calls.length) {
    throw new ToolFailure('TOOL_PROTOCOL_ERROR');
  }
  return { kind: 'tools', calls, content: choice.message.content ?? null };
}
