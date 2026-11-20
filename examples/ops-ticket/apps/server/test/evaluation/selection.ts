import type { compare } from './paired.js';

type Report = ReturnType<typeof compare>;
// 读数用于准备评审。只有在两侧均满足用例约束时才比较收益和运行成本。
export function selection(report: Report) {
  const { single, team } = report;
  if (single.violations && team.violations) return '两侧都有用例违规，先复核';
  if (team.violations) return '多角色有用例违规，暂缓采用';
  if (single.violations) return '单角色有用例违规，先修复对照';
  const tokens = (arm: typeof team) => arm.inputTokens + arm.outputTokens;
  if (team.success <= single.success && tokens(team) >= tokens(single) && team.p95Ms >= single.p95Ms) {
    return '样本未显示多角色收益，保留单角色';
  }
  if (team.success > single.success) return '多角色成功数更高，复核独有命中与代价';
  return '存在成本或延迟权衡，按场景复核';
}
