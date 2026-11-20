// 固定的合成工单，只按分诊类别打分。标签只给评分器。
export const cases = [
  ['N1', '楼层交换机上联口间歇丢包，端口 CRC 错误持续上升。', 'network'],
  ['N2', '终端能访问 IP 地址，但域名解析超时。', 'network'],
  ['N3', '无线终端反复掉线，AP 的重传率显著上升。', 'network'],
  ['S1', '归档卷可用空间为零，写入报 ENOSPC。', 'storage'],
  ['S2', '监控显示磁盘 inode 耗尽，小文件无法新建。', 'storage'],
  ['S3', '阵列报告一块硬盘离线，卷处于降级状态。', 'storage'],
  ['P1', 'UPS 切到电池运行，市电输入告警。', 'power'],
  ['P2', '机柜双电源一路失电，电源模块亮红灯。', 'power'],
  ['U1', '同事反馈今天偶尔不好用，未提供设备和日志。', 'unknown'],
  ['U2', '值班台接到回电请求，尚无故障描述。', 'unknown'],
] as const;

export interface Trial { id: string; predicted: string | null; reason: string; ms: number; tokens: number; steps: number; }
export function score(trials: Trial[]) {
  const byId = new Map(trials.map(row => [row.id, row]));
  if (byId.size !== cases.length || trials.length !== cases.length) throw new Error('EVAL_INCOMPLETE');
  const rows = cases.map(([id, , expected]) => {
    const trial = byId.get(id);
    if (!trial) throw new Error('EVAL_INCOMPLETE');
    return { ...trial, expected, correct: trial.reason === 'answered' && trial.predicted === expected };
  });
  const times = rows.map(row => row.ms).sort((a, b) => a - b);
  return { rows, correct: rows.filter(row => row.correct).length, total: rows.length,
    answered: rows.filter(row => row.reason === 'answered').length,
    p95Ms: times[Math.ceil(times.length * 0.95) - 1], tokens: rows.reduce((sum, row) => sum + row.tokens, 0) };
}
