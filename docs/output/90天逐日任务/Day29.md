# Day 29：队列/BullMQ（v1 请求内长任务 → v2 队列 + 重试 → v3 jobId 幂等 + 死信 + 取消）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-11 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\apps\api`
角色视角：完成 Day 28 Redis 缓存（Cache-aside + 限流 + 幂等键），第一次遇到"文档摄取在 HTTP 请求里跑 30 秒、用户重试后重复处理、请求超时返回 500 但后台还在跑"痛点的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + LLM 集成 + RAG）
   Day 21：NestJS 架构深化（模块边界 + DI scope）
   Day 22：API 合同（DTO + OpenAPI + 版本兼容）
   Day 23：数据建模（Conversation/Message/Citation 聚合 + 索引）
   Day 24：鉴权/权限（JWT + RBAC/ABAC + 资源授权）
   Day 25：后端测试（测试金字塔 + mutation）
   Day 26：流式 BFF（流透传 + 背压 + 取消）
   Day 27：Postgres 持久化（ACID + Outbox + 乐观锁 + 软删除）
   Day 28：Redis 缓存（Cache-aside + TTL + 限流 + 幂等键）
   Day 29：队列/BullMQ（jobId 幂等 + 重试退避 + 死信 + 取消）  ← 今天在这里
   Day 30：M3 门禁 + 全栈端到端

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 29 在阶段一第 9 天**。Day 28 解决了"读多写少数据加速"（缓存），但还没解决"长任务异步化"（队列）。Day 15-20 LangChain RAG 要做"文档摄取"（切块 + embedding），一个 100MB PDF 摄取耗时 30 秒；Day 12 Agent Loop 的"长诊断"（调模型 + 多轮工具）也可能耗时 20 秒。如果这些长任务都在 HTTP 请求里跑，就会出现：请求超时（浏览器 60 秒 timeout）、Event Loop 阻塞（其他请求变慢）、用户重试导致重复处理（没有幂等键）、任务失败不能重试（进程崩溃就丢了）。今天要把长任务从请求里搬到 **BullMQ 队列**，请求快速返回 jobId、worker 异步执行、失败自动重试、毒任务进死信、用户能取消。

### 到 Day 28 结束时项目已具备的能力

- **数据建模**（Day 23）：Conversation / Message / Citation / Diagnosis 聚合
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除
- **缓存**（Day 28）：Redis Cache-aside + 限流 + 分布式幂等键
- **缺失的一块**：文档摄取（切块 + embedding）和长诊断（多轮 Agent Loop）都在 HTTP 请求里同步执行——一个 100MB PDF 摄取 30 秒，浏览器超时返回 500，但后台还在跑（占着内存和 DB 连接）；用户刷新重试后，又启动一个重复任务；进程崩溃时，未完成任务直接丢失，没有重试机制

### 今天要解决的 4 个问题

1. **问题 1：长任务阻塞 HTTP 请求 → 超时 + Event Loop 阻塞**
   用户上传一个 100MB PDF，请求 `POST /documents/ingest` 在后端要执行"切块（RecursiveCharacterTextSplitter）+ embedding（调 OpenAI embedding API）"，耗时 30 秒。30 秒内浏览器一直等待，其他用户的请求也变慢（Node.js 单线程 Event Loop 被阻塞）。60 秒后浏览器超时返回 `Request Timeout`，但后台还在执行摄取（浪费资源、用户看不到进度）。**标准解是队列异步化：请求快速返回 jobId（200ms），worker 进程异步执行摄取，前端轮询 job 状态或通过 WebSocket 推送进度。**

2. **问题 2：用户重试 → 重复处理（无 jobId 幂等）**
   用户上传 PDF 后等了 60 秒超时，浏览器显示"上传失败"，用户点"重试"又上传一次。后端收到两次请求，启动两个摄取任务，同一个 PDF 被切块两次、写入两份重复的 chunks。如果用 Day 28 的 `requestId` 幂等键，能防止重复调模型，但**队列的幂等性不是靠 Redis key，而是靠 jobId——同一个 jobId 在队列里只存在一次，重复添加时返回已有 job**。jobId 应该用文档的内容哈希（`sha256(fileContent)`），保证"同一文件只摄取一次"。

3. **问题 3：任务失败不能重试 → 进程崩溃丢任务**
   worker 在写入第 3 个 chunk 后崩溃（例如 DB 连接断开、OOM），任务直接丢失。重启后没有重试机制，用户的文档永远停留在"摄取中"状态。**标准解是队列的自动重试 + 退避策略**：BullMQ 会在失败后自动重新入队（最多重试 N 次），每次重试间隔指数增长（1s / 2s / 4s / 8s...，避免瞬间重试把 DB 打挂）。重试 N 次后仍失败的任务进入**死信队列（DLQ）**，人工介入处理。

4. **问题 4：毒任务无限重试 → 占满队列 + 用户无法取消**
   某个 PDF 格式损坏，解析时必定抛错。worker 重试 100 次全失败，占满队列（后续正常任务被阻塞）。用户点"取消"按钮，但 worker 没有取消检查（`signal.aborted`），继续重试。**标准解是有限重试 + 死信 + 取消传播**：最多重试 3 次就进死信；worker 在每个 chunk 写入前检查 `signal.aborted`，取消时主动结束并标记 job 为 `cancelled`。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`QueueModule`**：用 BullMQ 把"文档摄取"和"长诊断"从 HTTP 请求迁入队列，请求快速返回 jobId、worker 异步执行、jobId 幂等（同一文件只摄取一次）、失败自动重试（最多 3 次 + 退避）、毒任务进死信、用户能取消。

### 1.1 用户能看到什么

**场景 1：文档摄取队列化（请求快速返回 jobId）**

```
时间轴（v1 vs v3）：

v1 行为（请求内同步执行）：
15:00:00.000  用户：POST /documents/ingest  Body: {file: 100MB PDF}
  → 后端同步执行摄取（切块 + embedding）
  → 30 秒后返回 {chunks: [...]}
  浏览器等待 30 秒（白屏、无进度）

v3 行为（队列异步化）：
15:00:00.000  用户：POST /documents/ingest  Body: {file: 100MB PDF}
  → 后端：计算 jobId = sha256(fileContent)
  → 添加到 BullMQ 队列：queue.add('ingest', {fileId, jobId}, {jobId})
  → 200ms 后返回 {jobId: 'job-abc-123', status: 'waiting'}
  
15:00:00.200  前端收到 jobId，开始轮询状态：
  GET /jobs/job-abc-123/status  → {status: 'active', progress: 10}
  
15:00:10.000  worker 执行中（切块完成，开始 embedding）
  GET /jobs/job-abc-123/status  → {status: 'active', progress: 50}
  
15:00:30.000  worker 完成
  GET /jobs/job-abc-123/status  → {status: 'completed', result: {chunks: [...]}}
```

用户体验：
- v1：浏览器等 30 秒（白屏），超时返回 500
- v3：200ms 返回 jobId，前端显示进度条（10% → 50% → 100%），可以关闭页面、稍后回来看结果

