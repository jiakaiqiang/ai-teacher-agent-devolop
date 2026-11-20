import { z } from 'zod';
import { edition } from './dataset.js';

// 这两个固定读工具的参数都是空对象。仅投影评分需要的字段。
const envelope = z.object({ edition: z.literal(edition), entries: z.array(z.discriminatedUnion('name', [
  z.object({ name: z.literal('ticket_summary'), data: z.object({ status: z.string() }) }),
  z.object({ name: z.literal('ticket_log_counts'), data: z.object({ counts: z.array(z.object({ severity: z.string(), count: z.number().int().nonnegative() })) }) }),
])).min(1) });
type Frame = z.infer<typeof envelope>['entries'][number];
export type ReadTool = Frame['name'];
export function record(entries: { name: ReadTool; data: unknown }[]) {
  return JSON.stringify(envelope.parse({ edition, entries }));
}
export function playback(raw: string) {
  const { entries } = envelope.parse(JSON.parse(raw));
  let cursor = 0;
  return {
    read(name: ReadTool) {
      const frame = entries[cursor];
      if (frame?.name !== name) throw new Error('回放工具或顺序不符');
      cursor++;
      return structuredClone(frame.data);
    },
    finish() {
      if (cursor !== entries.length) throw new Error('回放有未消费记录');
    },
  };
}
