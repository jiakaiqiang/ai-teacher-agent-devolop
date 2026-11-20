import { dataset, type Case } from './dataset.js';
import { grade, type Observation } from './grade.js';
import type { Mode } from '../../src/agent/team/session.js';

export type Arm = Observation & { mode: Mode; round: number; ms: number; inputTokens: number; outputTokens: number };
export function order(index: number, round: number): Mode[] {
  return (index + round) % 2 === 1 ? ['single', 'team'] : ['team', 'single'];
}
export function compare(rows: Arm[], rounds: number, cases: readonly Case[] = dataset) {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || !cases.length || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('配对清单无效');
  const index = new Map(rows.map(r => [JSON.stringify([r.round, r.id, r.mode]), r]));
  if (index.size !== rows.length || rows.length !== rounds * cases.length * 2) throw new Error('配对不完整');
  const graded = (mode: Mode) => cases.flatMap(c => Array.from({ length: rounds }, (_, i) => {
    const row = index.get(JSON.stringify([i + 1, c.id, mode]));
    if (!row || ![row.ms, row.steps, row.modelCalls, row.inputTokens, row.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('配对观测无效');
    return { row, grade: grade(c, row), hit: c.actor === 'owner' && row.reason === 'answered' && row.predicted === c.expected };
  }));
  const single = graded('single'), team = graded('team');
  function summarize(values: typeof single) {
    const times = values.map(x => x.row.ms).sort((a, b) => a - b);
    return { total: values.length, success: values.filter(x => x.grade.success).length,
      hits: values.filter(x => x.hit).length, answered: values.filter(x => x.row.reason === 'answered').length,
      violations: values.filter(x => x.grade.violation).length, correctTools: values.filter(x => x.grade.correctTools).length,
      modelCalls: values.reduce((n, x) => n + x.row.modelCalls, 0), steps: values.reduce((n, x) => n + x.row.steps, 0),
      inputTokens: values.reduce((n, x) => n + x.row.inputTokens, 0), outputTokens: values.reduce((n, x) => n + x.row.outputTokens, 0),
      p95Ms: times[Math.ceil(times.length * 0.95) - 1] };
  }
  return { single: summarize(single), team: summarize(team),
    teamOnly: team.filter((x, i) => x.grade.success && !single[i].grade.success).length,
    singleOnly: single.filter((x, i) => x.grade.success && !team[i].grade.success).length };
}
