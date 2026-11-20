import { cases } from '../diagnosis-eval.js';
import { summarize } from './metrics.js';

const round = cases.map(([id, , expected], i) => ({ id, predicted: expected, reason: 'answered', ms: i + 1,
  tokens: 12, steps: 2, inputTokens: 10, outputTokens: 2 }));

describe('重复测量的分母', () => {
  it('同题跨轮分歧会降低稳定题数和全对题数', () => {
    const other = round.map((x, i) => i === 0 ? { ...x, predicted: null, reason: 'model_failed', ms: 200 } : x);
    expect(summarize([round, other])).toMatchObject({ attempts: 20, hits: 19, answered: 19,
      alwaysCorrect: 9, everCorrect: 10, stable: 9, p95Ms: 10, estimatedCost: null });
    expect(() => summarize([round, other.slice(1)])).toThrow('EVAL_INCOMPLETE');
  });

  it('输入和输出按各自单价计量', () => {
    expect(summarize([round], { inputPerMillion: 1, outputPerMillion: 5 }).estimatedCost).toBeCloseTo(0.0002, 8);
    expect(() => summarize([[{ ...round[0], tokens: 0 }, ...round.slice(1)]])).toThrow('计量无效');
  });
});
