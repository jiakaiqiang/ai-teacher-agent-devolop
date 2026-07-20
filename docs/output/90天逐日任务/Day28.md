# Day 28：Redis 缓存（v1 直接读写 → v2 Cache-aside + 降级 → v3 限流 + 原子幂等键 + 缓存击穿防护）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-10 周一，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\apps\api`
角色视角：完成 Day 27 Postgres 持久化（Outbox + 乐观锁 + 软删除），第一次要把"频繁查询的指标摘要""模型调用的幂等键"从 DB 搬到 Redis 来加速、同时要保证 Redis 断开时核心读取不挂的开发者

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
   Day 28：Redis 缓存（Cache-aside + TTL + 限流 + 幂等键）  ← 今天在这里
   Day 29-30：M3 门禁 + 全栈端到端

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 28 在阶段一第 8 天**。Day 27 保证了"写库 + 发事件"的一致性，但每次查询指标摘要都要走 Postgres 跨库聚合（慢）；模型调用的幂等键存在进程内存（扩容后重复执行）；热点指标被高频查询（DB 连接池压力大）。今天要把"读多写少"的数据搬到 Redis 来加速，同时必须处理 Redis 断开时的降级、TTL 同时到期导致的缓存雪崩、热点 key 的缓存击穿、以及分布式幂等键的原子性问题。

### 到 Day 27 结束时项目已具备的能力

- **数据建模**（Day 23）：Conversation / Message / Citation / Diagnosis 聚合，复合索引 + 游标分页
- **鉴权**（Day 24）：JWT + RBAC/ABAC + 资源级授权
- **测试**（Day 25）：单元 / 集成 / E2E 三层
- **流式 BFF**（Day 26）：模型流透传、背压、取消上游
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除
- **缺失的一块**：指标摘要每次都聚合查 DB（例如"最近 30 天 CPU 均值"），同一个聚合 1 分钟内被查 100 次，DB 压力大；模型调用的幂等键（`requestId → runId`）存进程内存，扩容到 3 实例后同一 requestId 被 3 个实例各执行一次；Redis 断开时所有缓存读取直接返回 500（核心路径挂）

### 今天要解决的 4 个问题

1. **问题 1：读多写少的数据每次都查 DB（慢 + DB 压力大）**
   "最近 30 天 srv-042 的 CPU 均值"这种聚合查询，计算一次要扫几千行指标记录（Day 13 写入的 `metrics` 表）。1 分钟内 100 个用户刷新同一个 dashboard，就是 100 次相同的聚合查询。DB 连接池吃满，查询变慢。**标准解是 Cache-aside 模式：查询前先看 Redis 有没有，有就直接返回；没有就查 DB 算出来、写进 Redis（带 TTL）、再返回。下次查就命中缓存，DB 压力大幅下降。**

2. **问题 2：热点 key 的 TTL 同时到期 → 缓存雪崩**
   如果所有 dashboard 的缓存 TTL 都设 60 秒，那 60 秒后这些 key 同时过期，下一秒所有请求全部穿透到 DB，瞬间 2000 QPS 打到 Postgres，连接池耗尽，DB 挂掉。**标准解是 TTL jitter：每个 key 的 TTL 加一个随机偏移（例如 60±10 秒），让过期时间分散，避免同时失效。**

3. **问题 3：模型调用幂等键存进程内存 → 扩容后重复执行**
   Day 27 的消费端幂等用的是 DB 表 `consumed_events`，但模型调用的幂等键（前端发 `requestId`，后端要保证"同一 requestId 只调一次模型、返回同一 runId"）如果也存 DB，每次请求都要写一行（浪费）。进程内存 Map 更快，但扩容到 3 实例后，同一 requestId 分别打到 3 个实例，每个实例的 Map 里都没有，就都调了模型——用户看到 3 个重复的诊断。**标准解是把幂等键存 Redis：`SET requestId runId NX EX 300`（原子操作，只有第一个成功，后续的拿到已有 runId 直接返回）。**

4. **问题 4：Redis 断开时所有缓存读取直接 500 → 核心路径挂**
   Redis 挂了或网络抖动，所有 `redis.get()` 都抛异常。如果代码没捕获，直接 500 返回给前端，用户看到"服务不可用"。实际上 Redis 挂了不应该让核心读取也挂——缓存只是加速，不是唯一数据源。**标准解是降级：捕获 Redis 异常后直接查 DB，只是慢一点，但服务不挂。写缓存失败也要降级（只记日志不抛错，让写 DB 继续）。**

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`CacheModule`**：用 Redis 缓存指标摘要（Cache-aside + TTL jitter）、限流模型调用频率（滑动窗口）、保存分布式幂等键（`SET NX`）、降级到 DB（Redis 断开时核心读取不挂）、防缓存击穿（热点 key 的请求合并）。

### 1.1 用户能看到什么

**场景 1：指标摘要缓存（Cache-aside）**

```
时间轴（首次查询）：

14:50:00.000  前端：GET /metrics/summary?serverId=srv-042&metric=cpu&days=30
  → CacheService.get('metrics:srv-042:cpu:30d')  ← Redis 没有（首次）
  → 回退查 DB：聚合最近 30 天的 CPU 记录，算出均值 42.3%
  → CacheService.set('metrics:srv-042:cpu:30d', {avg:42.3}, TTL=60+random(0,10))
  → 返回 {avg:42.3}
  耗时：250ms（DB 聚合慢）

14:50:05.000  另一个用户查同样的摘要
  → CacheService.get('metrics:srv-042:cpu:30d')  ← Redis 命中
  → 直接返回 {avg:42.3}
  耗时：5ms（Redis 快 50 倍）

接下来 1 分钟内 100 个用户刷新 dashboard：
  → 全部命中 Redis，DB 只查了 1 次（第一次）
  → DB 连接池从"100 并发"降到"1 次冷启动"
```

**场景 2：分布式幂等键（原子 SET NX）**

```
时间轴（同一 requestId 被 3 个实例同时收到）：

14:51:00.000  前端发起对话：POST /agent/runs  Body: {requestId: 'r-abc-123'}
  → 负载均衡随机打到 3 个实例：instance-1 / instance-2 / instance-3

instance-1:
  → IdempotencyService.getOrCreate('r-abc-123')
    → redis.set('idempotency:r-abc-123', 'run-001', {NX:true, EX:300})
    → 返回 OK（第一个写入成功）
  → 调用模型、创建 runId='run-001'
  → 返回 {runId:'run-001'}

instance-2（同一时刻）:
  → IdempotencyService.getOrCreate('r-abc-123')
    → redis.set('idempotency:r-abc-123', 'run-002', {NX:true, EX:300})
    → 返回 null（key 已存在，写入失败）
    → redis.get('idempotency:r-abc-123')  ← 拿到 'run-001'
  → 不调用模型，直接返回 {runId:'run-001'}

instance-3（同一时刻）:
  → 同 instance-2，拿到 'run-001' 直接返回

最终：模型只被调用 1 次，3 个实例全部返回 runId='run-001'（幂等）
```

**场景 3：Redis 断开时降级到 DB（不挂）**

