// 把事件源 + reducer 粘合成 Vue 响应式 state。
// 唯一知道 Vue、且唯一有副作用（定时器）的一层；reducer 逻辑不在这里重写。
import { ref, onScopeDispose, type Ref } from 'vue'
import { reduce, initialState, type AgentRunState } from '@/domain/agent/agent-run-state'
import type { AgentEvent } from '@/domain/agent/agent-event'

export interface UseAgentRun {
  // 状态只应通过 dispatch/play/reset 变更；reducer 每次返回新对象，从不原地修改。
  state: Ref<AgentRunState>
  dispatch: (event: AgentEvent) => void
  /** 按固定间隔「播放」一条事件序列，模拟未来的 WebSocket / SSE 流。 */
  play: (events: AgentEvent[], intervalMs?: number) => void
  /** 停止播放并复位到初始态。 */
  reset: () => void
}

export function useAgentRun(): UseAgentRun {
  const state = ref<AgentRunState>(initialState)
  let timer: ReturnType<typeof setInterval> | null = null

  function dispatch(event: AgentEvent): void {
    state.value = reduce(state.value, event)
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function play(events: AgentEvent[], intervalMs = 400): void {
    stop()
    state.value = initialState
    let i = 0
    timer = setInterval(() => {
      if (i >= events.length) {
        stop()
        return
      }
      dispatch(events[i])
      i++
    }, intervalMs)
  }

  function reset(): void {
    stop()
    state.value = initialState
  }

  onScopeDispose(stop)

  return { state, dispatch, play, reset }
}
