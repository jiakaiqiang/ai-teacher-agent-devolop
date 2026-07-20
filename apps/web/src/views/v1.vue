<script setup lang="ts">
import { useAgentRun, type AgentEvent } from '../composables/useAgentRun'

const { status, timeline, pushEvent } = useAgentRun()

// 假事件序列
const fakeEvents: AgentEvent[] = [
  { type: 'run.started' },
  { type: 'text.delta', text: '正在检查服务器 srv-042 的 CPU 指标...' },
  { type: 'tool.started', callId: 'c1', toolName: 'read_metrics', args: 'last 10min' },
  { type: 'tool.succeeded', callId: 'c1', result: 'CPU 平均 87%，异常', durationMs: 1800 },
  { type: 'text.delta', text: '检测到 CPU 持续过载，建议重启异常进程。' },
  { type: 'approval.required', approvalId: 'a1', action: 'restart_process', risk: 'high' },
]

function startFakeRun() {
  fakeEvents.forEach((event, i) => {
    setTimeout(() => pushEvent(event), (i + 1) * 700)
  })
}
</script>

<template>
  <section>
    <header>
      <h2>诊断执行</h2>
      <output :data-status="status">{{ status }}</output>
    </header>

    <button @click="startFakeRun" :disabled="status !== 'idle' && status !== 'completed'">
      开始诊断
    </button>

    <ol>
      <li v-for="item in timeline" :key="item.key" :data-kind="item.kind">
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail" style="white-space: pre-wrap;">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>