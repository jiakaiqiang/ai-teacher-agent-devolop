# D102（周四）：NestJS与Python桥接

第 15 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D101-pymilvus与向量存取.md)。

## 今天要做出什么

通过 Nest 的检索入口调用 Python 服务，分别记录本单号、可用资料范围和请求标识。

## 今天的目录结构

- `apps/server/.env.example`
- `apps/server/src/retrieval/bridge.spec.ts`
- `apps/server/src/retrieval/bridge.ts`
- `apps/server/src/retrieval/projection.ts`
- `apps/server/src/retrieval/retrieve.ts`

## 零、闭卷回忆

**D101**　改了模型版本还可以复用原集合吗？

<details><summary>核对</summary>

向量空间、条目标识和资料版本共同决定查询目标，先验证空间再比较距离。

</details>

**D99**　Node 与 Python 对空数组和缺字段的解释一致吗？

<details><summary>核对</summary>

在 HTTP 边界固定版本、必填字段和状态码，用同一份夹具检查两侧解释。

</details>

**D95**　日志先处理完是否等于它先被用户提交？

<details><summary>核对</summary>

并发完成顺序与业务顺序分列，聚合按输入编号对齐。

</details>

## 一、知识点与推导

两个服务使用同一个请求标识，Node 负责业务授权，Python 只处理收到的限定请求。

## 二、动手开发

1. 通过 Nest 的检索入口调用 Python 服务，分别记录本单号、可用资料范围和请求标识。
2. 从 `.env.example`、`bridge.spec.ts`、`bridge.ts` 的公开入口开始，把断言写在调用方。先保存失败结果，再修改实现并重跑同一输入。
3. 接口超时后应该根据哪个标识串起两侧日志？ 对照运行记录回答，补一个相邻状态或不同身份的样例。

在 `apps/server` 运行 `pnpm exec vitest run src/retrieval/bridge.spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

通过 Nest 的检索入口调用 Python 服务，分别记录本单号、可用资料范围和请求标识。

</details>

<details><summary>提示二 · 切换一个条件</summary>

接口超时后应该根据哪个标识串起两侧日志？

</details>

<details><summary>提示三 · 对照判定</summary>

两个服务使用同一个请求标识，Node 负责业务授权，Python 只处理收到的限定请求。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/.env.example**

```text
# 复制为 .env 后使用；.env 不提交到 Git
# 端口 55433 对应 infra/docker-compose.yml 里映射的端口
DATABASE_URL="postgresql://ops:ops_local_only@localhost:55433/ops_ticket?schema=public"

REDIS_URL=redis://127.0.0.1:56379/0
# 在本地 .env 中生成至少 32 字符的随机值
JWT_SECRET=

QUEUE_REDIS_URL=redis://127.0.0.1:56380/0

# 模型API根地址（例如供应商提供的 /v1）、密钥、模型名；三项全部留空使用明确标注的本机模拟
# 只在服务端配置，不能使用 VITE_ 前缀，不要把真实值贴入教程或聊天
LLM_BASE_URL=""
LLM_API_KEY=""
LLM_MODEL=""

# 服务端模型别名白名单，留空使用默认模型
LLM_MODEL_ROUTES=""

RETRIEVAL_BACKEND=node
OPS_BRIDGE_URL=http://127.0.0.1:8090
OPS_BRIDGE_TOKEN=
```

**apps/server/src/retrieval/bridge.spec.ts**

```ts
import { bridgeCall, bridgeSearch, bridgeUpsert, readBridgeConfig, retrievalBackend } from './bridge.js';
import { space } from './encoding.js';
import { projectViaBridge, revision, type Source } from './projection.js';


