import { createHash } from 'node:crypto';
import { auditArtifacts } from './artifact-audit.js';

const body = Buffer.from('reference');
const item = { id: 'code', root: 'verify', path: 'scripts/check.mjs',
  sha256: createHash('sha256').update(body).digest('hex'), scope: 'reference-code' };

describe('作品证据完整性', () => {
  it('绑定具体文件版本而不输出正文', () => {
    const report = auditArtifacts([item], () => body);
    expect(report[0]).toEqual({ ...item, bytes: 9 });
    expect(JSON.stringify(report)).not.toContain('reference"');
  });
  it('改过一个字节也会拒绝旧摘要', () => {
    expect(() => auditArtifacts([item], () => Buffer.from('Reference'))).toThrow('ARTIFACT_CHANGED:code');
  });
  it('路径越界与环境文件在读取前拒绝', () => {
    for (const path of ['../secret', 'apps/server/.env', 'D:/secret.json', 'scripts/../secret.json']) {
      const read = vi.fn();
      expect(() => auditArtifacts([{ ...item, path }], read)).toThrow('UNSAFE_PATH');
      expect(read).not.toHaveBeenCalled();
    }
  });
  it('重复ID和超大内容拒绝', () => {
    expect(() => auditArtifacts([item, item], () => body)).toThrow('DUPLICATE_ID');
    expect(() => auditArtifacts([item], () => new Uint8Array(4_000_001))).toThrow('ARTIFACT_TOO_LARGE');
  });
  it('本机证据不能换标生产', () => {
    expect(() => auditArtifacts([{ ...item, scope: 'production' }], () => body)).toThrow();
  });
});
