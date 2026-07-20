# Day 33：Durable HITL（可持久化人机协作 + pause/resume + 租约 + 队列恢复）

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
日期与时长：2026-08-15 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 17 内存审批（HITL）后，第一次面对"服务重启时有 300 个 run 停在审批状态，恢复后审批丢失或重复执行"痛点的全栈开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-30：全栈基础 + M3 月度门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 全栈深化 + Agent 编排
   Day 17：HITL（内存审批）
   Day 31：Tool Registry v2（多租户 + 版本治理）
   Day 32：Orchestrator（Plan-Act-Observe + 并行）
   Day 33：Durable HITL（持久化审批 + pause/resume）  ← 今天在这里
   Day 34-40：LangGraph 状态机编排
   Day 41-50：RAG 深化 + Hybrid Search
   Day 51-60：可观测性 + M6 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 33 在阶段二第 3 天**。Day 17 实现了内存审批（Agent 调用删除工具前，前端弹窗要求人工确认），但没有持久化：服务重启后，所有"停在审批状态的 Run"都会丢失或重复执行。今天要把 Day 17 的内存审批升级为 **Durable HITL**：审批状态持久化到 DB + BullMQ 队列，支持 pause/resume、租约（lease）防止重复执行、服务重启后自动恢复。

### 到 Day 32 结束时项目已具备的能力

- **内存审批**（Day 17）：Agent 调用删除工具前，前端弹窗要求人工确认，用户点击"通过"或"拒绝"
- **Orchestrator**（Day 32）：Plan-Act-Observe 循环 + 并行执行 + 循环检测 + 预算追踪
- **队列**（Day 29）：BullMQ jobId 幂等 + 重试退避 + 死信
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除

### 今天要解决的 4 个问题

1. **问题 1：服务重启后审批丢失（审批状态只在内存）**
   Day 17 的审批状态存在内存里（`approvalState = new Map<approvalId, ApprovalRequest>()`）。服务重启后，Map 清空，所有"停在审批状态的 Run"都会丢失，用户无法继续审批。**如何持久化？**

2. **问题 2：重复执行（租约过期后多个 worker 拿到执行权）**
   审批通过后，worker 开始执行工具。如果工具执行耗时 10 分钟，但租约（lease）只有 5 分钟，租约过期后另一个 worker 也会拿到执行权，导致工具重复执行 2 次。**如何用租约防止？**

3. **问题 3：双审批人同时点击"通过"（竞态条件）**
   两个审批人几乎同时点击"通过"按钮，两个 HTTP 请求同时到达服务端，都读到 `status: 'pending'`，都执行工具，导致工具重复执行 2 次。**如何用乐观锁防止？**

4. **问题 4：审批恢复后无法追溯决策链路（审计缺失）**
   服务重启后，审批恢复，但不知道"谁在什么时候点了什么按钮"。运营无法追溯敏感操作（例如删除服务器）的决策链路。**如何审计？**

---
## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付 **Durable HITL 模块**：在 Day 17 内存审批的基础上，增加"审批状态持久化 + pause/resume + 租约（lease）+ 乐观锁防双审批 + 服务重启恢复 + 审计日志"。

### 1.1 用户能看到什么

**场景：Agent 调用删除服务器工具，需要运维主管审批**

```
14:30:00.000  Agent 请求调用 deleteServer(srv-042)
  → 服务端：创建 ApprovalRequest（approvalId: apv-001, status: 'pending'）
  → 持久化到 DB（approval_requests 表）
  → 发送 WebSocket 事件到前端

14:30:00.100  前端弹出审批弹窗
  标题：Agent 请求删除服务器
  内容：工具 deleteServer，参数 { serverId: 'srv-042' }
  按钮：[通过] [拒绝]

14:32:15.000  运维主管点击"通过"
  → 前端：POST /approvals/apv-001/approve
  → 服务端：乐观锁更新（UPDATE approval_requests SET status='approved', version=version+1 WHERE id='apv-001' AND version=1）
  → 写审计日志（approval_audit_logs 表）

14:32:15.100  服务端开始执行 deleteServer
  → 获取租约（lease）：UPDATE approval_requests SET lease_owner='worker-01', lease_expires_at=NOW()+INTERVAL 10 MINUTE WHERE id='apv-001'
  → 执行工具：deleteServer(srv-042)
  → 工具执行耗时 3 分钟

14:35:15.100  工具执行完成
  → 释放租约：UPDATE approval_requests SET lease_owner=NULL WHERE id='apv-001'
  → 标记完成：UPDATE approval_requests SET status='executed' WHERE id='apv-001'

14:36:00.000  服务重启（模拟崩溃）
  → 服务启动时，扫描 approval_requests 表
  → 找到 status='approved' 且 lease_owner IS NULL 的记录（说明审批通过但未执行）
  → 自动恢复：重新加入队列

14:36:05.000  队列 worker 拾取恢复的审批
  → 获取租约
  → 执行工具
  → 标记完成
```

**关键观察**：
- 服务重启后，审批状态恢复（不丢失）
- 租约机制防止重复执行（工具执行期间，其他 worker 无法拿到执行权）
- 乐观锁防止双审批（两个审批人同时点击"通过"，只有一个成功）
- 审计日志记录完整决策链路（谁在什么时候点了什么按钮）

### 1.2 这个模块在项目里承担什么

- **输入**：Agent 调用敏感工具（例如 deleteServer）+ 审批人决策（approve/reject）
- **输出**：持久化的审批状态 + 工具执行结果 + 审计日志
- **对齐后续**：Day 34-40 LangGraph 状态机编排时，Durable HITL 是"Human-in-the-loop 节点"的持久化实现；Day 51-60 可观测性时，审计日志用于合规审计

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 内存审批（Day 17 原版） | 单文件 `approval.service.ts`（Map 存状态） | HITL 概念、前端弹窗确认 |
| **v1 痛点** | 服务重启丢失、无租约（重复执行）、无乐观锁（双审批）、无审计 |  |  |
| **v2** | v1 + **持久化（DB）** + **pause/resume** | 拆出 `approval-repository.ts` + `approval-state.ts` | 持久化状态机、恢复逻辑 |
| **v2 痛点** | 无租约（重复执行）、无乐观锁（双审批）、审计不完整 |  |  |
| **v3** | v2 + **租约（lease）** + **乐观锁** + **完整审计** | 完整分层（state/lease/lock/audit/recovery） | 租约语义、乐观锁版本号、审计日志 |

**用户最终在项目里交付的是 v3**。v1 是 Day 17 原版，v2 和 v3 是今天增量。

---
## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Durable HITL 涉及"持久化状态 + 租约管理 + 乐观锁更新 + 服务重启恢复 + 审计日志"5 个关注点，如果不先立骨架，最容易犯的错就是把"状态持久化"、"租约获取/释放"、"乐观锁版本号"、"恢复扫描"糊在一个 service 里。看完这棵树，下面章节再出现 `approval/lease/lease-manager.ts` 时，你就能立刻定位它属于"租约管理层"。

**今天在 `p1-monitor/` 下要建立的完整目录树（v3 完整版）**：

```
p1-monitor/
├── apps/api/src/
│   ├── approval/                                  ← 【Day 17 已有，今天升级】
│   │   ├── state/
│   │   │   ├── approval-state.ts                  ← 审批状态枚举（pending/approved/rejected/executed）
│   │   │   ├── approval-request.entity.ts         ← Prisma Entity（审批请求）
│   │   │   └── approval-repository.ts             ← 持久化仓储（CRUD + 乐观锁）
│   │   ├── lease/
│   │   │   ├── lease-manager.ts                   ← 租约管理器（acquire/release/renew）
│   │   │   ├── lease-config.ts                    ← 租约配置（默认 10 分钟）
│   │   │   └── lease-expiry-checker.ts            ← 租约过期检查器（定时扫描）
│   │   ├── audit/
│   │   │   ├── approval-audit.service.ts          ← 审计日志服务
│   │   │   ├── approval-audit-log.entity.ts       ← Prisma Entity（审计日志）
│   │   │   └── audit-event.types.ts               ← 审计事件类型（created/approved/rejected/executed）
│   │   ├── recovery/
│   │   │   ├── approval-recovery.service.ts       ← 服务重启恢复服务
│   │   │   ├── recovery-scanner.ts                ← 扫描未完成的审批
│   │   │   └── recovery-strategy.ts               ← 恢复策略（重新加入队列 vs 标记失败）
│   │   ├── approval.service.ts                    ← 【Day 17 已有，今天改造】主业务逻辑
│   │   ├── approval.controller.ts                 ← 【Day 17 已有】HTTP 入口（POST approve/reject）
│   │   ├── approval.module.ts                     ← NestJS 模块
│   │   └── index.ts                               ← 桶文件
│   ├── queue/                                     ← 【Day 29 已有】
│   │   └── approval-queue.processor.ts            ← 【新增】审批队列 processor
│   └── persistence/                               ← 【Day 27 已有】
│       └── prisma/schema.prisma                   ← 【新增】approval_requests 和 approval_audit_logs 表
├── packages/shared/src/
│   └── types/approval.types.ts                    ← 【新增】前后端共享类型
└── frontend/src/
    └── agent/
        └── approval-dialog.vue                    ← 【Day 17 已有】审批弹窗
```

**为什么这样分层**（5 个追问）：

1. **为什么把 state/lease/audit/recovery 分成四个目录？**
   这四个关注点职责清晰：state 管理审批生命周期、lease 管理执行权、audit 记录决策链路、recovery 处理服务重启。分层后每个关注点可以独立测试（例如 Mock LeaseManager 测试 ApprovalService）。

2. **为什么 LeaseManager 要单独提取？**
   租约不仅用于审批，还可以用于"定时任务"、"批处理"等场景。提取为独立模块后，Day 34-40 LangGraph 状态机编排时可以复用（例如"Human-in-the-loop 节点的租约"）。

