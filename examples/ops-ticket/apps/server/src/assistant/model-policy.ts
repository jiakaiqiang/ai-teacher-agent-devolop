// 仅用于无副作用的非流式模型生成；计费仍可能发生，不能保证远端取消。
export type GatewayCode = 'MODEL_BUSY' | 'MODEL_UNAVAILABLE' | 'MODEL_TIMEOUT' | 'MODEL_CANCELLED' | 'MODEL_CONFIG_ERROR' | 'MODEL_REQUEST_ERROR' | 'MODEL_PROTOCOL_ERROR' | 'MODEL_CIRCUIT_OPEN' | 'MODEL_REFUSED' | 'MODEL_TRUNCATED' | 'MODEL_INVALID_OUTPUT';
export class GatewayFailure extends Error {
  constructor(readonly code: GatewayCode, readonly retryable = false) { super(code); }
}
export function statusFailure(status: number): GatewayFailure {
  if (status === 429) return new GatewayFailure('MODEL_BUSY', true);
  if (status === 408 || status === 524) return new GatewayFailure('MODEL_TIMEOUT', true);
  if (status >= 500) return new GatewayFailure('MODEL_UNAVAILABLE', true);
  return new GatewayFailure(status === 401 || status === 403 ? 'MODEL_CONFIG_ERROR' : 'MODEL_REQUEST_ERROR');
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) { work.catch(() => {}); reject(signal.reason); return; }
    signal.addEventListener('abort', aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function delay(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await abortable(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}

export class ModelPolicy {
  private failures = 0;
  private openedAt: number | null = null;
  private probe = false;
  private epoch = 0;
  constructor(private readonly now = () => Date.now(), private readonly random = () => Math.random()) {}
  async run<T>(work: (signal: AbortSignal, attempt: number) => Promise<T>, parent?: AbortSignal, budgetMs = 5000): Promise<T> {
    if (parent?.aborted) throw new GatewayFailure('MODEL_CANCELLED');
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 5000) throw new GatewayFailure('MODEL_TIMEOUT');
    if (this.openedAt !== null && (this.now() - this.openedAt < 30000 || this.probe)) throw new GatewayFailure('MODEL_CIRCUIT_OPEN');
    const halfOpen = this.openedAt !== null;
    if (halfOpen) this.probe = true;
    const epoch = this.epoch;
    const controller = new AbortController();
    const cancel = () => controller.abort(new GatewayFailure('MODEL_CANCELLED'));
    parent?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new GatewayFailure('MODEL_TIMEOUT', true)), budgetMs);
    try {
      for (let attempt = 1; ; attempt++) {
        controller.signal.throwIfAborted();
        try {
          const value = await abortable(Promise.resolve().then(() => work(controller.signal, attempt)), controller.signal);
          if (epoch === this.epoch) { this.failures = 0; this.openedAt = null; }
          return value;
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          if (!(error instanceof GatewayFailure) || !error.retryable || attempt >= 2 || halfOpen) throw error;
          await delay(100 + Math.floor(this.random() * 100), controller.signal);
        }
      }
    } catch (error) {
      if (epoch === this.epoch && error instanceof GatewayFailure && error.retryable) {
        this.failures++;
        if (halfOpen || this.failures >= 3) { this.openedAt = this.now(); this.epoch++; }
      }
      throw error;
    } finally {
      clearTimeout(timer); parent?.removeEventListener('abort', cancel);
      if (halfOpen) this.probe = false;
    }
  }
}
