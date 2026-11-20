import { z } from 'zod';

// 只保存用户显式选择的交接版式。工单正文、批准和操作指令均没有写入字段。
export const layoutSchema = z.enum(['summary-first', 'evidence-first']);
export type Layout = z.infer<typeof layoutSchema>;
export const preferenceWrite = z.object({
  layout: layoutSchema, days: z.number().int().min(1).max(90), expected: z.uuid().nullable(),
}).strict();

export function expiresOn(now: Date, days: number) {
  return new Date(now.getTime() + days * 86_400_000);
}
export function isCurrent(expiresAt: Date, now: Date) {
  return expiresAt.getTime() > now.getTime();
}
