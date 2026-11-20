import { passages } from './gold.js';
import { fuse, lexical, rerankCode } from './hybrid.js';
describe('候选融合', () => {
  it('词项缺失返回空列表', () => {
    expect(lexical('ZZ999',passages)).toEqual([]);
    expect(lexical('Q18',passages)[0]?.id).toBe('queue');
  });
  it('两路共现累加名次贡献', () => {
    expect(fuse([['vpn','queue'],['paper','queue']],new Set(['vpn','paper','queue']))[0]).toBe('queue');
  });
  it('精确故障码优先并保留其余顺序', () => {
    expect(rerankCode('Q18',['paper','queue','vpn'],passages)).toEqual(['queue','paper','vpn']);
    expect(rerankCode('Q180',['paper','queue'],passages)).toEqual(['paper','queue']);
  });
});
