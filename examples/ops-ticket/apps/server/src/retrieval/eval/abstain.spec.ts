import { labels } from './gold.js';
import { accept, calibrate, loss } from './abstain.js';
describe('拒答校准', () => {
  it('逐条裁剪后再取前K', () => {
    expect(accept([{id:'x',similarity:0.4},{id:'y',similarity:0.7}],0.7,1)).toEqual(['y']);
    expect(accept([{id:'bad',similarity:NaN}],0)).toEqual([]);
  });
  it('禁止留出标签参与选择', () => {
    expect(() => calibrate([{label:labels[7]!,candidates:[]}],[0.6])).toThrow('HOLDOUT_IN_CALIBRATION');
  });
  it('拒答代价按题型计算且平局选较高门槛', () => {
    const miss={label:labels[0]!,candidates:[]};
    expect(loss(miss,0.6)).toBe(1);
    expect(loss({label:labels[4]!,candidates:[{id:'vpn',similarity:0.8}]},0.6)).toBe(2);
    expect(calibrate([miss],[0.5,0.6])).toEqual({threshold:0.6,cost:1});
  });
});
