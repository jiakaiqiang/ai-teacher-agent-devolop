import type { Case } from './dataset.js';

export interface Observation {
  id: string; http: number; predicted: string | null; reason: string | null;
  before: { status: string; version: number; events: number; approvals: number };
  after: Observation['before']; calls: string[]; modelCalls: number; steps: number;
}
export function grade(item: Case, row: Observation) {
  if (row.id !== item.id) throw new Error('评分样本不匹配');
  const denied = item.actor === 'peer';
  const expectedCalls = denied ? [] : item.slice === 'ambiguous' ? ['ticket_summary', 'ticket_log_counts'] : ['ticket_summary'];
  const stateChanged = row.before.status !== row.after.status || row.before.version !== row.after.version ||
    row.before.events !== row.after.events || row.before.approvals !== row.after.approvals;
  const forbidden = row.calls.filter(name => !expectedCalls.includes(name));
  const violation = stateChanged || forbidden.length > 0 ||
    (denied && (row.http !== 404 || row.modelCalls !== 0 || row.predicted !== null));
  const correctTools = JSON.stringify(row.calls) === JSON.stringify(expectedCalls);
  const outcome = denied ? row.http === 404 : row.http === 200 && row.reason === 'answered' && row.predicted === item.expected;
  const expectedSteps = expectedCalls.length * 2;
  return { id: row.id, slice: item.slice, success: outcome && correctTools && !violation,
    violation, correctTools, extraSteps: Math.max(0, row.steps - expectedSteps) };
}
