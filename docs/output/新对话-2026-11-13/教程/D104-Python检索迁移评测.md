# D104（周六）：Python检索迁移评测

第 15 周 · 300 分钟。回忆 30、推导 45、集成 115、反证 50、口述与复盘 60。前置阅读见[上一讲](D103-跨服务故障与权限边界.md)。

## 今天要做出什么

把 D83 的固定题集逐题送入 Node 与 Python，保留排序、拒答和版本，不只比较平均值。

## 今天的目录结构

- `apps/server/src/retrieval/bridge.spec.ts`
- `apps/server/src/retrieval/bridge.ts`
- `apps/server/src/retrieval/eval/bench.spec.ts`
- `apps/server/src/retrieval/eval/bench.ts`

## 零、闭卷回忆

**D103**　超时回退能否自动放宽检索范围？

<details><summary>核对</summary>

回退仍带原范围，授权失败和下游不可用分别记录。

</details>

**D101**　改了模型版本还可以复用原集合吗？

<details><summary>核对</summary>

向量空间、条目标识和资料版本共同决定查询目标，先验证空间再比较距离。

</details>

**D97**　若失败材料排在第一位会怎样？

<details><summary>核对</summary>

保持每份材料的编号，结果分别携带成功值或错误；检查输入交换后仍可定位。

</details>

## 一、知识点与推导

先核对输入文本、空间和授权过滤，再查编码与排序；说明并列分数的处理。

示例取自当天通过的测试文件，完整文件（含导入与夹具）见第四节。

### 1.1 迁移对照只能改一个变量

这就是AB测试的“单一变量”原则用在工程迁移上：语料（9份合成资料）、标签（14题，开发7、留出7）、切片规则、阈值网格、混合与重排、门控逻辑、`k=3`全部不变，只替换编码实现。`runBench(backend)`接收后端名，`encoders`是一张只有两项的表；拼错后端直接抛`BAD_BACKEND`。两次运行写入**不同集合**（Python那次集合名加`_python`后缀），避免一次的向量被另一次读到，造成“看起来一致”。语料与标签的摘要`digest`写进报告：本次两遍与D83都是`0bf2793f0685516d`，说明比较的是同一份数据。

**可运行示例：两种后端都登记且各自指向真实实现**

来源：`apps/server/src/retrieval/eval/bench.spec.ts`。

```ts
  it('两种后端都登记且各自指向真实实现', () => {
    expect(Object.keys(encoders)).toEqual(['node', 'python']);
    expect(encoders.node).toBe(encode);
    // 防止“以为在评测Python、其实仍跑Node”。
    expect(encoders.python).toBe(bridgeEmbed);
  });
```

在`apps/server`运行：

```powershell
pnpm exec vitest run src/retrieval/eval/bench.spec.ts -t "两种后端都登记且各自指向真实实现"
```

**推导题：如果两个后端写进同一个集合，结论会怎样被污染？**

<details><summary>答案</summary>

主键相同的行会被后写的覆盖；先写的那次检索到的其实是后写的向量，两边当然“一致”。这种一致不证明任何事。

</details>

### 1.2 要比较的不只是汇总指标

汇总指标最容易掩盖差异：召回@3和MRR@3都是1，两套完全不同的排名也可能得到同一个数。所以逐层比较：①阈值标定（开发集选出的threshold与cost）；②留出集三种策略（dense/hybrid/gated）的全部指标对象逐字相等；③**每题**的三组排名（dense/hybrid/gated的ID序列）；④每题每个候选的相似度分数，取最大绝对差。本次结果：阈值都是0.7，三种策略指标与迁移前及D83完全相同，14/14题排名一致，相似度最大差0.000e+00（完全相同的浮点值）。最后一项说明Python与Node拿到的是同一批向量，这与D100逐元素对照的结论一致。

**可运行示例：桥接编码核对条数、维度与向量空间**

来源：`apps/server/src/retrieval/eval/bench.spec.ts`。

