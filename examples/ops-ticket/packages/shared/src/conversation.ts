import { z } from 'zod';

const identity = {
  version: z.literal(1),
  runId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(64),
  seq: z.number().int().min(1).max(4096),
};
// 界面协议独立版本；W7的HTTP协议由前端适配，后续卡片沿用同一身份和序号。
export const conversationEventSchema = z.discriminatedUnion('type', [
  z.object({ ...identity, type:z.literal('tool'), cardId:z.string().min(1).max(64), state:z.enum(['running','completed','failed']), label:z.string().min(1).max(120) }).strict(),
  z.object({ ...identity, type:z.literal('citation'), cardId:z.string().min(1).max(64), title:z.string().min(1).max(120), excerpt:z.string().max(1000) }).strict(),
  z.object({ ...identity, type:z.literal('result'), cardId:z.string().min(1).max(64), title:z.string().min(1).max(120), items:z.array(z.string().max(200)).max(8) }).strict(),

  z.object({ ...identity, type: z.literal('start'), mode: z.enum(['mock', 'model']) }).strict(),
  z.object({ ...identity, type: z.literal('text'), text: z.string().max(16_384) }).strict(),
  z.object({ ...identity, type: z.literal('finish'), reason: z.enum(['stop', 'length']) }).strict(),
  z.object({ ...identity, type: z.literal('failure'), code: z.enum(['MODEL_UNAVAILABLE', 'MODEL_PROTOCOL_ERROR', 'MODEL_OUTPUT_LIMIT', 'MODEL_TIMEOUT', 'MODEL_CANCELLED']) }).strict(),
]);
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
