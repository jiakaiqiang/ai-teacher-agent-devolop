import { CallError } from './tool-catalog.js';
import { ToolPolicy } from './tool-policy.js';
describe('受限的工具执行', () => {
  const signal = new AbortController().signal;
  it('只有幂等调用遇到暂时错误才补一次', async () => {
    const policy = new ToolPolicy();
    const work = vi.fn().mockRejectedValueOnce(new CallError('TOOL_TEMPORARY')).mockResolvedValue('恢复');
    expect(await policy.run('ticket_summary', true, signal, work)).toEqual({ value: '恢复', attempts: 2 });
    const write = vi.fn().mockRejectedValue(new CallError('TOOL_TEMPORARY'));
    await expect(policy.run('save_private_note', false, signal, write)).rejects.toThrow('TOOL_TEMPORARY');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('下游不响应也会按时退出并熔断，冷却后允许探测', async () => {
    let now = 100;
    const policy = new ToolPolicy({ timeoutMs: 20, cooldownMs: 100, threshold: 1 }, () => now);
    await expect(policy.run('ticket_progress', true, signal, () => new Promise(() => {}))).rejects.toThrow('TOOL_TIMEOUT');
    const next = vi.fn().mockResolvedValue('正常');
    await expect(policy.run('ticket_progress', true, signal, next)).rejects.toThrow('TOOL_CIRCUIT_OPEN');
    expect(next).not.toHaveBeenCalled();
    now += 101;
    expect((await policy.run('ticket_progress', true, signal, next)).value).toBe('正常');
  });
});
