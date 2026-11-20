import { compare } from './compare.js';
import { labels, passages, validateSet } from './gold.js';
function fixture() {
  return { schema:1,digest:validateSet(passages,labels),k:3,model:'fixture',space:'fixture',
    rows:labels.map(l=>({id:l.id,split:l.split,dense:[...l.relevant],hybrid:[...l.relevant],gated:[...l.relevant]})) };
}
describe('配对回归', () => {
  it('拒绝不同版本的报告', () => {
    const a=fixture();
    expect(()=>compare(a,{...a,digest:'other'})).toThrow('INCOMPARABLE');
  });
  it('错例必须保留问题编号', () => {
    const a=fixture(),b=fixture();
    b.rows.find(r=>r.id==='h1')!.gated=[];
    expect(compare(a,b)).toMatchObject({paired:7,lost:['h1'],gained:[]});
  });
  it('缺失问题不能参加配对', () => {
    const a=fixture();
    expect(()=>compare(a,{...a,rows:a.rows.slice(1)})).toThrow('CASESET_MISMATCH');
  });
});
