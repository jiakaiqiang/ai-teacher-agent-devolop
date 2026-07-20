# Day 27：Postgres 持久化（v1 业务写与事件发布分离 → v2 Outbox 同事务 → v3 乐观锁 + 软删除 + 崩溃恢复）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-09 周日，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor\apps\api`
角色视角：完成 Day 23 数据建模、Day 25 后端测试、Day 26 流式 BFF，第一次要保证"UI 已展示的内容一定进了库、库里的写一定发出了事件"的开发者

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
   Day 27：Postgres 持久化（ACID + Outbox + 乐观锁 + 软删除）  ← 今天在这里
   Day 28-30：M3 门禁 + 全栈端到端

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 27 在阶段一第 7 天**。Day 23 建了 Conversation/Message/Citation/Diagnosis 的表结构、Day 26 让模型流能透传到前端。今天要解决一个更隐蔽但更致命的问题：**前端已经把模型回答渲染出来了，但这条 Message 到底进库没有？进库了又有没有触发"生成诊断""更新告警状态"这些下游事件？** 这就是分布式系统里最经典的 **双写一致性（dual-write）** 问题。

### 到 Day 26 结束时项目已具备的能力

- **数据模型**（Day 23）：Conversation / Message / Citation / Diagnosis 聚合，复合索引 + 游标分页 + 可回滚迁移
- **鉴权**（Day 24）：JWT + RBAC/ABAC + 资源级授权 + actor 审计
- **测试**（Day 25）：单元 / 集成（隔离 schema）/ E2E 三层 + mutation 验证
- **流式 BFF**（Day 26）：模型流透传、背压、取消上游、requestId 结构化日志
- **缺失的一块**：Day 26 的 BFF 把模型回答流式吐给前端，前端渲染出来了——但"写 Message 到库"和"发布 `message.created` 事件让下游生成诊断"是两个独立的动作，中间没有事务保护。库写成功、事件发布失败，就出现"UI 显示了回答，但永远不生成诊断"的幽灵状态；两个并发请求改同一 Diagnosis，后写的静默覆盖先写的（丢失更新）；删掉的会话还能被普通查询翻出来（软删除泄漏）

### 今天要解决的 4 个问题

1. **问题 1：双写裂缝——已展示但未发布**
   BFF 收到模型完整回答后要做两件事：`INSERT INTO messages`（业务写）+ 通知下游"有新消息了，去生成诊断"（事件发布）。如果这两件事不在同一个事务里：库写成功后进程崩溃 / 消息队列超时，事件就永远发不出去。前端已经把回答渲染了（Day 26 流式吐字），但下游诊断永远不触发。用户看到"回答完成"，却永远等不到诊断结论。**这就是 dual-write 问题，标准解是 Outbox 模式：把"要发的事件"和"业务数据"写进同一个事务的同一个库，再由独立的 relay 进程把 Outbox 里的事件搬到消息总线。**

2. **问题 2：丢失更新（Lost Update）**
   两个运维同时打开同一条 Diagnosis 编辑（比如补充处理备注）。A 基于 version=3 改，B 也基于 version=3 改。A 先提交（version→4），B 后提交时如果直接 `UPDATE ... WHERE id=x`，会把 A 的修改**静默覆盖**，version 也乱了。A 的备注凭空消失，没有任何报错。**标准解是乐观锁：`UPDATE ... WHERE id=x AND version=3`，影响行数=0 就说明有人先改了，抛冲突让 B 重试。**

3. **问题 3：软删除泄漏**
   用户删除一个会话，业务上要求"删除后不可见，但保留 30 天可恢复 + 审计留痕"。如果用物理删除（`DELETE`），数据没了无法恢复、审计断链。如果用软删除（`deletedAt` 时间戳标记）但忘了在查询里加 `WHERE deletedAt IS NULL`，删掉的会话照样被列表查询、被诊断引用翻出来。**标准解是软删除 + 默认查询 scope（Prisma 中间件自动注入 `deletedAt: null` 过滤）。**

4. **问题 4：重复消费产生重复副作用**
   Outbox relay 把事件搬到消息总线时，为了不丢事件必须"至少投递一次"（at-least-once）。这意味着同一个 `message.created` 事件可能被下游消费两次。如果下游"生成诊断"没有幂等保护，就会生成两条诊断。**标准解是消费端幂等：用事件的唯一 ID 做去重键，`INSERT ... ON CONFLICT DO NOTHING`。**

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`PersistenceOutboxModule`**：把"写 Message/Diagnosis"和"发布下游事件"绑进同一个 Postgres 事务（Outbox 模式），由独立 relay 进程可靠地把 Outbox 事件搬到内存事件总线；给 Diagnosis 加乐观锁（version 字段 + CAS 更新）防丢失更新；给 Conversation/Message 加软删除 + Prisma 中间件默认 scope；消费端用事件 ID 幂等去重。

### 1.1 用户能看到什么

**场景**：运维工程师在诊断会话里发一条消息"帮我分析 srv-042 的 CPU"，BFF 收到模型回答后要落库并触发下游诊断生成。

```
时间轴（正常路径）：

14:40:00.000  BFF 收齐模型回答，调用 persistenceService.saveMessageWithOutbox()
  → BEGIN TRANSACTION
  →   INSERT INTO messages (id=m-01, conversationId=c-01, role='assistant', content='...')
  →   INSERT INTO outbox (id=o-01, eventType='message.created', payload={messageId:'m-01'}, status='pending')
  → COMMIT
  → 返回 200，前端确认"已保存"

14:40:00.050  OutboxRelay（每 200ms 轮询一次）扫到 o-01 status='pending'
  → 发布到事件总线：emit('message.created', {messageId:'m-01'})
  → UPDATE outbox SET status='published', publishedAt=now() WHERE id='o-01'

14:40:00.100  DiagnosisConsumer 收到 message.created
  → 幂等检查：SELECT 1 FROM processed_events WHERE eventId='o-01'  → 空
  → 生成诊断 + INSERT INTO processed_events (eventId='o-01')  （同事务）
  → Diagnosis d-01 创建成功

如果 14:40:00.020 COMMIT 后进程崩溃（事件还没发）：
  → 重启后 OutboxRelay 扫到 o-01 仍是 'pending'
  → 重新发布，下游正常收到（没有"已展示未发布"）

如果 message.created 被投递两次（relay 重试）：
  → DiagnosisConsumer 第二次收到，幂等检查命中 processed_events
  → 跳过，不生成第二条诊断（无重复副作用）
```

**运维观察到的最终结果**：
- 前端显示"回答已保存"时，库里一定有这条 Message，且一定会触发下游诊断（不会有"已展示未发布"）
- 两个人同时改一条 Diagnosis，后提交的会收到 409 冲突提示"内容已被他人修改，请刷新"，而不是静默覆盖
- 删除的会话从列表、搜索、诊断引用里全部消失，但 30 天内可在"回收站"恢复
- 同一事件即使被投递多次，诊断也只生成一条

### 1.2 这个模块在项目里承担什么

