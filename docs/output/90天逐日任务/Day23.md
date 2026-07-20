# Day 23：数据建模（v1 裸表无索引 → v2 复合索引 + 游标分页 → v3 聚合边界 + 保留策略 + 可回滚迁移）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-05 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 22 API 合同治理、第一次要把 Agent 诊断"会话"落成可查询、可分页、可迁移的持久化模型的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-20：前端 Agent UI + 后端 Agent Loop + 持久化 + 生产演练 + 毕业考

阶段二（Day 21-40）：AI 前端 → AI 全栈（当前阶段）
   项目：p1-monitor 后端深化（NestJS 架构 + 数据建模 + RAG）
   Day 21：NestJS 架构深化（模块边界 + DI scope）
   Day 22：API 合同（DTO + OpenAPI + 版本兼容）
   Day 23：数据建模（Conversation/Message/Citation 聚合 + 索引 + 迁移）  ← 今天在这里
   Day 24-30：RAG 检索 + 向量库 + M3 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 23 在阶段一第 3 天**。Day 13 已经把单次 Agent Run 落了库（AgentRun/Diagnosis/ToolCall），但那是"一次运行"的记录。今天要建立**"会话"这个更高层的聚合**：一个运维工程师和 Agent 的多轮对话（Conversation），每轮是一条 Message，每条诊断结论挂着若干 Citation（引用证据），所有会话归属某个 User。这是 RAG（Day 24+）和多轮对话记忆的数据地基。

### 到 Day 22 结束时项目已具备的能力

- **Agent Loop + 持久化**（Day 12-13）：单次 Run 落库，幂等键、事务边界、执行状态、崩溃恢复
- **NestJS 架构**（Day 21）：模块边界清晰，Ports/Adapters 解耦，DI scope 隔离租户
- **API 合同**（Day 22）：统一 Error DTO、OpenAPI、版本兼容策略、消费者合同测试
- **缺失的一块**：没有"会话"概念。每次诊断都是孤立的 Run，无法回看"这个工程师上周问过什么"、无法在多轮对话里让 Agent 记住上下文、诊断报告里的 `[1][2]` 引用没有落库成可查询的 Citation 实体

### 今天要解决的 4 个问题

1. **问题 1：没有会话聚合，多轮对话无法组织**
   运维工程师今天问"srv-042 为什么 CPU 高"，明天追问"那昨天那个问题解决了吗"——这两次是同一个会话的两轮，但 Day 13 的数据模型里它们是两条毫无关联的 AgentRun。**必须引入 Conversation 聚合根**，把多轮 Message 组织进同一个会话。

2. **问题 2：大会话查询全表扫描，打开要 9 秒**
   一个活跃会话可能积累 50 万条 Message（长期运维对话 + 每轮多个中间事件）。如果 `SELECT * FROM messages WHERE conversation_id = ?` 没有索引，Postgres 全表扫描；如果用 `OFFSET 100000 LIMIT 20` 分页，越翻到后面越慢（OFFSET 要跳过前面所有行）。**必须设计复合索引 + Cursor（游标）分页**。

3. **问题 3：引用证据（Citation）没有落库，无法追溯**
   Day 16 前端把诊断报告的 `[1][2]` 渲染成可点击引用，但那只是前端解析。后端没有 Citation 实体，无法回答"这条结论到底引用了哪条 Metric/Alert/ToolCall"。**必须把 Citation 建模成独立实体，用外键关联 Message 和证据来源**。

4. **问题 4：迁移不可回滚，保留策略缺失**
   加一张表、改一个字段，如果 migration 只有 up 没有 down，线上出问题无法回滚。而且会话数据无限增长——90 天前的会话还要留在热表里吗？**必须写可回滚的 up/down migration + 定义保留策略（归档/删除边界）**。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`ConversationModule`**：把 Agent 诊断会话建模成 Conversation（聚合根）→ Message（每轮）→ Citation（引用证据）三级聚合，归属 User；用复合索引 + Cursor 分页支撑大会话的高效查询；用可回滚的 up/down migration 管理 schema 变更；用保留策略界定会话数据的生命周期。

### 1.1 用户能看到什么

**场景**：运维工程师打开"我的诊断历史"页面，查看与 Agent 的多轮会话记录。某个高频会话已经积累了 50 万条 Message。

```
用户操作：GET /conversations?userId=u-01&limit=20

响应（第一页，游标分页）：
{
  "conversations": [
    {
      "id": "c-01",
      "title": "srv-042 CPU 异常排查",
      "messageCount": 512340,
      "lastMessageAt": "2026-08-05T14:30:00Z",
      "createdAt": "2026-07-01T09:00:00Z"
    },
    ... 19 more
  ],
  "nextCursor": "eyJsYXN0TWVzc2FnZUF0IjoiMjAyNi0wOC0wMVQxMDowMDowMFoiLCJpZCI6ImMtMjEifQ==",
  "hasMore": true
}

用户点开 c-01，加载最近 20 条 Message：
GET /conversations/c-01/messages?limit=20（不带 cursor = 最新一页）

响应：
{
  "messages": [
    {
      "id": "m-512340",
      "role": "assistant",
      "content": "srv-042 在 14:28-14:30 CPU 持续超过 95% [1]，触发告警 [2]",
      "citations": [
        { "index": 1, "sourceType": "metric", "sourceId": "metric-88123", "snippet": "cpu=96.8% @14:29" },
        { "index": 2, "sourceType": "alert", "sourceId": "alert-a123", "snippet": "threshold=90 duration=5min" }
      ],
      "createdAt": "2026-08-05T14:30:04Z"
    },
    ... 19 more（按 createdAt 倒序）
  ],
  "nextCursor": "...",   // 用于向上翻更早的历史
  "hasMore": true
}

关键：即使会话有 50 万条 Message，这次查询走
  idx_messages_conversation_created (conversation_id, created_at DESC)
  → explain 显示 Index Scan，命中 20 行即停，P95 < 50ms
```

**用户观察到的最终结果**：
- 会话列表按 `lastMessageAt` 倒序，游标翻页无论翻到多少页都是同样速度（不随 OFFSET 增大而变慢）
- 打开 50 万条 Message 的会话，首屏只加载最近 20 条，< 50ms
- 每条 assistant 消息的引用可以追溯到真实的 metric/alert/toolCall 证据
- DBA 执行 `EXPLAIN` 能看到所有关键查询走索引，无全表扫描

### 1.2 这个模块在项目里承担什么

