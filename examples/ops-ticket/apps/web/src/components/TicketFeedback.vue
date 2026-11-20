<script setup lang="ts">
import { session } from '../api/session'
import { feedbackActions } from '../api/feedback-actions'
import { ref } from 'vue'
import type { TicketStatus } from '@ops-ticket/shared'
const props = defineProps<{ticketNo:string; version:number; status:TicketStatus; canConfirm:boolean}>()
const emit = defineEmits<{reload:[]}>()
const message = ref('')
const busy = ref(false)
async function act(action:string) {
  if (busy.value) return
  busy.value = true
  try {
    const res = await fetch('/api/tickets/'+encodeURIComponent(props.ticketNo)+'/actions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.value?.accessToken},
      body:JSON.stringify({action,version:props.version}),
    })
    if (res.status===409) message.value='工单已变化，请核对最新状态后操作'
    else if (!res.ok) {message.value='提交失败，请核对操作权限';return}
    else message.value='反馈已提交'
    emit('reload')
  } catch {message.value='网络中断，请刷新核对结果'}
  finally {busy.value=false}
}
</script>
<template>
  <div v-if="feedbackActions(status,canConfirm).includes('request_human')">
    <button :disabled="busy" @click="act('request_human')">人工接入</button>
  </div>
  <div v-if="feedbackActions(status,canConfirm).includes('resolved')">
    <button :disabled="busy" @click="act('resolved')">已解决</button>
    <button :disabled="busy" @click="act('unresolved')">未解决</button>
  </div>
  <p v-if="message" role="status">{{message}}</p>
</template>
