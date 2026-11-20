import { describe, it, expect, vi, afterEach } from 'vitest'
import { appendFileSync } from 'node:fs'
import { consumeToolSession, streamToolSession } from './toolSessions'
const runId = '00000000-0000-4000-8000-000000000001'
const event = (seq: number, payload: object) => ({ protocol: 1, runId, seq, ...payload })
const meta = event(1, { type: 'meta', mode: 'mock', replay: false })
const answer = (seq: number) => event(seq, { type: 'answer', text: '合成回答' })
const done = (seq: number) => event(seq, { type: 'done', conversationVersion: 2, billing: { status: 'exact', units: 0 } })
const start = event(2, { type: 'tool-start', callId: 'c', name: 'find_ticket', arguments: '{"ticketNo":"D69-T"}' })
const result = event(3, { type: 'tool-result', callId: 'c', name: 'find_ticket', content: '{}' })
function body(events: object[]) { return new ReadableStream<Uint8Array>({ start(controller) { for (const item of events) controller.enqueue(new TextEncoder().encode(`event: ${(item as { type: string }).type}\ndata: ${JSON.stringify(item)}\n\n`)); controller.close() } }) }
const consume = (events: object[]) => consumeToolSession(body(events), new AbortController().signal, () => {})
afterEach(() => vi.unstubAllGlobals())
describe('持久会话SSE消费（D69）', () => {
  it('真实消费工具配对直到应用完成', async () => {
    const receive = vi.fn(); await consumeToolSession(body([meta,start,result,answer(4),done(5)]), new AbortController().signal, receive)
    expect(receive.mock.calls.map(call => call[0].type)).toEqual(['meta','tool-start','tool-result','answer','done'])
    if (process.env.D69_EVIDENCE_FILE) appendFileSync(process.env.D69_EVIDENCE_FILE, JSON.stringify({ case: 'session-consumer', fixture: true, events: receive.mock.calls.length, terminal: 'done', toolPair: true }) + '\n')
  })
  it('序号跳跃和不同run拒绝', async () => {
    await expect(consume([meta,answer(3),done(4)])).rejects.toThrow('EVENT_SEQUENCE')
    await expect(consume([meta,{ ...answer(2), runId: '00000000-0000-4000-8000-000000000002' }])).rejects.toThrow('EVENT_SEQUENCE')
  })
  it('缺少meta或重复meta拒绝', async () => {
    await expect(consume([answer(1)])).rejects.toThrow('EVENT_ORDER')
    await expect(consume([meta,{ ...meta,seq:2 }])).rejects.toThrow('EVENT_ORDER')
  })
  it('孤立结果和重复调用拒绝', async () => {
    await expect(consume([meta,{ ...result,seq:2 }])).rejects.toThrow('EVENT_ORDER')
    await expect(consume([meta,start,{ ...start,seq:3 }])).rejects.toThrow('EVENT_ORDER')
  })
  it('未返回的工具不能提前完成回答', async () => { await expect(consume([meta,start,answer(3),done(4)])).rejects.toThrow('EVENT_ORDER') })
  it('done必须有回答且EOF不是成功', async () => {
    await expect(consume([meta,done(2)])).rejects.toThrow('EVENT_ORDER')
    await expect(consume([meta,answer(2)])).rejects.toThrow('STREAM_INTERRUPTED')
  })
  it('错误终态允许已开始工具没有结果', async () => { await expect(consume([meta,start,event(3,{type:'error',code:'TOOL_NOT_FOUND'})])).resolves.toBeUndefined() })
  it('工具名称不一致与重复结果拒绝', async () => {
    await expect(consume([meta,start,{ ...result,name:'list_ticket_logs' }])).rejects.toThrow('EVENT_ORDER')
    await expect(consume([meta,start,result,{ ...result,seq:4 }])).rejects.toThrow('EVENT_ORDER')
  })
  it('HTTP成功但返回HTML不能当工具事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>fixture</html>', { headers: {'content-type':'text/html'} })))
    await expect(streamToolSession(runId,{ question:'问题',version:0,requestKey:runId },'fixture-token',new AbortController().signal,()=>{})).rejects.toThrow('CONTRACT_MISMATCH')
  })
  it('HTTP冲突保留可识别错误且只请求一次', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error:{ code:'CONVERSATION_BUSY' } }),{status:409})); vi.stubGlobal('fetch',fetcher)
    await expect(streamToolSession(runId,{question:'问题',version:0,requestKey:runId},'fixture-token',new AbortController().signal,()=>{})).rejects.toMatchObject({code:'CONVERSATION_BUSY'})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
