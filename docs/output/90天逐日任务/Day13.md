# Day 13：持久化 / 幂等（v1 直接写库 → v2 幂等键 → v3 事务+执行状态+恢复）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

任务版本：标准版
日期与时长：2026-07-26 周日，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 12 Agent Loop、第一次把 LLM 循环产物落库、经历过"重启后 UI 显示完成但工具还在跑"的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + LLM 集成 + RAG）
   Day 11：Tool Registry（Schema/超时/裁剪/审计）
   Day 12：Agent Loop（循环调用+预算+终止）
   Day 13：持久化 / 幂等（事务+幂等键+执行状态+恢复）  ← 今天在这里
   Day 14-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 13 在阶段一第 3 天**。Day 11 让工具能被调用、Day 12 让 LLM 能循环调工具、今天要让"每一次 Agent Run 都能可靠地落库"。这是从"内存里跑得通"到"进程崩了也能收得住"的分水岭。

### 到 Day 12 结束时项目已具备的能力

- **后端**（Day 6-10）：Nest + Prisma + Postgres，服务器/指标/告警 CRUD，Z-Score 异常检测，服务端 FSM
- **Tool Registry**（Day 11）：三个只读运维 Tool，Schema/超时/裁剪/审计
- **Agent Loop**（Day 12）：`AgentLoopEngine`、预算追踪、终止原因、`OpenAIProvider`
- **可以看到的东西**：POST `/agent/run` 会返回一次完整循环的 trajectory；但**这些 trajectory 全在内存里，进程一重启就没了**

### 今天要解决的 4 个问题

1. **问题 1：Agent Run 是易失的**
   Day 12 的 `AgentLoopEngine.run()` 返回一个 `AgentTrajectory` 对象，直接扔回 HTTP 响应。前端刷新页面就丢；进程重启数据全灭；出了事故没法回溯"当时 LLM 到底调了哪几个 Tool"。生产系统必须把 AgentRun / Diagnosis / ToolCall 三张表落到 Postgres。

2. **问题 2：同一 anomaly 被并发触发两次**
   告警系统在 14:30:00 生成 `anomaly-a123`，webhook 因为网络重试在 14:30:01 又推了一次同样的 payload。如果两次都启动 Agent 生成 Diagnosis、都落库，就会出现同一异常有两条"有效"诊断，运维看到自相矛盾的分析结论。**幂等键（idempotency key）** 是防重复的标准解，但要想清楚"哪个字段做幂等"、"重复请求返回 200 还是 409"、"数据库唯一约束在哪一层"。

3. **问题 3：进程在中间步骤崩了**
   Agent Loop 5 个 step，跑到第 3 个 step 完成、ToolCall 已经写入 DB，但 AgentRun 的 `status` 还是 `running`——这时候进程 OOM 崩掉。重启后：
   - UI 查 AgentRun.status = 'running'，显示"进行中"，用户等了 10 分钟发现根本没进展
   - 或者查到 status = 'completed' 但 ToolCall 缺一条，显示的诊断结论不完整
   要么定义 **执行状态**（`starting / running / persisted / completed / failed`）把中间态显式化，要么用**事务边界**把"写 Diagnosis + 更新 AgentRun.status"绑成原子操作。

4. **问题 4：部分失败无法恢复**
   AgentRun 写成功、Diagnosis 写成功、ToolCall 写到一半失败（比如 Postgres 磁盘满）。回滚整个事务？那前面 3 秒的 LLM 调用（花了钱的）也白费。不回滚？那 ToolCall 就永远缺一条。正确做法是**把"落库"和"业务执行"解耦**：业务先写完 AgentRun（幂等键锁位），再在事务里写 Diagnosis + ToolCall；进程重启时扫描 status=`running` 且超过 timeout 的 Run，标记为 `stale` 待人工介入或自动补偿。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`PersistenceModule`**：把 Day 12 的 Agent Loop 产物（AgentRun / Diagnosis / ToolCall）持久化到 Postgres，用幂等键保证同一 anomaly 只有一条有效 Run，用事务边界保证部分写入不产生脏数据，用执行状态和启动扫描机制处理进程崩溃后的恢复。

### 1.1 用户能看到什么

**场景**：告警系统检测到 `srv-042` 的 CPU 异常，向 Agent 服务推送 webhook 触发诊断。因为网络抖动，同一个 anomaly 在 3 秒内被推送了 3 次。

```
时间轴：

14:30:00.000  Webhook 1 到达
  → POST /agent/anomaly-hook
  → body: { anomalyId: "a-123", serverId: "srv-042", metricType: "cpu" }
  → 服务端：
     idempotencyKey = "anomaly:a-123"
     SELECT id FROM agent_runs WHERE idempotency_key = 'anomaly:a-123'  → 空
     INSERT INTO agent_runs (idempotency_key, status='starting', ...) → runId=r-01
  → 响应：202 Accepted { runId: "r-01", status: "starting" }

14:30:01.200  Webhook 2 到达（重复推送）
  → POST /agent/anomaly-hook
  → body: 同上
  → 服务端：
     SELECT id FROM agent_runs WHERE idempotency_key = 'anomaly:a-123'  → 命中 r-01
  → 响应：200 OK { runId: "r-01", status: "running" }（不启动新的 Run）

14:30:02.500  Webhook 3 到达（再次重复）
  → 同上，命中 r-01
  → 响应：200 OK { runId: "r-01", status: "running" }

Agent Loop 内部执行（异步）：
14:30:00.100  AgentRun r-01: status='starting'
14:30:00.200  开始 step 1：调用 LLM
14:30:01.500  step 2：Tool getMetrics → ToolCall t-01 写入（事务内）
14:30:02.800  step 3：Tool getAlertDetail → ToolCall t-02 写入（事务内）
14:30:04.200  step 4：LLM 生成 Diagnosis → Diagnosis d-01 写入（事务内）
14:30:04.300  step 5：AgentRun r-01: status='completed'（同一事务提交）

如果 14:30:03.000 进程崩溃：
  重启后 AgentRun r-01: status='running'，lastHeartbeat=14:30:02.800
  → 启动扫描器发现：now - lastHeartbeat > 60s
  → 标记 r-01: status='stale', error='process_crashed'
  → 触发补偿逻辑（可选：重新入队 anomaly-a-123 让下一次 Run 继续）
```

前端在 `/agent/runs/r-01` 页面看到的信息：
- status = `completed`（或 `stale` 如果崩过）
- 5 步 trajectory 完整落库
- 2 条 ToolCall 记录：`getMetrics` / `getAlertDetail`
- 1 条 Diagnosis：包含诊断结论、置信度、涉及的告警 ID
- 幂等元数据：`idempotencyKey=anomaly:a-123`，`webhookReceivedCount=3`（观测重复推送次数）

### 1.2 这个模块在项目里承担什么

- **输入**：Day 12 的 `AgentLoopEngine.run(config)` 返回的 `AgentTrajectory`
- **输出**：Postgres 里三张表的持久化记录（AgentRun / Diagnosis / ToolCall），可以在事务里原子提交，重启后能通过 `idempotencyKey` 识别重复触发、通过 `status` 字段识别中间态
- **对齐后续**：今天定义的 **持久化合同**（`AgentRunEntity` / `ExecutionStatus` / `IdempotencyKey` 生成规则）是 Day 14 (LangChain) 和 Day 30 (M3 门禁) 的地基。Day 30 会要求"任何一次 Agent Run 都必须能在 Postgres 里查到完整链路"

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 循环结束后一次性写入 3 张表 | 单文件 `persistence.service.ts`，无事务、无幂等 | Prisma create、外键、基本 CRUD |
| **v1 痛点** | 同一 anomaly 触发两次生成两条 Diagnosis；崩溃后 AgentRun.status='running' 卡死 |  |  |
| **v2** | v1 + **`idempotencyKey` 唯一约束** + **`ExecutionStatus` 显式化** | 拆出 `idempotency-key.ts` + `execution-status.ts` | 唯一约束、409 Conflict 语义、状态枚举、409 vs 200 抉择 |
| **v2 痛点** | 3 张表分开写，写 Diagnosis 成功但写 ToolCall 失败会脏数据；崩溃后没有恢复机制 |  |  |
| **v3** | v2 + **`prisma.$transaction` 事务边界** + **启动时扫 stale run** + **`stale/recovering` 状态** | 完整分层（entity/idempotency/transaction/recovery/service） | 事务隔离级别、Serializable vs ReadCommitted、启动 scanner、补偿机制、部分失败恢复矩阵 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：持久化 / 幂等 涉及多个关注点（Prisma Schema、幂等键生成、事务边界、状态机、恢复扫描），如果不先在脑子里立起骨架，写到一半就会把"生成幂等键"和"写入数据库"混在同一个方法里、把"事务边界"糊在 controller 上、把"扫描恢复"当成 cron 任务放到项目根目录。看完这棵树，下面章节再出现 `src/persistence/transaction/agent-run-tx.service.ts` 时，你就能立刻定位它在架构中的位置。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── persistence/                                 ← 【新增】持久化 / 幂等 模块
│   ├── entity/
│   │   ├── agent-run.entity.ts                  ← AgentRun 领域实体（DB 表映射）
│   │   ├── diagnosis.entity.ts                  ← Diagnosis 领域实体
│   │   ├── tool-call.entity.ts                  ← ToolCall 领域实体
│   │   └── execution-status.enum.ts             ← 执行状态枚举（8 个状态）
│   ├── idempotency/
│   │   ├── idempotency-key.ts                   ← 幂等键生成规则（纯函数）
│   │   ├── idempotency-key.spec.ts              ← 幂等键单元测试
│   │   └── idempotency.service.ts               ← 幂等键查询/占位/复用
│   ├── transaction/
│   │   ├── agent-run-tx.service.ts              ← 事务边界（3 张表原子写入）
│   │   ├── agent-run-tx.service.spec.ts         ← 事务边界单元测试（含回滚）
│   │   └── transaction.helper.ts                ← Prisma $transaction 封装
│   ├── recovery/
│   │   ├── stale-run-scanner.ts                 ← 启动扫描器（发现 stale run）
│   │   ├── stale-run-scanner.spec.ts            ← 扫描器单元测试
│   │   └── recovery.strategy.ts                 ← 恢复策略（放弃 / 补偿 / 重试）
│   ├── index.ts                                 ← 桶文件
│   ├── persistence.module.ts                    ← NestJS 模块
│   └── persistence.service.ts                   ← 业务编排层
├── agent/                                       ← 【Day 12 已有】Agent Loop
│   ├── loop/agent-loop.engine.ts                ← 需要改：结束后调用 persistence
│   └── ...
├── tools/                                       ← 【Day 11 已有】Tool Registry
│   └── ...
├── prisma/
│   ├── schema.prisma                            ← 【已有】需要新增 3 张表 + 索引
│   ├── prisma.service.ts                        ← 【已有】
│   └── migrations/
│       └── 20260726120000_add_persistence/     ← 【新增】migration
│           └── migration.sql
└── main.ts                                      ← 【已有】需要在 bootstrap 里挂 scanner
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `persistence.service.ts` | ✓ 一次性写 3 张表 | ✓ 加幂等键查询 | ✓ 委托给 `AgentRunTxService` |
| `entity/execution-status.enum.ts` | ✗ | ✓ 5 个状态 | ✓ 8 个状态（新增 `stale/recovering/abandoned`） |
| `idempotency/idempotency-key.ts` | ✗ | ✓ 纯函数生成 | ✓ 同 v2 |
| `idempotency/idempotency.service.ts` | ✗ | ✓ 查库 + 唯一约束 | ✓ 同 v2 |
| `transaction/agent-run-tx.service.ts` | ✗ | ✗ | ✓ `prisma.$transaction` 原子写 |
| `recovery/stale-run-scanner.ts` | ✗ | ✗ | ✓ 启动扫描 + 60s 超时 |
| `recovery/recovery.strategy.ts` | ✗ | ✗ | ✓ 三种恢复策略 |
| `prisma/schema.prisma` | 3 张基础表 | + `idempotencyKey` 唯一 + `executionStatus` | + `lastHeartbeatAt` + `recoveredFrom` |

