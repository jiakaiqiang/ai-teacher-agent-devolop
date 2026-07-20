# Day 34：失败恢复（Retry taxonomy + 补偿 + Poison event + 恢复点 + 重放）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

任务版本：标准版
日期与时长：2026-08-16 周日，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 33 Durable HITL 后，第一次面对"工具超时、模型失败、队列重启、重复执行"四类失败场景，需要建立统一恢复策略的全栈开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-30：全栈基础 + M3 月度门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 全栈深化 + Agent 编排
   Day 31：Tool Registry v2（多租户 + 版本治理）
   Day 32：Orchestrator（Plan-Act-Observe + 并行）
   Day 33：Durable HITL（持久化审批 + 租约 + 乐观锁）
   Day 34：失败恢复（Retry + 补偿 + Poison event）  ← 今天在这里
   Day 35-40：LangGraph 状态机编排
   Day 41-50：RAG 深化 + Hybrid Search
   Day 51-60：可观测性 + M6 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 34 在阶段二第 4 天**。Day 32 实现了 Orchestrator（Plan-Act-Observe 循环 + 并行执行）、Day 33 实现了 Durable HITL（持久化审批 + 租约防重复执行），但没有处理"工具超时"、"模型失败"、"队列重启"、"重复执行"四类失败场景。今天要建立 **统一失败恢复策略**：区分可重试 vs 不可重试错误、补偿机制（rollback）、Poison event 隔离（DLQ）、恢复点（checkpoint）防止重复执行、事件重放（replay）保证一致性。

### 到 Day 33 结束时项目已具备的能力

- **Orchestrator**（Day 32）：Plan-Act-Observe 循环 + 并行执行 + 循环检测 + 预算追踪
- **Durable HITL**（Day 33）：持久化审批 + 租约防重复执行 + 乐观锁防双审批 + 服务重启恢复
- **队列**（Day 29）：BullMQ jobId 幂等 + 重试退避 + 死信
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除

### 今天要解决的 5 个问题

1. **问题 1：工具超时后无限重试（不区分可重试 vs 不可重试错误）**
   工具调用外部 API（例如查询服务器指标），API 超时返回 504。队列默认重试 3 次，但 3 次都超时（因为外部 API 挂了），最终失败。但如果是"参数错误"（例如 serverId 格式错误），重试 100 次也不会成功，应该立即失败。**如何区分可重试 vs 不可重试错误？**

2. **问题 2：模型失败后没有补偿机制（已执行的工具不回滚）**
   Agent 执行了 3 个工具（重启服务器 → 清空缓存 → 发送告警），第 4 个工具（模型生成诊断报告）失败。前 3 个工具已经执行（服务器已重启、缓存已清空、告警已发送），但第 4 个工具失败导致整个 Run 失败。用户重试时，前 3 个工具会再执行一次（服务器重复重启、告警重复发送）。**如何补偿（rollback）已执行的工具？**

3. **问题 3：Poison event 拖垮正常流量（格式错误的事件重试 100 次）**
   队列里有一个格式错误的事件（例如 toolArgs 不是 JSON），worker 重试 100 次都失败（因为格式错误无法修复）。这个事件占用 worker，导致正常事件排队等待（队列积压从 800 增至 6 万）。**如何隔离 Poison event？**

4. **问题 4：恢复点缺失导致重复执行（工具已执行但 checkpoint 未写入）**
   工具执行成功（例如支付查询），但 worker 在写 checkpoint 前崩溃。队列重启后，从上一个 checkpoint 恢复，重新执行工具，导致外部 API 重复调用（支付查询执行 2 次，外部计费 2 次）。**如何用恢复点（checkpoint）防止重复执行？**

5. **问题 5：事件重放不幂等（重放时产生副作用）**
   队列重启后，从 checkpoint 重放事件（replay），但重放时产生了副作用（例如重复发送告警、重复写入 DB）。**如何保证事件重放幂等？**

---
## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付 **失败恢复模块**：为 Tool/模型/队列建立统一恢复策略，包含"可重试 vs 不可重试错误分类 + 补偿机制（rollback）+ Poison event 隔离（DLQ）+ 恢复点（checkpoint）+ 事件重放幂等性"。

### 1.1 用户能看到什么

**场景 1：工具超时（可重试错误）**

```
14:30:00.000  Agent 调用 getMetrics(srv-042)
  → 外部 API 超时（504 Gateway Timeout）
  → 队列：识别为"可重试错误"（Transient），延迟 30 秒后重试
  → 30 秒后重试成功

用户观察：Agent 对话框显示"正在查询指标..."（30 秒），然后显示结果
```

**场景 2：参数错误（不可重试错误）**

```
14:31:00.000  Agent 调用 getMetrics('invalid-server-id')
  → 工具返回错误：Invalid serverId format
  → 队列：识别为"不可重试错误"（Permanent），立即失败，不重试
  → 进入死信队列（DLQ）

用户观察：Agent 对话框立即显示"参数错误，请检查服务器 ID 格式"
```

**场景 3：Poison event 隔离**

```
14:32:00.000  队列收到格式错误的事件（toolArgs 不是 JSON）
  → worker 尝试解析失败
  → 队列：识别为"Poison event"（重试 3 次后仍失败）
  → 移入隔离队列（poison-queue），发送告警
  → 正常事件继续处理（不受影响）

运维观察：监控面板显示"1 个 poison event 被隔离"
```

**场景 4：补偿机制（rollback）**

```
14:33:00.000  Agent 执行 3 个工具（重启服务器 → 清空缓存 → 发送告警）
  → 第 3 个工具失败
  → 触发补偿：撤销前 2 个工具的副作用
    - 撤销"重启服务器"：恢复服务器到重启前状态（无法完全撤销，只能记录日志）
    - 撤销"清空缓存"：无法撤销（缓存已清空）
    - 撤销"发送告警"：发送"取消告警"通知

用户观察：Agent 对话框显示"操作失败，已撤销部分变更"
```

**场景 5：恢复点（checkpoint）防止重复执行**

```
14:34:00.000  工具执行成功（支付查询）
  → 写入 checkpoint（toolExecuted: true）
  → worker 崩溃（未写入 DB）

14:34:10.000  队列重启，从 checkpoint 恢复
  → 检查 checkpoint：toolExecuted = true
  → 跳过工具执行（不重复调用外部 API）
  → 继续执行下一步

外部 API 观察：支付查询只执行 1 次（不是 2 次）
```

### 1.2 这个模块在项目里承担什么

- **输入**：Tool/模型/队列失败事件（超时/参数错误/格式错误/崩溃）
- **输出**：统一恢复策略（重试/立即失败/隔离/补偿/恢复点）+ 失败事件审计日志
- **对齐后续**：Day 35-40 LangGraph 状态机编排时，失败恢复是"状态机节点失败后的恢复策略"；Day 51-60 可观测性时，失败事件是监控告警的数据源

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 简单重试（固定 3 次，不区分错误类型） | 单文件 `retry.service.ts`（硬编码 maxRetries=3） | 重试概念、指数退避 |
| **v1 痛点** | 不可重试错误也重试（浪费资源）、无补偿（已执行工具不回滚）、无 Poison event 隔离（拖垮正常流量）、无恢复点（重复执行） |  |  |
| **v2** | v1 + **错误分类（Transient vs Permanent）** + **Poison event 隔离（DLQ）** | 拆出 `error-classifier.ts` + `dlq-handler.ts` | 错误分类 taxonomy、死信队列（DLQ） |
| **v2 痛点** | 无补偿机制、无恢复点（重复执行） |  |  |
| **v3** | v2 + **补偿机制（rollback）** + **恢复点（checkpoint）** + **事件重放幂等性** | 完整分层（classifier/dlq/compensation/checkpoint/replay） | 补偿 taxonomy、恢复点语义、幂等性 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---
## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：失败恢复涉及"错误分类 + Poison event 隔离 + 补偿机制 + 恢复点 + 事件重放"5 个关注点，如果不先立骨架，最容易犯的错就是把"错误分类逻辑"、"重试策略"、"补偿逻辑"、"恢复点检查"糊在一个 service 里。看完这棵树，下面章节再出现 `recovery/classifier/error-classifier.ts` 时，你就能立刻定位它属于"错误分类层"。

**今天在 `p1-monitor/` 下要建立的完整目录树（v3 完整版）**：

```
p1-monitor/
├── apps/api/src/
│   ├── recovery/                                  ← 【新增】失败恢复模块
│   │   ├── classifier/
│   │   │   ├── error-classifier.ts                ← 错误分类器（Transient vs Permanent）
│   │   │   ├── error-classifier.spec.ts           ← 分类器单测
│   │   │   └── error-taxonomy.ts                  ← 错误分类规则（超时=Transient、参数错误=Permanent）
│   │   ├── retry/
│   │   │   ├── retry-strategy.ts                  ← 重试策略（指数退避 + 最大重试次数）
│   │   │   ├── retry-budget.ts                    ← 重试预算（限制总重试次数）
│   │   │   └── retry-strategy.spec.ts             ← 重试策略单测
│   │   ├── dlq/
│   │   │   ├── dlq-handler.ts                     ← 死信队列处理器（Poison event 隔离）
│   │   │   ├── dlq-handler.spec.ts                ← DLQ 单测
│   │   │   └── poison-event-detector.ts           ← Poison event 检测器（重试 3 次后仍失败）
│   │   ├── compensation/
│   │   │   ├── compensation-registry.ts           ← 补偿注册表（工具 → 补偿函数映射）
│   │   │   ├── compensation-executor.ts           ← 补偿执行器（按逆序执行补偿）
│   │   │   ├── compensation-executor.spec.ts      ← 补偿执行器单测
│   │   │   └── compensation-types.ts              ← 补偿类型（Rollback/Notify/Log）
│   │   ├── checkpoint/
│   │   │   ├── checkpoint-manager.ts              ← 恢复点管理器（读写 checkpoint）
│   │   │   ├── checkpoint-store.ts                ← 恢复点存储（DB/Redis）
│   │   │   ├── checkpoint-manager.spec.ts         ← 恢复点管理器单测
│   │   │   └── checkpoint-schema.ts               ← 恢复点 Schema（executedTools/state）
│   │   ├── replay/
│   │   │   ├── replay-engine.ts                   ← 事件重放引擎（从 checkpoint 恢复）
│   │   │   ├── replay-engine.spec.ts              ← 重放引擎单测
│   │   │   └── idempotency-checker.ts             ← 幂等性检查器（防止重复执行）
│   │   ├── audit/
│   │   │   └── recovery-audit.service.ts          ← 失败恢复审计日志
│   │   ├── recovery.service.ts                    ← 主业务逻辑（协调各层）
│   │   ├── recovery.module.ts                     ← NestJS 模块
│   │   └── index.ts                               ← 桶文件
│   ├── queue/                                     ← 【Day 29 已有，今天改造】
│   │   └── tool-queue.processor.ts                ← 改造：接入 RecoveryService
│   └── persistence/                               ← 【Day 27 已有】
│       └── prisma/schema.prisma                   ← 【新增】checkpoints 和 recovery_audit_logs 表
├── packages/shared/src/
│   └── types/recovery.types.ts                    ← 【新增】前后端共享类型
└── frontend/src/
    └── agent/
        └── recovery-indicator.vue                 ← 【新增】失败恢复进度指示器
```

