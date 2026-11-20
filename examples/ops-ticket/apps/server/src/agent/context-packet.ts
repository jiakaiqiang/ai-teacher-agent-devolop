import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redactForLog } from '../common/sensitive.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const message = z.object({ role: z.enum(['system', 'user']), content: z.string() }).strict();
export type PacketMessage = z.infer<typeof message>;
const record = z.object({ version: z.literal(1), messages: z.array(message).length(2), digest: z.string(), prefix: z.string() }).strict();

export function cleanText(value: string) {
  return redactForLog(value).replace(/Bearer\s+[A-Za-z0-9_.~+/=-]+/gi, 'Bearer [已隐藏]');
}
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, /^(password|token|api[_-]?key|authorization|secret)$/i.test(key) ? '[已隐藏]' : scrub(child)]));
  return value;
}

export function makePacket(messages: PacketMessage[]) {
  if (messages.length !== 2 || messages[0]?.role !== 'system' || messages[1]?.role !== 'user') throw new Error('CONTEXT_ROLES');
  const safe = [{ role: 'system' as const, content: cleanText(messages[0].content) },
    { role: 'user' as const, content: JSON.stringify(scrub(JSON.parse(messages[1].content))) }];
  const encoded = JSON.stringify(safe);
  if (Buffer.byteLength(encoded) > 32768) throw new Error('CONTEXT_PACKET_LIMIT');
  return { version: 1 as const, messages: safe, digest: hash(encoded), prefix: hash(safe[0]!.content) };
}

// JSONB 不保证对象键顺序；由 schema 按 role、content 重建哈希输入。
export function replayPacket(value: unknown) {
  const row = record.parse(value);
  if (row.messages[0]?.role !== 'system' || row.messages[1]?.role !== 'user' ||
    hash(JSON.stringify(row.messages)) !== row.digest || hash(row.messages[0].content) !== row.prefix) throw new Error('CONTEXT_PACKET_CHANGED');
  return row;
}