**依赖方向（务必单向，反过来一次都不行）**：

```
agent/loop/agent-loop.engine.ts
        │
        ▼
persistence.service.ts
        │
        ├─► idempotency/idempotency.service.ts ──► prisma
        │
        ├─► transaction/agent-run-tx.service.ts ──► prisma
        │                    │
        │                    └─► entity/*.entity.ts（纯类型）
        │
        └─► recovery/stale-run-scanner.ts ──► prisma
                             │
                             └─► recovery/recovery.strategy.ts（纯函数）

entity/*.entity.ts       ← 只声明类型和领域方法，不 import service
idempotency-key.ts       ← 纯函数，不 import prisma
recovery.strategy.ts     ← 纯函数，不 import prisma
```

**红线**：
- `entity/agent-run.entity.ts` 里出现 `import { PrismaService } from '../../prisma'` 就是架构塌方——实体只描述领域概念，不应该知道存储机制
- `idempotency/idempotency-key.ts` 里出现 `import { PrismaService }` 也是塌方——键的生成规则必须能在纯 Node 里测试
- `agent-loop.engine.ts` 里直接调 `prisma.agentRun.create()` 就是绕过持久化层，破坏事务边界

**动手前先问自己 3 个问题**：

1. `idempotency-key.ts` 为什么必须是纯函数？—— 见 §5.4 知识点 2「幂等键的确定性」
2. 事务边界为什么放在 `transaction/` 而不是 `service/`？—— 见 §5.4 知识点 4「事务边界的物理位置」
3. `stale-run-scanner` 为什么在启动时跑而不是 cron？—— 见 §5.4 知识点 6「进程重启即扫描」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：安装依赖 / 确认 Prisma 版本（3 分钟）

按第 5.3 节的代码：

- 项目根目录已有 `@prisma/client` 和 `prisma`（Day 07 装的）
- 确认版本 `pnpm --filter api list @prisma/client` ≥ 5.0（低于 5.0 的 `$transaction` 类型推断有问题）
- 如需升级：`pnpm --filter api add @prisma/client@latest prisma@latest`

**边写边问自己**：

- 为什么必须 Prisma 5+？（`$transaction` 的 `Prisma.TransactionClient` 类型推断只有 5+ 才完整）
- 如果项目还在 Prisma 4，这一天能用什么方案替代？（用 `prisma.$queryRaw` 手动 BEGIN/COMMIT，但要自己处理错误回滚——不推荐）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `apps/api/src/persistence/` 下创建 4 个子目录：

```
persistence/
├── entity/
├── idempotency/
├── transaction/
└── recovery/
```

**边写边问自己**：

- 为什么 `entity/` 和 `idempotency/` 分开？（entity 描述数据形状，idempotency 描述写入规则；分开才能各自单测）
- 为什么不叫 `dto/`？（DTO 是 HTTP 层的数据传输对象，entity 是领域实体，两者生命周期不同）

### 1.5.3 D-3：改 Prisma Schema + 生成 migration（5 分钟）

按第 5.3 节的代码：

- 修改 `apps/api/prisma/schema.prisma`：新增 `AgentRun` / `Diagnosis` / `ToolCall` 三个 model，加上 `ExecutionStatus` enum
- 运行 `pnpm --filter api prisma migrate dev --name add_persistence`
- 检查生成的 `migration.sql` 是否包含唯一索引 `idempotency_key`

**边写边问自己**：

- 为什么 `idempotency_key` 用 `String` 而不是 `Bytes`（哈希）？（可读性；生产系统里"运维排查时能一眼看出这个键是从哪个 anomaly 来的"比省空间重要）
- `lastHeartbeatAt` 为什么必须有默认值 `now()`？（旧数据升级时不能是 NULL，否则扫描器会认为"从来没心跳过"直接标记 stale）
- Postgres 唯一约束和应用层 `SELECT ... FOR UPDATE` 谁先谁后？（先应用层查（快速失败），后 DB 唯一约束（并发兜底）——两层都要有）

### 1.5.4 D-4：实现 entity 层（3 分钟）

按第 5.3 节的代码：

- 写 `entity/execution-status.enum.ts`（8 个状态枚举 + 状态转移检查函数）
- 写 `entity/agent-run.entity.ts` / `diagnosis.entity.ts` / `tool-call.entity.ts`（纯类型 + 领域方法）

**边写边问自己**：

- 为什么 `ExecutionStatus` 是 enum 而不是 string union？（enum 有运行时值，可以用于 Prisma 的 `@default` 和状态转移的 switch）
- `AgentRunEntity` 上有个 `canTransitionTo(newStatus): boolean` 方法，为什么这个方法在 entity 上而不是 service 上？（状态转移规则是领域知识，属于实体本身；如果放到 service 就散在多处、无法单测）

### 1.5.5 D-5：实现 idempotency / transaction / recovery 层（7 分钟）

按第 5.3 节的代码：

- 写 `idempotency/idempotency-key.ts`（纯函数，`generateFromAnomaly` / `generateFromToolCallScope`）
- 写 `idempotency/idempotency.service.ts`（查询 / 占位 / 复用）
- 写 `transaction/transaction.helper.ts`（`withTransaction<T>` 泛型封装）
- 写 `transaction/agent-run-tx.service.ts`（`persistTrajectory` 事务方法）
- 写 `recovery/recovery.strategy.ts`（纯函数，`decideStrategy(run)`）
- 写 `recovery/stale-run-scanner.ts`（`OnApplicationBootstrap` 钩子）
- 写 `persistence.service.ts`（业务编排）
- 写 `persistence.module.ts`（NestJS 模块）
- 在 `agent/loop/agent-loop.engine.ts` 结束时调用 `persistenceService.persist(trajectory)`

**边写边问自己**：

- `withTransaction` 为什么用泛型？（事务函数返回类型多变，AgentRun / Diagnosis / ToolCall 各自不同）
- `stale-run-scanner` 的 `OnApplicationBootstrap` 和 `OnModuleInit` 有什么区别？（`OnApplicationBootstrap` 在所有模块 init 完成后触发，能保证 Prisma 已连通；`OnModuleInit` 时 Prisma 可能还没连）
- `decideStrategy` 为什么是纯函数？（策略只依赖 run 的字段和当前时间；不查 DB、不发请求；这样单测能覆盖所有分支）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 30 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"直接写库→加幂等→加事务"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `agent-run-tx.service.ts` 和 `stale-run-scanner.ts` | 能口述"事务边界包了哪几行"、"扫描器什么时候触发" |
| C：读深挖 | 30 min | §6.5 前端底子补弱（`Day13深挖-前端底子补弱.html`） | 能回答"WebSocket 断线重连的幂等键怎么设计" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个测试文件 | `pnpm --filter api test persistence` 全绿 |
| F-1：反证 1 | 5 min | §7.7 手动删掉幂等键唯一约束，重复请求触发两条 Run | 观察脏数据，验证"没有唯一约束时是什么样子" |
| F-2：反证 2 | 5 min | §7.8 手动去掉 `$transaction` 包裹，模拟第 2 张表写入失败 | 观察脏数据，验证"没有事务时是什么样子" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day13` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（直接写库）

### 3.1 v1 要实现什么

用户视角：Agent Loop 跑完后，能在 Postgres 里查到这次运行的完整记录（AgentRun / Diagnosis / ToolCall）。至少满足"重启前端页面还能看到历史 Run"这一条最基本的需求。

**不做**：
- 不处理重复请求（同一 anomaly 被推 3 次就写 3 条 Run）
- 不处理进程崩溃（崩了就崩了，脏数据留在库里）
- 不用事务（每张表分开写，允许部分失败）
- 不做恢复扫描

### 3.2 v1 目录结构

```
apps/api/src/
├── persistence/
│   ├── persistence.service.ts       ← 单文件，一次性写 3 张表
│   └── persistence.module.ts
├── agent/
│   └── loop/agent-loop.engine.ts    ← 结束后调用 persistenceService.persist(trajectory)
└── prisma/
    └── schema.prisma                ← 加 AgentRun / Diagnosis / ToolCall 3 张表
```

### 3.3 v1 完整代码

**apps/api/prisma/schema.prisma（v1 增量）**

```prisma
model AgentRun {
  id            String       @id @default(cuid())
  anomalyId     String
  status        String       // "running" | "completed" | "failed"，v1 用字符串
  startedAt     DateTime     @default(now())
  finishedAt    DateTime?
  totalSteps    Int          @default(0)
  totalTokens   Int          @default(0)

  diagnoses     Diagnosis[]
  toolCalls     ToolCall[]

  @@index([anomalyId])
}

model Diagnosis {
  id            String    @id @default(cuid())
  agentRunId    String
  agentRun      AgentRun  @relation(fields: [agentRunId], references: [id])
  summary       String    @db.Text
  confidence    Float
  createdAt     DateTime  @default(now())

  @@index([agentRunId])
}

