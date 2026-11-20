import { z } from 'zod';

export const sessionCreateSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
export const sessionTurnInputSchema = z.object({ requestKey: z.uuid(), version: z.number().int().min(0), question: z.string().trim().min(1).max(2000) }).strict();
export const sessionToolNameSchema = z.enum(['find_ticket', 'list_ticket_logs', 'list_ticket_history']);
const tool = { callId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), name: sessionToolNameSchema };
const identity = { protocol: z.literal(1), runId: z.uuid(), seq: z.number().int().min(1).max(16) };
export const toolSessionEventSchema = z.discriminatedUnion('type', [
  z.object({ ...identity, type: z.literal('meta'), mode: z.enum(['mock','model']), replay: z.boolean() }).strict(),
  z.object({ ...identity, ...tool, type: z.literal('tool-start'), arguments: z.string().max(1024) }).strict(),
  z.object({ ...identity, ...tool, type: z.literal('tool-result'), content: z.string().max(4096) }).strict(),
  z.object({ ...identity, type: z.literal('answer'), text: z.string().min(1).max(8192) }).strict(),
  z.object({ ...identity, type: z.literal('done'), conversationVersion: z.number().int().min(0), billing: z.object({ status: z.enum(['exact','estimated']), units: z.number().int().min(0) }).strict() }).strict(),
  z.object({ ...identity, type: z.literal('error'), code: z.string().regex(/^[A-Z_]{1,64}$/) }).strict(),
]);
export type ToolSessionEvent = z.infer<typeof toolSessionEventSchema>;
export type ToolSessionPayload = ToolSessionEvent extends infer E ? E extends ToolSessionEvent ? Omit<E, 'protocol' | 'runId' | 'seq'> : never : never;
export const sessionSummarySchema = z.object({ id: z.uuid(), title: z.string().min(1).max(200), version: z.number().int().min(0), activeTurnId: z.uuid().nullable(), updatedAt: z.iso.datetime() }).strict();
export const sessionListSchema = z.array(sessionSummarySchema).max(30);
export const sessionToolResultSchema = z.object({ ...tool, arguments: z.string().max(1024), content: z.string().max(4096) }).strict();
export const sessionTurnSchema = z.object({ id: z.uuid(), requestKey: z.uuid(), ordinal: z.number().int().min(1).max(40), question: z.string().min(1).max(2000), status: z.enum(['running','completed','failed']), mode: z.enum(['mock','model']).nullable(), answer: z.string().max(8192), errorCode: z.string().regex(/^[A-Z_]{1,64}$/).nullable(), tools: z.array(sessionToolResultSchema).max(3) }).strict();
export const sessionDetailSchema = z.object({ conversation: sessionSummarySchema, turns: z.array(sessionTurnSchema).max(40) }).strict();
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
