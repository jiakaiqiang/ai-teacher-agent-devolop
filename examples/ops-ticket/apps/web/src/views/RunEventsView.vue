<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { eventTypeSchema, notificationStreamTicketSchema, runViewSchema, runListSchema, type RunView } from '@ops-ticket/shared'
import { useRoute } from 'vue-router'
import { getJson, postJson } from '../api/http'

const route = useRoute()
const runs = ref<RunView[]>([])
const selected = ref('')
const rows = ref<{ seq: number; label: string }[]>([])
const status = ref('读取运行列表…')
const attempt = ref(0)
const diagnosing = ref(false)
const diagnosisError = ref('')
async function diagnose() {
  const id = selected.value
  if (!id || diagnosing.value) return
  diagnosing.value = true
  diagnosisError.value = ''
  try {
    const run = await postJson('/api/agent/runs/' + encodeURIComponent(id) + '/diagnose', {}, runViewSchema)
    runs.value = runs.value.map(previous => previous.id === id ? run : previous)
  } catch (error) { diagnosisError.value = error instanceof Error ? error.message : '执行失败' }
  finally { diagnosing.value = false }
}
const listRequest = new AbortController()
onUnmounted(() => listRequest.abort())
onMounted(async () => {
  try {
    runs.value = await getJson('/api/agent/runs', runListSchema, listRequest.signal)
    selected.value = runs.value.find(run => run.id === route.query.id)?.id ?? runs.value[0]?.id ?? ''
    if (!selected.value) status.value = '还没有诊断运行'
  } catch { status.value = '读取运行列表失败' }
})

watch([selected, attempt], async ([id], previous, onCleanup) => {
  if (!id) return
  if (id !== previous[0]) rows.value = []
  const controller = new AbortController()
  let source: EventSource | undefined
  onCleanup(() => { controller.abort(); source?.close() })
  const after = rows.value.at(-1)?.seq ?? 0
  const base = '/api/agent/runs/' + encodeURIComponent(id)
  status.value = '连接中'
  try {
    const { ticket } = await postJson(base + '/stream-ticket', { after }, notificationStreamTicketSchema, controller.signal)
    if (controller.signal.aborted) return
    source = new EventSource(base + '/stream?ticket=' + encodeURIComponent(ticket))
    source.onopen = () => { status.value = '接收中' }
    for (const type of eventTypeSchema.options) {
      source.addEventListener(type, (event: MessageEvent<string>) => {
        const data = JSON.parse(event.data)
        if (data.seq > (rows.value.at(-1)?.seq ?? 0)) rows.value.push({ seq: data.seq, label: type === 'run_finished' ? type + ' · ' + (data.payload?.answer ?? data.payload?.stopReason) : type })
      })
    }
    const interrupted = () => { source?.close(); status.value = '连接已断开' }
    source.onerror = interrupted
    source.addEventListener('reauth', interrupted)
    source.addEventListener('closed', () => { source?.close(); status.value = '运行已结束' })
  } catch { if (!controller.signal.aborted) status.value = '连接已断开' }
})
</script>

<template>
  <main>
    <RouterLink to="/">返回工单列表</RouterLink>
    <h1>我的诊断运行</h1>
    <label v-if="runs.length">查看运行
      <select v-model="selected"><option v-for="run in runs" :key="run.id" :value="run.id">{{ run.ticketNo }} · {{ run.goal }} · {{ run.createdAt }}</option></select>
    </label>
    <button v-if="runs.find(run => run.id === selected)?.status === 'queued'" :disabled="diagnosing" @click="diagnose">执行诊断</button>
    <p v-if="diagnosisError" role="alert">{{ diagnosisError }}</p>
    <p role="status">{{ status }}</p>
    <button v-if="status === '连接已断开'" @click="attempt++">从上次事件继续</button>
    <ol><li v-for="row in rows" :key="row.seq">{{ row.seq }} · {{ row.label }}</li></ol>
  </main>
</template>
