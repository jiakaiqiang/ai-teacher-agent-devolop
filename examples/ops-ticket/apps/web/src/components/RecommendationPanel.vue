<script setup lang="ts">
import { watch } from 'vue'
import { session } from '../api/session'
import { useRecommendations } from '../composables/useRecommendations'
const props = defineProps<{ ticketNo: string }>()
const { state, items, load, clear } = useRecommendations()
watch([() => props.ticketNo, () => session.value?.accessToken], ([no, identity], _, cleanup) => {
  if (identity && no) void load(no)
  else clear()
  cleanup(clear)
}, { immediate: true, flush: 'sync' })
</script>

<template>
  <section aria-labelledby="recommendations-heading" class="recommendations">
    <h2 id="recommendations-heading">处置参考</h2>
    <p v-if="state === 'loading'" role="status">正在查找相关手册和已发布方案…</p>
    <div v-else-if="state === 'failed'">
      <p role="status">暂时无法读取处置参考。</p>
      <button type="button" @click="load(ticketNo)">重试检索</button>
    </div>
    <p v-else-if="state === 'ready' && !items.length" role="status">当前可见范围内没有可用引用。</p>
    <ul v-else-if="items.length">
      <li v-for="item in items" :key="item.sourceKey">
        <strong>{{ item.title }}</strong>
        <blockquote>{{ item.quote }}</blockquote>
        <small>{{ item.sourceKey.startsWith('manual:') ? '运维手册' : '已发布方案' }} · 版本 {{item.version.slice(0,8)}} · 原文码点 [{{ item.start }}, {{ item.end }})</small>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recommendations ul { padding-inline-start: 1.4rem; }
.recommendations li { margin-block: .8rem; }
.recommendations blockquote { white-space: pre-wrap; overflow-wrap: anywhere; margin: .4rem 0; }
.recommendations small { display: block; }
</style>