**场景 2：jobId 幂等（重复上传不重复处理）**

```
时间轴（同一文件上传两次）：

15:00:00.000  用户第 1 次上传：POST /documents/ingest  Body: {file: PDF-A}
  → jobId = sha256(PDF-A 内容) = 'job-abc-123'
  → queue.add('ingest', {fileId: 'f-01', jobId}, {jobId: 'job-abc-123'})
  → 返回 {jobId: 'job-abc-123', status: 'waiting'}
  → worker 开始执行

15:00:05.000  用户第 2 次上传（浏览器超时后重试）：POST /documents/ingest  Body: {file: PDF-A}
  → jobId = sha256(PDF-A 内容) = 'job-abc-123'（同一个）
  → queue.add('ingest', {fileId: 'f-02', jobId}, {jobId: 'job-abc-123'})
  → BullMQ 发现 jobId 已存在，返回已有 job
  → 返回 {jobId: 'job-abc-123', status: 'active'}（不创建新 job）

最终：只有 1 个 worker 在执行，PDF-A 只摄取一次
```

**场景 3：失败重试 + 死信（毒任务不占满队列）**

```
时间轴（worker 崩溃 + 毒文档）：

15:10:00.000  job-001 开始执行（正常 PDF）
  → worker 写入 chunk 1/10
  → worker 写入 chunk 2/10
  → worker 写入 chunk 3/10
  → worker 崩溃（OOM）

15:10:05.000  BullMQ 自动重试 job-001（第 1 次重试，延迟 1 秒）
  → worker 重新执行（从头开始，幂等写入）
  → 成功完成

15:15:00.000  job-002 开始执行（毒文档，PDF 格式损坏）
  → worker 解析 PDF → 抛 ParsingError
  → 标记失败

15:15:01.000  第 1 次重试（延迟 1 秒）
  → worker 再次解析 → 抛 ParsingError
  → 标记失败

15:15:03.000  第 2 次重试（延迟 2 秒）
  → worker 再次解析 → 抛 ParsingError
  → 标记失败

15:15:07.000  第 3 次重试（延迟 4 秒）
  → worker 再次解析 → 抛 ParsingError
  → 达到最大重试次数（3 次），移入死信队列（DLQ）

15:15:08.000  job-003 开始执行（正常 PDF）
  → 不被 job-002 阻塞，正常完成
```

运维观察：
- 死信队列里有 1 个 job-002（毒文档）
- 主队列继续处理后续任务（不被阻塞）
- 人工介入：查看 job-002 的错误日志、修复格式、手动重新入队

**场景 4：用户取消（传播到 worker）**

```
时间轴（用户点取消按钮）：

15:20:00.000  job-004 开始执行（100MB PDF，预计 30 秒）
  → worker 写入 chunk 1/100

15:20:05.000  用户点"取消"按钮
  → 前端：PUT /jobs/job-004/cancel
  → 后端：标记 job.data.cancelled = true

15:20:05.100  worker 在写入 chunk 6/100 前检查取消信号
  → if (job.data.cancelled) { throw new JobCancelledError() }
  → worker 主动结束，标记 job.status = 'failed'（reason: 'cancelled'）

15:20:05.200  前端轮询状态
  → GET /jobs/job-004/status  → {status: 'failed', reason: 'cancelled'}
  → 显示"已取消"
```

最终用户体验：
- 请求快速返回（200ms）
- 重复上传不重复处理（jobId 幂等）
- worker 崩溃自动重试（最多 3 次）
- 毒任务进死信（不阻塞后续任务）
- 用户能取消长任务（5 秒内停止）

### 1.2 这个模块在项目里承担什么

- **输入**：文档摄取请求（`POST /documents/ingest`）、长诊断请求（`POST /agent/runs`）、取消请求（`PUT /jobs/:id/cancel`）
- **输出**：快速返回 jobId（200ms）+ worker 异步执行 + WebSocket 推送进度 + 失败自动重试 + 死信队列
- **对齐后续**：今天的 **jobId 幂等 + 重试退避 + 死信** 是 Day 30 M3 门禁"可靠性"验收项的核心（要求长任务不阻塞请求、失败可重试、毒任务不占满队列）；也是阶段三 p2-agent-workbench 多 Agent 协同时的异步任务基座

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 请求内同步执行长任务（阻塞） | 单文件 `documents.controller.ts`（直接调摄取逻辑） | 为什么"请求内长任务"有风险（超时 + 阻塞 + 不可重试） |
| **v1 痛点** | 请求超时、Event Loop 阻塞、重复处理、失败丢任务 |  |  |
| **v2** | v1 + **BullMQ 队列 + 重试退避** | 拆出 `queue/` 模块（producer / worker / retry） | BullMQ 基础、job 状态、重试退避策略 |
| **v2 痛点** | 无 jobId 幂等（重复添加）、无死信（毒任务占满队列）、无取消（用户点取消按钮无效） |  |  |
| **v3** | v2 + **jobId 幂等 + 死信 + 取消传播** | 完整分层（producer / worker / job-registry / dead-letter / cancel） | jobId 幂等、死信队列、取消传播、进度推送 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：队列涉及 5 个独立关注点（producer 添加任务 / worker 执行任务 / jobId 幂等 / 重试退避 + 死信 / 取消传播），如果不先立起骨架，写到一半就会把"job 状态查询"糊进 controller、把重试逻辑散落在 worker、把取消判断写成 if 散落、把死信处理当成普通异常捕获。看完这棵树，下面章节再出现 `queue/worker/ingest.worker.ts` 时，你就能立刻定位它属于"worker 执行层"而不是 producer。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── queue/                                      ← 【本日新增】BullMQ 队列模块
│   ├── producer/
│   │   ├── queue.producer.ts                   ← 添加 job（带 jobId 幂等）
│   │   └── queue.producer.spec.ts              ← producer 单测
│   ├── worker/
│   │   ├── ingest.worker.ts                    ← 文档摄取 worker
│   │   ├── diagnosis.worker.ts                 ← 长诊断 worker
│   │   └── base.worker.ts                      ← worker 基类（取消检查）
│   ├── job-registry/
│   │   ├── job-status.service.ts               ← job 状态查询
│   │   └── job-status.service.spec.ts          ← 状态查询单测
│   ├── dead-letter/
│   │   ├── dlq.listener.ts                     ← 死信队列监听器
│   │   └── dlq.service.ts                      ← 死信处理逻辑
│   ├── cancel/
│   │   ├── cancel-propagation.service.ts       ← 取消传播（标记 job.data.cancelled）
│   │   └── job-cancelled.error.ts              ← 取消异常
│   ├── config/
│   │   ├── queue.config.ts                     ← Redis 连接 + 重试策略
│   │   └── retry-backoff.ts                    ← 退避策略纯函数
│   ├── queue.module.ts                         ← NestJS 模块
│   └── index.ts                                ← 桶文件
├── documents/                                  ← 【Day 15-20 已有】需接入队列
│   ├── documents.controller.ts                 ← 改：POST /ingest 返回 jobId
│   └── ingest.service.ts                       ← 改：调 producer.add
├── agent/                                      ← 【Day 12 已有】需接入队列
│   ├── agent.controller.ts                     ← 改：POST /runs 返回 jobId
│   └── agent.service.ts                        ← 改：调 producer.add
└── config/
    └── redis.config.ts                         ← 【Day 28 已有】复用
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `documents.controller.ts` | ✓ 请求内同步摄取 | ✓ 调 producer.add | ✓ 同 v2 |
| `queue.producer.ts` | ✗ | ✓ add job（无 jobId 幂等） | ✓ add job + jobId 幂等 |
| `ingest.worker.ts` | ✗ | ✓ 基础执行 + 重试 | ✓ 同 v2 + 取消检查 |
| `retry-backoff.ts` | ✗ | ✓ 指数退避纯函数 | ✓ 同 v2 |
| `dlq.listener.ts` | ✗ | ✗ | ✓ 监听 failed 事件移入 DLQ |
| `cancel-propagation.service.ts` | ✗ | ✗ | ✓ 标记 job.data.cancelled |
| `base.worker.ts` | ✗ | ✗ | ✓ 取消检查基类 |