const token = 'fixture-bridge-token-not-a-real-secret';
const config = { base: 'http://127.0.0.1:8090', token };
const version = 'a'.repeat(64);
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('Python桥接客户端', () => {
  it('配置只接受回环地址与足够长的令牌', () => {
    expect(readBridgeConfig({ OPS_BRIDGE_TOKEN: token })).toEqual(config);
    for (const env of [{}, { OPS_BRIDGE_TOKEN: 'short' }, { OPS_BRIDGE_TOKEN: token, OPS_BRIDGE_URL: 'http://10.0.0.5:8090' },
      { OPS_BRIDGE_TOKEN: token, OPS_BRIDGE_URL: 'http://127.0.0.1:8090/v1' }, { OPS_BRIDGE_TOKEN: token, OPS_BRIDGE_URL: 'https://127.0.0.1' }]) {
      expect(() => readBridgeConfig(env)).toThrow('BRIDGE_CONFIG');
    }
  });

  it('后端开关只认node与python', () => {
    expect(retrievalBackend({})).toBe('node');
    expect(retrievalBackend({ RETRIEVAL_BACKEND: 'python' })).toBe('python');
    expect(() => retrievalBackend({ RETRIEVAL_BACKEND: 'pyhton' })).toThrow('RETRIEVAL_BACKEND');
  });

  it('请求带服务令牌，失败只保留对方的固定码', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(504, { error: { code: 'EMBED_TIMEOUT' } }))
      .mockResolvedValueOnce(new Response('<html>private</html>', { status: 500 }));
    await expect(bridgeCall('/v1/chunks/search', { query: '甲' }, config, request)).rejects.toThrow(/^BRIDGE_EMBED_TIMEOUT$/);
    await expect(bridgeCall('/v1/chunks/search', { query: '甲' }, config, request)).rejects.toThrow(/^BRIDGE_HTTP_500$/);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8090/v1/chunks/search');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer ' + token);
    expect(init!.redirect).toBe('error');
  });

  it('检索响应按契约解析，向量空间不符即拒绝', async () => {
    const hit = { source_key: 'solution:K1', version, start: 0, end: 4, distance: 0.9 };
    const call = vi.fn().mockResolvedValue({ schema_version: 1, space, candidates: [hit] });
    await expect(bridgeSearch('网络', null, call)).resolves.toEqual([
      { sourceKey: 'solution:K1', version, start: 0, end: 4, distance: 0.9 }]);
    expect(call).toHaveBeenCalledWith('/v1/chunks/search', { query: '网络', group_id: null, limit: 24 });
    call.mockResolvedValue({ schema_version: 1, space: 'other_space', candidates: [hit] });
    await expect(bridgeSearch('网络', null, call)).rejects.toThrow('BRIDGE_CONTRACT');
  });

  it('写入数量与发送行数不一致视为失败', async () => {
    const row = { sourceKey: 'solution:K1', groupId: '12345678-1234-4123-8123-123456789012', version, start: 0, end: 4, text: '更换网线' };
    await expect(bridgeUpsert([row], vi.fn().mockResolvedValue({ written: 1 }))).resolves.toBe(1);
    await expect(bridgeUpsert([row, row], vi.fn().mockResolvedValue({ written: 1 }))).rejects.toThrow('BRIDGE_CONTRACT');
  });

  it('投影在Node端切片与计算版本，按16条分批交给桥接', async () => {
    const source: Source = { key: 'solution:K1', edition:1,audience: '12345678-1234-4123-8123-123456789012', title: '甲', body: '网'.repeat(4000) };
    const upsert = vi.fn().mockImplementation(async (rows: unknown[]) => rows.length);
    const total = await projectViaBridge(source, upsert);
    const batches = upsert.mock.calls.map(([rows]) => rows as { version: string; start: number }[]);
    expect(batches.map(rows => rows.length)).toEqual([16, 4]);
    expect(total).toBe(20);
    expect(batches.flat().every(row => row.version === revision(source))).toBe(true);
    expect(batches[1]![0]!.start).toBe(16 * 200);
  });
});
```

**apps/server/src/retrieval/bridge.ts**

```ts
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

// 外层35秒：Python内部编码20秒加Milvus10秒，外层必须更长，避免这里先放弃而对方仍在占用模型。
export async function bridgeCall(path: string, body: unknown, config = readBridgeConfig(), request: typeof fetch = fetch) {
  const response = await request(config.base + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
    body: JSON.stringify(body),
  });
  const reply: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = failure.safeParse(reply);
    throw new Error(parsed.success ? 'BRIDGE_' + parsed.data.error.code : 'BRIDGE_HTTP_' + response.status);
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
```

**apps/server/src/retrieval/projection.ts**

```ts
import { retrievalBackend, bridgeUpsert } from './bridge.js';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { PrismaService } from '../prisma/prisma.service.js';
import { chunks, dimension, encode, space } from './encoding.js';
import { ensureIndex, milvus } from './vector-index.js';

export const collection = 'service_knowledge_' + space;
export type Source = { key:string; audience:string; title:string; body:string; edition:number };
export function entrySource(entry:{id:string;companyId:string|null;kind:string;version:number;title:string;body:string}):Source {
  return {key:entry.kind+':'+entry.id,audience:entry.companyId ?? 'shared',edition:entry.version,title:entry.title,body:entry.body};
}
export function revision(source: Source) {
  return createHash('sha256').update(JSON.stringify([space, source.key, source.audience, source.title, source.body, source.edition])).digest('hex');
}

// 不把正文复制进 Milvus。以内容版本隔离迟到的旧写入，读侧核对权威记录。
export async function project(source: Source, embed = encode, send = milvus) {
  const version = revision(source);
  const parts = chunks(source.body);
  for (let i = 0; i < parts.length; i += 16) {
    const batch = parts.slice(i, i + 16);
    const vectors = await embed(batch.map(p => p.text), 'passage');
    const data = batch.map((p, j) => ({ id: [source.key, version, p.start].join('/'),
      sourceKey: source.key, audience: source.audience, version, start: p.start, end: p.end, vector: vectors[j] }));
    await send('entities/upsert', { collectionName: collection, data });
  }
  return parts.length;
}

