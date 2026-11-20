import { z } from 'zod';

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const runStopReasonSchema = z.enum(['answered', 'step_limit', 'time_limit', 'token_limit',
  'tool_failed', 'model_failed', 'user_cancelled']);

export const runStartSchema = z.object({
  requestKey: z.uuid(),
  ticketNo: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(500),
}).strict();

export const runVersionSchema = z.object({ version: z.number().int().min(0) }).strict();

// 出站只给调用方需要的字段：不含 scopeHash、requestKey 这类内部信息。
export const runViewSchema = z.object({
  id: z.uuid(),
  ticketNo: z.string().min(1).max(64),
  goal: z.string().min(1).max(500),
  status: runStatusSchema,
  stopReason: runStopReasonSchema.nullable(),
  version: z.number().int().min(0),
  stepCount: z.number().int().min(0),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
}).strict();
export const runListSchema = z.array(runViewSchema).max(30);

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStopReason = z.infer<typeof runStopReasonSchema>;
export type RunView = z.infer<typeof runViewSchema>;

export const stepPhaseSchema = z.enum(['plan', 'tool', 'answer']);
export const stepStatusSchema = z.enum(['running', 'succeeded', 'failed']);
export const eventTypeSchema = z.enum(['run_started', 'step_started', 'step_finished', 'run_finished']);

export const stepViewSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1),
  phase: stepPhaseSchema,
  status: stepStatusSchema,
  summary: z.string().max(500),
  errorCode: z.string().max(64).nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
}).strict();

export const eventViewSchema = z.object({
  seq: z.number().int().min(1),
  type: eventTypeSchema,
  stepOrdinal: z.number().int().min(1).nullable(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: z.string(),
}).strict();

export const runDetailSchema = z.object({
  run: runViewSchema,
  steps: z.array(stepViewSchema).max(8),
}).strict();

export const eventPageSchema = z.object({
  runId: z.uuid(),
  events: z.array(eventViewSchema).max(200),
  lastSeq: z.number().int().min(0),
}).strict();

export type StepView = z.infer<typeof stepViewSchema>;
export type EventView = z.infer<typeof eventViewSchema>;

export const traceViewSchema = z.object({
  ordinal: z.number().int().min(1),
  kind: z.enum(['model', 'tool']),
  input: z.string().max(2100),
  output: z.string().max(2100),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  truncated: z.boolean(),
}).strict();

export const tracePageSchema = z.object({
  runId: z.uuid(),
  traces: z.array(traceViewSchema).max(8),
  usage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    durationMs: z.number().int().min(0),
    traces: z.number().int().min(0),
    truncated: z.boolean(),
  }).strict(),
}).strict();

export type TraceView = z.infer<typeof traceViewSchema>;

export const notificationStreamTicketSchema = z.object({ticket:z.string().min(1)});
