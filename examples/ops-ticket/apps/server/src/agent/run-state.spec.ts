import { assertTransition, canTransition, isTerminal, runStatuses, statusForReason, stopReasons,
  RunStateError, type RunStatus } from './run-state.js';

describe('Run 状态机', () => {
  it('终态不再接受任何转移', () => {
    const terminal: RunStatus[] = ['succeeded', 'failed', 'cancelled'];
    for (const status of terminal) {
      expect(isTerminal(status)).toBe(true);
      for (const to of runStatuses) expect(canTransition(status, to)).toBe(false);
    }
    expect(terminal.every(status => !canTransition(status, 'running'))).toBe(true);
  });

  it('只有 queued 能被认领，running 只能走向终态', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('queued', 'cancelled')).toBe(true);
    expect(canTransition('queued', 'succeeded')).toBe(false);
    expect(canTransition('running', 'queued')).toBe(false);
    expect(runStatuses.filter(to => canTransition('running', to))).toEqual(['succeeded', 'failed', 'cancelled']);
  });

  it('终态必须带匹配的停止原因，非终态不接受停止原因', () => {
    expect(() => assertTransition('running', 'succeeded', 'answered')).not.toThrow();
    expect(() => assertTransition('running', 'succeeded')).toThrow(RunStateError);
    expect(() => assertTransition('running', 'succeeded', 'step_limit')).toThrow('RUN_STOP_REASON_INVALID');
    expect(() => assertTransition('running', 'failed', 'answered')).toThrow('RUN_STOP_REASON_INVALID');
    expect(() => assertTransition('queued', 'running', 'answered')).toThrow('RUN_STOP_REASON_INVALID');
  });

  it('每个停止原因都能反推唯一终态', () => {
    expect(stopReasons.map(statusForReason)).toEqual(['succeeded', 'failed', 'failed', 'failed',
      'failed', 'failed', 'cancelled']);
    expect(() => statusForReason('unknown' as never)).toThrow('RUN_STOP_REASON_INVALID');
    // 预算类停止都落在 failed：成功只有“模型给出了答案”一种。
    expect(stopReasons.filter(reason => statusForReason(reason) === 'succeeded')).toEqual(['answered']);
  });
});
