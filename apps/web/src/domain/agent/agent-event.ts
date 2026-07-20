// 领域层：纯类型，不依赖 Vue
//
// 用判别联合(discriminated union)建模一次 Agent 运行产生的事件流。

/** Branded type：让 RunId 不能和普通 string 混用，防止参数传错。 */
export type RunId = string & { readonly __brand: 'RunId' }

/** 把普通 string 标记为 RunId。 */
export function toRunId(id: string): RunId {
  return id as RunId
}

/** 一次工具调用的唯一标识。 */
export type ToolCallId = string & { readonly __brand: 'ToolCallId' }

export function toToolCallId(id: string): ToolCallId {
  return id as ToolCallId
}

/**
 * Agent 运行事件（9 种）：覆盖一次运行的完整生命周期。
 * 所有成员共用 `type` 字段做判别键，并都带 runId。
 */
export type AgentEvent =
  | { type: 'run/started'; runId: RunId; startedAt: number }
  | { type: 'message/delta'; runId: RunId; text: string }
  | { type: 'message/completed'; runId: RunId }
  | { type: 'tool/call-started'; runId: RunId; callId: ToolCallId; name: string; args: unknown }
  | { type: 'tool/call-result'; runId: RunId; callId: ToolCallId; result: unknown }
  | { type: 'tool/call-error'; runId: RunId; callId: ToolCallId; message: string }
  | { type: 'run/finished'; runId: RunId; finishedAt: number }
  | { type: 'run/error'; runId: RunId; message: string }
  | { type: 'run/cancelled'; runId: RunId }

/** 事件类型字面量，方便别处引用。 */
export type AgentEventType = AgentEvent['type']

/** 工具调用状态。 */
export type ToolCallStatus = 'running' | 'done' | 'error'

/** reducer 聚合出的单条工具调用记录（started 建条目，result/error 补结果）。 */
export interface ToolCall {
  id: ToolCallId
  name: string
  args: unknown
  status: ToolCallStatus
  result?: unknown
  error?: string
}

/**
 * 穷尽性检查：在 switch 的 default 分支调用。
 * 将来新增事件类型却忘了处理时，TS 会在编译期报错。
 */
export function assertNever(x: never): never {
  throw new Error('Unhandled AgentEvent variant: ' + JSON.stringify(x))
}
