import { ServerSchema } from '../schemas/server.schema'
import { MetricSchema } from '../schemas/metric.schema'
import { AnomalySchema } from '../schemas/anomaly.schema'
import { AgentEventSchema } from '../schemas/agent-event.schema'
import type { Server, ServerId } from '../domain/server'
import type { Metric, MetricId } from '../domain/metric'
import type { Anomaly, AnomalyId } from '../domain/anomaly'
import type { AgentEventDomain } from '../domain/agent-event'
import type { RunId } from '@/domain/agent/agent-event'

export function toServer(input: unknown): Server | null {
  const result = ServerSchema.safeParse(input)
  if (!result.success) {
    console.error('ServerSchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    id: result.data.id as ServerId,
  }
}

export function toMetric(input: unknown): Metric | null {
  const result = MetricSchema.safeParse(input)
  if (!result.success) {
    console.error('MetricSchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    id: result.data.id as MetricId,
    serverId: result.data.serverId as ServerId,
  }
}

export function toAnomaly(input: unknown): Anomaly | null {
  const result = AnomalySchema.safeParse(input)
  if (!result.success) {
    console.error('AnomalySchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    id: result.data.id as AnomalyId,
    serverId: result.data.serverId as ServerId,
  }
}

export function toAgentEvent(input: unknown): AgentEventDomain | null {
  const result = AgentEventSchema.safeParse(input)
  if (!result.success) {
    console.error('AgentEventSchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    runId: result.data.runId as RunId,
  } as AgentEventDomain
}