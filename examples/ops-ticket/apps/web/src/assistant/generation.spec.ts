import { describe, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { applyConversationEvent as apply, createGeneration, failGeneration, stopGeneration } from './generation'
const event = (seq: number, extra: object) => ({ version: 1, runId: 'run-1', messageId: 'message-1', seq, ...extra })
const start = event(1, { type: 'start', mode: 'mock' })
function begun() { const run = createGeneration('run-1', 'message-1'); apply(run, start); return run }
const report = (value: object) => { if (process.env.D50_EVIDENCE_FILE) appendFileSync(process.env.D50_EVIDENCE_FILE, JSON.stringify(value) + '\n') }
describe('版本化生成状态（D50）', () => {
  it('start文本finish形成明确终态', () => {
    const run = begun(); apply(run, event(2, { type: 'text', text: '模拟建议' })); apply(run, event(3, { type: 'finish', reason: 'stop' }))
    expect(run).toMatchObject({ text: '模拟建议', status: 'completed', lastSeq: 3 }); report({ case: 'versioned-run', status: run.status, text: run.text, lastSeq: run.lastSeq })
  })
  it('重复片段只追加一次', () => {
    const run = begun(); const piece = event(2, { type: 'text', text: '一段' }); apply(run, piece)
    expect(apply(run, piece)).toBe('duplicate'); expect(run.text).toBe('一段'); report({ case: 'duplicate-event', text: run.text, lastSeq: run.lastSeq })
  })
  it('相同序号不同内容拒绝且不改状态', () => {
    const run = begun(); apply(run, event(2, { type: 'text', text: '原文' })); const before = JSON.stringify(run)
    expect(() => apply(run, event(2, { type: 'text', text: '冲突' }))).toThrow('EVENT_CONFLICT'); expect(JSON.stringify(run)).toBe(before)
  })
  it('序号跳跃拒绝且不改状态', () => {
    const run = begun(); const before = JSON.stringify(run); expect(() => apply(run, event(3, { type: 'text', text: '漏一段' }))).toThrow('EVENT_SEQUENCE'); expect(JSON.stringify(run)).toBe(before)
  })
  it('旧run和旧message不能污染新生成', () => {
    const run = begun()
    for (const old of [{ runId: 'old' }, { messageId: 'old' }]) expect(apply(run, event(2, { type: 'text', text: '污染', ...old }))).toBe('stale')
    expect(run.text).toBe(''); expect(run.lastSeq).toBe(1)
  })
  it('未知版本和额外字段拒绝', () => {
    for (const value of [{ ...start, version: 2 }, { ...start, secret: 'fake' }]) expect(() => apply(createGeneration('run-1', 'message-1'), value)).toThrow('EVENT_CONTRACT')
  })
  it('首帧必须start', () => { expect(() => apply(createGeneration('run-1', 'message-1'), event(1, { type: 'text', text: 'x' }))).toThrow('EVENT_ORDER') })
  it('第二个start拒绝', () => { expect(() => apply(begun(), { ...start, seq: 2 })).toThrow('EVENT_ORDER') })
  it('length保持截断语义', () => { const run = begun(); apply(run, event(2, { type: 'finish', reason: 'length' })); expect(run.status).toBe('truncated') })
  it('失败按有无正文区分error和interrupted', () => {
    for (const partial of [false, true]) {
      const run = begun(); if (partial) apply(run, event(2, { type: 'text', text: '部分' }))
      apply(run, event(partial ? 3 : 2, { type: 'failure', code: 'MODEL_TIMEOUT' })); expect(run.status).toBe(partial ? 'interrupted' : 'error')
    }
  })
  it('停止后迟到文本和finish不能改变终态', () => {
    const run = begun(); apply(run, event(2, { type: 'text', text: '保留' })); stopGeneration(run)
    expect(apply(run, event(3, { type: 'text', text: '迟到' }))).toBe('terminal'); apply(run, event(4, { type: 'finish', reason: 'stop' }))
    expect(run).toMatchObject({ status: 'stopped', text: '保留', lastSeq: 2 })
  })
  it('完成后同终止重投幂等且新片段忽略', () => {
    const run = begun(); const end = event(2, { type: 'finish', reason: 'stop' }); apply(run, end); expect(apply(run, end)).toBe('duplicate')
    expect(apply(run, event(3, { type: 'text', text: '迟到' }))).toBe('terminal'); expect(run.status).toBe('completed')
  })
  it('正文和事件数量有上限', () => {
    const run = begun(); for (const seq of [2, 3]) apply(run, event(seq, { type: 'text', text: 'x'.repeat(16_384) }))
    expect(() => apply(run, event(4, { type: 'text', text: 'x' }))).toThrow('OUTPUT_LIMIT'); expect(run.text).toHaveLength(32_768)
    expect(() => apply(run, event(4097, { type: 'finish', reason: 'stop' }))).toThrow('EVENT_CONTRACT')
  })
  it('本地失败不覆盖已有终态', () => { const run = begun(); stopGeneration(run); failGeneration(run, 'NETWORK'); expect(run.status).toBe('stopped') })
})
