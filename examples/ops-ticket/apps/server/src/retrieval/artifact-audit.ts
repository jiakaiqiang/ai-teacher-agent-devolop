import { createHash } from 'node:crypto';
import { z } from 'zod';

const artifact = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,48}$/),
  root: z.enum(['verify', 'lesson']),
  path: z.string().min(1).max(240),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.enum(['reference-code', 'local-fixture', 'local-model', 'offline-eval']),
}).strict();
const manifest = z.array(artifact).min(1).max(32);
export type Artifact = z.infer<typeof artifact>;

function allowed(item: Artifact) {
  const parts = item.path.split('/');
  if (item.path.includes('\\') || item.path.includes(':') ||
      parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.env'))) return false;
  if (item.root === 'lesson' && /^\.cache\/验证\/新版验收\/D[\w\u4e00-\u9fff-]+\.(log|json)$/.test(item.path)) return true;
  if (item.root === 'lesson') return /^\.cache\/验证\/D\d+\/[\w-]+\.(log|json)$/.test(item.path);
  return /^(apps|packages|infra|scripts)\//.test(item.path) && /\.(ts|json|mjs|yml|conf)$/.test(item.path);
}

// 先完整检查路径，再读内容；只输出摘要，不暴露证据正文。
export function auditArtifacts(input: unknown, read: (item: Artifact) => Uint8Array) {
  const entries = manifest.parse(input);
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('DUPLICATE_ID');
  if (!entries.every(allowed)) throw new Error('UNSAFE_PATH');
  return entries.map(entry => {
    const bytes = read(entry);
    if (bytes.byteLength > 4_000_000) throw new Error('ARTIFACT_TOO_LARGE');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256) throw new Error('ARTIFACT_CHANGED:' + entry.id);
    return { ...entry, bytes: bytes.byteLength };
  });
}