```
时间轴（Redis 网络抖动）：

14:52:00.000  Redis 断开（网络故障）
  → 所有 redis.get() 抛 ECONNREFUSED

14:52:00.100  用户查询指标摘要：GET /metrics/summary?...
  → CacheService.get('metrics:...')
    → try { redis.get() } catch (err) { return null }  ← 捕获异常返回 null
  → 认为缓存未命中，回退查 DB
  → 返回正确结果（只是慢了，但没有 500）

14:52:30.000  Redis 恢复
  → 下一次查询重新写缓存，恢复加速
```

**运维观察到的最终结果**：
- 指标摘要查询从平均 200ms 降到 5ms（命中缓存时）
- DB 连接池从峰值 80 降到 10（缓存命中率 95%）
- 同一 requestId 在多实例环境只调用一次模型（幂等）
- Redis 断开时服务降级但不挂（慢但可用）

### 1.2 这个模块在项目里承担什么

- **输入**：频繁查询的指标摘要（`GET /metrics/summary`）；模型调用请求的 requestId；限流目标（例如"每个 userId 每分钟最多调 10 次模型"）
- **输出**：Redis 缓存的快速响应 + DB 降级的可靠性；分布式原子幂等键；滑动窗口限流判定
- **对齐后续**：今天的 **Cache-aside 模式**、**TTL jitter 防雪崩**、**分布式幂等键** 是 Day 29-30 M3 门禁"性能"验收项的核心（要求缓存命中率 >90%、Redis 断开时核心读取可降级）；也是阶段三 p2-agent-workbench 多用户高并发时的性能基座

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 直接读写 Redis（无降级、无 jitter） | 单文件 `cache.service.ts`（`get` / `set`） | Redis 基础命令、为什么"只用 Redis 不降级"有风险 |
| **v1 痛点** | Redis 断开 → 所有读取 500；TTL 固定 → 同时过期雪崩；无限流 → 恶意刷接口；幂等键在内存 → 扩容重复 |  |  |
| **v2** | v1 + **Cache-aside + TTL jitter + 降级** | 拆出 `cache-aside/cache-aside.service.ts` + `degradation/` | Cache-aside 模式、TTL jitter、try-catch 降级、缓存雪崩/穿透/击穿概念 |
| **v2 痛点** | 无限流（恶意用户刷爆模型费用）；幂等键还在内存（多实例重复）；热点 key 击穿（高并发时缓存刚过期瞬间 1000 请求全打 DB） |  |  |
| **v3** | v2 + **滑动窗口限流** + **分布式原子幂等键** + **请求合并防击穿** | 完整分层（cache-aside / rate-limit / idempotency / hotkey-shield） | 滑动窗口 ZSET、Redis `SET NX` 原子性、singleflight 请求合并 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Redis 缓存涉及 5 个独立关注点（Cache-aside 读写模式 / TTL jitter 防雪崩 / 降级策略 / 限流 / 分布式幂等键），如果不先立起骨架，写到一半就会把"TTL 随机偏移"糊进业务 service、把降级 try-catch 散落在各个 controller、把限流判定写成 if-else 散落、把幂等键的 SET NX 当成普通 set 用。看完这棵树，下面章节再出现 `cache/rate-limit/sliding-window.service.ts` 时，你就能立刻定位它属于"限流独立关注点"而不是缓存本身。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── cache/                                      ← 【本日新增】Redis 缓存模块
│   ├── cache-aside/
│   │   ├── cache-aside.service.ts              ← Cache-aside 读写模式封装
│   │   ├── cache-aside.service.spec.ts         ← 单元测试（含降级）
│   │   └── ttl-jitter.ts                       ← TTL 随机偏移纯函数
│   ├── rate-limit/
│   │   ├── sliding-window.service.ts           ← 滑动窗口限流（Redis ZSET）
│   │   ├── sliding-window.service.spec.ts      ← 限流单元测试
│   │   └── rate-limit.guard.ts                 ← NestJS Guard（拦截请求）
│   ├── idempotency/
│   │   ├── redis-idempotency.service.ts        ← 分布式幂等键（SET NX）
│   │   └── redis-idempotency.service.spec.ts   ← 幂等单测
│   ├── hotkey-shield/
│   │   ├── singleflight.ts                     ← 请求合并（防缓存击穿）
│   │   └── singleflight.spec.ts                ← 合并单测
│   ├── degradation/
│   │   ├── fallback.decorator.ts               ← 降级装饰器（捕获 Redis 异常）
│   │   └── fallback.decorator.spec.ts          ← 降级单测
│   ├── redis.client.ts                         ← Redis 客户端封装（ioredis）
│   ├── cache.module.ts                         ← NestJS 模块
│   └── index.ts                                ← 桶文件
├── metrics/                                    ← 【Day 13 已有】需接入缓存
│   └── metrics.service.ts                      ← 改：getSummary 走 Cache-aside
├── agent/                                      ← 【Day 12 已有】需接入限流 + 幂等
│   └── agent.controller.ts                     ← 改：POST /runs 加 RateLimitGuard + 幂等键
└── config/
    └── redis.config.ts                         ← 【新增】Redis 连接配置（env）
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `redis.client.ts` | ✓ 基础连接 | ✓ 同 v1 | ✓ 同 v1 |
| `cache-aside.service.ts` | ✗（直接 get/set） | ✓ Cache-aside + TTL jitter + 降级 | ✓ 同 v2 |
| `ttl-jitter.ts` | ✗ | ✓ 纯函数 | ✓ 同 v2 |
| `degradation/fallback.decorator.ts` | ✗ | ✓ try-catch 装饰器 | ✓ 同 v2 |
| `rate-limit/sliding-window.service.ts` | ✗ | ✗ | ✓ ZSET 滑动窗口 |
| `idempotency/redis-idempotency.service.ts` | ✗（内存 Map） | ✗ | ✓ SET NX 原子幂等 |
| `hotkey-shield/singleflight.ts` | ✗ | ✗ | ✓ 请求合并 |

**依赖方向（务必单向，反过来一次都不行）**：

```
metrics.service.ts / agent.controller.ts
        │
        ▼
cache-aside.service.ts                          ← 编排：先查缓存、未命中查 DB、写缓存
        │
        ├─► redis.client.ts（基础 get/set）
        │
        ├─► ttl-jitter.ts（纯函数，计算随机 TTL）
        │
        ├─► degradation/fallback.decorator.ts（捕获异常返回 null）
        │
        └─► hotkey-shield/singleflight.ts（请求合并）

rate-limit.guard.ts                             ← NestJS Guard，拦截请求
        │
        └─► sliding-window.service.ts ──► redis.client.ts

redis-idempotency.service.ts ──► redis.client.ts（SET NX）

ttl-jitter.ts / singleflight.ts                 ← 纯逻辑，不依赖 Redis 实例
```

**红线**：
- `cache-aside.service.ts` 里"查缓存"和"查 DB"的顺序不能反——先查 DB 再写缓存就不是 Cache-aside 了，是 Cache-through（不同模式）
- TTL 不加 jitter 就是定时炸弹——1000 个 key 同时过期会把 DB 打挂（缓存雪崩）
- Redis 异常不捕获、直接抛给上层就是核心路径单点——Redis 挂了整个服务挂
- 限流用内存计数器是塌方——扩容到 3 实例每个实例各限 10 次 = 实际限 30 次（失效）
- 幂等键用进程内存 Map 是塌方——多实例环境重复执行

