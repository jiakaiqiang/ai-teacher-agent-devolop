import { onScopeDispose, watch } from 'vue'
import { useAssistant } from './useAssistant'
import { streamAssistant } from '../api/assistant'

// 组件复用时工单号仍可能变化，不能只依赖卸载清理。
export function useTicketAssistant(ticketNo: () => string, transport = streamAssistant) {
  const assistant = useAssistant(transport)
  watch(ticketNo, () => assistant.reset(), { flush: 'sync' })
  onScopeDispose(() => assistant.dispose())
  return { ...assistant, generate: (question: string) => assistant.start(ticketNo(), question) }
}
