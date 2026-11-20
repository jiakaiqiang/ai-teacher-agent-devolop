import type { TicketStatus } from '@ops-ticket/shared';
export function feedbackActions(status:TicketStatus, mayConfirm:boolean) {
  if (!mayConfirm) return [];
  if (status==='handoff_offered') return ['request_human'];
  if (status==='awaiting_feedback' || status==='reviewed') return ['resolved','unresolved'];
  return [];
}
