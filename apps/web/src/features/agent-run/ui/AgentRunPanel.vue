<script setup lang="ts">
import type { AgentRunState } from '@/domain/agent/agent-run-state'

// 组件只接 state prop，不知道也不关心事件从哪来
defineProps<{ state: AgentRunState }>()
</script>

<template>
  <section aria-labelledby="agent-run-title">
    <header>
      <h2 id="agent-run-title">诊断执行</h2>
      <output :data-status="state.status">{{ state.status }}</output>
    </header>

    <ol aria-live="polite">
      <li
        v-for="item in state.timeline"
        :key="item.key"
        :data-kind="item.kind"
      >
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail" style="white-space: pre-wrap;">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
output[data-status='running'] { color: orange; }
output[data-status='awaiting-approval'] { color: goldenrod; }
output[data-status='completed'] { color: green; }
output[data-status='failed'] { color: red; }
output[data-status='cancelled'] { color: gray; }

li[data-kind='tool'] { border-left: 3px solid steelblue; padding-left: 8px; }
li[data-kind='approval'] { border-left: 3px solid gold; padding-left: 8px; }
li[data-kind='error'] { border-left: 3px solid crimson; padding-left: 8px; }
li[data-kind='result'] { border-left: 3px solid green; padding-left: 8px; }
</style>