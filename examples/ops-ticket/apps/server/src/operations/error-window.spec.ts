import { appendFileSync } from 'node:fs';
import { evaluateErrorWindow, PRACTICE_POLICY, type CounterSample, type WindowState } from './error-window.js';

const point = (atMs: number, requests: number, errors: number, epoch = 'process-a'): CounterSample => ({ atMs, requests, errors, epoch });
const first = () => evaluateErrorWindow(null, point(0, 0, 0));
const report = (data: object) => {
  if (process.env.D42_EVIDENCE_FILE) appendFileSync(process.env.D42_EVIDENCE_FILE, JSON.stringify(data) + '\n');
};
describe('错误率窗口变式（D42）', () => {
  it('首个样本只建立基线', () => {
    expect(evaluateErrorWindow(null, point(0, 1000, 10))).toMatchObject({ status: 'warming', ratio: null, consecutive: 0 });
  });
  it('使用窗口增量，不能被历史成功稀释', () => {
    const initial = evaluateErrorWindow(null, point(0, 10_000, 0));
    const state = evaluateErrorWindow(initial, point(60_000, 10_100, 10));
    expect(state).toMatchObject({ status: 'pending', requests: 100, errors: 10, ratio: 0.1 });
    report({ case: 'window-delta', status: state.status, requests: state.requests, errors: state.errors, ratio: state.ratio });
  });
  it('恰好等于 5% 不算超过阈值', () => {
    expect(evaluateErrorWindow(first(), point(60_000, 20, 1))).toMatchObject({ status: 'ok', ratio: 0.05, consecutive: 0 });
  });
  it('三个连续有效坏窗口才触发，计数封顶', () => {
    let state = first(); const statuses: string[] = [];
    for (let index = 1; index <= 4; index++) {
      state = evaluateErrorWindow(state, point(index * 60_000, index * 20, index * 2)); statuses.push(state.status);
    }
    expect(statuses).toEqual(['pending', 'pending', 'firing', 'firing']);
    expect(state.consecutive).toBe(3);
    report({ case: 'consecutive-windows', statuses, consecutive: state.consecutive });
  });
  it('一个健康窗口打断连续异常', () => {
    const bad = evaluateErrorWindow(first(), point(60_000, 20, 2));
    const good = evaluateErrorWindow(bad, point(120_000, 40, 2));
    const again = evaluateErrorWindow(good, point(180_000, 60, 4));
    expect(good.status).toBe('ok'); expect(again.consecutive).toBe(1);
  });
  it('低样本窗口必须清零连续计数', () => {
    let state = evaluateErrorWindow(first(), point(60_000, 20, 2));
    state = evaluateErrorWindow(state, point(120_000, 40, 4));
    state = evaluateErrorWindow(state, point(180_000, 41, 5));
    expect(state).toMatchObject({ status: 'insufficient', ratio: null });
    state = evaluateErrorWindow(state, point(240_000, 61, 7));
    expect(state.status).toBe('pending'); expect(state.consecutive).toBe(1);
    report({ case: 'low-traffic-break', status: state.status, consecutive: state.consecutive });
  });
  it('新进程计数更大也必须重新建立基线', () => {
    const state = evaluateErrorWindow(first(), point(60_000, 100, 10, 'process-b'));
    expect(state).toMatchObject({ status: 'warming', reason: 'epoch-changed', consecutive: 0 });
  });
  it('同进程计数下降按重置处理', () => {
    const initial = evaluateErrorWindow(null, point(0, 100, 10));
    expect(evaluateErrorWindow(initial, point(60_000, 5, 1))).toMatchObject({ status: 'warming', reason: 'counter-reset' });
  });
  it('超长间隔重新预热，乱序和重复时间视为未知', () => {
    expect(evaluateErrorWindow(first(), point(120_001, 20, 2)).reason).toBe('gap-too-long');
    const initial = evaluateErrorWindow(null, point(10, 0, 0));
    for (const time of [9, 10]) expect(evaluateErrorWindow(initial, point(time, 20, 2))).toMatchObject({ status: 'unknown', previous: null });
  });
  it('不可信数值与不一致增量不能算成健康', () => {
    for (const sample of [point(1, NaN, 0), point(1, -1, 0), point(1, 1, 2), point(1, 0.5, 0), point(1, 1, 0, '')]) {
      expect(evaluateErrorWindow(first(), sample).status).toBe('unknown');
    }
    const initial = evaluateErrorWindow(null, point(0, 100, 0));
    expect(evaluateErrorWindow(initial, point(60_000, 101, 2)).reason).toBe('inconsistent-delta');
    expect(() => evaluateErrorWindow(null, null, { ...PRACTICE_POLICY, minRequests: 0 })).toThrow('INVALID_WINDOW_POLICY');
  });
  it('零请求是样本不足，缺测打断后从预热重新开始', () => {
    expect(evaluateErrorWindow(first(), point(60_000, 0, 0))).toMatchObject({ status: 'insufficient', ratio: null });
    const missing = evaluateErrorWindow(first(), null);
    expect(missing).toMatchObject({ status: 'unknown', reason: 'missing-sample', previous: null });
    expect(evaluateErrorWindow(missing, point(120_000, 20, 2)).status).toBe('warming');
    report({ case: 'missing-window', status: missing.status, reason: missing.reason });
  });
  it('不修改旧状态或样本，外部修改样本不改变已保存基线', () => {
    const sample = point(0, 0, 0); const state = evaluateErrorWindow(null, sample);
    const before = JSON.stringify(state);
    evaluateErrorWindow(Object.freeze(state) as WindowState, Object.freeze(point(60_000, 20, 2)));
    expect(JSON.stringify(state)).toBe(before);
    Object.assign(sample, { requests: 999 });
    expect(state.previous?.requests).toBe(0);
  });
});
