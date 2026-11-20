import type { GenerationStatus } from './generation'
export interface GenerationMetrics { startedAt:number; firstTextAt:number|null; endedAt:number|null; chars:number; outcome:GenerationStatus|null }
export const startMetrics=(now:number):GenerationMetrics=>({startedAt:now,firstTextAt:null,endedAt:null,chars:0,outcome:null})
export function measureText(metric:GenerationMetrics,text:string,now:number) {
  if(metric.endedAt!==null || !text.length)return
  if(metric.firstTextAt===null)metric.firstTextAt=now
  metric.chars+=Array.from(text).length
}
export function finishMetrics(metric:GenerationMetrics,outcome:GenerationStatus,now:number) {
  if(metric.endedAt!==null || outcome==='connecting' || outcome==='streaming')return
  metric.endedAt=now;metric.outcome=outcome
}
export function metricsView(metric:GenerationMetrics) {
  const elapsed=metric.firstTextAt===null || metric.endedAt===null ? null : metric.endedAt-metric.firstTextAt
  return {ttftMs:metric.firstTextAt===null?null:Math.max(0,metric.firstTextAt-metric.startedAt),durationMs:metric.endedAt===null?null:Math.max(0,metric.endedAt-metric.startedAt),chars:metric.chars,charsPerSecond:elapsed!==null && elapsed>0 ? metric.chars*1000/elapsed:null,outcome:metric.outcome}
}
// 本页已结束且非主动停止的请求为分母；截断单列，不计为网络中断。
export function summarizeMetrics(metrics:GenerationMetrics[]) {
  const eligible=metrics.filter(metric=>metric.endedAt!==null && metric.outcome!=='stopped')
  const interrupted=eligible.filter(metric=>metric.outcome==='interrupted' || metric.outcome==='error').length
  return {eligible:eligible.length,interrupted,interruptionRate:eligible.length?interrupted/eligible.length:null}
}
