import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'
import { appendFileSync } from 'node:fs'
import type { AssistantEvent } from '@ops-ticket/shared'
import { setSession } from '../api/session'
import type { streamAssistant } from '../api/assistant'
import { useTicketAssistant } from './useTicketAssistant'
beforeEach(() => setSession({ accessToken: 'fake', user: { username: 'alice', displayName: '模拟' } }))
afterEach(() => setSession(null))
function harness() {
  const calls: { ticket: string; signal: AbortSignal; emit: (event: AssistantEvent) => void; resolve: () => void }[] = []
  const transport: typeof streamAssistant = (ticket, _q, _t, signal, emit) => new Promise((resolve) => calls.push({ ticket, signal, emit, resolve }))
  const ticket = ref('T1'); const scope = effectScope(); const a = scope.run(() => useTicketAssistant(() => ticket.value, transport))!
  return { calls, ticket, scope, a }
}
describe('工单助手接线（D48）', () => {
  it('切工单立即清空取消且不接受迟到片段', async () => {
    const { calls, ticket, scope, a } = harness(); const task = a.generate('模拟'); calls[0]!.emit({ type: 'delta', text: '旧工单内容' }); ticket.value = 'T2'
    expect(a.text.value).toBe(''); expect(calls[0]!.signal.aborted).toBe(true)
    calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await task; expect(a.text.value).toBe('')
    if (process.env.D48_EVIDENCE_FILE) appendFileSync(process.env.D48_EVIDENCE_FILE, JSON.stringify({ case: 'ticket-switch', text: a.text.value, aborted: calls[0]!.signal.aborted }) + '\n')
    scope.stop()
  })
  it('新生成使用当前工单号', async () => {
    const { calls, ticket, scope, a } = harness(); ticket.value = 'T2'; const task = a.generate('模拟'); expect(calls[0]!.ticket).toBe('T2')
    calls[0]!.emit({ type: 'done', finishReason: 'stop' }); calls[0]!.resolve(); await task; scope.stop()
  })
  it('作用域结束取消且不接受结果', async () => {
    const { calls, scope, a } = harness(); const task = a.generate('模拟'); scope.stop(); expect(calls[0]!.signal.aborted).toBe(true)
    calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await task; expect(a.text.value).toBe('')
  })
});