**依赖方向（务必单向，反过来一次都不行）**：

```
documents.controller.ts / agent.controller.ts
        │
        ▼
queue.producer.ts                               ← 添加 job（带 jobId）
        │
        └─► BullMQ Queue 实例

ingest.worker.ts / diagnosis.worker.ts          ← 执行 job
        │
        ├─► base.worker.ts（取消检查基类）
        │
        └─► ingest.service.ts（真正的摄取逻辑）

dlq.listener.ts                                 ← 监听 failed 事件
        │
        └─► dlq.service.ts（移入死信队列）

cancel-propagation.service.ts                   ← 标记取消
        │
        └─► BullMQ Job 实例
```

**红线**：
- worker 里不能直接调 `queue.add`（循环依赖）——worker 只负责执行，添加 job 是 producer 的职责
- jobId 不能用随机数（重复添加会创建多个 job）——应该用文件内容哈希（`sha256(fileContent)`）
- 重试策略不能是"失败立即重试"（会瞬间把 DB 打挂）——必须有退避延迟（1s / 2s / 4s / 8s...）
- worker 取消检查不能只在开头检查一次（长任务执行到一半取消无效）——应该在每个 chunk 写入前检查
- 死信任务不能自动重新入队（会无限循环）——需要人工介入修复、手动重新入队

**动手前先问自己 3 个问题**：

1. jobId 幂等为什么用文件内容哈希而不是 `requestId`？—— 见 §5.4 知识点 3「jobId 语义」
2. 重试退避为什么是指数增长（1s / 2s / 4s...）而不是固定 1 秒？—— 见 §5.4 知识点 4「退避策略」
3. 死信队列为什么不能自动重试？—— 见 §5.4 知识点 5「死信 vs 重试」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：装 BullMQ 依赖（3 分钟）

按第 5.3 节的代码：

- `pnpm --filter api add bullmq`
- `pnpm --filter api add -D @types/bullmq`
- 确认 Redis 可用：`redis-cli ping` → 返回 `PONG`（Day 28 已启动）

**边写边问自己**：

- 为什么用 BullMQ 而不是 Bull？（BullMQ 是 Bull v4，用 Redis Streams 替代 List，性能更高、支持优先级队列、死信队列内置）
- BullMQ 依赖 Redis 的什么数据结构？（Redis Streams + Sorted Sets）

### 1.5.2 D-2：创建目录 + 队列配置（5 分钟）

按第 5.3 节的目录树，在 `apps/api/src/queue/` 下建 5 个子目录：`producer/` `worker/` `job-registry/` `dead-letter/` `cancel/` `config/`。

在 `config/queue.config.ts` 里定义重试策略：

```typescript
export const queueConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  defaultJobOptions: {
    attempts: 3, // 最多重试 3 次
    backoff: {
      type: 'exponential', // 指数退避
      delay: 1000, // 基础延迟 1 秒
    },
    removeOnComplete: false, // 保留完成的 job（方便审计）
    removeOnFail: false, // 保留失败的 job（移入死信）
  },
}
```

**边写边问自己**：

- `attempts: 3` 包括第一次执行吗？（不包括——第一次不算重试，失败后才重试 3 次，共 4 次机会）
- `removeOnComplete: false` 会导致内存泄漏吗？（会——生产要定期清理，例如保留 7 天）

### 1.5.3 D-3：写 producer + queue.module.ts（7 分钟）

按第 5.3 节的代码：

- 写 `producer/queue.producer.ts`（封装 `queue.add` + jobId 幂等）
- 写 `queue.module.ts`（注册 Queue / Worker provider）
- 在 `app.module.ts` 导入 `QueueModule`

**边写边问自己**：

- `queue.add('ingest', data, {jobId})` 的第三个参数为什么能保证幂等？（BullMQ 在 Redis 里用 jobId 作 key，重复添加时返回已有 job）
- Worker 为什么要单独进程运行？（隔离故障——worker 崩溃不影响 API 服务；独立扩容——worker 可以横向扩到 10 个实例）

### 1.5.4 D-4：写 ingest.worker 核心（5 分钟）

按第 5.3 节的代码：

- 写 `worker/ingest.worker.ts`（监听 `ingest` 队列，执行摄取逻辑）
- 写 `worker/base.worker.ts`（取消检查基类）

**边写边问自己**：

- worker 的 `process` 方法为什么是 async？（可能要调 DB / OpenAI API，异步操作）
- 如果 `process` 抛错，job 会怎样？（标记为 failed，根据重试策略决定是否重新入队）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 20 min | §3-§5 三版演进 + §5.4 知识点 5 项 | 心里能画出"请求内同步→队列+重试→jobId幂等+死信+取消"的演进路径 |
| B：读代码 | 20 min | §5.3 逐文件通读，特别是 `queue.producer.ts` 和 `ingest.worker.ts` | 能口述"jobId 幂等的原理"、"退避策略怎么计算延迟" |
| C：读深挖 | 20 min | §6.5 前端底子补弱（`Day29深挖-前端底子补弱.html`） | 能回答"前端任务队列（micro-task / macro-task）vs 后端消息队列的异同" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-4 | 骨架文件全部创建，producer 能添加 job |
| E：写核心测试 | 40 min | §7.2 三个 spec（producer / worker / 取消） | `pnpm --filter api test queue` 全绿 |
| F-1：反证 1 | 20 min | §7.3 去掉 jobId，验证重复处理 | 观察"v2 无 jobId 时同一文件摄取两次" |
| F-2：反证 2 | 20 min | §7.4 去掉死信，毒任务占满队列 | 观察"v2 无 DLQ 时后续任务被阻塞" |
| F-3：验证 + 提交 | 20 min | §7.5 四件套 + commit | commit 含 `Refs: Day29` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（请求内同步执行长任务，阻塞）

### 3.1 v1 要实现什么

最直觉的做法：文档摄取在 HTTP 请求里同步执行。

