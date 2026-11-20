import { assemble, encoders, percentile, usage } from './bench.js';
import { bridgeEmbed } from '../bridge.js';
import { encode, space } from '../encoding.js';
import { labels } from './gold.js';
describe('本机评测报告', () => {
  it('近秩百分位按数值排序', () => {
    expect(percentile([20,3,100,1],0.5)).toBe(3);
    expect(percentile([20,3,100,1],0.95)).toBe(100);
  });
  it('范围不一致立即结束评测', () => {
    expect(()=>assemble(labels[0]!,[{id:'dns',similarity:1}])).toThrow('SCOPE_MISMATCH');
  });
  it('本机调用保留未知费用', () => {
    expect(usage(14,1,90)).toEqual({queryCalls:14,passageCalls:1,inputCodePoints:90,generatedTokens:0,monetaryCost:null});
  });
});

describe('评测后端选择', () => {
  it('两种后端都登记且各自指向真实实现', () => {
    expect(Object.keys(encoders)).toEqual(['node', 'python']);
    expect(encoders.node).toBe(encode);
    // 防止“以为在评测Python、其实仍跑Node”。
    expect(encoders.python).toBe(bridgeEmbed);
  });

  it('桥接编码核对条数、维度与向量空间', async () => {
    const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    const ok = vi.fn().mockResolvedValue({ schema_version: 1, space, dimension: 1024, count: 2, vectors: [vector, vector] });
    await expect(bridgeEmbed(['甲', '乙'], 'passage', ok)).resolves.toHaveLength(2);
    expect(ok).toHaveBeenCalledWith('/v1/embedding', { role: 'passage', texts: ['甲', '乙'] });
    for (const bad of [{ schema_version: 1, space, dimension: 1024, count: 1, vectors: [vector, vector] },
      { schema_version: 1, space, dimension: 1024, count: 2, vectors: [vector, vector.slice(1)] },
      { schema_version: 1, space: 'other', dimension: 1024, count: 2, vectors: [vector, vector] }]) {
      await expect(bridgeEmbed(['甲', '乙'], 'passage', vi.fn().mockResolvedValue(bad))).rejects.toThrow('BRIDGE_CONTRACT');
    }
  });
});
