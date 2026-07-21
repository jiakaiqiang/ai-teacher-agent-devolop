// 领域层：状态类型 + 初始态 + 纯函数 reducer
// 把「事件流」折叠(fold)成「当前状态」，纯函数、不依赖 Vue。
import type { AgentEvent, RunId, ToolCall } from './agent-event'
import { assertNever } from './agent-event'
//使用状态机处理任务的流转状态

export type RunStatus = 'idle' | 'running' | 'awaiting-approval' | 'computed' | 'failed' | 'cancelled'

export type TimelineItem = {
  key: string
  kind: 'text' | 'tool' | 'approval' | 'error' | 'result'
  title: string
  detail?: string
}

//agnet的运行状态
export type AgentRunState = {
  runId?: RunId
  status: RunStatus
  lastSequence: number     // 最后处理的事件序号
  timeline: TimelineItem[]
  error?: { code: string; message: string }
}