model ToolCall {
  id            String    @id @default(cuid())
  agentRunId    String
  agentRun      AgentRun  @relation(fields: [agentRunId], references: [id])
  toolName      String
  argumentJson  String    @db.Text
  resultJson    String?   @db.Text
  errorCode     String?
  durationMs    Int
  createdAt     DateTime  @default(now())

  @@index([agentRunId])
}
```

**apps/api/src/persistence/persistence.service.ts（v1 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AgentTrajectory } from '../agent/types/agent-trajectory.types'

@Injectable()
export class PersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async persist(anomalyId: string, trajectory: AgentTrajectory): Promise<string> {
    // 第 1 步：创建 AgentRun
    const run = await this.prisma.agentRun.create({
      data: {
        anomalyId,
        status: 'running',
        totalSteps: trajectory.steps.length,
        totalTokens: trajectory.usage.totalTokens,
      },
    })

    // 第 2 步：写 Diagnosis
    await this.prisma.diagnosis.create({
      data: {
        agentRunId: run.id,
        summary: trajectory.finalReply,
        confidence: 0.85,
      },
    })

    // 第 3 步：写所有 ToolCall
    for (const step of trajectory.steps) {
      if (step.kind !== 'tool_call') continue
      await this.prisma.toolCall.create({
        data: {
          agentRunId: run.id,
          toolName: step.toolName,
          argumentJson: JSON.stringify(step.arguments),
          resultJson: step.result ? JSON.stringify(step.result) : null,
          errorCode: step.error?.code ?? null,
          durationMs: step.durationMs,
        },
      })
    }

    // 第 4 步：更新终态
    await this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: trajectory.finishReason === 'completed' ? 'completed' : 'failed',
        finishedAt: new Date(),
      },
    })

    return run.id
  }
}
```

**apps/api/src/persistence/persistence.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { PersistenceService } from './persistence.service'

@Module({
  imports: [PrismaModule],
  providers: [PersistenceService],
  exports: [PersistenceService],
})
export class PersistenceModule {}
```

**apps/api/src/agent/loop/agent-loop.engine.ts（改动点）**

```typescript
// ... Day 12 已有代码 ...
import { PersistenceService } from '../../persistence/persistence.service'

@Injectable()
export class AgentLoopEngine {
  constructor(
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistryService,
    private readonly persistence: PersistenceService,   // ← 新增
  ) {}

  async run(config: AgentRunConfig): Promise<AgentTrajectory> {
    const trajectory = await this.executeLoop(config)   // Day 12 已有
    await this.persistence.persist(config.anomalyId, trajectory)   // ← 新增
    return trajectory
  }
}
```

### 3.4 v1 暴露的痛点

**痛点 1：重复请求生成重复 Run**

告警系统的 webhook 因为网络抖动重试是常态。同一个 `anomaly-a123` 在 3 秒内被推 3 次，v1 会创建 3 条 AgentRun、3 条 Diagnosis、9 条 ToolCall。运维打开监控面板看到 3 条自相矛盾的诊断，无法判断哪一条是"真实结论"。

**痛点 2：中间步骤失败留下脏数据**

`persist` 里有 4 步顺序写入，第 3 步（写 ToolCall）如果因为磁盘满失败：
- AgentRun 已创建（第 1 步）
- Diagnosis 已写入（第 2 步）
- 前 2 条 ToolCall 已写入
- 第 3 条 ToolCall 未写入
- AgentRun.status 停留在 'running'（第 4 步没执行）

DB 里存在一条**结构不完整的 Run**：有诊断结论、有部分工具调用、状态卡在"运行中"。前端查询就会显示错误信息。

**痛点 3：进程崩溃后 status 永远是 'running'**

如果 Agent Loop 跑到 step 3 进程 OOM，`persist` 从来没被调用过。这条 Run 根本没进 DB。或者更糟：`persist` 执行到第 2 步进程崩溃，Diagnosis 有了、ToolCall 没写、status 永远 'running'。重启后没有任何机制识别这种"僵尸 Run"。

**痛点 4：status 用 String 而不是 enum**

`status: 'running'` 是字符串，`if (run.status === 'runing')` 拼错编译不会报错。生产事故里最常见的就是这种"看起来对但拼错了"的比较。

---

## 4. v2：加幂等键 + 显式执行状态

### 4.1 v2 要实现什么

用户视角：同一 anomaly 无论被推多少次，只有一条有效 Run；重复请求返回 200（幂等）而不是新建。AgentRun 的 status 从 String 换成 enum，中间态显式化（`starting / running / persisting / completed / failed`）。

**依然不做**：
- 不用事务（Diagnosis 和 ToolCall 还是分开写）
- 不做启动扫描（崩溃后的 Run 仍会卡在 running）

### 4.2 v2 目录结构

```
apps/api/src/persistence/
├── entity/
│   └── execution-status.enum.ts     ← 新增：5 个状态枚举
├── idempotency/
│   ├── idempotency-key.ts           ← 新增：纯函数生成键
│   └── idempotency.service.ts       ← 新增：查询/占位/复用
├── persistence.service.ts           ← 改：先查幂等键
└── persistence.module.ts
```

### 4.3 v2 完整代码

**apps/api/prisma/schema.prisma（v2 增量）**

```prisma
enum ExecutionStatus {
  starting
  running
  persisting
  completed
  failed
}

model AgentRun {
  id              String           @id @default(cuid())
  anomalyId       String
  idempotencyKey  String           @unique       // 新增：唯一约束
  executionStatus ExecutionStatus  @default(starting)  // 新增：enum
  startedAt       DateTime         @default(now())
  finishedAt      DateTime?
  totalSteps      Int              @default(0)
  totalTokens     Int              @default(0)

  diagnoses       Diagnosis[]
  toolCalls       ToolCall[]

  @@index([anomalyId])
  @@index([executionStatus])
}
```

**apps/api/src/persistence/entity/execution-status.enum.ts**

```typescript
// 对应 Prisma schema 里的 enum ExecutionStatus
export enum ExecutionStatus {
  starting = 'starting',
  running = 'running',
  persisting = 'persisting',
  completed = 'completed',
  failed = 'failed',
}

// 允许的状态转移：key 是当前状态，value 是允许转到的状态
const TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.starting]: [ExecutionStatus.running, ExecutionStatus.failed],
  [ExecutionStatus.running]: [ExecutionStatus.persisting, ExecutionStatus.failed],
  [ExecutionStatus.persisting]: [ExecutionStatus.completed, ExecutionStatus.failed],
  [ExecutionStatus.completed]: [],   // 终态
  [ExecutionStatus.failed]: [],       // 终态
}

export function canTransitionTo(
  from: ExecutionStatus,
  to: ExecutionStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: ExecutionStatus): boolean {
  return status === ExecutionStatus.completed || status === ExecutionStatus.failed
}
```

**apps/api/src/persistence/idempotency/idempotency-key.ts（纯函数）**

```typescript
// 幂等键的生成规则必须是确定性的：
// 相同输入永远得到相同的 key；不 import 任何 IO 依赖

export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' }

/**
 * 从 anomaly 生成幂等键
 * 规则：anomaly:{anomalyId} —— 一个 anomaly 只对应一次诊断
 */
export function generateFromAnomaly(anomalyId: string): IdempotencyKey {
  if (!anomalyId) {
    throw new Error('anomalyId is required to generate idempotency key')
  }
  return `anomaly:${anomalyId}` as IdempotencyKey
}

/**
 * 从工具调用作用域生成幂等键
 * 规则：toolcall:{runId}:{toolName}:{argHash}
 * 用于 Agent Loop 里"同一个 Run 里同一工具的同一参数只调一次"
 */
export function generateFromToolCallScope(
  runId: string,
  toolName: string,
  argJson: string,
): IdempotencyKey {
  const argHash = simpleHash(argJson)
  return `toolcall:${runId}:${toolName}:${argHash}` as IdempotencyKey
}

// 简单确定性哈希（生产环境应换成 sha256）
function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}
```

**apps/api/src/persistence/idempotency/idempotency.service.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { IdempotencyKey } from './idempotency-key'
import { ExecutionStatus } from '../entity/execution-status.enum'

export type IdempotencyLookupResult =
  | { status: 'new'; runId: null }
  | { status: 'existing'; runId: string; executionStatus: ExecutionStatus }

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(key: IdempotencyKey): Promise<IdempotencyLookupResult> {
    const run = await this.prisma.agentRun.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, executionStatus: true },
    })
    if (!run) return { status: 'new', runId: null }
    return {
      status: 'existing',
      runId: run.id,
      executionStatus: run.executionStatus as ExecutionStatus,
    }
  }

  async reserve(
    key: IdempotencyKey,
    anomalyId: string,
  ): Promise<{ runId: string }> {
    try {
      const run = await this.prisma.agentRun.create({
        data: {
          anomalyId,
          idempotencyKey: key,
          executionStatus: ExecutionStatus.starting,
        },
      })
      return { runId: run.id }
    } catch (err: any) {
      // Postgres 唯一约束冲突：说明并发的另一个请求先占了位
      if (err.code === 'P2002') {
        const existing = await this.prisma.agentRun.findUnique({
          where: { idempotencyKey: key },
          select: { id: true },
        })
        if (existing) return { runId: existing.id }
      }
      throw err
    }
  }
}
```

**apps/api/src/persistence/persistence.service.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AgentTrajectory } from '../agent/types/agent-trajectory.types'
import { IdempotencyService } from './idempotency/idempotency.service'
import { generateFromAnomaly } from './idempotency/idempotency-key'
import { ExecutionStatus } from './entity/execution-status.enum'

export type PersistResult =
  | { runId: string; created: true }
  | { runId: string; created: false; reason: 'already_exists' }

@Injectable()
export class PersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async persist(
    anomalyId: string,
    trajectory: AgentTrajectory,
  ): Promise<PersistResult> {
    const key = generateFromAnomaly(anomalyId)

    // 幂等检查：先查再占位
    const lookup = await this.idempotency.lookup(key)
    if (lookup.status === 'existing') {
      return { runId: lookup.runId, created: false, reason: 'already_exists' }
    }

    const { runId } = await this.idempotency.reserve(key, anomalyId)

    // 更新为 running，写业务数据
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        executionStatus: ExecutionStatus.running,
        totalSteps: trajectory.steps.length,
        totalTokens: trajectory.usage.totalTokens,
      },
    })

    await this.prisma.diagnosis.create({
      data: {
        agentRunId: runId,
        summary: trajectory.finalReply,
        confidence: 0.85,
      },
    })

    for (const step of trajectory.steps) {
      if (step.kind !== 'tool_call') continue
      await this.prisma.toolCall.create({
        data: {
          agentRunId: runId,
          toolName: step.toolName,
          argumentJson: JSON.stringify(step.arguments),
          resultJson: step.result ? JSON.stringify(step.result) : null,
          errorCode: step.error?.code ?? null,
          durationMs: step.durationMs,
        },
      })
    }

    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        executionStatus:
          trajectory.finishReason === 'completed'
            ? ExecutionStatus.completed
            : ExecutionStatus.failed,
        finishedAt: new Date(),
      },
    })

    return { runId, created: true }
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：3 张表分开写，中间失败留脏数据**

`persist` 里 `agentRun.update` → `diagnosis.create` → `toolCall.create` × N → `agentRun.update`，任何一步失败都不会回滚前面的写入。第 3 步失败时：
- AgentRun 存在，状态 = 'running'
- Diagnosis 存在
- ToolCall 只写了一半
- 后续没人再改 AgentRun.status，永远卡在 'running'

