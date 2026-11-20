# D71（周一）：Milvus单机服务与只读探针

第 11 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D70-第十周复盘.md)。

## 今天要做出什么

启动本机隔离的 Milvus，连续做两次只读探针，再暂停该实例复查结果。

## 今天的目录结构

- `apps/server/src/retrieval/milvus-probe.spec.ts`
- `apps/server/src/retrieval/milvus-probe.ts`
- `infra/docker-compose.milvus.yml`

## 零、闭卷回忆

**D70**　结构校验通过后还可能被哪一层拒绝？

<details><summary>核对</summary>

行范围是服务端判断，合法参数可以指向无权读取的工单。

</details>

**D68**　断流后立刻重新生成，会不会重复记账？

<details><summary>核对</summary>

先读持久轮次与结算状态，已终结的请求回放原结果，只允许一次扣费。

</details>

**D64**　同一轮最多执行几次由谁决定？

<details><summary>核对</summary>

控制循环的代码校验工具白名单、参数及步数预算，超限保存停止原因。

</details>

## 一、知识点与推导

探针只证服务响应，资料是否存在需查集合、索引和投影水位。

知识点示例取自当天已通过测试，按语法树排版；需要同一文件中的导入与夹具，不能孤立粘贴运行。完成对应文件后用所列命令复现。

### 1.1 从进程健康到数据接口可读

etcd 保存元数据，MinIO 保存对象，Milvus 单机进程协调读写和检索。Compose 先等待两个依赖健康，再启动 Milvus。探针先访问 19091 的 /healthz，失败即结束。这一步帮助定位基础服务故障。

**可运行示例：健康失败时不进入数据接口**

来源：`apps/server/src/retrieval/milvus-probe.spec.ts`。输入、预期结果和断言如下；完整夹具见第四节。

```ts
it('健康失败时不进入数据接口', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(probeMilvus(request)).rejects.toThrow('MILVUS_HEALTH_FAILED');
    expect(request).toHaveBeenCalledTimes(1);
});
```

在`apps/server`运行：

```powershell
pnpm test src/retrieval/milvus-probe.spec.ts -t "健康失败时不进入数据接口"
```

**推导题：管理端点失败时是否还要发送集合查询？**

<details><summary>答案</summary>

应立即返回健康错误。否则第二次请求的错误会覆盖最早出现的故障。

</details>

### 1.2 把成功条件写成数据契约

第二次请求使用 POST /v2/vectordb/collections/list，传入默认库。HTTP 成功后，还要验证 JSON 的 code 为 0 且 data 是字符串数组。工具输出只包含库名和集合数，便于写入验证记录。

**可运行示例：拒绝 HTTP 成功中的业务错误码**

来源：`apps/server/src/retrieval/milvus-probe.spec.ts`。输入、预期结果和断言如下；完整夹具见第四节。

```ts
it('拒绝 HTTP 成功中的业务错误码', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response())
        .mockResolvedValueOnce(Response.json({ code: 100, data: [] }));
    await expect(probeMilvus(request)).rejects.toThrow('MILVUS_LIST_FAILED');
});
```

在`apps/server`运行：

```powershell
pnpm test src/retrieval/milvus-probe.spec.ts -t "拒绝 HTTP 成功中的业务错误码"
```

**推导题：服务返回 HTTP 200、code 100 和空列表，能继续建索引吗？**

<details><summary>答案</summary>

应先定位业务错误。空列表只在成功业务码下有意义。

</details>

### 1.3 空集合与检索验收

初次启动时，集合数可能是零。能列集合证明服务可处理基本元数据请求。下一步需要独立验证集合维度、索引加载、向量写入与搜索。业务工单和文档的权威记录保存在 PostgreSQL，后续索引应能从这些记录重建。

**可运行示例：空库也能完成只读检查**

来源：`apps/server/src/retrieval/milvus-probe.spec.ts`。输入、预期结果和断言如下；完整夹具见第四节。

```ts
it('空库也能完成只读检查', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response())
        .mockResolvedValueOnce(Response.json({ code: 0, data: [] }));
    expect(await probeMilvus(request)).toEqual({ database: 'default', collections: 0 });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"dbName":"default"}' });
});
```

在`apps/server`运行：

```powershell
pnpm test src/retrieval/milvus-probe.spec.ts -t "空库也能完成只读检查"
```

**推导题：已有集合时怎样复用这个探针？**

<details><summary>答案</summary>

报告实际数量，保持只读。不同运行可以共享已有测试卷，因此不能把数量固定为零作为就绪条件。

