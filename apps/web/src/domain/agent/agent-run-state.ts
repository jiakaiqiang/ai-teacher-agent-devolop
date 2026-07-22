// 领域层：状态类型 + 初始态 + 纯函数 reducer
// 把「事件流」折叠(fold)成「当前状态」，纯函数、不依赖 Vue。
import type { AgentEvent, RunId, ToolCall } from './agent-event'
import { assertNever } from './agent-event'
//使用状态机处理任务的流转状态
// run只能处于这几种状态

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
//初始化状态
export const initialAgentRunState: AgentRunState = {
  status: 'idle',
  lastSequence: -1,
  timeline: [],
}

// 判断是否为终态
function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

//定义一个reducer函数，接收当前状态和事件，返回新的状态
export function reduceAgentEvent(state: AgentRunState, event: AgentEvent): AgentRunState {
  // 如果已经是终态，则不再处理任何事件
  if (isTerminal(state.status)) {
    return state
  }

  // 如果事件的序号小于等于当前状态的 lastSequence，则说明是重复事件，忽略
  if (event.sequence <= state.lastSequence) {
    return state
  }

  // 根据事件类型更新状态
  switch (event.type) {
    case "run.started":
      return {
        ...state,
        runId: event.runId,
        status: 'running',
        lastSequence: event.sequence,
      }
    case 'text.delta':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `text-${event.sequence}`,
            kind: 'text',
            title: '模型输出',
            detail: event.payload.text,
          },
        ],
      }
    case 'tool.started':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `tool-${event.payload.callId}`,
            kind: 'tool',
            title: `调用工具：${event.payload.toolName}`,
            detail: `参数：${event.payload.argumentSummary}`,
          },
        ],
      }
    case 'tool.succeeded':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `tool-${event.payload.callId}`,
            kind: 'tool',
            title: `工具调用成功`,
            detail: `结果：${event.payload.resultSummary}，耗时：${event.payload.durationMs}ms`,
          },
        ],
      }
    case 'tool.failed':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `tool-${event.payload.callId}`,
            kind: 'error',
            title: `工具调用失败`,
            detail: `错误码：${event.payload.code}，消息：${event.payload.message}`,
          },
        ],
      }
    case 'approval.required':
      return {
        ...state,
        status: 'awaiting-approval',
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `approval-${event.payload.approvalId}`,
            kind: 'approval',
            title: `等待审批：${event.payload.action}`,
            detail: `风险级别：${event.payload.risk}`,
          },
        ],
      }
    case 'run.cancelled':
      return {
        ...state,
        status: 'cancelled',
        lastSequence: event.sequence,
        error: { code: 'cancelled', message: event.payload.reason },
      }
    case 'run.failed':
      return {
        ...state,
        status: 'failed',
        lastSequence: event.sequence,
        error: { code: event.payload.code, message: event.payload.message },
      }
    case 'run.finished':
      return {
        ...state,
        status: 'computed',
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `result-${event.sequence}`,
            kind: 'result',
            title: `运行完成`,
            detail: event.payload.summary,
          },
        ],
      }
    default:
 // 如果未来 AgentEvent 加了一种新类型（比如 budget.exceeded），
      // 而这个 switch 没有处理，TypeScript 会在这一行编译报错：
      // "Argument of type 'BudgetExceededEvent' is not assignable to parameter of type 'never'"
      // 这样就不会有"新事件被 UI 静默吞掉"的 Bug
      return assertNever(event)


  }
}