export async function projectViaBridge(source: Source, upsert = bridgeUpsert) {
  const version = revision(source);
  const parts = chunks(source.body);
  for (let i = 0; i < parts.length; i += 16) {
    await upsert(parts.slice(i, i + 16).map(p => ({ sourceKey: source.key, groupId: source.audience, version,
      start: p.start, end: p.end, text: p.text })));
  }
  return parts.length;
}

export async function syncCatalogue(db: PrismaService, backend=retrievalBackend()) {
  if (backend === "node") await ensureIndex(collection, dimension);
  let count = 0;
  let lastId: string | undefined;
  for (;;) {
    const rows = await db.knowledgeEntry.findMany({where:{state:'published',id:{gt:lastId}},orderBy:{id:'asc'},take:32});
    if (!rows.length) break;
    for (const row of rows) count += await (backend==="node" ? project : projectViaBridge)(entrySource(row));
    lastId = rows.at(-1)!.id;
  }
  return { collection, chunksWritten: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/ops_ticket_test') throw new Error('TEST_DATABASE_REQUIRED');
  const { PrismaService: Database } = await import('../prisma/prisma.service.js');
  const db = new Database();
  try { console.log(JSON.stringify(await syncCatalogue(db))); } finally { await db.$disconnect(); }
}
```

**apps/server/src/retrieval/retrieve.ts**

```ts
import { bridgeSearch,retrievalBackend } from './bridge.js';
import { z } from 'zod';

import type { PrismaService } from '../prisma/prisma.service.js';
import { chunks, encode } from './encoding.js';
import { collection, entrySource, revision, type Source } from './projection.js';
import { milvus } from './vector-index.js';

const candidate = z.object({ sourceKey: z.string(), version: z.string(), start: z.number().int().nonnegative(),
  end: z.number().int().positive(), distance: z.number().finite() });
type Candidate = z.infer<typeof candidate>;
export type Citation = { sourceKey: string; title: string; version: string; start: number; end: number; quote: string; score: number };
export function scalarFilter(companyId:string):string {
  return 'audience in ["shared",'+JSON.stringify(z.uuid().parse(companyId))+']';
}

export function verifyCandidate(hit: Candidate, source: Source | null, companyId: string): Citation | null {
  if (!source || hit.sourceKey !== source.key || (source.audience !== 'shared' && source.audience !== companyId)) return null;
  if (hit.version !== revision(source)) return null;
  const part = chunks(source.body).find(p => p.start === hit.start && p.end === hit.end);
  if (!part) return null;
  return { sourceKey: source.key, title: source.title, version: hit.version,
    start: part.start, end: part.end, quote: part.text, score: hit.distance };
}

async function readSource(db: PrismaService, key: string, companyId: string) {
  const [kind,id] = key.split(':');
  if (!['manual','solution'].includes(kind ?? '') || !z.uuid().safeParse(id).success) return null;
  const row = await db.knowledgeEntry.findFirst({where:{id,kind,state:'published',OR:[{companyId:null},{companyId}]}});
  return row && entrySource(row);
}

async function nodeSearch(query:string,companyId:string) {
  const filter=scalarFilter(companyId);
  const vectors = await encode([Array.from(query).slice(0, 2048).join('')], 'query');
  return milvus('entities/search', { collectionName: collection,
    annsField: 'vector', data: vectors, limit: 24, filter, outputFields: ['sourceKey','version','start','end'] });
}

export async function retrieve(db: PrismaService, query: string, companyId: string, exclude: string, search: (query:string,companyId:string)=>Promise<unknown> = retrievalBackend()==="python" ? bridgeSearch : nodeSearch) {
  const filter = scalarFilter(companyId);
  if (filter === null || !query.trim()) return [];
  const text=Array.from(query).slice(0,2048).join('');
  const hits=z.array(candidate).parse(await search(text,companyId));
  const sources = new Map<string, Source | null>();
  const citations: Citation[] = [];
  for (const hit of hits) {
    if (hit.sourceKey === exclude || citations.some(c => c.sourceKey === hit.sourceKey)) continue;
    if (!sources.has(hit.sourceKey)) sources.set(hit.sourceKey, await readSource(db, hit.sourceKey, companyId));
    const citation = verifyCandidate(hit, sources.get(hit.sourceKey) ?? null, companyId);
    if (citation) citations.push(citation);
    if (citations.length === 3) break;
  }
  return citations;
}
```

## 五、核心面试题

接口超时后应该根据哪个标识串起两侧日志？

两个服务使用同一个请求标识，Node 负责业务授权，Python 只处理收到的限定请求。 [本日配套面试题](D102-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。