- **输入**：Day 26 BFF 收齐的模型回答（Message 内容）；运维对 Diagnosis 的编辑请求；用户的删除会话请求
- **输出**：Message/Diagnosis 落库 + Outbox 事件可靠发布；乐观锁保护的更新；软删除 + 默认 scope 过滤；幂等消费
- **对齐后续**：今天的 **Outbox 模式**、**乐观锁 version 合同**、**软删除 scope** 是 Day 28-30 M3 门禁"数据一致性"验收项的核心，也是阶段三 p2-agent-workbench 多 Agent 并发写共享状态的地基

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 业务写成功后单独发事件（两步分离） | `persistence.service.ts` 先 create 再 emit | 事务基础、ACID、为什么"先写后发"有裂缝 |
| **v1 痛点** | COMMIT 后崩溃 → 事件丢失（已展示未发布）；并发更新静默覆盖；删除数据物理消失 |  |  |
| **v2** | v1 + **Outbox 同事务写** + **relay 轮询发布** | 拆出 `outbox/outbox.repository.ts` + `outbox-relay.service.ts` | Outbox 模式、事务边界、at-least-once、轮询 relay |
| **v2 痛点** | 事件可能被投递两次（重复诊断）；Diagnosis 并发更新仍丢失；软删除还没做 |  |  |
| **v3** | v2 + **乐观锁 CAS** + **软删除 + Prisma 中间件 scope** + **消费端幂等** + **崩溃恢复** | 完整分层（outbox/optimistic-lock/soft-delete/idempotency） | 乐观锁 version、隔离级别、Prisma $extends 中间件、processed_events 幂等表 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Postgres 持久化涉及 4 个独立关注点（Outbox 事务写 / relay 发布 / 乐观锁 / 软删除 scope），如果不先立起骨架，写到一半就会把"发事件"糊进 service、把 relay 写成 controller 里的 setInterval、把乐观锁的 version 检查散落在各个 update 方法里、把软删除过滤忘在某个查询。看完这棵树，下面章节再出现 `persistence/outbox/outbox-relay.service.ts` 时，你就能立刻定位它是"独立轮询进程"而不是业务编排。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── persistence/                                ← 【本日新增/扩展】持久化一致性模块
│   ├── outbox/
│   │   ├── outbox.repository.ts                ← Outbox 表读写（同事务写入 / relay 拉取）
│   │   ├── outbox-relay.service.ts             ← 独立轮询进程（pending → 发布 → published）
│   │   ├── outbox-event.types.ts               ← Outbox 事件类型（纯类型）
│   │   └── outbox-relay.service.spec.ts        ← relay 单元测试（含崩溃恢复）
│   ├── optimistic-lock/
│   │   ├── optimistic-lock.ts                  ← CAS 更新封装（纯逻辑 + 冲突错误）
│   │   └── optimistic-lock.spec.ts             ← 乐观锁单元测试
│   ├── soft-delete/
│   │   ├── soft-delete.middleware.ts           ← Prisma $extends 中间件（默认注入 deletedAt:null）
│   │   └── soft-delete.middleware.spec.ts      ← 中间件单元测试
│   ├── idempotency/
│   │   ├── processed-events.repository.ts      ← 幂等去重表（消费端）
│   │   └── idempotent-consumer.ts              ← 幂等消费封装
│   ├── persistence.service.ts                  ← 业务编排（saveMessageWithOutbox）
│   ├── persistence.module.ts                   ← NestJS 模块
│   └── index.ts                                ← 桶文件
├── conversation/                               ← 【Day 23 已有】需接入软删除
│   └── conversation.service.ts                 ← 改：删除走软删除
├── diagnosis/                                  ← 【Day 23 已有】需接入乐观锁
│   └── diagnosis.service.ts                    ← 改：update 走 CAS
├── prisma/
│   ├── schema.prisma                           ← 【已有】+ Outbox/ProcessedEvent 表 + version/deletedAt 字段
│   ├── prisma.service.ts                       ← 【已有】+ 挂载 soft-delete 中间件
│   └── migrations/
│       └── 20260809_add_outbox_optlock_softdelete/
│           └── migration.sql                   ← 【新增】
└── main.ts                                     ← 【已有】+ bootstrap 启动 OutboxRelay
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `persistence.service.ts` | ✓ 先 create 再 emit | ✓ Outbox 同事务写 | ✓ 同 v2 |
| `outbox/outbox.repository.ts` | ✗ | ✓ 同事务写 + relay 拉取 | ✓ 同 v2 |
| `outbox/outbox-relay.service.ts` | ✗ | ✓ 轮询发布 | ✓ + 崩溃恢复（重扫 pending） |
| `optimistic-lock/optimistic-lock.ts` | ✗ | ✗ | ✓ CAS 更新 + 冲突错误 |
| `soft-delete/soft-delete.middleware.ts` | ✗ | ✗ | ✓ Prisma $extends 中间件 |
| `idempotency/processed-events.repository.ts` | ✗ | ✗ | ✓ 幂等去重表 |
| `prisma/schema.prisma` | 基础表 | + Outbox 表 | + ProcessedEvent + version + deletedAt |

**依赖方向（务必单向，反过来一次都不行）**：

```
conversation.service.ts / diagnosis.service.ts
        │
        ▼
persistence.service.ts                          ← 编排：事务内写业务 + 写 Outbox
        │
        ├─► outbox/outbox.repository.ts ──► prisma（同一个 tx）
        │
        ├─► optimistic-lock/optimistic-lock.ts（纯逻辑）
        │
        └─► idempotency/idempotent-consumer.ts ──► processed-events.repository.ts

outbox/outbox-relay.service.ts                  ← 独立进程，不被业务调用
        │
        └─► outbox.repository.ts + 事件总线

soft-delete.middleware.ts                        ← 挂在 PrismaService 上，全局生效
optimistic-lock.ts                               ← 纯逻辑，不 import prisma 具体实例
outbox-event.types.ts                            ← 纯类型
```

**红线**：
- `persistence.service.ts` 里"写业务"和"写 Outbox"如果不在同一个 `prisma.$transaction` 回调里，就是双写裂缝——Outbox 模式的全部意义就是这两个写必须原子
- `outbox-relay.service.ts` 里出现业务逻辑（例如"如果是 message.created 就生成诊断"）就是塌方——relay 只负责搬运，不解释事件
- `optimistic-lock.ts` 里出现 `new PrismaService()` 是塌方——它是纯逻辑封装，接收 tx client 作为参数
- 任何 Conversation/Message 查询绕过软删除中间件直接 `prisma.$queryRaw` 是塌方——会把已删除数据翻出来

**动手前先问自己 3 个问题**：

1. Outbox 事件为什么必须和业务写在同一个事务？—— 见 §5.4 知识点 1「Outbox 模式与双写一致性」
2. 乐观锁的 version 检查为什么放在 `WHERE` 而不是先 SELECT 再比较？—— 见 §5.4 知识点 3「CAS 与 check-then-act 竞态」
3. 软删除为什么用 Prisma 中间件而不是每个查询手动加 `WHERE deletedAt IS NULL`？—— 见 §5.4 知识点 5「默认安全 vs 手动过滤」

---

## 1.5 阶段 D：动手脚手架（30 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认 Prisma 版本 + 装依赖（3 分钟）

按第 5.3 节的代码：

- 确认 `@prisma/client` ≥ 5.0（Day 13 已装，`$extends` 客户端扩展需要 5.0+）
- 本日不需要新增运行时依赖；事件总线用 NestJS 内置的 `EventEmitter2`（`@nestjs/event-emitter`，若未装：`pnpm --filter api add @nestjs/event-emitter`）

**边写边问自己**：

- 为什么用 `EventEmitter2` 而不是真的 Kafka/RabbitMQ？（今天教的是 Outbox 模式本身；总线用内存版足够演示"relay 搬运"，生产换成 Kafka 时 relay 逻辑不变）
- Prisma `$extends` 和旧的 `$use` 中间件有什么区别？（`$use` 已废弃；`$extends` 是类型安全的新 API，query 扩展能拦截所有模型操作）

### 1.5.2 D-2：创建目录（3 分钟）

