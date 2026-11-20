import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { checkVector } from './vector-index.js';

export const model = 'ops-teacher-qwen3-embedding:q8';
export const dimension = 1024;
export const space = 'qwen3_06b_q8_06507c7b_chunks_v1';
export type Chunk = { start: number; end: number; text: string };

// 所有偏移都按 Unicode 码点计数，end 是开区间。
export function chunks(text: string, width = 240, overlap = 40): Chunk[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(overlap) ||
      width < 1 || overlap < 0 || overlap >= width) throw new Error('CHUNK_WINDOW');
  const points = Array.from(text);
  const result: Chunk[] = [];
  for (let start = 0; start < points.length; start += width - overlap) {
    const end = Math.min(start + width, points.length);
    const part = points.slice(start, end).join('');
    if (part.trim()) result.push({ start, end, text: part });
    if (end === points.length) break;
  }
  return result;
}

export async function encode(texts: string[], role: 'query' | 'passage', request: typeof fetch = fetch) {
  if (!texts.length || texts.length > 16 || texts.some(t => !t.trim() || Array.from(t).length > 2048)) {
    throw new Error('EMBED_INPUT');
  }
  const input = role === 'passage' ? texts : texts.map(text =>
    'Instruct: Given a Chinese helpdesk query, retrieve an applicable manual or published solution.\nQuery: ' + text);
  const response = await request('http://127.0.0.1:11434/api/embed', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input, truncate: false }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('EMBED_HTTP_' + response.status);
  }
  const result = z.object({ model: z.literal(model), embeddings: z.array(z.array(z.number())) }).parse(await response.json());
  if (result.embeddings.length !== texts.length) throw new Error('EMBED_CARDINALITY');
  return result.embeddings.map(v => checkVector(v, dimension));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parts = chunks('工单：员工换机后远程登录失败。处理：重新绑定动态口令。', 16, 4);
  const vectors = await encode(parts.map(p => p.text), 'passage');
  console.log(JSON.stringify({ space, parts, dimensions: vectors.map(v => v.length) }));
}
