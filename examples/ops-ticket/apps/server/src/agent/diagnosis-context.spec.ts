import { describe, expect, it } from 'vitest';
import { diagnosisMessages } from './diagnosis-context.js';

describe('按来源组装上下文', () => {
  it('手册与历史只出现在资料消息', () => {
    const material = { ticketNo: 'T-17', goal: '定位异常', history: ['同事已记录'], document: '核对容量', evidence: [19] };
    const messages = diagnosisMessages([], material);
    expect(messages.map(m => m.role)).toEqual(['system', 'user']);
    expect(messages[0]?.content).not.toContain('核对容量');
    expect(JSON.parse(messages[1]!.content)).toMatchObject(material);
  });

  it('关掉补查后不再宣告工具', () => {
    const material = { ticketNo: 'T-18', goal: '读历史', evidence: [] };
    const tools = [{ name: 'ticket_owner', description: '查处理人' }];
    expect(diagnosisMessages(tools, material)[0]?.content).toContain('ticket_owner');
    expect(diagnosisMessages([], material)[0]?.content).toContain('只返回类别');
  });
});
