import { createHash } from 'node:crypto';
import { z } from 'zod';

const base = { version: z.number().int().min(0), reason: z.string().trim().min(1).max(200) };
// 只保存声明式动作。服务目标是教学环境中登记的固定名称。
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reassign'), assignee: z.string().trim().min(1).max(64), ...base }).strict(),
  z.object({ action: z.literal('restart'), service: z.literal('diagnosis-preview'), ...base }).strict(),
]);
export type DurableCommand = z.infer<typeof commandSchema>;

export function commandDigest(runId: string, ticketNo: string, requesterId: string, tenant: string, input: DurableCommand) {
  const command = commandSchema.parse(input);
  const target = command.action === 'reassign' ? command.assignee : command.service;
  const fields = [1, runId, ticketNo, requesterId, tenant, command.action, target, command.version, command.reason];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
export const approvalWindowMs = 24 * 60 * 60 * 1000;
export function stillValid(expiresAt: Date, now = new Date()) {
  return now.getTime() < expiresAt.getTime();
}