**痛点 2：崩溃后没有恢复机制**

如果进程在 `persist` 执行中崩溃：
- AgentRun 已 reserve（starting）但没进入 running 状态
- 或者已进入 running 但没到 completed
- 重启后没有代码扫描这些"孤儿 Run"
- 前端查询会看到永远无法完成的诊断

**痛点 3：`persisting` 状态没被真正利用**

我们定义了 `persisting` 状态，但代码里从来没写入过——因为持久化不是一个"阶段"，而是一个"事务"。事务要么原子完成、要么整体回滚。这个状态的存在本身就是设计错误的信号：真正需要的是**事务边界**，不是新增一个中间状态。

---

## 5. v3：事务边界 + 执行状态完整 + 崩溃恢复（终态）

### 5.1 v3 要实现什么

用户视角：不管进程崩、DB 抖、并发推，都保证：
1. 同一 anomaly 只有一条有效 Run（幂等）
2. Diagnosis + N 条 ToolCall 要么全部写入、要么全部不写（事务原子性）
3. 崩溃后重启，60 秒无心跳的 Run 会被标记 `stale`，并根据策略自动补偿或人工介入
4. 每种终止路径都有确定终态：`completed / failed / stale / abandoned / recovering`

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/persistence/
├── entity/
│   ├── agent-run.entity.ts
│   ├── diagnosis.entity.ts
│   ├── tool-call.entity.ts
│   └── execution-status.enum.ts        ← 8 个状态
├── idempotency/
│   ├── idempotency-key.ts
│   ├── idempotency-key.spec.ts
│   └── idempotency.service.ts
├── transaction/
│   ├── transaction.helper.ts
│   ├── agent-run-tx.service.ts
│   └── agent-run-tx.service.spec.ts
├── recovery/
│   ├── recovery.strategy.ts
│   ├── stale-run-scanner.ts
│   └── stale-run-scanner.spec.ts
├── index.ts
├── persistence.module.ts
└── persistence.service.ts
```

### 5.3 v3 完整代码

**apps/api/prisma/schema.prisma（v3 完整）**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ExecutionStatus {
  starting       // 已 reserve idempotencyKey，未开始执行
  running        // Agent Loop 执行中
  persisting     // 事务写入中（极短暂）
  completed      // 终态：成功
  failed         // 终态：失败（业务原因）
  stale          // 终态：超时无心跳（可能是崩溃）
  recovering     // 从 stale 恢复中
  abandoned      // 终态：放弃恢复（人工介入或超过重试上限）
}

model AgentRun {
  id              String           @id @default(cuid())
  anomalyId       String
  idempotencyKey  String           @unique
  executionStatus ExecutionStatus  @default(starting)
  startedAt       DateTime         @default(now())
  finishedAt      DateTime?
  lastHeartbeatAt DateTime         @default(now())
  recoveredFrom   String?          // 如果是从 stale 恢复来的，指向原 runId
  totalSteps      Int              @default(0)
  totalTokens     Int              @default(0)
  errorCode       String?
  errorMessage    String?

  diagnoses       Diagnosis[]
  toolCalls       ToolCall[]

  @@index([anomalyId])
  @@index([executionStatus])
  @@index([lastHeartbeatAt])
}

model Diagnosis {
  id           String    @id @default(cuid())
  agentRunId   String
  summary      String
  confidence   Float
  createdAt    DateTime  @default(now())

  agentRun     AgentRun  @relation(fields: [agentRunId], references: [id], onDelete: Cascade)

  @@index([agentRunId])
}

model ToolCall {
  id            String    @id @default(cuid())
  agentRunId    String
  toolName      String
  argumentJson  String
  resultJson    String?
  errorCode     String?
  durationMs    Int
  createdAt     DateTime  @default(now())

  agentRun      AgentRun  @relation(fields: [agentRunId], references: [id], onDelete: Cascade)

  @@index([agentRunId])
}
```

**apps/api/src/persistence/entity/execution-status.enum.ts**

```typescript
export enum ExecutionStatus {
  starting = 'starting',
  running = 'running',
  persisting = 'persisting',
  completed = 'completed',
  failed = 'failed',
  stale = 'stale',
  recovering = 'recovering',
  abandoned = 'abandoned',
}

const TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.starting]: [
    ExecutionStatus.running,
    ExecutionStatus.failed,
    ExecutionStatus.stale,
  ],
  [ExecutionStatus.running]: [
    ExecutionStatus.persisting,
    ExecutionStatus.failed,
    ExecutionStatus.stale,
  ],
  [ExecutionStatus.persisting]: [
    ExecutionStatus.completed,
    ExecutionStatus.failed,
    ExecutionStatus.stale,
  ],
  [ExecutionStatus.stale]: [
    ExecutionStatus.recovering,
    ExecutionStatus.abandoned,
  ],
  [ExecutionStatus.recovering]: [
    ExecutionStatus.completed,
    ExecutionStatus.failed,
    ExecutionStatus.abandoned,
  ],
  [ExecutionStatus.completed]: [],
  [ExecutionStatus.failed]: [],
  [ExecutionStatus.abandoned]: [],
}

export function canTransitionTo(
  from: ExecutionStatus,
  to: ExecutionStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: ExecutionStatus): boolean {
  return (
    status === ExecutionStatus.completed ||
    status === ExecutionStatus.failed ||
    status === ExecutionStatus.abandoned
  )
}

export function isRecoverable(status: ExecutionStatus): boolean {
  return status === ExecutionStatus.stale
}
```

**apps/api/src/persistence/entity/agent-run.entity.ts**

```typescript
import { ExecutionStatus, canTransitionTo } from './execution-status.enum'

export interface AgentRunEntity {
  id: string
  anomalyId: string
  idempotencyKey: string
  executionStatus: ExecutionStatus
  startedAt: Date
  finishedAt: Date | null
  lastHeartbeatAt: Date
  recoveredFrom: string | null
  totalSteps: number
  totalTokens: number
  errorCode: string | null
  errorMessage: string | null
}

// 领域方法：判断是否可以转移到目标状态
export function tryTransition(
  run: AgentRunEntity,
  to: ExecutionStatus,
): { ok: true } | { ok: false; reason: string } {
  if (!canTransitionTo(run.executionStatus, to)) {
    return {
      ok: false,
      reason: `illegal transition: ${run.executionStatus} -> ${to}`,
    }
  }
  return { ok: true }
}

// 领域方法：判断是否已心跳超时
export function isHeartbeatExpired(
  run: AgentRunEntity,
  now: Date,
  timeoutMs: number,
): boolean {
  return now.getTime() - run.lastHeartbeatAt.getTime() > timeoutMs
}
```

**apps/api/src/persistence/entity/diagnosis.entity.ts**

```typescript
export interface DiagnosisEntity {
  id: string
  agentRunId: string
  summary: string
  confidence: number
  createdAt: Date
}
```

**apps/api/src/persistence/entity/tool-call.entity.ts**

```typescript
export interface ToolCallEntity {
  id: string
  agentRunId: string
  toolName: string
  argumentJson: string
  resultJson: string | null
  errorCode: string | null
  durationMs: number
  createdAt: Date
}
```

**apps/api/src/persistence/idempotency/idempotency-key.ts**

```typescript
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' }

export function generateFromAnomaly(anomalyId: string): IdempotencyKey {
  if (!anomalyId) {
    throw new Error('anomalyId is required')
  }
  return `anomaly:${anomalyId}` as IdempotencyKey
}

export function generateFromToolCallScope(
  runId: string,
  toolName: string,
  argJson: string,
): IdempotencyKey {
  const argHash = simpleHash(argJson)
  return `toolcall:${runId}:${toolName}:${argHash}` as IdempotencyKey
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}
```

**apps/api/src/persistence/idempotency/idempotency-key.spec.ts**

```typescript
import { describe, expect, it } from 'vitest'
import {
  generateFromAnomaly,
  generateFromToolCallScope,
} from './idempotency-key'

describe('idempotency-key', () => {
  it('相同 anomalyId 生成相同的 key', () => {
    const a = generateFromAnomaly('a-123')
    const b = generateFromAnomaly('a-123')
    expect(a).toBe(b)
  })

  it('不同 anomalyId 生成不同的 key', () => {
    const a = generateFromAnomaly('a-123')
    const b = generateFromAnomaly('a-124')
    expect(a).not.toBe(b)
  })

  it('anomalyId 为空时抛错', () => {
    expect(() => generateFromAnomaly('')).toThrow(/required/)
  })

  it('相同 runId + toolName + argJson 生成相同 key', () => {
    const a = generateFromToolCallScope('r-01', 'getMetrics', '{"id":"srv-042"}')
    const b = generateFromToolCallScope('r-01', 'getMetrics', '{"id":"srv-042"}')
    expect(a).toBe(b)
  })

  it('不同 argJson 生成不同 key', () => {
    const a = generateFromToolCallScope('r-01', 'getMetrics', '{"id":"srv-042"}')
    const b = generateFromToolCallScope('r-01', 'getMetrics', '{"id":"srv-043"}')
    expect(a).not.toBe(b)
  })

  it('key 前缀能识别来源', () => {
    const a = generateFromAnomaly('a-123')
    const b = generateFromToolCallScope('r-01', 'getMetrics', '{}')
    expect(a.startsWith('anomaly:')).toBe(true)
    expect(b.startsWith('toolcall:')).toBe(true)
  })
})
```

**apps/api/src/persistence/idempotency/idempotency.service.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { IdempotencyKey } from './idempotency-key'
import { ExecutionStatus } from '../entity/execution-status.enum'

export type IdempotencyLookupResult =
  | { status: 'new'; runId: null }
  | { status: 'existing'; runId: string; executionStatus: ExecutionStatus }

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(key: IdempotencyKey): Promise<IdempotencyLookupResult> {
    const run = await this.prisma.agentRun.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, executionStatus: true },
    })
    if (!run) return { status: 'new', runId: null }
    return {
      status: 'existing',
      runId: run.id,
      executionStatus: run.executionStatus as ExecutionStatus,
    }
  }

  async reserve(
    key: IdempotencyKey,
    anomalyId: string,
  ): Promise<{ runId: string; created: boolean }> {
    try {
      const run = await this.prisma.agentRun.create({
        data: {
          anomalyId,
          idempotencyKey: key,
          executionStatus: ExecutionStatus.starting,
        },
      })
      return { runId: run.id, created: true }
    } catch (err: any) {
      if (err.code === 'P2002') {
        const existing = await this.prisma.agentRun.findUnique({
          where: { idempotencyKey: key },
          select: { id: true },
        })
        if (existing) return { runId: existing.id, created: false }
      }
      throw err
    }
  }
}
```

**apps/api/src/persistence/transaction/transaction.helper.ts**

```typescript
import { PrismaClient, Prisma } from '@prisma/client'