按第 5.3 节的目录树，在 `apps/api/src/persistence/` 下建 4 个子目录：`outbox/` `optimistic-lock/` `soft-delete/` `idempotency/`。

**边写边问自己**：

- 为什么 `outbox/` 和 `idempotency/` 分开？（Outbox 是**生产端**保证"事件一定发出"；幂等是**消费端**保证"事件重复也不重复处理"——一个防丢一个防重，是两个独立机制）
- 为什么 `soft-delete/` 只有一个中间件文件？（软删除的全部逻辑就是"查询时注入过滤 + 删除时改写成 update"，集中在一个中间件里，不散落）

### 1.5.3 D-3：改 Prisma Schema + migration（7 分钟）

按第 5.3 节的代码：

- `schema.prisma`：新增 `Outbox` model（id/eventType/payload/status/createdAt/publishedAt）和 `ProcessedEvent` model（eventId/processedAt）
- 给 `Diagnosis` 加 `version Int @default(0)`
- 给 `Conversation` / `Message` 加 `deletedAt DateTime?`
- 运行 `pnpm --filter api prisma migrate dev --name add_outbox_optlock_softdelete`
- 检查 migration.sql 是否有 Outbox 表的 `status` 索引（relay 要频繁 `WHERE status='pending'`）

**边写边问自己**：

- Outbox 的 `payload` 用 `Json` 还是 `String`？（用 `Json`——Postgres 原生 JSONB 可索引可查询，排查时能 `WHERE payload->>'messageId' = 'm-01'`）
- `version` 为什么默认 0 而不是 1？（无所谓，只要单调递增；默认 0 让"从未更新过"和"更新过一次"能区分）
- 软删除的 `deletedAt` 为什么可空？（NULL = 未删除，是默认安全值；有时间戳 = 已删除。用可空时间戳而不是 boolean，是为了同时记录"删除时间"用于 30 天保留策略）

### 1.5.4 D-4：写 outbox + optimistic-lock（纯逻辑，10 分钟）

按第 5.3 节的代码：

- 写 `outbox/outbox-event.types.ts`（事件类型）
- 写 `outbox/outbox.repository.ts`（`writeInTx` / `fetchPending` / `markPublished`）
- 写 `outbox/outbox-relay.service.ts`（`OnApplicationBootstrap` 启动轮询）
- 写 `optimistic-lock/optimistic-lock.ts`（`updateWithVersion` + `OptimisticLockError`）

**边写边问自己**：

- `writeInTx` 为什么接收 `tx` 参数而不是自己开事务？（它必须复用调用方的事务，才能和业务写原子——这是 Outbox 的命门）
- relay 轮询间隔设多少？（200ms 是延迟和 DB 压力的折中；生产可用 `LISTEN/NOTIFY` 做到近实时，今天先轮询）
- `updateWithVersion` 影响行数=0 时为什么抛错而不是返回 false？（强制调用方处理冲突；返回 false 容易被忽略，抛错逼着上层要么重试要么报 409）

### 1.5.5 D-5：写 soft-delete + idempotency + 编排（7 分钟）

按第 5.3 节的代码：

- 写 `soft-delete/soft-delete.middleware.ts`（`$extends` query 拦截）
- 写 `idempotency/processed-events.repository.ts` + `idempotent-consumer.ts`
- 写 `persistence.service.ts`（`saveMessageWithOutbox` 事务编排）
- 在 `prisma.service.ts` 挂中间件、`main.ts` 启动 relay

**边写边问自己**：

- 软删除中间件拦截 `delete` 改写成 `update{deletedAt}`，那真的要物理删除时怎么办？（保留一个 `hardDelete` 逃生通道，只有回收站清理任务能调）
- 幂等表 `processed_events` 会无限增长吗？（会——需要定期清理 N 天前的记录；今天先不做清理，M3 门禁时补）
- `saveMessageWithOutbox` 事务里能不能调用外部 HTTP？（绝对不能——事务持有行锁，外部 HTTP 慢会让锁长期不释放，阻塞其他连接）

---

## 2. 学习节奏（90 阅读 / 270 动手深化）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 40 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"先写后发→Outbox 同事务→乐观锁+软删除+幂等"的演进路径 |
| B：读代码 | 40 min | §5.3 逐文件通读，特别是 `persistence.service.ts` 事务边界和 `outbox-relay.service.ts` | 能口述"Outbox 写在事务哪一步"、"relay 崩溃后怎么恢复" |
| C：读深挖 | 40 min | §6.5 前端底子补弱（`Day27深挖-前端底子补弱.html`） | 能回答"前端乐观更新 vs 后端乐观锁的异同" |
| D：动手脚手架 | 30 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 60 min | §7.6 三个 spec（outbox relay / 乐观锁 / 软删除中间件） | `pnpm --filter api test persistence` 全绿 |
| F-1：反证 1 | 30 min | §7.7 COMMIT 后注入崩溃，验证 relay 补发 | 观察"已展示未发布"在 v1 出现、v3 不出现 |
| F-2：反证 2 | 30 min | §7.8 去掉乐观锁 WHERE version，100 并发更新 | 观察丢失更新，验证乐观锁的价值 |
| F-3：验证 + 提交 | 30 min | §7.9 四件套 + commit | commit 含 `Refs: Day27` |

**总计**：90 阅读（A+B+C）+ 270 动手/项目深化 = 360 min

---

## 3. v1：最小闭环（业务写与事件发布分离）

### 3.1 v1 要实现什么

Day 26 的 BFF 收齐模型回答后，v1 做最直觉的两步：先 `INSERT` Message，成功后 `emit` 一个事件让下游生成诊断。

**目标**：
- `persistenceService.saveMessage(msg)` 写库
- 写成功后 `eventEmitter.emit('message.created', {messageId})`
- 下游 `DiagnosisConsumer` 收到后生成诊断

**不做**：
- 不用 Outbox（写库和发事件是分离的两步）
- 不做乐观锁（update 直接覆盖）
- 不做软删除（delete 物理删）
- 不做幂等（事件来几次处理几次）

### 3.2 v1 目录结构

```
apps/api/src/persistence/
├── persistence.service.ts       ← 先 create 再 emit
└── persistence.module.ts
```

### 3.3 v1 完整代码

**apps/api/src/persistence/persistence.service.ts（v1 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async saveMessage(input: {
    conversationId: string
    role: string
    content: string
  }): Promise<string> {
    // 第 1 步：写业务数据
    const message = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
      },
    })

    // 第 2 步：发布事件（← 这一步和上一步不在同一个事务里）
    this.eventEmitter.emit('message.created', { messageId: message.id })

    return message.id
  }
}
```

**apps/api/src/persistence/persistence.module.ts（v1）**

```typescript
import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PrismaModule } from '../prisma/prisma.module'
import { PersistenceService } from './persistence.service'

