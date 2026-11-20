<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { z } from 'zod'
import { useCountdown } from '../composables/useCountdown'
import { ApiError, getJson, postJson } from '../api/http'

const router = useRouter()
const { remaining, start } = useCountdown()
const categories = ref<{name:string}[]>([])
const category = ref('')
const title = ref('')
const description = ref('')
const logs = ref('')
const message = ref('')
const busy = ref(false)
let previous = ''
let key = ''
onMounted(async () => {
  try { categories.value = await getJson('/api/categories',z.array(z.object({name:z.string()}))) }
  catch { message.value = '分类加载失败，请重新打开报障页' }
})
async function submit() {
  if (busy.value || remaining.value) return
  busy.value = true
  const data = {category:category.value,title:title.value.trim(),description:description.value.trim(),logs:logs.value.split('\n').filter(Boolean)}
  const encoded = JSON.stringify(data)
  if (previous !== encoded) { key = crypto.randomUUID(); previous = encoded }
  try {
    const row = await postJson('/api/tickets',data,z.object({ticketNo:z.string()}),undefined,{'Idempotency-Key':key})
    await router.push('/tickets/'+encodeURIComponent(row.ticketNo))
  } catch (error) {
    if (error instanceof ApiError && error.retryAfterSeconds > 0) start(error.retryAfterSeconds)
    message.value = error instanceof Error ? error.message : '提交失败，请重试'
  } finally { busy.value = false }
}
</script>
<template>
  <form @submit.prevent="submit">
    <h2>上报问题</h2>
    <label>问题分类 <select v-model="category" required><option value="" disabled>请选择</option>
      <option v-for="item in categories" :key="item.name">{{ item.name }}</option></select></label>
    <label>标题 <input v-model="title" required></label>
    <label>问题描述 <textarea v-model="description" required /></label>
    <label>日志（每行一条） <textarea v-model="logs" /></label>
    <button :disabled="busy || remaining > 0">{{ remaining ? remaining + ' 秒后可重试' : '提交工单' }}</button><p v-if="message" role="alert">{{ message }}</p>
  </form>
</template>