**为什么这样分层**（5 个追问）：

1. **为什么把 classifier/retry/dlq/compensation/checkpoint/replay 分成六个目录？**
   这六个关注点职责清晰：classifier 决定"是否重试"、retry 决定"怎么重试"、dlq 处理"重试失败的事件"、compensation 处理"已执行工具的回滚"、checkpoint 防止"重复执行"、replay 保证"重放幂等"。分层后每个关注点可以独立测试。

2. **为什么 CompensationRegistry 要单独提取？**
   补偿函数不仅用于"工具失败后回滚"，还可以用于"用户取消操作"（例如 Day 33 的审批拒绝）。提取为独立模块后，Day 35-40 LangGraph 状态机编排时可以复用（例如"状态机回滚到上一个节点"）。

3. **为什么恢复点要单独建表（checkpoints）？**
   恢复点不是"业务数据"（例如 AgentRun），而是"运行时快照"（executedTools/state）。分开后可以独立清理（例如"Run 完成 7 天后删除 checkpoint"）。

4. **为什么需要 IdempotencyChecker？**
   事件重放时，可能重复执行已执行的工具（例如 checkpoint 写入失败，重放时再执行一次）。IdempotencyChecker 通过"幂等键"（例如 `${runId}-${toolName}-${callId}`）防止重复执行。

5. **为什么 PoisonEventDetector 要单独提取？**
   Poison event 的判断逻辑可能随业务变化（例如"重试 3 次"改为"重试 5 次"、"格式错误"改为"包含特定关键字"）。提取为独立模块后，修改判断逻辑不影响 DlqHandler。

**diff 表格**（Day 33 → Day 34 增量）：

| 变更类型 | 文件路径 | Day 33 状态 | Day 34 变化 | 原因 |
|---|---|---|---|---|
| 新增目录 | `recovery/` | 不存在 | 新建（失败恢复模块） | 统一处理 Tool/模型/队列失败 |
| 新增目录 | `recovery/classifier/` | 不存在 | 新建（错误分类） | 区分可重试 vs 不可重试错误 |
| 新增目录 | `recovery/dlq/` | 不存在 | 新建（死信队列） | 隔离 Poison event |
| 新增目录 | `recovery/compensation/` | 不存在 | 新建（补偿机制） | 回滚已执行的工具 |
| 新增目录 | `recovery/checkpoint/` | 不存在 | 新建（恢复点） | 防止重复执行 |
| 新增目录 | `recovery/replay/` | 不存在 | 新建（事件重放） | 保证重放幂等 |
| 修改文件 | `tool-queue.processor.ts` | 简单重试 3 次 | 改为调用 RecoveryService | 接入统一恢复策略 |
| 新增文件 | `prisma/schema.prisma` | 无恢复点表 | 新增 Checkpoint 表 | 持久化恢复点 |

**依赖箭头图**（从下往上看）：

```
tool-queue.processor.ts（队列 worker）
          ↓
    recovery.service.ts ──────────────────────────┐
          ↓                                       │
    ┌─────┴──────┬──────────┬──────────┬─────────┤
error-classifier  retry-strategy  dlq-handler  compensation-executor  checkpoint-manager  replay-engine
    ↓                ↓                 ↓                ↓                       ↓                ↓
error-taxonomy  retry-budget  poison-event-detector  compensation-registry  checkpoint-store  idempotency-checker
```

**3 个灵魂拷问**（动手前先回答）：

1. **如果不区分"可重试 vs 不可重试错误"，直接固定重试 3 次，会有什么问题？**
   答：参数错误（例如 serverId 格式错误）重试 100 次也不会成功，浪费 worker 资源。正确做法是"参数错误立即失败（不重试）、超时错误重试 3 次"。

2. **为什么补偿机制要"按逆序执行"（后执行的工具先补偿）？**
   答：工具之间有依赖关系（例如"重启服务器 → 清空缓存"）。如果按正序补偿（先撤销"重启服务器"），后续补偿（撤销"清空缓存"）可能依赖"服务器已重启"的状态，导致补偿失败。逆序补偿保证"后执行的工具先撤销"，依赖关系不被破坏。

3. **为什么恢复点要写在"工具执行成功之后"，而不是"工具执行之前"？**
   答：如果写在执行之前（checkpoint: { willExecute: 'getMetrics' }），worker 崩溃后重放时，会再执行一次工具（重复执行）。如果写在执行之后（checkpoint: { executed: 'getMetrics' }），重放时检查 checkpoint，发现已执行，跳过（不重复执行）。

---
## 1.5 今天动手前的脚手架检查

**为什么放在 §1 里**：Day 34 依赖 Day 29（BullMQ 队列）、Day 27（持久化）的代码。如果这些依赖缺失，今天的改造无法进行。先检查脚手架完整性，缺什么补什么，再开始动手。

### 1.5.1 Day 29 队列代码检查

```bash
# 检查 BullMQ 是否已安装
grep "bullmq" package.json
# 检查队列 processor 是否存在
ls apps/api/src/queue/tool-queue.processor.ts
```

**如果缺失**：先完成 Day 29（BullMQ 队列），再回来做 Day 34。

### 1.5.2 Day 27 持久化基础检查

```bash
# 检查 Prisma 是否已配置
ls apps/api/prisma/schema.prisma
# 检查 PrismaService 是否已注入
grep -r "PrismaService" apps/api/src/
```

**如果缺失**：先完成 Day 27（Postgres 持久化），再回来做 Day 34。

### 1.5.3 今天需要新建的 Prisma Schema

在 `apps/api/prisma/schema.prisma` 里新增两张表（checkpoints 和 recovery_audit_logs）：

```prisma
model Checkpoint {
  id              String   @id @default(cuid())
  runId           String
  version         Int      @default(0)  // checkpoint 版本号（每次更新 +1）
  executedTools   Json     // 已执行的工具列表（[{ toolName, callId, result }]）
  state           Json     // 运行时状态（供重放时恢复）
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([runId, version])  // 唯一约束：同一个 runId 的 version 不能重复
  @@index([runId])
}

model RecoveryAuditLog {
  id          String   @id @default(cuid())
  runId       String
  event       String   // 'retry_started' | 'retry_failed' | 'dlq_moved' | 'compensated' | 'replayed'
  errorType   String?  // 'transient' | 'permanent' | 'poison'
  metadata    Json     // 额外信息（例如重试次数、错误堆栈）
  occurredAt  DateTime @default(now())

  @@index([runId])
  @@index([event])
  @@index([occurredAt])
}
```

**为什么 Checkpoint 需要 version 字段？**
重放时可能写入多个 checkpoint（例如重放到第 3 个工具时崩溃，再重放时写入第 2 个 checkpoint）。version 字段保证"取最新的 checkpoint"（ORDER BY version DESC LIMIT 1）。

**为什么 executedTools 是 Json 而不是关联表？**
executedTools 是"运行时快照"（只在重放时使用），不需要查询（例如"查询某工具被执行了多少次"）。用 Json 存储性能更好（不需要 JOIN）。

### 1.5.4 迁移脚本

```bash
cd apps/api
npx prisma migrate dev --name add_recovery_tables
npx prisma generate
```

**验证迁移成功**：
```bash
# 检查表是否创建
psql -U postgres -d p1_monitor -c "\dt checkpoint*"
psql -U postgres -d p1_monitor -c "\dt recovery*"
# 预期输出：checkpoints 和 recovery_audit_logs 两张表
```

---

## 2. 今天的开发节奏（6 小时怎么分配）

**总计 360 分钟**，按"理解原理 → 实现 v2 错误分类 + DLQ → 实现 v3 补偿 + 恢复点 → 测试验证 → 架构证据"5 个阶段推进。

| 阶段 | 时长 | 任务 | 输出 | 为什么这样安排 |
|---|---|---|---|---|
| **阶段 1** | 60 min | 阅读 BullMQ 官方文档（Retry Strategies + Dead Letter Queue）+ 理解错误分类 taxonomy | 笔记：Transient vs Permanent 错误分类表 | 错误分类是失败恢复的地基，不理解分类会写出"参数错误也重试 3 次"的 Bug |
| **阶段 2** | 90 min | 实现 v2（错误分类 + DLQ）：ErrorClassifier + DlqHandler | 可运行的 v2 代码 + 单元测试 | 先建立"区分可重试 vs 不可重试"的能力，再加补偿/恢复点 |
| **阶段 3** | 120 min | 实现 v3（补偿 + 恢复点 + 重放）：CompensationExecutor + CheckpointManager + ReplayEngine | 完整的 v3 代码 + 集成测试 | v3 是最终交付版本，需要覆盖"补偿"和"重复执行"两个核心痛点 |
| **阶段 4** | 60 min | 故障注入测试：工具超时 + Poison event + worker 崩溃 + 重放 | 测试输出（截图 + 日志） | 验证"超时重试"、"参数错误不重试"、"Poison event 隔离"、"重放不重复执行" |
| **阶段 5** | 30 min | 架构证据：依赖图 + 时序图 + commit | 四件套 | M3 门禁要求 |

**关键里程碑检查点**：
- 90 分钟：v2 错误分类代码能跑通（参数错误立即失败，不重试）
- 210 分钟：v3 补偿代码能跑通（工具失败后自动补偿）
- 270 分钟：集成测试通过（重放不重复执行）
- 300 分钟：故障注入测试完成（截图 + 日志）

