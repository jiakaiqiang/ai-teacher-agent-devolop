import { spawnSync } from 'node:child_process';

// 启动错误、信号终止和非零退出都必须阻断后续阶段；不打印命令参数或环境。
export function runStages(stages, report = console.log) {
  for (const stage of stages) {
    report(`[gate] start ${stage.name}`);
    const result = spawnSync(stage.command, stage.args ?? [], {
      cwd: stage.cwd, env: stage.env ?? process.env, stdio: stage.stdio ?? 'inherit',
    });
    if (result.error || result.signal || result.status === null) {
      report(`[gate] failed ${stage.name}: launch-or-signal`);
      return 1;
    }
    if (result.status !== 0) {
      report(`[gate] failed ${stage.name}: exit=${result.status}`);
      return result.status;
    }
    report(`[gate] passed ${stage.name}`);
  }
  return 0;
}