3. **为什么审计日志要单独建表（approval_audit_logs）？**
   审批表（approval_requests）是"当前状态"（status/version），审计日志表是"历史事件流"（created → approved → executed）。分开后可以独立查询（例如"查询某用户在 2026 年审批了多少次删除操作"）。

4. **为什么需要 RecoveryScanner？**
   服务重启后，需要扫描"审批通过但未执行"的记录（status='approved' 且 lease_owner IS NULL），重新加入队列。如果不扫描，这些审批会永远停在"已批准"状态，工具永远不执行。

5. **为什么 LeaseExpiryChecker 要定时扫描？**
   租约过期后（lease_expires_at < NOW()），如果 worker 崩溃未释放租约，需要强制回收（lease_owner 置为 NULL），让其他 worker 可以拿到执行权。如果不扫描，租约会永远被"死 worker"占用。

**diff 表格**（Day 17 → Day 33 增量）：

| 变更类型 | 文件路径 | Day 17 状态 | Day 33 变化 | 原因 |
|---|---|---|---|---|
| 新增目录 | `approval/state/` | 不存在 | 新建（持久化层） | 审批状态持久化到 DB |
| 新增目录 | `approval/lease/` | 不存在 | 新建（租约管理） | 防止重复执行 |
| 新增目录 | `approval/audit/` | 不存在 | 新建（审计日志） | 记录决策链路 |
| 新增目录 | `approval/recovery/` | 不存在 | 新建（恢复逻辑） | 服务重启恢复 |
| 修改文件 | `approval.service.ts` | 内存 Map 存状态 | 改为调用 ApprovalRepository | 持久化 |
| 新增文件 | `prisma/schema.prisma` | 无审批表 | 新增 ApprovalRequest 和 ApprovalAuditLog 表 | 持久化 Schema |
| 新增文件 | `approval-queue.processor.ts` | 不存在 | 新建（队列 processor） | 异步执行工具 |

**依赖箭头图**（从下往上看）：

```
前端 approval-dialog.vue
          ↑（通过 HTTP POST）
    approval.controller.ts
          ↑（调用）
    approval.service.ts ────────────────┐
          ↑                             │
    ┌─────┴──────┬──────────┬──────────┤
approval-repository.ts  lease-manager.ts  approval-audit.service.ts  approval-recovery.service.ts
    ↓                ↓                     ↓                           ↓
prisma（approval_requests）  lease-expiry-checker.ts  prisma（approval_audit_logs）  recovery-scanner.ts
    ↓
BullMQ（approval-queue）
```

**3 个灵魂拷问**（动手前先回答）：

1. **如果不持久化审批状态，直接用 BullMQ 的"延迟队列"（delay）等待审批，会有什么问题？**
   答：延迟队列的 delay 时间是固定的（例如 1 小时），但审批可能需要 3 天才通过。如果 delay 设为 3 天，服务重启后延迟队列丢失（BullMQ 内存队列不持久化），审批就丢了。正确做法是"审批状态持久化到 DB + 审批通过后才加入队列"。

2. **为什么租约（lease）的过期时间要比工具执行时间长？**
   答：如果工具执行耗时 10 分钟，但租约只有 5 分钟，租约过期后另一个 worker 也会拿到执行权，导致工具重复执行 2 次。租约过期时间应该是"工具执行最大耗时 × 1.5"（例如工具最大 10 分钟，租约设 15 分钟）。

3. **如果省略乐观锁（version 字段），直接用 `UPDATE approval_requests SET status='approved' WHERE id=?`，会有什么问题？**
   答：两个审批人同时点击"通过"，两个 UPDATE 都会成功（因为没有 WHERE version=?），导致工具重复执行 2 次。乐观锁保证"只有第一个 UPDATE 成功（version 匹配），第二个 UPDATE 失败（version 已变）"。

---
## 1.5 今天动手前的脚手架检查

**为什么放在 §1 里**：Day 33 依赖 Day 17（内存审批）、Day 27（持久化）、Day 29（BullMQ 队列）的代码。如果这些依赖缺失，今天的改造无法进行。先检查脚手架完整性，缺什么补什么，再开始动手。

### 1.5.1 Day 17 内存审批代码检查

```bash
# 检查 Day 17 审批模块是否存在
ls apps/api/src/approval/approval.service.ts
ls apps/api/src/approval/approval.controller.ts
ls frontend/src/agent/approval-dialog.vue
```

**如果缺失**：先完成 Day 17（内存审批），再回来做 Day 33。

### 1.5.2 Day 27 持久化基础检查

```bash
# 检查 Prisma 是否已配置
ls apps/api/prisma/schema.prisma
# 检查 PrismaService 是否已注入
grep -r "PrismaService" apps/api/src/
```

**如果缺失**：先完成 Day 27（Postgres 持久化），再回来做 Day 33。

### 1.5.3 Day 29 BullMQ 队列检查

```bash
# 检查 BullMQ 是否已安装
grep "bullmq" package.json
# 检查队列模块是否存在
ls apps/api/src/queue/
```

**如果缺失**：先完成 Day 29（队列/BullMQ），再回来做 Day 33。

### 1.5.4 今天需要新建的 Prisma Schema

在 `apps/api/prisma/schema.prisma` 里新增两张表（approval_requests 和 approval_audit_logs）：

```prisma
model ApprovalRequest {
  id                String    @id @default(cuid())
  runId             String
  toolName          String
  toolArgs          Json
  status            String    // 'pending' | 'approved' | 'rejected' | 'executed'
  version           Int       @default(0)  // 乐观锁版本号
  leaseOwner        String?   // 租约持有者（worker-01）
  leaseExpiresAt    DateTime? // 租约过期时间
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([runId])
  @@index([status])
  @@index([leaseOwner])
  @@index([leaseExpiresAt])
}

model ApprovalAuditLog {
  id          String   @id @default(cuid())
  approvalId  String
  event       String   // 'created' | 'approved' | 'rejected' | 'executed'
  userId      String?  // 审批人 ID（nullable，因为 'created' 事件无审批人）
  metadata    Json     // 额外信息（例如拒绝原因）
  occurredAt  DateTime @default(now())

  @@index([approvalId])
  @@index([userId])
  @@index([occurredAt])
}
```

**为什么 version 字段默认 0？**
乐观锁的 version 从 0 开始，每次更新 +1（UPDATE SET version=version+1 WHERE version=?）。

**为什么 leaseOwner 和 leaseExpiresAt 是 nullable？**
审批创建时（status='pending'）还没有租约，只有审批通过后（status='approved'）才获取租约开始执行工具。

**为什么 ApprovalAuditLog 不关联外键（approvalId 不是 @relation）？**
审计日志是"写入即不可变"的历史记录，不需要级联删除（删除审批不删审计）。用 String 类型而不是外键，降低数据库耦合。

### 1.5.5 迁移脚本

```bash
cd apps/api
npx prisma migrate dev --name add_approval_tables
npx prisma generate
```

**验证迁移成功**：
```bash
# 检查表是否创建
psql -U postgres -d p1_monitor -c "\dt approval*"
# 预期输出：approval_requests 和 approval_audit_logs 两张表
```

---

## 2. 今天的开发节奏（6 小时怎么分配）

**总计 360 分钟**，按"理解原理 → 实现 v2 持久化 → 实现 v3 租约/乐观锁 → 测试验证 → 架构证据"5 个阶段推进。

| 阶段 | 时长 | 任务 | 输出 | 为什么这样安排 |
|---|---|---|---|---|
| **阶段 1** | 60 min | 阅读 BullMQ 官方文档（Idempotent Jobs）+ 理解租约语义 | 笔记：租约获取/释放/过期的时序图 | Durable HITL 的核心是"租约防止重复执行"，不理解租约语义会写出"租约过期后仍持有锁"的 Bug |
| **阶段 2** | 90 min | 实现 v2（持久化 + pause/resume）：ApprovalRepository + RecoveryScanner | 可运行的 v2 代码 + 单元测试 | 先建立持久化基座，再加租约/乐观锁 |
| **阶段 3** | 120 min | 实现 v3（租约 + 乐观锁 + 审计）：LeaseManager + 乐观锁版本号 + ApprovalAuditService | 完整的 v3 代码 + 集成测试 | v3 是最终交付版本，需要覆盖"重复执行"和"双审批"两个核心痛点 |
| **阶段 4** | 60 min | 故障注入测试：服务重启 + 租约过期 + 双审批 | 测试输出（截图 + 日志） | 验证"服务重启不丢审批"、"租约过期不重复执行"、"双审批只执行一次" |
| **阶段 5** | 30 min | 架构证据：依赖图 + 时序图 + commit | 四件套 | M3 门禁要求 |

**关键里程碑检查点**：
- 90 分钟：v2 持久化代码能跑通（审批状态写入 DB）
- 210 分钟：v3 租约代码能跑通（租约获取/释放/过期）
- 270 分钟：集成测试通过（服务重启 + 租约过期 + 双审批）
- 300 分钟：故障注入测试完成（截图 + 日志）

**如果卡住了怎么办**：
- 卡在租约语义理解（阶段 1）→ 先读 BullMQ 官方文档的"Worker stalled jobs"章节
- 卡在乐观锁实现（阶段 3）→ 回顾 Day 27 §5.4 知识点 3（乐观锁）
- 卡在测试验证（阶段 4）→ 先跑单元测试，再跑集成测试，最后跑故障注入

---

## 3. v1：内存审批（Day 17 原版，今天不改）

### 3.1 v1 能做什么

Day 17 实现的内存审批：
- Agent 调用敏感工具（例如 deleteServer）前，前端弹窗要求人工确认
- 用户点击"通过"或"拒绝"，前端发送 HTTP POST 到服务端
- 服务端用内存 Map 存储审批状态（`approvalState = new Map<approvalId, ApprovalRequest>()`）
- 审批通过后，服务端执行工具并返回结果

### 3.2 v1 代码骨架（Day 17 原版）