- **输入**：Day 13 的 AgentRun 完成后，把这轮对话的 user 提问 + assistant 回复 + 引用证据写入 Conversation/Message/Citation；前端的历史查询请求
- **输出**：可分页查询的会话列表、单会话的消息流（游标分页）、每条消息的引用证据链；可回滚的数据库迁移
- **对齐后续**：今天定义的 **Conversation 聚合边界** 是 Day 24-30 RAG 的检索单元（"在这个会话的历史里检索相关上下文"）、Day 31+ 多 Agent 协同的对话存储层地基。Citation 实体是 Day 16 前端引用渲染的后端真相来源

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | Conversation/Message/Citation 三张裸表，OFFSET 分页，无索引 | 单 schema + 基础 CRUD service | Prisma model、外键关系、基础 findMany |
| **v1 痛点** | 50 万条 Message 全表扫描 9 秒；OFFSET 深分页越翻越慢；迁移只有 up 无法回滚 |  |  |
| **v2** | v1 + **复合索引** + **Cursor 游标分页** | 拆出 `cursor/cursor-codec.ts` + 索引 migration | 复合索引设计、B-Tree 原理、游标编解码、keyset pagination |
| **v2 痛点** | 聚合边界不清（Message 无限增长塞在一张表）；无保留策略；并发写 Citation 产生孤儿；迁移未演练 down |  |  |
| **v3** | v2 + **聚合边界**（Conversation 冗余计数） + **外键约束 + 保留策略** + **可回滚 up/down migration** | 完整分层（aggregate/repository/retention/migration） | 聚合根设计、冗余字段与一致性、外键 onDelete、保留/归档策略、可回滚迁移演练 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：数据建模涉及多个关注点（Prisma schema、聚合边界、游标编解码、仓储层、保留策略、可回滚迁移），如果不先在脑子里立起骨架，写到一半就会把"游标编码"塞进 controller、把"保留策略"写成散落各处的 `deleteMany`、把"聚合一致性"（messageCount 冗余字段）交给业务代码手动维护而漏更新。看完这棵树，下面章节再出现 `src/conversation/cursor/cursor-codec.ts` 时，你就能立刻定位它的职责。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── conversation/                              ← 【新增】会话建模模块
│   ├── aggregate/
│   │   ├── conversation.aggregate.ts          ← Conversation 聚合根（含 messageCount 一致性规则）
│   │   ├── message.entity.ts                  ← Message 实体
│   │   ├── citation.entity.ts                 ← Citation 实体
│   │   └── conversation.aggregate.spec.ts     ← 聚合根不变量单元测试
│   ├── cursor/
│   │   ├── cursor-codec.ts                     ← 游标编解码（纯函数，base64 + 校验）
│   │   └── cursor-codec.spec.ts                ← 游标编解码单元测试
│   ├── repository/
│   │   ├── conversation.repository.ts          ← 会话仓储（游标分页查询）
│   │   └── message.repository.ts               ← 消息仓储（游标分页 + 批量写）
│   ├── retention/
│   │   ├── retention-policy.ts                  ← 保留策略（纯函数，判定归档/删除边界）
│   │   └── retention-policy.spec.ts             ← 保留策略单元测试
│   ├── conversation.service.ts                 ← 业务编排层
│   ├── conversation.controller.ts              ← HTTP 入口
│   ├── conversation.module.ts                  ← NestJS 模块
│   └── index.ts                                ← 桶文件
├── prisma/
│   ├── schema.prisma                           ← 【已有】新增 Conversation/Message/Citation
│   └── migrations/
│       └── 20260805120000_add_conversation/    ← 【新增】可回滚 migration
│           ├── migration.sql                    ← up
│           └── down.sql                         ← down（手动维护回滚脚本）
└── main.ts
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `schema.prisma` | 3 张裸表，无索引 | + 复合索引 `@@index` | + 外键 onDelete + messageCount 冗余字段 |
| `cursor/cursor-codec.ts` | ✗（用 OFFSET） | ✓ base64 游标编解码 | ✓ 同 v2 + 防篡改校验 |
| `repository/*.repository.ts` | ✗（service 直接 prisma） | ✓ keyset 分页 | ✓ 同 v2 + 聚合计数维护 |
| `aggregate/conversation.aggregate.ts` | ✗ | ✗ | ✓ 聚合根 + messageCount 不变量 |
| `retention/retention-policy.ts` | ✗ | ✗ | ✓ 归档/删除边界纯函数 |
| `migrations/.../down.sql` | ✗（只有 up） | ✗ | ✓ 可回滚 down 脚本 |

**依赖方向（务必单向，反过来一次都不行）**：

```
conversation.controller.ts
        │
        ▼
conversation.service.ts
        │
        ├─► repository/conversation.repository.ts ──► prisma
        │           │
        │           └─► cursor/cursor-codec.ts（纯函数）
        │
        ├─► repository/message.repository.ts ──► prisma
        │
        ├─► aggregate/conversation.aggregate.ts（纯领域对象）
        │
        └─► retention/retention-policy.ts（纯函数）

aggregate/*.ts       ← 纯领域对象，不 import prisma
cursor-codec.ts      ← 纯函数，不 import prisma
retention-policy.ts  ← 纯函数，不 import prisma、不 import Date.now（时间从参数传入）
```

**红线**：
- `aggregate/conversation.aggregate.ts` 里出现 `import { PrismaService }` 就是架构塌方——聚合根描述领域不变量，不知道存储
- `cursor/cursor-codec.ts` 里出现 `import { PrismaService }` 是塌方——游标编解码是纯函数，必须能脱离 DB 单测
- `retention-policy.ts` 里出现 `new Date()` 是塌方——保留策略的"现在时间"必须从参数传入，否则无法单测边界
- `conversation.controller.ts` 里直接 `prisma.message.findMany()` 是塌方——绕过仓储层，游标分页逻辑会散落

**动手前先问自己 3 个问题**：

1. 为什么用 Cursor 分页而不是 OFFSET？—— 见 §5.4 知识点 2「游标分页 vs OFFSET 分页」
2. `messageCount` 为什么要冗余存在 Conversation 上而不是每次 `COUNT(*)`？—— 见 §5.4 知识点 3「冗余字段与聚合一致性」
3. 保留策略为什么是纯函数？—— 见 §5.4 知识点 6「保留策略的可测试性」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认前置依赖（3 分钟）

按第 5.3 节的代码：

- 项目已有 `@prisma/client` ≥ 5.0 和 `prisma`（Day 07/13 装的）
- 本地 Postgres 里已有 Day 13 的 AgentRun/Diagnosis/ToolCall 表
- Day 23 不需要新增运行时依赖；游标编解码用 Node 内置的 `Buffer` 做 base64

**边写边问自己**：

- 为什么游标不用第三方库（如 `graphql-relay`）？（keyset 游标本质就是"把上一页最后一行的排序键 base64 编码"，几十行纯函数，引第三方反而增加合同耦合）
- Prisma 支持原生 cursor 吗？（支持 `cursor` + `skip: 1`，但它是"跳到某个 id 之后"，我们要基于 `(created_at, id)` 复合键，需要手写 `where` 条件——见 §5.3）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `apps/api/src/conversation/` 下建 4 个子目录：

```
conversation/
├── aggregate/      ← 聚合根 + 实体（纯领域）
├── cursor/         ← 游标编解码（纯函数）
├── repository/     ← 仓储层（游标分页查询）
└── retention/      ← 保留策略（纯函数）
```

**边写边问自己**：

- 为什么 `aggregate/` 和 `repository/` 分开？（aggregate 描述"会话的领域不变量"，repository 描述"如何从 DB 高效取数"；分开才能各自单测、各自演进）
- 为什么 `cursor/` 单独一层而不是塞进 repository？（游标编解码是纯函数，无 DB 依赖，可复用到任何需要分页的地方；单独一层强调"这是与存储无关的纯逻辑"）

### 1.5.3 D-3：改 Prisma Schema + 生成 migration（5 分钟）

按第 5.3 节的代码：

- 修改 `apps/api/prisma/schema.prisma`：新增 `Conversation` / `Message` / `Citation` 三个 model，加复合索引和外键
- 运行 `pnpm --filter api prisma migrate dev --name add_conversation`
- 手动补写 `down.sql`（Prisma 不自动生成回滚脚本）

**边写边问自己**：

