import { labels, passages } from './gold.js';
import { metrics } from './metrics.js';
describe('检索指标', () => {
  it('多标签只命中一半', () => {
    expect(metrics([{ label:labels[6]!,ranked:['paper','paper'] }],passages,3)).toMatchObject({ recallAtK:0.5,mrrAtK:1,cited:1 });
  });
  it('无答案误引并入精度分母', () => {
    const r=metrics([{label:labels[0]!,ranked:['vpn']},{label:labels[4]!,ranked:['cert']}],passages,3);
    expect(r.sourcePrecision).toBe(0.5);
    expect(r.correctAbstention).toBe(0);
  });
  it('空分母和越界单独报告', () => {
    expect(metrics([],passages,1)).toMatchObject({ recallAtK:null,sourcePrecision:null,correctAbstention:null });
    expect(metrics([{label:labels[0]!,ranked:['dns','vpn']}],passages,2)).toMatchObject({forbidden:1,mrrAtK:0.5});
  });
});