@Module({
  imports: [PrismaModule, EventEmitterModule.forRoot()],
  providers: [PersistenceService],
  exports: [PersistenceService],
})
export class PersistenceModule {}
```

### 3.4 v1 暴露的痛点

**痛点 1：COMMIT 后崩溃 → 事件永远丢失（核心裂缝）**

`saveMessage` 里第 1 步 `create` 提交后、第 2 步 `emit` 执行前，如果进程崩溃（OOM / 部署重启 / 断电），事件就永远发不出去。库里有 Message，前端也早就（Day 26 流式）把回答渲染了，但下游诊断永远不触发。用户看到"回答完成"，等一整天也等不到诊断。**这是 dual-write 最经典的失败模式。**

即使不崩溃：`emit` 是内存事件，如果下游 handler 抛错，事件也没有重试机制——同样丢失。

**痛点 2：并发更新静默覆盖（丢失更新）**

两个请求同时 `prisma.diagnosis.update({where:{id}, data:{note}})`，后写的直接覆盖先写的，没有任何冲突检测。先写入的人的修改凭空消失。

**痛点 3：物理删除不可恢复、审计断链**

`prisma.conversation.delete()` 物理删除，数据没了。用户误删想恢复？没有。审计要查"这个会话什么时候被谁删的"？记录都没了。

**痛点 4：事件重复消费产生重复诊断**

即使 v1 之后加了事件重试（防痛点1），一旦重试就可能投递两次，下游没有幂等保护会生成两条诊断。

---

## 4. v2：Outbox 同事务写 + relay 轮询发布

### 4.1 v2 要实现什么

用户视角：无论进程在哪一刻崩溃，只要 Message 进了库，事件最终一定会发出去（至少一次）。核心手段是 **Transactional Outbox 模式**：把"写业务数据"和"写待发事件"放进同一个数据库事务，原子提交；再用一个独立的 relay 进程轮询 Outbox 表，把 pending 事件真正发到总线，发成功后标记 published。

**目标**：
- `saveMessageWithOutbox` 在一个 `$transaction` 里同时写 Message 和 Outbox 记录
- `OutboxRelayService` 每 200ms 拉 pending 事件、发布、标记 published
- 进程崩溃重启后，relay 重扫仍是 pending 的记录继续发

**依然不做**：
- 乐观锁（留给 v3）
- 软删除（留给 v3）
- 消费端幂等（留给 v3——注意 Outbox 是"至少一次"，必须配幂等才安全）

### 4.2 v2 目录结构

```
apps/api/src/persistence/
├── outbox/
│   ├── outbox-event.types.ts        ← 新增
│   ├── outbox.repository.ts         ← 新增：同事务写 + relay 拉取
│   └── outbox-relay.service.ts      ← 新增：轮询发布
├── persistence.service.ts           ← 改：saveMessageWithOutbox
└── persistence.module.ts            ← 改：注册 relay
```

### 4.3 v2 完整代码

**apps/api/src/persistence/outbox/outbox-event.types.ts（v2 全文）**

```typescript
// Outbox 记录的状态
export type OutboxStatus = 'pending' | 'published'

// 待发布事件的领域形状（存进 Outbox.payload 的结构）
export type OutboxEventType = 'message.created' | 'diagnosis.updated'

export interface OutboxEventInput {
  eventType: OutboxEventType
  payload: Record<string, unknown>
}

export interface OutboxRecord {
  id: string
  eventType: OutboxEventType
  payload: Record<string, unknown>
  status: OutboxStatus
  createdAt: Date
  publishedAt: Date | null
}
```

**apps/api/src/persistence/outbox/outbox.repository.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type { OutboxEventInput, OutboxRecord } from './outbox-event.types'

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在【调用方的事务】里写入 Outbox 记录。
   * 关键：接收 tx（TransactionClient），不自己开事务——
   * 这样才能和业务写共享同一个事务，一起提交或一起回滚。
   */
  async writeInTx(
    tx: Prisma.TransactionClient,
    event: OutboxEventInput,
  ): Promise<void> {
    await tx.outbox.create({
      data: {
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        status: 'pending',
      },
    })
  }

  /** relay 拉取一批待发布事件（按创建顺序，保证大致有序） */
  async fetchPending(limit = 50): Promise<OutboxRecord[]> {
    const rows = await this.prisma.outbox.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    return rows as unknown as OutboxRecord[]
  }

  /** 标记为已发布 */
  async markPublished(id: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { status: 'published', publishedAt: new Date() },
    })
  }
}
```

**apps/api/src/persistence/outbox/outbox-relay.service.ts（v2 全文）**

```typescript
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { OutboxRepository } from './outbox.repository'

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly intervalMs = 200

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // 应用启动后开始轮询。崩溃重启也会走这里，
  // 自动重扫仍是 pending 的记录 —— 这就是"崩溃恢复"。
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    this.logger.log('OutboxRelay started')
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick(): Promise<void> {
    if (this.running) return // 防止上一轮未结束就重入
    this.running = true
    try {
      const pending = await this.outbox.fetchPending(50)
      for (const record of pending) {
        try {
          // 真正发到总线（生产环境这里换成 Kafka producer.send）
          this.eventEmitter.emit(record.eventType, {
            ...record.payload,
            __outboxId: record.id,
          })
          await this.outbox.markPublished(record.id)
        } catch (err) {
          // 单条失败不影响其他；下一轮会重试（至少一次投递）
          this.logger.error(`publish failed for ${record.id}`, err as Error)
        }
      }
    } catch (err) {
      this.logger.error('outbox tick failed', err as Error)
    } finally {
      this.running = false
    }
  }
}
```

**apps/api/src/persistence/persistence.service.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { OutboxRepository } from './outbox/outbox.repository'

@Injectable()
export class PersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * 写 Message 和写 Outbox 事件在同一个事务里。
   * 要么都成功（Message 有了、事件待发），
   * 要么都失败（回滚，什么都没发生）。
   * 绝不会出现"Message 有了但事件丢了"。
   */
  async saveMessageWithOutbox(input: {
    conversationId: string
    role: string
    content: string
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
        },
      })

      // 同一个 tx —— 和 message.create 原子提交
      await this.outbox.writeInTx(tx, {
        eventType: 'message.created',
        payload: { messageId: message.id, conversationId: input.conversationId },
      })

      return message.id
    })
    // 注意：事务提交后事件仍是 pending，由 relay 异步发布。
    // 这就是用"最终一致"换"绝不丢事件"。
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：至少一次投递 → 必然出现重复消费**

Outbox 保证"事件不丢"，代价是"可能发多次"：relay 发到总线成功、但 `markPublished` 前崩溃，重启后这条还是 pending，会再发一次。下游 `DiagnosisConsumer` 收到两次 `message.created`，生成两条诊断。**Outbox 必须配消费端幂等，否则只是把"丢事件"换成了"重复副作用"。**

**痛点 2：并发更新仍然静默覆盖**

v2 只解决了"写+发"一致性，没碰更新。两个请求同时改同一条 Diagnosis 仍然丢失更新。

**痛点 3：删除仍是物理删除**

软删除还没做，误删不可恢复、审计断链的问题依旧。

**痛点 4：relay 有序性和吞吐的取舍**

`fetchPending` 按 `createdAt asc` 拉，单 relay 串行发能大致保序，但吞吐受限；多 relay 并发发会乱序且可能重复拉同一条（需要 `SELECT FOR UPDATE SKIP LOCKED`）。v2 先用单 relay，把这个取舍留到深挖里讲。

---

## 5. v3：乐观锁 + 软删除默认 scope + 消费端幂等（终态）

### 5.1 v3 要实现什么

