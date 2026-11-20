import { conversationEventSchema, type ConversationEvent } from '@ops-ticket/shared'

export type GenerationStatus = 'connecting' | 'streaming' | 'completed' | 'truncated' | 'stopped' | 'interrupted' | 'error'
export type AssistantCard = Extract<ConversationEvent, {type:'tool'|'citation'|'result'}>
export interface Generation {
  cards: AssistantCard[]
  runId: string
  messageId: string
  status: GenerationStatus
  mode: 'mock' | 'model' | null
  text: string
  error: string | null
  lastSeq: number
  seen: Record<number, string>
}
export class ConversationError extends Error {}
export const isGenerating = (run: Generation) => run.status === 'connecting' || run.status === 'streaming'
export function createGeneration(runId: string, messageId: string): Generation {
  return { cards: [], runId, messageId, status: 'connecting', mode: null, text: '', error: null, lastSeq: 0, seen: {} }
}
export function stopGeneration(run: Generation) { if (isGenerating(run)) run.status = 'stopped' }
export function failGeneration(run: Generation, code: string) {
  if (!isGenerating(run)) return
  run.status = run.text ? 'interrupted' : 'error'; run.error = code
}

// 校验全部通过后才提交状态；重复事件去重不等于请求幂等或断线恢复。
export function applyConversationEvent(run: Generation, input: unknown): 'applied' | 'duplicate' | 'stale' | 'terminal' {
  const parsed = conversationEventSchema.safeParse(input)
  if (!parsed.success) throw new ConversationError('EVENT_CONTRACT')
  const event = parsed.data
  if (event.runId !== run.runId || event.messageId !== run.messageId) return 'stale'
  const fingerprint = JSON.stringify(event)
  if (run.seen[event.seq] !== undefined) {
    if (run.seen[event.seq] !== fingerprint) throw new ConversationError('EVENT_CONFLICT')
    return 'duplicate'
  }
  if (!isGenerating(run)) return 'terminal'
  if (event.seq !== run.lastSeq + 1) throw new ConversationError('EVENT_SEQUENCE')
  if (event.type === 'start' ? run.lastSeq !== 0 : run.mode === null) throw new ConversationError('EVENT_ORDER')
  if (event.type === 'text' && run.text.length + event.text.length > 32_768) throw new ConversationError('OUTPUT_LIMIT')
  if (event.type === 'tool' || event.type === 'citation' || event.type === 'result') {
    if (run.mode !== 'mock') throw new ConversationError('MOCK_CARD_ONLY')
    const index = run.cards.findIndex(card => card.cardId === event.cardId)
    const previous = run.cards[index]
    if (previous) {
      if (previous.type !== 'tool' || event.type !== 'tool' || previous.state !== 'running' || event.state === 'running' || previous.label !== event.label) throw new ConversationError('CARD_ORDER')
    } else {
      if (run.cards.length >= 12) throw new ConversationError('CARD_LIMIT')
      if (event.type === 'tool' && event.state !== 'running') throw new ConversationError('CARD_ORDER')
    }
    if (index < 0) run.cards.push(event); else run.cards[index] = event
  }
  if (event.type === 'start') run.mode = event.mode
  if (event.type === 'text') { run.text += event.text; run.status = 'streaming' }
  if (event.type === 'finish') run.status = event.reason === 'length' ? 'truncated' : 'completed'
  if (event.type === 'failure') { run.error = event.code; run.status = run.text ? 'interrupted' : 'error' }
  run.lastSeq = event.seq; run.seen[event.seq] = fingerprint
  return 'applied'
}
