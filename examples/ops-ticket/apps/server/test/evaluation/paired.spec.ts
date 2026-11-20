import { dataset } from './dataset.js';
import { compare, order, type Arm } from './paired.js';

const c = dataset[0];
const state = { status: 'pending', version: 0, events: 0, approvals: 0 };
const one: Arm = { id: c.id, mode: 'single', round: 1, before: state, after: state, predicted: c.expected, reason: 'answered',
  http: 200, calls: ['ticket_summary'], modelCalls: 1, steps: 2, ms: 10, inputTokens: 20, outputTokens: 3 };
describe('成对比较', () => {
  it('按身份对齐并保留质量与用量两个维度', () => {
    const team: Arm = { ...one, mode: 'team', predicted: 'unknown', steps: 4, inputTokens: 60 };
    const result = compare([team, one], 1, [c]);
    expect(result.singleOnly).toBe(1);
    expect(result.team).toMatchObject({ success: 0, inputTokens: 60, violations: 0 });
    expect(() => compare([one, one], 1, [c])).toThrow('配对不完整');
  });
  it('跨工单和轮次交换先后顺序', () => {
    expect(order(0, 1)).toEqual(['single', 'team']);
    expect(order(0, 2)).toEqual(['team', 'single']);
    expect(order(1, 1)).toEqual(['team', 'single']);
  });
});
