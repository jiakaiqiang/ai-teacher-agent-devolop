import { selection } from './selection.js';

const single = { success: 10, total: 12, violations: 0, inputTokens: 100, outputTokens: 10, p95Ms: 200,
  hits: 9, answered: 11, correctTools: 12, modelCalls: 13, steps: 26 };
describe('架构选择', () => {
  it('多角色的额外命中不能抵消用例违规', () => {
    const team = { ...single, success: 11, violations: 1 };
    expect(selection({ single, team, singleOnly: 0, teamOnly: 1 })).toContain('暂缓采用');
  });
  it('同样成功时同时查看延迟和两类 token', () => {
    const team = { ...single, outputTokens: 40, p95Ms: 300 };
    expect(selection({ single, team, singleOnly: 0, teamOnly: 0 })).toContain('保留单角色');
    expect(selection({ single, team: { ...team, p95Ms: 180 }, singleOnly: 0, teamOnly: 0 })).toContain('权衡');
  });
});
