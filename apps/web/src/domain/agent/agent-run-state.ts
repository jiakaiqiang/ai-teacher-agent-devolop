// 领域层：状态类型 + 初始态 + 纯函数 reducer
// 把「事件流」折叠(fold)成「当前状态」，纯函数、不依赖 Vue。
import type { AgentEvent, RunId, ToolCall } from './agent-event'
import { assertNever } from './agent-event'

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface AgentRunState {
  runId: RunId | null
  status: RunStatus
  /** 累积拼接的助手消息文本 */
  message: string
  /** 工具调用记录（按 id 聚合，started 建条目，result 补结果） */
  toolCalls: ToolCall[]
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

export const initialState: AgentRunState = {
  runId: null,
  status: 'idle',
  message: '',
  toolCalls: [],
  error: null,
  startedAt: null,
  finishedAt: null,
}

// 一旦运行进入终态，后续增量事件不再改变状态（防止乱序 / 迟到事件污染）。
function isTerminal(status: RunStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

/**
 * reducer：(state, event) => newState
 * 纯函数——不 mutate 入参，同输入必得同输出，无副作用。
 */
export function reduce(state: AgentRunState, event: AgentEvent): AgentRunState {
  switch (event.type) {
    case 'run/started':
      return {
        ...initialState,
        runId: event.runId,
        status: 'running',
        startedAt: event.startedAt,
      }

    case 'message/delta':
      if (isTerminal(state.status)) return state
      return { ...state, message: state.message + event.text }

    case 'message/completed':
      // 仅标记「本条消息增量结束」，内容已由 message/delta 累积，无需改动。
      return state

    case 'tool/call-started':
      if (isTerminal(state.status)) return state
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          { id: event.callId, name: event.name, args: event.args, status: 'running' },
        ],
      }

    case 'tool/call-result':
      if (isTerminal(state.status)) return state
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.id === event.callId
            ? { ...tc, status: 'done', result: event.result }
            : tc,
        ),
      }

    case 'tool/call-error':
      if (isTerminal(state.status)) return state
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.id === event.callId
            ? { ...tc, status: 'error', error: event.message }
            : tc,
        ),
      }

    case 'run/finished':
      if (isTerminal(state.status)) return state
      return { ...state, status: 'done', finishedAt: event.finishedAt }

    case 'run/error':
      if (isTerminal(state.status)) return state
      return { ...state, status: 'error', error: event.message }

    case 'run/cancelled':
      if (isTerminal(state.status)) return state
      return { ...state, status: 'cancelled' }

    default:
      return assertNever(event)
  }
}