**目标**：
- `POST /documents/ingest` 接收文件、切块、生成 embedding、写入 DB，完成后返回结果
- 整个过程在请求里完成（30 秒）

**不做**：
- 不做队列异步化（请求等到任务完成才返回）
- 不做 jobId 幂等（重复上传创建重复任务）
- 不做重试（失败就失败了）
- 不做取消

### 3.2 v1 目录结构

```
apps/api/src/documents/
├── documents.controller.ts          ← POST /ingest 同步执行
└── ingest.service.ts                ← 切块 + embedding 逻辑
```

### 3.3 v1 完整代码

**apps/api/src/documents/ingest.service.ts（v1 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'

@Injectable()
export class IngestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 文档摄取：切块 + embedding + 写入 DB（同步执行，耗时 30 秒）
   */
  async ingestDocument(fileContent: string, fileId: string): Promise<{ chunks: number }> {
    // 第 1 步：切块（耗时 1 秒）
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 })
    const docs = await splitter.createDocuments([fileContent])

    // 第 2 步：生成 embedding（调 OpenAI API，耗时 20 秒）
    const embeddings = new OpenAIEmbeddings()
    const vectors = await embeddings.embedDocuments(docs.map((d) => d.pageContent))

    // 第 3 步：写入 DB（耗时 5 秒）
    for (let i = 0; i < docs.length; i++) {
      await this.prisma.chunk.create({
        data: {
          fileId,
          content: docs[i].pageContent,
          embedding: vectors[i],
          index: i,
        },
      })
    }

    return { chunks: docs.length }
  }
}
```

**apps/api/src/documents/documents.controller.ts（v1 全文）**

```typescript
import { Controller, Post, Body } from '@nestjs/common'
import { IngestService } from './ingest.service'

@Controller('documents')
export class DocumentsController {
  constructor(private readonly ingest: IngestService) 

  /**
   * v1：请求内同步执行摄取（阻塞 30 秒）
   */
  @Post('/ingest')
  async ingestDocument(@Body() body: { fileContent: string; fileId: string }) {
    const result = await this.ingest.ingestDocument(body.fileContent, body.fileId)
    return result // 30 秒后才返回
  }
}
```

### 3.4 v1 暴露的痛点

**痛点 1：请求超时（浏览器 60 秒 timeout）**

100MB PDF 摄取耗时 30 秒，浏览器等待 30 秒后返回结果。如果摄取耗时超过 60 秒（例如更大的文件），浏览器超时返回 `Request Timeout`，但后台还在执行（浪费资源）。

**痛点 2：Event Loop 阻塞（其他请求变慢）**

Node.js 单线程，一个请求在等待 `embedDocuments` 的 30 秒内，虽然 Event Loop 没完全卡死（因为 await 会让出），但如果同时有 10 个文档上传，就有 10 个并发的长任务，内存占用高、DB 连接池吃满，其他用户的查询请求也变慢。

**痛点 3：重复处理（用户重试 → 重复摄取）**

用户上传后等了 60 秒超时，浏览器显示"上传失败"，用户点"重试"又上传一次。后端收到两次请求，同一个 PDF 被摄取两次、写入两份重复的 chunks。

**痛点 4：失败不能重试（进程崩溃 → 任务丢失）**

摄取到一半时进程崩溃（OOM / DB 断开），任务直接丢失，用户的文档永远停留在"处理中"状态。没有重试机制。

---

## 4. v2：BullMQ 队列 + 重试退避

### 4.1 v2 要实现什么

用户视角：上传文档后请求快速返回 jobId（200ms），前端轮询状态；worker 异步执行摄取；失败自动重试（最多 3 次，指数退避）。

**目标**：
- `POST /documents/ingest` 快速返回 jobId（不等摄取完成）
- worker 进程监听 `ingest` 队列，异步执行摄取
- 失败自动重试（第 1 次延迟 1 秒、第 2 次 2 秒、第 3 次 4 秒）

**依然不做**：
- jobId 幂等（重复上传创建多个 job）
- 死信队列（毒任务无限重试）
- 取消传播（用户点取消无效）

### 4.2 v2 目录结构

```
apps/api/src/queue/
├── producer/
│   ├── queue.producer.ts                ← 新增：添加 job
│   └── queue.producer.spec.ts           ← 新增
├── worker/
│   ├── ingest.worker.ts                 ← 新增：执行摄取
│   └── base.worker.ts                   ← 新增：worker 基类
├── config/
│   ├── queue.config.ts                  ← 新增：重试策略
│   └── retry-backoff.ts                 ← 新增：退避计算
└── queue.module.ts                      ← 新增
```

### 4.3 v2 完整代码

**apps/api/src/queue/config/retry-backoff.ts（v2 全文）**

```typescript
/**
 * 指数退避：第 N 次重试的延迟 = baseDelay * 2^(N-1)
 * @param attempt 重试次数（1, 2, 3...）
 * @param baseDelay 基础延迟（毫秒）
 * @returns 延迟时间（毫秒）
 */
export function exponentialBackoff(attempt: number, baseDelay = 1000): number {
  return baseDelay * Math.pow(2, attempt - 1)
}
```

**apps/api/src/queue/config/queue.config.ts（v2 全文）**

```typescript
import { ConnectionOptions } from 'bullmq'

export const queueConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  } as ConnectionOptions,
  defaultJobOptions: {
    attempts: 3, // 最多重试 3 次
    backoff: {
      type: 'exponential', // 指数退避
      delay: 1000, // 第 1 次重试延迟 1 秒
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
}
```

**apps/api/src/queue/producer/queue.producer.ts（v2 全文，无 jobId 幂等）**

```typescript
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import { queueConfig } from '../config/queue.config'

@Injectable()
export class QueueProducer {
  private readonly ingestQueue: Queue

  constructor() {
    this.ingestQueue = new Queue('ingest', queueConfig)
  }

  /**
   * 添加文档摄取任务（v2：无 jobId 幂等，重复添加会创建多个 job）
   */
  async addIngestJob(data: { fileId: string; fileContent: string }): Promise<string> {
    const job = await this.ingestQueue.add('ingest', data)
    return job.id! // 返回 BullMQ 生成的随机 ID
  }

  async getJobStatus(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId)
    if (!job) return { status: 'not_found' }

    const state = await job.getState()
    const progress = job.progress
    return { status: state, progress }
  }
}
```

**apps/api/src/queue/worker/ingest.worker.ts（v2 全文）**

```typescript
import { Worker, Job } from 'bullmq'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { IngestService } from '../../documents/ingest.service'
import { queueConfig } from '../config/queue.config'

@Injectable()
export class IngestWorker implements OnModuleInit {
  private worker: Worker

  constructor(private readonly ingest: IngestService) {}

