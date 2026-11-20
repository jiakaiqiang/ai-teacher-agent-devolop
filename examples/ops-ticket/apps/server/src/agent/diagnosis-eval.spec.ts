import { cases, score } from '../../test/diagnosis-eval.js';

describe('固定工单基线', () => {
  const trials = cases.map(([id, , predicted], i) => ({
    id, predicted, reason: 'answered', ms: i + 1, tokens: 15, steps: 2,
  }));

  it('误分和调用失败都留在分母', () => {
    const changed = trials.map((row, i) => i === 0 ? { ...row, predicted: 'storage' } :
      i === 1 ? { ...row, reason: 'model_failed' } : row);
    expect(score(changed)).toMatchObject({ correct: 8, total: 10, answered: 9, p95Ms: 10, tokens: 150 });
  });

  it('相同数量的重复用例无法替代缺失用例', () => {
    expect(() => score([...trials, trials[0]!])).toThrow('EVAL_INCOMPLETE');
    expect(() => score([...trials.slice(1), trials[1]!])).toThrow('EVAL_INCOMPLETE');
  });
});