- 复合索引 `(conversation_id, created_at DESC)` 为什么这个字段顺序？（等值查询字段在前、范围/排序字段在后——B-Tree 最左前缀原则，见 §5.4 知识点 1）
- `onDelete: Cascade` vs `onDelete: Restrict` 怎么选？（Citation 依附 Message，Message 删则 Citation 删 → Cascade；但 Message 依附的 metric/alert 不能因为 Message 删就删 → 那是外部引用，不设外键或设 Restrict）
- 为什么要手写 down.sql？（Prisma migrate 只生成 up；生产回滚需要 down；不写 down 的迁移 = 不可回滚 = 上线事故无退路）

### 1.5.4 D-4：写 aggregate + cursor + retention（纯逻辑，8 分钟）

按第 5.3 节的代码：

- 写 `aggregate/conversation.aggregate.ts`（聚合根 + `addMessage` 维护 messageCount 不变量）
- 写 `aggregate/message.entity.ts` / `citation.entity.ts`
- 写 `cursor/cursor-codec.ts`（`encodeCursor` / `decodeCursor` 纯函数）
- 写 `cursor/cursor-codec.spec.ts`
- 写 `retention/retention-policy.ts`（`classifyConversation(conv, now)` 纯函数）
- 写 `retention/retention-policy.spec.ts`

**边写边问自己**：

- 聚合根的 `addMessage` 为什么要同时更新 `messageCount` 和 `lastMessageAt`？（这两个字段是"派生自 Message 列表"的冗余，聚合根负责保证它们和实际 Message 一致——这就是聚合的不变量）
- 游标编码为什么要加校验（如 HMAC 或至少格式校验）？（游标暴露在 URL 里，用户可能篡改；解码时要能识别非法游标并 fallback 到第一页，而不是 SQL 报错）
- 保留策略 `classifyConversation` 的 `now` 为什么是参数？（纯函数——测试"90 天前的会话应归档"时，直接传一个固定的 now，不依赖系统时钟）

### 1.5.5 D-5：写 repository + service + controller（后端集成，2 分钟）

按第 5.3 节的代码：

- 写 `repository/conversation.repository.ts`（游标分页 findMany）
- 写 `repository/message.repository.ts`（游标分页 + 批量写 Message+Citation 事务）
- 写 `conversation.service.ts`（业务编排）
- 写 `conversation.controller.ts`（HTTP 入口）
- 写 `conversation.module.ts`（NestJS 模块）

**边写边问自己**：

- 仓储层的游标分页查询，`where` 条件长什么样？（`created_at < cursor.createdAt OR (created_at = cursor.createdAt AND id < cursor.id)`——用 `(created_at, id)` 复合键做 keyset，见 §5.3）
- 批量写 Message + Citation 为什么要用事务？（一条 assistant Message 和它的 N 条 Citation 必须原子写入，否则出现"消息有了但引用丢了"或"引用指向不存在的消息"）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 30 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"裸表→加索引游标→聚合边界+保留策略"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `cursor-codec.ts` 和 `message.repository.ts` 的 keyset where 条件 | 能口述"游标分页的 where 怎么写"、"messageCount 冗余怎么保持一致" |
| C：读深挖 | 30 min | §6.5 前端底子补弱（`Day23深挖-前端底子补弱.html`） | 能回答"前端无限滚动如何配合后端游标分页" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个 spec 文件（aggregate/cursor/retention） | `pnpm --filter api test conversation` 全绿 |
| F-1：反证 1 | 5 min | §7.7 删掉复合索引，`EXPLAIN` 看全表扫描 | 观察 Seq Scan，验证"没有索引是什么样子" |
| F-2：反证 2 | 5 min | §7.8 用 OFFSET 深分页 vs 游标分页对比耗时 | 观察 OFFSET 越翻越慢，验证游标分页的价值 |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + up/down migration 演练 + commit | commit 含 `Refs: Day23` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（三张裸表 + OFFSET 分页）

### 3.1 v1 要实现什么

把 Agent 诊断会话落成 Conversation/Message/Citation 三张表，能写入、能按会话查消息。分页用最直觉的 `OFFSET/LIMIT`。

**目标**：
- `POST /conversations` 创建会话
- Agent Run 完成后写入一条 user Message + 一条 assistant Message（含 Citation）
- `GET /conversations/:id/messages?page=N` 按页查消息

**不做**：
- 不加索引（暴露全表扫描）
- 不用游标（用 OFFSET，暴露深分页慢）
- 不写 down migration（暴露不可回滚）
- 不维护 messageCount（每次 COUNT）

### 3.2 v1 目录结构

```
apps/api/src/conversation/
├── conversation.service.ts        ← 直接用 prisma，OFFSET 分页
├── conversation.controller.ts
└── conversation.module.ts
apps/api/prisma/
└── schema.prisma                  ← 3 张裸表，无索引
```

### 3.3 v1 完整代码

**apps/api/prisma/schema.prisma（v1 增量）**

```prisma
model Conversation {
  id            String    @id @default(cuid())
  userId        String
  title         String
  createdAt     DateTime  @default(now())

  messages      Message[]
}

model Message {
  id              String        @id @default(cuid())
  conversationId  String
  conversation    Conversation  @relation(fields: [conversationId], references: [id])
  role            String        // "user" | "assistant"
  content         String        @db.Text
  createdAt       DateTime      @default(now())

  citations       Citation[]
}

model Citation {
  id           String   @id @default(cuid())
  messageId    String
  message      Message  @relation(fields: [messageId], references: [id])
  index        Int      // 报告里的 [1] [2]
  sourceType   String   // "metric" | "alert" | "toolCall"
  sourceId     String
  snippet      String   @db.Text
}
```

**apps/api/src/conversation/conversation.service.ts（v1 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async createConversation(userId: string, title: string): Promise<string> {
    const conv = await this.prisma.conversation.create({
      data: { userId, title },
    })
    return conv.id
  }

  async appendTurn(
    conversationId: string,
    userContent: string,
    assistantContent: string,
    citations: { index: number; sourceType: string; sourceId: string; snippet: string }[],
  ): Promise<void> {
    // v1：user 和 assistant 两条 Message 分开写，无事务
    await this.prisma.message.create({
      data: { conversationId, role: 'user', content: userContent },
    })
    const assistantMsg = await this.prisma.message.create({
      data: { conversationId, role: 'assistant', content: assistantContent },
    })
    for (const c of citations) {
      await this.prisma.citation.create({
        data: { messageId: assistantMsg.id, ...c },
      })
    }
  }

  // v1：OFFSET 分页
  async getMessages(conversationId: string, page: number, pageSize = 20) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      skip: page * pageSize,       // ← OFFSET：深分页会越来越慢
      take: pageSize,
      include: { citations: true },
    })
    // v1：每次都 COUNT 全表
    const total = await this.prisma.message.count({ where: { conversationId } })
    return { messages, total, page }
  }

  // v1：列表也用 OFFSET
  async listConversations(userId: string, page: number, pageSize = 20) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: page * pageSize,
      take: pageSize,
    })
  }
}
```

**apps/api/src/conversation/conversation.controller.ts（v1 全文）**

```typescript
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common'
import { ConversationService } from './conversation.service'

@Controller('conversations')
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  @Post()
  async create(@Body() body: { userId: string; title: string }) {
    const id = await this.service.createConversation(body.userId, body.title)
    return { id }
  }

  @Get()
  async list(@Query('userId') userId: string, @Query('page') page = '0') {
    return this.service.listConversations(userId, Number(page))
  }

  @Get(':id/messages')
  async messages(@Param('id') id: string, @Query('page') page = '0') {
    return this.service.getMessages(id, Number(page))
  }
}
```

**apps/api/src/conversation/conversation.module.ts（v1 全文）**

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { ConversationService } from './conversation.service'
import { ConversationController } from './conversation.controller'

@Module({
  imports: [PrismaModule],
  providers: [ConversationService],
  controllers: [ConversationController],
  exports: [ConversationService],
})
export class ConversationModule {}
```