**动手前先问自己 3 个问题**：

1. Cache-aside 为什么"先查缓存、未命中查 DB、写缓存"？如果"先写缓存、再查 DB"会怎样？—— 见 §5.4 知识点 1「Cache-aside vs Cache-through」
2. TTL jitter 的随机范围应该设多大？为什么不是 60±1 而是 60±10？—— 见 §5.4 知识点 2「雪崩窗口与 jitter 幅度」
3. 分布式幂等键为什么用 `SET NX` 而不是"先 GET 再 SET"？—— 见 §5.4 知识点 4「check-then-act 竞态」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：装 Redis 客户端依赖（3 分钟）

按第 5.3 节的代码：

- `pnpm --filter api add ioredis`
- `pnpm --filter api add -D @types/ioredis`
- 确认本地 Docker 有 Redis：`docker run -d -p 6379:6379 redis:7-alpine`（如果已有就跳过）
- 测试连接：`redis-cli ping` → 返回 `PONG`

**边写边问自己**：

- 为什么用 `ioredis` 而不是 `redis`（npm 的 `redis` 包）？（`ioredis` 支持 Cluster、Sentinel、更好的 TypeScript 类型、Pipeline 性能更高）
- Redis 7 比 Redis 6 有什么关键新特性？（Redis Functions、ACL v2、多线程 I/O 默认开启——今天用不到，但知道版本演进）

### 1.5.2 D-2：创建目录 + Redis 配置（5 分钟）

按第 5.3 节的目录树，在 `apps/api/src/cache/` 下建 5 个子目录：`cache-aside/` `rate-limit/` `idempotency/` `hotkey-shield/` `degradation/`。

在 `config/redis.config.ts` 里读环境变量：

```typescript
export const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
}
```

在 `.env` 加：

```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
```

**边写边问自己**：

- Redis 为什么有 16 个 DB（`db: 0` 到 `db: 15`）？（单实例逻辑隔离；生产不推荐用多 DB，推荐用 key 前缀区分业务）
- 为什么 password 可选？（本地开发 Redis 不设密码；生产必须设，且走 TLS）

### 1.5.3 D-3：写 redis.client.ts + cache.module.ts（7 分钟）

按第 5.3 节的代码：

- 写 `redis.client.ts`（封装 `ioredis` 实例，挂到 NestJS provider）
- 写 `cache.module.ts`（注册 RedisClient + 其他 service）
- 在 `app.module.ts` 导入 `CacheModule`

**边写边问自己**：

- `RedisClient` 为什么做成单例 provider？（连接池复用；多次 `new Redis()` 会创建多个连接，浪费）
- `onModuleDestroy` 里为什么要 `redis.quit()`？（优雅关闭，等待未完成命令、释放连接）

### 1.5.4 D-4：写 cache-aside 核心（5 分钟）

按第 5.3 节的代码：

- 写 `cache-aside/ttl-jitter.ts`（纯函数，`baseTTL + random(0, jitter)`）
- 写 `cache-aside/cache-aside.service.ts`（`getOrCompute` 方法：先查缓存、未命中回调 compute、写缓存）

**边写边问自己**：

- `getOrCompute` 的 `compute` 回调为什么是 async？（可能要查 DB，异步操作）
- 如果 `compute` 抛错，缓存应该写吗？（不应该——错误结果不能缓存，否则下次查还是错）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"直接 Redis→Cache-aside+降级→限流+幂等+击穿防护"的演进路径 |
| B：读代码 | 20 min | §5.3 逐文件通读，特别是 `cache-aside.service.ts` 和 `sliding-window.service.ts` | 能口述"Cache-aside 的三步顺序"、"滑动窗口 ZSET 怎么删过期" |
| C：读深挖 | 15 min | §6.5 前端底子补弱（`Day28深挖-前端底子补弱.html`） | 能回答"HTTP 强缓存 vs Redis Cache-aside 的异同" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-4 | 骨架文件全部创建，Redis 连接成功 |
| E：写核心测试 | 40 min | §7.2 三个 spec（cache-aside / 限流 / 幂等） | `pnpm --filter api test cache` 全绿 |
| F-1：反证 1 | 20 min | §7.3 断开 Redis，验证降级到 DB | 观察"v1 返回 500、v3 降级慢但可用" |
| F-2：反证 2 | 20 min | §7.4 去掉 TTL jitter，1000 key 同时过期压测 | 观察 DB 连接池瞬间吃满 |
| F-3：验证 + 提交 | 20 min | §7.5 四件套 + commit | commit 含 `Refs: Day28` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（直接读写 Redis，无降级）

### 3.1 v1 要实现什么

最直觉的用法：把"指标摘要"这种慢查询的结果存进 Redis，下次查直接从 Redis 拿。

**目标**：
- `redis.set(key, value, 'EX', 60)` 写缓存（TTL 固定 60 秒）
- `redis.get(key)` 读缓存
- 未命中时查 DB、写缓存、返回

**不做**：
- 不加 TTL jitter（所有 key TTL 都是 60）
- 不做降级（Redis 异常直接抛）
- 不做限流
- 不做分布式幂等键（幂等键还在进程内存）

### 3.2 v1 目录结构

```
apps/api/src/cache/
├── redis.client.ts          ← Redis 连接
├── cache.service.ts         ← 直接 get/set
└── cache.module.ts
```

### 3.3 v1 完整代码

**apps/api/src/cache/redis.client.ts（v1 全文）**

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'
import { redisConfig } from '../config/redis.config'

@Injectable()
export class RedisClient extends Redis implements OnModuleDestroy {
  constructor() {
    super(redisConfig)
  }

  onModuleDestroy(): void {
    this.quit() // 优雅关闭
  }
}
```

**apps/api/src/cache/cache.service.ts（v1 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { RedisClient } from './redis.client'

@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisClient) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key) // 直接调 Redis，异常会抛到上层
  }

  async set(key: string, value: string, ttlSeconds = 60): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds)
  }
}
```