**如果卡住了怎么办**：
- 卡在错误分类理解（阶段 1）→ 先读 BullMQ 官方文档的"Retry Strategies"章节
- 卡在补偿实现（阶段 3）→ 回顾 Saga 模式（补偿 = 反向操作序列）
- 卡在测试验证（阶段 4）→ 先跑单元测试，再跑集成测试，最后跑故障注入

---

## 3. v1：简单重试（固定 3 次，不区分错误类型）

### 3.1 v1 能做什么

Day 29 实现的简单重试：
- 队列 job 失败后，自动重试 3 次
- 重试间隔：指数退避（1s → 2s → 4s）
- 重试 3 次后仍失败，job 标记为 failed

### 3.2 v1 代码骨架（Day 29 版本）

```typescript
// apps/api/src/queue/tool-queue.processor.ts（Day 29 版本）
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Injectable } from '@nestjs/common'
import { ToolRegistry } from '../tool/tool-registry'

@Processor('tool', {
  limiter: {
    max: 10, // 最多 10 个并发 job
    duration: 1000,
  },
})
@Injectable()
export class ToolQueueProcessor extends WorkerHost {
  constructor(private toolRegistry: ToolRegistry) {
    super()
  }

  async process(job: Job): Promise<any> {
    const { toolName, toolArgs } = job.data

    try {
      // 执行工具
      const result = await this.toolRegistry.execute(toolName, toolArgs)
      return result
    } catch (error) {
      // 抛出错误，让 BullMQ 重试（固定 3 次）
      throw error
    }
  }
}
```

**队列配置**（BullMQ 默认重试策略）：

```typescript
// apps/api/src/queue/queue.module.ts（Day 29 版本）
import { BullModule } from '@nestjs/bullmq'

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'tool',
      defaultJobOptions: {
        attempts: 3, // 重试 3 次
        backoff: {
          type: 'exponential',
          delay: 1000, // 初始延迟 1 秒
        },
      },
    }),
  ],
})
export class QueueModule {}
```

### 3.3 v1 的 5 个致命问题

**问题 1：不可重试错误也重试（浪费资源）**
参数错误（例如 serverId 格式错误）重试 100 次也不会成功，但 v1 还是重试 3 次，浪费 worker 资源。

**问题 2：Poison event 拖垮正常流量**
格式错误的事件（例如 toolArgs 不是 JSON）重试 3 次都失败，但这个事件占用 worker，导致正常事件排队等待。

**问题 3：无补偿机制（已执行工具不回滚）**
Agent 执行了 3 个工具，第 4 个工具失败，前 3 个工具已执行（服务器已重启、缓存已清空），但不回滚。

**问题 4：无恢复点（重复执行）**
工具执行成功，但 worker 在写入结果前崩溃。队列重启后，重新执行工具，导致重复执行。

**问题 5：重试预算无限制（无限重试）**
如果外部 API 持续超时 1 小时，v1 会每隔 1 秒重试一次（3600 次），浪费大量资源。

---
## 4. v2：错误分类 + DLQ（解决问题 1/3）

### 4.1 v2 新增的能力

v2 在 v1 基础上新增：
- **错误分类**：区分 Transient（可重试，例如超时）vs Permanent（不可重试，例如参数错误）
- **DLQ（死信队列）**：Poison event（重试 3 次后仍失败）移入隔离队列，不影响正常流量
- **重试预算**：限制总重试次数（例如"1 小时内最多重试 100 次"）

### 4.2 v2 架构变化

```
v1：工具失败 → 固定重试 3 次 → 失败
v2：工具失败 → 错误分类（Transient/Permanent）→ Transient 重试 3 次 / Permanent 立即失败 → 重试 3 次后仍失败 → 移入 DLQ
```

**关键变化**：增加"错误分类"环节，Permanent 错误不重试，Transient 错误重试 3 次后移入 DLQ。

### 4.3 v2 核心代码（按第 5.3 节的代码边写边问）

**边写边问自己**：
1. 为什么错误分类要用 taxonomy 而不是简单的 if-else？
2. 为什么 DLQ 要单独建队列，而不是直接标记 job 为 failed？
3. 为什么重试预算要用滑动窗口，而不是固定计数器？
4. 为什么 Poison event 检测要用"连续失败次数"，而不是"累计失败次数"？
5. 为什么错误分类要持久化到 DB，而不是只在内存里？

#### 4.3.1 错误分类 taxonomy（classifier/error-taxonomy.ts）

```typescript
// apps/api/src/recovery/classifier/error-taxonomy.ts
export enum ErrorType {
  TRANSIENT = 'transient',   // 可重试（超时、网络错误、服务暂时不可用）
  PERMANENT = 'permanent',   // 不可重试（参数错误、权限错误、资源不存在）
  POISON = 'poison',         // 毒事件（格式错误、无法解析）
}

export interface ErrorClassification {
  type: ErrorType
  reason: string
  retryable: boolean
}

/**
 * 错误分类规则（基于错误码 + 错误消息）
 */
export const ERROR_TAXONOMY: Record<string, ErrorClassification> = {
  // Transient 错误（可重试）
  TIMEOUT: {
    type: ErrorType.TRANSIENT,
    reason: 'Request timeout',
    retryable: true,
  },
  NETWORK_ERROR: {
    type: ErrorType.TRANSIENT,
    reason: 'Network connection failed',
    retryable: true,
  },
  SERVICE_UNAVAILABLE: {
    type: ErrorType.TRANSIENT,
    reason: 'Service temporarily unavailable',
    retryable: true,
  },
  RATE_LIMIT: {
    type: ErrorType.TRANSIENT,
    reason: 'Rate limit exceeded',
    retryable: true,
  },

  // Permanent 错误（不可重试）
  INVALID_ARGUMENT: {
    type: ErrorType.PERMANENT,
    reason: 'Invalid argument format',
    retryable: false,
  },
  PERMISSION_DENIED: {
    type: ErrorType.PERMANENT,
    reason: 'Permission denied',
    retryable: false,
  },
  NOT_FOUND: {
    type: ErrorType.PERMANENT,
    reason: 'Resource not found',
    retryable: false,
  },
  UNAUTHORIZED: {
    type: ErrorType.PERMANENT,
    reason: 'Unauthorized access',
    retryable: false,
  },

  // Poison 错误（格式错误）
  PARSE_ERROR: {
    type: ErrorType.POISON,
    reason: 'Failed to parse event data',
    retryable: false,
  },
  SCHEMA_VALIDATION_ERROR: {
    type: ErrorType.POISON,
    reason: 'Event schema validation failed',
    retryable: false,
  },
}
```

**为什么用 taxonomy 而不是 if-else？**
taxonomy 是"声明式规则表"，新增错误类型只需要在表里加一行（不需要改代码逻辑）。if-else 是"命令式判断"，新增错误类型需要改 if-else 链（容易引入 Bug）。

#### 4.3.2 错误分类器（classifier/error-classifier.ts）

```typescript
// apps/api/src/recovery/classifier/error-classifier.ts
import { Injectable } from '@nestjs/common'
import { ERROR_TAXONOMY, ErrorClassification, ErrorType } from './error-taxonomy'

@Injectable()
export class ErrorClassifier {
  /**
   * 根据错误码和错误消息分类错误
   */
  classify(error: Error): ErrorClassification {
    // 1. 尝试从错误消息匹配 taxonomy
    const errorCode = this.extractErrorCode(error)
    if (errorCode && ERROR_TAXONOMY[errorCode]) {
      return ERROR_TAXONOMY[errorCode]
    }

    // 2. 根据错误消息关键字匹配
    const message = error.message.toLowerCase()

    if (message.includes('timeout') || message.includes('timed out')) {
      return ERROR_TAXONOMY.TIMEOUT
    }

    if (message.includes('network') || message.includes('econnrefused')) {
      return ERROR_TAXONOMY.NETWORK_ERROR
    }

    if (message.includes('invalid') || message.includes('malformed')) {
      return ERROR_TAXONOMY.INVALID_ARGUMENT
    }

    if (message.includes('not found') || message.includes('does not exist')) {
      return ERROR_TAXONOMY.NOT_FOUND
    }

    if (message.includes('parse') || message.includes('json')) {
      return ERROR_TAXONOMY.PARSE_ERROR
    }

    // 3. 默认：Transient（谨慎重试，避免误判 Permanent 导致不重试）
    return {
      type: ErrorType.TRANSIENT,
      reason: 'Unknown error, default to retryable',
      retryable: true,
    }
  }

  private extractErrorCode(error: any): string | null {
    // 尝试从 error.code、error.statusCode、error.name 提取错误码
    return error.code || error.statusCode?.toString() || error.name || null
  }
}
```

**为什么默认是 Transient 而不是 Permanent？**
谨慎原则：如果误判 Permanent（不重试），用户看到的是"失败"；如果误判 Transient（重试），最多浪费 3 次重试（用户最终还是看到失败）。误判 Permanent 的代价更高（用户体验更差）。

#### 4.3.3 DLQ 处理器（dlq/dlq-handler.ts）

```typescript
// apps/api/src/recovery/dlq/dlq-handler.ts
import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { PrismaService } from '../../persistence/prisma.service'

@Injectable()
export class DlqHandler {
  constructor(
    @InjectQueue('tool-dlq') private dlqQueue: Queue,
    private prisma: PrismaService,
  ) {}

  /**
   * 将失败的 job 移入 DLQ（死信队列）
   */
  async moveToDeadLetter(job: any, error: Error): Promise<void> {
    // 1. 加入 DLQ 队列
    await this.dlqQueue.add('dead-letter', {
      originalJobId: job.id,
      originalJobData: job.data,
      failedReason: error.message,
      failedStack: error.stack,
      attemptsMade: job.attemptsMade,
      timestamp: new Date().toISOString(),
    })

    // 2. 写入审计日志
    await this.prisma.recoveryAuditLog.create({
      data: {
        runId: job.data.runId,
        event: 'dlq_moved',
        errorType: 'poison',
        metadata: {
          jobId: job.id,
          failedReason: error.message,
          attemptsMade: job.attemptsMade,
        },
      },
    })

    // 3. 发送告警（通知运维）
    console.error(`[DLQ] Poison event detected: ${job.id}`, {
      runId: job.data.runId,
      error: error.message,
    })
  }

  /**
   * 从 DLQ 重新处理（人工修复后重试）
   */
  async retryFromDeadLetter(deadLetterJobId: string): Promise<void> {
    const deadLetterJob = await this.dlqQueue.getJob(deadLetterJobId)
    if (!deadLetterJob) {
      throw new Error(`Dead letter job not found: ${deadLetterJobId}`)
    }

    // 从原始数据重新加入正常队列
    const originalData = deadLetterJob.data.originalJobData
    await this.dlqQueue.add('tool', originalData)

    // 标记 DLQ job 为已处理
    await deadLetterJob.moveToCompleted('retried', true)
  }
}
```

