import { boundedProbe } from './bounded-probe.js';

describe('探针等待期限', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('成功后清理计时器', async () => {
    vi.useFakeTimers();
    await boundedProbe(() => Promise.resolve(), 700);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('保留驱动错误并清理计时器', async () => {
    vi.useFakeTimers();
    const error = new Error('simulated-driver-error');
    await expect(boundedProbe(() => Promise.reject(error), 700)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('到期返回失败，迟到的拒绝仍有接收者', async () => {
    vi.useFakeTimers();
    let rejectLate!: (reason: Error) => void;
    const work = new Promise<void>((_, reject) => { rejectLate = reject; });
    const assertion = expect(boundedProbe(() => work, 700)).rejects.toThrow('PROBE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(700);
    await assertion;
    rejectLate(new Error('late-error'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