```typescript
// apps/api/src/approval/approval.service.ts（Day 17 版本）
@Injectable()
export class ApprovalService {
  private approvalState = new Map<string, ApprovalRequest>() // 内存存储

  async createApproval(input: { runId: string; toolName: string; toolArgs: any }): Promise<string> {
    const approvalId = `apv-${Date.now()}`
    this.approvalState.set(approvalId, {
      id: approvalId,
      runId: input.runId,
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      status: 'pending',
    })
    // 发送 WebSocket 事件到前端
    this.eventEmitter.emit('approval.created', { approvalId })
    return approvalId
  }

  async approve(approvalId: string, userId: string): Promise<void> {
    const approval = this.approvalState.get(approvalId)
    if (!approval) throw new NotFoundException('Approval not found')
    if (approval.status !== 'pending') throw new ConflictException('Already decided')

    approval.status = 'approved'
    // 直接执行工具（同步）
    await this.toolRegistry.execute(approval.toolName, approval.toolArgs)
    approval.status = 'executed'
  }
}
```

### 3.3 v1 的 4 个致命问题

**问题 1：服务重启后审批丢失**
`approvalState` 是内存 Map，服务重启后清空。如果有 300 个审批停在 pending 状态，重启后全部丢失。

**问题 2：工具重复执行（无租约）**
审批通过后，工具在 `approve` 方法里同步执行（`await this.toolRegistry.execute(...)`）。如果工具执行耗时 10 分钟，期间服务重启，重启后又执行一次，工具重复执行 2 次。

**问题 3：双审批人同时点击"通过"（无乐观锁）**
两个审批人同时点击"通过"，两个 HTTP 请求同时到达 `approve` 方法，都读到 `status: 'pending'`（因为内存读取无锁），都执行工具，工具重复执行 2 次。

**问题 4：无审计日志**
只记录最终状态（pending → approved → executed），不记录"谁在什么时候点了什么按钮"。运营无法追溯敏感操作的决策链路。

---
## 4. v2：持久化 + pause/resume（解决问题 1）

### 4.1 v2 新增的能力

v2 在 v1 基础上新增：
- **持久化**：审批状态存入 DB（approval_requests 表），服务重启后不丢失
- **pause/resume**：审批通过后，工具执行放入队列（异步），而不是同步执行
- **恢复扫描**：服务启动时，扫描"审批通过但未执行"的记录（status='approved' 且 lease_owner IS NULL），重新加入队列

### 4.2 v2 架构变化

```
v1：前端 → HTTP POST /approvals/:id/approve → ApprovalService（内存 Map）→ 同步执行工具 → 返回
v2：前端 → HTTP POST /approvals/:id/approve → ApprovalService → 写 DB → 加入队列 → 返回
                                                                        ↓
                                              队列 worker → 执行工具 → 更新 DB
                                                 ↑
                                      服务重启时 RecoveryScanner 扫描 DB → 重新加入队列
```

**关键变化**：工具执行从"同步阻塞"改为"异步队列"，审批状态从"内存 Map"改为"DB 持久化"。

### 4.3 v2 核心代码（按第 5.3 节的代码边写边问）

**边写边问自己**：
1. 为什么审批状态要用 Enum 而不是魔法字符串？
2. 为什么 ApprovalRepository 要单独提取而不是在 Service 里直接写 Prisma？
3. 为什么审批通过后要先写 DB 再加入队列，而不是先加入队列再写 DB？
4. 为什么 RecoveryScanner 要在服务启动时执行，而不是定时任务？
5. 为什么队列 processor 要获取租约，而不是直接执行工具？

#### 4.3.1 审批状态枚举（state/approval-state.ts）

```typescript
// apps/api/src/approval/state/approval-state.ts
export enum ApprovalStatus {
  PENDING = 'pending',     // 等待审批
  APPROVED = 'approved',   // 已批准（未执行）
  REJECTED = 'rejected',   // 已拒绝
  EXECUTED = 'executed',   // 已执行
}

export interface ApprovalRequest {
  id: string
  runId: string
  toolName: string
  toolArgs: any
  status: ApprovalStatus
  version: number          // 乐观锁版本号（v2 先留空，v3 再用）
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}
```

**为什么 status 用 Enum？**
字符串 `'pending'` 拼写错误（例如 `'pendding'`）会导致运行时 Bug，Enum 在编译期就能检查拼写错误。

#### 4.3.2 持久化仓储（state/approval-repository.ts）

```typescript
// apps/api/src/approval/state/approval-repository.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'
import { ApprovalStatus, ApprovalRequest } from './approval-state'

@Injectable()
export class ApprovalRepository {
  constructor(private prisma: PrismaService) {}

  async create(input: {
    runId: string
    toolName: string
    toolArgs: any
  }): Promise<ApprovalRequest> {
    const approval = await this.prisma.approvalRequest.create({
      data: {
        runId: input.runId,
        toolName: input.toolName,
        toolArgs: input.toolArgs,
        status: ApprovalStatus.PENDING,
        version: 0,
      },
    })
    return this.toEntity(approval)
  }

  async findById(id: string): Promise<ApprovalRequest | null> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id },
    })
    return approval ? this.toEntity(approval) : null
  }

  async updateStatus(
    id: string,
    status: ApprovalStatus,
  ): Promise<void> {
    await this.prisma.approvalRequest.update({
      where: { id },
      data: { status },
    })
  }

  // v2 暂不实现乐观锁，v3 再加
  private toEntity(row: any): ApprovalRequest {
    return {
      id: row.id,
      runId: row.runId,
      toolName: row.toolName,
      toolArgs: row.toolArgs,
      status: row.status as ApprovalStatus,
      version: row.version,
      leaseOwner: row.leaseOwner,
      leaseExpiresAt: row.leaseExpiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
}
```

**为什么单独提取 Repository？**
Service 层只关心业务逻辑（"审批通过后加入队列"），Repository 层只关心持久化细节（"SQL 怎么写"）。分层后可以 Mock Repository 测试 Service。

#### 4.3.3 改造 ApprovalService（approval.service.ts）

```typescript
// apps/api/src/approval/approval.service.ts（v2 版本）
import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { ApprovalRepository } from './state/approval-repository'
import { ApprovalStatus } from './state/approval-state'

@Injectable()
export class ApprovalService {
  constructor(
    private approvalRepository: ApprovalRepository,
    @InjectQueue('approval') private approvalQueue: Queue,
  ) {}

  async createApproval(input: {
    runId: string
    toolName: string
    toolArgs: any
  }): Promise<string> {
    // 写入 DB（持久化）
    const approval = await this.approvalRepository.create(input)
    // 发送 WebSocket 事件到前端（这里省略 WebSocket 代码）
    return approval.id
  }

  async approve(approvalId: string, userId: string): Promise<void> {
    const approval = await this.approvalRepository.findById(approvalId)
    if (!approval) throw new NotFoundException('Approval not found')
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new ConflictException('Already decided')
    }

    // 更新状态为 approved（v2 暂不加乐观锁）
    await this.approvalRepository.updateStatus(approvalId, ApprovalStatus.APPROVED)

    // 加入队列（异步执行工具）
    await this.approvalQueue.add('execute-tool', {
      approvalId,
      toolName: approval.toolName,
      toolArgs: approval.toolArgs,
    })
  }

  async reject(approvalId: string, userId: string, reason: string): Promise<void> {
    const approval = await this.approvalRepository.findById(approvalId)
    if (!approval) throw new NotFoundException('Approval not found')
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new ConflictException('Already decided')
    }

    await this.approvalRepository.updateStatus(approvalId, ApprovalStatus.REJECTED)
  }
}
```

**为什么审批通过后要先写 DB 再加入队列？**
如果先加入队列，队列立即开始执行，但 DB 还没更新（status 还是 'pending'），服务重启后 RecoveryScanner 会再次加入队列，导致重复执行。正确顺序：**先写 DB（持久化决策）→ 再加入队列（触发执行）**。

#### 4.3.4 队列 processor（queue/approval-queue.processor.ts）

```typescript
// apps/api/src/queue/approval-queue.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Injectable } from '@nestjs/common'
import { ToolRegistry } from '../tool/tool-registry'
import { ApprovalRepository } from '../approval/state/approval-repository'
import { ApprovalStatus } from '../approval/state/approval-state'

@Processor('approval')
@Injectable()
export class ApprovalQueueProcessor extends WorkerHost {
  constructor(
    private toolRegistry: ToolRegistry,
    private approvalRepository: ApprovalRepository,
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    const { approvalId, toolName, toolArgs } = job.data

    // v2：直接执行工具（v3 再加租约）
    try {
      await this.toolRegistry.execute(toolName, toolArgs)
      // 更新状态为 executed
      await this.approvalRepository.updateStatus(approvalId, ApprovalStatus.EXECUTED)
    } catch (error) {
      // 执行失败时不更新状态（让队列重试）
      throw error
    }
  }
}
```

**为什么不在这里获取租约？**
v2 只解决"持久化 + pause/resume"问题，租约是 v3 的事。v2 的 processor 直接执行工具，v3 再加租约获取/释放逻辑。

#### 4.3.5 恢复扫描器（recovery/recovery-scanner.ts）

```typescript
// apps/api/src/approval/recovery/recovery-scanner.ts
import { Injectable, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { PrismaService } from '../../persistence/prisma.service'
import { ApprovalStatus } from '../state/approval-state'

@Injectable()
export class RecoveryScanner implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('approval') private approvalQueue: Queue,
  ) {}

  async onModuleInit() {
    // 服务启动时执行一次恢复扫描
    await this.recoverPendingApprovals()
  }

  private async recoverPendingApprovals(): Promise<void> {
    // 查找"已批准但未执行"的审批
    const approvals = await this.prisma.approvalRequest.findMany({
      where: {
        status: ApprovalStatus.APPROVED,
        leaseOwner: null, // 没有 worker 持有租约（说明未执行）
      },
    })

    console.log(`[RecoveryScanner] Found ${approvals.length} pending approvals to recover`)

    // 重新加入队列
    for (const approval of approvals) {
      await this.approvalQueue.add('execute-tool', {
        approvalId: approval.id,
        toolName: approval.toolName,
        toolArgs: approval.toolArgs,
      })
    }
  }
}
```