export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export async function withTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => fn(tx as TxClient),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 30000,
    },
  )
}
```

**apps/api/src/persistence/transaction/agent-run-tx.service.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { AgentTrajectory } from '../../agent/types/agent-trajectory.types'
import { ExecutionStatus, canTransitionTo } from '../entity/execution-status.enum'
import { withTransaction, TxClient } from './transaction.helper'

@Injectable()
export class AgentRunTxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 事务内原子写入 Diagnosis + N 条 ToolCall + 更新 AgentRun 终态
   * 任何一步失败都会回滚全部
   */
  async persistTrajectory(
    runId: string,
    trajectory: AgentTrajectory,
  ): Promise<void> {
    await withTransaction(this.prisma, async (tx) => {
      const current = await tx.agentRun.findUnique({
        where: { id: runId },
        select: { executionStatus: true },
      })
      if (!current) {
        throw new Error(`AgentRun ${runId} not found`)
      }

      if (
        !canTransitionTo(
          current.executionStatus as ExecutionStatus,
          ExecutionStatus.persisting,
        )
      ) {
        throw new Error(
          `illegal transition: ${current.executionStatus} -> persisting`,
        )
      }

      await tx.agentRun.update({
        where: { id: runId },
        data: {
          executionStatus: ExecutionStatus.persisting,
          totalSteps: trajectory.steps.length,
          totalTokens: trajectory.usage.totalTokens,
          lastHeartbeatAt: new Date(),
        },
      })

      await tx.diagnosis.create({
        data: {
          agentRunId: runId,
          summary: trajectory.finalReply,
          confidence: 0.85,
        },
      })

      const toolSteps = trajectory.steps.filter(
        (s) => s.kind === 'tool_call',
      )
      for (const step of toolSteps) {
        await tx.toolCall.create({
          data: {
            agentRunId: runId,
            toolName: step.toolName,
            argumentJson: JSON.stringify(step.arguments),
            resultJson: step.result ? JSON.stringify(step.result) : null,
            errorCode: step.error?.code ?? null,
            durationMs: step.durationMs,
          },
        })
      }

      const terminalStatus =
        trajectory.finishReason === 'completed'
          ? ExecutionStatus.completed
          : ExecutionStatus.failed

      await tx.agentRun.update({
        where: { id: runId },
        data: {
          executionStatus: terminalStatus,
          finishedAt: new Date(),
          errorCode:
            trajectory.finishReason !== 'completed'
              ? trajectory.finishReason
              : null,
        },
      })
    })
  }

  /**
   * 心跳：AgentLoop 每完成一个 step 调用一次，更新 lastHeartbeatAt
   * 让 stale-scanner 知道进程还活着
   */
  async heartbeat(runId: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { lastHeartbeatAt: new Date() },
    })
  }
}
```

**apps/api/src/persistence/transaction/agent-run-tx.service.spec.ts**

```typescript
import { Test } from '@nestjs/testing'
import { AgentRunTxService } from './agent-run-tx.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ExecutionStatus } from '../entity/execution-status.enum'
import type { AgentTrajectory } from '../../agent/types/agent-trajectory.types'

describe('AgentRunTxService', () => {
  let service: AgentRunTxService
  let prisma: PrismaService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [AgentRunTxService, PrismaService],
    }).compile()
    service = module.get(AgentRunTxService)
    prisma = module.get(PrismaService)
  })

  afterEach(async () => {
    await prisma.toolCall.deleteMany({})
    await prisma.diagnosis.deleteMany({})
    await prisma.agentRun.deleteMany({})
  })

  const buildTrajectory = (finishReason: string): AgentTrajectory => ({
    finishReason: finishReason as any,
    finalReply: 'srv-042 CPU 持续超阈值',
    steps: [
      {
        kind: 'tool_call',
        toolName: 'getMetrics',
        arguments: { serverId: 'srv-042' },
        result: { peak: 96.8 },
        error: null,
        durationMs: 120,
      } as any,
      {
        kind: 'tool_call',
        toolName: 'getAlertDetail',
        arguments: { serverId: 'srv-042' },
        result: { threshold: 90 },
        error: null,
        durationMs: 80,
      } as any,
    ],
    usage: { totalTokens: 1250, promptTokens: 800, completionTokens: 450 },
  })

  it('成功时事务提交 Diagnosis 和所有 ToolCall', async () => {
    const run = await prisma.agentRun.create({
      data: {
        anomalyId: 'a-001',
        idempotencyKey: 'anomaly:a-001',
        executionStatus: ExecutionStatus.running,
      },
    })
    await service.persistTrajectory(run.id, buildTrajectory('completed'))

    const updated = await prisma.agentRun.findUnique({ where: { id: run.id } })
    const diagnoses = await prisma.diagnosis.findMany({
      where: { agentRunId: run.id },
    })
    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: run.id },
    })
    expect(updated?.executionStatus).toBe(ExecutionStatus.completed)
    expect(diagnoses).toHaveLength(1)
    expect(toolCalls).toHaveLength(2)
  })

  it('中间失败时事务回滚（Diagnosis 也不应存在）', async () => {
    const run = await prisma.agentRun.create({
      data: {
        anomalyId: 'a-002',
        idempotencyKey: 'anomaly:a-002',
        executionStatus: ExecutionStatus.running,
      },
    })
    const bad = buildTrajectory('completed')
    // 制造违反 NOT NULL 的错：把 toolName 置空
    ;(bad.steps[1] as any).toolName = null

    await expect(service.persistTrajectory(run.id, bad)).rejects.toThrow()

    const diagnoses = await prisma.diagnosis.findMany({
      where: { agentRunId: run.id },
    })
    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: run.id },
    })
    const finalRun = await prisma.agentRun.findUnique({
      where: { id: run.id },
    })
    expect(diagnoses).toHaveLength(0)
    expect(toolCalls).toHaveLength(0)
    // AgentRun 状态回滚到事务开始前的 running（不是 persisting）
    expect(finalRun?.executionStatus).toBe(ExecutionStatus.running)
  })

  it('failed finishReason 落库为 failed', async () => {
    const run = await prisma.agentRun.create({
      data: {
        anomalyId: 'a-003',
        idempotencyKey: 'anomaly:a-003',
        executionStatus: ExecutionStatus.running,
      },
    })
    await service.persistTrajectory(run.id, buildTrajectory('budget_exceeded'))
    const updated = await prisma.agentRun.findUnique({ where: { id: run.id } })
    expect(updated?.executionStatus).toBe(ExecutionStatus.failed)
    expect(updated?.errorCode).toBe('budget_exceeded')
  })

  it('心跳会更新 lastHeartbeatAt', async () => {
    const run = await prisma.agentRun.create({
      data: {
        anomalyId: 'a-004',
        idempotencyKey: 'anomaly:a-004',
        executionStatus: ExecutionStatus.running,
        lastHeartbeatAt: new Date('2026-07-26T14:30:00Z'),
      },
    })
    await service.heartbeat(run.id)
    const updated = await prisma.agentRun.findUnique({ where: { id: run.id } })
    expect(updated!.lastHeartbeatAt.getTime()).toBeGreaterThan(
      new Date('2026-07-26T14:30:00Z').getTime(),
    )
  })
})
```

**apps/api/src/persistence/recovery/recovery.strategy.ts**

```typescript
import { ExecutionStatus } from '../entity/execution-status.enum'
import type { AgentRunEntity } from '../entity/agent-run.entity'

export type RecoveryDecision =
  | { action: 'mark_abandoned'; reason: string }
  | { action: 'retry'; scheduleImmediate: boolean; reason: string }
  | { action: 'skip'; reason: string }

export interface RecoveryContext {
  now: Date
  heartbeatTimeoutMs: number
  maxRetries: number
  currentRetryCount: number
}

/**
 * 纯函数：给定 run 和上下文，决定恢复策略
 * 不查 DB、不发请求，方便单测
 */
export function decideStrategy(
  run: AgentRunEntity,
  ctx: RecoveryContext,
): RecoveryDecision {
  const heartbeatAge = ctx.now.getTime() - run.lastHeartbeatAt.getTime()

  if (run.executionStatus !== ExecutionStatus.stale) {
    return { action: 'skip', reason: `not stale (status=${run.executionStatus})` }
  }

  if (ctx.currentRetryCount >= ctx.maxRetries) {
    return {
      action: 'mark_abandoned',
      reason: `retry count ${ctx.currentRetryCount} >= max ${ctx.maxRetries}`,
    }
  }

  // starting 阶段崩的：还没做任何 LLM 调用，直接重试
  // running 阶段崩的：可能已花钱调过 LLM，谨慎重试
  // persisting 阶段崩的：事务已开始，Prisma 会自动回滚；重试是安全的
  const scheduleImmediate = heartbeatAge < 5 * 60 * 1000

  return {
    action: 'retry',
    scheduleImmediate,
    reason: `stale for ${Math.floor(heartbeatAge / 1000)}s, retry ${ctx.currentRetryCount + 1}/${ctx.maxRetries}`,
  }
}
```

**apps/api/src/persistence/recovery/stale-run-scanner.ts**

```typescript
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ExecutionStatus } from '../entity/execution-status.enum'
import { decideStrategy } from './recovery.strategy'
import type { AgentRunEntity } from '../entity/agent-run.entity'

@Injectable()
export class StaleRunScanner implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleRunScanner.name)
  private readonly heartbeatTimeoutMs = 60_000
  private readonly maxRetries = 2

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting stale run scan on bootstrap')
    await this.scanAndMark()
    await this.applyStrategies()
  }

  /**
   * 第 1 步：把所有心跳超时的非终态 Run 标记为 stale
   */
  async scanAndMark(): Promise<{ marked: number }> {
    const cutoff = new Date(Date.now() - this.heartbeatTimeoutMs)
    const staleCandidates = await this.prisma.agentRun.findMany({
      where: {
        executionStatus: {
          in: [
            ExecutionStatus.starting,
            ExecutionStatus.running,
            ExecutionStatus.persisting,
          ],
        },
        lastHeartbeatAt: { lt: cutoff },
      },
      select: { id: true, executionStatus: true },
    })

    let marked = 0
    for (const run of staleCandidates) {
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          executionStatus: ExecutionStatus.stale,
          errorCode: 'heartbeat_timeout',
          errorMessage: `no heartbeat since ${cutoff.toISOString()}`,
        },
      })
      marked++
      this.logger.warn(
        `Marked stale: runId=${run.id} from ${run.executionStatus}`,
      )
    }
    return { marked }
  }

  /**
   * 第 2 步：对每个 stale run 应用恢复策略
   */
  async applyStrategies(): Promise<{ abandoned: number; retried: number }> {
    const staleRuns = await this.prisma.agentRun.findMany({
      where: { executionStatus: ExecutionStatus.stale },
    })

    let abandoned = 0
    let retried = 0

    for (const raw of staleRuns) {
      const run = raw as unknown as AgentRunEntity
      const retryCount = raw.recoveredFrom
        ? await this.countRetryChain(raw.id)
        : 0

      const decision = decideStrategy(run, {
        now: new Date(),
        heartbeatTimeoutMs: this.heartbeatTimeoutMs,
        maxRetries: this.maxRetries,
        currentRetryCount: retryCount,
      })

      switch (decision.action) {
        case 'mark_abandoned':
          await this.prisma.agentRun.update({
            where: { id: run.id },
            data: {
              executionStatus: ExecutionStatus.abandoned,
              finishedAt: new Date(),
              errorMessage: decision.reason,
            },
          })
          abandoned++
          this.logger.error(
            `Abandoned run ${run.id}: ${decision.reason}`,
          )
          break
        case 'retry':
          await this.prisma.agentRun.update({
            where: { id: run.id },
            data: {
              executionStatus: ExecutionStatus.recovering,
            },
          })
          retried++
          this.logger.log(
            `Marked recovering: ${run.id} (${decision.reason})`,
          )
          break
        case 'skip':
          break
      }
    }
    return { abandoned, retried }
  }

  private async countRetryChain(runId: string): Promise<number> {
    let count = 0
    let current: string | null = runId
    while (current) {
      const run = await this.prisma.agentRun.findUnique({
        where: { id: current },
        select: { recoveredFrom: true },
      })
      if (!run?.recoveredFrom) break
      count++
      current = run.recoveredFrom
    }
    return count
  }
}
```

