import { describe, expect, it, vi } from 'vitest'
import { appendFileSync } from 'node:fs'
import { replayAssistant } from './replay'
const frame = (type: string, data: object) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...data })}\r\n\r\n`
const meta = frame('meta', { mode: 'mock' }); const delta = frame('delta', { text: '排查中文🙂' }); const done = frame('done', { finishReason: 'stop' })
const bytes = (text: string) => new TextEncoder().encode(text)
const replay = (text: string) => replayAssistant([bytes(text)])
const report = (value: object) => { if (process.env.D49_EVIDENCE_FILE) appendFileSync(process.env.D49_EVIDENCE_FILE, JSON.stringify(value) + '\n') }
describe('离线字节回放（D49）', () => {
  it('所有双块切点及逐字节回放结果一致', async () => {
    const wire = bytes('\uFEFF: heartbeat\r\n\r\n' + meta + delta + done)
    const expected = await replayAssistant([wire]); expect(expected).toMatchObject({ state: 'completed', text: '排查中文🙂', eventCount: 3 })
    for (let cut = 0; cut <= wire.length; cut++) expect(await replayAssistant([wire.slice(0, cut), wire.slice(cut)])).toEqual(expected)
    expect(await replayAssistant(Array.from(wire, (value) => Uint8Array.of(value)))).toEqual(expected)
    report({ case: 'replay-boundaries', bytes: wire.length, splitCases: wire.length + 1, oneByteChunks: true, result: expected })
  })
  it('缺终止保留部分且报告interrupted', async () => {
    const result = await replay(meta + delta); expect(result).toMatchObject({ state: 'interrupted', text: '排查中文🙂', code: 'STREAM_INTERRUPTED' })
    report({ case: 'replay-interrupted', result })
  })
  it('length保持truncated', async () => { expect(await replay(meta + delta + frame('done', { finishReason: 'length' }))).toMatchObject({ state: 'truncated', code: null }) })
  it('服务error保留部分及固定错误码', async () => { expect(await replay(meta + delta + frame('error', { code: 'MODEL_TIMEOUT' }))).toMatchObject({ state: 'interrupted', text: '排查中文🙂', code: 'MODEL_TIMEOUT' }) })
  it('事件名和type不一致拒绝', async () => {
    expect(await replay(meta + 'event: done\ndata: {"type":"delta","text":"伪装"}\n\n' + done)).toMatchObject({ state: 'error', code: 'CONTRACT_MISMATCH', text: '' })
  })
  it('缺meta或重复meta拒绝', async () => {
    for (const wire of [delta + done, meta + meta + done]) expect(await replay(wire)).toMatchObject({ state: 'error', code: 'CONTRACT_MISMATCH' })
  })
  it('半个终止帧不自动补全', async () => { expect(await replay(meta + delta + done.slice(0, -2))).toMatchObject({ state: 'interrupted', code: 'STREAM_INTERRUPTED' }) })
  it('损坏UTF8不替换成乱码', async () => { expect(await replayAssistant([bytes(meta), Uint8Array.of(0xff)])).toMatchObject({ state: 'error', code: 'SSE_INVALID_UTF8' }) })
  it('累计正文超过预算时保留已接受内容', async () => {
    const piece = frame('delta', { text: 'x'.repeat(16_384) }); const result = await replay(meta + piece + piece + frame('delta', { text: 'x' }) + done)
    expect(result).toMatchObject({ state: 'interrupted', code: 'OUTPUT_LIMIT' }); expect(result.text).toHaveLength(32_768)
  })
  it('首个终止之后不再接收后续事件', async () => { expect(await replay(meta + delta + done + frame('error', { code: 'MODEL_TIMEOUT' }))).toMatchObject({ state: 'completed', eventCount: 3, code: null }) })
  it('已取消时无输出且不访问fetch', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch'); const abort = new AbortController(); abort.abort()
    try { expect(await replayAssistant([bytes(meta + delta + done)], abort.signal)).toMatchObject({ state: 'cancelled', text: '', eventCount: 0 }); expect(fetcher).not.toHaveBeenCalled() } finally { fetcher.mockRestore() }
  })
})
