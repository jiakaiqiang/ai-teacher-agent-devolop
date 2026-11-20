import { computed, ref, watch } from 'vue'
import { session } from '../api/session'
import { streamAssistant } from '../api/assistant'

export type AssistantStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'truncated' | 'stopped' | 'interrupted' | 'error'
type Transport = typeof streamAssistant
const messages: Record<string, string> = {
  MODEL_TIMEOUT: '生成超时，已保留收到的内容', MODEL_CANCELLED: '服务已停止生成，已保留收到的内容',
  MODEL_UNAVAILABLE: '排查建议暂不可用', NOT_FOUND: '工单不存在或不可见', FORBIDDEN: '没有查看权限', UNAUTHENTICATED: '请重新登录',
}
export function useAssistant(transport: Transport = streamAssistant) {
  const text = ref(''); const status = ref<AssistantStatus>('idle'); const mode = ref<'mock' | 'model' | null>(null); const error = ref('')
  const busy = computed(() => status.value === 'connecting' || status.value === 'streaming')
  let sequence = 0; let controller: AbortController | undefined; let disposed = false
  const invalidate = () => { sequence++; controller?.abort(); controller = undefined }
  const reset = () => { invalidate(); text.value = ''; status.value = 'idle'; mode.value = null; error.value = '' }
  const stopWatch = watch(() => session.value?.accessToken, reset, { flush: 'sync' })
  async function start(ticketNo: string, question: string): Promise<void> {
    if (disposed || busy.value) return
    const token = session.value?.accessToken
    if (!token || !question.trim() || question.trim().length > 1000) { status.value = 'error'; error.value = token ? '请输入1—1000字的问题' : '请重新登录'; return }
    reset(); const id = sequence; const abort = new AbortController(); controller = abort
    const current = () => !disposed && id === sequence && token === session.value?.accessToken
    status.value = 'connecting'
    try {
      await transport(ticketNo, question.trim(), token, abort.signal, (event) => {
        if (!current()) return
        if (event.type === 'meta') mode.value = event.mode
        if (event.type === 'delta') { text.value += event.text; status.value = 'streaming' }
        if (event.type === 'done') status.value = event.finishReason === 'length' ? 'truncated' : 'completed'
        if (event.type === 'error') { status.value = text.value ? 'interrupted' : 'error'; error.value = messages[event.code] ?? '生成中断，已保留收到的内容' }
      })
      if (current() && busy.value) { status.value = text.value ? 'interrupted' : 'error'; error.value = '连接结束，未收到完成事件' }
    } catch (cause) {
      if (current()) { status.value = text.value ? 'interrupted' : 'error'; error.value = messages[cause instanceof Error ? cause.message : ''] ?? '生成中断，请检查连接后重新尝试' }
    } finally { if (current()) controller = undefined }
  }
  function stop() { if (!busy.value) return; invalidate(); status.value = 'stopped'; error.value = '' }
  function dispose() { if (disposed) return; reset(); disposed = true; stopWatch() }
  return { text, status, mode, error, busy, start, stop, reset, dispose }
}
