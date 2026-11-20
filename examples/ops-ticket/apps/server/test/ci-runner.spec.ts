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