### 3.4 v1 暴露的痛点

**痛点 1：无索引，大会话查询全表扫描**

`getMessages` 里 `where: { conversationId }` 没有索引。当 Message 表有 50 万行时，Postgres 对每次查询做 Seq Scan（顺序扫描全表），`EXPLAIN` 显示 `Seq Scan on messages`，耗时 9 秒。用户打开会话卡死。

**痛点 2：OFFSET 深分页越翻越慢**

`skip: page * pageSize` 翻译成 SQL 的 `OFFSET`。翻到第 1000 页（`OFFSET 20000`）时，Postgres 要先扫描并丢弃前 20000 行才能取到目标 20 行。越往后翻越慢，且 `OFFSET` 期间如果有新消息插入，还会导致翻页错位（同一条消息出现两次或漏掉）。

**痛点 3：每次 COUNT 全表**

`getMessages` 里的 `prisma.message.count()` 在大表上也是全表扫描。列表页要显示 messageCount，v1 每次请求都 COUNT 一次 50 万行，雪上加霜。

**痛点 4：无事务，Citation 可能成孤儿**

`appendTurn` 里 assistant Message 和 Citation 分开写、无事务。如果写完 Message、写 Citation 时进程崩溃，就出现"消息有了但引用丢了"；如果并发写，还可能出现引用指向的 Message 已被回滚。

**痛点 5：迁移不可回滚**

`prisma migrate dev` 只生成 up 脚本（`CREATE TABLE`）。线上如果发现这次建模有问题要回滚，没有 down 脚本，只能手动 `DROP TABLE`——风险极高且无演练。

---

## 4. v2：加复合索引 + 游标分页

### 4.1 v2 要实现什么

用户视角：50 万行的会话，打开首屏 < 200ms；无限滚动往下翻永远保持同样的速度，不因翻到深处变慢；翻页期间有新消息插入也不错位。

**目标**：
- Message 表加复合索引 `(conversationId, createdAt, id)`
- 分页从 OFFSET 改成 keyset 游标（基于 `(createdAt, id)` 复合键）
- 游标编解码抽成独立纯函数 `cursor-codec.ts`

**依然不做**：
- 不维护 messageCount 冗余（还是 COUNT，但已经借索引快很多）
- 不写 down migration
- 不做保留策略 / 聚合边界

### 4.2 v2 目录结构

```
apps/api/src/conversation/
├── cursor/
│   ├── cursor-codec.ts            ← 新增：游标编解码纯函数
│   └── cursor-codec.spec.ts       ← 新增：编解码单元测试
├── conversation.service.ts        ← 改：游标分页
├── conversation.controller.ts     ← 改：接收 cursor 参数
└── conversation.module.ts
apps/api/prisma/
└── schema.prisma                  ← 加复合索引
```

### 4.3 v2 完整代码

**apps/api/prisma/schema.prisma（v2 增量：加索引）**

```prisma
model Message {
  id              String        @id @default(cuid())
  conversationId  String
  conversation    Conversation  @relation(fields: [conversationId], references: [id])
  role            String
  content         String        @db.Text
  createdAt       DateTime      @default(now())

  citations       Citation[]

  // v2 新增：复合索引，支撑 keyset 游标分页
  // 字段顺序：等值查询字段(conversationId) → 排序字段(createdAt, id)
  @@index([conversationId, createdAt, id])
}

model Conversation {
  id            String    @id @default(cuid())
  userId        String
  title         String
  createdAt     DateTime  @default(now())

  messages      Message[]

  // v2 新增：列表页按 userId 查 + createdAt 排序
  @@index([userId, createdAt, id])
}
```

**apps/api/src/conversation/cursor/cursor-codec.ts（v2 全文）**

```typescript
/**
 * Keyset 游标：把"上一页最后一行的排序键"编码成不透明字符串。
 * 排序键 = (createdAt, id) 复合键——createdAt 可能重复，用 id 兜底保证唯一有序。
 *
 * 纯函数：不依赖 DB、不依赖时钟。
 */

export type Cursor = {
  createdAt: string   // ISO 时间戳
  id: string
}

/** 把游标编码成 base64url 字符串（放进 URL query） */
export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify([cursor.createdAt, cursor.id])
  return Buffer.from(json, 'utf-8').toString('base64url')
}

/**
 * 解码游标。非法游标（篡改、格式错）返回 null，
 * 调用方 fallback 到第一页，而不是抛 SQL 错误。
 */
export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf-8')
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [createdAt, id] = parsed
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null
    // 校验 createdAt 是合法 ISO 时间
    if (Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, id }
  } catch {
    return null
  }
}
```

**apps/api/src/conversation/cursor/cursor-codec.spec.ts（v2 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor } from './cursor-codec'

describe('cursor-codec', () => {
  it('编码再解码得到原值（round-trip）', () => {
    const cursor = { createdAt: '2026-08-05T10:00:00.000Z', id: 'msg-123' }
    const encoded = encodeCursor(cursor)
    const decoded = decodeCursor(encoded)
    expect(decoded).toEqual(cursor)
  })

  it('编码结果是 URL 安全的（无 + / =）', () => {
    const encoded = encodeCursor({ createdAt: '2026-08-05T10:00:00.000Z', id: 'a/b+c' })
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('undefined/null 返回 null（fallback 第一页）', () => {
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  it('被篡改的乱码游标返回 null 而不是抛错', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull()
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'))).toBeNull()
  })

  it('非法时间戳返回 null', () => {
    const bad = Buffer.from(JSON.stringify(['not-a-date', 'id']), 'utf-8').toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })
})
```

**apps/api/src/conversation/conversation.service.ts（v2 关键方法）**

```typescript
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { encodeCursor, decodeCursor } from './cursor/cursor-codec'

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  // v2：keyset 游标分页
  async getMessages(conversationId: string, rawCursor?: string, pageSize = 20) {
    const cursor = decodeCursor(rawCursor)

    // keyset where：createdAt 更早，或 createdAt 相同但 id 更小（DESC 排序下"更旧"）
    const keysetWhere: Prisma.MessageWhereInput = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : {}

    // 多取一条判断是否还有下一页
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...keysetWhere },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      include: { citations: true },
    })

    const hasMore = rows.length > pageSize
    const messages = hasMore ? rows.slice(0, pageSize) : rows
    const last = messages[messages.length - 1]
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null

    return { messages, nextCursor, hasMore }
  }
}
```

**apps/api/src/conversation/conversation.controller.ts（v2 关键方法）**

```typescript
  @Get(':id/messages')
  async messages(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    // v2：cursor 而不是 page
    return this.service.getMessages(id, cursor)
  }
