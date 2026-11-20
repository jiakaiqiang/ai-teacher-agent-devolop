// Run 的状态机与停止原因：纯函数，不依赖数据库，便于单测与推理。
export const runStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof runStatuses)[number];
export const stopReasons = ['answered', 'step_limit', 'time_limit', 'token_limit', 'tool_failed',
  'model_failed', 'user_cancelled'] as const;
export type StopReason = (typeof stopReasons)[number];

// 只写允许的边：queued 可被认领或取消，running 只能走向终态。
const allowed: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};
const reasonFor: Record<Exclude<RunStatus, 'queued' | 'running'>, readonly StopReason[]> = {
  succeeded: ['answered'],
  failed: ['step_limit', 'time_limit', 'token_limit', 'tool_failed', 'model_failed'],
  cancelled: ['user_cancelled'],
};

export class RunStateError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function isTerminal(status: RunStatus) {
  return allowed[status].length === 0;
}

export function canTransition(from: RunStatus, to: RunStatus) {
  return allowed[from].includes(to);
}

// 终态必须带一个与之匹配的停止原因；非终态不接受停止原因。
export function assertTransition(from: RunStatus, to: RunStatus, reason?: StopReason) {
  if (!canTransition(from, to)) throw new RunStateError('RUN_STATE_INVALID');
  if (isTerminal(to)) {
    const expected = reasonFor[to as keyof typeof reasonFor];
    if (!reason || !expected.includes(reason)) throw new RunStateError('RUN_STOP_REASON_INVALID');
  } else if (reason) throw new RunStateError('RUN_STOP_REASON_INVALID');
}

export function statusForReason(reason: StopReason): RunStatus {
  const found = (Object.keys(reasonFor) as (keyof typeof reasonFor)[])
    .find(status => reasonFor[status].includes(reason));
  if (!found) throw new RunStateError('RUN_STOP_REASON_INVALID');
  return found;
}