**apps/api/src/metrics/metrics.service.ts（v1 改动）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CacheService } from '../cache/cache.service'

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getSummary(serverId: string, metric: string, days: number): Promise<{ avg: number }> {
    const cacheKey = `metrics:${serverId}:${metric}:${days}d`
    
    // 先查缓存
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return JSON.parse(cached)
    }

    // 未命中，查 DB（慢）
    const rows = await this.prisma.metric.findMany({
      where: {
        serverId,
        name: metric,
        timestamp: { gte: new Date(Date.now() - days * 86400000) },
      },
    })
    const avg = rows.reduce((sum, r) => sum + r.value, 0) / rows.length

    // 写缓存
    const result = { avg }
    await this.cache.set(cacheKey, JSON.stringify(result), 60)

    return result
  }
}
```

### 3.4 v1 暴露的痛点

**痛点 1：Redis 断开 → 所有读取直接 500（核心路径挂）**

`redis.get()` 抛 `ECONNREFUSED`，异常没捕获，直接传到 controller，返回 500。用户看到"服务不可用"，但实际上 DB 是好的，只是 Redis 挂了。**缓存本该是加速，不该是单点。**

**痛点 2：TTL 固定 60 秒 → 缓存雪崩**

所有 dashboard 的缓存同时创建（例如早上 9 点大家一起上班刷新），60 秒后同时过期。9:01 的第一秒，1000 个请求全部未命中，瞬间 1000 次 DB 聚合查询，连接池耗尽，DB 挂。

**痛点 3：无限流 → 恶意刷接口**

用户（或恶意脚本）1 秒内发 1000 次 `POST /agent/runs`，调 1000 次模型，OpenAI 账单爆炸。v1 没有任何限流保护。

**痛点 4：幂等键在内存 → 多实例重复执行**

`requestId → runId` 的映射存在进程的 `Map`，扩容到 3 实例后，同一 requestId 打到不同实例，每个实例的 Map 里都没有，都调了模型——生成 3 个 runId，用户收到 3 条重复诊断。

---

## 4. v2：Cache-aside + TTL jitter + 降级到 DB

### 4.1 v2 要实现什么

用户视角：查询指标摘要时优先从 Redis 拿（快），Redis 挂了自动降级到 DB（慢但不挂）；所有缓存 TTL 加随机偏移，避免同时过期雪崩。

**目标**：
- `CacheAsideService.getOrCompute(key, compute, baseTTL)` 封装 Cache-aside 三步（查缓存 → 未命中调 compute → 写缓存）
- TTL 加 jitter：`baseTTL + random(0, jitter)`，例如 60±10 秒
- 降级装饰器：捕获 Redis 异常返回 null（让调用方认为缓存未命中，回退查 DB）

**依然不做**：
- 限流（留给 v3）
- 分布式幂等键（留给 v3）
- 热点 key 击穿防护（留给 v3）

### 4.2 v2 目录结构

```
apps/api/src/cache/
├── cache-aside/
│   ├── cache-aside.service.ts       ← 新增：三步封装
│   └── ttl-jitter.ts                ← 新增：随机 TTL 纯函数
├── degradation/
│   ├── fallback.decorator.ts        ← 新增：捕获异常装饰器
│   └── fallback.decorator.spec.ts   ← 新增
├── redis.client.ts                  ← v1 已有
└── cache.module.ts                  ← 改：注册新 service
```

### 4.3 v2 完整代码

**apps/api/src/cache/cache-aside/ttl-jitter.ts（v2 全文）**

```typescript
/**
 * 给 TTL 加随机偏移（jitter），防止大量 key 同时过期导致缓存雪崩。
 * @param baseTTL 基础 TTL（秒）
 * @param jitterSeconds 随机范围（秒），例如 10 表示 ±10 秒
 * @returns 最终 TTL = baseTTL + [0, jitterSeconds] 的随机值
 */
export function ttlWithJitter(baseTTL: number, jitterSeconds = 10): number {
  return baseTTL + Math.floor(Math.random() * jitterSeconds)
}
```

**apps/api/src/cache/degradation/fallback.decorator.ts（v2 全文）**

```typescript
/**
 * 降级装饰器：捕获 Redis 异常，返回 null（让调用方认为缓存未命中）。
 * 用法：
 *   @Fallback()
 *   async get(key: string): Promise<string | null> {
 *     return this.redis.get(key) // 如果抛异常，装饰器返回 null
 *   }
 */
export function Fallback() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args)
      } catch (err: any) {
        // Redis 异常只记日志，不抛错（降级）
        console.warn(`[Fallback] ${propertyKey} failed, return null`, err.message)
        return null
      }
    }

    return descriptor
  }
}
```

**apps/api/src/cache/cache-aside/cache-aside.service.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { RedisClient } from '../redis.client'
import { Fallback } from '../degradation/fallback.decorator'
import { ttlWithJitter } from './ttl-jitter'

@Injectable()
export class CacheAsideService {
  constructor(private readonly redis: RedisClient) 

  /**
   * Cache-aside 模式：先查缓存，未命中调 compute 并写缓存。
   * @param key 缓存 key
   * @param compute 计算函数（未命中时调用，通常是查 DB）
   * @param baseTTL 基础 TTL（秒），会自动加 jitter
   * @returns 缓存值或计算结果
   */
  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    baseTTL = 60,
  ): Promise<T> {
    // 第 1 步：查缓存（降级保护：Redis 异常返回 null）
    const cached = await this.getWithFallback(key)
    if (cached) {
      return JSON.parse(cached) as T
    }

    // 第 2 步：未命中，调 compute（通常是查 DB）
    const result = await compute()

    // 第 3 步：写缓存（带 jitter）
    await this.setWithFallback(key, JSON.stringify(result), ttlWithJitter(baseTTL))

    return result
  }

  @Fallback()
  private async getWithFallback(key: string): Promise<string | null> {
    return this.redis.get(key)
  }

  @Fallback()
  private async setWithFallback(key: string, value: string, ttl: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttl)
  }
}
```

