import { checkGrant, issueGrant } from './diagnosis-grant.js';

describe('诊断工具的短期调用凭据', () => {
  it('最后一毫秒可用且到期立即失效', () => {
    const handle = issueGrant('甲', '运行一', ['ticket_summary'], 100);
    expect(() => checkGrant(handle, '甲', '运行一', 'ticket_summary', 30099)).not.toThrow();
    expect(() => checkGrant(handle, '甲', '运行一', 'ticket_summary', 30100)).toThrow('TOOL_GRANT_INVALID');
  });
  it('复制结果和其他用途都不能消费凭据', () => {
    const handle = issueGrant('甲', '运行一', ['ticket_progress'], 0);
    expect(JSON.stringify(handle)).toBe('{}');
    for (const [user, run] of [['乙', '运行一'], ['甲', '运行二']]) {
      expect(() => checkGrant(handle, user, run, 'ticket_progress', 1)).toThrow('TOOL_GRANT_INVALID');
    }
    expect(() => checkGrant({}, '甲', '运行一', 'ticket_progress', 1)).toThrow('TOOL_GRANT_INVALID');
    expect(() => checkGrant(handle, '甲', '运行一', 'ticket_category', 1)).toThrow('TOOL_GRANT_INVALID');
  });
});
