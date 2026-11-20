// 分段演示源：每次消费前等待，取消时清除计时器，不访问外部模型。
export function mockStream(signal: AbortSignal, delayMs = 350): ReadableStream<Uint8Array> {
  const pieces = ['这是模拟排查建议。', '\n1. 核对报障时间和日志中的超时记录。', '\n2. 对比近期变更与监控曲线。', '\n3. 记录证据后由人工决定下一步。'];
  const frames = pieces.map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
  frames.push('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  let index = 0; let ended = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (() => void) | undefined; let abort: () => void = () => {};
  const cleanup = () => { ended = true; clearTimeout(timer); signal.removeEventListener('abort', abort); settle?.(); settle = undefined; };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => { if (ended) return; cleanup(); controller.error(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    pull(controller) {
      if (ended) return;
      return new Promise<void>((resolve) => {
        settle = resolve;
        timer = setTimeout(() => {
          if (!ended) {
            controller.enqueue(new TextEncoder().encode(frames[index++]!));
            if (index === frames.length) { cleanup(); controller.close(); }
          }
          settle = undefined; resolve();
        }, delayMs);
      });
    },
    cancel() { cleanup(); },
  });
}
