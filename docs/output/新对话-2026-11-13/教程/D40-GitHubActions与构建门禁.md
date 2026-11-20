# D40：GitHub Actions 与构建门禁

第 6 周 · 2 小时 · 前置 [D39-Docker与Nginx本地编排](D39-Docker与Nginx本地编排.md)。

## 今天要做出什么

按现有 CI 运行构建与测试

## 今天的目录结构

- `scripts/ci-secrets.mjs`
- `scripts/ci.mjs`
- `scripts/ci-runner.mjs`
- `scripts/ci-runner.d.mts`
- `apps/server/test/ci-runner.spec.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

工单验收用例失败后 CI 能否继续输出发布成功？

## 一、知识点与推导

使用失败的子进程运行假阶段，确认 CI 返回原退出码并停止后续步骤。

## 二、动手开发

运行 ci-runner.spec.ts，先故意给子进程非零退出，再修复。把生成、构建、单元、lint 和接口用例按依赖顺序接入 CI。

## 三、自检与提交

保存失败阶段名称与退出码，说明后续阶段为什么未运行。

## 四、本章完整源码

**scripts/ci-secrets.mjs**

```text
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

// 只在临时 GitHub runner 内生成本次测试凭据，绝不读取或上传开发 .env。
if (!process.env.GITHUB_ACTIONS || !process.env.GITHUB_ENV) throw new Error('仅供 Actions 临时 runner 使用');
for (const name of ['JWT_SECRET', 'SEED_USER_PASSWORD']) {
  const value = randomBytes(32).toString('hex');
  console.log(`::add-mask::${value}`);
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
```

**scripts/ci.mjs**

```text
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runStages } from './ci-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 由 pnpm run ci 启动：复用它的实际 CLI 路径，不依赖 shell 字符串拼接。
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('请从根目录执行 pnpm run ci');
const stage = (name, args, cwd = root) => ({ name, command: process.execPath, args: [pnpmCli, ...args], cwd });
const server = resolve(root, 'apps/server');
const stages = [
  stage('generate', ['db:generate'], server),
  stage('build', ['build']),
  stage('unit', ['test']),
  stage('lint', ['lint', '--max-warnings', '0'], server),
  ...[1, 2, 3].map((round) => stage(`e2e-${round}`, ['test:e2e'], server)),
];
process.exitCode = runStages(stages);
```

**scripts/ci-runner.mjs**

```text
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
```

**scripts/ci-runner.d.mts**

```text
import type { SpawnSyncOptions } from 'node:child_process';
export interface Stage {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnSyncOptions['stdio'];
}
export function runStages(stages: Stage[], report?: (line: string) => void): number;
```

**apps/server/test/ci-runner.spec.ts**

```ts
import { runStages, type Stage } from '../../../scripts/ci-runner.mjs';

const node = (name: string, script: string): Stage => ({ name, command: process.execPath, args: ['-e', script], stdio: 'pipe' });
describe('门禁失败传播（D40）', () => {
  it('真实子进程成功时按序运行全部阶段', () => {
    const lines: string[] = [];
    expect(runStages([node('first', 'process.exit(0)'), node('last', 'process.exit(0)')], (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual(['[gate] start first', '[gate] passed first', '[gate] start last', '[gate] passed last']);
  });
  it('非零退出阻断后续阶段并保留退出码', () => {
    const lines: string[] = [];
    const code = runStages([node('broken', 'process.exit(7)'), node('must-not-run', 'process.exit(0)')], (line) => lines.push(line));
    expect(code).toBe(7);
    expect(lines.some((line) => line.includes('must-not-run'))).toBe(false);
  });
  it('命令不存在也必须阻断，不能把 null 当成功', () => {
    const lines: string[] = [];
    const code = runStages([{ name: 'missing', command: 'missing-ci-command-d40-never-exists', stdio: 'pipe' },
      node('must-not-run', 'process.exit(0)')], (line) => lines.push(line));
    expect(code).toBe(1);
    expect(lines.some((line) => line.includes('must-not-run'))).toBe(false);
  });
  it('工作目录错误只输出阶段类别，不输出错误中的路径', () => {
    const lines: string[] = [];
    expect(runStages([{ ...node('wrong-cwd', 'process.exit(0)'), cwd: 'missing-private-path-d40' }], (line) => lines.push(line))).toBe(1);
    expect(lines.join('\n')).not.toContain('missing-private-path-d40');
  });
});
```

**package.json**

```json
{
  "name": "ops-ticket",
  "private": true,
  "packageManager": "pnpm@10.28.0",
  "engines": {
    "node": ">=20.19"
  },
  "scripts": {
    "dev": "pnpm --filter @ops-ticket/shared build && pnpm --parallel --recursive dev",
    "build": "pnpm --recursive build",
    "test": "pnpm --recursive test",
    "db:up": "docker compose -f infra/docker-compose.yml up -d --wait",
    "db:down": "docker compose -f infra/docker-compose.yml down",
    "ci": "node scripts/ci.mjs"
  }
}
```

## 五、核心面试题

1. CI 子进程为什么要传播退出码？
2. 重试会掩盖哪些不稳定测试？
3. 如何保护测试资源？

结合本日业务样例回答后，再核对[配套面试题](D40-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

CI 执行器的正常、失败与终止用例通过。
