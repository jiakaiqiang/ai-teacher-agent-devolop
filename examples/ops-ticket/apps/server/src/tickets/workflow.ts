import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TicketStatus } from '@ops-ticket/shared';

export interface Actor { id: string; role: string; companyId?: string | null; departmentId?: string | null }
export interface TicketSnapshot {
  status: TicketStatus; reporterId: string; companyId: string; departmentId: string; assigneeId: string | null;
}
export type Action = 'suggest' | 'offer_handoff' | 'request_human' | 'unresolved' | 'assign' | 'handle' | 'approve' | 'return' | 'resolved';
type Rule = readonly [TicketStatus, Action, 'agent' | 'reporter' | 'department_lead' | 'operator', TicketStatus];
const rules: Rule[] = [
  ['agent_processing','suggest','agent','awaiting_feedback'],
  ['agent_processing','offer_handoff','agent','handoff_offered'],
  ['handoff_offered','request_human','reporter','pending_assignment'],
  ['awaiting_feedback','unresolved','reporter','pending_assignment'],
  ['awaiting_feedback','resolved','reporter','completed'],
  ['pending_assignment','assign','department_lead','human_processing'],
  ['human_processing','handle','operator','handled'],
  ['handled','approve','department_lead','reviewed'],
  ['handled','return','department_lead','human_processing'],
  ['reviewed','unresolved','reporter','human_processing'],
  ['reviewed','resolved','reporter','completed'],
];

export function transition(ticket: TicketSnapshot, actor: Actor, action: Action, target?: Actor): TicketSnapshot {
  const rule = rules.find(([status,event]) => status === ticket.status && event === action);
  if (!rule) throw new ConflictException('当前状态不允许此操作');
  const [, , role, status] = rule;
  if (role !== actor.role) throw new ForbiddenException('需要对应角色');
  if (role === 'reporter' && (actor.id !== ticket.reporterId || actor.companyId !== ticket.companyId))
    throw new ForbiddenException('仅提单人可反馈');
  if ((role === 'operator' || role === 'department_lead') && actor.departmentId !== ticket.departmentId)
    throw new ForbiddenException('工单归属其他部门');
  if (role === 'operator' && actor.id !== ticket.assigneeId)
    throw new ForbiddenException('工单已派给其他人');
  if (action === 'assign') {
    if (target?.role !== 'operator' || target.departmentId !== ticket.departmentId)
      throw new ForbiddenException('指派对象必须是本部门内部处理人');
    return { ...ticket, status, assigneeId: target.id };
  }
  return { ...ticket, status };
}