  onModuleInit() {
    this.worker = new Worker(
      'ingest',
      async (job: Job) => {
        // 真正的摄取逻辑（调 IngestService）
        const { fileId, fileContent } = job.data
        const result = await this.ingest.ingestDocument(fileContent, fileId)

        // 更新进度（可选）
        await job.updateProgress(100)

        return result
      },
      queueConfig,
    )

    // 监听失败事件
    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err.message)
    })
  }
}
```

**apps/api/src/documents/documents.controller.ts（v2 改动）**

```typescript
import { Controller, Post, Body, Get, Param } from '@nestjs/common'
import { QueueProducer } from '../queue/producer/queue.producer'

@Controller('documents')
export class DocumentsController {
  constructor(private readonly queue: QueueProducer) {}

  /**
   * v2：请求快速返回 jobId（200ms）
   */
  @Post('/ingest')
  async ingestDocument(@Body() body: { fileContent: string; fileId: string }) {
    const jobId = await this.queue.addIngestJob(body)
    return { jobId, status: 'waiting' }
  }

  /**
   * 查询 job 状态（前端轮询）
   */
  @Get('/jobs/:jobId/status')
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.queue.getJobStatus(jobId)
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：无 jobId 幂等 → 重复处理**

v2 的 `addIngestJob` 没有传 `jobId` 参数，BullMQ 每次都生成随机 ID。用户上传同一文件两次，创建两个 job，同一文件摄取两次。

**痛点 2：无死信队列 → 毒任务占满队列**

某个 PDF 格式损坏，worker 解析时必定抛错。重试 3 次全失败后，job 标记为 `failed`，但仍然留在主队列里。如果有 100 个毒任务，主队列被占满，后续正常任务被阻塞。

**痛点 3：无取消传播 → 用户点取消无效**

用户点"取消"按钮，前端调 `PUT /jobs/:id/cancel`，但 worker 没有取消检查，继续执行摄取（30 秒后才完成），浪费资源。

**痛点 4：重试策略不可观测**

v2 配置了指数退避，但没有监控"重试了多少次"、"退避延迟是多少"。生产环境看不到重试行为。

---

## 5. v3：jobId 幂等 + 死信 + 取消传播（终态）

### 5.1 v3 要实现什么

用户视角：
1. 重复上传同一文件只创建一个 job（jobId = sha256(fileContent)）
2. 重试 3 次仍失败的毒任务移入死信队列（不阻塞后续任务）
3. 用户点取消按钮后 worker 主动停止（5 秒内）
4. 继承 v2 的队列异步化 + 重试退避

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/queue/
├── producer/
│   ├── queue.producer.ts                ← v2 已有，改：加 jobId 参数
│   └── queue.producer.spec.ts           ← v2 已有
├── worker/
│   ├── ingest.worker.ts                 ← v2 已有，改：继承 BaseWorker
│   └── base.worker.ts                   ← 改：加取消检查
├── dead-letter/
│   ├── dlq.listener.ts                  ← 新增：监听 failed 事件
│   └── dlq.service.ts                   ← 新增：移入 DLQ
├── cancel/
│   ├── cancel-propagation.service.ts    ← 新增：标记取消
│   └── job-cancelled.error.ts           ← 新增
├── config/                              ← v2 已有
└── queue.module.ts
```

### 5.3 v3 完整代码

#### 5.3.1 producer 层：queue.producer.ts（加 jobId 幂等）

```typescript
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import { queueConfig } from '../config/queue.config'
import { createHash } from 'crypto'

@Injectable()
export class QueueProducer {
  private readonly ingestQueue: Queue

  constructor() {
    this.ingestQueue = new Queue('ingest', queueConfig)
  }

  /**
   * 添加文档摄取任务（v3：用文件内容哈希作 jobId，保证幂等）
   */
  async addIngestJob(data: { fileId: string; fileContent: string }): Promise<string> {
    // jobId = 文件内容哈希（同一文件只摄取一次）
    const jobId = this.computeJobId(data.fileContent)

    const job = await this.ingestQueue.add('ingest', data, { jobId })
    return job.id! // 重复添加时返回已有 job 的 ID
  }

  private computeJobId(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  async getJobStatus(jobId: string) {
    const job = await this.ingestQueue.getJob(jobId)
    if (!job) return { status: 'not_found' }

    const state = await job.getState()
    const progress = job.progress
    return { status: state, progress }
  }
}
```

#### 5.3.2 worker 层：base.worker.ts（取消检查基类）

```typescript
import { Job } from 'bullmq'
import { JobCancelledError } from '../cancel/job-cancelled.error'

export abstract class BaseWorker {
  /**
   * 取消检查：如果 job.data.cancelled = true，抛 JobCancelledError。
   * 子类在每个可中断点调用（例如每写入一个 chunk 前）。
   */
  protected checkCancellation(job: Job): void {
    if (job.data.cancelled) {
      throw new JobCancelledError(job.id!)
    }
  }
}
```

#### 5.3.3 cancel 层：job-cancelled.error.ts

```typescript
export class JobCancelledError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job ${jobId} was cancelled`)
    this.name = 'JobCancelledError'
  }
}
```

#### 5.3.4 cancel 层：cancel-propagation.service.ts

```typescript
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'

@Injectable()
export class CancelPropagationService {
  constructor(private readonly ingestQueue: Queue) {}

  /**
   * 标记 job 为已取消（设置 job.data.cancelled = true）。
   * worker 在下一次 checkCancellation 时会抛 JobCancelledError。
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.ingestQueue.getJob(jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)

    // 更新 job.data（标记取消）
    await job.updateData({ ...job.data, cancelled: true })
  }
}
```

#### 5.3.5 worker 层：ingest.worker.ts（接入取消检查）

```typescript
import { Worker, Job } from 'bullmq'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { IngestService } from '../../documents/ingest.service'
import { queueConfig } from '../config/queue.config'
import { BaseWorker } from './base.worker'

@Injectable()
export class IngestWorker extends BaseWorker implements OnModuleInit {
  private worker: Worker

  constructor(private readonly ingest: IngestService) {
    super()
  }

  onModuleInit() {
    this.worker = new Worker(
      'ingest',
      async (job: Job) => {
        // 开始前检查取消
        this.checkCancellation(job)

        const { fileId, fileContent } = job.data

        // 切块
        const chunks = await this.ingest.splitDocument(fileContent)

        // 逐个 chunk 写入（每次写入前检查取消）
        for (let i = 0; i < chunks.length; i++) {
          this.checkCancellation(job) // 可中断点

          await this.ingest.writeChunk(fileId, chunks[i], i)
          await job.updateProgress((i + 1) / chunks.length * 100)
        }

        return { chunks: chunks.length }
      },
      queueConfig,
    )

    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err.message)
    })
  }
}
```

#### 5.3.6 dead-letter 层：dlq.listener.ts

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common'
import { QueueEvents } from 'bullmq'
import { DlqService } from './dlq.service'
import { queueConfig } from '../config/queue.config'

@Injectable()
export class DlqListener implements OnModuleInit {
  private queueEvents: QueueEvents

  constructor(private readonly dlq: DlqService) {}

