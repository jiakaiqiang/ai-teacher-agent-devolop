import { z } from 'zod';

const empty = z.object({}).strict();
export const pageArgs = z.object({
  limit: z.number().int().min(1).max(5), after: z.uuid().nullable(),
}).strict();
export const noteArgs = z.object({ requestKey: z.uuid(), text: z.string().trim().min(1).max(300) }).strict();
type Effect = 'read' | 'write' | 'high';
type Topic = 'overview' | 'history' | 'device' | 'notes';
function definition(topic: Topic, effect: Effect, description: string, schema: z.ZodType) {
  return { topic, effect, description, schema, version: 1 as const };
}
// 工单编号从运行上下文取得。调用方只能填写具体工具允许的参数。
export const catalog = {
  ticket_summary: definition('overview', 'read', '读取工单标题、描述和状态', empty),
  ticket_progress: definition('overview', 'read', '读取处理状态和版本', empty),
  ticket_owner: definition('overview', 'read', '查询工单处理人', empty),
  ticket_category: definition('device', 'read', '查询提单分类', empty),
  ticket_log_counts: definition('device', 'read', '统计本单日志材料', empty),
  ticket_log_page: definition('device', 'read', '分页读取本单日志', pageArgs),
  ticket_history_page: definition('history', 'read', '按编号游标分页读取处理记录', pageArgs),
  list_private_notes: definition('notes', 'read', '读取本人保存的诊断笔记', pageArgs),
  save_private_note: definition('notes', 'write', '保存当前用户的诊断笔记', noteArgs),
  publish_solution: definition('overview', 'high', '发布共享方案，需要承办部门审核', empty),
};
export type Name = keyof typeof catalog;
export class CallError extends Error {
  constructor(readonly code: string) { super(code); }
}
export const callSchema = z.object({
  name: z.string().min(1).max(50), version: z.literal(1), args: z.unknown(),
}).strict();
export function parseCall(input: unknown) {
  const call = callSchema.safeParse(input);
  if (!call.success) throw new CallError('TOOL_CONTRACT_INVALID');
  if (!Object.hasOwn(catalog, call.data.name)) throw new CallError('TOOL_UNKNOWN');
  const name = call.data.name as Name;
  const entry = catalog[name];
  if (entry.effect === 'high') throw new CallError('TOOL_APPROVAL_REQUIRED');
  const args = entry.schema.safeParse(call.data.args);
  if (!args.success) throw new CallError('TOOL_ARGUMENTS_INVALID');
  return { name, args: args.data, effect: entry.effect };
}
export function definitions(topic: Topic, allowWrites = false) {
  return Object.entries(catalog).filter(([, e]) => e.topic === topic &&
    (e.effect === 'read' || (allowWrites && e.effect === 'write'))).map(([name, e]) => ({
    name, version: e.version, effect: e.effect, description: e.description, parameters: z.toJSONSchema(e.schema),
  }));
}
