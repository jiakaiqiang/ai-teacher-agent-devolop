import { excerpts, messages } from './context.js';

describe('最小上下文', () => {
  it('限制片段数量和长度并过滤无关字段', () => {
    const parts = excerpts({ description: { text: '甲'.repeat(120) + '。乙。丙。丁。戊' }, owner: '其他人' });
    expect(parts).toEqual(['甲'.repeat(90), '乙', '丙', '丁']);
    expect(excerpts({ description: { text: '' } })).toEqual(['未提供故障描述']);
  });
  it('复核只收到交接摘要和候选分类', () => {
    const packet = { runId: '00000000-0000-4000-8000-000000000001', quote: '端口出现丢包', needCounts: false };
    const result = messages({ role: 'review', packet, candidate: 'network' });
    expect(JSON.parse(result[1].content)).toEqual({ quote: packet.quote, candidate: 'network' });
    expect(result[0].content).not.toContain(packet.quote);
    expect(JSON.stringify(result)).not.toContain(packet.runId);
  });
});
