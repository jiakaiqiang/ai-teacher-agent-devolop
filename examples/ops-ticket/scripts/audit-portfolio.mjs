import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditArtifacts } from '../apps/server/dist/retrieval/artifact-audit.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.argv[2], '传入教程工作目录');
const roots = { verify: realpathSync(root), lesson: realpathSync(process.argv[2]) };
const entries = JSON.parse(readFileSync(resolve(root, 'scripts/portfolio-manifest.json'), 'utf8'));
const report = auditArtifacts(entries, entry => {
  const base = roots[entry.root];
  const target = realpathSync(resolve(base, entry.path));
  const rel = relative(base, target);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), '拒绝符号链接越界');
  return readFileSync(target);
});
console.log(JSON.stringify({ artifacts: report, integrityOnly: true, userMasteryVerified: false }));