  onModuleInit() {
    this.queueEvents = new QueueEvents('ingest', queueConfig)

    /**
     * 监听 failed 事件：job 重试 3 次仍失败时触发。
     * 将失败的 job 移入死信队列（DLQ）。
     */
    this.queueEvents.on('failed', async ({ jobId, failedReason }) => {
      console.warn(`Job ${jobId} moved to DLQ: ${failedReason}`)
      await this.dlq.moveToDeadLetter(jobId, failedReason)
    })
  }
}
```

#### 5.3.7 dead-letter 层：dlq.service.ts

```typescript
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import { queueConfig } from '../config/queue.config'

@Injectable()
export class DlqService {
  private readonly dlq: Queue

  constructor() {
    this.dlq = new Queue('dead-letter', queueConfig)
  }

  /**
   * 将失败的 job 移入死信队列。
   * DLQ 里的 job 不会自动重试，需要人工介入。
   */
  async moveToDeadLetter(jobId: string, reason: string): Promise<void> {
    await this.dlq.add('dead-job', { jobId, reason, movedAt: new Date() })
  }

  /**
   * 查询死信队列（供运维人员查看）
   */
  async listDeadLetters(limit = 100) {
    const jobs = await this.dlq.getJobs(['completed', 'failed'], 0, limit)
    return jobs.map((j) => ({ id: j.id, data: j.data, timestamp: j.timestamp }))
  }
}
```

#### 5.3.8 documents.controller.ts：接入取消

```typescript
import { Controller, Post, Body, Get, Param, Put } from '@nestjs/common'
import { QueueProducer } from '../queue/producer/queue.producer'
import { CancelPropagationService } from '../queue/cancel/cancel-propagation.service'

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly queue: QueueProducer,
    private readonly cancel: CancelPropagationService,
  ) 

  @Post('/ingest')
  async ingestDocument(@Body() body: { fileContent: string; fileId: string }) {
    const jobId = await this.queue.addIngestJob(body)
    return { jobId, status: 'waiting' }
  }

  @Get('/jobs/:jobId/status')
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.queue.getJobStatus(jobId)
  }

  /**
   * 取消任务（标记 job.data.cancelled = true）
   */
  @Put('/jobs/:jobId/cancel')
  async cancelJob(@Param('jobId') jobId: string) {
    await this.cancel.cancelJob(jobId)
    return { cancelled: true }
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：BullMQ 队列 vs HTTP 请求**
- 解决的问题：长任务阻塞 HTTP 请求 → 超时 + Event Loop 压力大
- 运行机制：请求快速返回 jobId（200ms）；worker 进程异步执行；前端轮询状态或 WebSocket 推送进度
- 项目落点：`queue.add` 添加 job；`Worker` 监听队列执行任务
- 生产误区：所有任务都用队列（简单查询不需要队列）；worker 和 API 共用一个进程（worker 崩溃影响 API）
- 验证方法：上传文档后请求 200ms 返回；`redis-cli XLEN bull:ingest:wait` 看队列长度

**知识点 2：job 状态机**
- 解决的问题：任务执行过程中的状态不可观测（不知道在等待 / 执行中 / 完成 / 失败）
- 运行机制：waiting（等待 worker）→ active（执行中）→ completed（成功）/ failed（失败）/ delayed（延迟重试）
- 项目落点：`job.getState()` 查询状态；前端轮询展示进度
- 生产误区：状态查询没有缓存（频繁查 Redis 压力大）；前端轮询间隔太短（100ms 一次太频繁）
- 验证方法：`redis-cli XREAD STREAMS bull:ingest:events $ COUNT 10` 看事件流

**知识点 3：jobId 幂等**
- 解决的问题：重复上传同一文件创建多个 job（重复处理）
- 运行机制：`queue.add(name, data, {jobId})` 时，BullMQ 用 jobId 作 Redis key；重复添加时返回已有 job
- 项目落点：`jobId = sha256(fileContent)`，保证同一文件只摄取一次
- 生产误区：jobId 用 `requestId`（前端每次刷新生成新 requestId，幂等失效）；jobId 用随机数（没有幂等）
- 验证方法：同一文件上传两次，`redis-cli KEYS bull:ingest:*` 只有一个 job key

**知识点 4：重试退避策略**
- 解决的问题：任务失败立即重试 → 瞬间重试把 DB 打挂（例如 DB 连接断开时重试 100 次）
- 运行机制：指数退避 = 第 N 次重试延迟 `baseDelay * 2^(N-1)`（1s / 2s / 4s / 8s...）
- 项目落点：`backoff: { type: 'exponential', delay: 1000 }`
- 生产误区：固定延迟 1 秒（DB 恢复需要 10 秒，1 秒重试没用）；无限重试（应该有最大次数，例如 3 次）
- 验证方法：注入 DB 断开故障，观察重试间隔（`redis-cli XREAD` 看 delayed 事件时间戳）

**知识点 5：死信队列（DLQ）**
- 解决的问题：毒任务无限重试 → 占满队列（后续正常任务被阻塞）
- 运行机制：重试 N 次仍失败的 job 移入死信队列；DLQ 里的 job 不会自动重试，需要人工介入
- 项目落点：监听 `failed` 事件，调 `dlq.moveToDeadLetter`
- 生产误区：DLQ 自动重试（会无限循环）；DLQ 不监控（毒任务堆积不知道）
- 验证方法：上传损坏 PDF，重试 3 次后进 DLQ；`redis-cli XLEN bull:dead-letter:wait` 看 DLQ 长度

**知识点 6：取消传播**
- 解决的问题：用户点取消按钮后 worker 还在跑（浪费资源）
- 运行机制：前端调 `/jobs/:id/cancel` → 标记 `job.data.cancelled = true` → worker 在每个可中断点检查 `cancelled`，是则抛 `JobCancelledError`
- 项目落点：`BaseWorker.checkCancellation` 在每个 chunk 写入前调用
- 生产误区：只在 worker 开头检查一次（长任务执行到一半取消无效）；取消后不清理部分产物（DB 里留下脏数据）
- 验证方法：上传大文件，执行 5 秒后点取消，10 秒内 worker 停止

### 5.5 边写边问自己

- jobId 为什么用文件内容哈希而不是 `requestId`？（requestId 是前端生成的随机 ID，每次刷新都变；内容哈希保证"同一文件同一 jobId"）
- 重试退避为什么是指数增长而不是固定 1 秒？（DB 恢复可能需要 10 秒，固定 1 秒重试 10 次还没恢复；指数退避给系统更多恢复时间）
- 死信队列为什么不能自动重试？（毒任务的失败是必然的，例如 PDF 格式损坏，自动重试会无限循环；需要人工修复再手动重新入队）
- worker 取消检查为什么在每个 chunk 写入前而不是只在开头？（开头检查只能阻止还没开始的任务；执行到一半的任务需要在循环里每次检查才能及时停止）

---

## 6. 三版对比一览表

| 对比维度 | v1：请求内同步 | v2：队列 + 重试 | v3：jobId 幂等 + 死信 + 取消（终态） |
|---|---|---|---|
| **任务执行位置** | HTTP 请求内（阻塞 30 秒） | worker 进程异步 | 同 v2 |
| **请求响应时间** | 30 秒（等任务完成） | 200ms（返回 jobId） | 同 v2 |
| **失败重试** | ✗ 失败即丢失 | ✓ 自动重试 3 次 + 退避 | 同 v2 |
| **jobId 幂等** | ✗ 重复上传重复处理 | ✗ 重复上传重复处理 | ✓ 同一文件只摄取一次 |
| **死信队列** | ✗ 无 | ✗ 毒任务占满队列 | ✓ 重试 3 次后进 DLQ |
| **取消传播** | ✗ 无法取消 | ✗ 点取消无效 | ✓ worker 检查 cancelled |
| **Event Loop** | 阻塞（并发 10 个长任务） | 不阻塞（worker 独立进程） | 同 v2 |
| **可观测性** | ✗ 不知道进度 | ✓ job 状态 + progress | 同 v2 + DLQ 监控 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

**为什么要补弱前端任务队列**：今天学的是"后端消息队列"（BullMQ），但前端开发必须同时掌握"浏览器事件循环的任务队列"（micro-task / macro-task）。面试官问"任务队列"时，如果只会 BullMQ 不会事件循环，会暴露前端底子薄弱。

**深挖入口**：

打开并完整阅读 `output/90天逐日任务/Day29深挖-前端底子补弱.html`（该文件今天要创建），内容覆盖：

1. **micro-task vs macro-task**
   - micro-task（微任务）：Promise.then / queueMicrotask / MutationObserver
   - macro-task（宏任务）：setTimeout / setInterval / requestAnimationFrame / I/O
   - 执行顺序：一个 macro-task → 清空 micro-task 队列 → 渲染 → 下一个 macro-task
   - 为什么 Promise.then 比 setTimeout 先执行？（micro-task 在当前宏任务结束后立即执行；setTimeout 要等下一轮宏任务）

2. **前端任务队列 vs 后端消息队列的异同**
   - 相同：都是"异步化"，避免阻塞主线程 / Event Loop
   - 不同：前端队列在浏览器单个 Tab 里（无持久化）；后端队列在 Redis 里（跨进程、可持久化、可重试）
   - 为什么前端长任务要用 Web Worker 而不是 Promise？（Promise 仍在主线程，计算密集任务会阻塞 UI；Web Worker 是真正的多线程）

3. **requestIdleCallback**
   - 用途：在浏览器空闲时执行低优先级任务（例如日志上报、预加载）
   - 为什么不用 setTimeout(fn, 0)？（setTimeout 最小延迟 4ms，且会在每一帧执行；requestIdleCallback 只在空闲时执行，不影响渲染）
   - React Scheduler 的原理：自己实现了类似 requestIdleCallback 的调度（因为浏览器的 requestIdleCallback 兼容性差）

4. **实战案例**
   - 场景：前端上传大文件，需要在浏览器里计算文件哈希（sha256），但计算耗时 5 秒会冻结 UI
   - 定位：主线程被 `crypto.subtle.digest` 阻塞
   - 修复：用 Web Worker 计算哈希，主线程只负责接收结果

**验收问题**：

- 请对比"浏览器 micro-task 队列"和"BullMQ 队列"：哪个有持久化？哪个能跨进程？哪个能自动重试？
- 为什么 `Promise.resolve().then(() => console.log('A'))` 比 `setTimeout(() => console.log('B'), 0)` 先执行？
- 场景：用户上传 100MB 文件需要在浏览器计算哈希，你会用 Promise 包装 `crypto.subtle.digest` 还是用 Web Worker？为什么？

---

## 7. 项目验收清单（阶段 E-F，约 120 分钟）

### 7.1 四件套（前置，5 分钟）

```bash
cd apps/api
pnpm typecheck   # 类型检查
pnpm lint        # ESLint
pnpm test        # 单元测试（含 producer / worker / 取消）
pnpm test:e2e    # E2E 测试（可选）
```

全部通过再继续。

### 7.2 核心测试（40 分钟）

#### 7.2.1 producer 幂等（queue.producer.spec.ts）

```typescript
import { describe, it, expect } from 'vitest'
import { QueueProducer } from './queue.producer'

describe('QueueProducer', () => {
  it('同一文件内容多次添加返回同一 jobId', async () => {
    const producer = new QueueProducer()
    const data = { fileId: 'f-01', fileContent: 'test content' }

    const jobId1 = await producer.addIngestJob(data)
    const jobId2 = await producer.addIngestJob(data)

    expect(jobId1).toBe(jobId2) // 幂等：同一 jobId
  })

  it('不同文件内容返回不同 jobId', async () => {
    const producer = new QueueProducer()
    const data1 = { fileId: 'f-01', fileContent: 'content A' }
    const data2 = { fileId: 'f-02', fileContent: 'content B' }

    const jobId1 = await producer.addIngestJob(data1)
    const jobId2 = await producer.addIngestJob(data2)

    expect(jobId1).not.toBe(jobId2)
  })
})
```

#### 7.2.2 worker 执行 + 重试（ingest.worker.spec.ts）

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Job } from 'bullmq'
import { IngestWorker } from './ingest.worker'
import { IngestService } from '../../documents/ingest.service'