</details>

## 二、动手开发

1. 启动本机隔离的 Milvus，连续做两次只读探针，再暂停该实例复查结果。
2. 从 `milvus-probe.spec.ts`、`milvus-probe.ts`、`docker-compose.milvus.yml` 的公开入口开始，把断言写在调用方。先保存失败结果，再修改实现并重跑同一输入。
3. 探针能否证明某份资料已进入检索结果？ 对照运行记录回答，补一个相邻状态或不同身份的样例。

在 `apps/server` 运行 `pnpm exec vitest run src/retrieval/milvus-probe.spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

启动本机隔离的 Milvus，连续做两次只读探针，再暂停该实例复查结果。

</details>

<details><summary>提示二 · 切换一个条件</summary>

探针能否证明某份资料已进入检索结果？

</details>

<details><summary>提示三 · 对照判定</summary>

探针只证服务响应，资料是否存在需查集合、索引和投影水位。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/src/retrieval/milvus-probe.spec.ts**

```ts
import { probeMilvus } from './milvus-probe.js';

describe('本机 Milvus 就绪探针', () => {
  it('健康失败时不进入数据接口', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(probeMilvus(request)).rejects.toThrow('MILVUS_HEALTH_FAILED');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('拒绝 HTTP 成功中的业务错误码', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response())
      .mockResolvedValueOnce(Response.json({ code: 100, data: [] }));
    await expect(probeMilvus(request)).rejects.toThrow('MILVUS_LIST_FAILED');
  });
  it('空库也能完成只读检查', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response())
      .mockResolvedValueOnce(Response.json({ code: 0, data: [] }));
    expect(await probeMilvus(request)).toEqual({ database: 'default', collections: 0 });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"dbName":"default"}' });
  });
});
```

**apps/server/src/retrieval/milvus-probe.ts**

```ts
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

const collectionList = z.object({ code: z.literal(0), data: z.array(z.string()) });

// 两个请求共享截止时间。业务接口返回成功后才报告集合数。
export async function probeMilvus(request: typeof fetch = fetch) {
  const signal = AbortSignal.timeout(5000);
  const health = await request('http://127.0.0.1:19091/healthz', { signal, redirect: 'error' });
  await health.body?.cancel();
  if (!health.ok) throw new Error('MILVUS_HEALTH_FAILED');
  const response = await request('http://127.0.0.1:19531/v2/vectordb/collections/list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dbName: 'default' }), signal, redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('MILVUS_HTTP_FAILED');
  }
  const result = collectionList.safeParse(await response.json());
  if (!result.success) throw new Error('MILVUS_LIST_FAILED');
  return { database: 'default', collections: result.data.data.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await probeMilvus()));
}
```

**infra/docker-compose.milvus.yml**

```text
# 单独的本地检索栈。MinIO 和 etcd 仅对栈内服务开放。
services:
  etcd:
    image: quay.io/coreos/etcd:v3.5.18
    command: etcd --advertise-client-urls=http://etcd:2379 --listen-client-urls=http://0.0.0.0:2379 --data-dir=/etcd
    volumes: [etcd-data:/etcd]
    healthcheck:
      test: ["CMD", "etcdctl", "endpoint", "health"]
      interval: 5s
      timeout: 5s
      retries: 15
  minio:
    image: milvusdb/minio:RELEASE.2024-12-18T13-15-44Z
    command: server /data
    volumes: [minio-data:/data]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 15
  milvus:
    image: milvusdb/milvus:v2.5.16
    command: ["milvus", "run", "standalone"]
    environment:
      ETCD_ENDPOINTS: etcd:2379
      MINIO_ADDRESS: minio:9000
      MINIO_REGION: us-east-1
    depends_on:
      etcd: {condition: service_healthy}
      minio: {condition: service_healthy}
    ports: ["127.0.0.1:19531:19530", "127.0.0.1:19091:9091"]
    volumes: [milvus-data:/var/lib/milvus]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9091/healthz"]
      interval: 5s
      timeout: 5s
      retries: 24
volumes:
  etcd-data: {}
  minio-data: {}
  milvus-data: {}
```

## 五、核心面试题

探针能否证明某份资料已进入检索结果？

探针只证服务响应，资料是否存在需查集合、索引和投影水位。 [本日配套面试题](D71-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机检索模块 39 项通过。固定题集共 14 题，7 题留出评测包含两题应拒答。[检索测试](../.cache/验证/新版验收/D84-retrieval.log) · [逐题记录](../.cache/验证/新版验收/D83逐题.json)。
