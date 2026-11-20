<script setup lang="ts">
import { computed,nextTick,ref,watch } from 'vue'
import { useRoute,useRouter } from 'vue-router'
import { useStoredConversations,toolSessionMessage } from '../composables/useStoredConversations'
import SafeMarkdown from '../components/SafeMarkdown.vue'
import StoredToolCards from '../components/StoredToolCards.vue'
const route=useRoute(),router=useRouter(),title=ref(''),question=ref('')
const {items,detail,live,phase,error,notice,load,select,create,send,stop,refresh,reset}=useStoredConversations()
const refreshButton=ref<HTMLButtonElement|null>(null)
const locked=computed(()=>phase.value!=='idle'||!!live.value||!!detail.value?.conversation.activeTurnId)
watch(()=>route.params.id,(id,_old,onCleanup)=>{
  let active=true;onCleanup(()=>{active=false});reset();question.value=''
  void(async()=>{await load();if(active&&typeof id==='string')await select(id)})()
},{immediate:true})
async function onCreate(){if(await create(title.value)){title.value='';await router.push('/assistant/'+detail.value!.conversation.id)}}
async function onSend(){if(await send(question.value))question.value=''}
async function onStop(){stop();await nextTick();refreshButton.value?.focus()}
function choose(event:Event){const id=(event.target as HTMLSelectElement).value;if(id)void router.push('/assistant/'+id)}
</script>
<template>
  <section class="assistant-page">
    <p><RouterLink to="/">返回工单工作台</RouterLink></p>
    <h2>运维助手会话</h2>
    <p class="muted">查询工单、设备告警和处理记录。只读业务数据，历史保存在服务端；权限或资源归属变化后可能无法继续查看。</p>
    <form class="create-form" @submit.prevent="onCreate">
      <label for="conversation-title">新会话名称</label>
      <div class="inline"><input id="conversation-title" v-model="title" maxlength="200" required :disabled="phase!=='idle'" placeholder="例如：值班排查"><button :disabled="phase!=='idle'" type="submit">新建会话</button></div>
    </form>
    <div class="session-picker">
      <label for="conversation-select">已保存会话</label>
      <select id="conversation-select" :value="detail?.conversation.id ?? ''" @change="choose"><option value="" disabled>选择一个会话</option><option v-for="item in items" :key="item.id" :value="item.id">{{ item.title }}</option></select>
      <button ref="refreshButton" type="button" :disabled="phase!=='idle'" @click="refresh">刷新保存状态</button>
    </div>
    <p v-if="phase==='loading'" role="status">正在读取保存状态…</p>
    <p v-if="error" id="assistant-error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="!detail&&phase==='idle'" class="muted">新建或选择会话后开始提问。每个账号最多30个会话，每个会话最多40轮。</p>
    <section v-if="detail" aria-labelledby="conversation-heading">
      <h3 id="conversation-heading">{{ detail.conversation.title }}</h3>
      <p v-if="detail.conversation.activeTurnId" role="status">后台仍有运行中的轮次，请稍后刷新。不会自动重复执行；进程异常留下的占用需另行核查。</p>
      <ol class="history" aria-label="已保存对话">
        <li v-for="turn in detail.turns" :key="turn.id">
          <p class="question"><strong>你：</strong>{{ turn.question }}</p>
          <p class="muted">第{{ turn.ordinal }}轮 · {{ turn.mode==='mock' ? '模拟规则演示' : turn.mode==='model' ? '模型调用' : '模式待确认' }} · {{ turn.status==='completed' ? '已保存' : turn.status==='failed' ? '未完成' : '运行中' }}</p>
          <StoredToolCards v-if="turn.tools.length" :tools="turn.tools" />
          <SafeMarkdown v-if="turn.answer" :text="turn.answer" />
          <p v-if="turn.errorCode" class="error">{{ toolSessionMessage(turn.errorCode) }}</p>
        </li>
      </ol>
      <section v-if="live" class="live" aria-label="本页收到的进度">
        <p class="question"><strong>你：</strong>{{ live.question }}</p>
        <p role="status">{{ live.mode==='mock' ? '模拟规则演示 · ' : '' }}{{ live.status==='stopped' ? '已停止等待' : live.status==='error' ? '本轮未完成' : '正在处理' }}{{ live.replay ? ' · 读取已保存结果' : '' }}</p>
        <StoredToolCards v-if="live.tools.length" :tools="live.tools" />
        <SafeMarkdown v-if="live.text" :text="live.text" />
      </section>
      <form class="question-form" @submit.prevent="onSend">
        <label for="assistant-question">问题</label>
        <p id="question-help" class="muted">模拟模式可输入“查询工单 编号 的记录”或“查询工单 编号 的日志”。停止或中断后先刷新保存状态，再发送新问题。</p>
        <textarea id="assistant-question" v-model="question" rows="3" maxlength="2000" required :disabled="locked" :aria-describedby="error ? 'question-help assistant-error' : 'question-help'" />
        <div class="inline"><button type="submit" :disabled="locked">发送问题</button><button v-if="phase==='sending'" type="button" @click="onStop">停止等待</button><span class="muted">{{ question.length }}/2000</span></div>
      </form>
    </section>
  </section>
</template>
<style scoped>
.assistant-page{max-width:960px;margin:0 auto}.muted{color:#475569;font-size:14px;line-height:1.6}.create-form,.question-form{display:grid;gap:8px;margin:20px 0}.inline,.session-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.session-picker{margin:16px 0}.inline input{flex:1;min-width:160px}.session-picker select{max-width:100%;flex:1;min-width:180px}.history{list-style:none;padding:0;display:grid;gap:16px}.history>li,.live{border:1px solid #cbd5e1;border-radius:8px;padding:16px;min-width:0}.question{white-space:pre-wrap;overflow-wrap:anywhere}.live{background:#f8fafc}.error{color:#b91c1c}textarea{width:100%;box-sizing:border-box;resize:vertical;font:inherit}input,select,textarea,button{padding:8px}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #155eab;outline-offset:2px}button:disabled{cursor:not-allowed}.question-form{border-top:1px solid #cbd5e1;padding-top:16px}@media(max-width:600px){.session-picker{align-items:stretch;flex-direction:column}.history>li,.live{padding:12px}.assistant-page h2{font-size:22px}}
</style>