**apps/api/src/persistence/recovery/stale-run-scanner.spec.ts**

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { decideStrategy } from './recovery.strategy'
import { ExecutionStatus } from '../entity/execution-status.enum'
import type { AgentRunEntity } from '../entity/agent-run.entity'

const baseRun: AgentRunEntity = {
  id: 'r-01',
  anomalyId: 'a-001',
  idempotencyKey: 'anomaly:a-001',
  executionStatus: ExecutionStatus.stale,
  startedAt: new Date('2026-07-26T14:00:00Z'),
  finishedAt: null,
  lastHeartbeatAt: new Date('2026-07-26T14:29:00Z'),
  recoveredFrom: null,
  totalSteps: 0,
  totalTokens: 0,
  errorCode: null,
  errorMessage: null,
}

describe('decideStrategy', () => {
  it('stale + 未达重试上限 → retry', () => {
    const decision = decideStrategy(baseRun, {
      now: new Date('2026-07-26T14:30:00Z'),
      heartbeatTimeoutMs: 60_000,
      maxRetries: 2,
      currentRetryCount: 0,
    })
    expect(decision.action).toBe('retry')
  })

  it('stale + 达到重试上限 → abandon', () => {
    const decision = decideStrategy(baseRun, {
      now: new Date('2026-07-26T14:30:00Z'),
      heartbeatTimeoutMs: 60_000,
      maxRetries: 2,
      currentRetryCount: 2,
    })
    expect(decision.action).toBe('mark_abandoned')
  })

  it('非 stale 状态 → skip', () => {
    const decision = decideStrategy(
      { ...baseRun, executionStatus: ExecutionStatus.completed },
      {
        now: new Date('2026-07-26T14:30:00Z'),
        heartbeatTimeoutMs: 60_000,
        maxRetries: 2,
        currentRetryCount: 0,
      },
    )
    expect(decision.action).toBe('skip')
  })

  it('心跳超时 < 5min → 立即重试', () => {
    const decision = decideStrategy(baseRun, {
      now: new Date('2026-07-26T14:32:00Z'),
      heartbeatTimeoutMs: 60_000,
      maxRetries: 2,
      currentRetryCount: 0,
    })
    if (decision.action !== 'retry') throw new Error('expected retry')
    expect(decision.scheduleImmediate).toBe(true)
  })

  it('心跳超时 > 5min → 延迟重试', () => {
    const decision = decideStrategy(baseRun, {
      now: new Date('2026-07-26T14:40:00Z'),
      heartbeatTimeoutMs: 60_000,
      maxRetries: 2,
      currentRetryCount: 0,
    })
    if (decision.action !== 'retry') throw new Error('expected retry')
    expect(decision.scheduleImmediate).toBe(false)
  })
})
```

**apps/api/src/persistence/persistence.service.ts（v3 全文）**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AgentTrajectory } from '../agent/types/agent-trajectory.types'
import { IdempotencyService } from './idempotency/idempotency.service'
import { generateFromAnomaly } from './idempotency/idempotency-key'
import { AgentRunTxService } from './transaction/agent-run-tx.service'
import { ExecutionStatus } from './entity/execution-status.enum'

export type PersistResult =
  | { runId: string; created: true }
  | { runId: string; created: false; reason: 'already_exists' }

@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly agentRunTx: AgentRunTxService,
  ) {}

  async reserveRun(anomalyId: string): Promise<PersistResult> {
    const key = generateFromAnomaly(anomalyId)
    const lookup = await this.idempotency.lookup(key)
    if (lookup.status === 'existing') {
      return {
        runId: lookup.runId,
        created: false,
        reason: 'already_exists',
      }
    }
    const { runId, created } = await this.idempotency.reserve(key, anomalyId)
    if (!created) {
      return { runId, created: false, reason: 'already_exists' }
    }
    return { runId, created: true }
  }

  async markRunning(runId: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        executionStatus: ExecutionStatus.running,
        lastHeartbeatAt: new Date(),
      },
    })
  }

  async heartbeat(runId: string): Promise<void> {
    await this.agentRunTx.heartbeat(runId)
  }

  async finalize(
    runId: string,
    trajectory: AgentTrajectory,
  ): Promise<void> {
    try {
      await this.agentRunTx.persistTrajectory(runId, trajectory)
    } catch (err: any) {
      this.logger.error(
        `persistTrajectory failed for ${runId}: ${err.message}`,
      )
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          executionStatus: ExecutionStatus.failed,
          finishedAt: new Date(),
          errorCode: 'persist_error',
          errorMessage: err.message.slice(0, 500),
        },
      })
      throw err
    }
  }
}
```

**apps/api/src/persistence/persistence.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { PersistenceService } from './persistence.service'
import { IdempotencyService } from './idempotency/idempotency.service'
import { AgentRunTxService } from './transaction/agent-run-tx.service'
import { StaleRunScanner } from './recovery/stale-run-scanner'

