<script setup lang="ts">
import { session } from '../api/session'
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getJson } from '../api/http'
import { z } from 'zod'
import { useTicketList } from '../composables/useTicketList'
const total = ref<number>()
const statsError = ref(false)
onMounted(async()=>{try {total.value=await getJson('/api/tickets/stats/count',z.number().int())}catch{statsError.value=true}})
const company = ref<string>()
const { items, loading, error, hasMore, loadMore, reset, stop } = useTicketList(company)
onMounted(reset)
onBeforeUnmount(stop)
</script>
<template>
  <section>
    <h2>工单列表</h2><RouterLink v-if="session?.user.role==='reporter'" to="/report">上报问题</RouterLink><p v-if="total!==undefined">我可见的工单共 {{ total }} 张</p><p v-else-if="statsError" role="status">统计暂不可用</p>
    <label>练习数据范围 <select v-model="company">
      <option :value="undefined">全部</option><option>甲公司</option><option>乙公司</option>
    </select></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul><li v-for="item in items" :key="item.ticketNo">
      <RouterLink :to="'/tickets/' + item.ticketNo">{{ item.ticketNo }} · {{ item.title }}</RouterLink>
    </li></ul>
    <button v-if="hasMore" :disabled="loading" @click="loadMore">加载更多</button>
    <p v-else-if="!items.length">暂无工单</p>
  </section>
</template>