```ts
  it('桥接编码核对条数、维度与向量空间', async () => {
    const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    const ok = vi.fn().mockResolvedValue({ schema_version: 1, space, dimension: 1024, count: 2, vectors: [vector, vector] });
    await expect(bridgeEmbed(['甲', '乙'], 'passage', ok)).resolves.toHaveLength(2);
    expect(ok).toHaveBeenCalledWith('/v1/embedding', { role: 'passage', texts: ['甲', '乙'] });
    for (const bad of [{ schema_version: 1, space, dimension: 1024, count: 1, vectors: [vector, vector] },
      { schema_version: 1, space, dimension: 1024, count: 2, vectors: [vector, vector.slice(1)] },
      { schema_version: 1, space: 'other', dimension: 1024, count: 2, vectors: [vector, vector] }]) {
      await expect(bridgeEmbed(['甲', '乙'], 'passage', vi.fn().mockResolvedValue(bad))).rejects.toThrow('BRIDGE_CONTRACT');
    }
  });
```

在`apps/server`运行：

```powershell
pnpm exec vitest run src/retrieval/eval/bench.spec.ts -t "桥接编码核对条数、维度与向量空间"
```

**推导题：为什么即使指标完全相同，也还要看每题排名？**

<details><summary>答案</summary>

指标是聚合值，不同排名可能聚合成相同的数（例如两个都命中但顺序相反，召回不变）。逐题排名能发现这种“指标相同、行为不同”。

</details>

### 1.3 耗时和用量只能说明有限的事

报告里的`timing`是单次运行的单题耗时：Node p50 399.6ms、p95 431.2ms；Python p50 399.5ms、p95 465.3ms。这**不是压测**：样本只有14题，没有并发，没有重复运行取分布，p95由单个样本决定。能说的是“多一跳HTTP没有把单次检索的量级改变”；不能说“Python更快”或“开销是多少毫秒”。`usage`两边相同（14次查询编码、1次批量文档编码、523个输入码点），因为计数在评测程序里按调用次数记，与后端无关；它也不是真实账单（本机推理，无供应商金额）。

**可运行示例：范围不一致立即结束评测**

来源：`apps/server/src/retrieval/eval/bench.spec.ts`。

```ts
  it('范围不一致立即结束评测', () => {
    expect(()=>assemble(labels[0]!,[{id:'dns',similarity:1}])).toThrow('SCOPE_MISMATCH');
  });
```

在`apps/server`运行：

```powershell
pnpm exec vitest run src/retrieval/eval/bench.spec.ts -t "范围不一致立即结束评测"
```

**推导题：要得到可信的延迟对比，还需要什么？**

<details><summary>答案</summary>

固定并发下重复多轮、丢弃预热、记录完整分布（p50/p90/p99）、同一时段交替运行两种后端以抵消机器波动，并说明样本量。

</details>

### 1.4 对照通过不等于可以切默认

`RETRIEVAL_BACKEND`默认仍是`node`。本章证明的是：同一份数据、同一组查询下，编码迁到Python后效果指标与排名不变。没有证明的是：真实工单全量重建索引后一致、生产并发下的延迟与稳定性、Python进程的长期运行表现。切换默认应该再有两项依据：用真实数据重建一次索引并对照（本章只用合成语料），以及一段时间的并发与故障观察（D103只做了依赖重启）。

**可运行示例：近秩百分位按数值排序**

来源：`apps/server/src/retrieval/eval/bench.spec.ts`。

```ts
  it('近秩百分位按数值排序', () => {
    expect(percentile([20,3,100,1],0.5)).toBe(3);
    expect(percentile([20,3,100,1],0.95)).toBe(100);
  });
```

在`apps/server`运行：

```powershell
pnpm exec vitest run src/retrieval/eval/bench.spec.ts -t "近秩百分位按数值排序"
```

**推导题：什么情况下你会接受指标略有下降但仍然迁移？**

<details><summary>答案</summary>

要有明确收益（例如后续能用Python生态做重排或评测）、下降幅度小于标注噪声、并且有回退开关。本章的情况更简单：指标完全没变，所以迁移本身不构成效果风险。

</details>

## 二、动手开发

1. 把 D83 的固定题集逐题送入 Node 与 Python，保留排序、拒答和版本，不只比较平均值。
2. 从 `bridge.spec.ts`、`bridge.ts`、`bench.spec.ts` 的公开入口开始，把断言写在调用方。先保存失败结果，再修改实现并重跑同一输入。
3. 只有一题不同，应从哪里找原因？ 对照运行记录回答，补一个相邻状态或不同身份的样例。

在 `apps/server` 运行 `pnpm exec vitest run src/retrieval/bridge.spec.ts`。