**为什么 RecoveryScanner 要在服务启动时执行，而不是定时任务？**
定时任务会周期性扫描（例如每 1 分钟一次），增加 DB 负载。服务启动时执行一次就够了，因为"审批通过但未执行"的记录只会在"服务崩溃导致队列丢失"时产生。

### 4.4 v2 测试（单元测试 + 集成测试）

#### 4.4.1 单元测试（approval.service.spec.ts）

```typescript
// apps/api/src/approval/approval.service.spec.ts
import { Test } from '@nestjs/testing'
import { ApprovalService } from './approval.service'
import { ApprovalRepository } from './state/approval-repository'
import { Queue } from 'bullmq'
import { ApprovalStatus } from './state/approval-state'

describe('ApprovalService (v2)', () => {
  let service: ApprovalService
  let repository: jest.Mocked<ApprovalRepository>
  let queue: jest.Mocked<Queue>

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ApprovalService,
        {
          provide: ApprovalRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            updateStatus: jest.fn(),
          },
        },
        {
          provide: 'BullQueue_approval',
          useValue: {
            add: jest.fn(),
          },
        },
      ],
    }).compile()

    service = module.get(ApprovalService)
    repository = module.get(ApprovalRepository) as any
    queue = module.get('BullQueue_approval') as any
  })

  it('审批通过后应该加入队列', async () => {
    repository.findById.mockResolvedValue({
      id: 'apv-001',
      status: ApprovalStatus.PENDING,
      toolName: 'deleteServer',
      toolArgs: { serverId: 'srv-042' },
    } as any)

    await service.approve('apv-001', 'user-001')

    expect(repository.updateStatus).toHaveBeenCalledWith('apv-001', ApprovalStatus.APPROVED)
    expect(queue.add).toHaveBeenCalledWith('execute-tool', {
      approvalId: 'apv-001',
      toolName: 'deleteServer',
      toolArgs: { serverId: 'srv-042' },
    })
  })

  it('重复审批应该抛出 ConflictException', async () => {
    repository.findById.mockResolvedValue({
      id: 'apv-001',
      status: ApprovalStatus.APPROVED, // 已经审批过
    } as any)

    await expect(service.approve('apv-001', 'user-001')).rejects.toThrow('Already decided')
  })
})
```

#### 4.4.2 集成测试（服务重启恢复）

```typescript
// apps/api/test/approval-recovery.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/persistence/prisma.service'
import { ApprovalStatus } from '../src/approval/state/approval-state'

describe('Approval Recovery (E2E)', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  it('服务重启后应该恢复"已批准但未执行"的审批', async () => {
    // 1. 创建一个"已批准但未执行"的审批（模拟服务崩溃前的状态）
    await prisma.approvalRequest.create({
      data: {
        id: 'apv-recovery-001',
        runId: 'run-001',
        toolName: 'deleteServer',
        toolArgs: { serverId: 'srv-042' },
        status: ApprovalStatus.APPROVED,
        version: 0,
      },
    })

    // 2. 重启服务（模拟）
    await app.close()
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    await app.init()

    // 3. 等待 RecoveryScanner 执行（onModuleInit 会自动触发）
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // 4. 验证审批已恢复并执行（status 变为 executed）
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: 'apv-recovery-001' },
    })
    expect(approval.status).toBe(ApprovalStatus.EXECUTED)
  })
})
```

### 4.5 v2 还剩下的 2 个问题

**问题 2：工具重复执行（无租约）**
如果工具执行耗时 10 分钟，期间服务重启，RecoveryScanner 会再次加入队列，导致工具重复执行 2 次。

**问题 3：双审批人同时点击"通过"（无乐观锁）**
v2 的 `updateStatus` 方法没有 WHERE version=? 条件，两个审批人同时点击"通过"，两个 UPDATE 都会成功，导致工具重复执行 2 次。

v3 用"租约 + 乐观锁"解决这两个问题。

---
## 5. v3：租约 + 乐观锁 + 审计（解决问题 2/3/4）

### 5.1 v3 新增的能力

v3 在 v2 基础上新增：
- **租约（lease）**：worker 执行工具前先获取租约（lease_owner + lease_expires_at），租约过期后其他 worker 才能拿到执行权
- **乐观锁**：审批决策（approve/reject）用 version 字段防止并发冲突（WHERE version=?）
- **完整审计**：每个决策事件（created/approved/rejected/executed）都写入审计日志表

### 5.2 v3 架构变化

```
v2：审批通过 → 更新 DB → 加入队列 → worker 直接执行工具
v3：审批通过 → 乐观锁更新 DB → 加入队列 → worker 获取租约 → 执行工具 → 释放租约
                     ↓
            每个决策事件写审计日志
```

**关键变化**：工具执行前增加"租约获取"环节，审批决策增加"乐观锁版本号检查"。

### 5.3 v3 完整代码（生产级实现）

#### 5.3.1 租约管理器（lease/lease-manager.ts）

```typescript
// apps/api/src/approval/lease/lease-manager.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'

export interface LeaseConfig {
  durationMs: number // 租约时长（默认 10 分钟）
}

@Injectable()
export class LeaseManager {
  private readonly workerId: string

  constructor(
    private prisma: PrismaService,
    private config: LeaseConfig = { durationMs: 10 * 60 * 1000 }, // 默认 10 分钟
  ) {
    this.workerId = `worker-${process.pid}` // 用进程 ID 作为 worker 标识
  }

  /**
   * 获取租约
   * @returns true 表示成功获取租约，false 表示租约已被其他 worker 持有
   */
  async acquireLease(approvalId: string): Promise<boolean> {
    const leaseExpiresAt = new Date(Date.now() + this.config.durationMs)

    try {
      // 乐观更新：只有当 lease_owner IS NULL 或租约已过期时才能获取
      const result = await this.prisma.approvalRequest.updateMany({
        where: {
          id: approvalId,
          OR: [
            { leaseOwner: null }, // 无人持有
            { leaseExpiresAt: { lt: new Date() } }, // 租约已过期
          ],
        },
        data: {
          leaseOwner: this.workerId,
          leaseExpiresAt,
        },
      })

      return result.count > 0 // count > 0 表示更新成功（获取到租约）
    } catch (error) {
      console.error('[LeaseManager] Failed to acquire lease:', error)
      return false
    }
  }

  /**
   * 释放租约
   */
  async releaseLease(approvalId: string): Promise<void> {
    await this.prisma.approvalRequest.updateMany({
      where: {
        id: approvalId,
        leaseOwner: this.workerId, // 只能释放自己持有的租约
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    })
  }

  /**
   * 续租（工具执行耗时超过租约时长时调用）
   */
  async renewLease(approvalId: string): Promise<boolean> {
    const leaseExpiresAt = new Date(Date.now() + this.config.durationMs)

    try {
      const result = await this.prisma.approvalRequest.updateMany({
        where: {
          id: approvalId,
          leaseOwner: this.workerId, // 只能续租自己持有的租约
        },
        data: {
          leaseExpiresAt,
        },
      })

      return result.count > 0
    } catch (error) {
      console.error('[LeaseManager] Failed to renew lease:', error)
      return false
    }
  }
}
```

**为什么用 updateMany 而不是 update？**
`update` 在 WHERE 条件不匹配时会抛出异常，`updateMany` 返回 `count: 0`（不抛异常）。租约获取失败是正常情况（其他 worker 持有），不应该抛异常。

**为什么租约过期后要自动回收（OR leaseExpiresAt < NOW()）？**
如果 worker 崩溃未释放租约，租约会永远被"死 worker"占用。通过"租约过期自动回收"，其他 worker 可以在租约过期后拿到执行权。

#### 5.3.2 租约过期检查器（lease/lease-expiry-checker.ts）

```typescript
// apps/api/src/approval/lease/lease-expiry-checker.ts
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../persistence/prisma.service'
import { ApprovalStatus } from '../state/approval-state'

@Injectable()
export class LeaseExpiryChecker {
  constructor(private prisma: PrismaService) {}

  /**
   * 每 1 分钟扫描一次过期的租约，强制回收
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkExpiredLeases(): Promise<void> {
    const result = await this.prisma.approvalRequest.updateMany({
      where: {
        status: ApprovalStatus.APPROVED, // 只回收"已批准但未执行"的租约
        leaseOwner: { not: null }, // 有 worker 持有
        leaseExpiresAt: { lt: new Date() }, // 租约已过期
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    })

    if (result.count > 0) {
      console.log(`[LeaseExpiryChecker] Reclaimed ${result.count} expired leases`)
    }
  }
}
```

**为什么需要 LeaseExpiryChecker？**
如果 worker 在执行工具时崩溃，租约不会自动释放（因为 `releaseLease` 没执行）。LeaseExpiryChecker 定时扫描过期的租约，强制回收，让其他 worker 可以拿到执行权。

#### 5.3.3 乐观锁更新（state/approval-repository.ts 增量）

```typescript
// apps/api/src/approval/state/approval-repository.ts（v3 增量）
export class ApprovalRepository {
  // ... 省略 v2 代码 ...

  /**
   * 乐观锁更新状态
   * @returns true 表示更新成功，false 表示版本号冲突
   */
  async updateStatusWithVersion(
    id: string,
    currentVersion: number,
    newStatus: ApprovalStatus,
  ): Promise<boolean> {
    const result = await this.prisma.approvalRequest.updateMany({
      where: {
        id,
        version: currentVersion, // 乐观锁：只有当 version 匹配时才更新
      },
      data: {
        status: newStatus,
        version: { increment: 1 }, // version + 1
      },
    })

    return result.count > 0 // count > 0 表示更新成功
  }
}
```