```

### 4.4 v2 暴露的痛点

**痛点 1：messageCount 每次都 COUNT**

虽然加了索引让 COUNT 从 9 秒降到几百毫秒，但列表页展示 N 个会话、每个会话都要 COUNT 一次消息数，仍然是 N 次聚合查询。会话列表加载慢。应该把 messageCount 冗余到 Conversation 表，写消息时增量更新。

**痛点 2：没有聚合边界，业务不变量散落**

"一条 assistant Message 必须原子地带着它的 Citation 一起写入"、"messageCount 必须等于实际 Message 数"这些不变量，v2 散落在 service 各处，容易被后来的代码破坏（比如某个新接口只写 Message 不更新 count）。需要用聚合根把不变量收拢。

**痛点 3：迁移仍不可回滚**

加索引的 migration 仍然只有 up。加索引本身在大表上是重操作（Postgres 默认 `CREATE INDEX` 会锁表），需要 `CREATE INDEX CONCURRENTLY`，且必须有对应的 `DROP INDEX` down 脚本以便回滚。

**痛点 4：没有保留策略**

Conversation 无限增长。50 万条消息的会话永远留在热表里，即使那是一年前的会话没人再看。需要保留策略：超过一定时间的会话归档到冷存储或标记 archived，热表只留活跃数据。

---

## 5. v3：聚合边界 + 保留策略 + 可回滚迁移（终态）

### 5.1 v3 要实现什么

用户视角：
1. 会话列表 < 100ms（messageCount 冗余，不再 N 次 COUNT）
2. 单会话消息翻页无论多深都 < 200ms（keyset 游标，继承 v2）
3. 写 assistant 消息 + Citation + 更新 count 是一个原子事务，绝不出现"消息在但引用丢"或"count 对不上"
4. 迁移可以 `up` 也可以 `down`，加索引用 `CONCURRENTLY` 不锁表
5. 超过保留期的会话被标记 `archived`，热查询默认不扫描归档数据

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/conversation/
├── aggregate/
│   ├── conversation.aggregate.ts        ← 新增：聚合根（收拢不变量）
│   ├── conversation.aggregate.spec.ts   ← 新增：不变量单元测试
│   └── message-invariants.ts            ← 新增：不变量纯函数
├── cursor/
│   ├── cursor-codec.ts                  ← v2 已有
│   └── cursor-codec.spec.ts             ← v2 已有
├── retention/
│   ├── retention-policy.ts              ← 新增：保留策略纯函数
│   └── retention-policy.spec.ts         ← 新增
├── conversation.service.ts              ← 改：委托聚合根 + 事务
├── conversation.controller.ts           ← v2 已有
└── conversation.module.ts
apps/api/prisma/
├── schema.prisma                        ← 加 messageCount / archivedAt / 外键 onDelete
└── migrations/
    └── 20260805120000_conversation_aggregate/
        ├── migration.sql                ← up（CONCURRENTLY 加索引）
        └── down.sql                     ← 新增：down 回滚脚本
```

### 5.3 v3 完整代码

#### 5.3.1 schema 层：schema.prisma（v3 终态）

**apps/api/prisma/schema.prisma（v3 全文关键部分）**

```prisma
model User {
  id            String         @id @default(cuid())
  email         String         @unique
  displayName   String
  createdAt     DateTime       @default(now())

  conversations Conversation[]
}

model Conversation {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title         String
  // v3 新增：冗余计数，避免列表页 N 次 COUNT
  messageCount  Int       @default(0)
  // v3 新增：保留策略——归档时间；null 表示活跃
  archivedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  messages      Message[]

  @@index([userId, createdAt, id])
  // v3 新增：活跃会话查询（archivedAt IS NULL 的部分索引）
  @@index([userId, archivedAt, updatedAt])
}

model Message {
  id              String        @id @default(cuid())
  conversationId  String
  conversation    Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role            String        // "user" | "assistant" | "system"
  content         String        @db.Text
  createdAt       DateTime      @default(now())

  citations       Citation[]

  @@index([conversationId, createdAt, id])
}

model Citation {
  id            String    @id @default(cuid())
  messageId     String
  message       Message   @relation(fields: [messageId], references: [id], onDelete: Cascade)
  // 引用的证据来源：sourceType + sourceId + 合同版本
  sourceType    String    // "tool_call" | "metric" | "alert"
  sourceId      String
  sourceVersion String    // 证据合同版本，防止 source 演进后引用漂移
  index         Int       // 报告里的 [1] [2] 编号
  createdAt     DateTime  @default(now())

  @@index([messageId, index])
  // 反查：某条证据被哪些消息引用（保留策略删除证据前检查孤儿）
  @@index([sourceType, sourceId])
}
```

#### 5.3.2 aggregate 层：message-invariants.ts

**apps/api/src/conversation/aggregate/message-invariants.ts（v3 全文）**

```typescript
/**
 * 消息写入的业务不变量——纯函数，不碰 DB。
 * 把"什么样的消息 + 引用组合是合法的"这件事，从 service 里抽出来集中定义。
 */

export type MessageDraft = {
  role: 'user' | 'assistant' | 'system'
  content: string
  citations: Array<{
    sourceType: 'tool_call' | 'metric' | 'alert'
    sourceId: string
    sourceVersion: string
    index: number
  }>
}

export type InvariantViolation = { code: string; message: string }

/**
 * 校验一条待写入消息是否满足所有不变量。
 * 返回违规列表，空数组表示合法。
 */
export function checkMessageInvariants(draft: MessageDraft): InvariantViolation[] {
  const violations: InvariantViolation[] = []

  // 不变量 1：只有 assistant 消息可以带 citation
  if (draft.role !== 'assistant' && draft.citations.length > 0) {
    violations.push({
      code: 'citation_on_non_assistant',
      message: `${draft.role} 消息不能带引用，只有 assistant 消息可以`,
    })
  }

  // 不变量 2：content 不能为空
  if (draft.content.trim().length === 0) {
    violations.push({ code: 'empty_content', message: '消息内容不能为空' })
  }

  // 不变量 3：citation 的 index 必须从 1 开始连续、不重复
  if (draft.citations.length > 0) {
    const indices = draft.citations.map((c) => c.index).sort((a, b) => a - b)
    const expected = indices.map((_, i) => i + 1)
    if (JSON.stringify(indices) !== JSON.stringify(expected)) {
      violations.push({
        code: 'citation_index_not_sequential',
        message: `引用编号必须从 1 开始连续，实际：[${indices.join(',')}]`,
      })
    }
  }

  // 不变量 4：sourceVersion 不能为空（防止引用漂移）
  for (const c of draft.citations) {
    if (!c.sourceVersion) {
      violations.push({
        code: 'missing_source_version',
        message: `引用 [${c.index}] 缺少 sourceVersion`,
      })
    }
  }

  return violations
}
```

#### 5.3.3 aggregate 层：conversation.aggregate.ts

**apps/api/src/conversation/aggregate/conversation.aggregate.ts（v3 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { checkMessageInvariants, type MessageDraft } from './message-invariants'

/**
 * Conversation 聚合根：把"写消息"这件事包成一个原子事务，
 * 保证 Message + Citation + messageCount 三者一致。
 * 外部只能通过 appendMessage 写消息，不能绕过它直接写 Message 表。
 */
@Injectable()
export class ConversationAggregate {
  constructor(private readonly prisma: PrismaService) {}

