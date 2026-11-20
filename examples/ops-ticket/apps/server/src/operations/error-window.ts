// D42 变式：只评估输入样本，不抓取网络、不发通知、不自动改业务状态。
export interface CounterSample {
  readonly epoch: string; // 同一进程生命周期标识，重启后必须变化
  readonly atMs: number;
  readonly requests: number; // 同一固定范围内已完成的普通 HTTP
  readonly errors: number; // 其中的 5xx；不包含 aborted
}
export interface WindowPolicy {
  readonly minRequests: number;
  readonly maxErrorRatio: number;
  readonly requiredWindows: number;
  readonly maxGapMs: number;
}
export interface WindowState {
  readonly previous: CounterSample | null;
  readonly consecutive: number;
  readonly status: 'warming' | 'unknown' | 'insufficient' | 'ok' | 'pending' | 'firing';
  readonly reason: string;
  readonly requests: number | null;
  readonly errors: number | null;
  readonly ratio: number | null;
}
export const PRACTICE_POLICY: WindowPolicy = {
  minRequests: 20, maxErrorRatio: 0.05, requiredWindows: 3, maxGapMs: 120_000,
};
const natural = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function evaluateErrorWindow(
  state: WindowState | null, sample: CounterSample | null, policy: WindowPolicy = PRACTICE_POLICY,
): WindowState {
  if (!natural(policy.minRequests) || policy.minRequests < 1 || !natural(policy.requiredWindows) || policy.requiredWindows < 1
    || !natural(policy.maxGapMs) || policy.maxGapMs < 1 || !Number.isFinite(policy.maxErrorRatio)
    || policy.maxErrorRatio < 0 || policy.maxErrorRatio > 1) throw new Error('INVALID_WINDOW_POLICY');
  const reset = (status: WindowState['status'], reason: string, previous: CounterSample | null): WindowState => ({
    previous: previous ? { ...previous } : null, consecutive: 0, status, reason, requests: null, errors: null, ratio: null,
  });
  if (!sample) return reset('unknown', 'missing-sample', null);
  if (!sample.epoch || !natural(sample.atMs) || !natural(sample.requests) || !natural(sample.errors)
    || sample.errors > sample.requests) return reset('unknown', 'invalid-sample', null);
  const previous = state?.previous;
  if (!previous) return reset('warming', 'first-sample', sample);
  if (sample.atMs <= previous.atMs) return reset('unknown', 'out-of-order', null);
  if (sample.epoch !== previous.epoch) return reset('warming', 'epoch-changed', sample);
  if (sample.atMs - previous.atMs > policy.maxGapMs) return reset('warming', 'gap-too-long', sample);
  if (sample.requests < previous.requests || sample.errors < previous.errors) return reset('warming', 'counter-reset', sample);
  const requests = sample.requests - previous.requests;
  const errors = sample.errors - previous.errors;
  if (errors > requests) return reset('unknown', 'inconsistent-delta', null);
  const measured = { previous: { ...sample }, requests, errors };
  // 没有足够样本时打断连续性，既不是健康，也不能跨空窗凑连续异常。
  if (requests < policy.minRequests) return { ...measured, consecutive: 0, status: 'insufficient', reason: 'low-traffic', ratio: null };
  const ratio = errors / requests;
  if (ratio <= policy.maxErrorRatio) return { ...measured, ratio, consecutive: 0, status: 'ok', reason: 'within-threshold' };
  const consecutive = Math.min((state?.consecutive ?? 0) + 1, policy.requiredWindows);
  return { ...measured, ratio, consecutive, status: consecutive >= policy.requiredWindows ? 'firing' : 'pending', reason: 'over-threshold' };
}
