import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { evaluate } from './gate.js';

const profile = JSON.parse(readFileSync('test/evaluation/profile.json', 'utf8')) as Record<string, string>;
for (const [path, expected] of Object.entries(profile)) {
  const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error('评测基线需要重新核准 ' + path);
}
function check(path: string) {
  const report = evaluate(JSON.parse(readFileSync(path, 'utf8').trim()));
  console.log(JSON.stringify(report));
  if (process.env.EVAL_GATE_REPORT) writeFileSync(process.env.EVAL_GATE_REPORT, JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
const args = process.argv.slice(2);
if (args.length === 2 && args[0] === '--replay') {
  check(args[1]);
} else {
  if (args.length || !process.env.npm_execpath) throw new Error('请在 apps/server 运行 pnpm eval:gate');
  const folder = mkdtempSync(join(tmpdir(), 'ticket-evaluation-'));
  try {
    const path = join(folder, 'observations.jsonl');
    const run = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', 'vitest', 'run', '--config',
      'vitest.config.e2e.ts', 'test/evaluation/sandbox.e2e-spec.ts'], {
      stdio: 'inherit', env: { ...process.env, EVAL_OBSERVATIONS_FILE: path } });
    if (run.status !== 0) throw new Error('沙箱采集失败');
    check(path);
  } finally {
    if (dirname(resolve(folder)) === resolve(tmpdir())) rmSync(folder, { recursive: true, force: true });
  }
}
