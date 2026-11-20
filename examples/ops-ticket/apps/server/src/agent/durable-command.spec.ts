import { commandDigest, commandSchema, stillValid, approvalWindowMs } from './durable-command.js';

describe('持久命令契约', () => {
  it('同一意图生成稳定摘要并区分目标与版本', () => {
    const input = commandSchema.parse({ action: 'reassign', version: 3, reason: ' 夜班交接 ', assignee: 'bob' });
    const hash = (cmd: typeof input) => commandDigest('运行甲', 'T100', '甲', 'east', cmd);
    expect(hash(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(hash({ ...input, reason: '夜班交接' })).toBe(hash(input));
    expect(hash({ ...input, version: 4 })).not.toBe(hash(input));
    expect(hash({ action: 'restart', version: 3, service: 'diagnosis-preview', reason: '夜班交接' })).not.toBe(hash(input));
  });
  it('只允许登记的服务并在有效期边界停止', () => {
    const cmd = { action: 'restart', version: 0, service: 'diagnosis-preview', reason: '验证恢复' };
    expect(commandSchema.safeParse(cmd).success).toBe(true);
    expect(commandSchema.safeParse({ ...cmd, service: 'unregistered' }).success).toBe(false);
    expect(approvalWindowMs).toBe(86_400_000);
    expect(stillValid(new Date(100), new Date(99))).toBe(true);
    expect(stillValid(new Date(100), new Date(100))).toBe(false);
  });
});