**为什么 DLQ 要单独建队列？**
DLQ 队列的处理逻辑和正常队列不同（DLQ 需要人工介入、分析错误、修复数据）。分开后可以独立监控（例如"DLQ 队列积压 > 100 时发送告警"）。

#### 4.3.4 Poison event 检测器（dlq/poison-event-detector.ts）

```typescript
// apps/api/src/recovery/dlq/poison-event-detector.ts
import { Injectable } from '@nestjs/common'

export interface PoisonEventCriteria {
  maxAttempts: number       // 最大重试次数（默认 3）
  consecutiveFailures: number // 连续失败次数（默认 3）
}

@Injectable()
export class PoisonEventDetector {
  private readonly criteria: PoisonEventCriteria = {
    maxAttempts: 3,
    consecutiveFailures: 3,
  }

  /**
   * 检测是否为 Poison event
   */
  isPoisonEvent(job: any): boolean {
    // 1. 检查重试次数
    if (job.attemptsMade >= this.criteria.maxAttempts) {
      return true
    }

    // 2. 检查连续失败次数（从 job 的 failedReason 历史判断）
    const failureHistory = job.failedReason || []
    const consecutiveFailures = this.countConsecutiveFailures(failureHistory)

    if (consecutiveFailures >= this.criteria.consecutiveFailures) {
      return true
    }

    return false
  }

  private countConsecutiveFailures(history: string[]): number {
    let count = 0
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]) {
        count++
      } else {
        break
      }
    }
    return count
  }
}
```

**为什么用"连续失败次数"而不是"累计失败次数"？**
累计失败次数包含"偶尔失败"的情况（例如网络抖动导致 1 次失败，后续成功）。连续失败次数只统计"连续多次失败"（说明这是系统性错误，不是偶发错误）。

#### 4.3.5 改造队列 processor（v2 版本）

```typescript
// apps/api/src/queue/tool-queue.processor.ts（v2 版本）
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Injectable } from '@nestjs/common'
import { ToolRegistry } from '../tool/tool-registry'
import { ErrorClassifier } from '../recovery/classifier/error-classifier'
import { DlqHandler } from '../recovery/dlq/dlq-handler'
import { PoisonEventDetector } from '../recovery/dlq/poison-event-detector'
import { ErrorType } from '../recovery/classifier/error-taxonomy'

@Processor('tool')
@Injectable()
export class ToolQueueProcessor extends WorkerHost {
  constructor(
    private toolRegistry: ToolRegistry,
    private errorClassifier: ErrorClassifier,
    private dlqHandler: DlqHandler,
    private poisonDetector: PoisonEventDetector,
  ) {
    super()
  }

  async process(job: Job): Promise<any> {
    const { toolName, toolArgs } = job.data

    try {
      const result = await this.toolRegistry.execute(toolName, toolArgs)
      return result
    } catch (error) {
      // 错误分类
      const classification = this.errorClassifier.classify(error)

      // Permanent 错误：立即失败，不重试
      if (classification.type === ErrorType.PERMANENT) {
        console.error(`[Processor] Permanent error, not retrying: ${error.message}`)
        throw new Error(`PERMANENT: ${error.message}`) // 标记为 PERMANENT，前端可识别
      }

      // Poison event：移入 DLQ
      if (classification.type === ErrorType.POISON || this.poisonDetector.isPoisonEvent(job)) {
        await this.dlqHandler.moveToDeadLetter(job, error)
        throw new Error(`POISON: ${error.message}`) // 标记为 POISON
      }

      // Transient 错误：重试（由 BullMQ 自动重试）
      throw error
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    // job 最终失败时（重试 3 次后仍失败）
    console.error(`[Processor] Job ${job.id} finally failed after ${job.attemptsMade} attempts`, {
      error: error.message,
    })
  }
}
```

**为什么 Permanent 错误要 throw new Error('PERMANENT: ...')?**
前端需要区分"Permanent 错误"（显示"参数错误，请检查输入"）和"Transient 错误"（显示"服务暂时不可用，请稍后重试"）。通过错误消息前缀（PERMANENT/POISON）传递分类信息。

### 4.4 v2 测试（单元测试 + 集成测试）

#### 4.4.1 单元测试（error-classifier.spec.ts）

```typescript
// apps/api/src/recovery/classifier/error-classifier.spec.ts
import { ErrorClassifier } from './error-classifier'
import { ErrorType } from './error-taxonomy'

describe('ErrorClassifier', () => {
  let classifier: ErrorClassifier

  beforeEach(() => {
    classifier = new ErrorClassifier()
  })

  it('超时错误应分类为 Transient', () => {
    const error = new Error('Request timed out after 30s')
    const classification = classifier.classify(error)

    expect(classification.type).toBe(ErrorType.TRANSIENT)
    expect(classification.retryable).toBe(true)
  })

  it('参数错误应分类为 Permanent', () => {
    const error = new Error('Invalid serverId format')
    const classification = classifier.classify(error)

    expect(classification.type).toBe(ErrorType.PERMANENT)
    expect(classification.retryable).toBe(false)
  })

  it('JSON 解析错误应分类为 Poison', () => {
    const error = new Error('Failed to parse JSON')
    const classification = classifier.classify(error)

    expect(classification.type).toBe(ErrorType.POISON)
    expect(classification.retryable).toBe(false)
  })

  it('未知错误应默认为 Transient', () => {
    const error = new Error('Something went wrong')
    const classification = classifier.classify(error)

    expect(classification.type).toBe(ErrorType.TRANSIENT)
    expect(classification.retryable).toBe(true)
  })
})
```

#### 4.4.2 集成测试（Poison event 隔离）

```typescript
// apps/api/test/recovery-dlq.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { Queue } from 'bullmq'
import { getQueueToken } from '@nestjs/bullmq'

describe('DLQ (E2E)', () => {
  let app: INestApplication
  let toolQueue: Queue
  let dlqQueue: Queue

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
    toolQueue = app.get(getQueueToken('tool'))
    dlqQueue = app.get(getQueueToken('tool-dlq'))
  })

  afterAll(async () => {
    await app.close()
  })

  it('Poison event 应移入 DLQ', async () => {
    // 1. 加入一个会失败的 job（格式错误）
    await toolQueue.add('execute-tool', {
      runId: 'run-001',
      toolName: 'getMetrics',
      toolArgs: 'invalid-json', // 格式错误（应该是对象）
    })

    // 2. 等待 job 重试 3 次后失败
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // 3. 验证 DLQ 里有 1 个 job
    const dlqJobs = await dlqQueue.getJobs(['waiting', 'active'])
    expect(dlqJobs.length).toBe(1)
    expect(dlqJobs[0].data.failedReason).toContain('parse')
  })
})
```

### 4.5 v2 还剩下的 2 个问题

**问题 2：无补偿机制（已执行工具不回滚）**
v2 只处理"工具执行失败"，不处理"已执行工具的回滚"。如果 Agent 执行了 3 个工具，第 4 个工具失败，前 3 个工具已执行（服务器已重启、缓存已清空），但不回滚。

**问题 4：无恢复点（重复执行）**
v2 没有实现 checkpoint。如果工具执行成功，但 worker 在写入结果前崩溃，队列重启后会重新执行工具（重复执行）。

v3 用"补偿机制 + 恢复点"解决这两个问题。

---
## 5. v3：补偿 + 恢复点 + 重放（解决问题 2/4/5）

### 5.1 v3 新增的能力

v3 在 v2 基础上新增：
- **补偿机制（Compensation）**：工具失败后，按逆序回滚已执行的工具（Saga 模式）
- **恢复点（Checkpoint）**：工具执行成功后立即写入 checkpoint，重放时检查 checkpoint 跳过已执行工具
- **事件重放（Replay）**：队列重启后，从 checkpoint 恢复，保证重放幂等（不重复执行）

### 5.2 v3 架构变化

```
v2：工具失败 → 错误分类 → 重试/立即失败/移入 DLQ
v3：工具失败 → 错误分类 → 重试/立即失败/移入 DLQ
                     ↓（失败前）
           触发补偿：按逆序回滚已执行的工具
                     ↓（重启后）
           从 checkpoint 恢复：跳过已执行工具
```

**关键变化**：增加"补偿"和"恢复点"两个环节，保证"工具失败不留副作用"和"重放不重复执行"。

### 5.3 v3 完整代码（生产级实现）

#### 5.3.1 补偿类型定义（compensation/compensation-types.ts）

```typescript
// apps/api/src/recovery/compensation/compensation-types.ts
export enum CompensationType {
  ROLLBACK = 'rollback',   // 完全撤销（例如：删除创建的资源）
  NOTIFY = 'notify',       // 发送通知（例如：发送"取消操作"邮件）
  LOG = 'log',             // 只记录日志（无法撤销的操作）
}

export interface CompensationAction {
  type: CompensationType
  toolName: string
  execute: (context: any) => Promise<void>
}
```

#### 5.3.2 补偿注册表（compensation/compensation-registry.ts）