用户视角：
1. 并发更新同一条 Diagnosis 时，后提交者收到 409 冲突而不是静默覆盖（乐观锁）
2. 删除会话只是标记 `deletedAt`，普通查询自动过滤，30 天内可恢复、审计链不断（软删除默认 scope）
3. 下游消费者对重复投递幂等——同一 Outbox 事件消费两次只产生一次副作用（消费端幂等）
4. 继承 v2 的 Outbox 一致性 + relay 崩溃恢复

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/persistence/
├── outbox/
│   ├── outbox-event.types.ts        ← v2 已有
│   ├── outbox.repository.ts         ← v2 已有
│   └── outbox-relay.service.ts      ← v2 已有
├── concurrency/
│   ├── optimistic-lock.ts           ← 新增：版本校验纯函数
│   ├── optimistic-lock.spec.ts      ← 新增
│   └── version-conflict.error.ts    ← 新增：409 语义
├── soft-delete/
│   ├── soft-delete.extension.ts     ← 新增：Prisma 扩展，默认过滤 deletedAt
│   └── soft-delete.spec.ts          ← 新增
├── idempotency/
│   ├── consumed-events.repository.ts ← 新增：已消费事件表
│   └── idempotent-consumer.ts        ← 新增：幂等消费包装
├── persistence.service.ts           ← 改：updateDiagnosis 带版本
└── persistence.module.ts
```

### 5.3 v3 完整代码

#### 5.3.1 concurrency 层：optimistic-lock.ts（纯函数）

```typescript
import { VersionConflictError } from './version-conflict.error'

/**
 * 乐观锁核心：更新前对比版本号。
 * 这是纯函数——不碰 DB，只做"期望版本 vs 当前版本"的判定，
 * 因此能穷举单测所有分支。真正的原子性由 DB 的 WHERE version=? 保证。
 */
export function assertVersionMatch(
  expectedVersion: number,
  currentVersion: number,
): void {
  if (expectedVersion !== currentVersion) {
    throw new VersionConflictError(expectedVersion, currentVersion)
  }
}

/** 计算更新后的新版本号（永远 +1，单调递增） */
export function nextVersion(currentVersion: number): number {
  return currentVersion + 1
}
```

#### 5.3.2 concurrency 层：version-conflict.error.ts

```typescript
import { ConflictException } from '@nestjs/common'

/** 映射到 HTTP 409。前端据此提示"数据已被他人修改，请刷新后重试" */
export class VersionConflictError extends ConflictException {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super({
      code: 'VERSION_CONFLICT',
      message: `expected version ${expectedVersion}, but current is ${actualVersion}`,
      expectedVersion,
      actualVersion,
    })
  }
}
```

#### 5.3.3 concurrency 层：optimistic-lock.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { assertVersionMatch, nextVersion } from './optimistic-lock'
import { VersionConflictError } from './version-conflict.error'

describe('optimistic-lock', () => {
  it('版本一致时不抛错', () => {
    expect(() => assertVersionMatch(3, 3)).not.toThrow()
  })

  it('版本不一致时抛 VersionConflictError', () => {
    expect(() => assertVersionMatch(3, 5)).toThrow(VersionConflictError)
  })

  it('冲突错误携带期望和实际版本', () => {
    try {
      assertVersionMatch(3, 5)
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError)
      expect((err as VersionConflictError).expectedVersion).toBe(3)
      expect((err as VersionConflictError).actualVersion).toBe(5)
    }
  })

  it('nextVersion 单调 +1', () => {
    expect(nextVersion(0)).toBe(1)
    expect(nextVersion(41)).toBe(42)
  })
})
```

#### 5.3.4 persistence.service.ts：带版本的更新（DB 层原子性）

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { VersionConflictError } from './concurrency/version-conflict.error'

@Injectable()
export class PersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 乐观锁更新：WHERE 同时匹配 id 和 version。
   * 关键：判定和更新是【同一条 SQL 原子完成】的——
   * 不能"先 SELECT 版本，再对比，再 UPDATE"（那之间会有竞态）。
   * updateMany 返回 count=0 说明版本已被别人改过。
   */
  async updateDiagnosis(input: {
    id: string
    expectedVersion: number
    summary: string
  }): Promise<void> {
    const result = await this.prisma.diagnosis.updateMany({
      where: { id: input.id, version: input.expectedVersion },
      data: {
        summary: input.summary,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })

    if (result.count === 0) {
      // 没更到任何行 = 版本已变。读出当前版本给前端更友好的提示
      const current = await this.prisma.diagnosis.findUnique({
        where: { id: input.id },
        select: { version: true },
      })
      throw new VersionConflictError(input.expectedVersion, current?.version ?? -1)
    }
  }
}
```

#### 5.3.5 soft-delete 层：soft-delete.extension.ts（Prisma Client 扩展）

```typescript
import { Prisma } from '@prisma/client'

