import { ref, watch, onScopeDispose } from 'vue'
import type { SessionSummary, SessionDetail, ToolSessionEvent } from '@ops-ticket/shared'
import { session } from '../api/session'
import { listToolSessions, createToolSession, getToolSession, streamToolSession, type TurnInput } from '../api/toolSessions'
import { ApiError } from '../api/http'

interface Dependencies {
  list: typeof listToolSessions; create: typeof createToolSession; get: typeof getToolSession
  stream: (id: string, input: TurnInput, token: string, signal: AbortSignal, receive: (event: ToolSessionEvent) => void) => Promise<void>
  key: () => string
}
interface LiveTool { callId: string; name: string; arguments: string; content: string | null }
export interface LiveTurn { question: string; runId: string | null; mode: 'mock' | 'model' | null; replay: boolean; text: string; tools: LiveTool[]; status: 'running' | 'stopped' | 'error'; }
const defaults: Dependencies = { list: listToolSessions, create: createToolSession, get: getToolSession, stream: streamToolSession, key: () => crypto.randomUUID() }
export function toolSessionMessage(code: string) {
  if (/SCOPE_CHANGED|RESOURCE_CHANGED/.test(code)) return '权限或资源归属已变化，无法继续查看此会话。请新建会话。'
  if (/BUSY/.test(code)) return '该会话仍在处理，请稍后刷新状态。'
  if (/VERSION_CONFLICT/.test(code)) return '会话已在其他页面更新，请刷新后再发送。'
  if (/QUOTA/.test(code)) return '今日额度不足，请稍后再试。'
  if (/NOT_FOUND|FORBIDDEN|UNAUTHENTICATED/.test(code)) return '会话或资源不可访问，请检查登录和权限。'
  if (/LIMIT/.test(code)) return '已达到本次会话的数量或内容上限。'
  if (/STREAM_INTERRUPTED|HTTP_ERROR/.test(code)) return '连接中断，请刷新查看已保存状态；不会自动重复执行。'
  return '本轮未完成，请刷新查看状态后再决定是否发送新问题。'
}

export function useStoredConversations(getToken = () => session.value?.accessToken, dependencies: Partial<Dependencies> = {}) {
  const api = { ...defaults, ...dependencies }
  const items = ref<SessionSummary[]>([]), detail = ref<SessionDetail | null>(null), live = ref<LiveTurn | null>(null)
  const phase = ref<'idle' | 'loading' | 'sending'>('idle'), error = ref(''), notice = ref('')
  let epoch = 0, controller: AbortController | undefined, disposed = false
  const begin = () => { controller?.abort(); const current = ++epoch; controller = new AbortController(); return { current, controller, token: getToken() } }
  const valid = (task: ReturnType<typeof begin>) => !disposed && task.current === epoch && task.token === getToken() && !task.controller.signal.aborted
  const fail = (value: unknown) => toolSessionMessage(value instanceof ApiError ? value.code : value instanceof Error ? value.message : '')
  function reset() { ++epoch; controller?.abort(); controller = undefined; items.value = []; detail.value = null; live.value = null; phase.value = 'idle'; error.value = ''; notice.value = '' }
  async function load() {
    const task = begin(); phase.value = 'loading'; error.value = ''
    try { const rows = await api.list(task.controller.signal); if (valid(task)) items.value = rows }
    catch (e) { if (valid(task)) error.value = fail(e) }
    finally { if (task.current === epoch) phase.value = 'idle' }
  }
  async function select(id: string) {
    const task = begin(); phase.value = 'loading'; error.value = ''; notice.value = ''; live.value = null; detail.value = null
    try { const value = await api.get(id, task.controller.signal); if (valid(task)) detail.value = value }
    catch (e) { if (valid(task)) error.value = fail(e) }
    finally { if (task.current === epoch) phase.value = 'idle' }
  }
  async function create(title: string) {
    if (!title.trim() || title.trim().length > 200) return false
    const task = begin(); phase.value = 'loading'; error.value = ''; notice.value = ''; live.value = null
    try {
      const created = await api.create(title.trim(), task.controller.signal)
      if (!valid(task)) return false
      const [value, rows] = await Promise.all([api.get(created.id, task.controller.signal), api.list(task.controller.signal)])
      if (!valid(task)) return false
      detail.value = value; items.value = rows; return true
    } catch (e) { if (valid(task)) error.value = fail(e); return false }
    finally { if (task.current === epoch) phase.value = 'idle' }
  }
  async function send(question: string) {
    const current = detail.value
    if (phase.value !== 'idle' || live.value || !current || current.conversation.activeTurnId || !question.trim() || question.trim().length > 2000) return false
    const task = begin(); if (!task.token) { reset(); return false }
    phase.value = 'sending'; error.value = ''; notice.value = ''
    live.value = { question: question.trim(), runId: null, mode: null, replay: false, text: '', tools: [], status: 'running' }
    const timer = setTimeout(() => { if (valid(task)) { task.controller.abort(); if (live.value) live.value.status = 'error'; error.value = '等待超时，请刷新查看服务端状态。'; phase.value = 'idle' } }, 45000)
    try {
      await api.stream(current.conversation.id, { question: question.trim(), version: current.conversation.version, requestKey: api.key() }, task.token, task.controller.signal, event => {
        if (!valid(task) || !live.value) return
        const run = live.value
        if (event.type === 'meta') { run.runId = event.runId; run.mode = event.mode; run.replay = event.replay }
        if (event.type === 'tool-start') run.tools.push({ callId: event.callId, name: event.name, arguments: event.arguments, content: null })
        if (event.type === 'tool-result') { const tool = run.tools.find(tool => tool.callId === event.callId); if (tool) tool.content = event.content }
        if (event.type === 'answer') run.text = event.text
        if (event.type === 'done') notice.value = `已保存。本次教学额度 ${event.billing.units} 单位（${event.billing.status === 'exact' ? '已知用量' : '保守估算'}）。`
        if (event.type === 'error') { run.status = 'error'; error.value = toolSessionMessage(event.code) }
      })
      if (!valid(task)) return false
      const value = await api.get(current.conversation.id, task.controller.signal)
      if (!valid(task)) return false
      detail.value = value; live.value = null
      const rows = await api.list(task.controller.signal); if (valid(task)) items.value = rows
      return !error.value
    } catch (e) { if (valid(task)) { error.value = fail(e); if (live.value) live.value.status = 'error' } return false }
    finally { clearTimeout(timer); if (task.current === epoch) phase.value = 'idle' }
  }
  function stop() {
    if (phase.value !== 'sending') return
    controller?.abort(); phase.value = 'idle'; if (live.value) live.value.status = 'stopped'
    notice.value = '已停止等待，保留本页已收到的内容。请刷新查看最终保存状态。'
  }
  async function refresh() { const id = detail.value?.conversation.id; if (id) await select(id); else await load() }
  watch(getToken, reset, { flush: 'sync' })
  onScopeDispose(() => { disposed = true; reset() })
  return { items, detail, live, phase, error, notice, load, select, create, send, stop, refresh, reset }
}
