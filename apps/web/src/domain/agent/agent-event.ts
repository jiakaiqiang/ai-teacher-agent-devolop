// 领域层：纯类型，不依赖 Vue
//
// 用判别联合(discriminated union)建模一次 Agent 运行产生的事件流。

/** Branded type：让 RunId 不能和普通 string 混用，防止参数传错。 用自带的参数RunId 区分*/
export type RunId = string & { readonly __brand: 'RunId' }

export type EventMeta = {
  runId: RunId,
  sequence: number ,// 事件在一次运行中的顺序号，从 0 开始
  timestamp: number // 事件发生的时间戳
}

//定义事件类型

export type AgentEvent =
  | (EventMeta & { type: 'run.started'; payload: Record<string, never> })
  | (EventMeta & { type: 'text.delta'; payload: { text: string } })
  | (EventMeta & { type: 'tool.started'; payload: { callId: string; toolName: string; argumentSummary: string } })
  | (EventMeta & { type: 'tool.succeeded'; payload: { callId: string; resultSummary: string; durationMs: number } })
  | (EventMeta & { type: 'tool.failed'; payload: { callId: string; code: string; message: string } })
  | (EventMeta & { type: 'approval.required'; payload: { approvalId: string; action: string; risk: 'low' | 'medium' | 'high' } })
  | (EventMeta & { type: 'run.cancelled'; payload: { reason: string } })
  | (EventMeta & { type: 'run.failed'; payload: { code: string; message: string } })
  | (EventMeta & { type: 'run.finished'; payload: { summary: string } })


export function assertNever(value: never): never {
  throw new Error(`Unhandled AgentEvent: ${JSON.stringify(value)}`)
}