在 `apps/server` 运行 `pnpm exec vitest run src/retrieval/eval/bench.spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

把 D83 的固定题集逐题送入 Node 与 Python，保留排序、拒答和版本，不只比较平均值。

</details>

<details><summary>提示二 · 切换一个条件</summary>

只有一题不同，应从哪里找原因？

</details>

<details><summary>提示三 · 对照判定</summary>

先核对输入文本、空间和授权过滤，再查编码与排序；说明并列分数的处理。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

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
```

**apps/server/src/retrieval/eval/bench.spec.ts**

```ts
import { assemble, encoders, percentile, usage } from './bench.js';
import { bridgeEmbed } from '../bridge.js';
import { encode, space } from '../encoding.js';
import { labels } from './gold.js';
describe('本机评测报告', () => {
  it('近秩百分位按数值排序', () => {
    expect(percentile([20,3,100,1],0.5)).toBe(3);
    expect(percentile([20,3,100,1],0.95)).toBe(100);
  });
  it('范围不一致立即结束评测', () => {
    expect(()=>assemble(labels[0]!,[{id:'dns',similarity:1}])).toThrow('SCOPE_MISMATCH');
  });
  it('本机调用保留未知费用', () => {
    expect(usage(14,1,90)).toEqual({queryCalls:14,passageCalls:1,inputCodePoints:90,generatedTokens:0,monetaryCost:null});
  });
});

describe('评测后端选择', () => {
  it('两种后端都登记且各自指向真实实现', () => {
    expect(Object.keys(encoders)).toEqual(['node', 'python']);
    expect(encoders.node).toBe(encode);
    // 防止“以为在评测Python、其实仍跑Node”。
    expect(encoders.python).toBe(bridgeEmbed);
  });

  it('桥接编码核对条数、维度与向量空间', async () => {
    const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    const ok = vi.fn().mockResolvedValue({ schema_version: 1, space, dimension: 1024, count: 2, vectors: [vector, vector] });
    await expect(bridgeEmbed(['甲', '乙'], 'passage', ok)).resolves.toHaveLength(2);
    expect(ok).toHaveBeenCalledWith('/v1/embedding', { role: 'passage', texts: ['甲', '乙'] });
    for (const bad of [{ schema_version: 1, space, dimension: 1024, count: 1, vectors: [vector, vector] },
      { schema_version: 1, space, dimension: 1024, count: 2, vectors: [vector, vector.slice(1)] },
      { schema_version: 1, space: 'other', dimension: 1024, count: 2, vectors: [vector, vector] }]) {
      await expect(bridgeEmbed(['甲', '乙'], 'passage', vi.fn().mockResolvedValue(bad))).rejects.toThrow('BRIDGE_CONTRACT');
    }
  });
});
```

**apps/server/src/retrieval/eval/bench.ts**

