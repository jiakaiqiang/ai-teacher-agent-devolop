import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { AssistantStreams, StreamLease } from './stream-lifecycle.js';
function response() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { write: vi.fn(() => true), destroyed: false, writableFinished: false }) as unknown as Response;
}
describe('助手流生命周期（D46）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('总期限不被进展延长', async () => {
    const lease = new StreamLease(response(), { totalMs: 100, idleMs: 60 }, () => {});
    for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(30); lease.touch(); }
    await vi.advanceTimersByTimeAsync(11); expect(lease.signal.aborted).toBe(true); lease.dispose();
  });
  it('空闲期限在进展后重新计时', async () => {
    const lease = new StreamLease(response(), { totalMs: 1000, idleMs: 50 }, () => {});
    await vi.advanceTimersByTimeAsync(40); lease.touch(); await vi.advanceTimersByTimeAsync(40); expect(lease.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(11); expect(lease.signal.reason.code).toBe('MODEL_TIMEOUT'); lease.dispose();
  });
  it('close取消未完成响应，正常finish不误取消', () => {
    const res = response(); const lease = new StreamLease(res, { totalMs: 1000, idleMs: 50 }, () => {});
    res.emit('close'); expect(lease.signal.reason.code).toBe('MODEL_CANCELLED'); lease.dispose();
    const normal = response(); Object.assign(normal, { writableFinished: true });
    const other = new StreamLease(normal, { totalMs: 1000, idleMs: 50 }, () => {});
    normal.emit('close'); expect(other.signal.aborted).toBe(false); other.dispose();
  });
  it('write返回false等待drain才继续', async () => {
    const res = response(); vi.spyOn(res, 'write').mockReturnValue(false);
    const lease = new StreamLease(res, { totalMs: 1000, idleMs: 50 }, () => {});
    let finished = false; const task = lease.send({ type: 'delta', text: 'a' }).then(() => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false); res.emit('drain'); await task; expect(finished).toBe(true); lease.dispose();
  });
  it('背压等待也受取消影响且清理监听', async () => {
    const res = response(); vi.spyOn(res, 'write').mockReturnValue(false);
    const lease = new StreamLease(res, { totalMs: 1000, idleMs: 50 }, () => {});
    const task = lease.send({ type: 'delta', text: 'a' }); lease.cancel('MODEL_CANCELLED');
    await expect(task).rejects.toMatchObject({ code: 'MODEL_CANCELLED' }); expect(res.listenerCount('drain')).toBe(0); lease.dispose();
  });
  it('dispose幂等释放计时器和注册', () => {
    const res = response(); const release = vi.fn(); const lease = new StreamLease(res, { totalMs: 1000, idleMs: 50 }, release);
    lease.dispose(); lease.dispose(); expect(release).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); expect(res.listenerCount('close')).toBe(0);
  });
  it('关闭取消所有活跃流并拒绝新建', () => {
    const registry = new AssistantStreams(); const a = registry.open(response()); const b = registry.open(response());
    expect(registry.activeCount).toBe(2); registry.beginShutdown(); expect(a.signal.aborted && b.signal.aborted).toBe(true);
    expect(() => registry.open(response())).toThrow('MODEL_CANCELLED'); a.dispose(); b.dispose(); expect(registry.activeCount).toBe(0);
  });
});
