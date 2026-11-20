import { issueGrant } from '../diagnosis-grant.js';

export type Role = 'single' | 'triage' | 'diagnosis' | 'review';
export type ReadName = 'ticket_summary' | 'ticket_log_counts';
const allowed: Record<Role, readonly ReadName[]> = {
  single: ['ticket_summary', 'ticket_log_counts'], triage: ['ticket_summary'],
  diagnosis: ['ticket_log_counts'], review: [],
};

// 角色由服务端调度器选择；每次只签发本次读取所需的单项授权。
export function grantRead(role: Role, userId: string, runId: string, name: ReadName) {
  if (!allowed[role].includes(name)) throw new Error('角色没有该工具');
  return issueGrant(userId, runId, [name]);
}
