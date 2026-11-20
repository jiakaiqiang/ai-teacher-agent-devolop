import { definitions, parseCall } from './tool-catalog.js';

describe('带版本的工具契约', () => {
  it('只加载请求的主题与副作用等级', () => {
    expect(definitions('device').map(x => x.name)).toEqual(['ticket_category', 'ticket_log_counts', 'ticket_log_page']);
    expect(definitions('notes').map(x => x.name)).toEqual(['list_private_notes']);
    expect(definitions('notes', true)[0]?.version).toBe(1);
    expect(definitions('overview', true).some(x => x.name === 'publish_solution')).toBe(false);
  });
  it('服务端拒绝不支持的版本和分页越界', () => {
    const call = { name: 'ticket_history_page', version: 1, args: { limit: 5, after: null } };
    expect(parseCall(call).name).toBe('ticket_history_page');
    expect(() => parseCall({ ...call, version: 2 })).toThrow('TOOL_CONTRACT_INVALID');
    expect(() => parseCall({ ...call, args: { limit: 6, after: null } })).toThrow('TOOL_ARGUMENTS_INVALID');
    expect(() => parseCall({ ...call, args: { ...call.args, ticketNo: 'T1' } })).toThrow('TOOL_ARGUMENTS_INVALID');
    expect(() => parseCall({ ...call, name: 'publish_solution' })).toThrow('TOOL_APPROVAL_REQUIRED');
  });
});
