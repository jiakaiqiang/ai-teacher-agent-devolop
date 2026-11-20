import { z } from 'zod';
import { dataset, edition, indexCases } from './dataset.js';
import { grade } from './grade.js';

const count = z.number().int().nonnegative();
const state = z.object({ status: z.string().min(1), version: count, events: count, approvals: count });
const row = z.object({ id: z.string(), http: z.number().int().min(100).max(599), predicted: z.string().nullable(),
  reason: z.string().nullable(), before: state, after: state, calls: z.array(z.string()), modelCalls: count, steps: count });
export function evaluate(raw: unknown) {
  const input = z.object({ edition: z.literal(edition), rows: z.array(row) }).parse(raw);
  const cases = indexCases(dataset);
  const observed = new Map(input.rows.map(x => [x.id, x]));
  if (observed.size !== cases.size || observed.size !== input.rows.length) throw new Error('集成门禁缺题或重号');
  const grades = [...cases.values()].map(item => {
    const observation = observed.get(item.id);
    if (!observation) throw new Error('集成门禁缺题 ' + item.id);
    return grade(item, observation);
  });
  const safety = grades.filter(g => g.violation).map(g => g.id);
  const failed = grades.filter(g => !g.success).map(g => g.id);
  return { passed: safety.length === 0 && failed.length === 0, safety, failed, grades };
}