  async appendMessage(conversationId: string, draft: MessageDraft): Promise<string> {
    // 1. 先在纯函数里校验不变量（不进事务，快速失败）
    const violations = checkMessageInvariants(draft)
    if (violations.length > 0) {
      throw new Error(
        `消息不变量违规：${violations.map((v) => v.code).join(', ')}`,
      )
    }

    // 2. 原子事务：写 Message + Citation + 更新 count
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const message = await tx.message.create({
        data: {
          conversationId,
          role: draft.role,
          content: draft.content,
          citations: {
            create: draft.citations.map((c) => ({
              sourceType: c.sourceType,
              sourceId: c.sourceId,
              sourceVersion: c.sourceVersion,
              index: c.index,
            })),
          },
        },
      })

      // 增量更新冗余计数——和写消息在同一事务里，绝不会对不上
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          messageCount: { increment: 1 },
          updatedAt: new Date(),
        },
      })

      return message.id
    })
  }
}
```

#### 5.3.4 aggregate 层：conversation.aggregate.spec.ts

**apps/api/src/conversation/aggregate/conversation.aggregate.spec.ts（v3 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { checkMessageInvariants } from './message-invariants'

// 聚合根的事务行为需要集成测试（真实 DB）；
// 这里单测覆盖不变量纯函数——所有分支不碰 DB
describe('message-invariants', () => {
  const baseCitation = {
    sourceType: 'tool_call' as const,
    sourceId: 't-01',
    sourceVersion: 'v1',
    index: 1,
  }

  it('合法的 assistant 消息 + 连续引用通过', () => {
    const violations = checkMessageInvariants({
      role: 'assistant',
      content: '诊断结论 [1][2]',
      citations: [baseCitation, { ...baseCitation, sourceId: 't-02', index: 2 }],
    })
    expect(violations).toEqual([])
  })

  it('user 消息带 citation 被拒', () => {
    const violations = checkMessageInvariants({
      role: 'user',
      content: '为什么 CPU 高',
      citations: [baseCitation],
    })
    expect(violations.map((v) => v.code)).toContain('citation_on_non_assistant')
  })

  it('空 content 被拒', () => {
    const violations = checkMessageInvariants({
      role: 'assistant',
      content: '   ',
      citations: [],
    })
    expect(violations.map((v) => v.code)).toContain('empty_content')
  })

  it('引用编号跳号被拒（1,3 缺 2）', () => {
    const violations = checkMessageInvariants({
      role: 'assistant',
      content: '结论 [1][3]',
      citations: [
        { ...baseCitation, index: 1 },
        { ...baseCitation, sourceId: 't-03', index: 3 },
      ],
    })
    expect(violations.map((v) => v.code)).toContain('citation_index_not_sequential')
  })

  it('引用缺 sourceVersion 被拒', () => {
    const violations = checkMessageInvariants({
      role: 'assistant',
      content: '结论 [1]',
      citations: [{ ...baseCitation, sourceVersion: '' }],
    })
    expect(violations.map((v) => v.code)).toContain('missing_source_version')
  })
})
```

#### 5.3.5 retention 层：retention-policy.ts

**apps/api/src/conversation/retention/retention-policy.ts（v3 全文）**

```typescript
/**
 * 保留策略——纯函数，判断某个会话是否应该归档。
 * 决策只依赖会话字段和"当前时间"，不查 DB、不发请求。
 */

export type RetentionInput = {
  updatedAt: Date
  archivedAt: Date | null
  messageCount: number
}

export type RetentionConfig = {
  // 超过这么多天没更新就归档
  archiveAfterDays: number
  // 消息数超过这个阈值即使活跃也考虑冷热分离
  hotMessageLimit: number
}

export const DEFAULT_RETENTION: RetentionConfig = {
  archiveAfterDays: 90,
  hotMessageLimit: 10_000,
}

export type RetentionDecision =
  | { action: 'keep' }
  | { action: 'archive'; reason: string }

export function decideRetention(
  input: RetentionInput,
  now: Date,
  config: RetentionConfig = DEFAULT_RETENTION,
): RetentionDecision {
  // 已归档的不重复处理
  if (input.archivedAt !== null) {
    return { action: 'keep' }
  }

  const idleMs = now.getTime() - input.updatedAt.getTime()
  const idleDays = idleMs / (1000 * 60 * 60 * 24)

  if (idleDays >= config.archiveAfterDays) {
    return {
      action: 'archive',
      reason: `闲置 ${Math.floor(idleDays)} 天，超过 ${config.archiveAfterDays} 天阈值`,
    }
  }

  return { action: 'keep' }
}
```

#### 5.3.6 retention 层：retention-policy.spec.ts

**apps/api/src/conversation/retention/retention-policy.spec.ts（v3 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { decideRetention, DEFAULT_RETENTION } from './retention-policy'

describe('decideRetention', () => {
  const now = new Date('2026-08-05T00:00:00Z')

  it('闲置超 90 天的活跃会话应归档', () => {
    const decision = decideRetention(
      { updatedAt: new Date('2026-05-01T00:00:00Z'), archivedAt: null, messageCount: 100 },
      now,
    )
    expect(decision.action).toBe('archive')
  })

  it('最近更新的会话保留', () => {
    const decision = decideRetention(
      { updatedAt: new Date('2026-08-01T00:00:00Z'), archivedAt: null, messageCount: 100 },
      now,
    )
    expect(decision.action).toBe('keep')
  })

  it('已归档的会话不重复处理', () => {
    const decision = decideRetention(
      { updatedAt: new Date('2026-01-01T00:00:00Z'), archivedAt: new Date('2026-04-01T00:00:00Z'), messageCount: 100 },
      now,
    )
    expect(decision.action).toBe('keep')
  })

  it('恰好 90 天边界归档（>= 阈值）', () => {
    const updatedAt = new Date(now.getTime() - DEFAULT_RETENTION.archiveAfterDays * 24 * 60 * 60 * 1000)
    const decision = decideRetention({ updatedAt, archivedAt: null, messageCount: 1 }, now)
    expect(decision.action).toBe('archive')
  })
})
```

#### 5.3.7 迁移层：up / down migration

**apps/api/prisma/migrations/20260805120000_conversation_aggregate/migration.sql（up）**

```sql
-- v3 up：加冗余计数、归档字段、外键级联、并发索引

-- 1. 加列（有默认值，不锁表回填）
ALTER TABLE "Conversation" ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 2. 回填现有会话的 messageCount（一次性，可能慢，但只跑一次）
UPDATE "Conversation" c
SET "messageCount" = (
  SELECT COUNT(*) FROM "Message" m WHERE m."conversationId" = c."id"
);