**为什么返回 boolean 而不是抛异常？**
版本号冲突是正常情况（两个审批人同时点击"通过"），应该返回 false 让调用方处理（例如告诉第二个审批人"已被其他人审批"），而不是抛 500 异常。

#### 5.3.4 审计日志服务（audit/approval-audit.service.ts）

```typescript
// apps/api/src/approval/audit/approval-audit.service.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'

export enum AuditEvent {
  CREATED = 'created',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXECUTED = 'executed',
}

@Injectable()
export class ApprovalAuditService {
  constructor(private prisma: PrismaService) {}

  async log(input: {
    approvalId: string
    event: AuditEvent
    userId?: string // nullable（created 事件无 userId）
    metadata?: any
  }): Promise<void> {
    await this.prisma.approvalAuditLog.create({
      data: {
        approvalId: input.approvalId,
        event: input.event,
        userId: input.userId ?? null,
        metadata: input.metadata ?? {},
      },
    })
  }

  /**
   * 查询某个审批的完整决策链路
   */
  async getAuditTrail(approvalId: string): Promise<any[]> {
    return this.prisma.approvalAuditLog.findMany({
      where: { approvalId },
      orderBy: { occurredAt: 'asc' },
    })
  }
}
```

#### 5.3.5 改造 ApprovalService（v3 最终版）

```typescript
// apps/api/src/approval/approval.service.ts（v3 最终版）
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { ApprovalRepository } from './state/approval-repository'
import { ApprovalStatus } from './state/approval-state'
import { ApprovalAuditService, AuditEvent } from './audit/approval-audit.service'

@Injectable()
export class ApprovalService {
  constructor(
    private approvalRepository: ApprovalRepository,
    private approvalAudit: ApprovalAuditService,
    @InjectQueue('approval') private approvalQueue: Queue,
  ) {}

  async createApproval(input: {
    runId: string
    toolName: string
    toolArgs: any
  }): Promise<string> {
    const approval = await this.approvalRepository.create(input)

    // 审计：记录创建事件
    await this.approvalAudit.log({
      approvalId: approval.id,
      event: AuditEvent.CREATED,
      metadata: { runId: input.runId, toolName: input.toolName },
    })

    return approval.id
  }

  async approve(approvalId: string, userId: string): Promise<void> {
    const approval = await this.approvalRepository.findById(approvalId)
    if (!approval) throw new NotFoundException('Approval not found')
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new ConflictException('Already decided')
    }

    // 乐观锁更新状态
    const success = await this.approvalRepository.updateStatusWithVersion(
      approvalId,
      approval.version, // 当前版本号
      ApprovalStatus.APPROVED,
    )

    if (!success) {
      // 版本号冲突（其他人先审批了）
      throw new ConflictException('Approval was modified by another user')
    }

    // 审计：记录审批通过事件
    await this.approvalAudit.log({
      approvalId,
      event: AuditEvent.APPROVED,
      userId,
    })

    // 加入队列（异步执行工具）
    await this.approvalQueue.add('execute-tool', {
      approvalId,
      toolName: approval.toolName,
      toolArgs: approval.toolArgs,
    })
  }

  async reject(approvalId: string, userId: string, reason: string): Promise<void> {
    const approval = await this.approvalRepository.findById(approvalId)
    if (!approval) throw new NotFoundException('Approval not found')
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new ConflictException('Already decided')
    }

    // 乐观锁更新状态
    const success = await this.approvalRepository.updateStatusWithVersion(
      approvalId,
      approval.version,
      ApprovalStatus.REJECTED,
    )

    if (!success) {
      throw new ConflictException('Approval was modified by another user')
    }

    // 审计：记录拒绝事件
    await this.approvalAudit.log({
      approvalId,
      event: AuditEvent.REJECTED,
      userId,
      metadata: { reason },
    })
  }
}
```

#### 5.3.6 改造队列 processor（v3 最终版）

```typescript
// apps/api/src/queue/approval-queue.processor.ts（v3 最终版）
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Injectable } from '@nestjs/common'
import { ToolRegistry } from '../tool/tool-registry'
import { ApprovalRepository } from '../approval/state/approval-repository'
import { ApprovalStatus } from '../approval/state/approval-state'
import { LeaseManager } from '../approval/lease/lease-manager'
import { ApprovalAuditService, AuditEvent } from '../approval/audit/approval-audit.service'

@Processor('approval')
@Injectable()
export class ApprovalQueueProcessor extends WorkerHost {
  constructor(
    private toolRegistry: ToolRegistry,
    private approvalRepository: ApprovalRepository,
    private leaseManager: LeaseManager,
    private approvalAudit: ApprovalAuditService,
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    const { approvalId, toolName, toolArgs } = job.data

    // 1. 获取租约
    const leaseAcquired = await this.leaseManager.acquireLease(approvalId)
    if (!leaseAcquired) {
      console.log(`[ApprovalProcessor] Failed to acquire lease for ${approvalId}`)
      throw new Error('Lease already held by another worker') // 让 BullMQ 重试
    }

    try {
      // 2. 执行工具
      await this.toolRegistry.execute(toolName, toolArgs)

      // 3. 更新状态为 executed
      await this.approvalRepository.updateStatus(approvalId, ApprovalStatus.EXECUTED)

      // 4. 审计：记录执行事件
      await this.approvalAudit.log({
        approvalId,
        event: AuditEvent.EXECUTED,
      })
    } finally {
      // 5. 释放租约（无论成功或失败）
      await this.leaseManager.releaseLease(approvalId)
    }
  }
}
```

**为什么租约获取失败时要 throw Error 而不是直接 return？**
throw Error 让 BullMQ 重试（例如 30 秒后再试），而 return 表示"job 处理成功"（不会重试）。租约获取失败是暂时的（租约过期后会回收），应该重试而不是放弃。

**为什么释放租约要放在 finally 里？**
即使工具执行失败（throw error），也要释放租约，否则租约会永远被持有（其他 worker 无法拿到执行权）。

### 5.4 v3 核心知识点（≥ 6 个，每个 5 要素）

#### 知识点 1：租约（Lease）语义

**是什么**：租约是"执行权的时间限制锁"。worker 执行工具前先获取租约（写入 lease_owner + lease_expires_at），租约过期后其他 worker 才能拿到执行权。

**解决什么问题**：防止工具重复执行。如果工具执行耗时 10 分钟，期间服务重启，没有租约的情况下 RecoveryScanner 会再次加入队列，导致工具重复执行 2 次。租约保证"同一时刻只有一个 worker 持有执行权"。

**怎么用**：
```typescript
const leaseAcquired = await leaseManager.acquireLease(approvalId)
if (!leaseAcquired) throw new Error('Lease already held')
try {
  await toolRegistry.execute(toolName, toolArgs)
} finally {
  await leaseManager.releaseLease(approvalId)
}
```

**生产陷阱**：租约时长设置太短（例如 1 分钟），工具执行耗时 5 分钟，租约过期后其他 worker 拿到执行权，导致重复执行。**租约时长应该是工具执行最大耗时 × 1.5**。

**验证方法**：故障注入测试——工具执行到一半时 kill worker 进程，观察租约过期后另一个 worker 是否能拿到执行权（不是立即拿到，而是等租约过期）。

#### 知识点 2：乐观锁（Optimistic Locking）

**是什么**：乐观锁用 version 字段防止并发冲突。每次更新时检查 WHERE version=?，只有 version 匹配时才更新（并 +1）。

**解决什么问题**：防止双审批（两个审批人同时点击"通过"）。如果不加乐观锁，两个 UPDATE 都会成功，导致工具重复执行 2 次。

**怎么用**：
```typescript
const result = await prisma.approvalRequest.updateMany({
  where: { id: approvalId, version: currentVersion },
  data: { status: 'approved', version: { increment: 1 } },
})
if (result.count === 0) throw new ConflictException('Version conflict')
```

**生产陷阱**：用 `update` 而不是 `updateMany`。`update` 在 WHERE 条件不匹配时会抛异常（"Record not found"），无法区分"记录不存在"和"版本号冲突"。`updateMany` 返回 `count: 0`（不抛异常），可以区分。

**验证方法**：并发测试——两个 HTTP 请求同时 POST /approvals/:id/approve，观察只有一个返回 200，另一个返回 409（ConflictException）。

#### 知识点 3：审计日志（Audit Log）

**是什么**：审计日志记录每个决策事件（created/approved/rejected/executed）的"谁、什么时候、做了什么"。

**解决什么问题**：合规审计。运营需要追溯敏感操作（例如删除服务器）的决策链路："谁在 2026-07-15 14:32 批准删除 srv-042？"

**怎么用**：
```typescript
await approvalAudit.log({
  approvalId: 'apv-001',
  event: AuditEvent.APPROVED,
  userId: 'user-001',
})
```

**生产陷阱**：审计日志和审批表用同一张表（approval_requests 加一个 approved_by 字段）。这样无法追溯"谁先审批、谁后审批"（只能看到最终的 approved_by）。审计日志应该是独立表（approval_audit_logs），记录完整事件流。

**验证方法**：查询审计日志——`SELECT * FROM approval_audit_logs WHERE approvalId='apv-001' ORDER BY occurredAt`，验证事件顺序（created → approved → executed）。

#### 知识点 4：Durable Workflow 语义

**是什么**：Durable Workflow 是"可持久化、可暂停、可恢复的工作流"。工作流状态持久化到 DB，服务重启后从 DB 恢复，继续执行。

**解决什么问题**：服务重启丢失审批状态。如果审批状态只在内存里，服务重启后所有"停在 pending 的审批"都会丢失。

**怎么用**：
```typescript
// 服务启动时
const approvals = await prisma.approvalRequest.findMany({
  where: { status: 'approved', leaseOwner: null },
})
for (const approval of approvals) {
  await queue.add('execute-tool', { approvalId: approval.id })
}
```

