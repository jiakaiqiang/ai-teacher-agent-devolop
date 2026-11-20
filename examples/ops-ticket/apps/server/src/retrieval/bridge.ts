import { z } from 'zod';
import { space } from './encoding.js';

export interface BridgeConfig { base: string; token: string; }
export type BridgeCandidate = { sourceKey: string; version: string; start: number; end: number; distance: number };
export type BridgeRow = { sourceKey: string; groupId: string; version: string; start: number; end: number; text: string };

// 只允许回环地址；令牌只读环境变量，不写日志、不进错误信息。
export function readBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const token = env.OPS_BRIDGE_TOKEN?.trim() ?? '';
  if (token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) throw new Error('BRIDGE_CONFIG');
  let url: URL;
  try { url = new URL(env.OPS_BRIDGE_URL?.trim() || 'http://127.0.0.1:8090'); } catch { throw new Error('BRIDGE_CONFIG'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('BRIDGE_CONFIG');
  return { base: url.origin, token };
}

const failure = z.object({ error: z.object({ code: z.string().regex(/^[A-Z0-9_]{1,40}$/) }) });
const candidates = z.object({ schema_version: z.literal(1), space: z.literal(space), candidates: z.array(z.object({
  source_key: z.string(), version: z.string(), start: z.number().int().nonnegative(),
  end: z.number().int().positive(), distance: z.number().finite() }).strict()).max(24) }).strict();
const written = z.object({ written: z.number().int().nonnegative() }).strict();
const vectors = z.object({ schema_version: z.literal(1), space: z.literal(space), dimension: z.literal(1024),
  count: z.number().int().positive(), vectors: z.array(z.array(z.number().finite())) }).strict();

// 外层35秒：Python内部编码20秒加Milvus10秒，外层必须更长，避免这里先放弃而对方仍在占用模型。
export async function bridgeCall(path: string, body: unknown, config = readBridgeConfig(), request: typeof fetch = fetch,
  timeoutMs = 35000) {
  let response: Response;
  try {
    response = await request(config.base + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // 连不上、连接被重置、超时都在这里；原始错误里可能带地址，只保留固定码。
    throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNAVAILABLE');
  }
  const reply: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = failure.safeParse(reply);
    const code = parsed.success ? parsed.data.error.code : 'HTTP_' + response.status;
    throw new Error(code.startsWith('BRIDGE_') ? code : 'BRIDGE_' + code);
  }
  return reply;
}

export async function bridgeSearch(query: string, groupId: string | null, call = bridgeCall): Promise<BridgeCandidate[]> {
  const reply = candidates.safeParse(await call('/v1/chunks/search', { query, group_id: groupId, limit: 24 }));
  if (!reply.success) throw new Error('BRIDGE_CONTRACT');
  return reply.data.candidates.map(c => ({ sourceKey: c.source_key, version: c.version, start: c.start, end: c.end, distance: c.distance }));
}

export async function bridgeUpsert(rows: BridgeRow[], call = bridgeCall) {
  const reply = written.safeParse(await call('/v1/chunks/upsert', { rows: rows.map(r => ({
    source_key: r.sourceKey, group_id: r.groupId, version: r.version, start: r.start, end: r.end, text: r.text })) }));
  if (!reply.success || reply.data.written !== rows.length) throw new Error('BRIDGE_CONTRACT');
  return reply.data.written;
}

// 未配置时沿用Node直连；只接受明确的两个值，拼错时启动检索即失败而不是悄悄回退。
export function retrievalBackend(env: NodeJS.ProcessEnv = process.env): 'node' | 'python' {
  const value = env.RETRIEVAL_BACKEND?.trim() || 'node';
  if (value !== 'node' && value !== 'python') throw new Error('RETRIEVAL_BACKEND');
  return value;
}

// 评测用：直接取向量，便于在同一实验里替换编码实现。
export async function bridgeEmbed(texts: string[], role: 'query' | 'passage', call = bridgeCall): Promise<number[][]> {
  const reply = vectors.safeParse(await call('/v1/embedding', { role, texts }));
  if (!reply.success || reply.data.count !== texts.length || reply.data.vectors.length !== texts.length ||
      reply.data.vectors.some(v => v.length !== reply.data.dimension)) throw new Error('BRIDGE_CONTRACT');
  return reply.data.vectors;
}