```typescript
// apps/api/src/recovery/compensation/compensation-registry.ts
import { Injectable } from '@nestjs/common'
import { CompensationAction, CompensationType } from './compensation-types'

@Injectable()
export class CompensationRegistry {
  private registry = new Map<string, CompensationAction>()

  constructor() {
    // 注册工具的补偿函数
    this.registerDefaults()
  }

  private registerDefaults() {
    // 示例：restartServer 的补偿是"记录日志"（无法撤销）
    this.register('restartServer', {
      type: CompensationType.LOG,
      toolName: 'restartServer',
      execute: async (context) => {
        console.log('[Compensation] Cannot rollback restartServer, logging only', context)
      },
    })

    // 示例：clearCache 的补偿是"无操作"（缓存清空无法撤销）
    this.register('clearCache', {
      type: CompensationType.LOG,
      toolName: 'clearCache',
      execute: async (context) => {
        console.log('[Compensation] Cannot rollback clearCache, logging only', context)
      },
    })

    // 示例：sendAlert 的补偿是"发送取消通知"
    this.register('sendAlert', {
      type: CompensationType.NOTIFY,
      toolName: 'sendAlert',
      execute: async (context) => {
        console.log('[Compensation] Sending cancellation notification', context)
        // 实际实现：调用 notification API
      },
    })

    // 示例：createResource 的补偿是"删除资源"
    this.register('createResource', {
      type: CompensationType.ROLLBACK,
      toolName: 'createResource',
      execute: async (context) => {
        console.log('[Compensation] Deleting resource', context.resourceId)
        // 实际实现：调用 DELETE API
      },
    })
  }

  register(toolName: string, action: CompensationAction) {
    this.registry.set(toolName, action)
  }

  get(toolName: string): CompensationAction | undefined {
    return this.registry.get(toolName)
  }

  has(toolName: string): boolean {
    return this.registry.has(toolName)
  }
}
```

#### 5.3.3 补偿执行器（compensation/compensation-executor.ts）

```typescript
// apps/api/src/recovery/compensation/compensation-executor.ts
import { Injectable } from '@nestjs/common'
import { CompensationRegistry } from './compensation-registry'
import { PrismaService } from '../../persistence/prisma.service'

export interface ExecutedTool {
  toolName: string
  callId: string
  result: any
  executedAt: Date
}

@Injectable()
export class CompensationExecutor {
  constructor(
    private compensationRegistry: CompensationRegistry,
    private prisma: PrismaService,
  ) {}

  /**
   * 按逆序补偿已执行的工具
   */
  async compensate(runId: string, executedTools: ExecutedTool[]): Promise<void> {
    // 按逆序（后执行的先补偿）
    const reversedTools = [...executedTools].reverse()

    for (const tool of reversedTools) {
      const compensation = this.compensationRegistry.get(tool.toolName)

      if (!compensation) {
        console.warn(`[Compensation] No compensation registered for ${tool.toolName}`)
        continue
      }

      try {
        await compensation.execute({
          runId,
          callId: tool.callId,
          result: tool.result,
          executedAt: tool.executedAt,
        })

        // 写入审计日志
        await this.prisma.recoveryAuditLog.create({
          data: {
            runId,
            event: 'compensated',
            errorType: null,
            metadata: {
              toolName: tool.toolName,
              callId: tool.callId,
              compensationType: compensation.type,
            },
          },
        })
      } catch (error) {
        console.error(`[Compensation] Failed to compensate ${tool.toolName}:`, error)
        // 补偿失败也不抛异常（尽力而为）
      }
    }
  }
}
```

**为什么补偿失败不抛异常？**
补偿是"尽力而为"（best-effort），不是"强保证"。如果补偿失败（例如网络错误），不应该让整个流程失败（否则用户会看到"操作失败 + 补偿也失败"的双重失败）。正确做法是"记录补偿失败日志 + 发送告警"，让运维人工介入。

#### 5.3.4 恢复点管理器（checkpoint/checkpoint-manager.ts）

```typescript
// apps/api/src/recovery/checkpoint/checkpoint-manager.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'

export interface CheckpointData {
  executedTools: Array<{
    toolName: string
    callId: string
    result: any
  }>
  state: any // 运行时状态（供重放时恢复）
}

@Injectable()
export class CheckpointManager {
  constructor(private prisma: PrismaService) {}

  /**
   * 写入恢复点
   */
  async save(runId: string, data: CheckpointData): Promise<void> {
    // 查询当前最新版本
    const latest = await this.prisma.checkpoint.findFirst({
      where: { runId },
      orderBy: { version: 'desc' },
    })

    const nextVersion = (latest?.version ?? -1) + 1

    await this.prisma.checkpoint.create({
      data: {
        runId,
        version: nextVersion,
        executedTools: data.executedTools as any,
        state: data.state as any,
      },
    })
  }

  /**
   * 读取最新恢复点
   */
  async load(runId: string): Promise<CheckpointData | null> {
    const checkpoint = await this.prisma.checkpoint.findFirst({
      where: { runId },
      orderBy: { version: 'desc' },
    })

    if (!checkpoint) return null

    return {
      executedTools: checkpoint.executedTools as any,
      state: checkpoint.state as any,
    }
  }

  /**
   * 检查工具是否已执行
   */
  async isExecuted(runId: string, toolName: string, callId: string): Promise<boolean> {
    const checkpoint = await this.load(runId)
    if (!checkpoint) return false

    return checkpoint.executedTools.some(
      (tool) => tool.toolName === toolName && tool.callId === callId,
    )
  }
}
```

#### 5.3.5 幂等性检查器（replay/idempotency-checker.ts）

```typescript
// apps/api/src/recovery/replay/idempotency-checker.ts
import { Injectable } from '@nestjs/common'

@Injectable()
export class IdempotencyChecker {
  private executedKeys = new Set<string>()

  /**
   * 生成幂等键
   */
  generateKey(runId: string, toolName: string, callId: string): string {
    return `${runId}:${toolName}:${callId}`
  }

  /**
   * 检查是否已执行
   */
  isExecuted(key: string): boolean {
    return this.executedKeys.has(key)
  }

  /**
   * 标记为已执行
   */
  markExecuted(key: string): void {
    this.executedKeys.add(key)
  }

  /**
   * 清空（用于测试）
   */
  clear(): void {
    this.executedKeys.clear()
  }
}
```

#### 5.3.6 事件重放引擎（replay/replay-engine.ts）

```typescript
// apps/api/src/recovery/replay/replay-engine.ts
import { Injectable } from '@nestjs/common'
import { CheckpointManager } from '../checkpoint/checkpoint-manager'
import { IdempotencyChecker } from './idempotency-checker'
import { ToolRegistry } from '../../tool/tool-registry'

@Injectable()
export class ReplayEngine {
  constructor(
    private checkpointManager: CheckpointManager,
    private idempotencyChecker: IdempotencyChecker,
    private toolRegistry: ToolRegistry,
  ) {}

  /**
   * 从 checkpoint 恢复并重放
   */
  async replay(runId: string, tools: Array<{ toolName: string; callId: string; args: any }>): Promise<any[]> {
    const checkpoint = await this.checkpointManager.load(runId)
    const results: any[] = []

    for (const tool of tools) {
      const key = this.idempotencyChecker.generateKey(runId, tool.toolName, tool.callId)

      // 检查是否已执行（从 checkpoint）
      if (checkpoint && checkpoint.executedTools.some((t) => t.callId === tool.callId)) {
        console.log(`[Replay] Skipping already executed tool: ${tool.toolName} (${tool.callId})`)
        const cached = checkpoint.executedTools.find((t) => t.callId === tool.callId)
        results.push(cached?.result)
        continue
      }

      // 检查是否已执行（从内存）
      if (this.idempotencyChecker.isExecuted(key)) {
        console.log(`[Replay] Skipping already executed tool (in-memory): ${tool.toolName}`)
        continue
      }

      // 执行工具
      const result = await this.toolRegistry.execute(tool.toolName, tool.args)
      results.push(result)

      // 标记为已执行
      this.idempotencyChecker.markExecuted(key)

      // 写入 checkpoint
      await this.checkpointManager.save(runId, {
        executedTools: [
          ...(checkpoint?.executedTools || []),
          {
            toolName: tool.toolName,
            callId: tool.callId,
            result,
          },
        ],
        state: {}, // 运行时状态（这里省略）
      })
    }

    return results
  }
}
```

#### 5.3.7 主恢复服务（recovery.service.ts）

```typescript
// apps/api/src/recovery/recovery.service.ts
import { Injectable } from '@nestjs/common'
import { ErrorClassifier } from './classifier/error-classifier'
import { DlqHandler } from './dlq/dlq-handler'
import { CompensationExecutor, ExecutedTool } from './compensation/compensation-executor'
import { CheckpointManager } from './checkpoint/checkpoint-manager'
import { ReplayEngine } from './replay/replay-engine'
import { ErrorType } from './classifier/error-taxonomy'

@Injectable()
export class RecoveryService {
  constructor(
    private errorClassifier: ErrorClassifier,
    private dlqHandler: DlqHandler,
    private compensationExecutor: CompensationExecutor,
    private checkpointManager: CheckpointManager,
    private replayEngine: ReplayEngine,
  ) {}

  /**
   * 处理工具执行失败
   */
  async handleFailure(
    job: any,
    error: Error,
    executedTools: ExecutedTool[],
  ): Promise<void> {
    // 1. 错误分类
    const classification = this.errorClassifier.classify(error)

    // 2. Permanent 错误：立即补偿 + 失败
    if (classification.type === ErrorType.PERMANENT) {
      await this.compensationExecutor.compensate(job.data.runId, executedTools)
      throw new Error(`PERMANENT: ${error.message}`)
    }

    // 3. Poison event：移入 DLQ + 补偿
    if (classification.type === ErrorType.POISON) {
      await this.dlqHandler.moveToDeadLetter(job, error)
      await this.compensationExecutor.compensate(job.data.runId, executedTools)
      throw new Error(`POISON: ${error.message}`)
    }

    // 4. Transient 错误：重试（由 BullMQ 自动重试）
    throw error
  }

  /**
   * 从 checkpoint 恢复并重放
   */
  async recoverAndReplay(
    runId: string,
    tools: Array<{ toolName: string; callId: string; args: any }>,
  ): Promise<any[]> {
    return this.replayEngine.replay(runId, tools)
  }
}
```

#### 5.3.8 改造队列 processor（v3 最终版）

```typescript
// apps/api/src/queue/tool-queue.processor.ts（v3 最终版）
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Injectable } from '@nestjs/common'
import { RecoveryService } from '../recovery/recovery.service'
import { ExecutedTool } from '../recovery/compensation/compensation-executor'

@Processor('tool')
@Injectable()
export class ToolQueueProcessor extends WorkerHost {
  constructor(private recoveryService: RecoveryService) {
    super()
  }

  async process(job: Job): Promise<any> {
    const { runId, tools } = job.data // tools: [{ toolName, callId, args }]
    const executedTools: ExecutedTool[] = []

    try {
      // 从 checkpoint 恢复并重放
      const results = await this.recoveryService.recoverAndReplay(runId, tools)
      return results
    } catch (error) {
      // 处理失败（错误分类 + 补偿）
      await this.recoveryService.handleFailure(job, error, executedTools)
      throw error
    }
  }
}
```

