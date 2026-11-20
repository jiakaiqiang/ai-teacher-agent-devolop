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
  stage('workflow-gate', ['exec','tsx','test/evaluation/workflow-gate.ts','test/evaluation/workflow-recording.json'],server),
  stage('lint', ['lint', '--max-warnings', '0'], server),
  ...[1, 2, 3].map((round) => stage(`e2e-${round}`, ['test:e2e'], server)),
];
process.exitCode = runStages(stages);
