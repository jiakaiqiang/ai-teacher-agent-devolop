import { labels, passages, validateSet } from './gold.js';
describe('评测集契约', () => {
  it('同一故障族不能跨分区', () => {
    expect(() => validateSet(passages,[...labels,{ ...labels[0]!,id:'new',split:'holdout' }])).toThrow('FAMILY_LEAK');
  });
  it('期望来源必须属于可见范围', () => {
    expect(() => validateSet(passages,[{...labels[0]!, relevant:['dns']}])).toThrow('INVALID_LABEL');
  });
  it('无答案也纳入数据版本', () => {
    expect(labels.filter(c => !c.relevant.length)).toHaveLength(3);
    expect(validateSet(passages,labels)).not.toBe(validateSet(passages,labels.slice(1)));
  });
});
