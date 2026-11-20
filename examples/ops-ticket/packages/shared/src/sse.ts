export interface SseFrame { event: string; data: string; }
export class SseError extends Error {
  constructor(message: 'SSE_FRAME_LIMIT' | 'SSE_TOTAL_LIMIT' | 'SSE_INVALID_UTF8') { super(message); }
}

// 本项目只消费event/data；id/retry不实现重连语义，未知字段按协议忽略。
export class SseParser {
  private line = '';
  private data: string[] = [];
  private event = '';
  private skipLf = false;
  private first = true;
  private frameChars = 0;
  constructor(private readonly maxFrameChars = 64 * 1024) {}

  push(text: string): SseFrame[] {
    const frames: SseFrame[] = [];
    for (const char of text) {
      if (this.first) { this.first = false; if (char === '\uFEFF') continue; }
      if (this.skipLf) { this.skipLf = false; if (char === '\n') continue; }
      if (char === '\r' || char === '\n') {
        const line = this.line; this.line = '';
        if (line === '') {
          if (this.data.length) frames.push({ event: this.event || 'message', data: this.data.join('\n') });
          this.data = []; this.event = ''; this.frameChars = 0;
        } else {
          if (++this.frameChars > this.maxFrameChars) throw new SseError('SSE_FRAME_LIMIT');
          if (!line.startsWith(':')) {
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            let value = colon === -1 ? '' : line.slice(colon + 1);
            if (value.startsWith(' ')) value = value.slice(1);
            if (field === 'data') this.data.push(value);
            else if (field === 'event') this.event = value;
          }
        }
        this.skipLf = char === '\r';
      } else {
        this.frameChars += char.length; // UTF-16代码单元预算，不冒充token或字节。
        if (this.frameChars > this.maxFrameChars) throw new SseError('SSE_FRAME_LIMIT');
        this.line += char;
      }
    }
    return frames;
  }
  // EOF不补空行：丢弃未完整结束的事件，由业务层判断是否收到终止事件。
  finish(): void { this.line = ''; this.data = []; this.event = ''; this.frameChars = 0; }
}

export async function* readSse(
  body: ReadableStream<Uint8Array>, options: { maxFrameChars?: number; maxBytes?: number; signal?: AbortSignal } = {},
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  // 保留BOM交给parser只跳过一次，避免两层各吞一个BOM。
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const parser = new SseParser(options.maxFrameChars);
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const decode = (chunk?: Uint8Array, stream = false): string => {
    try { return decoder.decode(chunk, { stream }); }
    catch { throw new SseError('SSE_INVALID_UTF8'); }
  };
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const { value, done } = await reader.read();
      options.signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > (options.maxBytes ?? 2 * 1024 * 1024)) throw new SseError('SSE_TOTAL_LIMIT');
      yield* parser.push(decode(value, true));
    }
    yield* parser.push(decode());
    parser.finish();
  } finally { options.signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
