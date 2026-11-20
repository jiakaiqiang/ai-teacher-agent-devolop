import { appendFileSync } from 'node:fs';
import { mockStream } from './mock-stream.js';
import { parseChatStream } from './chat.stream.js';

describe('分段模拟源（D48）', () => {
  afterEach(() => vi.useRealTimers());
  it('分段输出且完整终止', async () => {
    vi.useFakeTimers(); const events: object[] = [];
    const task = (async () => { for await (const event of parseChatStream(mockStream(new AbortController().signal))) events.push(event); })();
    await vi.runAllTimersAsync(); await task;
    expect(events).toHaveLength(5); expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
    expect(vi.getTimerCount()).toBe(0);
    if (process.env.D48_EVIDENCE_FILE) appendFileSync(process.env.D48_EVIDENCE_FILE, JSON.stringify({ case: 'paced-mock', events: events.length, timersAfter: vi.getTimerCount() }) + '\n');
  });
  it('请求取消立即清计时器并拒绝挂起读取', async () => {
    vi.useFakeTimers(); const abort = new AbortController(); const reader = mockStream(abort.signal).getReader();
    const read = reader.read(); const rejection = expect(read).rejects.toThrow('模拟取消');
    await Promise.resolve(); expect(vi.getTimerCount()).toBe(1); abort.abort(new Error('模拟取消'));
    expect(vi.getTimerCount()).toBe(0); await rejection; reader.releaseLock();
  });
  it('reader取消清计时器且后续read结束', async () => {
    vi.useFakeTimers(); const reader = mockStream(new AbortController().signal).getReader();
    const read = reader.read(); await Promise.resolve(); await reader.cancel();
    expect(await read).toEqual({ value: undefined, done: true }); expect(vi.getTimerCount()).toBe(0); reader.releaseLock();
  });
  it('已取消的signal不创建计时器', async () => {
    vi.useFakeTimers(); const abort = new AbortController(); abort.abort(new Error('提前取消'));
    const reader = mockStream(abort.signal).getReader(); await expect(reader.read()).rejects.toThrow('提前取消');
    expect(vi.getTimerCount()).toBe(0); reader.releaseLock();
  });
});
