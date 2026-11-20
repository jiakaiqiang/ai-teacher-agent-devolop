<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTicketAssistant } from '../composables/useTicketAssistant'
const props = defineProps<{ ticketNo: string }>()
const { text, status, mode, error, busy, generate, stop } = useTicketAssistant(() => props.ticketNo)
const question = ref('请给出这张模拟工单的排查步骤'); const generateButton = ref<HTMLButtonElement>()
const labels = { idle: '等待提问', connecting: '正在连接…', streaming: '正在生成…', completed: '生成完成', truncated: '已达到长度限制，内容不完整', stopped: '已停止，保留部分内容', interrupted: '生成中断，保留部分内容', error: '生成失败' }
const statusText = computed(() => labels[status.value])
watch(() => props.ticketNo, () => { question.value = '请给出这张模拟工单的排查步骤' })
async function stopAndFocus() { stop(); await nextTick(); generateButton.value?.focus() }
</script>

<template>
  <section class="assistant" aria-labelledby="assistant-heading">
    <h3 id="assistant-heading">AI 排查助手</h3>
    <p id="assistant-help" class="muted">仅用于模拟工单练习。建议需人工核实，不会自动执行操作。</p>
    <form @submit.prevent="generate(question)">
      <label for="assistant-question">排查问题（1—1000 字）</label>
      <textarea id="assistant-question" v-model="question" required maxlength="1000" rows="3"
        :readonly="busy" aria-describedby="assistant-help assistant-error" />
      <div class="controls">
        <button ref="generateButton" type="submit" :disabled="busy || !question.trim()">生成建议</button>
        <button type="button" :disabled="!busy" @click="stopAndFocus">停止生成</button>
        <span v-if="mode === 'mock'" class="badge">模拟输出</span>
        <span v-else-if="mode === 'model'" class="badge">模型输出</span>
      </div>
    </form>
    <p role="status" aria-live="polite">{{ statusText }}</p>
    <p id="assistant-error" class="error" role="alert">{{ error }}</p>
    <!-- 只渲染文本；逐段内容不放进live区域，避免不断重复播报。 -->
    <div class="answer" aria-label="排查建议" :aria-busy="busy">{{ text || '生成后的建议会显示在这里。' }}</div>
  </section>
</template>

<style scoped>
.assistant { margin-top: 24px; border-top: 1px solid #d0d7de; padding-top: 16px; min-width: 0; }
h3 { margin: 0 0 8px; }
.muted { color: #57606a; font-size: 14px; }
label { display: block; margin-bottom: 6px; }
textarea { box-sizing: border-box; width: 100%; padding: 8px; font: inherit; resize: vertical; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
button { min-height: 36px; padding: 6px 12px; }
button:focus-visible, textarea:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }
.badge { padding: 3px 8px; background: #ddf4ff; color: #0550ae; border-radius: 4px; font-size: 13px; }
.answer { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #f6f8fa; line-height: 1.7; min-height: 48px; }
.error { color: #cf222e; }
.error:empty { display: none; }
</style>