### 5.4 v3 核心知识点（≥ 6 个，每个 5 要素）

#### 知识点 1：错误分类 taxonomy（Transient vs Permanent）

**是什么**：错误分类 taxonomy 是"根据错误码和错误消息判断错误是否可重试"的规则表。Transient 错误（超时、网络错误）可重试，Permanent 错误（参数错误、权限错误）不可重试。

**解决什么问题**：避免浪费资源重试不可重试的错误。如果参数错误也重试 3 次，浪费 worker 资源 + 增加延迟。

**怎么用**：
```typescript
const classification = errorClassifier.classify(error)
if (classification.type === ErrorType.PERMANENT) {
  throw new Error('PERMANENT: ...')
}
```

**生产陷阱**：默认分类设为 Permanent（不重试）。如果误判 Transient 为 Permanent，用户看到的是"失败"（应该重试却不重试）。正确做法是"默认 Transient（谨慎重试）"。

**验证方法**：单元测试——输入 `new Error('Request timed out')`，验证分类为 Transient；输入 `new Error('Invalid argument')`，验证分类为 Permanent。

#### 知识点 2：死信队列（DLQ, Dead Letter Queue）

**是什么**：死信队列是"隔离重试 N 次后仍失败的事件"的队列。Poison event（格式错误、无法解析）移入 DLQ，不影响正常流量。

**解决什么问题**：Poison event 拖垮正常流量。如果格式错误的事件重试 100 次，占用 worker，导致正常事件排队等待。

**怎么用**：
```typescript
if (job.attemptsMade >= 3) {
  await dlqHandler.moveToDeadLetter(job, error)
}
```

**生产陷阱**：DLQ 没有告警。如果 DLQ 积压 1000 个事件，运维不知道（没有监控），导致问题积累。正确做法是"DLQ 积压 > 100 时发送告警"。

**验证方法**：集成测试——加入格式错误的 job，验证重试 3 次后移入 DLQ（不是继续重试）。

#### 知识点 3：补偿机制（Compensation, Saga 模式）

**是什么**：补偿机制是"工具失败后，按逆序回滚已执行的工具"。例如：执行了"重启服务器 → 清空缓存 → 发送告警"，第 4 个工具失败，按逆序补偿"撤销告警 → 撤销缓存 → 撤销重启"。

**解决什么问题**：工具失败后留下副作用。如果不补偿，用户会看到"操作失败，但服务器已重启、缓存已清空、告警已发送"（不一致状态）。

**怎么用**：
```typescript
await compensationExecutor.compensate(runId, executedTools)
```

**生产陷阱**：所有工具都用 ROLLBACK 补偿类型。有些工具无法完全撤销（例如"重启服务器"无法恢复到重启前的内存状态），应该用 LOG 类型（只记录日志）。

**验证方法**：集成测试——执行 3 个工具，第 4 个工具失败，验证前 3 个工具的补偿函数被调用（按逆序）。

#### 知识点 4：恢复点（Checkpoint）

**是什么**：恢复点是"工具执行成功后立即写入的快照"（executedTools + state）。重放时检查 checkpoint，跳过已执行的工具。

**解决什么问题**：重复执行。如果工具执行成功，但 worker 在写入结果前崩溃，队列重启后会重新执行工具（重复执行）。

**怎么用**：
```typescript
const result = await toolRegistry.execute(toolName, args)
await checkpointManager.save(runId, { executedTools: [..., { toolName, result }] })
```

**生产陷阱**：checkpoint 写在工具执行之前。如果写在执行之前（checkpoint: { willExecute: 'getMetrics' }），重放时会跳过这个工具（因为 checkpoint 显示"将要执行"，被误认为"已执行"）。正确做法是"写在执行之后"。

**验证方法**：集成测试——工具执行成功 → 模拟 worker 崩溃 → 重放 → 验证工具不重复执行（从 checkpoint 恢复）。

#### 知识点 5：事件重放幂等性（Idempotency）

**是什么**：事件重放幂等性是"重放时不产生副作用"。通过幂等键（`${runId}:${toolName}:${callId}`）防止重复执行。

**解决什么问题**：重放时产生副作用。如果重放时重复发送告警、重复写入 DB，用户会看到重复数据。

**怎么用**：
```typescript
const key = `${runId}:${toolName}:${callId}`
if (idempotencyChecker.isExecuted(key)) return cached
idempotencyChecker.markExecuted(key)
```

**生产陷阱**：幂等键只用 runId（不包含 callId）。如果同一个 run 里执行同一个工具 2 次（不同参数），幂等键相同，第二次会被跳过（误判为"已执行"）。正确做法是"幂等键包含 callId"。

**验证方法**：单元测试——调用 2 次 `replay(runId, tools)`，验证工具只执行 1 次（第二次从 checkpoint 恢复）。

#### 知识点 6：Retry Budget（重试预算）

**是什么**：重试预算是"限制总重试次数"的机制。例如"1 小时内最多重试 100 次"。

**解决什么问题**：无限重试。如果外部 API 持续超时 1 小时，v1 会每隔 1 秒重试一次（3600 次），浪费大量资源。

**怎么用**：
```typescript
if (retryBudget.isExceeded(runId)) {
  throw new Error('Retry budget exceeded')
}
retryBudget.consume(runId)
```

**生产陷阱**：重试预算用固定计数器（例如"累计重试 100 次"）。这样会惩罚"偶尔失败"的情况（例如网络抖动导致 1 次失败，后续成功）。正确做法是"滑动窗口"（例如"1 小时内最多 100 次"）。

**验证方法**：单元测试——连续调用 101 次 `retryBudget.consume(runId)`，验证第 101 次抛出 `RetryBudgetExceeded` 异常。

---
## 6. 深挖前端底子（§6.5 必需章节）

### 6.1 今天为什么要深挖"前端重试进度指示器"

Day 34 的核心是"服务端错误分类 + DLQ + 补偿 + 恢复点"，但如果前端没有"重试进度指示器"，用户会看到"AI 正在思考..."（30 秒），不知道后台正在重试。正确做法是**前端显示重试进度**（例如"重试中 (1/3)..."），让用户知道系统没有卡死。

今天深挖的不是"Vue 怎么写进度条"（Day 01-05 已经掌握），而是"为什么前端重试进度要用 WebSocket 推送而不是轮询"（轮询会浪费 HTTP 请求）、"为什么重试进度要显示'预计等待时间'而不是'重试次数'"（用户更关心等待时间）。

### 6.2 前端重试进度指示器的 3 个设计原则

#### 6.2.1 原则 1：用 WebSocket 推送而不是轮询

**错误做法**：前端每 1 秒轮询一次 `/api/runs/:id/status`，查询重试进度。

**问题**：
- 浪费 HTTP 请求（30 秒重试 = 30 个 HTTP 请求）
- 增加服务端负载（每个请求都要查 DB）
- 延迟高（轮询间隔 1 秒，用户感知延迟 1 秒）

**正确做法**：服务端通过 WebSocket 主动推送重试进度事件。

```typescript
// 服务端推送重试进度
socket.emit('retry:progress', {
  runId: 'run-001',
  attempt: 1,
  maxAttempts: 3,
  nextRetryIn: 2000, // 2 秒后重试
  reason: 'Request timeout',
})
```

```vue
<!-- 前端监听 WebSocket 事件 -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { io } from 'socket.io-client'

const retryProgress = ref({
  attempt: 0,
  maxAttempts: 3,
  nextRetryIn: 0,
})

onMounted(() => {
  const socket = io('/agent')
  socket.on('retry:progress', (data) => {
    retryProgress.value = {
      attempt: data.attempt,
      maxAttempts: data.maxAttempts,
      nextRetryIn: data.nextRetryIn,
    }
  })
})
</script>

<template>
  <div v-if="retryProgress.attempt > 0" class="retry-indicator">
    重试中 ({{ retryProgress.attempt }}/{{ retryProgress.maxAttempts }})...
    {{ Math.ceil(retryProgress.nextRetryIn / 1000) }}秒后重试
  </div>
</template>
```

#### 6.2.2 原则 2：显示"预计等待时间"而不是"重试次数"

**错误做法**：显示"重试中 (1/3)"，用户不知道要等多久。

**正确做法**：显示"重试中，预计 6 秒后恢复"，用户知道等待时间。

**计算方法**：指数退避（1s → 2s → 4s）

```typescript
function calculateWaitTime(attempt: number, baseDelay: number): number {
  // 指数退避：baseDelay * 2^attempt
  return baseDelay * Math.pow(2, attempt - 1)
}

// 总等待时间 = 第 1 次延迟 + 第 2 次延迟 + 第 3 次延迟
// = 1s + 2s + 4s = 7s
const totalWait = calculateWaitTime(1, 1000) + calculateWaitTime(2, 1000) + calculateWaitTime(3, 1000)
```

```vue
<template>
  <div class="retry-indicator">
    重试中，预计 {{ Math.ceil(totalWait / 1000) }} 秒后恢复
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const retryProgress = ref({
  attempt: 1,
  maxAttempts: 3,
  elapsedTime: 0, // 已等待时间（ms）
})

const totalWait = computed(() => {
  // 计算总等待时间（所有重试延迟之和）
  let total = 0
  for (let i = 1; i <= retryProgress.value.maxAttempts; i++) {
    total += 1000 * Math.pow(2, i - 1)
  }
  return total
})

const progress = computed(() => {
  return (retryProgress.value.elapsedTime / totalWait.value) * 100
})
</script>
```

#### 6.2.3 原则 3：区分"可恢复错误"和"不可恢复错误"的视觉反馈

**可恢复错误（Transient）**：显示"重试中"（蓝色）+ 进度条

**不可恢复错误（Permanent）**：显示"操作失败"（红色）+ 错误提示

