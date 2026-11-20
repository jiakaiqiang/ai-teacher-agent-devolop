import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'
import type { AssistantEvent } from '@ops-ticket/shared'
import { useConversation } from './useConversation'
import { setSession } from '../api/session'
import type { streamAssistant } from '../api/assistant'
const login = (name = 'alice') => setSession({ accessToken: `fake-${name}`, user: { username: name, displayName: name } })
const report = (value: object) => { if (process.env.D51_EVIDENCE_FILE) appendFileSync(process.env.D51_EVIDENCE_FILE, JSON.stringify(value) + '\n') }
const cleanup: (() => void)[] = []
function harness() {
  const ticket = ref('T1')
  const calls: { prompt: string; signal: AbortSignal; emit: (event: AssistantEvent) => void; resolve: () => void; reject: (cause: Error) => void }[] = []
  const transport: typeof streamAssistant = (_ticket, prompt, _token, signal, emit) => new Promise((resolve, reject) => calls.push({ prompt, signal, emit, resolve, reject }))
  const a = useConversation(() => ticket.value, transport); cleanup.push(a.dispose)
  const finish = (index: number, text = '模拟') => { const c = calls[index]!; c.emit({ type: 'meta', mode: 'mock' }); c.emit({ type: 'delta', text }); c.emit({ type: 'done', finishReason: 'stop' }); c.resolve() }
  return { a, calls, finish, ticket }
}
beforeEach(() => login())
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); setSession(null); vi.useRealTimers() })
describe('会话分支与异步归属（D51）', () => {
  it('连续问题构成路径且只发送当前问题', async () => {
    const { a, calls, finish } = harness(); const p = a.send('第一问'); finish(0); await p
    const q = a.send('第二问'); finish(1); await q
    expect(a.path.value.map(t => t.question)).toEqual(['第一问','第二问']); expect(calls.map(c => c.prompt)).toEqual(['第一问','第二问'])
    report({ case: 'conversation-path', questions: a.path.value.map(t => t.question), sentPrompts: calls.map(c => c.prompt) })
  })
  it('编辑历史保留旧分支及其后代', async () => {
    const { a, finish } = harness(); let p = a.send('一'); finish(0); await p; const first = a.activeLeaf.value!
    p = a.send('二'); finish(1); await p; const second = a.activeLeaf.value!
    p = a.fork(first, '修订一'); finish(2); await p
    expect(a.turns.value).toHaveLength(3); expect(a.path.value.map(t => t.question)).toEqual(['修订一'])
    expect(a.select(second)).toBe(true); expect(a.path.value.map(t => t.question)).toEqual(['一','二'])
    report({ case: 'preserved-branches', turns: a.turns.value.length, selectedPath: a.path.value.map(t => t.question) })
  })
  it('重生成创建兄弟节点和新的runId', async () => {
    const { a, finish } = harness(); const p = a.send('模拟'); finish(0); await p; const old = a.turns.value[0]!
    const q = a.fork(old.id); finish(1); await q
    expect(a.turns.value[1]!.parentId).toBe(old.parentId); expect(a.turns.value[1]!.run.runId).not.toBe(old.run.runId); expect(old.run.text).toBe('模拟')
  })
  it('停止保留部分且旧finally不能清理新请求', async () => {
    const { a, calls } = harness(); const old = a.send('旧'); calls[0]!.emit({ type: 'meta', mode: 'mock' }); calls[0]!.emit({ type: 'delta', text: '部分' }); a.stop()
    const next = a.fork(a.turns.value[0]!.id); calls[1]!.emit({ type: 'meta', mode: 'mock' }); calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await old
    expect(a.turns.value[0]!.run.text).toBe('部分'); expect(a.busy.value).toBe(true)
    a.stop(); expect(calls[1]!.signal.aborted).toBe(true); await next
  })
  it('旧回调不能投递到已停止run', async () => {
    const { a, calls } = harness(); const p = a.send('旧'); a.stop(); calls[0]!.emit({ type: 'meta', mode: 'mock' }); await p
    expect(a.turns.value[0]!.run.lastSeq).toBe(0); expect(a.turns.value[0]!.run.status).toBe('stopped')
  })
  it('忙时禁止重复请求与分支切换', async () => {
    const { a, calls } = harness(); const p = a.send('一'); expect(await a.send('二')).toBe(false); expect(a.select(a.activeLeaf.value!)).toBe(false); expect(calls).toHaveLength(1); a.stop(); await p
  })
  it('切工单同步清空并取消', async () => {
    const { a, calls, ticket } = harness(); const p = a.send('一'); ticket.value = 'T2'; expect(a.turns.value).toHaveLength(0); expect(calls[0]!.signal.aborted).toBe(true); await p
  })
  it('切身份同步清空并隔离旧结果', async () => {
    const { a, calls } = harness(); const p = a.send('一'); login('bob'); calls[0]!.emit({ type: 'meta', mode: 'mock' }); expect(a.turns.value).toHaveLength(0); await p
  })
  it('作用域卸载后不能继续发起', async () => {
    const scope = effectScope(); const fn = vi.fn(); const a = scope.run(() => useConversation(() => 'T1', fn))!; scope.stop(); expect(await a.send('模拟')).toBe(false); expect(fn).not.toHaveBeenCalled()
  })
  it('缺少终止与未知异常均不冒充完成', async () => {
    for (const throws of [true,false]) { const { a, calls } = harness(); const p = a.send('一'); calls[0]!.emit({ type:'meta', mode:'mock' }); calls[0]!.emit({ type:'delta',text:'部分' }); if (throws) calls[0]!.reject(new Error('private')); else calls[0]!.resolve(); await p; expect(a.turns.value[0]!.run.status).toBe('interrupted'); expect(a.turns.value[0]!.run.error).not.toContain('private') }
  })
  it('45秒客户端预算会结束不合作transport并保留部分', async () => {
    vi.useFakeTimers(); const { a, calls } = harness(); const p = a.send('一'); calls[0]!.emit({ type:'meta',mode:'mock' }); calls[0]!.emit({ type:'delta',text:'部分' }); await vi.advanceTimersByTimeAsync(45_000); await p
    expect(a.turns.value[0]!.run).toMatchObject({status:'interrupted', error:'MODEL_TIMEOUT',text:'部分'}); expect(calls[0]!.signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('空问题和未登录不发请求', async () => {
    const { a, calls } = harness(); expect(await a.send('  ')).toBe(false); setSession(null); expect(await a.send('模拟')).toBe(false); expect(calls).toHaveLength(0)
  })
  it('200节点上限保留全部旧记录', async () => {
    const { a, finish, calls } = harness(); for (let i=0;i<200;i++) { const p=a.send('q'); finish(i,''); await p }
    expect(await a.send('超限')).toBe(false); expect(calls).toHaveLength(200); expect(a.turns.value).toHaveLength(200)
  })
  it('字符预算拒绝新请求而不截断历史', async () => {
    const { a, finish, calls } = harness(); const p=a.send('q'); finish(0); await p
    a.turns.value[0]!.run.text = 'x'.repeat(970_000)
    expect(await a.send('q')).toBe(false); expect(a.turns.value[0]!.run.text).toHaveLength(970_000); expect(calls).toHaveLength(1)
  })
})
