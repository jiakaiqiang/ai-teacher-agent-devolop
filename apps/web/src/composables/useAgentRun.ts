import { ref, computed } from 'vue'

//事件类型：用于判断联合精确描述每种事件的形状
// 判别联合 =  用一个共同的字段type作为“标签”
// typescript 根据type 的值 自动收窄其他字段的类型

// 这里面都是agent run 可能使用到的时间类型等
export type AgentEvent = | { type: "run.started" } | { type: "text.delta"; text: string } | { type: 'tool.started'; callId: string; toolName: string; args: string }
  | { type: 'tool.succeeded'; callId: string; result: string; durationMs: number }
  | { type: 'approval.required'; approvalId: string; action: string; risk: 'low' | 'medium' | 'high' }
  | { type: 'run.finished' }

// UI 时间线上要渲染的每一项
export type TimelineItem = {
  key: string // 唯一标识
  kind: 'text' | 'tool' | 'approval'
  title: string
  detail?: string
}



export function useAgentRun() {
  //所有收到的时间 按照顺序存储起来
  const events = ref<AgentEvent[]>([])
  
  // 从事件流算出当前状态(computed 会缓存，事件变了才会重新计算)
 const status =  computed<'idle' | 'running' | 'awaiting-approval' | 'finished'>(() => {
    if (events.value.length === 0)  return 'idle' //没有事件则返回空闲
    const lastEvent = events.value[events.value.length - 1] //取最后一个事件
    switch (lastEvent.type) {
      case 'run.started':
        return 'running'
      case 'approval.required':
        return 'awaiting-approval'
      case 'run.finished':
        return 'finished'
      default:
        return 'running' //其他事件都认为是运行中
    }

 })
}