-- 3. 并发建索引，不锁表（生产必须 CONCURRENTLY）
--    注意：CONCURRENTLY 不能在事务块里跑，Prisma migration 需拆分或手动执行
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_userId_archivedAt_updatedAt_idx"
  ON "Conversation" ("userId", "archivedAt", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Citation_sourceType_sourceId_idx"
  ON "Citation" ("sourceType", "sourceId");
```

**apps/api/prisma/migrations/20260805120000_conversation_aggregate/down.sql（down 回滚）**

```sql
-- v3 down：完全逆向 up，验证可回滚

DROP INDEX CONCURRENTLY IF EXISTS "Citation_sourceType_sourceId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Conversation_userId_archivedAt_updatedAt_idx";

ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "archivedAt";
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "messageCount";
```

#### 5.3.8 编排层：conversation.service.ts（v3 关键改动）

**apps/api/src/conversation/conversation.service.ts（v3 委托聚合根）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationAggregate } from './aggregate/conversation.aggregate'
import { decideRetention } from './retention/retention-policy'
import { encodeCursor, decodeCursor } from './cursor/cursor-codec'
import type { MessageDraft } from './aggregate/message-invariants'

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregate: ConversationAggregate,   // v3：委托聚合根
  ) {}

  // v3：写消息统一走聚合根（保证不变量 + 事务）
  async appendMessage(conversationId: string, draft: MessageDraft): Promise<string> {
    return this.aggregate.appendMessage(conversationId, draft)
  }

  // v3：会话列表直接读冗余 messageCount，不再 COUNT
  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId, archivedAt: null },   // 默认只查活跃会话
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, messageCount: true, updatedAt: true },
    })
  }

  // v3：归档扫描（可由定时任务或运维手动触发）
  async archiveStale(userId: string, now = new Date()): Promise<string[]> {
    const candidates = await this.prisma.conversation.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, updatedAt: true, archivedAt: true, messageCount: true },
    })

    const toArchive = candidates.filter(
      (c) => decideRetention(c, now).action === 'archive',
    )

    if (toArchive.length > 0) {
      await this.prisma.conversation.updateMany({
        where: { id: { in: toArchive.map((c) => c.id) } },
        data: { archivedAt: now },
      })
    }

    return toArchive.map((c) => c.id)
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：聚合根（Aggregate Root）与业务不变量**
- 解决的问题：业务不变量（消息 + 引用 + 计数一致）散落在多个 service 方法里，任何新代码都可能破坏它
- 运行机制：聚合根是"一致性边界"，外部只能通过聚合根的方法修改内部实体，不能绕过它直接写子实体；不变量在聚合根内部集中校验
- 项目落点：`conversation.aggregate.ts` 的 `appendMessage`；`message-invariants.ts` 纯函数校验
- 生产误区：把聚合根做成"贫血模型"（只有 getter/setter 没有业务方法）；聚合边界划太大（整个会话 + 所有消息一个聚合，写一条消息锁全部）；不变量校验放事务里而不是事务前（慢查询占用事务连接）
- 验证方法：`checkMessageInvariants` 单测覆盖所有违规分支；集成测试验证"绕过聚合根直接写 Message"会导致 count 不一致（反证）

**知识点 2：Keyset 游标分页 vs OFFSET 分页**
- 解决的问题：OFFSET N 要求数据库扫描并丢弃前 N 行，翻到第 5 万行要扫 5 万行，越翻越慢；且翻页期间插入新行会导致错位/重复
- 运行机制：keyset 用"上一页最后一行的排序键"作为游标，`WHERE (createdAt, id) < (lastCreatedAt, lastId)`，配合复合索引直接定位，每页恒定 O(pageSize)
- 项目落点：`cursor-codec.ts` 编解码；`conversation.service.ts` 的 `getMessages` keyset where
- 生产误区：只用 createdAt 做游标（时间戳重复时丢行或重复，必须加 id 兜底）；游标明文暴露主键（用 base64url 编码成不透明串）；解码失败抛 SQL 错误（应 fallback 第一页）
- 验证方法：50 万行表分别用 OFFSET 和 keyset 翻到第 1000 页，`EXPLAIN ANALYZE` 对比扫描行数；篡改游标断言返回第一页而非 500

**知识点 3：复合索引的字段顺序（等值 → 排序 → 兜底）**
- 解决的问题：索引字段顺序错了，查询用不上索引，仍然全表扫描
- 运行机制：复合索引 `(conversationId, createdAt, id)` 遵循"最左前缀"——等值查询字段（conversationId）在最前，排序字段（createdAt）居中，唯一兜底（id）在后；这样 `WHERE conversationId=? ORDER BY createdAt DESC` 能直接走索引
- 项目落点：`schema.prisma` 的 `@@index([conversationId, createdAt, id])`
- 生产误区：把排序字段放等值字段前面（`(createdAt, conversationId)` 用不上）；给低基数列（如 role 只有 3 个值）单独建索引（选择性差没意义）；索引过多拖慢写入
- 验证方法：`EXPLAIN` 确认走 `Index Scan` 而非 `Seq Scan`；调换字段顺序对比查询计划变化

**知识点 4：外键级联删除（onDelete: Cascade）与孤儿数据**
- 解决的问题：删除 User 时，它的 Conversation/Message/Citation 如果不级联删除，就变成永远查不到但占空间的孤儿数据；或者删除 source 后 Citation 指向不存在的证据
- 运行机制：`onDelete: Cascade` 让数据库在删父行时自动删子行；Citation 的 `(sourceType, sourceId)` 索引用于删除 source 前反查"还有没有消息引用它"，避免制造孤儿
- 项目落点：`schema.prisma` 的 `onDelete: Cascade`；`Citation` 的反查索引
- 生产误区：级联删除范围失控（删一个 User 连锁删几百万行，长事务锁表）；应用层删除不设数据库外键约束（并发下仍产生孤儿）；软删除和级联混用导致"父软删、子硬删"不一致
- 验证方法：删除测试 User 后断言其所有 Conversation/Message/Citation 都被删；删除被引用的 source 时断言被拒绝或先清理引用

**知识点 5：可回滚迁移（up/down）与 CONCURRENTLY 建索引**
- 解决的问题：只有 up 没有 down 的迁移无法回滚，上线出问题只能硬扛；大表上 `CREATE INDEX` 默认锁表，阻塞所有写入
- 运行机制：每个 migration 配对 up/down，down 完全逆向 up；`CREATE INDEX CONCURRENTLY` 不锁表建索引（代价是不能在事务块里跑、耗时更长、失败留下 invalid 索引要清理）
- 项目落点：`migration.sql`（up）+ `down.sql`（down）；加列先给默认值再回填
- 生产误区：CONCURRENTLY 放在事务里（Postgres 直接报错）；加 NOT NULL 列不给默认值（锁表回填）；down 脚本没测过（回滚时才发现 down 也是错的）
- 验证方法：本地 `migrate up` 后 `migrate down` 再 `up`，断言 schema 前后一致；大表加索引时监控是否有写阻塞

**知识点 6：冗余字段（messageCount）与写时维护一致性**
- 解决的问题：列表页展示 N 个会话，每个都 COUNT 一次消息数 = N 次聚合查询，慢；但冗余计数如果不和写消息原子更新，就会对不上
- 运行机制：Conversation 存 `messageCount` 冗余列，在聚合根的 `appendMessage` 事务里 `increment: 1`，和写 Message 同一事务提交；读列表直接 select 这个列
- 项目落点：`conversation.aggregate.ts` 事务内 `messageCount: { increment: 1 }`；`listConversations` 直接读列
- 生产误区：冗余更新和写消息不在同一事务（并发下 count 漂移）；用 `SET count = count + 1` 应用层读改写（竞态，必须用数据库原子 increment）；忘了删消息时 decrement
- 验证方法：并发写 1000 条消息后断言 `messageCount` 精确等于 1000；对比冗余列和实际 `COUNT(*)` 一致性巡检

### 5.5 边写边问自己

- 聚合根为什么要禁止外部绕过它直接写 Message？（否则 messageCount 和不变量随时可能被新代码破坏）
- keyset 游标为什么必须带 id 而不只是 createdAt？（时间戳会重复，只用 createdAt 会在边界丢行或重复）
- messageCount 的 `increment` 为什么必须在事务里？（和写 Message 原子提交，否则并发下计数漂移）
- 归档为什么用 `archivedAt` 时间戳而不是 `isArchived` 布尔？（时间戳既表达"是否归档"又记录"何时归档"，便于审计和分级冷存储）
- CONCURRENTLY 建索引为什么不能放事务里？（它需要多次扫描表并等待并发事务完成，本质上不是原子操作）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 4 张表裸建 + 无索引 CRUD | 复合索引 + keyset 游标分页 | 聚合根 + 保留策略 + 可回滚迁移 |
| **数据模型** | User/Conversation/Message/Citation 无约束 | + 复合索引 | + messageCount 冗余 + archivedAt + onDelete |
| **列表查询** | 每会话 N 次 COUNT | 仍 COUNT | 直接读 messageCount 冗余列 |
| **翻页机制** | OFFSET（越翻越慢） | keyset 游标 O(pageSize) | 同 v2 |
| **一致性保证** | 无事务，消息/引用/计数可能不一致 | 无事务 | 聚合根事务：消息+引用+计数原子 |
| **业务不变量** | 散落 service，无校验 | 无校验 | message-invariants 纯函数集中校验 |
| **迁移能力** | 只有 up | 只有 up | up + down，CONCURRENTLY 不锁表 |
| **生命周期** | 数据永久堆积 | 永久堆积 | 保留策略归档 archivedAt |
| **对齐后续 Day** | — | 分页合同 | 聚合边界供 Day 24-30 会话/RAG 复用 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的核心在后端数据建模，但会话列表和消息翻页的前端渲染同样有"底子"要补。深挖 HTML 文档 `Day23深挖-前端底子补弱.html` 展开以下知识点：

- **深挖 1：游标分页在前端的状态管理**——从今天的 `cursor-codec` 讲起，前端如何保存"下一页游标"、如何避免重复请求、如何在插入新消息时不破坏游标一致性
- **深挖 2：虚拟滚动（Virtual Scrolling）**——50 万条消息不可能一次性渲染 DOM，从"单会话 9 秒打开"讲起，讲清 `content-visibility: auto` 和虚拟列表的取舍
- **深挖 3：乐观更新（Optimistic Update）与冗余计数**——从 `messageCount` 讲起，前端发消息后如何本地先 +1、失败如何回滚

深挖 HTML 遵循 8 子节结构（场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法），不在正文展开。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按第 5.3 节写三个 spec 文件：

- `aggregate/conversation.aggregate.spec.ts`：5 个用例覆盖 message-invariants 所有违规分支（合法 / user 带引用 / 空 content / 引用跳号 / 缺 sourceVersion）
- `retention/retention-policy.spec.ts`：4 个用例（超期归档 / 活跃保留 / 已归档不重复 / 90 天边界）
- `cursor/cursor-codec.spec.ts`：v2 已有（编码解码往返 / 篡改 fallback / 空游标第一页）

运行：`pnpm --filter api test conversation` 应全绿（约 12 个用例）。

### 7.7 F-1：反证实验 1（5 分钟）—— 绕过聚合根直接写 Message

手动在 `conversation.service.ts` 里加一个方法直接 `prisma.message.create()`（不更新 messageCount），写 3 条消息后查询会话列表：

- 观察现象：`messageCount` 显示 0，但实际有 3 条消息，列表页数字和详情对不上
- 验证结论：这就是"绕过聚合根 = 破坏冗余一致性"的后果；聚合根的存在就是为了堵住这条路
- 实验后删除这个方法

### 7.8 F-2：反证实验 2（5 分钟）—— 去掉复合索引看查询计划

手动在 `schema.prisma` 里注释掉 `@@index([conversationId, createdAt, id])`，重新 migrate，然后对 5 万行的 Message 表跑翻页查询：

- 观察现象：`EXPLAIN ANALYZE` 显示 `Seq Scan`，扫描行数 = 全表，翻页耗时从毫秒级涨到秒级
- 验证结论：复合索引是 keyset 游标能 O(pageSize) 的前提，没索引游标也救不了
- 实验后恢复索引

### 7.9 F-3：验证 + 提交（10 分钟）

运行四件套：

```bash
pnpm --filter api typecheck && \
pnpm --filter api lint && \
pnpm --filter api test conversation && \
pnpm --filter api build
```

验证 up/down 迁移可逆：

```bash
pnpm --filter api prisma migrate resolve --applied 20260805120000_conversation_aggregate
# 本地库跑 down 再 up，断言 schema 前后一致
```

提交（Conventional Commits）：

```
feat(conversation): 聚合根 + 保留策略 + 可回滚迁移

- ConversationAggregate 收拢消息写入不变量，事务保证消息/引用/计数一致
- keyset 游标分页替代 OFFSET，复合索引支撑 O(pageSize) 翻页
- messageCount 冗余列 + archivedAt 保留策略
- up/down migration，CONCURRENTLY 不锁表建索引

Refs: Day23
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day24 结束时集中 push。

---

## 8. 通过标准

- `pnpm --filter api test conversation` 全绿（12 个用例）
- up/down migration 本地可逆，schema 前后一致
- 关键查询（会话列表 + 单会话翻页）有 `EXPLAIN` 基线，走 Index Scan 而非 Seq Scan
- 会话列表页不再 N 次 COUNT，直接读 messageCount
- 并发写 1000 条消息后 messageCount 精确 = 1000（无漂移）
- 四件套全绿，commit 含 `Refs: Day23`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day23`，未执行 `git push`）
2. 四件套输出截图/日志
3. `conversation` 测试全绿输出
4. 关键查询的 `EXPLAIN ANALYZE` 基线（OFFSET vs keyset 对比）
5. up/down 迁移可逆验证记录
6. 架构证据：ERD 图 + 索引 ADR + 聚合边界说明
7. AI Review 记录（接受/修改/拒绝理由）
8. 学习日志（先回答 §10 三道核心问题）

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（写一条 assistant 消息）到最终输出（会话列表显示正确 count），解释"数据建模"的数据流；当天知识链"聚合、关系/索引、游标、迁移、保留策略"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除聚合根的事务边界（消息和 count 分开写），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和 EXPLAIN 基线，证明"单会话打开 < 200ms"目标已达到；再说明当前实现距离企业生产标准（如冷热分离、分区表）还缺什么，下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. Conversation 含 50 万条 Message，按会话打开需 9 秒；SQL explain 显示全表扫描。请用 ERD、查询计划、行宽和索引命中定位；先限制历史窗口止损，再设计聚合边界、复合索引与 Cursor，并用真实量级数据验证 P95 和写入回归。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S25 PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
2. 两个 worker 并发写同一 Citation，迁移中途失败导致 Message 存在但引用 source 已删除。请用约束、事务日志、迁移版本和孤儿查询定位；先禁止删除并修复孤儿止损，再补外键/保留策略和可回滚 migration，演练 up/down 与并发写验证。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：Conversation/Message/Citation/User 聚合、索引、游标、迁移和保留策略。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 全栈开发中如何设计数据库表结构以应对高频读写？
   来源：《2026美团前端全栈开发》，第 9 页。
2. 低代码 AI 工作流怎样设计数据结构以支持复杂嵌套逻辑？
   来源：《2026已发交个朋友全栈AI工程师》，第 9 页。

题目说明：对应 Conversation/Message/Citation/User 聚合、关系、索引和生命周期建模。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 13（持久化/幂等）的 AgentRun/Diagnosis/ToolCall 三表、Day 16（证据与 XSS）的 Citation 证据链、Day 22（API 合同）的分页 DTO
- **本日**：把会话域（Conversation/Message/Citation/User）的聚合边界、索引、游标、迁移、保留策略一次性建成生产级
- **对齐后续**：
  - Day 24-25：会话服务和多轮对话上下文直接复用今天的聚合根
  - Day 26-30：RAG 检索结果作为 Citation 写入，复用今天的证据链模型和保留策略
  - Day 30（M3 门禁）：要求"任何一次会话都能按 cursor 稳定翻页、任何一条结论都能追溯到 Citation source"
