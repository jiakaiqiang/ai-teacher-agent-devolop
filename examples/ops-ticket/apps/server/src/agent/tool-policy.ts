import { abortable } from '../assistant/model-policy.js';
import { CallError, type Name } from './tool-catalog.js';

type Circuit = { failures: number; until: number; probe: boolean };
type Options = { timeoutMs: number; cooldownMs: number; threshold: number };
export const defaultOptions: Options = { timeoutMs: 2000, cooldownMs: 15000, threshold: 3 };
export class ToolPolicy {
  private readonly circuits = new Map<Name, Circuit>();
  constructor(private readonly options = defaultOptions, private readonly now = Date.now) {}

  async run<T>(name: Name, idempotent: boolean, parent: AbortSignal, work: (child: AbortSignal) => Promise<T>) {
    if (parent.aborted) throw new CallError('TOOL_CANCELLED');
    const state = this.circuits.get(name) ?? { failures: 0, until: 0, probe: false };
    this.circuits.set(name, state);
    const probe = state.until > 0;
    if (probe && (this.now() < state.until || state.probe)) throw new CallError('TOOL_CIRCUIT_OPEN');
    if (probe) state.probe = true;
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = AbortSignal.any([parent, timeout]);
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          signal.throwIfAborted();
          const value = await abortable(work(signal), signal);
          // 之前的慢请求不能把刚刚打开的熔断器提前关闭。
          if (probe || state.until === 0) { state.failures = 0; state.until = 0; }
          return { value, attempts: attempt };
        } catch (error) {
          if (parent.aborted) throw new CallError('TOOL_CANCELLED');
          if (timeout.aborted) throw new CallError('TOOL_TIMEOUT');
          if (!(error instanceof CallError && error.code === 'TOOL_TEMPORARY' && idempotent && !probe && attempt === 1)) throw error;
        }
      }
    } catch (error) {
      if (error instanceof CallError && ['TOOL_TEMPORARY', 'TOOL_TIMEOUT'].includes(error.code)) {
        state.failures++;
        if (probe || state.failures >= this.options.threshold) state.until = this.now() + this.options.cooldownMs;
      } else if (probe && error instanceof CallError && error.code !== 'TOOL_CANCELLED') {
        state.failures = 0; state.until = 0;
      }
      throw error;
    } finally {
      if (probe) state.probe = false;
    }
  }
}
