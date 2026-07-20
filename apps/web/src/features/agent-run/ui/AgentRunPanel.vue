<script setup lang="ts">
// 纯展示(dumb)组件：只根据传入的 state 渲染，不含任何逻辑、不发请求、不改状态。
import type { AgentRunState, RunStatus } from '@/domain/agent/agent-run-state'

defineProps<{ state: AgentRunState }>()

const statusMeta: Record<RunStatus, { label: string; type: 'info' | 'primary' | 'success' | 'danger' | 'warning' }> = {
  idle: { label: '空闲', type: 'info' },
  running: { label: '运行中', type: 'primary' },
  done: { label: '完成', type: 'success' },
  error: { label: '出错', type: 'danger' },
  cancelled: { label: '已取消', type: 'warning' },
}

const toolStatusLabel: Record<string, string> = {
  running: '调用中',
  done: '成功',
  error: '失败',
}
</script>

<template>
  <div class="agent-run-panel">
    <header class="panel-header">
      <el-tag :type="statusMeta[state.status].type" size="large">
        {{ statusMeta[state.status].label }}
      </el-tag>
      <span v-if="state.runId" class="run-id">{{ state.runId }}</span>
    </header>

    <el-alert
      v-if="state.status === 'error' && state.error"
      :title="state.error"
      type="error"
      :closable="false"
      show-icon
    />

    <section v-if="state.message" class="message">
      <h4>助手消息</h4>
      <p>{{ state.message }}</p>
    </section>

    <section v-if="state.toolCalls.length" class="tool-calls">
      <h4>工具调用</h4>
      <ul>
        <li v-for="tc in state.toolCalls" :key="tc.id">
          <el-tag size="small">{{ tc.name }}</el-tag>
          <span class="tool-status">{{ toolStatusLabel[tc.status] ?? tc.status }}</span>
          <span v-if="tc.result !== undefined" class="tool-result">
            → {{ JSON.stringify(tc.result) }}
          </span>
          <span v-if="tc.error" class="tool-error">→ {{ tc.error }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.agent-run-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.run-id {
  color: var(--el-text-color-secondary);
  font-family: monospace;
  font-size: 12px;
}
.message p {
  margin: 4px 0 0;
  white-space: pre-wrap;
}
.tool-calls ul {
  margin: 4px 0 0;
  padding-left: 0;
  list-style: none;
}
.tool-calls li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.tool-status {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.tool-result {
  font-family: monospace;
  font-size: 12px;
}
.tool-error {
  color: var(--el-color-danger);
  font-size: 12px;
}
</style>