/**
 * Prisma Client 扩展：让软删除模型的普通查询默认过滤 deletedAt。
 * 关键价值：业务代码不用每次手写 `where: { deletedAt: null }`——
 * 漏一次就会把已删数据泄漏出去。默认 scope 把"安全"变成默认行为。
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    conversation: {
      // 拦截读操作，自动注入 deletedAt: null
      async findMany({ args, query }) {
        args.where = { ...args.where, deletedAt: null }
        return query(args)
      },
      async findFirst({ args, query }) {
        args.where = { ...args.where, deletedAt: null }
        return query(args)
      },
      // 拦截 delete，改写为 update deletedAt（软删除）
      async delete({ args, query: _query }) {
        // 交给 update 执行软删除，而不是物理删除
        return (this as any).conversation.update({
          where: args.where,
          data: { deletedAt: new Date() },
        })
      },
    },
  },
})
```

#### 5.3.6 idempotency 层：consumed-events.repository.ts

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ConsumedEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 尝试登记一个已消费的 outboxId。
   * 依赖 consumed_events.outbox_id 的唯一约束：
   * 重复登记会抛唯一冲突 → 返回 false（说明已消费过，应跳过）。
   */
  async tryMarkConsumed(outboxId: string, consumer: string): Promise<boolean> {
    try {
      await this.prisma.consumedEvent.create({
        data: { outboxId, consumer },
      })
      return true // 第一次消费
    } catch (err: any) {
      if (err?.code === 'P2002') return false // 唯一约束冲突 = 已消费
      throw err
    }
  }
}
```

#### 5.3.7 idempotency 层：idempotent-consumer.ts

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ConsumedEventsRepository } from './consumed-events.repository'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class DiagnosisConsumer {
  private readonly logger = new Logger(DiagnosisConsumer.name)

  constructor(
    private readonly consumed: ConsumedEventsRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 消费 message.created 事件。
   * relay 是"至少一次"投递，同一 __outboxId 可能来两次。
   * 幂等闸门：先 tryMarkConsumed，false 就直接跳过——
   * 保证副作用（生成诊断）只发生一次。
   */
  @OnEvent('message.created')
  async handle(payload: { messageId: string; __outboxId: string }): Promise<void> {
    const isFirst = await this.consumed.tryMarkConsumed(payload.__outboxId, 'diagnosis')
    if (!isFirst) {
      this.logger.debug(`skip duplicate outbox ${payload.__outboxId}`)
      return
    }

    // 真正的副作用：为这条 message 生成诊断（只执行一次）
    await this.prisma.diagnosis.create({
      data: { messageId: payload.messageId, summary: '（诊断生成中）', version: 0 },
    })
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：ACID 与事务边界**
- 解决的问题：多步写入中途失败会留下半成品（Message 有了、Diagnosis 没了）
- 运行机制：`$transaction` 把多个写包成原子单元，全成功才提交，任一失败全回滚
- 项目落点：`saveMessageWithOutbox` 把 message.create 和 outbox.writeInTx 包在一个 tx
- 生产误区：事务里塞 HTTP 调用（锁持有过久，连接池耗尽）；事务粒度过大（本该独立的写被绑死）
- 验证方法：在事务中间注入异常，断言 Message 和 Outbox 都没写入

**知识点 2：隔离级别（Isolation Level）**
- 解决的问题：默认 ReadCommitted 下"先读后写"模式在并发时读到旧值、写覆盖
- 运行机制：ReadCommitted（读已提交）/ RepeatableRead / Serializable（串行化）逐级更严；Postgres 默认 ReadCommitted
- 项目落点：乐观锁用 `updateMany WHERE version=?` 在 ReadCommitted 下也安全，不需要升级隔离级别
- 生产误区：无脑上 Serializable（性能损失 + serialization failure 需重试）；以为默认隔离级别能防丢失更新（不能）
- 验证方法：两个并发事务基于同版本更新，断言一个成功一个 409

**知识点 3：乐观锁（Optimistic Locking）**
- 解决的问题：悲观锁（SELECT FOR UPDATE）持锁久、并发低；乐观锁假设冲突罕见，冲突时才失败重试
- 运行机制：每行带 version 字段，UPDATE 时 `WHERE id=? AND version=?`，count=0 即冲突
- 项目落点：`updateDiagnosis` 的 updateMany + `version: { increment: 1 }`
- 生产误区：先 SELECT 版本再 UPDATE（中间有竞态窗口）；version 用时间戳（时钟回拨会撞）
- 验证方法：`optimistic-lock.spec.ts` 穷举版本匹配/不匹配；集成测试 100 并发验证无丢失更新

**知识点 4：Transactional Outbox 模式**
- 解决的问题：双写（写库 + 发消息）无法原子——写库成功发消息失败就"已展示未发布"
- 运行机制：把待发事件作为一行写进同库的 Outbox 表（同事务原子），relay 进程异步轮询发布
- 项目落点：`outbox.writeInTx` 接收调用方 tx；`OutboxRelayService` 轮询 + 崩溃重扫
- 生产误区：relay 发布后忘记 markPublished（无限重发）；Outbox 不清理（表无限膨胀，需归档）
- 验证方法：在 message.create 后、事务提交前 kill 进程，重启后断言事件仍被发出

**知识点 5：至少一次投递 + 消费端幂等**
- 解决的问题：Outbox 是"至少一次"，重复投递会导致重复副作用（两条诊断）
- 运行机制：消费端用 consumed_events 表 + outboxId 唯一约束做幂等闸门，重复的直接跳过
- 项目落点：`tryMarkConsumed` 靠 P2002 唯一冲突判定已消费；`DiagnosisConsumer` 先闸门后副作用
- 生产误区：先执行副作用再登记（崩溃点之间会重复）；用内存 Set 做幂等（重启即失效）
- 验证方法：对同一 __outboxId 调 handle 两次，断言 diagnosis 只创建一条

**知识点 6：软删除（Soft Delete）与默认 scope**
- 解决的问题：物理删除不可恢复、审计断链；但每个查询手写 `deletedAt: null` 会漏
- 运行机制：删除只写 `deletedAt` 时间戳；Prisma Client 扩展拦截读查询自动注入过滤条件
- 项目落点：`soft-delete.extension.ts` 拦截 findMany/findFirst/delete
- 生产误区：软删除但唯一约束没带 deletedAt（删了同名的建不回来）；只在 service 层过滤（raw query 绕过）
- 验证方法：删除后普通查询查不到、加 `deletedAt: { not: null }` 能查到；30 天恢复用例

### 5.5 边写边问自己

- `writeInTx` 为什么接收 `tx` 而不是自己开事务？（只有共享调用方的事务，Outbox 写才能和业务写原子提交）
- 乐观锁为什么用 `updateMany` 而不是 `findUnique` + `update`？（updateMany 的 WHERE version 判定和写是同一条 SQL，原子；分两步有竞态）
- 消费端幂等为什么"先登记后执行副作用"错了？（登记成功、执行副作用前崩溃，重启后已登记会跳过 → 副作用永远不发生。正确顺序要么副作用幂等要么放同事务）
- 软删除默认 scope 为什么用 Prisma 扩展而不是 service 包装？（service 包装只护得住走 service 的路径，raw query / 其他 service 会绕过；扩展在 client 层兜底）

---

## 6. 三版对比一览表

| 维度 | v1 业务写与事件分离 | v2 Outbox 同事务 + relay | v3 + 乐观锁 + 软删除 + 幂等（终态） |
|---|---|---|---|
| **核心目标** | 最小闭环：写库后发事件 | 保证"写了库就一定发事件" | 保证"无丢失更新、无软删除泄漏、无重复副作用" |
| **事务边界** | 单步 create | message + outbox 同事务 | 同 v2 |
| **崩溃后事件** | 永久丢失（已展示未发布） | relay 重扫 pending 补发 | 同 v2 |
| **并发更新** | 静默覆盖（丢失更新） | 同 v1 | WHERE version 乐观锁，冲突 409 |
| **删除策略** | 物理删除（不可恢复） | 同 v1 | 软删除 + Prisma 扩展默认 scope |
| **重复消费** | 生成重复诊断 | 同 v1 | consumed_events 幂等闸门，跳过 |
| **新增文件** | persistence.service.ts | + outbox/ (repository + relay) | + concurrency/ + soft-delete/ + idempotency/ |
| **测试重点** | create 成功 + emit 收到 | relay 轮询 + 崩溃恢复 | 乐观锁单测 + 100 并发集成 + 软删除 scope + 幂等重复投递 |
| **最大风险** | COMMIT 后崩溃 → 事件丢 | relay 重试 → 重复投递 | version 字段忘迁移 / 软删除忘加默认 scope / 幂等登记放副作用后 |
| **代码行数** | ~60 | ~200 | ~450（含测试） |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

**为什么在这里插入 HTML 深挖**：今天主题是 Postgres 持久化，但前端工程师常觉得"这些是后端的事"。实际上乐观锁的 **冲突提示 UI**、软删除的 **回收站交互**、Outbox 的 **提交确认反馈** 都需要前端深度理解才能接得住。HTML 入口用一个完整的"诊断编辑表单"示范三个真实场景：

1. 乐观锁冲突时前端收到 409，如何显示"数据已被他人修改，请刷新后重试"的模态框并**重新拉取最新 version**
2. 软删除的会话如何在回收站列表显示、恢复按钮如何调 PATCH /conversations/:id/restore
3. 提交表单后前端显示"保存中..."，后端 Outbox 提交成功后才显示"已保存"——**但前端并不知道事件是否发出去了**（最终一致）

**深挖 HTML 路径**：`output/90天逐日任务/Day27深挖-前端底子补弱.html`，内含：
- 诊断编辑表单（带 version 字段的 PATCH 请求）
- 409 冲突模态框 + 重新拉取
- 回收站列表 + 恢复按钮
- 保存确认的"已保存"vs"保存中"状态
- 代码注释解释"前端乐观更新 vs 后端乐观锁"的区别

打开 HTML 文件后，先自己读代码回答 3 个问题（答案在 HTML 底部注释）：

1. 前端发 PATCH 时为什么要带上当前 version？如果不带会怎样？
2. 收到 409 后为什么要重新 GET 最新数据？如果直接让用户手动刷新页面会怎样？
3. "已保存"的绿勾只代表"Message 进库了"，为什么不能保证"诊断已生成"？

**预期时长**：20 分钟通读 HTML + 20 分钟自己改一版（增加"冲突次数"显示、给回收站加过期倒计时）

---

## 7. 项目验收清单（阶段 E-F，约 120 分钟）

### 7.1 E-1：工程环境确认（5 分钟）

- [ ] `pnpm --filter api prisma generate` 成功（Outbox / ProcessedEvent / Diagnosis.version / Conversation.deletedAt 已进 schema）
- [ ] `pnpm --filter api build` 通过（import 路径正确、无类型错误）
- [ ] `pnpm --filter api prisma migrate dev --name add_outbox_optlock_softdelete` 创建 migration（不自动应用，留到 7.2 才 apply）

### 7.2 E-2：核心单元测试（40 分钟）

按第 5.3 节的代码写 3 个 spec：

**7.2.1 optimistic-lock.spec.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { assertVersionMatch, nextVersion } from './optimistic-lock'
import { VersionConflictError } from './version-conflict.error'

describe('optimistic-lock', () => {
  it('版本一致时不抛错', () => {
    expect(() => assertVersionMatch(3, 3)).not.toThrow()
  })

  it('版本不一致时抛 VersionConflictError', () => {
    expect(() => assertVersionMatch(3, 5)).toThrow(VersionConflictError)
  })

  it('冲突错误携带期望和实际版本', () => {
    try {
      assertVersionMatch(3, 5)
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError)
      expect((err as VersionConflictError).expectedVersion).toBe(3)
      expect((err as VersionConflictError).actualVersion).toBe(5)
    }
  })

  it('nextVersion 单调 +1', () => {
    expect(nextVersion(0)).toBe(1)
    expect(nextVersion(41)).toBe(42)
  })
})
```

