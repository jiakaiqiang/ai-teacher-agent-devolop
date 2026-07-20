// reducer 单元测试（vitest，纯函数 → 无需 mock DOM）
import { describe, it, expect } from 'vitest'
import { reduce, initialState } from './agent-run-state'
import { toRunId, toToolCallId } from './agent-event'

const runId = toRunId('run_test')
const callId = toToolCallId('call_test')

describe('agent-run-state reducer', () => {
  it('initialState 从 idle 开始', () => {
    expect(initialState.status).toBe('idle')
    expect(initialState.message).toBe('')
    expect(initialState.toolCalls).toEqual([])
  })

  it('run/started → running，并记录 runId 与开始时间', () => {
    const next = reduce(initialState, { type: 'run/started', runId, startedAt: 100 })
    expect(next.status).toBe('running')
    expect(next.runId).toBe(runId)
    expect(next.startedAt).toBe(100)
  })

  it('多个 message/delta 会累积拼接', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'message/delta', runId, text: '你' })
    s = reduce(s, { type: 'message/delta', runId, text: '好' })
    expect(s.message).toBe('你好')
  })

  it('tool/call-started 建条目，tool/call-result 补结果', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'tool/call-started', runId, callId, name: 'getWeather', args: { city: '北京' } })
    expect(s.toolCalls).toHaveLength(1)
    expect(s.toolCalls[0].status).toBe('running')

    s = reduce(s, { type: 'tool/call-result', runId, callId, result: { temp: 26 } })
    expect(s.toolCalls[0].status).toBe('done')
    expect(s.toolCalls[0].result).toEqual({ temp: 26 })
  })

  it('tool/call-error 把对应调用标记为 error', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'tool/call-started', runId, callId, name: 'getWeather', args: {} })
    s = reduce(s, { type: 'tool/call-error', runId, callId, message: '超时' })
    expect(s.toolCalls[0].status).toBe('error')
    expect(s.toolCalls[0].error).toBe('超时')
  })

  it('run/finished → done', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'run/finished', runId, finishedAt: 500 })
    expect(s.status).toBe('done')
    expect(s.finishedAt).toBe(500)
  })

  it('run/error → error 且记录错误信息', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'run/error', runId, message: '模型超时' })
    expect(s.status).toBe('error')
    expect(s.error).toBe('模型超时')
  })

  it('run/cancelled → cancelled', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'run/cancelled', runId })
    expect(s.status).toBe('cancelled')
  })

  it('进入终态后，迟到的 message/delta 不再改变状态', () => {
    let s = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    s = reduce(s, { type: 'run/finished', runId, finishedAt: 500 })
    const after = reduce(s, { type: 'message/delta', runId, text: '迟到' })
    expect(after).toBe(s)
    expect(after.message).toBe('')
  })

  it('reduce 不修改传入的 state（入参未被 mutate）', () => {
    const before = reduce(initialState, { type: 'run/started', runId, startedAt: 0 })
    const snapshot = JSON.stringify(before)
    reduce(before, { type: 'message/delta', runId, text: 'x' })
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