```vue
<template>
  <div v-if="error.type === 'transient'" class="retry-indicator retry-transient">
    <span class="icon">🔄</span>
    重试中 ({{ error.attempt }}/{{ error.maxAttempts }})...
  </div>

  <div v-if="error.type === 'permanent'" class="retry-indicator retry-permanent">
    <span class="icon">❌</span>
    操作失败：{{ error.reason }}
  </div>

  <div v-if="error.type === 'poison'" class="retry-indicator retry-poison">
    <span class="icon">⚠️</span>
    请求异常，已转入人工处理队列
  </div>
</template>

<style scoped>
.retry-transient {
  background: #eff6ff;
  color: #1e40af;
  border-left: 4px solid #3b82f6;
}

.retry-permanent {
  background: #fef2f2;
  color: #991b1b;
  border-left: 4px solid #ef4444;
}

.retry-poison {
  background: #fffbeb;
  color: #92400e;
  border-left: 4px solid #f59e0b;
}
</style>
```

### 6.3 为什么不能只依赖"loading 状态"

**误区**："反正前端有 loading 状态，不需要重试进度指示器"。

**错误原因**：
1. loading 状态不区分"首次请求"和"重试请求"（用户不知道后台在重试）
2. loading 状态不显示等待时间（用户不知道要等多久）
3. loading 状态不区分"可恢复错误"和"不可恢复错误"（用户不知道是否需要重试）

**正确分工**：
- **loading 状态**：显示"请求进行中"（通用）
- **重试进度指示器**：显示"重试中 (1/3)，预计 6 秒后恢复"（专用）

### 6.4 HTML 知识点：progress 元素 vs div 进度条

**HTML 规范**：`<progress value="30" max="100">` 是原生进度条元素。

**为什么不用 progress 元素？**
1. 样式定制困难（不同浏览器渲染效果不同）
2. 不支持动画（无法平滑过渡）
3. 不支持自定义颜色（只能用浏览器默认样式）

**正确做法**：用 div + CSS 自定义进度条。

```html
<div class="progress-bar">
  <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
</div>
```

```css
.progress-bar {
  width: 100%;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #1e40af 100%);
  transition: width 0.3s ease; /* 平滑过渡 */
}
```

### 6.5 CSS 知识点：重试进度的视觉层次

**原则**：可恢复错误（Transient）用蓝色（提示用户"系统正在处理"），不可恢复错误（Permanent）用红色（提示用户"需要人工介入"）。

**为什么 Transient 用蓝色而不是黄色？**
黄色是"警告"色（用户需要注意），蓝色是"信息"色（系统正常运行）。Transient 错误是"系统正在自动修复"，不需要用户介入，应该用蓝色（降低用户焦虑）。

**为什么 Poison 用橙色而不是红色？**
红色是"失败"色（用户无法继续），橙色是"延迟"色（人工处理中）。Poison event 会被转入人工处理队列（不是永久失败），应该用橙色（提示用户"已转入人工处理，请稍后"）。

---

## 7. 测试与验证（§7 必需章节）

### 7.1 单元测试（CompensationExecutor）

```typescript
// apps/api/src/recovery/compensation/compensation-executor.spec.ts
import { Test } from '@nestjs/testing'
import { CompensationExecutor } from './compensation-executor'
import { CompensationRegistry } from './compensation-registry'
import { PrismaService } from '../../persistence/prisma.service'

describe('CompensationExecutor', () => {
  let executor: CompensationExecutor
  let registry: CompensationRegistry
  let prisma: PrismaService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CompensationExecutor,
        CompensationRegistry,
        {
          provide: PrismaService,
          useValue: {
            recoveryAuditLog: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile()

    executor = module.get(CompensationExecutor)
    registry = module.get(CompensationRegistry)
    prisma = module.get(PrismaService)
  })

  it('应按逆序补偿已执行的工具', async () => {
    const compensateSpy = jest.fn()
    registry.register('tool1', { type: 'rollback', toolName: 'tool1', execute: compensateSpy })
    registry.register('tool2', { type: 'rollback', toolName: 'tool2', execute: compensateSpy })

    await executor.compensate('run-001', [
      { toolName: 'tool1', callId: 'c1', result: {}, executedAt: new Date() },
      { toolName: 'tool2', callId: 'c2', result: {}, executedAt: new Date() },
    ])

    // 验证按逆序调用（tool2 先补偿，tool1 后补偿）
    expect(compensateSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ callId: 'c2' }))
    expect(compensateSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ callId: 'c1' }))
  })
})
```

### 7.2 集成测试（重放不重复执行）

```typescript
// apps/api/test/recovery-replay.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { ReplayEngine } from '../src/recovery/replay/replay-engine'
import { ToolRegistry } from '../src/tool/tool-registry'

describe('Replay Engine (E2E)', () => {
  let app: INestApplication
  let replayEngine: ReplayEngine
  let toolRegistry: ToolRegistry

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
    replayEngine = app.get(ReplayEngine)
    toolRegistry = app.get(ToolRegistry)
  })

  afterAll(async () => {
    await app.close()
  })

  it('重放时应跳过已执行的工具', async () => {
    const executeSpy = jest.spyOn(toolRegistry, 'execute')

    const tools = [
      { toolName: 'getMetrics', callId: 'c1', args: { serverId: 'srv-001' } },
      { toolName: 'restartServer', callId: 'c2', args: { serverId: 'srv-001' } },
    ]

    // 第一次重放（执行所有工具）
    await replayEngine.replay('run-001', tools)
    expect(executeSpy).toHaveBeenCalledTimes(2)

    // 第二次重放（应跳过已执行的工具）
    executeSpy.mockClear()
    await replayEngine.replay('run-001', tools)
    expect(executeSpy).toHaveBeenCalledTimes(0) // 跳过所有工具
  })
})
```

### 7.3 反证实验 1：移除错误分类后参数错误也重试

**假设**：如果移除错误分类（不区分 Transient vs Permanent），参数错误也会重试 3 次。

**实验步骤**：
1. 注释掉 `ToolQueueProcessor` 里的错误分类代码
2. 加入一个参数错误的 job（`serverId: 'invalid'`）
3. 观察重试次数

**预期现象**：重试 3 次（浪费资源）。

**实际现象**（移除错误分类后）：
```
[Processor] Executing getMetrics with invalid serverId
[Processor] Error: Invalid serverId format
[Processor] Retrying (1/3)...
[Processor] Error: Invalid serverId format
[Processor] Retrying (2/3)...
[Processor] Error: Invalid serverId format
[Processor] Retrying (3/3)...
[Processor] Error: Invalid serverId format
[Processor] Job finally failed after 3 attempts
```

**恢复操作**：恢复错误分类代码，重新测试，验证参数错误立即失败（不重试）。

### 7.4 反证实验 2：移除补偿后已执行工具不回滚

**假设**：如果移除补偿机制，工具失败后已执行的工具不回滚。

**实验步骤**：
1. 注释掉 `RecoveryService.handleFailure` 里的补偿代码
2. 执行 3 个工具（重启服务器 → 清空缓存 → 发送告警）
3. 第 4 个工具失败
4. 观察前 3 个工具是否回滚

**预期现象**：前 3 个工具不回滚（服务器已重启、缓存已清空、告警已发送）。

**实际现象**（移除补偿后）：
```
[Processor] Executed restartServer
[Processor] Executed clearCache
[Processor] Executed sendAlert
[Processor] Failed to execute generateReport
[Processor] Job failed
// 没有补偿日志（前 3 个工具不回滚）
```

**恢复操作**：恢复补偿代码，重新测试，验证前 3 个工具被补偿（按逆序）。

### 7.5 四件套（依赖图 + 时序图 + 日志 + commit）

#### 7.5.1 依赖图

```
tool-queue.processor.ts
          ↓
    recovery.service.ts ──────────────────┐
          ↓                               │
    ┌─────┴──────┬──────────┬────────────┤
error-classifier  dlq-handler  compensation-executor  checkpoint-manager  replay-engine
    ↓                ↓                ↓                       ↓                ↓
error-taxonomy  poison-detector  compensation-registry  checkpoint-store  idempotency-checker
```

#### 7.5.2 时序图（工具失败 → 补偿全流程）

```
processor         recovery-service    error-classifier    compensation-executor    checkpoint-manager
    │                    │                     │                      │                      │
    │─execute tool───────→│                     │                      │                      │
    │                    │─classify error─────→│                      │                      │
    │                    │←Permanent───────────│                      │                      │
    │                    │─compensate()───────────────────────────────→│                      │
    │                    │                     │                      │─execute(rollback)───→│
    │                    │                     │                      │←done─────────────────│
    │                    │←done────────────────────────────────────────│                      │
    │←PERMANENT error────│                     │                      │                      │
```

#### 7.5.3 测试日志截图

```
[ErrorClassifier] Classified error as PERMANENT: Invalid serverId format
[CompensationExecutor] Starting compensation for run-001 (3 tools)
[CompensationExecutor] Compensating sendAlert (callId: c3)
[CompensationExecutor] Compensating clearCache (callId: c2)
[CompensationExecutor] Compensating restartServer (callId: c1)
[RecoveryAuditService] Logged event: compensated { toolName: 'sendAlert', type: 'notify' }
[RecoveryAuditService] Logged event: compensated { toolName: 'clearCache', type: 'log' }
[RecoveryAuditService] Logged event: compensated { toolName: 'restartServer', type: 'log' }
```

#### 7.5.4 commit 信息

```bash
git add .
git commit -m "feat(recovery): add unified failure recovery strategy

- Add error classification (Transient vs Permanent)
- Add DLQ for poison event isolation
- Add compensation mechanism (Saga pattern)
- Add checkpoint for preventing duplicate execution
- Add replay engine with idempotency

Refs: Day34"
```

---
## 8. 通关检查清单（v3 规范 11 项）

Day 34 交付前的自查：

