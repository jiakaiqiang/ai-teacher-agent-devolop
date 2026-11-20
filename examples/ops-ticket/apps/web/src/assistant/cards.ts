import type { ConversationEvent } from '@ops-ticket/shared'
import { applyConversationEvent, type Generation } from './generation'
// 显式模拟数据，只演示UI协议；不访问设备、知识库或执行任何工具。
export function mockCards(run:Generation) {
  if(run.mode!=='mock')return
  const identity={version:1 as const,runId:run.runId,messageId:run.messageId}
  const entries=[
    {type:'tool',cardId:'demo-check',state:'running',label:'模拟核对本单日志'},
    {type:'tool',cardId:'demo-check',state:'completed',label:'模拟核对本单日志'},
    {type:'citation',cardId:'demo-source',title:'模拟排查手册',excerpt:'这是本地构造的演示资料，不代表实际知识库检索。'},
    {type:'result',cardId:'demo-result',title:'模拟检查结果',items:['当前日志缺少服务端响应','请由提单人选择人工接入']},
  ]
  for(const entry of entries)applyConversationEvent(run,{...identity,...entry,seq:run.lastSeq+1} as ConversationEvent)
}
