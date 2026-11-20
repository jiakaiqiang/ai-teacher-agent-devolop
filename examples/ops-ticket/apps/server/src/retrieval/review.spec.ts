import { assess } from './review.js';
describe('排名与授权复盘', () => {
  it('第二位命中按二分之一计分', () => {
    const result = assess(['B', 'A'], 'A', new Set(['A', 'B']));
    expect(result).toEqual({ firstRelevantRank: 2, reciprocalRank: 0.5, outOfScope: [] });
  });
  it('漏召回计零', () => {
    expect(assess([], 'A', new Set(['A']))).toEqual({ firstRelevantRank: null, reciprocalRank: 0, outOfScope: [] });
  });
  it('正确答案在首位仍报告越界候选', () => {
    expect(assess(['A','B'], 'A', new Set(['A'])).outOfScope).toEqual(['B']);
  });
});
