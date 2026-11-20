import {conversationEventSchema} from '@ops-ticket/shared'
import {applyConversationEvent,createGeneration,failGeneration,isGenerating} from './generation'
import {finishMetrics,measureText,metricsView,startMetrics} from './metrics'
export interface TimedEvent {at:number;event:unknown}

// 离线练习：不发请求，不恢复在线连接；每次回放均创建独立状态。
export function auditReplay(runId:string,messageId:string,startedAt:number,records:readonly TimedEvent[]) {
  if(!Number.isFinite(startedAt)||startedAt<0||records.length>8192)throw new Error('REPLAY_BUDGET')
  const run=createGeneration(runId,messageId);const metric=startMetrics(startedAt)
  const counts={applied:0,duplicate:0,stale:0,terminal:0};let previous=startedAt
  for(const record of records) {
    if(!Number.isFinite(record.at)||record.at<previous)throw new Error('REPLAY_CLOCK')
    previous=record.at
    const event=conversationEventSchema.parse(record.event)
    const result=applyConversationEvent(run,event);counts[result]++
    // 重复、旧身份及终态迟到事件都不能污染字符数和结束时间。
    if(result==='applied') {
      if(event.type==='text')measureText(metric,event.text,record.at)
      if(!isGenerating(run))finishMetrics(metric,run.status,record.at)
    }
  }
  if(isGenerating(run)){failGeneration(run,'MODEL_PROTOCOL_ERROR');finishMetrics(metric,run.status,previous)}
  return {run,counts,metrics:metricsView(metric)}
}
