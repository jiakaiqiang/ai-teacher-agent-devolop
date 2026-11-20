import { reviewSample } from './feedback.js';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const usage = { traces: 2, inputTokens: 70, outputTokens: 4 };
const traces = ids.map(runId => ({ space: 'training', runId, outcome: 'answered', usage, input: '工单正文' }));
const secret = 'local-demonstration-key';

describe('反馈抽样', () => {
  it('只关联同一空间的最终反馈', () => {
    const same = { space: 'training', runId: ids[1], helpful: false };
    const foreign = { space: 'other', runId: ids[0], helpful: false };
    const sample = reviewSample({ traces, votes: [same, foreign] }, 'training', secret, 2);
    expect(sample.map(x => x.helpful)).toEqual([false, null]);
    expect(JSON.stringify(sample)).not.toContain('工单正文');
    expect(JSON.stringify(sample)).not.toContain(ids[0]);
  });

  it('打乱输入仍得到同一个有界样本', () => {
    const select = (items: unknown[]) => reviewSample({ traces: items, votes: [] }, 'training', secret, 1);
    expect(select(traces)).toHaveLength(1);
    expect(select(traces)).toEqual(select([...traces].reverse()));
    expect(() => select([...traces, traces[0]])).toThrow('运行重复');
  });
});
