import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync } from 'node:fs'
import { streamAssistant } from './assistant'
import { session, setSession } from './session'
const frame = (type: string, extra: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
const meta = frame('meta', { mode: 'mock' }); const delta = frame('delta', { text: '部分' }); const done = frame('done', { finishReason: 'stop' })
const response = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } })
const report = (data: object) => { if (process.env.D47_EVIDENCE_FILE) appendFileSync(process.env.D47_EVIDENCE_FILE, JSON.stringify(data) + '\n') }
afterEach(() => { vi.unstubAllGlobals(); setSession(null) })
describe('助手POST流读取（D47）', () => {
  it('发送POST与JWT，读取命名事件并保留length', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(meta + delta + frame('done', { finishReason: 'length' }))); vi.stubGlobal('fetch', fetcher)
    const events: object[] = []; await streamAssistant('T/1', '模拟', 'fake-token', new AbortController().signal, (event) => events.push(event))
    expect(fetcher.mock.calls[0]![0]).toBe('/api/tickets/T%2F1/assistant'); expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{"question":"模拟"}' })
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'length' }); report({ case: 'frontend-contract', eventTypes: ['meta', 'delta', 'done'], finishReason: 'length' })
  })
  it('EOF无终止时拒绝，不把部分输出当成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(meta + delta)))
    await expect(streamAssistant('T1', '模拟', 'fake', new AbortController().signal, () => {})).rejects.toThrow('STREAM_INTERRUPTED')
  })
  it('首帧必须meta且事件名与type一致', async () => {
    for (const text of [delta + done, meta + meta + done, meta + 'event: done\ndata: {"type":"delta","text":"x"}\n\n']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(text)))
      await expect(streamAssistant('T1', '模拟', 'fake', new AbortController().signal, () => {})).rejects.toThrow('CONTRACT_MISMATCH')
    }
  })
  it('非SSE与非法JSON拒绝', async () => {
    for (const res of [new Response('html'), response('data: broken\n\n')]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
      await expect(streamAssistant('T1', '模拟', 'fake', new AbortController().signal, () => {})).rejects.toThrow('CONTRACT_MISMATCH')
    }
  })
  it('旧请求401不能清掉新会话', async () => {
    setSession({ accessToken: 'new-token', user: { username: 'bob', displayName: '模拟' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(streamAssistant('T1', '模拟', 'old-token', new AbortController().signal, () => {})).rejects.toThrow('UNAUTHENTICATED')
    expect(session.value?.accessToken).toBe('new-token')
  })
  it('当前请求401清理当前会话', async () => {
    setSession({ accessToken: 'same-token', user: { username: 'alice', displayName: '模拟' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(streamAssistant('T1', '模拟', 'same-token', new AbortController().signal, () => {})).rejects.toThrow('UNAUTHENTICATED'); expect(session.value).toBeNull()
  })
  it('error终止后不会继续接受后续伪造done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(meta + frame('error', { code: 'MODEL_TIMEOUT' }) + done)))
    const received: string[] = []; await streamAssistant('T1', '模拟', 'fake', new AbortController().signal, (event) => received.push(event.type)); expect(received).toEqual(['meta', 'error'])
  })
})
