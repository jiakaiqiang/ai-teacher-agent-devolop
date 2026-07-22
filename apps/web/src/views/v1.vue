<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import AgentRunPanel from '@/features/agent-run/ui/AgentRunPanel.vue'
import { sampleEvents } from '@/features/agent-run/fixtures/sample-run'
import { initialAgentRunState, reduceAgentEvent } from '@/domain/agent/agent-run-state'
import type { AgentEvent } from '@/domain/agent/agent-event'

// 实时收到的事件（模拟 WebSocket 一条一条推）
const receivedEvents = ref<AgentEvent[]>([])

// 每次 receivedEvents 变化，从头 reduce 一遍得到最新状态
// Day 5 会改成"增量 reduce"，只处理新事件
const state = computed(() =>
  receivedEvents.value.reduce(reduceAgentEvent, initialAgentRunState),
)

// 模拟事件按时间到达
onMounted(() => {
  sampleEvents.forEach((event, i) => {
    setTimeout(() => receivedEvents.value.push(event), (i + 1) * 800)
  })
})
</script>

<template>
  <AgentRunPanel :state="state" />
</template>