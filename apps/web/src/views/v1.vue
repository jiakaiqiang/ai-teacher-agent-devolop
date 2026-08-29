<script setup lang="ts">
// import { computed, ref, onMounted } from 'vue'
// import AgentRunPanel from '@/features/agent-run/ui/AgentRunPanel.vue'
// import { sampleEvents } from '@/features/agent-run/fixtures/sample-run'
// import { initialAgentRunState, reduceAgentEvent } from '@/domain/agent/agent-run-state'
// import type { AgentEvent } from '@/domain/agent/agent-event'

// // 实时收到的事件（模拟 WebSocket 一条一条推）
// const receivedEvents = ref<AgentEvent[]>([])

// // 每次 receivedEvents 变化，从头 reduce 一遍得到最新状态
// // Day 5 会改成"增量 reduce"，只处理新事件
// const state = computed(() =>
//   receivedEvents.value.reduce(reduceAgentEvent, initialAgentRunState),
// )

// // 模拟事件按时间到达
// onMounted(() => {
//   sampleEvents.forEach((event, i) => {
//     setTimeout(() => receivedEvents.value.push(event), (i + 1) * 800)
//   })
// })
// import type { Server } from '@/domain/contracts/domain/server'

// // 从网络拿到的数据
// const rawData: unknown = {
//       id:'12',
//     name: '张三',
//     ip: '10.173.30.75',
//     status: 'online',
//     tags: [],
// }

// // v1 的做法：直接强断言
// const server = rawData as Server

// console.log(server.name)  // 如果后端返回的 rawData 没有 name 字段，这里会是 undefined，但 TS 认为它是 string


import { toServer } from '@/domain/contracts/adapters/dto-to-domain'

const rawData: unknown = await fetch('/api/servers/srv-001').then(r => r.json())

const server = toServer(rawData)

if (server === null) {
  // 校验失败，rawData 不符合 ServerSchema
  console.error('Invalid server data')
} else {
  // 校验通过，server 是合法的 Server 对象
  console.log(server.name)
}

console.log('server', server)
</script>

<template>
  <!-- <AgentRunPanel :state="state" /> -->
</template>