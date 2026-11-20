<script setup lang="ts">
defineProps<{ tools: { callId: string; name: string; arguments: string; content: string | null }[] }>()
const labels: Record<string,string> = { find_ticket:'查询工单',list_ticket_logs:'查询设备告警',list_ticket_history:'查询处理记录' }
function pretty(text: string) { try { return JSON.stringify(JSON.parse(text),null,2) } catch { return text } }
</script>
<template>
  <ul class="tools" aria-label="实际工具调用记录">
    <li v-for="tool in tools" :key="tool.callId">
      <details>
        <summary>{{ labels[tool.name] ?? '只读查询' }} · {{ tool.content === null ? '已开始，结果待确认' : '结果已返回' }}</summary>
        <p>查询参数</p><pre>{{ pretty(tool.arguments) }}</pre>
        <template v-if="tool.content !== null"><p>本次查询结果</p><pre>{{ pretty(tool.content) }}</pre></template>
        <p v-else>尚未收到结果；停止或连接中断不代表查询成功。</p>
      </details>
    </li>
  </ul>
</template>
<style scoped>
.tools{list-style:none;padding:0;display:grid;gap:8px}.tools li{border:1px solid #cbd5e1;border-radius:6px;padding:10px;background:#f8fafc}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;max-height:320px;overflow:auto}summary:focus-visible{outline:2px solid #155eab;outline-offset:3px}
</style>