describe('IngestWorker', () => {
  it('成功执行返回 chunks 数量', async () => {
    const ingest = {
      splitDocument: vi.fn().mockResolvedValue(['chunk1', 'chunk2']),
      writeChunk: vi.fn().mockResolvedValue(undefined),
    } as any
    const worker = new IngestWorker(ingest)

    const job = {
      data: { fileId: 'f-01', fileContent: 'test' },
      updateProgress: vi.fn(),
    } as any

    const result = await worker['process'](job)
    expect(result).toEqual({ chunks: 2 })
    expect(ingest.writeChunk).toHaveBeenCalledTimes(2)
  })

  it('失败时抛错触发重试', async () => {
    const ingest = {
      splitDocument: vi.fn().mockRejectedValue(new Error('DB error')),
    } as any
    const worker = new IngestWorker(ingest)

    const job = { data: { fileId: 'f-01', fileContent: 'test' } } as any

    await expect(worker['process'](job)).rejects.toThrow('DB error')
  })
})
```

#### 7.2.3 取消传播（cancel-propagation.service.spec.ts）

```typescript
import { describe, it, expect, vi } from 'vitest'
import { CancelPropagationService } from './cancel-propagation.service'
import { Queue } from 'bullmq'

describe('CancelPropagationService', () => {
  it('标记 job 为已取消', async () => {
    const job = {
      data: { fileId: 'f-01' },
      updateData: vi.fn(),
    }
    const queue = {
      getJob: vi.fn().mockResolvedValue(job),
    } as any
    const cancel = new CancelPropagationService(queue)

    await cancel.cancelJob('job-123')

    expect(job.updateData).toHaveBeenCalledWith({ fileId: 'f-01', cancelled: true })
  })

  it('job 不存在时抛错', async () => {
    const queue = {
      getJob: vi.fn().mockResolvedValue(null),
    } as any
    const cancel = new CancelPropagationService(queue)

    await expect(cancel.cancelJob('job-999')).rejects.toThrow('Job job-999 not found')
  })
})
```

### 7.3 反证实验 1：去掉 jobId，验证重复处理（20 分钟）

**目标**：证明"v2 无 jobId 幂等时同一文件摄取两次"。

**步骤**：

1. 修改 `queue.producer.ts`：去掉 `jobId` 参数（让 BullMQ 生成随机 ID）

```typescript
// v2 行为（无 jobId）
const job = await this.ingestQueue.add('ingest', data) // 不传 {jobId}
```

2. 上传同一文件两次：

```bash
curl -X POST http://localhost:3000/documents/ingest \
  -H 'Content-Type: application/json' \
  -d '{"fileId":"f-01","fileContent":"test content"}'

