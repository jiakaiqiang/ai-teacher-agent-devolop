<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue'
import {useConversation} from '../composables/useConversation'
import {isGenerating,type GenerationStatus} from '../assistant/generation'
import {metricsView,summarizeMetrics} from '../assistant/metrics'
import SafeMarkdown from './SafeMarkdown.vue'
import AssistantCards from './AssistantCards.vue'
import VirtualConversation from './VirtualConversation.vue'
const props=defineProps<{ticketNo:string}>()
const {turns,path,activeLeaf,busy,error,send,fork,select,stop}=useConversation(()=>props.ticketNo)
const question=ref('请给出这张模拟工单的排查步骤');const editId=ref<string|null>(null);const input=ref<HTMLTextAreaElement>()
const labels:Record<GenerationStatus,string>={connecting:'正在连接',streaming:'正在生成',completed:'生成完成',truncated:'达到长度限制，内容不完整',stopped:'已停止，保留部分内容',interrupted:'生成中断，保留部分内容',error:'生成失败'}
const last=computed(()=>path.value.at(-1));const summary=computed(()=>summarizeMetrics(turns.value.map(turn=>turn.metrics)))
watch(()=>props.ticketNo,()=>{question.value='请给出这张模拟工单的排查步骤';editId.value=null},{flush:'sync'})
async function submit(){const id=editId.value;const pending=id?fork(id,question.value):send(question.value);editId.value=null;await pending}
async function edit(id:string){const turn=turns.value.find(row=>row.id===id);if(!turn||busy.value)return;editId.value=id;question.value=turn.question;await nextTick();input.value?.focus()}
async function stopAndFocus(){stop();await nextTick();input.value?.focus()}
function changeBranch(event:Event){select((event.target as HTMLSelectElement).value);editId.value=null}
const number=(value:number|null)=>value===null?'暂无':value.toFixed(1)
</script>
<template>
  <section class="conversation-panel" aria-labelledby="conversation-heading">
    <h3 id="conversation-heading">AI 排查会话</h3>
    <p id="conversation-help">仅用于模拟工单练习，建议需人工核实。每次仅发送当前问题；历史供本页回看，刷新或离开后不保留。</p>
    <label v-if="turns.length" for="conversation-branch">回看分支或消息</label>
    <select v-if="turns.length" id="conversation-branch" :value="activeLeaf" :disabled="busy" @change="changeBranch">
      <option v-for="(turn,index) in turns" :key="turn.id" :value="turn.id">{{index+1}} · {{turn.question.slice(0,35)}} · {{labels[turn.run.status]}}</option>
    </select>
    <VirtualConversation v-if="path.length" :items="path">
      <template #default="{item,index}">
        <article class="turn" :aria-label="'第'+(index+1)+'轮'">
          <h4>问题 {{index+1}}：{{item.question}}</h4>
          <p class="run-status">{{item.run.mode==='mock'?'模拟输出':item.run.mode==='model'?'模型输出':'等待响应'}} · {{labels[item.run.status]}}</p>
          <SafeMarkdown :text="item.run.text" :streaming="isGenerating(item.run)" />
          <AssistantCards :cards="item.run.cards" />
          <p v-if="item.run.error" class="error">本次生成未完整结束，请核实内容后重试。</p>
          <p class="metrics">首字到达 {{number(metricsView(item.metrics).ttftMs)}} ms · 字符速率 {{number(metricsView(item.metrics).charsPerSecond)}} 字符/秒</p>
          <div class="actions"><button type="button" :disabled="busy" @click="fork(item.id)">重新生成第{{index+1}}轮</button><button type="button" :disabled="busy" @click="edit(item.id)">编辑第{{index+1}}轮问题</button></div>
        </article>
      </template>
    </VirtualConversation>
    <p v-else>生成后的会话会显示在这里。</p>
    <form @submit.prevent="submit">
      <label for="conversation-question">{{editId?'编辑历史问题（保留原分支）':'排查问题'}}（1—1000字）</label>
      <textarea ref="input" id="conversation-question" v-model="question" rows="3" required maxlength="1000" :readonly="busy" aria-describedby="conversation-help conversation-error" />
      <div class="actions"><button type="submit" :disabled="busy||!question.trim()">{{editId?'生成新分支':'发送问题'}}</button><button type="button" :disabled="!busy" @click="stopAndFocus">停止生成</button><button v-if="editId" type="button" @click="editId=null">取消编辑</button></div>
    </form>
    <p role="status" aria-live="polite">{{last?labels[last.run.status]:'等待提问'}}</p>
    <p id="conversation-error" role="alert" class="error">{{error}}</p>
    <p class="metrics">本页非主动停止的已结束请求 {{summary.eligible}} 次；错误或中断 {{summary.interrupted}} 次。指标仅记录本页，不含真实模型 token 计费。</p>
  </section>
</template>
<style scoped>
.conversation-panel{margin-top:24px;border-top:1px solid #d0d7de;padding-top:16px;min-width:0}
h3{margin:0 0 8px}h4{margin:.25rem 0;overflow-wrap:anywhere}
label{display:block;margin:.5rem 0}textarea,select{box-sizing:border-box;width:100%;font:inherit;padding:.5rem}textarea{resize:vertical}
.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}button{min-height:36px;padding:6px 12px}
button:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #0969da;outline-offset:2px}
.turn{min-width:0}.run-status,.metrics{font-size:.85rem;color:#475569}.error{color:#b91c1c}.error:empty{display:none}
</style>
