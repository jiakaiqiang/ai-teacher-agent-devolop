import type { AgentEvent, RunId } from '@/domain/agent/agent-event'

const runId = 'run-fixture-1' as RunId

export const sampleEvents: AgentEvent[] = [
  { runId, sequence: 0, occurredAt: '2026-07-14T10:00:00Z',
    type: 'run.started', payload: {} },
  { runId, sequence: 1, occurredAt: '2026-07-14T10:00:01Z',
    type: 'text.delta', payload: { text: '正在检查服务器 srv-042 的 CPU 指标...' } },
  { runId, sequence: 2, occurredAt: '2026-07-14T10:00:02Z',
    type: 'tool.started',
    payload: { callId: 'c1', toolName: 'read_metrics', argumentSummary: 'last 10min' } },
  { runId, sequence: 3, occurredAt: '2026-07-14T10:00:04Z',
    type: 'tool.succeeded',
    payload: { callId: 'c1', resultSummary: 'CPU 平均 87%，异常', durationMs: 1800 } },
  { runId, sequence: 4, occurredAt: '2026-07-14T10:00:05Z',
    type: 'text.delta', payload: { text: '检测到 CPU 持续过载，建议重启异常进程。' } },
  { runId, sequence: 5, occurredAt: '2026-07-14T10:00:06Z',
    type: 'approval.required',
    payload: { approvalId: 'a1', action: 'restart_process', risk: 'high' } },
]