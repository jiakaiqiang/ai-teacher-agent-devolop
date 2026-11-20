import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync } from 'node:fs'
import type { AssistantEvent } from '@ops-ticket/shared'
import { useAssistant } from './useAssistant'
import { setSession } from '../api/session'
import type { streamAssistant } from '../api/assistant'
const login = (name: string) => setSession({ accessToken: `fake-${name}`, user: { username: name, displayName: name } })
const report = (data: object) => { if (process.env.D47_EVIDENCE_FILE) appendFileSync(process.env.D47_EVIDENCE_FILE, JSON.stringify(data) + '\n') }
function harness() {
  const calls: { signal: AbortSignal; emit: (event: AssistantEvent) => void; resolve: () => void; reject: (error: Error) => void }[] = []
  const transport: typeof streamAssistant = (_ticket, _question, _token, signal, emit) => new Promise((resolve, reject) => calls.push({ signal, emit, resolve, reject }))
  const assistant = useAssistant(transport); return { calls, assistant }
}
beforeEach(() => login('alice'))
afterEach(() => setSession(null))
describe('助手界面状态（D47）', () => {
  it('自然结束和length分别completed与truncated', async () => {
    for (const reason of ['stop', 'length'] as const) {
      const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); calls[0]!.emit({ type: 'done', finishReason: reason }); calls[0]!.resolve(); await task
      expect(a.status.value).toBe(reason === 'stop' ? 'completed' : 'truncated'); a.dispose()
    }
  })
  it('主动停止保留部分，晚到旧帧不能污染新请求', async () => {
    const { calls, assistant: a } = harness(); const old = a.start('T1', '旧问题'); calls[0]!.emit({ type: 'delta', text: '旧内容' }); a.stop()
    expect(a.text.value).toBe('旧内容'); expect(a.status.value).toBe('stopped'); expect(calls[0]!.signal.aborted).toBe(true)
    const next = a.start('T1', '新问题'); calls[1]!.emit({ type: 'delta', text: '新内容' }); calls[0]!.emit({ type: 'delta', text: '迟到污染' }); calls[0]!.resolve(); await old
    expect(a.text.value).toBe('新内容'); expect(a.busy.value).toBe(true)
    calls[1]!.emit({ type: 'done', finishReason: 'stop' }); calls[1]!.resolve(); await next
    report({ case: 'old-request-isolation', text: a.text.value, status: a.status.value, oldAborted: calls[0]!.signal.aborted }); a.dispose()
  })
  it('切会话立即清空且旧回调无效', async () => {
    const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); calls[0]!.emit({ type: 'delta', text: '私有部分' }); login('bob')
    calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await task
    expect(a.text.value).toBe(''); expect(a.status.value).toBe('idle'); expect(calls[0]!.signal.aborted).toBe(true); a.dispose()
  })
  it('网络失败保留部分并标中断', async () => {
    const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); calls[0]!.emit({ type: 'delta', text: '部分' }); calls[0]!.reject(new Error('fake-private-network')); await task
    expect(a.text.value).toBe('部分'); expect(a.status.value).toBe('interrupted'); expect(a.error.value).not.toContain('fake-private'); a.dispose()
  })
  it('没有正文的服务错误为error', async () => {
    const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); calls[0]!.emit({ type: 'error', code: 'MODEL_TIMEOUT' }); calls[0]!.resolve(); await task
    expect(a.status.value).toBe('error'); expect(a.error.value).toContain('超时'); a.dispose()
  })
  it('忙时禁止重复发起，reset取消并清空', async () => {
    const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); await a.start('T1', '重复'); expect(calls).toHaveLength(1)
    a.reset(); calls[0]!.resolve(); await task; expect(a.status.value).toBe('idle'); expect(calls[0]!.signal.aborted).toBe(true); a.dispose()
  })
  it('dispose后旧结果无效且不能新建请求', async () => {
    const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); a.dispose(); calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await task
    await a.start('T2', '模拟'); expect(calls).toHaveLength(1); expect(a.text.value).toBe('')
  })
  it('无终止事件的transport返回也不能冒充成功', async () => {
    const { calls, assistant: a } = harness(); const task = a.start('T1', '模拟'); calls[0]!.emit({ type: 'delta', text: '部分' }); calls[0]!.resolve(); await task
    expect(a.status.value).toBe('interrupted'); a.dispose()
  })
  it('空问题不调用transport', async () => {
    const transport = vi.fn(); const a = useAssistant(transport); await a.start('T1', '  '); expect(transport).not.toHaveBeenCalled(); expect(a.status.value).toBe('error'); a.dispose()
  })
})
