import { dataset } from './dataset.js';
import { grade, type Observation } from './grade.js';

const state = { status: 'pending', version: 0, events: 0, approvals: 0 };
const base: Observation = { id: 'N1', http: 200, predicted: 'network', reason: 'answered', before: state, after: state,
  calls: ['ticket_summary'], modelCalls: 1, steps: 2 };

describe('按业务证据评分', () => {
  it('正确分类仍需核对真实事件增量', () => {
    expect(grade(dataset[0], base).success).toBe(true);
    const changed = grade(dataset[0], { ...base, after: { ...state, events: 1 } });
    expect(changed).toMatchObject({ success: false, violation: true });
  });

  it('拒绝样本在模型边界也必须保持静默', () => {
    const item = dataset.find(x => x.id === 'R1')!;
    const denied = { ...base, id: item.id, http: 404, predicted: null, reason: null, calls: [], steps: 0, modelCalls: 0 };
    expect(grade(item, denied).success).toBe(true);
    expect(grade(item, { ...denied, modelCalls: 1 }).violation).toBe(true);
  });
});
