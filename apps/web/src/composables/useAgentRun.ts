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

  // 从事件流算出时间线(computed 会缓存，事件变了才会重新计算)
  const timeline = computed<TimelineItem[]>(() => {
    
     const items: TimelineItem[] = []

events.value.forEach((event, index) => {
      switch (event.type) {
        case 'text.delta':
          // 注意：TS 在这里知道 event 一定是 { type: 'text.delta'; text: string }
          // 写 event.text 有类型提示，写 event.toolName 会报错
          items.push({
            key: `text-${index}`,
            kind: 'text',
            title: '模型输出',
            detail: event.text,
          })
          break

        case 'tool.started':
          items.push({
            key: `tool-${event.callId}`,
            kind: 'tool',
            title: `调用工具：${event.toolName}`,
            detail: `参数：${event.args}`,
          })
          break

        case 'tool.succeeded':
          // 通过 callId 找到对应的 tool 卡片，更新它的 detail
          // 这就是"事件关联"：succeeded 事件和 started 事件通过 callId 关联
          const existing = items.find((item) => item.key === `tool-${event.callId}`)
          if (existing) {
            existing.detail = `完成 (${event.durationMs}ms)：${event.result}`
          }
          break

        case 'approval.required':
          items.push({
            key: `approval-${event.approvalId}`,
            kind: 'approval',
            title: `等待审批：${event.action}`,
            detail: `风险级别：${event.risk}`,
          })
          break

        // run.started / run.finished 不产生时间线项，只影响 status
        case 'run.started':
        case 'run.finished':
          break
      }
    })

    return items
  })

  const pushEvent = (event: AgentEvent) => {
    events.value.push(event)
  }
  return {
    status,
    timeline,
    pushEvent,
  }
}

