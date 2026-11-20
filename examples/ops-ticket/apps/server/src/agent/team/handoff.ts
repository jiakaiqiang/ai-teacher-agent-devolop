import { z } from 'zod';

export const category = z.enum(['network', 'storage', 'power', 'unknown']);
export type Category = z.infer<typeof category>;
export const selection = z.object({ index: z.number().int().min(0).max(3), needCounts: z.boolean() }).strict();
export const proposal = z.object({ category }).strict();
export const review = z.object({ verdict: z.enum(['accept', 'insufficient']) }).strict();
export const handoff = z.object({ runId: z.uuid(), quote: z.string().min(1).max(180), needCounts: z.boolean() }).strict();
export type Handoff = z.infer<typeof handoff>;

// 由宿主绑定运行并从可见片段取原文，模型只选择索引。
export function selected(runId: string, excerpts: readonly string[], raw: unknown): Handoff {
  const choice = selection.parse(raw);
  return handoff.parse({ runId, quote: excerpts[choice.index], needCounts: choice.needCounts });
}
export function receive(runId: string, envelope: unknown) {
  const packet = handoff.parse(envelope);
  if (packet.runId !== runId) throw new Error('交接运行不一致');
  return packet;
}