**7.2.2 soft-delete.spec.ts（集成 Prisma 测试，隔离 schema）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { softDeleteExtension } from './soft-delete.extension'

const prisma = new PrismaClient().$extends(softDeleteExtension)

describe('soft-delete extension', () => {
  beforeEach(async () => {
    await prisma.conversation.deleteMany() // 清空隔离 schema
  })

  it('普通查询不返回已删除记录', async () => {
    const c = await prisma.conversation.create({ data: { userId: 'u1' } })
    await prisma.conversation.delete({ where: { id: c.id } })
    
    const found = await prisma.conversation.findMany()
    expect(found).toHaveLength(0)
  })

  it('手动过滤 deletedAt 能查到已删除记录', async () => {
    const c = await prisma.conversation.create({ data: { userId: 'u1' } })
    await prisma.conversation.delete({ where: { id: c.id } })
    
    const deleted = await prisma.conversation.findMany({
      where: { deletedAt: { not: null } },
    })
    expect(deleted).toHaveLength(1)
  })
})
```

**7.2.3 outbox-relay.spec.ts（mock EventEmitter 验证轮询发布）**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutboxRelayService } from './outbox-relay.service'
import { OutboxRepository } from './outbox.repository'
import { EventEmitter2 } from '@nestjs/event-emitter'

describe('OutboxRelayService', () => {
  let relay: OutboxRelayService
  let outbox: OutboxRepository
  let emitter: EventEmitter2

  beforeEach(() => {
    outbox = {
      fetchPending: vi.fn().mockResolvedValue([]),
      markPublished: vi.fn(),
    } as any
    emitter = { emit: vi.fn() } as any
    relay = new OutboxRelayService(outbox, emitter)
  })

  it('tick 拉取 pending 并发布', async () => {
    vi.mocked(outbox.fetchPending).mockResolvedValue([
      { id: 'o1', eventType: 'message.created', payload: { messageId: 'm1' } },
    ] as any)

    await (relay as any).tick()

    expect(emitter.emit).toHaveBeenCalledWith('message.created', {
      messageId: 'm1',
      __outboxId: 'o1',
    })
    expect(outbox.markPublished).toHaveBeenCalledWith('o1')
  })
})
```

运行：`pnpm --filter api test persistence`，断言全绿。

### 7.3 E-3：集成测试：100 并发验证乐观锁（15 分钟）

```typescript
import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'

describe('optimistic lock concurrency', () => {
  it('100 并发更新同一条 Diagnosis，只有 1 个成功其余全 409', async () => {
    const prisma = new PrismaClient()
    const d = await prisma.diagnosis.create({ data: { messageId: 'm1', summary: 'init', version: 0 } })

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        prisma.diagnosis.updateMany({
          where: { id: d.id, version: 0 },
          data: { summary: `update-${i}`, version: { increment: 1 } },
        })
      )
    )

    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).count > 0)
    expect(succeeded).toHaveLength(1) // 只有 1 个成功
  })
})
```

### 7.4 F-1：反证实验 1——COMMIT 后注入崩溃，验证 relay 补发（30 分钟）

**目标**：证明"没有 Outbox 时，COMMIT 后崩溃会丢事件；有 Outbox 时崩溃后 relay 重扫会补发"。

**步骤**：

1. v1 版本：`saveMessage` 里 create 成功后、`emit` 前插入 `process.exit(1)`
2. 启动后发一条消息，观察：Message 进库、事件未发、诊断永远不生成（"已展示未发布"）
3. v3 版本：`saveMessageWithOutbox` 事务 COMMIT 后、relay 扫到前 kill 进程
4. 重启，观察：relay 重扫到 pending 记录，补发事件，诊断生成（无"已展示未发布"）

**记录**：截图"v1 Message 有、诊断无"和"v3 重启后诊断生成"，写进 `docs/反证实验/Day27-反证1-outbox崩溃恢复.md`。

### 7.5 F-2：反证实验 2——移除乐观锁 WHERE version，100 并发验证丢失更新（30 分钟）

**目标**：证明"不带 WHERE version 的 update 在并发时会丢失更新；带了就 409"。

**步骤**：

1. 改 `updateDiagnosis` 去掉 `WHERE version`，改成普通 `update({ where: { id } })`
2. 100 并发更新同一条（`summary: 'A'` / 'B' / 'C' ... ）
3. 观察：最终 summary 只保留最后写入的，前 99 个更新静默丢失、version 也乱了
4. 恢复 `WHERE version` 重跑，观察：只有 1 个成功（version 0→1），其余 99 个抛 VersionConflictError

**记录**：对比"无乐观锁丢失更新"和"有乐观锁冲突可见"，写进 `docs/反证实验/Day27-反证2-乐观锁防丢失更新.md`。

### 7.6 F-3：验证 + 提交（30 分钟）

#### 7.6.1 四件套（15 分钟）

```bash
cd apps/api
pnpm run lint     # ESLint 全绿
pnpm run test     # 单元 + 集成全绿
pnpm run build    # TypeScript 编译通过
pnpm run typecheck # tsc --noEmit 通过
```

#### 7.6.2 commit（5 分钟）

```bash
git add apps/api/src/persistence apps/api/prisma/schema.prisma
git commit -m "feat(persistence): Outbox + 乐观锁 + 软删除 + 幂等

- Transactional Outbox 模式保证业务写和事件发布原子
- OutboxRelay 轮询发布，崩溃重启自动补发 pending 事件
- 乐观锁 version 防并发丢失更新，冲突 409
- 软删除 Prisma 扩展默认 scope，删除可恢复
- consumed_events 幂等闸门防重复副作用

Refs: Day27"
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day 28 结束时集中 push。

#### 7.6.3 架构证据（10 分钟）

在 `docs/architecture-evidence/` 下创建 `Day27-persistence-outbox-evidence.md`：

```markdown
# Day 27 Postgres 持久化架构证据

## 1. Outbox 事务边界证据

