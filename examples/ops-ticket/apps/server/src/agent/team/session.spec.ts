import { TeamSession } from './session.js';

const id = '00000000-0000-4000-8000-000000000001';
const summary = { description: { text: '端口丢包。备用端口正常' } };
describe('有限交接', () => {
  it('分诊补查后复核可以要求保留不确定性', () => {
    const session = new TeamSession('team', id);
    session.accept(summary); session.accept({ index: 0, needCounts: true });
    expect(session.next()).toMatchObject({ kind: 'read', role: 'diagnosis', name: 'ticket_log_counts' });
    session.accept({ counts: [] }); session.accept({ category: 'network' });
    expect(session.next()).toMatchObject({ kind: 'ask', role: 'review' });
    expect(session.accept({ verdict: 'insufficient' })).toBe('unknown');
    expect(() => session.next()).toThrow('已经结束');
  });
  it('单角色补查最多一次', () => {
    const session = new TeamSession('single', id);
    session.accept(summary); session.accept({ tool: 'ticket_log_counts' }); session.accept({ counts: [] });
    expect(() => session.accept({ tool: 'ticket_log_counts' })).toThrow();
    expect(session.accept({ category: 'network' })).toBe('network');
    expect(() => session.next()).toThrow('已经结束');
  });
});