@Module({
  imports: [PrismaModule],
  providers: [
    PersistenceService,
    IdempotencyService,
    AgentRunTxService,
    StaleRunScanner,
  ],
  exports: [PersistenceService],
})
export class PersistenceModule {}
```

**apps/api/src/persistence/index.ts**

```typescript
export { PersistenceModule } from './persistence.module'
export { PersistenceService } from './persistence.service'
export type { PersistResult } from './persistence.service'
export { generateFromAnomaly } from './idempotency/idempotency-key'
export { ExecutionStatus } from './entity/execution-status.enum'
```

**agent-loop.engine.ts 的改动**（Day 12 的引擎结束时调持久化）

```typescript
// apps/api/src/agent/loop/agent-loop.engine.ts（片段）
async run(anomalyId: string, config: AgentRunConfig): Promise<AgentTrajectory> {
  const { runId, created } = await this.persistence.reserveRun(anomalyId)
  if (!created) {
    // 重复触发：直接返回已有 Run 的状态
    return this.loadExistingTrajectory(runId)
  }

  await this.persistence.markRunning(runId)

  const trajectory: AgentTrajectory = {
    runId,
    steps: [],
    finishReason: 'running',
    startedAt: new Date().toISOString(),
  }
  try {
    while (!this.shouldStop(trajectory)) {
      const step = await this.executeStep(trajectory, config)
      trajectory.steps.push(step)
      await this.persistence.heartbeat(runId)
    }
    trajectory.finishReason = trajectory.finishReason === 'running' ? 'completed' : trajectory.finishReason
    await this.persistence.finalize(runId, trajectory)
    return trajectory
  } catch (err) {
    await this.persistence.finalize(runId, { ...trajectory, finishReason: 'error' } as any)
    throw err
  }
}
```

### 5.4 v3 用到的知识点

1. **幂等键（Idempotency Key）—— 防重放的合同**
   - 解决的问题：同一 anomaly 被 webhook 重复推送、前端重复点击、消息队列 at-least-once 投递
   - 运行机制：客户端/上游在业务语义上生成一个稳定 key（如 `anomaly:{anomalyId}`），服务端用唯一约束保证同 key 最多一个成功记录；重复请求返回相同 runId 而不新建
   - 项目落点：`idempotency-key.ts` 定义规则、`idempotency.service.ts` 查询/占位、`schema.prisma` 的 `@unique` 兜底
   - 生产误区：把 `Date.now()` 塞进 key（永远不重复=永远不幂等）；用请求体哈希做 key（正常业务的两次不同请求也会撞）；只在应用层查不设 DB 唯一约束（并发时两个连接都查不到、都写入）
   - 验证方法：`for i in {1..1000}; do curl -X POST /agent/anomaly-hook -d '{"anomalyId":"a-001"}'; done` 后 `SELECT count(*) FROM agent_runs WHERE anomaly_id='a-001'` 应该 = 1

2. **幂等键的确定性（Pure Function 生成）**
   - 解决的问题：如果 key 生成依赖时间、依赖 UUID、依赖数据库自增 ID，重复请求就不再重复
   - 运行机制：key 只由业务语义字段决定（`anomalyId` / `runId+toolName+argHash`），生成函数是纯函数，可 100% 单元测试
   - 项目落点：`idempotency-key.ts` 里没有 `new Date()` / `Math.random()` / `import { PrismaService }`
   - 生产误区：把哈希盐（salt）设成运行时随机值（重启后哈希就变了）；用 `JSON.stringify(obj)` 直接哈希（key 顺序不同导致哈希不同）
   - 验证方法：`generateFromAnomaly('a-001')` 调 1000 次结果全一致；`spec` 文件里断言相同输入必然相同输出

3. **执行状态的显式化（8 个状态而不是 boolean）**
   - 解决的问题：用 `completed: boolean` 无法区分"未完成"和"完成但失败"和"崩溃后未恢复"；用 String 允许任意字符串（`'runing'` 拼错永远发现不了）
   - 运行机制：Prisma enum + TypeScript enum 双端约束；状态转移矩阵集中定义（`TRANSITIONS`），非法转移编译期不报但运行期抛错
   - 项目落点：`execution-status.enum.ts` 定义 8 个状态 + `canTransitionTo` + `isTerminal` + `isRecoverable`；DB migration 用 `CREATE TYPE`
   - 生产误区：中间态和终态混在一个枚举里但没有 `isTerminal` 辅助函数（业务代码到处 `if (status === 'completed' || status === 'failed' || ...)`）；把 `stale` 当成终态但又允许它转 `recovering`（矛盾）
   - 验证方法：`canTransitionTo(ExecutionStatus.completed, ExecutionStatus.running)` 必须返回 false；`isTerminal(ExecutionStatus.stale)` 必须返回 false（stale 是可恢复的中间态）

4. **事务边界的物理位置（`transaction/` 子目录）**
   - 解决的问题：如果事务边界糊在 `controller` 上（"这个 endpoint 是事务的"），业务重构时（新增内部调用）就把非事务代码拉进事务里；如果糊在 `service` 上，一个 service 方法同时承担业务编排和事务边界，无法复用
   - 运行机制：把"哪些写入必须原子"这件事本身当成一个显式的领域概念，放到独立文件 `agent-run-tx.service.ts`；`withTransaction<T>` 泛型 helper 把 Prisma 的 `$transaction` 封装成"传入回调 → 回调收到 tx client → 返回值透传"
   - 项目落点：`transaction/agent-run-tx.service.ts` 的 `persistTrajectory`；一个方法就是一个事务；service 里其他方法不进事务
   - 生产误区：在 controller 里手动 `prisma.$transaction([...])`；事务里 `await` 外部 HTTP 调用（HTTP 慢，事务锁持有过久，其他连接阻塞）；事务里读一遍再写（应该用 `SELECT ... FOR UPDATE` 或 Serializable 隔离）
   - 验证方法：单测里制造中途失败（比如把某字段设成 null 违反 NOT NULL），断言事务前的行没被修改、事务中的 Diagnosis/ToolCall 全部不存在

5. **隔离级别（Serializable vs ReadCommitted）**
   - 解决的问题：默认 ReadCommitted 下，两个并发事务可以同时读同一 Run、都判断"没有 Diagnosis"、都写入 → 两条 Diagnosis
   - 运行机制：Serializable 保证事务串行化等效于按某个顺序单线程执行；Prisma 里用 `isolationLevel: Prisma.TransactionIsolationLevel.Serializable`
   - 项目落点：`transaction.helper.ts` 的 `withTransaction` 默认用 Serializable
   - 生产误区：不指定隔离级别（用 Postgres 默认的 ReadCommitted，并发下"检查后写入"的模式必然出问题）；Serializable 抛 `serialization failure` 后不重试（导致业务偶发失败）；无脑用 Serializable（读多写少的场景性能损失大，应该在具体的写路径用）
   - 验证方法：手写并发测试用两个 `Promise.all` 同时启动两个事务，操作同一 Run；ReadCommitted 时两个都成功但产生脏数据，Serializable 时一个成功一个抛错（触发重试）

6. **进程重启即扫描（`OnApplicationBootstrap` vs cron）**
   - 解决的问题：进程崩溃后重启，如果不主动扫描"有哪些 Run 卡在 running 状态"，这些 Run 永远不会被处理，前端一直显示"进行中"
   - 运行机制：`OnApplicationBootstrap` 是 NestJS 生命周期钩子，在所有模块 init 完成后触发；比 `OnModuleInit` 晚，能保证 Prisma 已连通；扫描逻辑分两步：先把心跳超时的 Run 从 running/starting/persisting 标记为 stale，再对每个 stale 应用恢复策略
   - 项目落点：`stale-run-scanner.ts` 的 `onApplicationBootstrap`；`main.ts` 里 `await app.listen()` 之前 NestJS 会自动调用
   - 生产误区：用 cron 每 5 分钟扫一次（进程崩溃后重启不一定对齐 cron 窗口，可能延迟 5 分钟才发现 stale）；扫描时直接删 stale Run（丢失事故排查证据）；把扫描逻辑放 `OnModuleInit`（此时 Prisma 可能还没连上，`findMany` 抛错）
   - 验证方法：单测 mock `Date.now()` 为超时后的时间，断言 scanner 的 `scanAndMark` 返回的 marked 数 = 预期；集成测试启动进程时插入几条 lastHeartbeatAt 超时的 Run，重启后断言这些 Run 状态变为 stale/abandoned/recovering

7. **心跳（Heartbeat）机制**
   - 解决的问题：如何区分"Run 卡了很久还在跑"和"进程崩了 Run 死了"？只看 `startedAt` 会误杀慢查询；引入 `lastHeartbeatAt`，每完成一步更新一次
   - 运行机制：AgentLoop 在每个 step 结束时调 `persistence.heartbeat(runId)`；scanner 用 `now - lastHeartbeatAt > 60s` 判定 stale
   - 项目落点：`AgentRunTxService.heartbeat`、`AgentLoopEngine.run` 循环体
   - 生产误区：心跳间隔太长（超过 stale 超时阈值 = 永远 stale）；心跳失败没 log（DB 短暂不可达时心跳静默失败，误判进程崩溃）；心跳在事务里做（心跳很频繁，占用事务连接池）
   - 验证方法：跑一个 60 秒的 Agent Loop，DB 里应该看到 `lastHeartbeatAt` 每几秒变化一次；kill -9 进程后重启，scanner 应该在 1 分钟内标记出所有卡住的 Run

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 循环结束一次性写 3 张表 | v1 + 幂等键 + 执行状态枚举 | v2 + 事务边界 + 心跳 + 启动扫描恢复 |
| **事件类型 / 数据模型** | 3 张基础表（AgentRun/Diagnosis/ToolCall） | +`idempotencyKey @unique` +`executionStatus` enum(5) | +`lastHeartbeatAt` +`recoveredFrom` +`executionStatus` enum(8, 含 stale/recovering/abandoned) |
| **状态存储** | Postgres 但无约束 | Postgres + 唯一索引 + enum 类型 | Postgres + 唯一索引 + enum + 心跳字段 + 恢复链引用 |
| **归约逻辑** | 顺序 create 3 个模型；无回滚 | 先查幂等键，找到就返回；找不到 create | reserveRun → markRunning → heartbeat×N → `$transaction`(persistTrajectory) |
| **可测试** | 只能集成测（依赖 DB） | idempotency-key 纯函数可 100% 单测 | idempotency-key / recovery.strategy 纯函数可 100% 单测；tx.service 用事务隔离级别测中间失败回滚 |
| **架构层次** | 单文件 service | service + idempotency 子目录 | service + idempotency + transaction + recovery + entity 完整分层 |
| **换事件源代价** | 高（写库逻辑混在业务里，换库要重写） | 中（idempotency 单独可复用，写库仍混在业务里） | 低（transaction/recovery/entity 都是纯 Prisma 抽象，换 MongoDB 只需重写 tx.helper） |
| **编译期抓遗漏** | 无（所有字段都是 string） | 部分（enum 严格） | 全（enum + `canTransitionTo` 状态机 + branded IdempotencyKey） |
| **对齐后续 Day** | 无——直接扔 v1 会被 Day 14 (LangChain) 打回来 | 部分——LangChain 复用幂等键概念 | 完整——Day 14 的 RAG 索引更新用同款幂等键 / Day 30 M3 门禁要求 status 8 态齐全 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

**为什么单独抽出来**：今天的持久化 / 幂等 概念虽然主要在后端，但前端上有 3 个直接对应的知识点：
1. WebSocket 断线重连的幂等（消息 sequence 去重）
2. 幂等在浏览器端的对应：表单提交按钮的 disabled 状态、`AbortController` 取消 fetch 后重试的 idempotency
3. 前端如何展示 8 态 `executionStatus`（不能只 `if (status === 'completed')`，会漏 5 种状态）

**深挖文档**：`output/Day13深挖-前端底子补弱.html`

包含以下 6 项深挖内容（每项 8 子节：场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法）：

- 深挖 1：`fetch` + `AbortController` + 幂等键——重复提交怎么设计
- 深挖 2：WebSocket 断线重连——消息序号（sequence）去重
- 深挖 3：TypeScript 判别联合表达 8 态 `executionStatus`（穷举检查）
- 深挖 4：前端如何显示"进行中"vs"stale"vs"recovering"——三种 loading 状态
- 深挖 5：乐观 UI 更新 + 服务端幂等回执——先渲染再落库
- 深挖 6：`Set<string>` 缓存已发送的幂等键——前端本地去重

打开 `output/Day13深挖-前端底子补弱.html` 边读边对着自己项目思考。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按第 5.3 节已给的测试文件，在项目里落盘：

- `apps/api/src/persistence/idempotency/idempotency-key.spec.ts`（6 个用例，纯函数，无需 DB）
- `apps/api/src/persistence/transaction/agent-run-tx.service.spec.ts`（4 个用例，需要 DB，用 vitest + testcontainers 或本地 Postgres）
- `apps/api/src/persistence/recovery/stale-run-scanner.spec.ts`（5 个用例，纯函数）

运行：

```bash
pnpm --filter api test persistence
```

期望：15 个用例全绿。

**边测边问自己**：
- 幂等键的两个 `spec` 用例（相同输入 vs 不同输入）为什么必须都覆盖？（只测一个方向的话，`return "constant"` 也能通过"相同输入相同输出"）
- 事务回滚测试为什么要断言 `AgentRun.executionStatus === 'running'` 而不是 `'persisting'`？（事务开始时把状态更新到 persisting，但事务回滚会把这个 update 也回滚，所以状态回到事务开始前的 running）

### 7.7 F-1：反证实验 1（5 分钟）—— 手动删掉幂等键唯一约束

**目的**：验证"没有唯一约束"时是什么样子，加深"应用层查 + DB 唯一约束"两层都必要的理解。

步骤：

```bash
# 1. 暂时移除唯一约束
pnpm --filter api prisma studio  # 或者手动改 schema.prisma 把 @unique 去掉
# 修改 schema.prisma:
#   idempotencyKey  String   // 去掉 @unique
pnpm --filter api prisma migrate dev --name remove_unique_for_test

# 2. 用并发脚本触发
cat > /tmp/burst.js <<'EOF'
async function burst() {
  await Promise.all(
    Array.from({ length: 100 }).map(() =>
      fetch('http://localhost:3000/agent/anomaly-hook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ anomalyId: 'a-burst-001', serverId: 'srv-042' }),
      }),
    ),
  )
}
burst()
EOF
node /tmp/burst.js

