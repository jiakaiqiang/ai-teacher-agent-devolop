import { createHmac } from 'node:crypto';
import { z } from 'zod';

const key = z.string().min(1).max(128);
const trace = z.object({ space: key, runId: z.uuid(), outcome: z.enum(['answered', 'failed']),
  usage: z.object({ traces: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }) });
const vote = z.object({ space: key, runId: z.uuid(), helpful: z.boolean() });
const input = z.object({ traces: z.array(trace), votes: z.array(vote) });

export function reviewSample(raw: unknown, space: string, secret: string, limit: number) {
  if (secret.length < 16 || !Number.isInteger(limit) || limit < 1) throw new Error('抽样参数无效');
  const data = input.parse(raw);
  const votes = new Map<string, boolean>();
  for (const v of data.votes.filter(x => x.space === space)) {
    if (votes.has(v.runId)) throw new Error('同一运行有多个最终反馈');
    votes.set(v.runId, v.helpful);
  }
  const rows = data.traces.filter(x => x.space === space).map(x => ({
    sampleId: createHmac('sha256', secret).update(JSON.stringify([space, x.runId])).digest('hex'),
    outcome: x.outcome, usage: x.usage, helpful: votes.get(x.runId) ?? null,
  }));
  if (new Set(rows.map(x => x.sampleId)).size !== rows.length) throw new Error('运行重复');
  // 一半名额优先复核失败或负反馈，剩余名额从其他样本补齐。
  rows.sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const flagged = rows.filter(x => x.outcome === 'failed' || x.helpful === false);
  const priority = flagged.slice(0, Math.ceil(limit / 2));
  const chosen = new Set(priority.map(x => x.sampleId));
  return [...priority, ...rows.filter(x => !chosen.has(x.sampleId))].slice(0, limit);
}