**apps/api/src/metrics/metrics.service.ts（v2 改动）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CacheAsideService } from '../cache/cache-aside/cache-aside.service'

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheAside: CacheAsideService,
  ) 

  async getSummary(serverId: string, metric: string, days: number): Promise<{ avg: number }> {
    const cacheKey = `metrics:${serverId}:${metric}:${days}d`

    // Cache-aside 一行搞定：查缓存 → 未命中回调 → 写缓存
    return this.cacheAside.getOrCompute(
      cacheKey,
      async () => {
        // 这是 compute 回调，只有缓存未命中才执行（慢路径）
        const rows = await this.prisma.metric.findMany({
          where: {
            serverId,
            name: metric,
            timestamp: { gte: new Date(Date.now() - days * 86400000) },
          },
        })
        const avg = rows.reduce((sum, r) => sum + r.value, 0) / rows.length
        return { avg }
      },
      60, // baseTTL，实际会变成 60 + random(0,10)
    )
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：无限流 → 恶意刷接口烧钱**

v2 解决了"Redis 挂了核心读取不挂"，但没防"用户疯狂刷模型调用"。1 秒 1000 次 `POST /agent/runs`，调 1000 次 OpenAI，账单爆炸。需要"每个 userId 每分钟最多 10 次"这种限流策略。

**痛点 2：幂等键还在进程内存 → 多实例重复**

Cache-aside 是读缓存，幂等键是写缓存（`requestId → runId` 映射）。v2 还没把幂等键搬到 Redis，多实例环境仍然重复执行。

**痛点 3：热点 key 缓存击穿**

Cache-aside 虽然有 jitter，但对于超高并发的热点 key（例如"首页推荐列表"，1 秒 5000 QPS），缓存刚过期的那一瞬间，5000 个请求同时发现未命中，全部调 compute 查 DB——DB 瞬间 5000 并发查询，连接池爆。这是**缓存击穿**（某个热点 key 失效瞬间的穿透），和**缓存雪崩**（大量 key 同时失效）不一样。标准解是**请求合并（singleflight）**：同一时刻只让第一个请求去查 DB，其他请求等第一个结果出来后共享，避免重复查。

**痛点 4：降级的可观测性差**

`Fallback` 装饰器只打了一行 `console.warn`，生产环境看不到"降级发生了多少次"。需要接监控指标（例如 Prometheus counter）。

---

## 5. v3：滑动窗口限流 + 分布式原子幂等键 + 请求合并防击穿（终态）

### 5.1 v3 要实现什么

用户视角：
1. 每个用户每分钟最多调 10 次模型（滑动窗口限流，防恶意刷）
2. 同一 requestId 在多实例环境只调一次模型、返回同一 runId（分布式原子幂等键）
3. 热点 key 缓存失效瞬间 1000 并发只有 1 个查 DB，其他等结果（请求合并防击穿）
4. 继承 v2 的 Cache-aside + TTL jitter + 降级

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/cache/
├── cache-aside/
│   ├── cache-aside.service.ts       ← v2 已有
│   └── ttl-jitter.ts                ← v2 已有
├── rate-limit/
│   ├── sliding-window.service.ts    ← 新增：ZSET 滑动窗口
│   ├── sliding-window.service.spec.ts ← 新增
│   └── rate-limit.guard.ts          ← 新增：NestJS Guard
├── idempotency/
│   ├── redis-idempotency.service.ts ← 新增：SET NX 原子幂等
│   └── redis-idempotency.service.spec.ts ← 新增
├── hotkey-shield/
│   ├── singleflight.ts              ← 新增：请求合并
│   └── singleflight.spec.ts         ← 新增
├── degradation/                     ← v2 已有
├── redis.client.ts                  ← v2 已有
└── cache.module.ts
```

### 5.3 v3 完整代码

#### 5.3.1 rate-limit 层：sliding-window.service.ts（Redis ZSET）

```typescript
import { Injectable } from '@nestjs/common'
import { RedisClient } from '../redis.client'

@Injectable()
export class SlidingWindowService {
  constructor(private readonly redis: RedisClient) {}

  /**
   * 滑动窗口限流：判断 key 在过去 windowSeconds 内的请求是否超过 maxCount。
   * 原理：用 Redis ZSET，score 是时间戳，member 是请求 ID。
   * @param key 限流 key（例如 "rate-limit:user-123:model-call"）
   * @param windowSeconds 滑动窗口大小（秒）
   * @param maxCount 窗口内最大请求数
   * @returns true = 允许通过，false = 超限拒绝
   */
  async allowRequest(
    key: string,
    windowSeconds: number,
    maxCount: number,
  ): Promise<boolean> {
    const now = Date.now()
    const windowStart = now - windowSeconds * 1000

    // 第 1 步：删除窗口外的旧记录（过期的请求不再计数）
    await this.redis.zremrangebyscore(key, '-inf', windowStart)

    // 第 2 步：统计窗口内的请求数
    const count = await this.redis.zcard(key)

    if (count >= maxCount) {
      return false // 超限
    }

    // 第 3 步：记录本次请求（score=当前时间，member=唯一 ID）
    await this.redis.zadd(key, now, `${now}-${Math.random()}`)
    await this.redis.expire(key, windowSeconds + 10) // 冗余过期时间，防止 key 泄漏

    return true // 允许
  }
}
```

#### 5.3.2 rate-limit 层：rate-limit.guard.ts（NestJS Guard）

```typescript
import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SlidingWindowService } from './sliding-window.service'

/**
 * 限流 Guard：拦截请求，根据 @RateLimit 装饰器参数判断是否超限。
 * 用法：
 *   @RateLimit({ windowSeconds: 60, maxCount: 10, keyPrefix: 'model-call' })
 *   @Post('/runs')
 *   async createRun() { ... }
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly slidingWindow: SlidingWindowService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>('rate-limit', context.getHandler())
    if (!config) return true // 没配置限流就放行

    const req = context.switchToHttp().getRequest()
    const userId = req.user?.id || req.ip // 按 userId 限流，未登录用 IP

    const key = `rate-limit:${userId}:${config.keyPrefix}`
    const allowed = await this.slidingWindow.allowRequest(
      key,
      config.windowSeconds,
      config.maxCount,
    )

    if (!allowed) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
    }

    return true
  }
}

export interface RateLimitConfig {
  windowSeconds: number
  maxCount: number
  keyPrefix: string
}

export const RateLimit = (config: RateLimitConfig) =>
  (target: any, key: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('rate-limit', config, descriptor.value)
    return descriptor
  }
```

#### 5.3.3 idempotency 层：redis-idempotency.service.ts（SET NX 原子性）

```typescript
import { Injectable } from '@nestjs/common'
import { RedisClient } from '../redis.client'

@Injectable()
export class RedisIdempotencyService {
  constructor(private readonly redis: RedisClient) {}

  /**
   * 分布式幂等键：原子地"如果不存在就写入、返回新值；存在就返回已有值"。
   * 关键：用 Redis SET NX（只在不存在时写入）保证原子性。
   * @param requestId 请求 ID（前端生成的唯一 ID）
   * @param generateValue 生成新值的回调（例如调模型、生成 runId）
   * @param ttlSeconds 幂等键过期时间（秒）
   * @returns 幂等值（第一个请求生成的值，后续请求全部返回这个）
   */
  async getOrCreate(
    requestId: string,
    generateValue: () => Promise<string>,
    ttlSeconds = 300,
  ): Promise<string> {
    const key = `idempotency:${requestId}`

    // 第 1 步：尝试原子写入（SET NX）
    const newValue = await generateValue()
    const ok = await this.redis.set(key, newValue, 'NX', 'EX', ttlSeconds)

    if (ok === 'OK') {
      // 第一个请求，写入成功
      return newValue
    }

    // 第 2 步：写入失败 = key 已存在（别的实例先写了），读取已有值
    const existing = await this.redis.get(key)
    return existing || newValue // 兜底：万一 key 刚好过期，返回新值
  }
}
```

#### 5.3.4 hotkey-shield 层：singleflight.ts（请求合并）

```typescript
/**
 * 请求合并（Singleflight）：同一时刻多个请求查同一个 key，
 * 只让第一个请求真正执行 fn（例如查 DB），其他请求等第一个结果、共享返回值。
 * 防止缓存击穿：热点 key 失效瞬间 1000 并发只查 DB 一次。
 */
export class Singleflight {
  private readonly inflight = new Map<string, Promise<any>>()

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 如果已有请求在飞（inflight），直接等它的结果
    const existing = this.inflight.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    // 第一个请求：执行 fn、记录 promise
    const promise = fn().finally(() => {
      this.inflight.delete(key) // 执行完删除，后续请求可以重新发起
    })

    this.inflight.set(key, promise)
    return promise
  }
}
```

#### 5.3.5 cache-aside 层：接入 singleflight（防击穿）

```typescript
import { Injectable } from '@nestjs/common'
import { RedisClient } from '../redis.client'
import { Fallback } from '../degradation/fallback.decorator'
import { ttlWithJitter } from './ttl-jitter'
import { Singleflight } from '../hotkey-shield/singleflight'

@Injectable()
export class CacheAsideService {
  private readonly singleflight = new Singleflight()

  constructor(private readonly redis: RedisClient) {}