curl -X POST http://localhost:3000/documents/ingest \
  -H 'Content-Type: application/json' \
  -d '{"fileId":"f-01","fileContent":"test content"}'
```

3. 查看 Redis 队列：

```bash
redis-cli XLEN bull:ingest:wait
# v2（无 jobId）：返回 2（两个 job）
# v3（有 jobId）：返回 1（幂等）
```

4. 查看 DB：

```sql
SELECT COUNT(*) FROM chunk WHERE file_id = 'f-01';
-- v2：两份重复 chunks
-- v3：一份 chunks
```

**证据**：截图 Redis 队列长度 + DB 重复数据。

### 7.4 反证实验 2：去掉死信，毒任务占满队列（20 分钟）

**目标**：证明"v2 无 DLQ 时毒任务占满队列"。

**步骤**：

1. 注释 `dlq.listener.ts` 的监听逻辑（不移入死信）
2. 上传 10 个损坏 PDF（格式错误，必定解析失败）：

```bash
for i in {1..10}; do
  curl -X POST http://localhost:3000/documents/ingest \
    -d '{"fileId":"poison-'$i'","fileContent":"<invalid PDF>"}'
done
```

3. 每个毒任务重试 3 次，占用队列 4 次（1 次初始 + 3 次重试）
4. 查看主队列：

```bash
redis-cli XLEN bull:ingest:failed
# v2（无 DLQ）：返回 10（毒任务留在主队列）
# v3（有 DLQ）：返回 0（移入死信）
```

5. 上传正常文件：

```bash
curl -X POST http://localhost:3000/documents/ingest \
  -d '{"fileId":"normal","fileContent":"valid content"}'
```

6. 观察：
   - v2：正常任务被阻塞（因为 worker 在处理前面的毒任务）
   - v3：正常任务立即执行（毒任务已移入 DLQ）

**证据**：截图队列状态 + 正常任务等待时间。

### 7.5 反证实验 3：取消传播（可选，15 分钟）

**目标**：证明"v3 用户点取消后 worker 及时停止"。

**步骤**：

1. 上传大文件（模拟 30 秒摄取）：

```bash
curl -X POST http://localhost:3000/documents/ingest \
  -d '{"fileId":"big","fileContent":"'$(head -c 10MB /dev/urandom | base64)'"}'
```

2. 5 秒后点取消：

```bash
curl -X PUT http://localhost:3000/jobs/{jobId}/cancel
```

3. 观察 worker 日志：
   - v2（无取消检查）：30 秒后完成（取消无效）
   - v3（有取消检查）：5 秒内停止并抛 `JobCancelledError`

**证据**：worker 日志时间戳。

### 7.6 四件套 + commit（20 分钟）

```bash
pnpm typecheck && pnpm lint && pnpm test
git add .
git commit -m "feat(queue): BullMQ 队列 + jobId 幂等 + 死信 + 取消

- 文档摄取迁入队列（请求快速返回 jobId）
- jobId 幂等（同一文件只摄取一次）
- 重试退避策略（指数退避 1s/2s/4s）
- 死信队列（重试 3 次后进 DLQ）
- 取消传播（worker 检查 cancelled）

Refs: Day29"
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day 30 结束时集中 push。

---

## 8. 通过标准

- [ ] 文档摄取请求 200ms 返回（不等摄取完成）
- [ ] 同一文件上传两次只创建一个 job（jobId 幂等）
- [ ] worker 失败自动重试 3 次（指数退避）
- [ ] 重试 3 次仍失败的任务进死信队列（不阻塞后续任务）
- [ ] 用户点取消按钮后 10 秒内 worker 停止
- [ ] 四件套全绿，commit 含 `Refs: Day29`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day29`，未执行 `git push`）
2. 测试输出截图（producer / worker / 取消三个 spec 全绿）
3. 反证实验证据（无 jobId 时重复处理 + 无 DLQ 时毒任务占满队列）
4. 学习日志（250 字）
5. 架构证据（可选）：BullMQ UI dashboard 截图（队列状态 + job 详情）

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"队列/BullMQ"的数据流或控制流；当天知识链"BullMQ、job 状态、退避、死信、可取消任务"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（例如去掉 jobId 幂等或去掉死信），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **文档摄取仍在 HTTP 请求内执行，20 个 100MB PDF 并发上传使请求超时 60 秒；用户重试后产生 40 个重复任务。** 请用请求耗时、event-loop lag、jobId 和文件 hash 定位；先暂停上传止损，再迁入 BullMQ 并定义幂等 jobId，验证请求快速返回且每文档只处理一次。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[NestJS queues](https://docs.nestjs.com/techniques/queues)

2. **worker 在写入第 3 个 chunk 后崩溃，自动重试从头写入；毒文档重试 100 次占满队列，取消按钮也无效。** 请用 job 状态、attempts、部分产物和队列延迟定位；先移入死信并暂停该类型止损，再拆原子幂等步骤、有限退避和取消检查，故障注入验证可恢复无重复。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)

**知识映射**：BullMQ producer/worker、job 状态、退避、死信、取消和 jobId 幂等。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. **手写一个带并发限制的异步调度器 Scheduler。**
   来源：[《2026高德 Al agent 前端开发》](../../资源/2026高德 Al agent 前端开发.pdf)，第 4 页。

2. **从零设计前端监控系统时，如何用消息队列削峰填谷并规划全链路？**
   来源：[《2026美团前端架构师面试-数据权限方向》](../../资源/2026美团前端架构师面试-数据权限方向.pdf)，第 13 页。

**题目说明**：第一题覆盖任务队列和并发槽位；第二题原文答案使用 Kafka，今天需补充 BullMQ 重试、死信、取消和 jobId 幂等。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **前置依赖**：Day 15-20 LangChain RAG（文档摄取逻辑）、Day 12 Agent Loop（长诊断）、Day 28 Redis（BullMQ 依赖 Redis）
- **直接后继**：Day 30 M3 门禁（可靠性验收：长任务不阻塞请求、失败可重试、毒任务不占满队列）
- **远期对齐**：阶段三 p2-agent-workbench 多 Agent 协同（异步任务编排 + 分布式队列）

**Day 29 是阶段一"AI 前端工程化"的异步化关键日**——掌握 BullMQ 队列 + jobId 幂等 + 死信 + 取消后，Day 30 的 M3 门禁才能通过"可靠性"和"可用性"验收项。
