import { readSse, sessionListSchema, sessionSummarySchema, sessionDetailSchema, toolSessionEventSchema, type ToolSessionEvent } from '@ops-ticket/shared'
import { getJson, postJson, ApiError } from './http'
import { handleUnauthorized, session } from './session'

const base = '/api/assistant/conversations'
export const listToolSessions = (signal: AbortSignal) => getJson(base, sessionListSchema, signal)
export const createToolSession = (title: string, signal: AbortSignal) => postJson(base, { title }, sessionSummarySchema, signal)
export const getToolSession = (id: string, signal: AbortSignal) => getJson(base + '/' + encodeURIComponent(id), sessionDetailSchema, signal)
export interface TurnInput { question: string; version: number; requestKey: string }
export class ToolSessionError extends Error {}

// POST不自动重试；显式重载只读数据库，不再次执行工具。
export async function streamToolSession(id: string, input: TurnInput, token: string, signal: AbortSignal, receive: (event: ToolSessionEvent) => void) {
  const response = await fetch(base + '/' + encodeURIComponent(id) + '/turns', { method: 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(input) })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
    if (response.status === 401 && token === session.value?.accessToken) handleUnauthorized()
    const code = typeof body?.error?.code === 'string' && /^[A-Z_]{1,64}$/.test(body.error.code) ? body.error.code : 'HTTP_ERROR'
    throw new ApiError(response.status, code, '会话请求未完成')
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    await response.body?.cancel(); throw new ToolSessionError('CONTRACT_MISMATCH')
  }
  await consumeToolSession(response.body, signal, receive)
}

export async function consumeToolSession(body: ReadableStream<Uint8Array>, signal: AbortSignal, receive: (event: ToolSessionEvent) => void) {
  let runId = '', seq = 0, answer = false
  const calls = new Map<string, { name: string; done: boolean }>()
  for await (const frame of readSse(body, { signal })) {
    let raw: unknown
    try { raw = JSON.parse(frame.data) } catch { throw new ToolSessionError('CONTRACT_MISMATCH') }
    const parsed = toolSessionEventSchema.safeParse(raw)
    if (!parsed.success || frame.event !== parsed.data.type) throw new ToolSessionError('CONTRACT_MISMATCH')
    const event = parsed.data
    if (event.seq !== seq + 1 || (runId && event.runId !== runId)) throw new ToolSessionError('EVENT_SEQUENCE')
    if (event.type === 'meta') {
      if (seq !== 0) throw new ToolSessionError('EVENT_ORDER')
      runId = event.runId
    } else if (!runId) throw new ToolSessionError('EVENT_ORDER')
    if (event.type === 'tool-start') {
      if (answer || calls.size >= 3 || calls.has(event.callId)) throw new ToolSessionError('EVENT_ORDER')
      calls.set(event.callId, { name: event.name, done: false })
    } else if (event.type === 'tool-result') {
      const call = calls.get(event.callId)
      if (answer || !call || call.done || call.name !== event.name) throw new ToolSessionError('EVENT_ORDER')
      call.done = true
    } else if (event.type === 'answer') {
      if (answer || [...calls.values()].some(call => !call.done)) throw new ToolSessionError('EVENT_ORDER')
      answer = true
    } else if (event.type === 'done' && !answer) throw new ToolSessionError('EVENT_ORDER')
    seq = event.seq
    signal.throwIfAborted(); receive(event)
    if (event.type === 'done' || event.type === 'error') return
  }
  throw new ToolSessionError('STREAM_INTERRUPTED')
}
