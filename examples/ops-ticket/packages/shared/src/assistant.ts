import { z } from 'zod';

export const assistantEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), mode: z.enum(['mock', 'model']) }).strict(),
  z.object({ type: z.literal('delta'), text: z.string().max(16_384) }).strict(),
  z.object({ type: z.literal('done'), finishReason: z.enum(['stop', 'length']) }).strict(),
  z.object({ type: z.literal('error'), code: z.enum(['MODEL_UNAVAILABLE', 'MODEL_PROTOCOL_ERROR', 'MODEL_OUTPUT_LIMIT', 'MODEL_TIMEOUT', 'MODEL_CANCELLED']) }).strict(),
]);
export type AssistantEvent = z.infer<typeof assistantEventSchema>;

// 兼容协议只验证本文消费的字段；供应商附加的id/usage允许保留在上游。
export const chatChunkSchema = z.object({
  choices: z.array(z.object({
    index: z.literal(0),
    delta: z.object({ content: z.string().nullable().optional(), role: z.string().optional(), refusal: z.string().nullable().optional(), tool_calls: z.unknown().optional() }),
    finish_reason: z.string().nullable(),
  })).max(1),
});
