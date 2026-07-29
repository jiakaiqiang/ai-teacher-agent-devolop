import type { RunId } from '@/domain/agent/agent-event'

// 复用 Day 01 的 RunId branded type

type EventMeta = {
  runId: RunId
  sequence: number
  occurredAt: string
}

export type AgentEventDomain =
  | (EventMeta & { type: 'run.started'; payload: Record<string, never> })
  | (EventMeta & { type: 'text.delta'; payload: { text: string } })
  | (EventMeta & { type: 'tool.started'; payload: { callId: string; toolName: string; argumentSummary: string } })
  | (EventMeta & { type: 'tool.succeeded'; payload: { callId: string; resultSummary: string; durationMs: number } })
  | (EventMeta & { type: 'tool.failed'; payload: { callId: string; code: string; message: string } })
  | (EventMeta & { type: 'approval.required'; payload: { approvalId: string; action: string; risk: 'low' | 'medium' | 'high' } })
  | (EventMeta & { type: 'run.cancelled'; payload: { reason: string } })
  | (EventMeta & { type: 'run.failed'; payload: { code: string; message: string } })
  | (EventMeta & { type: 'run.finished'; payload: { summary: string } })