<script setup lang="ts">
import { useAgentRun } from '@/composables/useAgentRun'
import AgentRunPanel from '@/features/agent-run/ui/AgentRunPanel.vue'
import { sampleRun, sampleErrorRun } from '@/features/agent-run/fixtures/sample-run'

const { state, play, reset } = useAgentRun()
</script>

<template>
  <main style="padding: 24px; max-width: 720px">
    <h1>Agent 运行面板</h1>
    <el-space style="margin-bottom: 16px">
      <el-button type="primary" @click="play(sampleRun)">播放正常序列</el-button>
      <el-button type="danger" @click="play(sampleErrorRun)">播放错误序列</el-button>
      <el-button @click="reset">重置</el-button>
    </el-space>
    <AgentRunPanel :state="state" />
  </main>
</template>
