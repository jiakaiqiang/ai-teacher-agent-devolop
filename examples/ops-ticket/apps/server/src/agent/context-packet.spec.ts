import { describe, expect, it } from 'vitest';
import { makePacket, replayPacket, type PacketMessage } from './context-packet.js';

const input = (goal: string): PacketMessage[] => [{ role: 'system', content: '按工单作答' },
  { role: 'user', content: JSON.stringify({ goal, evidence: [{ apiKey: 'synthetic-value', text: 'Bearer sample-opaque' }] }) }];

describe('发送前的上下文快照', () => {
  it('先遮盖字段再保存并回放同一组消息', () => {
    const packet = makePacket(input('复核'));
    expect(packet.messages[1]?.content).not.toContain('synthetic-value');
    expect(packet.messages[1]?.content).not.toContain('sample-opaque');
    expect(replayPacket(JSON.parse(JSON.stringify(packet))).messages).toEqual(packet.messages);
  });

  it('前缀稳定而正文变更可以查出', () => {
    const one = makePacket(input('甲'));
    const two = makePacket(input('乙'));
    expect(one.prefix).toBe(two.prefix);
    expect(one.digest).not.toBe(two.digest);
    expect(() => replayPacket({ ...one, messages: two.messages })).toThrow('CONTEXT_PACKET_CHANGED');
  });
});
