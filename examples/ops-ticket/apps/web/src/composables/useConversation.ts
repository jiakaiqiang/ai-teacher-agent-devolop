import { mockCards } from '../assistant/cards'
import { startMetrics, measureText, finishMetrics, type GenerationMetrics } from '../assistant/metrics'
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import type { AssistantEvent, ConversationEvent } from '@ops-ticket/shared'
import { streamAssistant } from '../api/assistant'
import { session } from '../api/session'
import { applyConversationEvent, createGeneration, failGeneration, isGenerating, stopGeneration, type Generation } from '../assistant/generation'

export interface ConversationTurn { id: string; parentId: string | null; question: string; run: Generation; metrics: GenerationMetrics }
export function adaptEvent(event: AssistantEvent, run: Generation, seq: number): ConversationEvent {
  const identity = { version: 1 as const, runId: run.runId, messageId: run.messageId, seq }
  if (event.type === 'meta') return { ...identity, type: 'start', mode: event.mode }
  if (event.type === 'delta') return { ...identity, type: 'text', text: event.text }
  if (event.type === 'done') return { ...identity, type: 'finish', reason: event.finishReason }
  return { ...identity, type: 'failure', code: event.code }
}

// 仅保存当前页面的内存分支；HTTP仍只发送当前问题，不冒充多轮模型上下文。
export function useConversation(ticketNo: () => string, transport = streamAssistant, now = () => performance.now()) {
  const turns = ref<ConversationTurn[]>([]); const activeLeaf = ref<string | null>(null); const error = ref('')
  let epoch = 0; let disposed = false; let controller: AbortController | undefined
  let currentRun: Generation | undefined; let deadline: ReturnType<typeof setTimeout> | undefined
  const busy = computed(() => turns.value.some(turn => isGenerating(turn.run)))
  const path = computed(() => {
    const rows: ConversationTurn[] = []; let id = activeLeaf.value
    while (id) { const turn = turns.value.find(row => row.id === id); if (!turn) break; rows.unshift(turn); id = turn.parentId }
    return rows
  })
  const cancel = () => { epoch++; controller?.abort(); controller = undefined; clearTimeout(deadline); deadline = undefined }
  function stop() { if (currentRun) { stopGeneration(currentRun); const turn=turns.value.find(row=>row.run.runId===currentRun?.runId); if(turn)finishMetrics(turn.metrics,turn.run.status,now()) } cancel(); currentRun = undefined }
  function reset() { stop(); turns.value = []; activeLeaf.value = null; error.value = '' }
  const unwatch = watch([ticketNo, () => session.value?.accessToken], reset, { flush: 'sync' })

  async function generate(question: string, parentId: string | null): Promise<boolean> {
    if (disposed || busy.value) return false
    const token = session.value?.accessToken; const ticket = ticketNo(); const prompt = question.trim()
    if (!token || !ticket || !prompt || prompt.length > 1000) { error.value = '请登录并输入1—1000字的问题'; return false }
    if (parentId && !turns.value.some(turn => turn.id === parentId)) return false
    // 为本次最大回答预留预算；到限拒绝新请求，绝不偷偷截掉旧分支。
    if (turns.value.length >= 200 || turns.value.reduce((sum, turn) => sum + turn.question.length + turn.run.text.length, 0) + prompt.length + 32_768 > 1_000_000) {
      error.value = '当前会话已到容量上限，请保留所需内容后重新进入页面'; return false
    }
    error.value = ''; const id = crypto.randomUUID()
    turns.value.push({ id, parentId, question: prompt, run: createGeneration(crypto.randomUUID(), id), metrics:startMetrics(now()) })
    const turn = turns.value[turns.value.length - 1]!; const run = turn.run
    activeLeaf.value = id; currentRun = run
    const attempt = ++epoch; const abort = new AbortController(); controller = abort; let localDeadline: ReturnType<typeof setTimeout> | undefined
    const current = () => !disposed && attempt === epoch && token === session.value?.accessToken && ticket === ticketNo()
    let onAbort: () => void = () => {}
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('CANCELLED')); abort.signal.addEventListener('abort', onAbort, { once: true })
    })
    localDeadline = setTimeout(() => {
      if (current()) { failGeneration(run, 'MODEL_TIMEOUT'); abort.abort() }
    }, 45_000)
    deadline=localDeadline
    try {
      await Promise.race([transport(ticket, prompt, token, abort.signal, event => {
        if (!current()) return
        if (event.type === 'done') mockCards(run)
        const result=applyConversationEvent(run, adaptEvent(event, run, run.lastSeq+1))
        if(result==='applied' && event.type==='delta')measureText(turn.metrics,event.text,now())
        if(!isGenerating(run))finishMetrics(turn.metrics,run.status,now())
      }), cancelled])
      if (current() && isGenerating(run)) failGeneration(run, 'STREAM_INTERRUPTED')
    } catch {
      if (current()) failGeneration(run, 'GENERATION_FAILED')
    } finally {
      abort.signal.removeEventListener('abort', onAbort)
      clearTimeout(localDeadline)
      finishMetrics(turn.metrics,run.status,now())
      if (current()) { clearTimeout(deadline); deadline = undefined; controller = undefined; currentRun = undefined }
    }
    return true
  }
  function fork(id: string, question?: string) {
    const old = turns.value.find(turn => turn.id === id)
    return old ? generate(question ?? old.question, old.parentId) : Promise.resolve(false)
  }
  function select(id: string) {
    if (busy.value || !turns.value.some(turn => turn.id === id)) return false
    activeLeaf.value = id; return true
  }
  function dispose() { if (disposed) return; reset(); disposed = true; unwatch() }
  if (getCurrentScope()) onScopeDispose(dispose)
  return { turns, path, activeLeaf, busy, error, send: (question: string) => generate(question, activeLeaf.value), fork, select, stop, reset, dispose }
}
