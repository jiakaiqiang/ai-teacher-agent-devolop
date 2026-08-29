import {z} from 'zod'

//事件scheam
export const EventMetaSchema  = z.object({
    runId:z.string(),
    sequence:z.number().int().nonnegative(),
    occurredAt:z.string().datetime(),
})

// 开始状态
const RunStartedSchema =  EventMetaSchema.extend({
    type:z.literal('RunStarted'),
    payload:z.object({})
})
const  TextDeltaSchema =EventMetaSchema.extend({
    type:z.literal('TextDelta'),
    payload:z.object({
        text:z.string(),
    })

})
// 工具开始状态
const ToolStartedSchema = EventMetaSchema.extend({
    type:z.literal('ToolStarted'),
    payload:z.object({
        toolName:z.string(),
        callId:z.string(),
        argumentSummary:z.string()
    })
})

const ToolSucceededSchema = EventMetaSchema.extend({
    type:z.literal('ToolSucceeded'),
    payload:z.object({
        callId:z.string(),
        resultSummary:z.string(),
        durationMs:z.number().int().nonnegative()
    })
})
const ToolFailedSchema = EventMetaSchema.extend({
  type: z.literal('tool.failed'),
  payload: z.object({
    callId: z.string(),
    code: z.string(),
    message: z.string(),
  }),
})

const ApprovalRequiredSchema = EventMetaSchema.extend({
  type: z.literal('approval.required'),
  payload: z.object({
    approvalId: z.string(),
    action: z.string(),
    risk: z.enum(['low', 'medium', 'high']),
  }),
})

const RunCancelledSchema = EventMetaSchema.extend({
  type: z.literal('run.cancelled'),
  payload: z.object({
    reason: z.string(),
  }),
})

const RunFailedSchema = EventMetaSchema.extend({
  type: z.literal('run.failed'),
  payload: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

const RunFinishedSchema = EventMetaSchema.extend({
  type: z.literal('run.finished'),
  payload: z.object({
    summary: z.string(),
  }),
})

export const AgentEventSchema = z.discriminatedUnion('type', [
  RunStartedSchema,
  TextDeltaSchema,
  ToolStartedSchema,
  ToolSucceededSchema,
  ToolFailedSchema,
  ApprovalRequiredSchema,
  RunCancelledSchema,
  RunFailedSchema,
  RunFinishedSchema,
])