<script setup lang="ts">
import { ref, watch } from 'vue'
import { z } from 'zod'
import { getJson, postJson } from '../api/http'
const props=defineProps<{ticketNo:string;version:number}>()
const emit=defineEmits<{reload:[]}>()
const labels={assign:'派单',handle:'提交处理结果',approve:'复核通过并发送',return:'退回处理人'}
const contract=z.object({actions:z.array(z.enum(['assign','handle','approve','return'])),
  operators:z.array(z.object({id:z.string(),displayName:z.string()}))})
const options=ref<z.infer<typeof contract>>()
const target=ref(''),comment=ref(''),error=ref(''),busy=ref(false)
watch(()=>[props.ticketNo,props.version],async(_,__,cleanup)=>{
  const ctrl=new AbortController(); cleanup(()=>ctrl.abort())
  options.value=undefined; target.value=''; comment.value=''; error.value=''
  try {const data=await getJson('/api/tickets/'+props.ticketNo+'/staff-actions',contract,ctrl.signal)
    if(!ctrl.signal.aborted) options.value=data
  }catch{if(!ctrl.signal.aborted) error.value='操作列表加载失败'}
},{immediate:true})
async function submit(action:keyof typeof labels) {
  if(busy.value) return
  busy.value=true
  try{
    await postJson('/api/tickets/'+props.ticketNo+'/actions',{action,version:props.version,
      ...(action==='assign'?{targetId:target.value}:{}),comment:comment.value},z.unknown())
    emit('reload')
  }catch(e){error.value=e instanceof Error?e.message:'操作失败，请刷新后重试'}
  finally{busy.value=false}
}
</script>
<template>
  <section v-if="options?.actions.length">
    <label v-if="options.actions.includes('assign')">处理人 <select v-model="target"><option value="" disabled>请选择</option>
      <option v-for="person in options.operators" :key="person.id" :value="person.id">{{ person.displayName }}</option></select></label>
    <label v-else>处理或复核说明 <textarea v-model="comment" /></label>
    <button v-for="act in options.actions" :key="act" :disabled="busy || (act==='assign' && !target) || (act==='handle' && !comment.trim())" @click="submit(act)">{{ labels[act] }}</button>
  </section><p v-if="error" role="alert">{{ error }}</p>
</template>