**生产陷阱**：恢复时重复加入队列。如果 RecoveryScanner 每次启动都扫描"所有 approved 的审批"（不检查 lease_owner），会导致"已经在队列里的审批"重复加入。正确做法是 WHERE lease_owner IS NULL（说明没有 worker 持有，需要恢复）。

**验证方法**：服务重启测试——创建 approved 审批 → kill 服务 → 重启服务 → 观察审批是否自动恢复并执行。

#### 知识点 5：BullMQ Job Idempotency

**是什么**：BullMQ 的 jobId 幂等机制。相同 jobId 的 job 只会被处理一次（即使多次 add）。

**解决什么问题**：防止队列重复。如果 RecoveryScanner 多次启动（例如服务快速重启 3 次），相同的审批会被加入队列 3 次，导致工具重复执行 3 次。

**怎么用**：
```typescript
await queue.add('execute-tool', { approvalId: 'apv-001' }, {
  jobId: `approval-${approvalId}`, // 相同 jobId 只处理一次
})
```

**生产陷阱**：jobId 设置为随机 UUID。这样每次 add 都会创建新 job（即使 data 相同），导致重复执行。jobId 应该是"业务唯一键"（例如 `approval-${approvalId}`）。

**验证方法**：重复 add 测试——连续 3 次 `queue.add(..., { jobId: 'test-job' })`，观察队列里只有 1 个 job（不是 3 个）。

#### 知识点 6：Lease Expiry vs Heartbeat

**是什么**：Lease Expiry 是"租约过期后强制回收"，Heartbeat 是"worker 定期续租证明存活"。

**解决什么问题**：区分"worker 崩溃"和"工具执行耗时长"。如果工具正常执行 10 分钟，但租约只有 5 分钟，租约过期后会被强制回收（误判为 worker 崩溃）。Heartbeat 让 worker 定期续租（例如每 2 分钟续租一次），证明"我还活着，别回收我的租约"。

**怎么用**：
```typescript
// worker 每 2 分钟续租一次
setInterval(async () => {
  await leaseManager.renewLease(approvalId)
}, 2 * 60 * 1000)
```

**生产陷阱**：只用 Lease Expiry，不用 Heartbeat。如果工具执行耗时 30 分钟，租约设为 30 分钟，worker 崩溃后需要等 30 分钟才能回收租约（太慢）。正确做法是"租约 5 分钟 + Heartbeat 每 2 分钟续租"：正常执行时不断续租（租约不过期），崩溃后 5 分钟内回收（不是 30 分钟）。

**验证方法**：长耗时工具测试——工具执行 30 分钟，租约 5 分钟，观察 worker 是否每 2 分钟续租一次（租约不过期）。

---
## 6. 深挖前端底子（§6.5 必需章节）

### 6.1 今天为什么要深挖"前端审批弹窗的防重复提交"

Day 33 的核心是"服务端持久化 + 租约 + 乐观锁"，但如果前端审批弹窗没有"防重复提交"机制，用户可以快速点击"通过"按钮 3 次，发送 3 个 HTTP 请求，即使服务端有乐观锁，第一个请求成功后（version 变为 1），后两个请求会因为 version 冲突失败，但仍然浪费了 2 次网络请求和 2 次 DB 查询。正确做法是**前端在第一次点击后立即禁用按钮**（loading 状态），直到服务端响应。

今天深挖的不是"Vue 怎么写"（Day 01-05 已经掌握），而是"为什么前端防重复提交不能完全依赖 disabled 属性"（用户可以通过浏览器开发者工具移除 disabled）、"为什么要用请求 ID 去重而不是简单的防抖"（防抖会延迟提交，请求 ID 去重不延迟）。

### 6.2 前端防重复提交的 3 层防御

#### 6.2.1 第一层：按钮 loading 状态（UI 层）

```vue
<!-- frontend/src/agent/approval-dialog.vue -->
<template>
  <div class="approval-dialog">
    <h3>Agent 请求删除服务器</h3>
    <p>工具：{{ toolName }}</p>
    <p>参数：{{ JSON.stringify(toolArgs) }}</p>
    <div class="actions">
      <button
        @click="handleApprove"
        :disabled="loading"
        class="btn-approve"
      >
        {{ loading ? '处理中...' : '通过' }}
      </button>
      <button
        @click="handleReject"
        :disabled="loading"
        class="btn-reject"
      >
        拒绝
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  approvalId: string
  toolName: string
  toolArgs: any
}>()

const emit = defineEmits<{
  approved: []
  rejected: []
}>()

const loading = ref(false)

async function handleApprove() {
  if (loading.value) return // 防止重复点击

  loading.value = true
  try {
    await fetch(`/api/approvals/${props.approvalId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-001' }), // 实际应从认证上下文获取
    })
    emit('approved')
  } catch (error) {
    console.error('审批失败:', error)
    alert('审批失败，请重试')
  } finally {
    loading.value = false
  }
}

async function handleReject() {
  if (loading.value) return

  const reason = prompt('请输入拒绝原因')
  if (!reason) return

  loading.value = true
  try {
    await fetch(`/api/approvals/${props.approvalId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-001', reason }),
    })
    emit('rejected')
  } catch (error) {
    console.error('拒绝失败:', error)
    alert('拒绝失败，请重试')
  } finally {
    loading.value = false
  }
}
</script>
```

**为什么 if (loading.value) return 还要加？**
`:disabled="loading"` 只是禁用按钮（用户无法点击），但用户可以通过浏览器开发者工具移除 `disabled` 属性，然后点击按钮。`if (loading.value) return` 是 JavaScript 层的防御，即使 `disabled` 被移除，也无法重复提交。

#### 6.2.2 第二层：请求 ID 去重（HTTP 层）

```typescript
// frontend/src/agent/utils/request-dedup.ts
const pendingRequests = new Map<string, Promise<any>>()

export async function dedupRequest<T>(
  key: string,
  requestFn: () => Promise<T>,
): Promise<T> {
  // 如果相同 key 的请求正在进行中，直接返回该 Promise
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key)!
  }

  // 发起新请求
  const promise = requestFn()
  pendingRequests.set(key, promise)

  try {
    const result = await promise
    return result
  } finally {
    // 请求完成后移除 key（无论成功或失败）
    pendingRequests.delete(key)
  }
}
```

**使用示例**：

```typescript
async function handleApprove() {
  loading.value = true
  try {
    await dedupRequest(`approve-${props.approvalId}`, async () => {
      const res = await fetch(`/api/approvals/${props.approvalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-001' }),
      })
      if (!res.ok) throw new Error('审批失败')
      return res.json()
    })
    emit('approved')
  } finally {
    loading.value = false
  }
}
```

**为什么不用防抖（debounce）？**
防抖会延迟提交（例如 300ms 内没有新点击才提交），用户感知延迟。请求 ID 去重是"相同 key 的请求只发一次，后续点击复用第一次的 Promise"，用户点击后立即提交（无延迟）。

#### 6.2.3 第三层：服务端乐观锁（DB 层）

即使前端两层防御都被绕过（用户通过 curl 直接发送 2 个 HTTP 请求），服务端的乐观锁也能保证只有第一个请求成功：

```sql
UPDATE approval_requests
SET status = 'approved', version = version + 1
WHERE id = 'apv-001' AND version = 0;  -- 第一个请求成功（version 变为 1）

UPDATE approval_requests
SET status = 'approved', version = version + 1
WHERE id = 'apv-001' AND version = 0;  -- 第二个请求失败（version 已经是 1，WHERE 条件不匹配）
```

### 6.3 为什么不能只依赖服务端乐观锁

**误区**："反正服务端有乐观锁，前端不做防重复提交也没事"。

**错误原因**：
1. 浪费网络请求（用户点击 3 次 = 3 个 HTTP 请求，但只有第一个有效）
2. 浪费 DB 查询（每个请求都要查一次 DB，判断 version 是否匹配）
3. 用户体验差（第二个/第三个请求返回 409 错误，前端需要处理错误提示）

**正确分工**：
- **前端**：UI 层防御（loading 状态）+ HTTP 层防御（请求 ID 去重）→ 减少 99% 的重复请求
- **服务端**：DB 层防御（乐观锁）→ 兜底剩余 1% 的极端情况（例如用户通过 curl 绕过前端）

### 6.4 HTML 知识点：disabled 属性的安全边界

**HTML 规范**：`<button disabled>` 禁用按钮，用户无法点击，也无法通过 Tab 键聚焦。

**安全陷阱**：`disabled` 属性可以通过浏览器开发者工具移除。步骤：
1. 打开浏览器开发者工具（F12）
2. 找到按钮元素（`<button disabled>通过</button>`）
3. 右键 → Edit as HTML → 删除 `disabled` 属性
4. 保存 → 按钮恢复可点击状态

**为什么 HTML 允许移除 disabled？**
HTML 是"展示标记语言"，不是"安全机制"。浏览器开发者工具允许修改任何 HTML/CSS/JavaScript（因为这是"用户的浏览器"，用户有完全控制权）。**所有前端安全机制都可以被绕过**，真正的安全防御必须在服务端（例如乐观锁、权限校验、签名验证）。

**结论**：`disabled` 属性是"用户体验优化"（防止误点击），不是"安全机制"（不能防止恶意用户）。

### 6.5 CSS 知识点：loading 状态的视觉反馈

```css
.btn-approve {
  background: #22c55e;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-approve:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-approve:not(:disabled):hover {
  background: #16a34a;
}
```

**为什么 disabled 状态要降低透明度（opacity: 0.6）？**
视觉反馈告诉用户"按钮不可用"。如果 disabled 状态和正常状态视觉一致，用户会反复点击（以为第一次点击没反应）。

**为什么 cursor 要改为 not-allowed？**
光标形状告诉用户"这个操作被禁止"。如果 cursor 还是 pointer（手型），用户会误以为可以点击。

---

## 7. 测试与验证（§7 必需章节）

### 7.1 单元测试（LeaseManager）

```typescript
// apps/api/src/approval/lease/lease-manager.spec.ts
import { Test } from '@nestjs/testing'
import { LeaseManager } from './lease-manager'
import { PrismaService } from '../../persistence/prisma.service'