1. **§0 位置声明**：已写明"阶段二第 4 天"、Day 29/32/33 前置依赖、Day 35-40 后续对齐
2. **§1.1 用户能看到什么**：已写 5 个场景（工具超时、参数错误、Poison event 隔离、补偿机制、恢复点）
3. **§1.4 目录结构 5 块**：已写骨架树 + 为什么分层 5 问 + diff 表格 + 依赖箭头 + 3 个灵魂拷问
4. **§1.5 脚手架检查**：已写 Day 29/27 依赖检查 + Prisma Schema + 迁移脚本
5. **三版演进**：v1 简单重试（固定 3 次）→ v2 错误分类 + DLQ → v3 补偿 + 恢复点 + 重放
6. **§5.3 完整代码**：ErrorClassifier、DlqHandler、CompensationExecutor、CheckpointManager、ReplayEngine、RecoveryService，无省略号
7. **§5.4 ≥ 6 知识点**：错误分类 taxonomy、DLQ、补偿机制、恢复点、幂等性、Retry Budget，每个 5 要素
8. **§6.5 前端底子补弱**：深挖"前端重试进度指示器" + WebSocket 推送 + 预计等待时间 + 视觉层次
9. **§7 测试 4 件套**：单元测试（CompensationExecutor）+ 集成测试（重放不重复）+ 反证实验 1（移除错误分类）+ 反证实验 2（移除补偿）+ 依赖图 + 时序图 + 日志 + commit
10. **0 个 `> ✅/❌` blockquote**：全文无此格式
11. **commit 不含 git push**：commit 信息写 `Refs: Day34`，不执行 push

---

## 9. 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 34 交付的失败恢复模块（错误分类 + DLQ + 补偿 + 恢复点 + 重放）是后续 14 个能力的基座：

1. **Day 35-40 LangGraph 状态机编排**：状态机节点失败后的恢复策略复用今天的错误分类 + 补偿机制
2. **Day 41-50 RAG 深化**：向量检索失败（例如 Pinecone 超时）复用今天的重试策略（Transient 错误重试 3 次）
3. **Day 51-60 可观测性**：失败恢复审计日志是 SLA 监控的数据源（"查询 P99 重试延迟"）

### 9.2 今天留下的 3 个待优化点

1. **补偿失败的优雅降级**：v3 的补偿失败只记录日志（不抛异常），但没有"补偿失败 3 次后发送告警"。Day 35 会补充补偿失败告警。

2. **Retry Budget 滑动窗口**：v3 只提到 Retry Budget 概念，没有实现代码。Day 36 会补充滑动窗口实现（例如"1 小时内最多重试 100 次"）。

3. **DLQ 人工处理界面**：v3 只实现了"移入 DLQ"，没有实现"人工审查 DLQ 并重新处理"的界面。Day 37 会补充 DLQ 管理界面。

### 9.3 下一站要解决的核心问题

**Day 35：LangGraph 状态机编排（Plan-Act-Reflect 循环 + 状态转移 + 失败恢复）**

核心挑战：
- 如何用状态机表达"Plan → Act → Reflect → 如果 Act 失败 → 补偿 → 重新 Plan"？
- 如何让状态机节点失败后，自动触发补偿（复用 Day 34 的 CompensationExecutor）？
- 如何在状态机里插入恢复点（checkpoint），保证状态转移可恢复？

---

## 10. 本日小结（标题党 30 字 + 三句话）

**标题**：错误分类防浪费、DLQ 隔离毒事件、补偿机制保一致、恢复点防重复——失败恢复完整实现

Day 34 建立了统一失败恢复策略，解决了"不可重试错误浪费资源"、"Poison event 拖垮正常流量"、"工具失败不回滚"、"重复执行"四个生产痛点。核心机制是"错误分类 taxonomy（Transient vs Permanent）+ DLQ 隔离 Poison event + 补偿机制（Saga 模式）+ 恢复点（checkpoint）防止重复执行 + 事件重放幂等性"。今天建立的失败恢复模块是 Day 35-40 LangGraph 状态机编排的节点失败恢复基座。

---

## 11. 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"失败恢复"的数据流或控制流；当天知识链"Retry taxonomy、补偿、Poison event、恢复点、重放"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
工具执行失败
  → RecoveryService.handleFailure()
  → ErrorClassifier.classify()（错误分类）
  → 判断错误类型：
     - Permanent → CompensationExecutor.compensate()（补偿）→ throw PERMANENT
     - Poison → DlqHandler.moveToDeadLetter()（移入 DLQ）→ CompensationExecutor.compensate() → throw POISON
     - Transient → throw error（由 BullMQ 重试）
  → 队列重启后：
     - ReplayEngine.replay()（从 checkpoint 恢复）
     - 检查 checkpoint：已执行的工具跳过（不重复执行）
```

**知识链分层**：
- **Retry taxonomy**：ErrorClassifier 分类层（判断是否重试）
- **补偿**：CompensationExecutor 补偿层（回滚已执行工具）
- **Poison event**：DlqHandler 隔离层（移入 DLQ）
- **恢复点**：CheckpointManager 持久化层（写入/读取 checkpoint）
- **重放**：ReplayEngine 恢复层（从 checkpoint 重放）

**为什么按这个顺序学习**：
1. 先学 Retry taxonomy（错误分类），才能谈"是否重试"
2. 再学补偿（Compensation），才能谈"失败后如何回滚"
3. 再学 Poison event（DLQ），才能谈"重试失败后如何隔离"
4. 再学恢复点（Checkpoint），才能谈"重放时如何跳过已执行工具"
5. 最后学重放（Replay），才能谈"队列重启后如何恢复"

这个顺序是"从判断层到执行层到隔离层到持久化层到恢复层"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：错误分类（不区分 Transient vs Permanent）。

**可观察现象**：参数错误也重试 3 次（浪费资源）。

**最小复现**：
1. 注释掉 `ToolQueueProcessor` 里的 `errorClassifier.classify()` 代码
2. 加入一个参数错误的 job（`serverId: 'invalid'`）
3. 观察重试次数

**定位证据**：
```
[Processor] Error: Invalid serverId format
[Processor] Retrying (1/3)...
[Processor] Error: Invalid serverId format
[Processor] Retrying (2/3)...
[Processor] Error: Invalid serverId format
[Processor] Retrying (3/3)...
```

DB 查询：
```sql
SELECT * FROM recovery_audit_logs WHERE runId = 'run-001' AND event = 'retry_started';
-- 预期：3 条记录（重试 3 次）
```

**恢复动作**：
1. 恢复错误分类代码
2. 重启服务
3. 验证参数错误立即失败（不重试）

**防复发测试**（E2E）：
```typescript
it('参数错误应立即失败，不重试', async () => {
  await toolQueue.add('execute-tool', {
    runId: 'run-001',
    toolName: 'getMetrics',
    toolArgs: { serverId: 'invalid' },
  })

  await new Promise((resolve) => setTimeout(resolve, 2000))

  const job = await toolQueue.getJob('...')
  expect(job.attemptsMade).toBe(1) // 只尝试 1 次（不重试）
  expect(job.failedReason).toContain('PERMANENT')
})
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `apps/api/src/recovery/classifier/error-classifier.ts` 第 18 行：`classify()` 方法实现错误分类（Transient vs Permanent）
- `apps/api/src/recovery/compensation/compensation-executor.ts` 第 28 行：`compensate()` 方法按逆序补偿已执行工具
- `apps/api/src/recovery/checkpoint/checkpoint-manager.ts` 第 32 行：`save()` 方法写入恢复点
- `apps/api/src/recovery/replay/replay-engine.ts` 第 25 行：`replay()` 方法从 checkpoint 恢复并重放

**测试证据**：
- `apps/api/src/recovery/classifier/error-classifier.spec.ts` 第 12 行：超时错误分类为 Transient 测试
- `apps/api/test/recovery-replay.e2e-spec.ts` 第 28 行：重放不重复执行测试（验证从 checkpoint 恢复）

**架构证据**：
- 依赖图（§7.5.1）：展示 6 层分层（classifier/dlq/compensation/checkpoint/replay/audit）
- 时序图（§7.5.2）：展示工具失败到补偿的完整流程

**项目目标达成**：
- ✅ 区分可重试 vs 不可重试错误（ErrorClassifier）
- ✅ Poison event 隔离（DlqHandler）
- ✅ 补偿机制（CompensationExecutor）
- ✅ 恢复点防止重复执行（CheckpointManager）
- ✅ 事件重放幂等性（ReplayEngine）

**距离企业生产标准还缺**：
1. **Retry Budget 滑动窗口**：限制"1 小时内最多重试 100 次"（当前没有限制）
2. **补偿失败告警**：补偿失败 3 次后发送告警（当前只记录日志）
3. **DLQ 人工处理界面**：运维审查 DLQ 并重新处理的界面（当前只能通过代码操作）
4. **Circuit Breaker**：外部 API 持续失败时自动熔断（当前会一直重试）

**下一步演进（不破坏合同）**：
- 在 `RecoveryService` 里新增 `retryBudget` 字段（检查重试次数是否超限）
- 在 `CompensationExecutor` 里新增 `onCompensationFailed` 回调（补偿失败时发送告警）
- 新增 `DlqManagementController`（提供 DLQ 管理 API），不改变现有 `DlqHandler` 接口
- 新增 `CircuitBreakerService`（检查外部 API 失败率），不改变现有重试逻辑

---

## 12. 真实项目情境题（Day 34 原版，保持原样）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：一个格式错误的 Tool 事件被 worker 重试 100 次，队列积压从 800 增至 6 万，正常任务 P95 等待 22 分钟。请用 failedReason、attemptsMade、事件版本和队列指标识别 poison event，先暂停该消费者并转入隔离队列，再建立可重试分类、DLQ 与补偿策略，验证坏事件不再拖垮正常流量。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)

2. 模拟情境：支付查询 Tool 已成功返回，但 worker 在写 checkpoint 前崩溃，重放后外部计费发生两次。请从外部 requestId、jobId、checkpoint 与幂等键定位窗口，先停止自动重放并核对账单，再修复幂等协议和恢复点，使用四阶段 crash 注入证明重试不重复产生副作用。
   依据：[BullMQ Idempotent Jobs](https://docs.bullmq.io/patterns/idempotent-jobs)

知识映射：对应 Retry taxonomy、补偿、Poison event、恢复点与重放。

---

## 13. PDF 面试题映射（Day 34 原版，保持原样）

1. AI 接口超时与异常重试策略应如何设计？  
   来源：[《2026腾讯混元AIGC前端架构师》](<../../资源/2026腾讯混元AIGC前端架构师.pdf>)，第 7 页。

2. 流式输出过程中若客户端要实时中断请求，应怎样处理？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 2 页。

题目说明：近似题/资源缺口：覆盖超时、重试和中断；Poison event、补偿、恢复点与事件重放没有直接题。

---

## 14. 完成后教师五连问（Day 34 原版，保持原样）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
