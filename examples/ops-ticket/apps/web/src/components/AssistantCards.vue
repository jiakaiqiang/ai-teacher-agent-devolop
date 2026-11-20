<script setup lang="ts">
import type { Generation } from '../assistant/generation'
defineProps<{cards:Generation['cards']}>()
</script>
<template>
  <ul v-if="cards.length" class="assistant-cards" aria-label="模拟展示卡片">
    <li v-for="card in cards" :key="card.cardId">
      <strong>模拟演示 · {{ card.type==='tool' ? '工具状态' : card.type==='citation' ? '引用资料' : '结构化结果' }}</strong>
      <template v-if="card.type==='tool'"><p>{{card.label}}：{{card.state==='running'?'进行中':card.state==='completed'?'已完成':'失败'}}</p></template>
      <template v-else-if="card.type==='citation'"><p>{{card.title}}</p><blockquote>{{card.excerpt}}</blockquote></template>
      <template v-else><p>{{card.title}}</p><ul><li v-for="(item,index) in card.items" :key="index">{{item}}</li></ul></template>
    </li>
  </ul>
</template>
<style scoped>
.assistant-cards {list-style:none;padding:0;display:grid;gap:.5rem}
.assistant-cards>li {border:1px solid #cbd5e1;border-radius:6px;padding:.75rem;background:#f8fafc}
blockquote {margin:.5rem 0;padding-left:.75rem;border-left:3px solid #94a3b8}
</style>
