export type Outcome = 'completed' | 'failed' | 'cancelled';
export type LatencySample = Readonly<{
  outcome: Outcome; firstTextMs: number | null; totalMs: number; codePoints: number;
}>;

// 一个请求一个实例；只保留数字，不记录业务正文。
export class LatencyTrace {
  private readonly started: number;
  private last: number;
  private first: number | null = null;
  private codePoints = 0;
  private result?: LatencySample;

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.started = clock();
    if (!Number.isFinite(this.started)) throw new Error('BAD_CLOCK');
    this.last = this.started;
  }

  private elapsed() {
    const now = this.clock();
    if (!Number.isFinite(now) || now < this.last) throw new Error('BAD_CLOCK');
    this.last = now;
    return now - this.started;
  }

  observe(kind: 'meta' | 'text', text = '') {
    if (this.result) return;
    const elapsed = this.elapsed();
    if (kind !== 'text' || text.length === 0) return;
    if (this.first === null) this.first = elapsed;
    this.codePoints += Array.from(text).length;
  }

  finish(outcome: Outcome): LatencySample {
    if (this.result) return this.result;
    this.result = Object.freeze({
      outcome, firstTextMs: this.first, totalMs: this.elapsed(), codePoints: this.codePoints,
    });
    return this.result;
  }
}

export function p95(values: readonly number[]): number | null {
  if (values.some(n => !Number.isFinite(n) || n < 0)) throw new Error('BAD_DURATION');
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
}

// 本章只聚合已结算样本；主动取消不属于故障分母。
export function summarizeLatency(samples: readonly LatencySample[]) {
  const completed = samples.filter(s => s.outcome === 'completed');
  const failed = samples.filter(s => s.outcome === 'failed').length;
  const cancelled = samples.filter(s => s.outcome === 'cancelled').length;
  const eligible = completed.length + failed;
  return {
    settled: samples.length, completed: completed.length, failed, cancelled,
    failureRate: eligible ? failed / eligible : null,
    completedTotalP95Ms: p95(completed.map(s => s.totalMs)),
    completedFirstTextP95Ms: p95(completed.flatMap(s => s.firstTextMs === null ? [] : [s.firstTextMs])),
    completedWithText: completed.filter(s => s.firstTextMs !== null).length,
  };
}
