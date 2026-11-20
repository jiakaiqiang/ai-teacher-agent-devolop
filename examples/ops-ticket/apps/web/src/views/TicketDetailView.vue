<script setup lang="ts">
import { ref, watch } from 'vue'
import ConversationPanel from '../components/ConversationPanel.vue'
import RecommendationPanel from '../components/RecommendationPanel.vue'
import StaffActions from '../components/StaffActions.vue'
import TicketFeedback from '../components/TicketFeedback.vue'
import { useRoute } from 'vue-router'
import type { TicketDetail } from '@ops-ticket/shared'
import { getTicket } from '../api/tickets'
const refresh = ref(0)
const route = useRoute()
const ticket = ref<TicketDetail>()
const error = ref('')
watch([() => String(route.params.ticketNo), refresh], async ([no], _, cleanup) => {
  const controller = new AbortController()
  cleanup(() => controller.abort())
  ticket.value = undefined
  error.value = ''
  try {
    const result = await getTicket(no, controller.signal)
    if (!controller.signal.aborted) ticket.value = result
  } catch {
    if (!controller.signal.aborted) error.value = '工单加载失败'
  }
}, { immediate: true })
</script>
<template>
  <RouterLink to="/">返回工单列表</RouterLink>
  <p v-if="error" role="alert">{{ error }}</p>
  <article v-if="ticket"><h2>{{ ticket.ticketNo }} · {{ ticket.title }}</h2>
    <p>{{ ticket.company.name }} · {{ ticket.category.name }} · {{ ticket.department.name }}</p>
    <p>{{ ticket.description }}</p><h3>报障材料</h3>
    <pre v-for="(m, i) in ticket.materials" :key="i">{{ m.logText }}</pre>
  
    <h3>处理记录</h3>
    <ol><li v-for="(event,i) in ticket.events" :key="i">{{event.actor?.displayName ?? 'Agent'}} · {{event.action}} · {{event.toStatus}}<pre v-if="event.comment">{{ event.comment }}</pre></li></ol>
    <RouterLink v-if="ticket.canConfirm" to="/assistant">打开持久会话</RouterLink>
    <ConversationPanel v-if="ticket.canConfirm" :ticket-no="ticket.ticketNo" />
    <RouterLink v-if="ticket.canConfirm" to="/agent/runs">查看诊断运行</RouterLink>
    <RecommendationPanel :ticket-no="ticket.ticketNo" />
    <StaffActions :ticket-no="ticket.ticketNo" :version="ticket.version" @reload="refresh++" />
    <TicketFeedback :can-confirm="ticket.canConfirm" :ticket-no="ticket.ticketNo" :status="ticket.status" :version="ticket.version" @reload="refresh++"/>
  </article>
</template>