# 3. 查库
psql $DATABASE_URL -c "SELECT count(*) FROM agent_runs WHERE anomaly_id = 'a-burst-001';"
# 预期：应该是 1，实际（去掉唯一约束后）可能是 10+
```

**观察到的现象**：并发下应用层 `SELECT` 和 `INSERT` 之间有窗口，多个连接同时查不到、同时写入。

**恢复现场**：

```bash
git checkout apps/api/prisma/schema.prisma
pnpm --filter api prisma migrate dev --name restore_unique
```

### 7.8 F-2：反证实验 2（5 分钟）—— 去掉 `$transaction` 包裹

**目的**：验证"没有事务边界"时部分写入产生脏数据的具体形态。

步骤：

```typescript
// 临时改 agent-run-tx.service.ts 的 persistTrajectory：
async persistTrajectory(runId, trajectory) {
  // ❌ 反证：不用事务
  await this.prisma.agentRun.update({ where: { id: runId }, data: { executionStatus: 'persisting' } })
  await this.prisma.diagnosis.create({ data: { agentRunId: runId, summary: '...', confidence: 0.85 } })
  // 制造错误：故意让第二个 toolCall 违反 NOT NULL
  await this.prisma.toolCall.create({ data: { agentRunId: runId, toolName: null as any, /* ... */ } })
  await this.prisma.agentRun.update({ where: { id: runId }, data: { executionStatus: 'completed' } })
}
```

```bash
# 触发一次 Agent Run
curl -X POST http://localhost:3000/agent/anomaly-hook -d '{"anomalyId":"a-tx-test"}'

# 查库
psql $DATABASE_URL -c "SELECT id, execution_status FROM agent_runs WHERE anomaly_id='a-tx-test';"
# 预期：executionStatus = 'persisting'（卡在中间态）
psql $DATABASE_URL -c "SELECT count(*) FROM diagnoses WHERE agent_run_id='<runId>';"
# 结果：1 条（脏数据：Diagnosis 存在，但 ToolCall 缺失）
psql $DATABASE_URL -c "SELECT count(*) FROM tool_calls WHERE agent_run_id='<runId>';"
# 结果：0 条
```

**观察到的现象**：Diagnosis 有 1 条，ToolCall 有 0 条，AgentRun 卡在 `persisting` 永远不再更新。前端查 Run 详情会显示"部分内容"，运维排查会以为诊断已完成但工具从没跑。

**恢复现场**：`git checkout apps/api/src/persistence/transaction/agent-run-tx.service.ts`

### 7.9 F-3：验证 + 提交（10 分钟）

四件套：

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter api test
pnpm --filter api build
```

全绿后提交（Conventional Commits + `Refs: Day13`）：

```bash
git add apps/api/src/persistence apps/api/prisma/schema.prisma apps/api/prisma/migrations
git status                     # ← 检查是否混入了不相关的改动
git commit -m "feat(persistence): implement AgentRun/Diagnosis/ToolCall persistence with idempotency, transaction boundary and stale-run recovery

- add idempotency-key pure function + service (unique constraint at DB layer)
- add ExecutionStatus enum with 8 states + canTransitionTo
- add AgentRunTxService.persistTrajectory with prisma.\$transaction (Serializable isolation)
- add StaleRunScanner on OnApplicationBootstrap (heartbeat timeout=60s)
- add heartbeat mechanism updating lastHeartbeatAt every step
- add recovery.strategy pure function (retry/abandon/skip)

Refs: Day13"
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day14 结束时集中 push。

---

## 8. 通过标准

- [ ] `apps/api/prisma/schema.prisma` 新增 3 张表 + `ExecutionStatus` enum(8) + `idempotencyKey @unique` + `lastHeartbeatAt`
- [ ] `pnpm --filter api prisma migrate dev` 成功，生成的 SQL 里能找到 `CREATE UNIQUE INDEX` 和 `CREATE TYPE ExecutionStatus`
- [ ] `apps/api/src/persistence/` 下 4 个子目录（entity/idempotency/transaction/recovery）+ 3 个顶层文件（service/module/index）齐全
- [ ] `pnpm --filter api test persistence` 全部通过（15 个用例）
- [ ] 反证 1：删掉 `@unique` 后并发触发 100 次 Webhook，产生多条 Run（观察到"没有唯一约束就会脏"）
- [ ] 反证 2：去掉 `$transaction` 后单次 Run 部分失败，AgentRun 卡在 `persisting`，Diagnosis 存在但 ToolCall 缺失
- [ ] 手动 kill -9 进程重启后，`StaleRunScanner` 在 bootstrap 阶段能标记所有心跳超时的 Run 为 `stale/recovering/abandoned`
- [ ] commit message 包含 `Refs: Day13`
- [ ] 没有 `git push`

---

## 9. 提交物

- **代码 diff**：`git diff main..HEAD -- apps/api/src/persistence apps/api/prisma`
- **测试输出**：`pnpm --filter api test persistence` 的完整日志（15 个 PASS）
- **学习日志**：`docs/learning-log/Day13.md`（本次的核心决策：为什么选 Serializable，为什么心跳是 60 秒，为什么扫描在 bootstrap 而不是 cron）
- **架构证据**：`docs/architecture-evidence/Day13-persistence.md`（画出 Agent Loop → PersistenceService → 3 张表的时序图，标出事务边界）
- **反证记录**：`docs/anti-proof/Day13-no-unique.md` 和 `Day13-no-transaction.md`（截图 + 说明）
- **AI Review 记录**：`docs/ai-review/Day13.md`（列出所有 AI 生成的代码片段、接受/修改/拒绝的理由；核心事务和状态机代码是自己实现还是 AI 生成需要标注）

---

## 10. 课末 3 个核心问题

1. **数据流 / 控制流**：请从今天项目的真实入口（Webhook `POST /agent/anomaly-hook`）到最终输出（Postgres 里 AgentRun/Diagnosis/ToolCall 三张表 + 前端 `/agent/runs/:id` 页面），解释"持久化/幂等"的数据流或控制流。当天知识链（**事务、幂等键、执行状态、部分失败、恢复**）分别在哪一层起作用？为什么按 v1→v2→v3 这个顺序学习——先跳过幂等直接上事务会踩什么坑？

2. **反证与修复**：如果故意移除今天最关键的保护机制（分别做两次反证：去掉幂等键唯一约束 / 去掉 `$transaction` 包裹），线上会出现什么可观察现象（前端页面看到什么、`SELECT count(*)` 查到什么、日志里看到什么）？请给出**最小复现**（curl 命令 / 并发脚本）、**定位证据**（`psql` 查询 / 日志片段）、**恢复动作**（rollback migration / 回退代码）和**一条防复发测试**（放到哪个 spec 文件里，断言什么）？

3. **达标证据 + 演进路径**：请引用今天的具体代码（哪个文件的哪个方法）、测试（哪个 `spec.ts` 的哪个 `it`）和架构证据（时序图 / 依赖方向图），证明项目目标（同 anomaly 不产生两条有效诊断、四个故障点可恢复/重试）已经达到；再说明当前实现距离企业生产标准还缺什么（例如：分布式事务？跨库幂等？TTL 清理归档？多租户隔离？），下一步如何演进而不破坏已有合同（Day 14 之后的路径）？

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **并发重复触发导致双诊断**
   同一 anomaly 被并发触发两次，生成两条"有效"Diagnosis；其中一次 ToolCall 已落库但 AgentRun 仍为 `starting`。请用**幂等键**、**事务日志**和**状态时间线**定位；先按 anomaly 锁定新触发止损，再设计**唯一约束**与**事务边界**，重复提交 1,000 次验证仅一个有效结果。回答必须按"**定位证据 → 临时止损 → 根因修复 → 回归验证**"组织。
   依据：[S25 PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

2. **进程崩溃导致状态错位**
   进程在 `Diagnosis` 写入后、`ToolCall` 状态更新前崩溃，重启后 UI 显示完成但工具仍运行。请在四个执行阶段（starting / running / persisting / after-commit）注入 crash，收集 DB 快照与恢复决策；先把不一致 Run 标记为**待恢复**，再实现显式**执行状态**和**补偿/重试**，验证每个故障点都有确定终态。回答必须按"**定位证据 → 临时止损 → 根因修复 → 回归验证**"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

**知识映射**：事务、幂等键、执行状态、部分失败和重启恢复。

---

## 12. PDF 面试题

1. 全栈开发中，如何设计数据库表结构以应对高频读写？
   来源：《2026 美团前端全栈开发》，第 9 页。
2. 数据库事务的 ACID 特性是什么？
   来源：《2026 美团前端全栈开发》，第 9 页。

**题目说明**：对应 AgentRun/Diagnosis/ToolCall 持久化、事务边界和失败一致性；第二题是原文追问。

> ⚠️ **注意**：本 PDF 面试题**文件名不等于官方题库**。文件是社区整理的模拟面试资料，题目内容仅供学习练习，不代表美团官方招聘的实际考题。请以自己在项目中形成的真实理解为准，不要死记答案。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"**局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进**"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见 [《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

参考方向（教师会根据 diff 挑其中 2-3 个继续追问）：

- 局部机制：`generateFromAnomaly` 里为什么 anomalyId 空串抛错而不是返回 null？如果上游允许空 anomaly（比如手动触发的诊断），怎么改？
- 边界一致性：`persistTrajectory` 里为什么先 update 到 persisting 再写子表？先写子表再更新状态可以吗？两种方案下崩溃时的可恢复性差在哪？
- 线上事故：如果 Postgres 主库宕机，`StaleRunScanner` 在从库启动时会做什么？会把还在跑的 Run 误判为 stale 吗？
- 工程权衡：Serializable 隔离级别 vs 应用层 `SELECT ... FOR UPDATE`，为什么这个项目选前者？如果 QPS 上到 1000 需要切换吗？
- 架构演进：Day 30 M3 门禁要求 Diagnosis 支持"版本演进"（同一 anomaly 多次诊断，每次生成新版本，历史版本可查），今天的 schema 需要怎么改？会破坏现有幂等键设计吗？

---

## 14. 本 Day 在 90 天路线中的锚点

- **前置**：Day 07 Prisma + Postgres / Day 11 Tool Registry / Day 12 Agent Loop
- **本日**：持久化 / 幂等（事务边界 + 执行状态 + 恢复扫描）
- **后置**：
  - **Day 14** LangChain 集成——RAG 索引更新需要幂等键（"同一文档只入库一次"）
  - **Day 15-20** 向量检索 / Rerank——检索结果落库仍走 PersistenceService
  - **Day 30** M3 门禁 (架构证据)——要求 8 态 `executionStatus` 齐全，可查任意 Run 的完整链路
  - **Day 60** M4 门禁 (可运维性)——Stale scanner + 补偿策略是可运维性的核心证据

**今天定义的合同**（其他 Day 会依赖）：

- `IdempotencyKey` 生成规则（`anomaly:{id}` / `toolcall:{runId}:{tool}:{argHash}`）
- `ExecutionStatus` 8 态枚举 + `canTransitionTo` 转移矩阵
- `AgentRunTxService.persistTrajectory` 事务边界（Diagnosis + ToolCall 原子写）
- `StaleRunScanner.onApplicationBootstrap` 启动扫描时机
- `RecoveryStrategy.decideStrategy` 纯函数策略接口

Day 14 之后的 RAG / LangChain / LangGraph 都会复用这些合同。
