// 假事件序列（未来 WebSocket / SSE 的替身）
// 覆盖一次完整运行：started → 消息增量 → 一次工具调用 → finished。
import type { AgentEvent } from '@/domain/agent/agent-event'
import { toRunId, toToolCallId } from '@/domain/agent/agent-event'

const runId = toRunId('run_demo_001')
const callId = toToolCallId('call_weather_001')

export const sampleRun: AgentEvent[] = [
  { type: 'run/started', runId, startedAt: 0 },
  { type: 'message/delta', runId, text: '正在' },
  { type: 'message/delta', runId, text: '为你' },
  { type: 'message/delta', runId, text: '查询天气' },
  { type: 'tool/call-started', runId, callId, name: 'getWeather', args: { city: '北京' } },
  { type: 'tool/call-result', runId, callId, result: { temp: 26, desc: '晴' } },
  { type: 'message/delta', runId, text: '。北京今天 26°C，晴。' },
  { type: 'message/completed', runId },
  { type: 'run/finished', runId, finishedAt: 1200 },
]

// 一条以错误结尾的序列，用于测异常路径 UI。
export const sampleErrorRun: AgentEvent[] = [
  { type: 'run/started', runId, startedAt: 0 },
  { type: 'message/delta', runId, text: '尝试处理请求…' },
  { type: 'run/error', runId, message: '上游模型超时' },
]
