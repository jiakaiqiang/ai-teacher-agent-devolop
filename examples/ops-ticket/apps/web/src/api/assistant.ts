import { assistantEventSchema, readSse, type AssistantEvent } from '@ops-ticket/shared'
import { handleUnauthorized, session } from './session'

export class AssistantError extends Error {}
// 单次POST不自动重试；只有应用终止事件才能完成。
export async function streamAssistant(ticketNo: string, question: string, token: string,
  signal: AbortSignal, receive: (event: AssistantEvent) => void): Promise<void> {
  const response = await fetch(`/api/tickets/${encodeURIComponent(ticketNo)}/assistant`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question }), signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401 && token === session.value?.accessToken) handleUnauthorized()
    throw new AssistantError(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 404 ? 'NOT_FOUND' : response.status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR')
  }
  if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
    await response.body?.cancel(); throw new AssistantError('CONTRACT_MISMATCH')
  }
  await consumeAssistantBody(response.body, signal, receive)
}

// 在线请求与离线回放共用同一套应用协议校验。
export async function consumeAssistantBody(body: ReadableStream<Uint8Array>, signal: AbortSignal,
  receive: (event: AssistantEvent) => void): Promise<void> {
  let meta = false; let chars = 0
  for await (const frame of readSse(body, { signal })) {
    let value: unknown
    try { value = JSON.parse(frame.data) as unknown } catch { throw new AssistantError('CONTRACT_MISMATCH') }
    const parsed = assistantEventSchema.safeParse(value)
    if (!parsed.success || frame.event !== parsed.data.type) throw new AssistantError('CONTRACT_MISMATCH')
    const event = parsed.data
    if (event.type === 'meta') {
      if (meta) throw new AssistantError('CONTRACT_MISMATCH')
      meta = true
    } else if (!meta) throw new AssistantError('CONTRACT_MISMATCH')
    if (event.type === 'delta') {
      chars += event.text.length
      if (chars > 32_768) throw new AssistantError('OUTPUT_LIMIT')
    }
    receive(event)
    if (event.type === 'done' || event.type === 'error') return
  }
  throw new AssistantError('STREAM_INTERRUPTED')
}