describe('LeaseManager', () => {
  let leaseManager: LeaseManager
  let prisma: PrismaService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LeaseManager,
        {
          provide: PrismaService,
          useValue: {
            approvalRequest: {
              updateMany: jest.fn(),
            },
          },
        },
      ],
    }).compile()

    leaseManager = module.get(LeaseManager)
    prisma = module.get(PrismaService)
  })

  it('获取租约成功', async () => {
    jest.spyOn(prisma.approvalRequest, 'updateMany').mockResolvedValue({ count: 1 })

    const success = await leaseManager.acquireLease('apv-001')

    expect(success).toBe(true)
    expect(prisma.approvalRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'apv-001',
        OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: expect.any(Date) } }],
      },
      data: {
        leaseOwner: expect.stringContaining('worker-'),
        leaseExpiresAt: expect.any(Date),
      },
    })
  })

  it('租约已被其他 worker 持有时获取失败', async () => {
    jest.spyOn(prisma.approvalRequest, 'updateMany').mockResolvedValue({ count: 0 })

    const success = await leaseManager.acquireLease('apv-001')

    expect(success).toBe(false)
  })
})
```

### 7.2 集成测试（服务重启恢复 + 租约防重复）

```typescript
// apps/api/test/approval-durable.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/persistence/prisma.service'
import { ApprovalStatus } from '../src/approval/state/approval-state'

describe('Durable HITL (E2E)', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  it('服务重启后恢复"已批准但未执行"的审批', async () => {
    // 1. 创建 approved 审批（模拟服务崩溃前的状态）
    await prisma.approvalRequest.create({
      data: {
        id: 'apv-recovery-001',
        runId: 'run-001',
        toolName: 'deleteServer',
        toolArgs: { serverId: 'srv-042' },
        status: ApprovalStatus.APPROVED,
        version: 1,
      },
    })

    // 2. 重启服务
    await app.close()
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)

    // 3. 等待 RecoveryScanner 执行
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // 4. 验证审批已执行
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: 'apv-recovery-001' },
    })
    expect(approval.status).toBe(ApprovalStatus.EXECUTED)
  })

  it('租约防止重复执行', async () => {
    // 1. 创建 approved 审批
    await prisma.approvalRequest.create({
      data: {
        id: 'apv-lease-001',
        runId: 'run-002',
        toolName: 'deleteServer',
        toolArgs: { serverId: 'srv-043' },
        status: ApprovalStatus.APPROVED,
        version: 1,
      },
    })

    // 2. 模拟两个 worker 同时获取租约
    const leaseManager1 = app.get(LeaseManager)
    const leaseManager2 = app.get(LeaseManager)

    const [success1, success2] = await Promise.all([
      leaseManager1.acquireLease('apv-lease-001'),
      leaseManager2.acquireLease('apv-lease-001'),
    ])

    // 3. 验证只有一个 worker 成功获取租约
    expect(success1).toBe(true)
    expect(success2).toBe(false)
  })
})
```

### 7.3 反证实验 1：移除租约后工具重复执行

**假设**：如果移除租约机制（worker 直接执行工具，不获取租约），工具会重复执行 2 次。

**实验步骤**：
1. 注释掉 `ApprovalQueueProcessor` 里的 `acquireLease` 和 `releaseLease` 代码
2. 创建 approved 审批
3. 启动 2 个 worker 进程（模拟分布式部署）
4. 观察工具执行次数

**预期现象**：工具执行 2 次（两个 worker 都执行了）。

**实际现象**（移除租约后）：
```
[Worker 1] Executing deleteServer for srv-042
[Worker 2] Executing deleteServer for srv-042  ← 重复执行
```

**DB 日志**：
```sql
-- Worker 1 执行
DELETE FROM servers WHERE id = 'srv-042';  -- 成功
-- Worker 2 执行
DELETE FROM servers WHERE id = 'srv-042';  -- 失败（记录已删除），但浪费了 1 次 DB 查询
```

**恢复操作**：恢复租约代码，重新测试，验证只执行 1 次。

### 7.4 反证实验 2：移除乐观锁后双审批重复执行

**假设**：如果移除乐观锁（`updateStatus` 不检查 version），两个审批人同时点击"通过"，工具会重复执行 2 次。

**实验步骤**：
1. 修改 `ApprovalRepository.updateStatus` 方法，移除 WHERE version=? 条件
2. 两个浏览器窗口同时打开审批弹窗
3. 同时点击"通过"按钮
4. 观察工具执行次数

**预期现象**：工具执行 2 次（两个审批都成功）。

**实际现象**（移除乐观锁后）：
```
[Request 1] UPDATE approval_requests SET status='approved' WHERE id='apv-001'  -- 成功
[Request 2] UPDATE approval_requests SET status='approved' WHERE id='apv-001'  -- 也成功（因为没有 version 检查）
[Queue] 加入 2 个 job（jobId 不同）
[Worker] 执行工具 2 次
```

**恢复操作**：恢复乐观锁代码，重新测试，验证只有第一个审批成功。

### 7.5 四件套（依赖图 + 时序图 + 日志 + commit）

#### 7.5.1 依赖图

```
frontend/approval-dialog.vue
          ↓ (HTTP POST)
    approval.controller.ts
          ↓
    approval.service.ts ──────────┐
          ↓                       │
    approval-repository.ts    approval-audit.service.ts
          ↓                       ↓
      Prisma                  audit_logs
          ↓
    BullMQ Queue
          ↓
    approval-queue.processor.ts
          ↓
    lease-manager.ts
          ↓
    tool-registry.ts
```

#### 7.5.2 时序图（审批通过 → 工具执行全流程）

```
用户          前端              controller        service          repository       queue         processor      lease-manager    tool-registry
 │              │                    │                │                 │              │               │                │                │
 │─点击"通过"──→│                    │                │                 │              │               │                │                │
 │              │─POST /approve────→│                │                 │              │               │                │                │
 │              │                    │─approve()────→│                 │              │               │                │                │
 │              │                    │                │─findById()────→│              │               │                │                │
 │              │                    │                │←approval───────│              │               │                │                │
 │              │                    │                │─updateStatus()─→│              │               │                │                │
 │              │                    │                │  (WHERE version=0)            │               │                │                │
 │              │                    │                │←success────────│              │               │                │                │
 │              │                    │                │─audit.log()────────────────→ audit_logs      │                │                │
 │              │                    │                │─queue.add()──→│              │               │                │                │
 │              │                    │←200 OK─────────│                 │              │               │                │                │
 │              │←200 OK─────────────│                │                 │              │               │                │                │
 │              │                    │                │                 │              │─process()───→│                │                │
 │              │                    │                │                 │              │               │─acquireLease()→│                │
 │              │                    │                │                 │              │               │←success────────│                │
 │              │                    │                │                 │              │               │─execute()──────────────────────→│
 │              │                    │                │                 │              │               │←result───────────────────────────│
 │              │                    │                │                 │              │               │─releaseLease()→│                │
 │              │                    │                │                 │              │               │←done───────────│                │
```

#### 7.5.3 测试日志截图

```
[RecoveryScanner] Found 1 pending approvals to recover
[ApprovalQueueProcessor] Processing job: execute-tool { approvalId: 'apv-001' }
[LeaseManager] Acquired lease for apv-001, expires at 2026-08-15T14:42:15.000Z
[ToolRegistry] Executing tool: deleteServer { serverId: 'srv-042' }
[ToolRegistry] Tool execution completed in 3.2s
[LeaseManager] Released lease for apv-001
[ApprovalAuditService] Logged event: executed { approvalId: 'apv-001' }
```

#### 7.5.4 commit 信息

```bash
git add .
git commit -m "feat(approval): add durable HITL with lease and optimistic locking

- Add approval_requests and approval_audit_logs tables
- Implement LeaseManager for preventing duplicate execution
- Add optimistic locking (version field) to prevent concurrent approval
- Add RecoveryScanner to recover pending approvals on service restart
- Add ApprovalAuditService for compliance audit trail