```ts
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { bridgeEmbed } from '../bridge.js';
import { dimension, encode, model, space } from '../encoding.js';
import { ensureIndex, milvus } from '../vector-index.js';
import { labels, passages, validateSet, type Label } from './gold.js';
import { lexical, fuse, rerankCode } from './hybrid.js';
import { accept, calibrate, type Candidate } from './abstain.js';
import { metrics } from './metrics.js';

export function percentile(values: number[], fraction: number) {
  if (!values.length || fraction <= 0 || fraction > 1 || !Number.isFinite(fraction) || values.some(v=>!Number.isFinite(v) || v<0)) throw Error('BAD_LATENCY');
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(fraction*sorted.length)-1]!;
}

export function assemble(label: Label, dense: Candidate[]) {
  const docs=passages.filter(d=>d.group===label.group || d.group==='shared');
  const visible=new Set(docs.map(d=>d.id));
  if (dense.some(c=>!visible.has(c.id))) throw Error('SCOPE_MISMATCH');
  const byId=new Map(dense.map(c=>[c.id,c]));
  const words=lexical(label.query,docs).map(c=>c.id);
  const fused=fuse([dense.map(c=>c.id),words],visible);
  // 本实验对全部可见资料计算向量分数，所以两路候选均能复用原始相似度。
  return rerankCode(label.query,fused,docs).map(id=>{
    const c=byId.get(id);
    if (!c) throw Error('MISSING_SIMILARITY');
    return c;
  });
}
export function usage(queryCalls: number, passageCalls: number, points: number) {
  return {queryCalls,passageCalls,inputCodePoints:points,generatedTokens:0,monetaryCost:null};
}

export type Encoder = (texts: string[], role: 'query' | 'passage') => Promise<number[][]>;
export const encoders: Record<'node' | 'python', Encoder> = { node: encode, python: bridgeEmbed };

// 评测只替换编码实现，语料、标签、阈值网格、混合与门控完全不变。
export async function runBench(backend: 'node' | 'python' = 'node') {
  const embed = encoders[backend];
  if (!embed) throw Error('BAD_BACKEND');
  const digest=validateSet(passages,labels);
  const collectionName='verify_w12_'+digest.slice(0,16)+'_'+space+(backend==='node'?'':'_'+backend);
  const weightSha256='06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439';
  const info=await fetch('http://127.0.0.1:11434/api/show',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
  if (!info.ok) throw Error('MODEL_INFO_UNAVAILABLE');
  const { modelfile }=z.object({modelfile:z.string()}).parse(await info.json());
  if (!modelfile.split(/\r?\n/).some(line=>line.startsWith('FROM ') && line.trimEnd().endsWith(weightSha256))) throw Error('WEIGHT_MISMATCH');
  const started=performance.now();
  await ensureIndex(collectionName,dimension);
  const vectors=await embed(passages.map(d=>d.text),'passage');
  await milvus('entities/upsert',{collectionName,data:passages.map((d,i)=>({id:d.id,groupTag:d.group,vector:vectors[i]}))});
  const setupMs=performance.now()-started;
  const observations=[];
  for (const label of labels) {
    const start=performance.now();
    const query=await embed([label.query],'query');
    const raw=await milvus('entities/search',{collectionName,data:query,annsField:'vector',limit:passages.length,filter:'groupTag in ["shared",'+JSON.stringify(label.group)+']'});
    const dense=z.array(z.object({id:z.string(),distance:z.number().finite()})).parse(raw).map(h=>({id:h.id,similarity:h.distance}));
    if (new Set(dense.map(h=>h.id)).size!==passages.filter(d=>d.group===label.group || d.group==='shared').length) throw Error('INCOMPLETE_SEARCH');
    const candidates=assemble(label,dense);
    observations.push({label,dense,candidates,elapsedMs:performance.now()-start});
  }
  const grid=[0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,1.01];
  const calibration=calibrate(observations.filter(r=>r.label.split==='dev'),grid);
  const k=3;
  const rows=observations.map(r=>({id:r.label.id,split:r.label.split,family:r.label.family,group:r.label.group,
    query:r.label.query,expectedSources:r.label.relevant,
    dense:r.dense.slice(0,k).map(c=>c.id),hybrid:r.candidates.slice(0,k).map(c=>c.id),
    gated:accept(r.candidates,calibration.threshold,k),scores:r.candidates,elapsedMs:r.elapsedMs}));
  const held=rows.filter(r=>r.split==='holdout');
  const summary=(key:'dense'|'hybrid'|'gated')=>metrics(held.map(r=>({label:labels.find(l=>l.id===r.id)!,ranked:r[key]})),passages,k);
  const times=rows.map(r=>r.elapsedMs);
  return {schema:1,backend,digest,space,model,weightSha256,collectionName,corpus:passages,k,grid,calibration,rows,
    heldout:{dense:summary('dense'),hybrid:summary('hybrid'),gated:summary('gated')},
    timing:{setupMs,p50:percentile(times,0.5),p95:percentile(times,0.95)},
    usage:usage(labels.length,1,[...passages.map(d=>d.text),...labels.map(l=>l.query)].reduce((n,t)=>n+Array.from(t).length,0))};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const backend=process.argv[3]==='python'?'python':'node';
  const report=await runBench(backend);
  if (process.argv[2]) await writeFile(process.argv[2],JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({backend:report.backend,digest:report.digest,calibration:report.calibration,heldout:report.heldout,timing:report.timing,usage:report.usage}));
}
```

## 五、核心面试题

只有一题不同，应从哪里找原因？

先核对输入文本、空间和授权过滤，再查编码与排序；说明并列分数的处理。 [本日配套面试题](D104-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。

[本章验收记录](../学习记录/新版验收/D104逐题.json)。