**时序图**：saveMessageWithOutbox 的 $transaction 边界
\`\`\`
[BFF] --(req)--> [PersistenceService.saveMessageWithOutbox]
         |
         BEGIN TX
         |
      message.create  ← 步骤 1
         |
      outbox.writeInTx ← 步骤 2（同一个 tx）
         |
         COMMIT (原子)
         |
      [OutboxRelay 轮询] --(200ms)--> fetchPending -> emit -> markPublished
\`\`\`

**证据文件**：
- `persistence.service.ts:15-30`（事务包裹）
- `outbox.repository.ts:12-20`（writeInTx 接收 tx 参数）
- 反证实验 1 截图：v1 COMMIT 后崩溃 → 事件丢；v3 重启后 relay 补发

## 2. 乐观锁原子性证据

**SQL 日志**：
\`\`\`sql
UPDATE diagnosis SET summary='new', version=version+1, updated_at=now()
WHERE id='d-01' AND version=3;
-- 返回 count=0 说明 version 已变（被别人先改了）
\`\`\`

**证据文件**：
- `persistence.service.ts:40-55`（updateMany WHERE version）
- `optimistic-lock.spec.ts`（单元穷举）
- 反证实验 2：100 并发验证"无锁 → 丢失更新，有锁 → 99 个 409"

## 3. 软删除默认 scope 证据

**Prisma 扩展拦截日志**：
\`\`\`typescript
// 业务代码写：
prisma.conversation.findMany({ where: { userId: 'u1' } })
// 扩展改写为：
prisma.conversation.findMany({ where: { userId: 'u1', deletedAt: null } })
\`\`\`

**证据文件**：
- `soft-delete.extension.ts:8-15`（query 拦截注入）
- `soft-delete.spec.ts`（普通查询查不到、手动过滤能查到）
\`\`\`
```

记录每个证据对应的文件 + 行号 + 反证实验截图路径。

---

## 8. 通过标准

Day 27 通过门槛：

- [ ] 四件套全绿，commit 含 `Refs: Day27`，未执行 `git push`
- [ ] `persistence.service.ts` 的 saveMessageWithOutbox 事务边界正确（message + outbox 同 tx）
- [ ] OutboxRelay 启动后能轮询发布，崩溃重启后能重扫 pending 补发
- [ ] updateDiagnosis 带 WHERE version，100 并发验证只有 1 个成功其余 409
- [ ] 软删除后普通查询查不到，手动过滤 `deletedAt: { not: null }` 能查到
- [ ] DiagnosisConsumer 对重复 __outboxId 幂等，同一事件消费两次只生成一条诊断
- [ ] 反证实验 1（COMMIT 后崩溃）和反证实验 2（去掉 WHERE version）完成并记录
- [ ] 架构证据文档包含事务边界时序图 + SQL 日志 + 反证截图路径

**如果任一项未通过**，Day 27 视为未完成，Day 28 不得开始。

---

## 9. 提交物

1. commit（含 `Refs: Day27`，未执行 `git push`）
2. 测试输出（`pnpm --filter api test persistence` 截图）
3. 反证实验记录（`docs/反证实验/Day27-反证1-outbox崩溃恢复.md` + `Day27-反证2-乐观锁防丢失更新.md`）
4. 架构证据（`docs/architecture-evidence/Day27-persistence-outbox-evidence.md`）
5. 学习日志（回答 §10 三道核心问题）

---

## 10. 课末 3 个核心问题

完成 Day 27 后，先回答这 3 个问题，再提交给教师进入五连问：

1. **数据流与知识链对应**
   请从今天项目的真实入口（BFF 收齐模型回答）到最终输出（Diagnosis 生成），解释"Postgres 持久化"的数据流或控制流；当天知识链"ACID、隔离级别、乐观锁、Outbox、软删除"分别在哪一层起作用，为什么按这个顺序学习？

   **参考答案骨架**（自己填血肉）：
   - ACID：`$transaction` 包 message + outbox 写，保证原子
   - Outbox：解决 ACID 后下一个问题——"事务外的消息发送"怎么可靠？答案是把事件也写进事务
   - 隔离级别：理解为什么"先读后写"模式会丢失更新，引出乐观锁
   - 乐观锁：解决并发更新，WHERE version 在 ReadCommitted 下也安全
   - 软删除：业务需要"删除可恢复"，技术上要防查询泄漏

2. **移除关键保护的可观察现象**
   如果故意移除今天最关键的保护机制（Outbox 同事务 / 乐观锁 WHERE version / 软删除默认 scope），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

   **参考答案骨架**（选一个机制展开）：
   - 移除 Outbox 同事务 → 现象：前端显示"回答已保存"，但诊断永远不生成
   - 最小复现：COMMIT 后 kill 进程
   - 定位证据：Message 表有记录、Outbox 表空、消费者日志无 message.created
   - 恢复动作：手动补发事件 / 重跑 Outbox
   - 防复发测试：集成测试注入崩溃点，断言 relay 重启后能补发

3. **项目目标达成与演进方向**
   请引用今天的具体代码、测试和架构证据，证明项目目标（"前端显示的一定进库、库里的一定发事件、并发不丢更新、删除可恢复"）已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

   **参考答案骨架**：
   - 已达到：persistence.service.ts:15-30 事务边界 + outbox-relay.spec.ts 补发测试 + optimistic-lock 100 并发验证 + 反证实验截图
   - 还缺：Outbox 无归档（表无限膨胀）；relay 单进程（吞吐受限）；消费端无重试（失败就丢）；软删除 30 天清理未实现
   - 演进方向：Day 28 M3 门禁补归档策略；阶段三上 Kafka 后 relay 换 producer.send、消费端加重试队列；合同不变（Outbox 记录结构 + version 语义稳定）

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **Message 已提交，但 Outbox 插入失败；UI 已展示内容，事件消费者永远收不到。**
   请用事务日志、Outbox 表和消费位点定位双写裂缝；先扫描并补发缺失事件止损，再把业务写与 Outbox 放入同一事务，崩溃点注入验证无"已展示未发布"。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

2. **两个请求基于同一 version 更新 Diagnosis，一个静默覆盖另一个；软删除记录又被普通查询返回。**
   请用隔离级别、版本号、SQL 和审计定位；先启用冲突告警/过滤止损，再实现乐观锁与默认 scope，100 并发更新验证冲突可见且无丢失更新。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

知识映射：ACID、隔离级别、乐观锁、Outbox 和软删除。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. **数据库事务的 ACID 特性是什么？**
   来源：[《2026美团前端全栈开发》](../../资源/2026美团前端全栈开发.pdf)，第 9 页。

2. **如何保证 Redis 与 MySQL 的数据一致性？**
   来源：[《2026美团前端全栈开发》](../../资源/2026美团前端全栈开发.pdf)，第 10 页。

题目说明：对应事务、一致性、并发更新和双写风险；资料中无 Outbox 直接原题，答题时需补充 Outbox 与重复消费幂等。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

Day 27 交付的 **Outbox 一致性合同**、**乐观锁 version 语义**、**软删除 deletedAt 合同** 是后续 Day 的地基：

- **Day 28-30 M3 门禁**：数据一致性验收项要求"任一写入失败必须全回滚"（事务边界）、"并发更新冲突可见"（乐观锁）、"删除数据可恢复"（软删除）
- **阶段三 p2-agent-workbench**：多 Agent 并发写共享状态（计划、决策、执行记录）时，乐观锁防丢失更新是刚需；Outbox 保证"Agent A 的决策已落库、下游 Agent B 一定能收到通知"
- **Day 61+ Eval 自动评分**：Eval 结果写入后必须发 `eval.completed` 事件触发排行榜更新——Outbox 保证"结果进库就一定上榜"，不会有"考完了分数不见"

今天建立的"事务内写 Outbox + relay 异步发布 + 消费端幂等"三段式模式，会在后续每个需要可靠事件发布的场景复用；version 字段和 WHERE version 的 CAS 更新会成为所有可并发编辑实体的标配；软删除 + 默认 scope 会推广到所有需要"删除可恢复"的模型。这三块是 AI 全栈工程师在生产环境"保证数据不丢、不乱、可恢复"的核心武器。
