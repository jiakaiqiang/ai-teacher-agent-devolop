import { appendFileSync } from 'node:fs';
import { readSse, SseParser, type SseFrame } from '@ops-ticket/shared';

const bytes = (text: string) => new TextEncoder().encode(text);
function stream(chunks: Uint8Array[], cancel?: () => void) {
  let index = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close();
  }, cancel });
}
async function collect(chunks: Uint8Array[], options?: { maxFrameChars?: number; maxBytes?: number }) {
  const result: SseFrame[] = [];
  for await (const event of readSse(stream(chunks), options)) result.push(event);
  return result;
}
const report = (data: object) => {
  if (process.env.D44_EVIDENCE_FILE) appendFileSync(process.env.D44_EVIDENCE_FILE, JSON.stringify(data) + '\n');
};
describe('SSE增量解析（D44）', () => {
  it('所有双块切分位置都保留中文和CRLF事件', async () => {
    const input = bytes('\uFEFF:心跳\r\nevent: delta\r\ndata: 中文🙂\r\ndata: 第二行\r\n\r\ndata: tail\n\n');
    const expected = [{ event: 'delta', data: '中文🙂\n第二行' }, { event: 'message', data: 'tail' }];
    for (let cut = 0; cut <= input.length; cut++) expect(await collect([input.slice(0, cut), input.slice(cut)])).toEqual(expected);
    report({ case: 'all-byte-splits', splitPositions: input.length + 1, frames: expected });
  });
  it('每次一个字节也能解码中文', async () => {
    const input = bytes('data: 中🙂\n\n');
    expect(await collect([...input].map((byte) => Uint8Array.of(byte)))).toEqual([{ event: 'message', data: '中🙂' }]);
  });
  it('只忽略流开头一个BOM', async () => {
    expect(await collect([bytes('\uFEFF\uFEFFdata: ignored\n\ndata: kept\n\n')])).toEqual([{ event: 'message', data: 'kept' }]);
  });
  it('多个data行必须保留换行', () => {
    expect(new SseParser().push('data: first\ndata: second\n\n')).toEqual([{ event: 'message', data: 'first\nsecond' }]);
  });
  it('单CR和CRLF跨块不会重复分派', () => {
    const parser = new SseParser();
    expect(parser.push('data: a\r')).toEqual([]);
    expect(parser.push('\n\r')).toEqual([{ event: 'message', data: 'a' }]);
    expect(parser.push('\ndata: b\r\r')).toEqual([{ event: 'message', data: 'b' }]);
  });
  it('EOF不会分派缺少空行的半帧', async () => {
    expect(await collect([bytes('data: kept\n\ndata: lost\n')])).toEqual([{ event: 'message', data: 'kept' }]);
    report({ case: 'partial-eof', dispatched: ['kept'], discarded: 'lost' });
  });
  it('注释未知字段无data不分派，event不会泄漏到下个事件', () => {
    expect(new SseParser().push(':keepalive\nevent: custom\nid: ignored\nretry: 1\n\ndata: next\n\n')).toEqual([{ event: 'message', data: 'next' }]);
  });
  it('空data也分派，只移除冒号后一个空格', () => {
    expect(new SseParser().push('data\n\ndata:  x:y\n\n')).toEqual([{ event: 'message', data: '' }, { event: 'message', data: ' x:y' }]);
  });
  it('一个块可含多事件，不把网络块当事件', async () => {
    expect(await collect([bytes('data: a\n\ndata: b\n\n')])).toHaveLength(2);
  });
  it('单行和累计多行都受帧上限限制', () => {
    expect(() => new SseParser(8).push('data: 123')).toThrow('SSE_FRAME_LIMIT');
    expect(() => new SseParser(20).push('data: a\ndata: b\ndata: c\n')).toThrow('SSE_FRAME_LIMIT');
  });
  it('总字节限制包含注释与已分派事件', async () => {
    await expect(collect([bytes(':a\n\n'), bytes(':a\n\n')], { maxBytes: 7 })).rejects.toThrow('SSE_TOTAL_LIMIT');
  });
  it('非法UTF8以及EOF半字符拒绝', async () => {
    await expect(collect([Uint8Array.of(255)])).rejects.toThrow('SSE_INVALID_UTF8');
    await expect(collect([Uint8Array.of(0xe4, 0xb8)])).rejects.toThrow('SSE_INVALID_UTF8');
  });
  it('消费方提前退出会取消reader并释放锁', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes('data: first\n\n')); }, cancel() { cancelled = true; } });
    for await (const frame of readSse(body)) { expect(frame.data).toBe('first'); break; }
    expect(cancelled).toBe(true); expect(body.locked).toBe(false);
    report({ case: 'reader-cleanup', cancelled, locked: body.locked });
  });
});