  /**
   * Cache-aside + 请求合并：热点 key 失效瞬间多个请求只查 DB 一次。
   */
  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    baseTTL = 60,
  ): Promise<T> {
    const cached = await this.getWithFallback(key)
    if (cached) {
      return JSON.parse(cached) as T
    }

    // 未命中，用 singleflight 包裹 compute（防击穿）
    const result = await this.singleflight.do(key, async () => {
      const value = await compute()
      await this.setWithFallback(key, JSON.stringify(value), ttlWithJitter(baseTTL))
      return value
    })

    return result
  }

  @Fallback()
  private async getWithFallback(key: string): Promise<string | null> {
    return this.redis.get(key)
  }

  @Fallback()
  private async setWithFallback(key: string, value: string, ttl: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttl)
  }
}
```

#### 5.3.6 agent.controller.ts：接入限流 + 幂等键

```typescript
import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { RateLimitGuard, RateLimit } from '../cache/rate-limit/rate-limit.guard'
import { RedisIdempotencyService } from '../cache/idempotency/redis-idempotency.service'
import { AgentService } from './agent.service'

@Controller('agent')
@UseGuards(RateLimitGuard)
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly idempotency: RedisIdempotencyService,
  ) {}

  @Post('/runs')
  @RateLimit({ windowSeconds: 60, maxCount: 10, keyPrefix: 'model-call' })
  async createRun(@Body() body: { requestId: string; prompt: string }) {
    // 幂等键：同一 requestId 只调一次模型
    const runId = await this.idempotency.getOrCreate(
      body.requestId,
      async () => {
        // 这是 generateValue 回调，只有第一个请求执行（调模型）
        const run = await this.agent.createRun(body.prompt)
        return run.id
      },
      300,
    )

    return { runId }
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：Cache-aside 模式 vs Cache-through**
- 解决的问题：读多写少的数据频繁查 DB（慢 + DB 压力大）
- 运行机制：Cache-aside = 应用负责"查缓存 → 未命中查 DB → 写缓存"三步；Cache-through = 缓存层自己负责（应用只调缓存，缓存内部决定是否查 DB）
- 项目落点：`getOrCompute` 封装三步，业务代码一行调用
- 生产误区：把"写缓存"放在 compute 回调里（compute 失败缓存也写了，脏数据）；忘记设 TTL（key 永不过期，内存泄漏）
- 验证方法：第一次查耗时 200ms（DB），第二次查耗时 5ms（缓存）；`redis-cli KEYS metrics:*` 能看到缓存 key

**知识点 2：TTL jitter 防雪崩**
- 解决的问题：大量 key 同时过期 → 瞬间穿透 DB（缓存雪崩）
- 运行机制：每个 key 的 TTL 加随机偏移，让过期时间分散。例如 60±10 秒，1000 个 key 的过期分散在 10 秒窗口内
- 项目落点：`ttlWithJitter(60, 10)` 返回 60~70 之间随机值
- 生产误区：jitter 幅度太小（60±1 无效）；jitter 幅度太大（60±60 = 0~120，缓存时间不稳定）
- 验证方法：创建 1000 个 key，`redis-cli TTL` 检查过期时间分散度；压测 1001 秒后观察 DB QPS 是否平滑

**知识点 3：滑动窗口限流（Redis ZSET）**
- 解决的问题：固定窗口限流有"窗口边界突刺"（例如 00:59 秒 100 次 + 01:01 秒 100 次，2 秒内 200 次但没被限）
- 运行机制：ZSET 的 score 是时间戳，member 是请求 ID。每次请求先删窗口外的旧记录、统计窗口内计数、加入本次请求
- 项目落点：`slidingWindow.allowRequest(key, 60, 10)` 判断过去 60 秒内是否超过 10 次
- 生产误区：忘记 `zremrangebyscore` 清理旧记录（ZSET 无限增长）；窗口 key 忘记设过期（内存泄漏）
- 验证方法：1 秒内发 11 次请求，第 11 次返回 429；等 61 秒后再发，应该允许

**知识点 4：分布式幂等键（Redis SET NX）**
- 解决的问题：进程内存幂等键在多实例环境失效（每个实例各执行一次，重复副作用）
- 运行机制：`SET key value NX EX ttl` 是原子操作：只在 key 不存在时写入、返回 OK；存在时写入失败、返回 null。第一个实例写入成功，后续实例写入失败、读取已有值
- 项目落点：`idempotency.getOrCreate(requestId, generateValue)` 保证同一 requestId 只调一次 generateValue
- 生产误区：用"先 GET 后 SET"（中间有竞态窗口，两个实例都判断不存在、都 SET）；generateValue 里调外部 API 但没超时保护（幂等键永久占位）
- 验证方法：3 个实例同时收到同一 requestId，只有 1 个调模型、3 个全部返回同一 runId

**知识点 5：缓存击穿与请求合并（Singleflight）**
- 解决的问题：热点 key 失效瞬间 1000 并发全部查 DB（缓存击穿，和雪崩不同——雪崩是大量 key，击穿是单个热点 key）
- 运行机制：同一时刻多个请求查同一 key，只让第一个请求真正执行 compute（查 DB），其他请求等第一个结果、共享返回值
- 项目落点：`singleflight.do(key, compute)` 包裹 compute 回调
- 生产误区：用互斥锁（mutex）防击穿但锁粒度太粗（锁住整个缓存读，其他 key 也被阻塞）；singleflight 的 inflight Map 不清理（内存泄漏）
- 验证方法：删除热点 key、瞬间发 1000 并发请求，DB 只查 1 次（用 DB 慢查询日志验证）

**知识点 6：降级策略（Fallback）**
- 解决的问题：Redis 断开时缓存读写全部 500（核心路径单点）
- 运行机制：捕获 Redis 异常返回 null（认为缓存未命中），让调用方回退查 DB；写缓存失败只记日志不抛错
- 项目落点：`@Fallback()` 装饰器包裹 `redis.get` / `redis.set`
- 生产误区：降级后不打监控指标（不知道降级发生了多少次）；降级逻辑里又调 Redis（循环依赖）
- 验证方法：`docker stop redis`，查询接口仍返回 200（只是慢了）；`docker start redis` 后恢复快速响应

### 5.5 边写边问自己

- 滑动窗口为什么用 ZSET 而不是简单计数器？（ZSET 能精确记录每个请求的时间戳，删过期记录；计数器做不到"窗口外的不计数"）
- `SET NX` 为什么是原子的？如果用"先 GET 判断、再 SET"会怎样？（GET 和 SET 之间有竞态窗口，两个实例都判断不存在、都 SET 成功，幂等失效）
- Singleflight 为什么在 compute 执行完后要 `inflight.delete(key)`？如果不删会怎样？（不删的话第一个请求结束后，key 永久占位，后续请求全部等已完成的 promise——拿到的是旧结果）
- 降级装饰器为什么返回 null 而不是抛一个"降级异常"？（返回 null 让调用方认为缓存未命中、自然回退查 DB；抛异常还要上层再 catch，多一层嵌套）

---

## 6. 三版对比一览表

| 对比维度 | v1：直接读写 | v2：Cache-aside + 降级 | v3：限流 + 幂等 + 击穿防护（终态） |
|---|---|---|---|
| **缓存读写** | `redis.get` / `redis.set` 直接调 | `getOrCompute` 封装三步 | 同 v2 + singleflight 防击穿 |
| **TTL 策略** | 固定 60 秒 | 60 + random(0,10) jitter | 同 v2 |
| **降级保护** | ✗ Redis 异常直接 500 | ✓ `@Fallback()` 捕获返回 null | 同 v2 |
| **限流** | ✗ 无限流 | ✗ 无限流 | ✓ 滑动窗口 ZSET |
| **幂等键** | ✗ 进程内存 Map | ✗ 进程内存 Map | ✓ Redis `SET NX` 分布式 |
| **缓存击穿防护** | ✗ 热点 key 失效瞬间全穿透 | ✗ 热点 key 失效瞬间全穿透 | ✓ singleflight 请求合并 |
| **雪崩风险** | 高（同时过期） | 低（jitter 分散） | 低（同 v2） |
| **多实例幂等** | ✗ 重复执行 | ✗ 重复执行 | ✓ 原子幂等键 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

**为什么要补弱 HTTP 缓存**：今天学的是"后端 Redis 缓存"（服务端缓存），但前端开发必须同时掌握"浏览器 HTTP 缓存"（客户端缓存）。面试官问"缓存机制"时，如果只会 Redis 不会 HTTP 缓存，会暴露前端底子薄弱。

**深挖入口**：

打开并完整阅读 `output/90天逐日任务/Day28深挖-前端底子补弱.html`（该文件今天要创建），内容覆盖：

1. **强缓存 vs 协商缓存**
   - `Cache-Control: max-age=3600` vs `ETag` / `Last-Modified`
   - 强缓存命中时不发请求（0 网络开销）；协商缓存命中时发请求但返回 304（小开销）
   - 为什么静态资源用强缓存 + 文件名哈希（`main.abc123.js`）？（强缓存 1 年 + 文件名变化时自动失效）

2. **HTTP 缓存 vs Redis 缓存的异同**
   - 相同：都是"空间换时间"，都有 TTL
   - 不同：HTTP 缓存在浏览器（客户端）；Redis 缓存在服务端
   - 为什么"用户刷新页面看到旧数据"可能是 HTTP 缓存问题而不是 Redis？（强缓存命中时浏览器根本不发请求，后端 Redis 更新了也看不到）

3. **Cache-Control 指令**
   - `no-cache`（允许缓存但每次都协商）vs `no-store`（完全不缓存）
   - `private`（只能浏览器缓存）vs `public`（CDN 也能缓存）
   - 为什么用户个人数据要 `private`？（防止 CDN 缓存后泄漏给其他用户）

4. **实战案例**
   - 场景：前端发 `GET /metrics/summary`，Redis 缓存已更新但浏览器还显示旧数据
   - 定位：检查响应头 `Cache-Control`，如果是 `max-age=3600`，浏览器会缓存 1 小时
   - 修复：动态 API 响应设 `Cache-Control: no-cache`（允许协商）或 `no-store`（完全不缓存）

**验收问题**：

- 请对比"浏览器强缓存"和"Redis Cache-aside"：哪个更快？哪个能跨用户共享？哪个适合动态 API？
- 为什么静态资源（JS/CSS）用 `Cache-Control: max-age=31536000`（1 年）+ 文件名哈希，而不是 `no-cache`？
- 场景：用户反馈"修改了个人资料但页面还显示旧数据"，你会先排查 Redis 还是 HTTP 缓存？为什么？

---

## 7. 项目验收清单（阶段 E-F，约 120 分钟）

### 7.1 四件套（前置，5 分钟）

```bash
cd apps/api
pnpm typecheck   # 类型检查
pnpm lint        # ESLint
pnpm test        # 单元测试（含 cache-aside / 限流 / 幂等 / singleflight）
pnpm test:e2e    # E2E 测试（可选）
```

全部通过再继续。

### 7.2 核心测试（40 分钟）

#### 7.2.1 Cache-aside + 降级（cache-aside.service.spec.ts）

```typescript
import { describe, it, expect, vi } from 'vitest'
import { CacheAsideService } from './cache-aside.service'
import { RedisClient } from '../redis.client'

describe('CacheAsideService', () => {
  it('缓存命中时不调 compute', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue('{"result":42}'),
      set: vi.fn(),
    } as any
    const service = new CacheAsideService(redis)

    const compute = vi.fn().mockResolvedValue({ result: 99 })
    const result = await service.getOrCompute('key1', compute)

    expect(result).toEqual({ result: 42 })
    expect(compute).not.toHaveBeenCalled() // 命中缓存，不调 compute
  })

  it('缓存未命中时调 compute 并写缓存', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null), // 未命中
      set: vi.fn().mockResolvedValue('OK'),
    } as any
    const service = new CacheAsideService(redis)

    const compute = vi.fn().mockResolvedValue({ result: 99 })
    const result = await service.getOrCompute('key1', compute, 60)

    expect(result).toEqual({ result: 99 })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(redis.set).toHaveBeenCalledWith(
      'key1',
      '{"result":99}',
      'EX',
      expect.any(Number), // TTL 带 jitter
    )
  })

  it('Redis 异常时降级到 compute（不抛错）', async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as any
    const service = new CacheAsideService(redis)

    const compute = vi.fn().mockResolvedValue({ result: 99 })
    const result = await service.getOrCompute('key1', compute)

    expect(result).toEqual({ result: 99 }) // 降级成功
    expect(compute).toHaveBeenCalledTimes(1)
  })
})
```

#### 7.2.2 滑动窗口限流（sliding-window.service.spec.ts）

```typescript
import { describe, it, expect } from 'vitest'
import { SlidingWindowService } from './sliding-window.service'
import { RedisClient } from '../redis.client'

describe('SlidingWindowService', () => {
  it('窗口内未超限时允许', async () => {
    const redis = new RedisClient() // 真实 Redis
    const service = new SlidingWindowService(redis)

    const key = `test:${Date.now()}`
    for (let i = 0; i < 10; i++) {
      const allowed = await service.allowRequest(key, 60, 10)
      expect(allowed).toBe(true)
    }

    await redis.del(key)
  })

  it('窗口内超限时拒绝', async () => {
    const redis = new RedisClient()
    const service = new SlidingWindowService(redis)

    const key = `test:${Date.now()}`
    for (let i = 0; i < 10; i++) {
      await service.allowRequest(key, 60, 10)
    }

    const allowed = await service.allowRequest(key, 60, 10)
    expect(allowed).toBe(false) // 第 11 次超限

    await redis.del(key)
  })
})
```

#### 7.2.3 分布式幂等键（redis-idempotency.service.spec.ts）

```typescript
import { describe, it, expect, vi } from 'vitest'
import { RedisIdempotencyService } from './redis-idempotency.service'
import { RedisClient } from '../redis.client'

describe('RedisIdempotencyService', () => {
  it('第一个请求调 generateValue', async () => {
    const redis = new RedisClient()
    const service = new RedisIdempotencyService(redis)

    const requestId = `req-${Date.now()}`
    const generate = vi.fn().mockResolvedValue('run-001')

    const result = await service.getOrCreate(requestId, generate)

    expect(result).toBe('run-001')
    expect(generate).toHaveBeenCalledTimes(1)

    await redis.del(`idempotency:${requestId}`)
  })

  it('第二个请求不调 generateValue', async () => {
    const redis = new RedisClient()
    const service = new RedisIdempotencyService(redis)

    const requestId = `req-${Date.now()}`
    const generate1 = vi.fn().mockResolvedValue('run-001')
    const generate2 = vi.fn().mockResolvedValue('run-002')

    const result1 = await service.getOrCreate(requestId, generate1)
    const result2 = await service.getOrCreate(requestId, generate2)

    expect(result1).toBe('run-001')
    expect(result2).toBe('run-001') // 第二个请求拿到第一个的值
    expect(generate1).toHaveBeenCalledTimes(1)
    expect(generate2).not.toHaveBeenCalled() // 第二个不调

    await redis.del(`idempotency:${requestId}`)
  })
})
```

### 7.3 反证实验 1：断开 Redis，验证降级（20 分钟）

**目标**：证明 v1"Redis 挂了核心路径挂"，v3"Redis 挂了降级到 DB（慢但可用）"。

**步骤**：

1. 启动 API 服务：`pnpm --filter api dev`
2. 查询指标摘要：`curl http://localhost:3000/metrics/summary?serverId=srv-042&metric=cpu&days=30`
   - 第一次：200ms（DB 聚合 + 写缓存）
   - 第二次：5ms（缓存命中）
3. **断开 Redis**：`docker stop redis` 或 `docker pause redis`
4. v1 行为：再次查询 → 返回 500 `ECONNREFUSED`（核心路径挂）
5. v3 行为：再次查询 → 返回 200（200ms，降级到 DB，慢但可用）
6. 恢复 Redis：`docker start redis` 或 `docker unpause redis`
7. 再次查询 → 5ms（缓存恢复）

**证据**：截图 v1 的 500 响应 + v3 的降级日志 `[Fallback] getWithFallback failed, return null`。

### 7.4 反证实验 2：去掉 TTL jitter，观察雪崩（20 分钟）

**目标**：证明"固定 TTL 会导致同时过期雪崩"。

**步骤**：

1. 修改 `cache-aside.service.ts`：把 `ttlWithJitter(baseTTL)` 改成 `baseTTL`（去掉 jitter）
2. 创建 1000 个缓存 key：

```bash
for i in {1..1000}; do
  curl "http://localhost:3000/metrics/summary?serverId=srv-$i&metric=cpu&days=30"
done
```

3. 等待 60 秒（TTL 到期）
4. 在第 61 秒瞬间发 1000 个请求（用 `ab` 或 `wrk`）：

```bash
ab -n 1000 -c 100 "http://localhost:3000/metrics/summary?serverId=srv-042&metric=cpu&days=30"
```

5. 观察 Postgres 连接池：`SELECT count(*) FROM pg_stat_activity WHERE state = 'active'`
   - v1（无 jitter）：瞬间 100+ 连接（雪崩）
   - v3（有 jitter）：峰值 10-20 连接（分散）

**证据**：截图 DB 连接池峰值。

### 7.5 反证实验 3：singleflight 防击穿（可选，15 分钟）

**目标**：证明"热点 key 失效瞬间 singleflight 只查 DB 一次"。

**步骤**：

1. 删除热点 key：`redis-cli DEL metrics:srv-042:cpu:30d`
2. 开启 DB 慢查询日志（Postgres）：

```sql
ALTER SYSTEM SET log_min_duration_statement = 0;
SELECT pg_reload_conf();
```

3. 瞬间发 1000 并发：

```bash
ab -n 1000 -c 1000 "http://localhost:3000/metrics/summary?serverId=srv-042&metric=cpu&days=30"
```

4. 查看 Postgres 慢查询日志：`tail -f /var/log/postgresql/postgresql.log | grep "SELECT.*metric"`
   - v2（无 singleflight）：1000 条相同 SELECT
   - v3（有 singleflight）：1 条 SELECT

**证据**：慢查询日志行数。

### 7.6 四件套 + commit（20 分钟）

```bash
pnpm typecheck && pnpm lint && pnpm test
git add .
git commit -m "feat(cache): Redis Cache-aside + 限流 + 幂等 + 降级

- Cache-aside 模式 + TTL jitter 防雪崩
- 滑动窗口限流（Redis ZSET）
- 分布式原子幂等键（SET NX）
- Singleflight 防缓存击穿
- Fallback 降级保护（Redis 断开时不挂）

Refs: Day28"
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day 29 结束时集中 push。

---

## 8. 通过标准

- [ ] 指标摘要查询缓存命中率 >90%（用 `redis-cli INFO stats` 看 `keyspace_hits` / `keyspace_misses`）
- [ ] Redis 断开时核心读取降级到 DB（慢但返回 200，不是 500）
- [ ] 滑动窗口限流：1 分钟内第 11 次请求返回 429
- [ ] 分布式幂等键：同一 requestId 在 3 实例环境只调一次模型
- [ ] 四件套全绿，commit 含 `Refs: Day28`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day28`，未执行 `git push`）
2. 测试输出截图（cache-aside / 限流 / 幂等三个 spec 全绿）
3. 反证实验证据（Redis 断开降级日志 + TTL jitter 前后 DB 连接池对比）
4. 学习日志（250 字）
5. 架构证据（可选）：缓存命中率监控 dashboard

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"Redis 缓存"的数据流或控制流；当天知识链"Cache-aside、TTL jitter、限流、幂等、降级"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（例如去掉 TTL jitter 或去掉降级），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **热点指标缓存 TTL 同时到期，2,000 QPS 穿透到 Postgres，连接池耗尽；Redis 本身仍显示健康。** 请用命中率、key TTL 分布、DB QPS 和连接池定位雪崩；先限流并返回陈旧值止损，再加 TTL jitter、请求合并和降级，压测验证 DB 峰值受控。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[Redis caching architecture](https://redis.io/learn/howtos/solutions/caching-architecture/)

2. **模型调用幂等键只保存在进程内，扩容到 4 实例后同一请求执行 4 次；Redis 断开时所有读取又直接 500。** 请用 requestId、实例日志和 Redis 命令定位；先关闭自动重试止损，再实现原子幂等键与 cache-aside 降级，重复请求/断 Redis 测试验证单副作用且核心读取可用。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[AgentOps 岗位](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

**知识映射**：Cache-aside、TTL jitter、限流、幂等、降级和 Redis 失效降级。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. **Redis 在项目中主要起什么作用？如何处理缓存穿透、击穿和雪崩？**
   来源：[《2026美团前端全栈开发》](../../资源/2026美团前端全栈开发.pdf)，第 9 页。

2. **HTTP 缓存机制如何工作？强缓存与协商缓存有什么区别？**
   来源：[《2026美团前端全栈开发》](../../资源/2026美团前端全栈开发.pdf)，第 2 页。

**题目说明**：对应 Cache-aside、TTL jitter、热点 key、降级；Redis 题正文跨至第 10 页，但题干始于第 9 页。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **前置依赖**：Day 13 指标写入、Day 23 数据建模、Day 27 Outbox + 乐观锁
- **直接后继**：Day 29 M3 门禁（性能验收：缓存命中率 >90%、Redis 断开降级）
- **远期对齐**：阶段三 p2-agent-workbench 多用户高并发（限流 + 分布式幂等键是多租户基座）

**Day 28 是阶段一"AI 前端工程化"的性能优化关键日**——掌握 Redis Cache-aside + 限流 + 幂等 + 降级后，Day 29-30 的 M3 门禁才能通过"性能"和"可用性"验收项。
