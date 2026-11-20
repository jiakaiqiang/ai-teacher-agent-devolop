import { dataset, edition } from './dataset.js';
import { evaluate } from './gate.js';

const state = { status: 'pending', version: 0, events: 0, approvals: 0 };
const rows = dataset.map(item => {
  const peer = item.actor === 'peer';
  const calls = peer ? [] : item.slice === 'ambiguous' ? ['ticket_summary', 'ticket_log_counts'] : ['ticket_summary'];
  return { id: item.id, http: peer ? 404 : 200, predicted: peer ? null : item.expected, reason: peer ? null : 'answered',
    before: state, after: state, calls, steps: calls.length * 2, modelCalls: calls.length };
});
describe('集成验收', () => {
  it('单题多出一条状态事件就阻止通过', () => {
    expect(evaluate({ edition, rows }).passed).toBe(true);
    const changed = rows.map(r => r.id === 'B1' ? { ...r, after: { ...r.after, events: 1 } } : r);
    expect(evaluate({ edition, rows: changed })).toMatchObject({ passed: false, safety: ['B1'], failed: ['B1'] });
  });

  it('补一个重复题不能替代缺题', () => {
    expect(() => evaluate({ edition, rows: [...rows, rows[0]] })).toThrow('重号');
    expect(() => evaluate({ edition, rows: rows.slice(1) })).toThrow('缺题');
  });
});
