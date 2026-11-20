import { SseError } from '@ops-ticket/shared'
import { AssistantError, consumeAssistantBody } from '../api/assistant'

export interface ReplayResult {
  mode: 'mock' | 'model' | null
  text: string
  state: 'completed' | 'truncated' | 'interrupted' | 'error' | 'cancelled'
  code: string | null
  eventCount: number
}

// 只回放合成字节块，不访问网络、不保存真实用户或模型内容。
export async function replayAssistant(chunks: readonly Uint8Array[], signal = new AbortController().signal): Promise<ReplayResult> {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]!); else controller.close() },
  })
  const result: ReplayResult = { mode: null, text: '', state: 'error', code: null, eventCount: 0 }
  try {
    await consumeAssistantBody(body, signal, (event) => {
      result.eventCount++
      if (event.type === 'meta') result.mode = event.mode
      if (event.type === 'delta') result.text += event.text
      if (event.type === 'done') result.state = event.finishReason === 'length' ? 'truncated' : 'completed'
      if (event.type === 'error') { result.state = result.text ? 'interrupted' : 'error'; result.code = event.code }
    })
  } catch (cause) {
    result.state = signal.aborted ? 'cancelled' : result.text ? 'interrupted' : 'error'
    result.code = signal.aborted ? 'CANCELLED' : cause instanceof AssistantError || cause instanceof SseError ? cause.message : 'REPLAY_FAILED'
  }
  return result
}
