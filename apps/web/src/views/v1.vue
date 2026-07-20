<script setup lang="ts">
import { ref } from 'vue'

// 你熟悉的 Vue 响应式：几个 ref 描述 UI 状态
const status = ref<'idle' | 'running' | 'completed'>('idle')
const text = ref('')

// 假的事件流：一秒后开始，然后每 300ms 追加一段文字，最后完成
function startFakeRun() {
  status.value = 'running'
  text.value = ''

  const chunks = [
    '正在检查服务器 srv-042 的 CPU 指标...',
    '\n\n最近 10 分钟平均 CPU 为 87%，超过阈值。',
    '\n\n建议进一步排查异常进程。',
  ]

  chunks.forEach((chunk, i) => {
    setTimeout(() => {
      text.value += chunk  // 追加到已有文本后面
      if (i === chunks.length - 1) {
        status.value = 'completed'
      }
    }, (i + 1) * 800)
  })
}
</script>

<template>
  <section>
    <header>
      <h2>诊断执行</h2>
      <output :data-status="status">{{ status }}</output>
    </header>

    <button @click="startFakeRun" :disabled="status === 'running'">
      开始诊断
    </button>

    <p style="white-space: pre-wrap;">{{ text }}</p>
  </section>
</template>

<style scoped>
output[data-status='running'] { color: orange; }
output[data-status='completed'] { color: green; }
</style>