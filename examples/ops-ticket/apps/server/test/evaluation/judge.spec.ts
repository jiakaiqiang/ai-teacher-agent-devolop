import { agreement, blind } from './judge.js';

describe('人工偏好的位置对照', () => {
  it('交换位置并从裁判输入拿掉金标', () => {
    const pair = { line: 4, question: '合成问题', chosen: '甲', rejected: '乙' };
    expect(blind(pair, true)).toEqual({ question: '合成问题', A: '乙', B: '甲' });
    expect(blind(pair, false)).toEqual({ question: '合成问题', A: '甲', B: '乙' });
  });

  it('固定选首项只能获得一半逐次一致', () => {
    const votes = [{ line: 4, reverse: false, vote: 'A' as const }, { line: 4, reverse: true, vote: 'A' as const }];
    expect(agreement([4], votes)).toMatchObject({ presentations: 2, matched: 1, bothRight: 0, inconsistent: 1 });
    expect(() => agreement([4], [votes[0], votes[0]])).toThrow('不完整');
  });
});