Refs: Day33"
```

**为什么 commit 信息要写 5 行？**
- 第 1 行：简短总结（50 字符内）
- 第 2 行：空行
- 第 3-7 行：详细变更列表（每行以 `-` 开头）
- 第 8 行：引用 Day 编号（`Refs: Day33`）

---
## 8. 通关检查清单（v3 规范 11 项）

Day 33 交付前的自查：

1. **§0 位置声明**：已写明"阶段二第 3 天"、Day 17 前置依赖、Day 34-40 后续对齐
2. **§1.1 用户能看到什么**：已写完整时间轴（14:30:00 创建审批 → 14:32:15 审批通过 → 14:35:15 工具执行 → 14:36:00 服务重启 → 14:36:05 恢复）
3. **§1.4 目录结构 5 块**：已写骨架树 + 为什么分层 5 问 + diff 表格 + 依赖箭头 + 3 个灵魂拷问
4. **§1.5 脚手架检查**：已写 Day 17/27/29 依赖检查 + Prisma Schema + 迁移脚本
5. **三版演进**：v1 内存审批（Day 17）→ v2 持久化 + pause/resume → v3 租约 + 乐观锁 + 审计
6. **§5.3 完整代码**：LeaseManager、ApprovalRepository（乐观锁）、ApprovalAuditService、改造 Service/Processor，无省略号
7. **§5.4 ≥ 6 知识点**：租约语义、乐观锁、审计日志、Durable Workflow、BullMQ 幂等、Lease Expiry vs Heartbeat，每个 5 要素
8. **§6.5 前端底子补弱**：深挖"前端防重复提交 3 层防御" + disabled 安全边界 + loading 视觉反馈
9. **§7 测试 4 件套**：单元测试（LeaseManager）+ 集成测试（服务重启）+ 反证实验 1（移除租约）+ 反证实验 2（移除乐观锁）+ 依赖图 + 时序图 + 日志 + commit
10. **0 个 `> ✅/❌` blockquote**：全文无此格式
11. **commit 不含 git push**：commit 信息写 `Refs: Day33`，不执行 push

---

## 9. 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 33 交付的 Durable HITL 模块（持久化审批 + 租约 + 乐观锁 + 审计）是后续 14 个能力的基座：

1. **Day 34-40 LangGraph 状态机编排**：Human-in-the-loop 节点复用今天的租约机制（"状态机暂停 → 等待审批 → 恢复执行"）
2. **Day 41-50 RAG 深化**：敏感文档检索需要审批（"Agent 请求访问客户合同 → 审批通过 → 查询向量库"）
3. **Day 51-60 可观测性**：审计日志是合规审计的数据源（"查询某用户在 2026 年审批了多少次删除操作"）

### 9.2 今天留下的 3 个待优化点

1. **Heartbeat 续租**：v3 只实现了"租约过期自动回收"，没有实现"worker 定期续租"。如果工具执行耗时 30 分钟，租约设为 30 分钟，worker 崩溃后需要等 30 分钟才能回收（太慢）。Day 34 会补充 Heartbeat。

2. **审批超时机制**：v3 没有实现"审批创建 24 小时后自动过期"。如果审批人忘记处理，审批会永远停在 pending 状态。Day 35 会补充审批超时。

3. **审批权限校验**：v3 没有实现"只有运维主管可以审批删除操作"。任何用户都可以调用 `/approvals/:id/approve`（只要知道 approvalId）。Day 36 会补充权限校验。

### 9.3 下一站要解决的核心问题

**Day 34：LangGraph 状态机编排（Plan-Act-Reflect 循环 + Human-in-the-loop 节点）**

核心挑战：
- 如何用状态机表达"Plan → 如果 Plan 包含敏感操作 → 暂停等待审批 → 审批通过 → Act → Reflect"？
- 如何让状态机"暂停"时不占用 worker（释放资源），审批通过后"恢复"时从暂停点继续？
- 如何在状态机里插入 Human-in-the-loop 节点，复用今天的 Durable HITL 模块？

---

## 10. 本日小结（标题党 30 字 + 三句话）

**标题**：服务重启不丢审批、租约防重复执行、乐观锁防双审批——Durable HITL 完整实现

Day 33 把 Day 17 的内存审批升级为持久化审批，解决了"服务重启丢失审批"、"工具重复执行"、"双审批冲突"三个生产痛点。核心机制是"审批状态持久化到 DB + 租约（lease）防止重复执行 + 乐观锁（version）防止并发冲突 + RecoveryScanner 服务重启恢复 + 完整审计日志"。今天建立的 Durable HITL 模块是 Day 34-40 LangGraph 状态机编排的 Human-in-the-loop 节点基座。

---

## 11. 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"Durable HITL"的数据流或控制流；当天知识链"Durable workflow、pause/resume、lease、审批恢复、审计"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
用户点击"通过" 
  → 前端 POST /approvals/:id/approve 
  → ApprovalController.approve() 
  → ApprovalService.approve()（乐观锁更新 status='approved'）
  → ApprovalAuditService.log('approved')
  → BullMQ.add('execute-tool', { approvalId })
  → ApprovalQueueProcessor.process()
  → LeaseManager.acquireLease()（获取租约）
  → ToolRegistry.execute()（执行工具）
  → ApprovalRepository.updateStatus('executed')
  → LeaseManager.releaseLease()（释放租约）
```

**知识链分层**：
- **Durable workflow**：ApprovalRepository 持久化层（审批状态写入 DB，服务重启不丢失）
- **pause/resume**：ApprovalService 业务层（审批通过后加入队列，异步执行，而不是同步阻塞）
- **lease**：LeaseManager 租约层（worker 执行前获取租约，执行完释放租约，防止重复执行）
- **审批恢复**：RecoveryScanner 恢复层（服务启动时扫描 approved 但未执行的审批，重新加入队列）
- **审计**：ApprovalAuditService 审计层（每个决策事件写入审计日志表）

**为什么按这个顺序学习**：
1. 先学 Durable workflow（持久化），才能谈"服务重启不丢失"
2. 再学 pause/resume（异步队列），才能谈"审批通过后工具异步执行"
3. 再学 lease（租约），才能谈"防止重复执行"
4. 再学审批恢复（RecoveryScanner），才能谈"服务重启后自动恢复"
5. 最后学审计（AuditLog），才能谈"合规追溯"

这个顺序是"从存储层到业务层到控制层"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：租约（lease）。

**可观察现象**：工具重复执行 2 次（两个 worker 都执行了）。

**最小复现**：
1. 注释掉 `ApprovalQueueProcessor` 里的 `acquireLease()` 和 `releaseLease()` 代码
2. 创建 1 个 approved 审批
3. 启动 2 个 worker 进程（`npm run start:worker1` 和 `npm run start:worker2`）
4. 观察日志

**定位证据**：
```
[Worker 1] Executing deleteServer for srv-042
[Worker 2] Executing deleteServer for srv-042  ← 重复执行
```

DB 查询：
```sql
SELECT * FROM approval_requests WHERE id = 'apv-001';
-- lease_owner 字段为 NULL（因为没有获取租约）
```

**恢复动作**：
1. 恢复租约代码（`acquireLease()` 和 `releaseLease()`）
2. 重启服务
3. 验证只执行 1 次

**防复发测试**（E2E）：
```typescript
it('两个 worker 同时处理同一个审批，只有一个成功执行', async () => {
  await prisma.approvalRequest.create({
    data: { id: 'apv-001', status: 'approved' },
  })

  const processor1 = new ApprovalQueueProcessor(...)
  const processor2 = new ApprovalQueueProcessor(...)

  await Promise.all([
    processor1.process({ data: { approvalId: 'apv-001' } }),
    processor2.process({ data: { approvalId: 'apv-001' } }),
  ])

  const approval = await prisma.approvalRequest.findUnique({ where: { id: 'apv-001' } })
  expect(approval.status).toBe('executed') // 只执行 1 次（不是 2 次）
})
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `apps/api/src/approval/state/approval-repository.ts` 第 45 行：`updateStatusWithVersion()` 方法实现乐观锁（WHERE version=?）
- `apps/api/src/approval/lease/lease-manager.ts` 第 32 行：`acquireLease()` 方法实现租约获取（UPDATE SET lease_owner=? WHERE lease_owner IS NULL）
- `apps/api/src/approval/recovery/recovery-scanner.ts` 第 20 行：`recoverPendingApprovals()` 方法实现服务重启恢复（扫描 status='approved' 且 lease_owner IS NULL 的记录）

**测试证据**：
- `apps/api/test/approval-durable.e2e-spec.ts` 第 28 行：服务重启恢复测试（验证 status 从 'approved' 变为 'executed'）
- `apps/api/test/approval-durable.e2e-spec.ts` 第 52 行：租约防重复测试（验证两个 worker 只有一个成功获取租约）

**架构证据**：
- 依赖图（§7.5.1）：展示 5 层分层（controller → service → repository/lease/audit → Prisma/BullMQ → processor）
- 时序图（§7.5.2）：展示审批通过到工具执行的完整流程（包含租约获取/释放）

**项目目标达成**：
- ✅ 服务重启后审批不丢失（RecoveryScanner 恢复）
- ✅ 工具不重复执行（租约机制）
- ✅ 双审批不冲突（乐观锁）
- ✅ 完整审计日志（ApprovalAuditLog 表）

**距离企业生产标准还缺**：
1. **Heartbeat 续租**：工具执行耗时 30 分钟时，租约设为 30 分钟，worker 崩溃后需要等 30 分钟才能回收（太慢）
2. **审批超时机制**：审批创建 24 小时后自动过期（当前会永远停在 pending）
3. **审批权限校验**：只有运维主管可以审批删除操作（当前任何人都可以）
4. **租约续租失败的优雅降级**：worker 续租失败时（例如 DB 连接断开），应该主动停止工具执行（当前会继续执行，导致租约过期后重复执行）

**下一步演进（不破坏合同）**：
- 在 `LeaseManager` 里新增 `renewLease()` 方法（已有代码，只是没调用），worker 每 2 分钟调用一次
- 在 `ApprovalRequest` 表新增 `expires_at` 字段（nullable，默认 NULL），创建审批时设为 NOW() + 24h
- 在 `ApprovalService.approve()` 方法里新增权限校验（`if (!canApprove(userId, toolName)) throw ForbiddenException`），不改变现有方法签名

---

## 12. 真实项目情境题（Day 33 原版，保持原样）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：部署重启时有 300 个 run 停在人工审批，恢复后 41 个直接失败、7 个重复执行写操作。请用 jobId、approvalId、checkpoint、attempt 和审计日志还原时序，先暂停写队列，再把审批状态持久化并实现 pause/resume，最后用进程崩溃与重启 E2E 证明不丢审批且副作用只发生一次。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)

2. 模拟情境：审批 lease 为 5 分钟，两名审批人几乎同时点击通过，两个 worker 都拿到执行权。请定位 lease owner、锁版本和数据库提交顺序，先禁用重复按钮并隔离该 Tool，再用乐观锁或唯一约束修复竞争，验证租约过期、双审批、网络重试下只有一个有效决策。
   依据：[BullMQ Idempotent Jobs](https://docs.bullmq.io/patterns/idempotent-jobs)

知识映射：对应 durable HITL、lease、审批恢复和审计。

---

## 13. PDF 面试题映射（Day 33 原版，保持原样）

1. Function Calling 涉及转账、删除等敏感操作时，前端如何做交互确认？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 7 页。

2. 如何实现支持多轮对话中断和重新生成的状态机？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。

题目说明：近似题/资源缺口：覆盖 HITL 确认、暂停和恢复语义，但资料没有持久化工作流、lease、服务重启续跑的直接题。

---

## 14. 完成后教师五连问（Day 33 原版，保持原样）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
