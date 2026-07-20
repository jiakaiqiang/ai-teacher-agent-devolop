# Day 17：Human-in-the-loop（v1 前端确认 → v2 服务端权威审批 → v3 审批租约 + TOCTOU 防护 + 幂等消费）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-07-30 周四，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 11 Tool Registry（只读工具）、Day 12 Agent Loop、Day 13 持久化 + 幂等，第一次要让 Agent 执行「写操作」（修改 anomaly 状态），并且必须先经过人工批准的开发者

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
   Day 11：Tool Registry（只读工具 Schema/超时/裁剪/审计）
   Day 12：Agent Loop（循环调用+预算+终止）
   Day 13：持久化 / 幂等（事务+幂等键+执行状态+恢复）
   Day 14：SSE 合同演进（AgentEventV1 + resume + 取消）
   Day 15：Agent 时间线（reducer + 派生状态 + 审计 UI）
   Day 16：证据与 XSS（Markdown 净化 + 证据链）
   Day 17：Human-in-the-loop（服务端权威审批 + 审批租约 + TOCTOU）  ← 今天在这里
   Day 18-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 17 在阶段一第 7 天**。Day 11 的三个 Tool（`listServers` / `getMetrics` / `getAlertDetail`）全是**只读**的——调错了最多返回错数据，不会改坏系统。今天要引入第一个**写操作 Tool**：`changeAnomalyStatus`（把某条异常从 `firing` 改成 `resolved`）。写操作意味着**不可逆的副作用**，一旦 Agent 判断失误就会误关真实告警。所以今天的核心不是"怎么写库"（Day 13 已经会了），而是**"怎么保证写操作在执行前必须经过人工批准，且批准这件事本身不能被伪造、篡改、重放"**。

### 到 Day 16 结束时项目已具备的能力

- **后端**（Day 6-13）：Nest + Prisma + Postgres，服务器/指标/告警 CRUD，Z-Score 异常检测，服务端 FSM，Tool Registry，Agent Loop，持久化 + 幂等 + 执行状态 + 崩溃恢复
- **前端**（Day 1-16）：Vue3 + Vite + ECharts，WebSocket + SSE 实时，Agent 时间线 + 派生状态 + 审计面板，诊断报告安全渲染 + 证据链
- **缺失的一块**：所有 Tool 都是只读的。Agent 能"看"（查指标、查告警），但不能"动"（改状态、发命令）。真实运维场景里，Agent 分析完"srv-042 的 CPU 异常已经自动恢复"后，应该能提议"把这条 anomaly 标记为 resolved"——但这个动作绝对不能让 Agent 自己直接执行，必须有个人点一下"批准"

### 今天要解决的 4 个问题

1. **问题 1：写操作不能让 Agent 自主执行**
   Agent Loop（Day 12）里，Tool 一旦被 LLM 选中就直接 `execute()`。只读工具这样没问题，但 `changeAnomalyStatus` 如果也这样，Agent 判断失误（把还在 firing 的告警误判为已恢复）就会直接改坏生产数据。必须引入**审批闸门**：写操作的 Tool 被选中时，不执行，而是生成一个"待批准提议"（approval proposal），暂停循环，等人点批准后才继续。

2. **问题 2：前端隐藏按钮 ≠ 安全**
   最幼稚的做法：前端根据角色隐藏"批准"按钮，非管理员看不到。但攻击者可以绕过前端，直接 `curl -X POST /agent/approvals/xxx/execute`。**授权判断必须在服务端**：执行接口自己校验 actor 的角色/租户，而不是相信"前端已经隐藏了按钮所以调用者一定有权限"。

3. **问题 3：TOCTOU——批准时看到的和执行时做的不是一回事**
   用户在 UI 上看到"把 `anomaly-a123` 改为 resolved"，点了批准。但从"点批准"到"服务端执行"之间有个时间窗（Time Of Check To Time Of Use）。如果这期间参数被篡改（`serverId` 从 A 换成 B），或者模型重新生成了不同的提议，执行的就不是用户批准的那件事。必须给审批**快照**参数并做**哈希绑定**：执行时校验"现在要执行的参数哈希 == 用户当时批准的参数哈希"。

4. **问题 4：审批可以被重放**
   同一个 `approvalId` 被两个浏览器标签同时提交执行，或者网络重试导致执行接口被调两次。如果不做**一次性消费**（审批租约 lease 只能被消费一次），就会执行两次写操作。必须用状态机 + 幂等键保证"同一 approval 最多成功执行一次"。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`ApprovalModule`**：给 Agent Loop 引入写操作审批闸门。当 LLM 选中一个"写操作 Tool"时，不直接执行，而是创建一个带**参数快照 + 参数哈希 + 过期租约**的审批提议，暂停 Agent Loop；人工通过 `POST /agent/approvals/:id/decision` 批准或拒绝；批准后 `POST /agent/approvals/:id/execute` 在服务端校验授权、校验参数哈希、校验租约未过期、保证一次性消费后才真正执行写操作。

### 1.1 用户能看到什么

**场景**：Agent 分析完 srv-042 的 CPU 异常后，提议把 `anomaly-a123` 标记为 `resolved`。

```
时间轴：

14:35:00.000  Agent Loop step 4：LLM 生成 tool_call
  → changeAnomalyStatus(anomalyId="a-123", newStatus="resolved", reason="CPU 已恢复至 40%")
  → Tool Registry 识别这是「写操作 Tool」（requiresApproval=true）
  → 不执行！创建审批提议：
     approvalId = "apr-01"
     action = "changeAnomalyStatus"
     argsSnapshot = { anomalyId: "a-123", newStatus: "resolved", reason: "CPU 已恢复至 40%" }
     argsHash = sha256(canonicalJson(argsSnapshot)) = "3f9a2b..."
     status = "pending"
     leaseExpiresAt = now + 5min
  → Agent Loop 暂停（status: awaiting-approval）
  → SSE 推 approval.required 事件给前端

14:35:00.200  前端渲染审批卡片
  → 显示：Agent 提议把 anomaly-a123 改为 resolved
  → 显示参数：anomalyId=a-123, newStatus=resolved
  → 显示理由：CPU 已恢复至 40%
  → 两个按钮：[批准] [拒绝]
  → 显示租约倒计时：4:58 后过期

14:35:30.000  运维点击「批准」
  → POST /agent/approvals/apr-01/decision
  → body: { decision: "approved", actor: "ops-zhang" }
  → 服务端校验：
     (1) actor "ops-zhang" 是否有 approve 权限？（角色/租户校验）→ 是
     (2) approval apr-01 当前是 pending？→ 是
     (3) 租约是否过期？now < leaseExpiresAt → 未过期
  → 更新 approval.status = "approved", approvedBy = "ops-zhang", decidedAt = now
  → 响应：200 { status: "approved" }

14:35:30.500  前端自动发起执行
  → POST /agent/approvals/apr-01/execute
  → body: { actor: "ops-zhang", argsHash: "3f9a2b..." }
  → 服务端校验（TOCTOU 防护）：
     (1) actor 有 execute 权限？→ 是
     (2) approval.status == "approved"？→ 是
     (3) 租约未过期？→ 是
     (4) 请求的 argsHash == approval.argsHash？→ 一致（参数没被篡改）
     (5) approval 未被消费过？（status 从 approved → executing 的原子 CAS）→ 抢到
  → 事务内执行写操作：
     UPDATE anomalies SET status='resolved' WHERE id='a-123'
     approval.status = "executed", executedAt = now
  → 恢复 Agent Loop（把执行结果作为 tool result 喂回 LLM）
  → 响应：200 { status: "executed", result: {...} }

如果 14:35:30.501 第二个标签也发 execute（重放）：
  → 校验 (5)：approval.status 已经是 "executing" / "executed"
  → 拒绝：409 Conflict { error: "approval_already_consumed" }
  → 写操作只执行一次

如果 14:41:00.000 才点批准（超过 5min 租约）：
  → 校验 (3)：now > leaseExpiresAt
  → 拒绝：410 Gone { error: "approval_lease_expired" }
  → 需要 Agent 重新生成提议
```

**前端观察到的最终结果**：
- 未批准的写操作永远不执行（执行数 = 0）
- 同一 approval 无论被点几次执行，写操作只成功一次
- 参数被篡改（argsHash 不匹配）时执行被拒绝
- 租约过期后审批自动失效，需要重新提议
- 每一次 decision / execute 都有审计日志（谁、什么时候、对什么资源、结果）

### 1.2 这个模块在项目里承担什么

- **输入**：Day 12 Agent Loop 在选中「写操作 Tool」时生成的审批提议（action + argsSnapshot）；人工通过 HTTP 接口提交的 decision 和 execute 请求
- **输出**：一个服务端权威的审批状态机（`pending → approved/rejected → executing → executed/failed`），保证未批准不执行、参数不可篡改、租约过期失效、一次性消费；执行结果回喂给暂停的 Agent Loop
- **对齐后续**：今天定义的 **审批合同**（`ApprovalProposal` / `ApprovalDecision` / `ExecuteGuard`）是 Day 61-90 p2-agent-workbench 多 Agent 协同的权限地基。多 Agent 场景里，一个 Agent 提议、另一个 Agent（或人）审批的模式完全复用今天的租约 + 哈希绑定机制

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 前端确认对话框，用户点"确定"后前端直接调执行接口 | `ConfirmDialog.vue` + 执行接口无授权校验 | HITL 基本概念、前端确认 UX、Tool `requiresApproval` 标记 |
| **v1 痛点** | 前端隐藏按钮可绕过；执行接口无授权；参数可篡改；可重放 |  |  |
| **v2** | v1 + **服务端权威审批**（decision/execute 分离 + 服务端授权校验 + 审批状态机） | 拆出 `approval.service.ts` + `approval-status.enum.ts` + 授权 Guard | 服务端授权、审批状态机、actor 角色校验、decision vs execute 分离 |
| **v2 痛点** | 批准到执行有时间窗（TOCTOU）；参数快照未哈希绑定；无租约过期；重放靠状态判断不够原子 |  |  |
| **v3** | v2 + **参数哈希绑定**（canonical JSON + sha256）+ **审批租约**（过期失效）+ **原子一次性消费**（CAS）+ **审计日志** | 完整分层（contract/hash/lease/guard/service/audit） | canonical JSON、参数哈希、TOCTOU 防护、租约机制、CAS 原子消费、审计链 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Human-in-the-loop 审批涉及多个关注点（审批状态机、参数哈希、租约过期、授权校验、原子消费、审计日志），如果不先在脑子里立起骨架，写到一半就会把"授权校验"糊在 controller 上、把"参数哈希"和"执行逻辑"混在一个方法里、把"租约过期"当成 cron 任务、把"一次性消费"用普通的 `if (status === 'approved')` 判断（并发下会双执行）。看完这棵树，下面章节再出现 `src/approval/lease/approval-lease.service.ts` 时，你就能立刻定位它在架构中的位置。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── approval/                                    ← 【新增】Human-in-the-loop 审批模块
│   ├── contract/
│   │   ├── approval-proposal.types.ts           ← 审批提议合同（action + argsSnapshot + hash）
│   │   ├── approval-decision.types.ts           ← 决策合同（approved/rejected + actor）
│   │   └── approval-status.enum.ts              ← 审批状态枚举（6 个状态 + 转移规则）
│   ├── hash/
│   │   ├── canonical-json.ts                    ← 参数规范化（纯函数，key 排序）
│   │   ├── args-hash.ts                         ← 参数哈希（sha256，纯函数）
│   │   └── args-hash.spec.ts                    ← 哈希单元测试
│   ├── lease/
│   │   ├── approval-lease.ts                    ← 租约过期判断（纯函数）
│   │   ├── approval-lease.spec.ts               ← 租约单元测试
│   │   └── lease-scanner.ts                     ← 过期租约扫描器（标记 expired）
│   ├── guard/
│   │   ├── authorization.guard.ts               ← 服务端授权校验（actor 角色/租户）
│   │   └── execute.guard.ts                     ← 执行前 5 项校验（TOCTOU 防护）
│   ├── audit/
│   │   └── approval-audit.service.ts            ← 审批审计日志
│   ├── index.ts                                 ← 桶文件
│   ├── approval.module.ts                       ← NestJS 模块
│   ├── approval.service.ts                      ← 业务编排层
│   └── approval.controller.ts                   ← HTTP 入口（decision / execute）
├── agent/                                       ← 【Day 12 已有】Agent Loop
│   ├── loop/agent-loop.engine.ts                ← 需要改：写操作 Tool 生成审批提议并暂停
│   └── ...
├── tools/                                       ← 【Day 11 已有】Tool Registry
│   ├── registry/tool-registry.service.ts        ← 需要改：Tool 增加 requiresApproval 标记
│   └── implementations/
│       └── change-anomaly-status.tool.ts        ← 【新增】第一个写操作 Tool
├── prisma/
│   ├── schema.prisma                            ← 【已有】需要新增 Approval 表
│   └── prisma.service.ts                        ← 【Day 07 已有】
└── main.ts                                      ← 【已有】需要挂 lease-scanner
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `approval.service.ts` | ✗（前端直接调执行） | ✓ decision + execute 分离 | ✓ 委托给 guard + lease + hash |
| `contract/approval-status.enum.ts` | ✗ | ✓ 4 个状态 | ✓ 6 个状态（+ `executing` `expired`） |
| `guard/authorization.guard.ts` | ✗（前端隐藏按钮） | ✓ actor 角色校验 | ✓ 同 v2 |
| `guard/execute.guard.ts` | ✗ | ✗ | ✓ 5 项校验（状态/授权/租约/哈希/消费） |
| `hash/canonical-json.ts` | ✗ | ✗ | ✓ key 排序规范化 |
| `hash/args-hash.ts` | ✗ | ✗ | ✓ sha256 参数哈希 |
| `lease/approval-lease.ts` | ✗ | ✗ | ✓ 过期判断纯函数 |
| `lease/lease-scanner.ts` | ✗ | ✗ | ✓ 启动扫描 + 标记 expired |
| `prisma/schema.prisma` (Approval) | ✗ | 基础表 | + `argsHash` + `leaseExpiresAt` + `consumedAt` |

**依赖方向（务必单向，反过来一次都不行）**：

```
agent/loop/agent-loop.engine.ts
        │ （写操作 Tool → 生成提议 → 暂停）
        ▼
approval.service.ts
        │
        ├─► guard/authorization.guard.ts ──► （actor 角色/租户）
        │
        ├─► guard/execute.guard.ts
        │           │
        │           ├─► hash/args-hash.ts ──► hash/canonical-json.ts（纯函数）
        │           │
        │           └─► lease/approval-lease.ts（纯函数）
        │
        ├─► audit/approval-audit.service.ts ──► prisma
        │
        └─► prisma（Approval 表 CAS 更新）

contract/*.ts        ← 纯类型 + enum，不 import prisma
hash/*.ts            ← 纯函数，不 import prisma、不 import nest
lease/approval-lease.ts  ← 纯函数（输入 approval + now，输出 boolean）
```

**红线**：
- `hash/canonical-json.ts` 和 `hash/args-hash.ts` 里出现 `import { PrismaService }` 就是架构塌方——哈希是纯计算，必须能在纯 Node 里测试
- `lease/approval-lease.ts` 里出现 `new Date()`（内部读当前时间）是塌方——当前时间必须作为参数传入，否则无法单测过期边界
- `approval.controller.ts` 里直接 `if (actor.role === 'admin')` 做授权是塌方——授权判断必须走 `AuthorizationGuard`，散在 controller 里无法统一测试和审计
- `agent-loop.engine.ts` 里直接执行写操作 Tool（不走审批）是塌方——写操作必须经过 `ApprovalService`

**动手前先问自己 3 个问题**：

1. 参数哈希为什么要先做 canonical JSON？—— 见 §5.4 知识点 2「canonical JSON 与哈希稳定性」
2. `execute.guard.ts` 的 5 项校验为什么顺序不能乱？—— 见 §5.4 知识点 4「执行闸门的校验顺序」
3. 一次性消费为什么必须用 CAS 而不是 `if (status === 'approved')`？—— 见 §5.4 知识点 5「原子消费与并发重放」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认依赖 + Node crypto（3 分钟）

按第 5.3 节的代码：

- `sha256` 用 Node 内置 `node:crypto`，不需要装第三方库
- 确认 `@nestjs/common` 已有（Day 06 装的）
- 确认 Prisma ≥ 5（Day 13 已确认）；`consumedAt` 的原子 CAS 用 `updateMany` + `where` 条件

**边写边问自己**：

- 为什么用 sha256 而不是 md5？（md5 有碰撞风险，虽然这里不是安全场景，但用 sha256 是好习惯，成本几乎一样）
- 为什么参数哈希不加盐？（这里哈希的目的是"检测参数是否被改"，不是防彩虹表；加盐反而破坏"相同参数得相同哈希"的可校验性）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `apps/api/src/approval/` 下建 5 个子目录：

```
approval/
├── contract/
├── hash/
├── lease/
├── guard/
└── audit/
```

**边写边问自己**：

- 为什么 `hash/` 和 `lease/` 分开？（哈希解决"参数篡改"，租约解决"过期失效"，两个独立的安全维度，各自单测）
- 为什么 `guard/` 里有两个 guard？（`authorization.guard` 管"你是谁、有没有权限"，`execute.guard` 管"这次执行是否满足所有前置条件"，职责不同）

### 1.5.3 D-3：改 Prisma Schema + migration（4 分钟）

按第 5.3 节的代码：

- 新增 `Approval` model + `ApprovalStatus` enum
- 运行 `pnpm --filter api prisma migrate dev --name add_approval`
- 检查 migration.sql 是否包含 `argsHash` 和 `leaseExpiresAt` 字段

**边写边问自己**：

- `consumedAt` 为什么用 `DateTime?` 而不是 `Boolean consumed`？（时间戳既表达"是否消费"又记录"何时消费"，审计更有用；而且 `updateMany where: { consumedAt: null }` 天然是 CAS 条件）
- `argsHash` 为什么存 DB 而不是每次重算？（用户批准的那一刻的参数快照必须固化下来；如果每次重算，模型改了参数后哈希也会变，TOCTOU 检测就失效了）

### 1.5.4 D-4：实现 hash + lease 层（5 分钟）

按第 5.3 节的代码：

- 写 `hash/canonical-json.ts`（`canonicalize(obj)` 递归排序 key）
- 写 `hash/args-hash.ts`（`hashArgs(obj)` = sha256(canonicalize)）
- 写 `hash/args-hash.spec.ts`（key 顺序不同哈希相同、值不同哈希不同）
- 写 `lease/approval-lease.ts`（`isLeaseExpired(approval, now)` 纯函数）
- 写 `lease/approval-lease.spec.ts`（过期边界）

**边写边问自己**：

- `canonicalize` 为什么要递归？（嵌套对象 `{ a: { c: 1, b: 2 } }` 的内层 key 也要排序，否则 `{c,b}` 和 `{b,c}` 哈希不同）
- `isLeaseExpired` 为什么把 `now` 作为参数？（单测里要能构造"刚好过期"、"差 1ms 过期"的边界，读系统时间无法精确控制）

### 1.5.5 D-5：实现 guard + service + 集成（6 分钟）

按第 5.3 节的代码：

- 写 `guard/authorization.guard.ts`（actor 角色/租户校验）
- 写 `guard/execute.guard.ts`（5 项校验，返回 `{ ok: true } | { ok: false, code, httpStatus }`）
- 写 `audit/approval-audit.service.ts`（记录 decision / execute）
- 写 `approval.service.ts`（propose / decide / execute 编排 + CAS 消费）
- 写 `approval.controller.ts`（`POST /approvals/:id/decision` / `POST /approvals/:id/execute`）
- 写 `approval.module.ts`
- 改 `tools/implementations/change-anomaly-status.tool.ts`（`requiresApproval = true`）
- 改 `agent/loop/agent-loop.engine.ts`（写操作 Tool → 生成提议 → 暂停）

**边写边问自己**：

- `execute` 里的 CAS（`updateMany where: { status: 'approved', consumedAt: null }`）返回 `count === 0` 意味着什么？（意味着别的请求已经抢先消费了，当前请求应该返回 409）
- 授权校验为什么在 `decide` 和 `execute` 都要做一遍？（decide 时校验"能否批准"，execute 时校验"能否执行"——可能是不同角色；而且 execute 是独立接口，不能假设一定是 decide 的人调用）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"前端确认 → 服务端权威 → 租约+哈希+CAS"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `execute.guard.ts` 和 `approval.service.ts` 的 CAS | 能口述"5 项校验的顺序"、"CAS 如何防重放" |
| C：读深挖 | 35 min | §6.5 前端底子补弱（`Day17深挖-前端底子补弱.html`） | 能回答"审批租约倒计时前端怎么和服务端时间对齐" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个 spec 文件 | `pnpm --filter api test approval` 全绿 |
| F-1：反证 1 | 5 min | §7.7 去掉 execute.guard 的哈希校验，篡改参数执行 | 观察参数篡改成功，验证"没有哈希绑定是什么样子" |
| F-2：反证 2 | 5 min | §7.8 把 CAS 换成 `if (status === 'approved')`，并发执行 | 观察双执行，验证"没有 CAS 是什么样子" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day17` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（前端确认对话框）

### 3.1 v1 要实现什么

Agent Loop 选中写操作 Tool 时，前端弹一个确认对话框，用户点"确定"后前端直接调执行接口。这是最直觉、也最不安全的 HITL 实现。

**目标**：
- `changeAnomalyStatus` Tool 标记 `requiresApproval = true`
- Agent Loop 遇到这个 Tool 时，通过 SSE 推 `approval.required`，暂停循环
- 前端弹 `ConfirmDialog.vue`，显示 action + 参数
- 用户点"确定" → 前端 `POST /agent/execute` 直接执行

**不做**：
- 服务端不校验授权（相信前端已经隐藏了按钮）
- 不做参数哈希（相信前端传来的参数就是用户看到的）
- 不做租约（审批永不过期）
- 不做一次性消费（重复调用就重复执行）

### 3.2 v1 目录结构

```
apps/api/src/
├── agent/
│   ├── loop/agent-loop.engine.ts       ← 改：写操作 Tool 暂停并推 approval.required
│   └── agent.controller.ts             ← 加：POST /agent/execute（裸执行，无校验）
├── tools/implementations/
│   └── change-anomaly-status.tool.ts   ← 新增：写操作 Tool
frontend/src/agent/
└── approval/ConfirmDialog.vue          ← 新增：前端确认对话框
```

### 3.3 v1 完整代码

**apps/api/src/tools/implementations/change-anomaly-status.tool.ts（v1 全文）**

```typescript
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'

export const changeAnomalyStatusSchema = z.object({
  anomalyId: z.string().min(1),
  newStatus: z.enum(['firing', 'acknowledged', 'resolved']),
  reason: z.string().min(1).max(500),
})

export type ChangeAnomalyStatusArgs = z.infer<typeof changeAnomalyStatusSchema>

export function createChangeAnomalyStatusTool(prisma: PrismaService) {
  return {
    name: 'changeAnomalyStatus',
    description: '修改异常告警的状态（写操作，需要人工批准）',
    schema: changeAnomalyStatusSchema,
    requiresApproval: true, // v1 引入的标记：写操作 Tool
    async execute(args: ChangeAnomalyStatusArgs) {
      const updated = await prisma.anomaly.update({
        where: { id: args.anomalyId },
        data: { status: args.newStatus },
      })
      return {
        anomalyId: updated.id,
        newStatus: updated.status,
        reason: args.reason,
      }
    },
  }
}
```

**apps/api/src/agent/agent.controller.ts（v1 增量：裸执行接口）**

```typescript
import { Controller, Post, Body } from '@nestjs/common'
import { ToolRegistryService } from '../tools/registry/tool-registry.service'

@Controller('agent')
export class AgentController {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  // v1：裸执行接口，没有任何授权/校验（危险，仅教学演示）
  @Post('execute')
  async execute(@Body() body: { toolName: string; args: unknown }) {
    const tool = this.toolRegistry.get(body.toolName)
    const parsed = tool.schema.parse(body.args)
    const result = await tool.execute(parsed)
    return { ok: true, result }
  }
}
```

**frontend/src/agent/approval/ConfirmDialog.vue（v1 全文）**

```vue
<script setup lang="ts">
defineProps<{
  action: string
  args: Record<string, unknown>
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <h3 id="confirm-title">确认执行高风险操作</h3>
    <p>Agent 提议执行：<strong>{{ action }}</strong></p>
    <dl>
      <template v-for="(value, key) in args" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ value }}</dd>
      </template>
    </dl>
    <div class="actions">
      <button type="button" @click="emit('confirm')">确定</button>
      <button type="button" @click="emit('cancel')">取消</button>
    </div>
  </div>
</template>
```

### 3.4 v1 暴露的痛点

**痛点 1：前端隐藏按钮可被绕过**

`POST /agent/execute` 没有任何授权校验。攻击者（或任何拿到接口地址的人）可以直接：

```bash
curl -X POST http://localhost:3000/agent/execute \
  -d '{"toolName":"changeAnomalyStatus","args":{"anomalyId":"a-123","newStatus":"resolved","reason":"x"}}'
```

不需要任何"批准"，写操作直接执行。前端的 ConfirmDialog 形同虚设——它只是"礼貌地问一下"，服务端根本不 care 用户点没点确定。

**痛点 2：没有"批准"这个持久记录**

v1 里"批准"只是前端点了一下"确定"就调执行接口，服务端不知道"这次执行是被谁批准的"。出了事故（误关了真实告警），没有任何审计记录能回答"谁批准的、什么时候、基于什么参数"。

**痛点 3：参数可被篡改（TOCTOU）**

用户在 ConfirmDialog 看到的是 `anomalyId=a-123`。但从"点确定"到"前端发 execute 请求"之间，如果前端状态被篡改（比如 XSS 注入改了 args），或者模型在 SSE 里推了新的提议覆盖了旧的，实际执行的参数可能是 `anomalyId=a-999`。用户批准的和执行的不是一回事。

**痛点 4：可无限重放**

前端网络重试、用户手抖双击"确定"、两个标签同时打开，都会导致 `POST /agent/execute` 被调多次，每次都真实执行一次写操作。同一个"批准"被消费了 N 次。

---

## 4. v2：服务端权威审批 + 授权校验

### 4.1 v2 要实现什么

用户视角：批准这个动作变成服务端的一等公民——Agent 生成提议时在服务端创建一条 `Approval` 记录（status=`pending`），用户批准调 `POST /approvals/:id/decision`，服务端校验 actor 授权后把 status 改成 `approved`，执行时调 `POST /approvals/:id/execute` 校验 status 后才真正执行。前端隐藏按钮不再是唯一防线。

**目标**：
- 新增 `Approval` 表（id / runId / action / argsJson / status / actorId）
- Agent Loop 遇到写操作 Tool → 服务端创建 `Approval(status=pending)` → 推 `approval.required` 带 approvalId
- `POST /approvals/:id/decision`（body: `{ decision: 'approve' | 'reject', actorId }`）：`AuthorizationGuard` 校验 actor 角色/租户 → 改 status
- `POST /approvals/:id/execute`：校验 `status === 'approved'` → 执行 Tool → 改 status=`executed`

**依然不做**：
- 不做参数哈希（execute 用的是 DB 里存的 argsJson，但没检测"批准时和执行时是否一致"）
- 不做租约过期（approved 的审批永不过期）
- 不做一次性消费（execute 只 `if (status === 'approved')`，并发下可双执行）

### 4.2 v2 目录结构

```
apps/api/src/approval/
├── contract/
│   └── approval-status.enum.ts       ← 新增：审批状态枚举
├── guard/
│   └── authorization.guard.ts        ← 新增：actor 授权校验
├── approval.service.ts               ← 新增：propose / decide / execute
├── approval.controller.ts            ← 新增：decision / execute 接口
└── approval.module.ts                ← 新增
```

### 4.3 v2 完整代码

**apps/api/prisma/schema.prisma（v2 增量）**

```prisma
enum ApprovalStatus {
  pending
  approved
  rejected
  executed
}

model Approval {
  id          String         @id @default(cuid())
  runId       String
  action      String         // Tool 名，如 "changeAnomalyStatus"
  argsJson    String         @db.Text
  status      ApprovalStatus @default(pending)
  actorId     String?        // 批准人（decision 时写入）
  createdAt   DateTime       @default(now())
  decidedAt   DateTime?
  executedAt  DateTime?

  @@index([runId])
  @@index([status])
}
```

**apps/api/src/approval/contract/approval-status.enum.ts（v2 全文）**

```typescript
export enum ApprovalStatus {
  pending = 'pending',
  approved = 'approved',
  rejected = 'rejected',
  executed = 'executed',
}

// 状态转移矩阵：只允许这些方向
const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  [ApprovalStatus.pending]: [ApprovalStatus.approved, ApprovalStatus.rejected],
  [ApprovalStatus.approved]: [ApprovalStatus.executed],
  [ApprovalStatus.rejected]: [],
  [ApprovalStatus.executed]: [],
}

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to)
}
```

**apps/api/src/approval/guard/authorization.guard.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'

export type Actor = {
  id: string
  role: 'viewer' | 'operator' | 'admin'
  tenantId: string
}

export type AuthzResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

@Injectable()
export class AuthorizationGuard {
  /**
   * 校验 actor 是否有权批准/执行指定 action。
   * 纯逻辑，不查 DB（actor 由上游中间件从 token 解析后传入）。
   */
  canDecide(actor: Actor, action: string, resourceTenantId: string): AuthzResult {
    // 规则 1：viewer 不能批准任何写操作
    if (actor.role === 'viewer') {
      return { ok: false, code: 'role_forbidden', message: 'viewer 无权批准写操作' }
    }
    // 规则 2：跨租户禁止
    if (actor.tenantId !== resourceTenantId) {
      return { ok: false, code: 'tenant_mismatch', message: '跨租户操作被拒绝' }
    }
    // 规则 3：高危 action 仅 admin
    const highRisk = ['deleteServer', 'changeAnomalyStatus']
    if (highRisk.includes(action) && actor.role !== 'admin' && actor.role !== 'operator') {
      return { ok: false, code: 'insufficient_role', message: `${action} 需要 operator 及以上` }
    }
    return { ok: true }
  }
}
```

**apps/api/src/approval/approval.service.ts（v2 全文）**

```typescript
import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ToolRegistryService } from '../tools/registry/tool-registry.service'
import { AuthorizationGuard, Actor } from './guard/authorization.guard'
import { ApprovalStatus, canTransition } from './contract/approval-status.enum'

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly authz: AuthorizationGuard,
  ) {}

  // Agent Loop 调用：创建待批准提议
  async propose(runId: string, action: string, args: unknown): Promise<string> {
    const approval = await this.prisma.approval.create({
      data: {
        runId,
        action,
        argsJson: JSON.stringify(args),
        status: ApprovalStatus.pending,
      },
    })
    return approval.id
  }

  // 用户批准/拒绝
  async decide(
    approvalId: string,
    decision: 'approve' | 'reject',
    actor: Actor,
    resourceTenantId: string,
  ) {
    const approval = await this.prisma.approval.findUnique({ where: { id: approvalId } })
    if (!approval) throw new NotFoundException('approval not found')

    const authz = this.authz.canDecide(actor, approval.action, resourceTenantId)
    if (!authz.ok) throw new ForbiddenException(authz.message)

    const next = decision === 'approve' ? ApprovalStatus.approved : ApprovalStatus.rejected
    if (!canTransition(approval.status as ApprovalStatus, next)) {
      throw new ConflictException(`cannot transition ${approval.status} -> ${next}`)
    }

    return this.prisma.approval.update({
      where: { id: approvalId },
      data: { status: next, actorId: actor.id, decidedAt: new Date() },
    })
  }

  // 执行已批准的操作
  async execute(approvalId: string, actor: Actor, resourceTenantId: string) {
    const approval = await this.prisma.approval.findUnique({ where: { id: approvalId } })
    if (!approval) throw new NotFoundException('approval not found')

    const authz = this.authz.canDecide(actor, approval.action, resourceTenantId)
    if (!authz.ok) throw new ForbiddenException(authz.message)

    // v2 的检查：只看 status（并发下有漏洞，v3 修）
    if (approval.status !== ApprovalStatus.approved) {
      throw new ConflictException(`approval status is ${approval.status}, not approved`)
    }

    const tool = this.toolRegistry.get(approval.action)
    const args = tool.schema.parse(JSON.parse(approval.argsJson))
    const result = await tool.execute(args)

    await this.prisma.approval.update({
      where: { id: approvalId },
      data: { status: ApprovalStatus.executed, executedAt: new Date() },
    })

    return { ok: true, result }
  }
}
```

**apps/api/src/approval/approval.controller.ts（v2 全文）**

```typescript
import { Controller, Post, Param, Body, Req } from '@nestjs/common'
import { ApprovalService } from './approval.service'
import { Actor } from './guard/authorization.guard'

@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post(':id/decision')
  async decision(
    @Param('id') id: string,
    @Body() body: { decision: 'approve' | 'reject' },
    @Req() req: { actor: Actor; tenantId: string }, // 上游中间件注入
  ) {
    return this.approvalService.decide(id, body.decision, req.actor, req.tenantId)
  }

  @Post(':id/execute')
  async execute(
    @Param('id') id: string,
    @Req() req: { actor: Actor; tenantId: string },
  ) {
    return this.approvalService.execute(id, req.actor, req.tenantId)
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：参数篡改无法检测（TOCTOU）**

`execute` 用的是 DB 里存的 `argsJson`——这看起来安全，但漏洞在于：如果 `propose` 之后、`decide` 之前，模型又推了一次新提议，或者有并发请求 `update` 了这条 Approval 的 `argsJson`，用户批准时看到的参数和执行时用的参数就不一致。v2 没有"把用户批准那一刻的参数快照固化下来并校验"的机制。用户批准 `resolve a-123`，实际执行 `resolve a-999`。

**痛点 2：审批永不过期**

用户上午 10:00 批准了"重启 srv-042"，但一直没点执行。下午 3:00 这台服务器已经恢复正常了，运维忘了这条审批还挂着，手一滑点了执行——把一台正常的服务器重启了。审批需要**租约（lease）**：批准后 N 分钟内不执行就自动失效。

**痛点 3：并发双执行（CAS 缺失）**

`execute` 里 `if (approval.status !== 'approved') throw` 之后再 `update status = 'executed'`——这是典型的"检查后执行"竞态。两个并发请求同时通过 `if` 检查（都看到 approved），然后都执行 Tool、都 update。写操作被执行了两次。需要用**原子 CAS**（`updateMany where: { status: 'approved' }` 返回 count 判断是否抢到）。

**痛点 4：没有独立审计服务**

decision 和 execute 都散在 service 里 update，没有专门记录"谁在何时基于什么参数做了什么决策"的审计流水。事故复盘时无法快速回答"这次误操作的完整决策链"。

---

## 5. v3：参数快照哈希 + 审批租约 + CAS 一次性消费 + 审计（终态）

### 5.1 v3 要实现什么

用户视角：
1. 用户批准时，服务端把"批准那一刻的参数"哈希固化成 `argsHash`；执行时重新哈希 DB 里的参数并比对，不一致直接 409（防 TOCTOU 参数篡改）
2. 批准生成一个带过期时间的租约（`leaseExpiresAt`）；执行时校验未过期，过期返回 410 Gone
3. 执行用原子 CAS（`updateMany where status=approved`）抢占，count=0 说明已被别的请求消费，返回 409（防并发双执行）
4. 每一步（propose / decide / execute / 拒绝 / 过期）都写 `ApprovalAudit` 流水，含 actor、时间、参数哈希、结果
5. 越权测试全部 403；同一 approval 只成功执行一次；篡改/过期/重复均无副作用

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/approval/
├── contract/
│   ├── approval-status.enum.ts          ← v2 已有，新增 expired 状态
│   └── approval-lease.ts                ← 新增：租约计算（纯函数）
├── guard/
│   └── authorization.guard.ts           ← v2 已有
├── hash/
│   ├── args-hash.ts                     ← 新增：参数规范化哈希（纯函数）
│   └── args-hash.spec.ts                ← 新增：哈希单元测试
├── audit/
│   └── approval-audit.service.ts        ← 新增：决策流水
├── approval.service.ts                  ← 改：加哈希/租约/CAS
├── approval.service.spec.ts             ← 新增：TOCTOU/过期/并发单测
├── approval.controller.ts               ← v2 已有
└── approval.module.ts                   ← v2 已有
```

### 5.3 v3 完整代码

#### 5.3.1 contract 层：approval-status.enum.ts（v3 增量）

```typescript
export enum ApprovalStatus {
  pending = 'pending',
  approved = 'approved',
  rejected = 'rejected',
  executed = 'executed',
  expired = 'expired', // v3 新增：租约过期
}

const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  [ApprovalStatus.pending]: [ApprovalStatus.approved, ApprovalStatus.rejected],
  [ApprovalStatus.approved]: [ApprovalStatus.executed, ApprovalStatus.expired],
  [ApprovalStatus.rejected]: [],
  [ApprovalStatus.executed]: [],
  [ApprovalStatus.expired]: [],
}

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: ApprovalStatus): boolean {
  return (
    status === ApprovalStatus.rejected ||
    status === ApprovalStatus.executed ||
    status === ApprovalStatus.expired
  )
}
```

#### 5.3.2 contract 层：approval-lease.ts（v3 全文）

```typescript
/**
 * 审批租约计算：批准后 N 分钟内有效。
 * 纯函数——只依赖传入的时间，不读系统时钟、不查 DB，可 100% 单测。
 */
export const APPROVAL_LEASE_MINUTES = 10

export function computeLeaseExpiry(decidedAt: Date, minutes = APPROVAL_LEASE_MINUTES): Date {
  return new Date(decidedAt.getTime() + minutes * 60_000)
}

export function isLeaseExpired(leaseExpiresAt: Date, now: Date): boolean {
  return now.getTime() > leaseExpiresAt.getTime()
}
```

#### 5.3.3 hash 层：args-hash.ts（v3 全文）

```typescript
import { createHash } from 'node:crypto'

/**
 * 参数规范化哈希——防 TOCTOU 参数篡改。
 *
 * 关键：先做 key 排序的稳定序列化，再哈希。
 * 否则 { a: 1, b: 2 } 和 { b: 2, a: 1 } 语义相同但哈希不同。
 *
 * 纯函数：相同输入永远得到相同输出，不含时间/随机盐。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  )
  return `{${entries.join(',')}}`
}

export function hashArgs(args: unknown): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex')
}
```

#### 5.3.4 hash 层：args-hash.spec.ts（v3 全文）

```typescript
import { describe, it, expect } from 'vitest'
import { stableStringify, hashArgs } from './args-hash'

describe('args-hash', () => {
  it('key 顺序不同但哈希相同', () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }))
  })

  it('嵌套对象 key 顺序不同也相同', () => {
    expect(hashArgs({ x: { p: 1, q: 2 } })).toBe(hashArgs({ x: { q: 2, p: 1 } }))
  })

  it('值不同则哈希不同', () => {
    expect(hashArgs({ serverId: 'a-123' })).not.toBe(hashArgs({ serverId: 'a-999' }))
  })

  it('数组顺序敏感（语义上顺序有意义）', () => {
    expect(hashArgs([1, 2])).not.toBe(hashArgs([2, 1]))
  })

  it('相同输入调 1000 次结果一致（确定性）', () => {
    const first = hashArgs({ action: 'resolve', id: 'a-1' })
    for (let i = 0; i < 1000; i++) {
      expect(hashArgs({ action: 'resolve', id: 'a-1' })).toBe(first)
    }
  })
})
```

#### 5.3.5 audit 层：approval-audit.service.ts（v3 全文）

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export type AuditEvent =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'execute_denied_tampered'
  | 'execute_denied_expired'
  | 'execute_denied_race'

@Injectable()
export class ApprovalAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    approvalId: string
    event: AuditEvent
    actorId?: string
    argsHash?: string
    detail?: string
  }): Promise<void> {
    await this.prisma.approvalAudit.create({
      data: {
        approvalId: params.approvalId,
        event: params.event,
        actorId: params.actorId ?? null,
        argsHash: params.argsHash ?? null,
        detail: params.detail ?? null,
      },
    })
  }
}
```

#### 5.3.6 service 层：approval.service.ts（v3 全文）

```typescript
import { Injectable, NotFoundException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ToolRegistryService } from '../tools/registry/tool-registry.service'
import { AuthorizationGuard, Actor } from './guard/authorization.guard'
import { ApprovalStatus, canTransition } from './contract/approval-status.enum'
import { computeLeaseExpiry, isLeaseExpired } from './contract/approval-lease'
import { hashArgs } from './hash/args-hash'
import { ApprovalAuditService } from './audit/approval-audit.service'

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly authz: AuthorizationGuard,
    private readonly audit: ApprovalAuditService,
  ) {}

  async propose(runId: string, action: string, args: unknown): Promise<string> {
    const argsHash = hashArgs(args)
    const approval = await this.prisma.approval.create({
      data: {
        runId,
        action,
        argsJson: JSON.stringify(args),
        argsHash,
        status: ApprovalStatus.pending,
      },
    })
    await this.audit.record({ approvalId: approval.id, event: 'proposed', argsHash })
    return approval.id
  }

  async decide(
    approvalId: string,
    decision: 'approve' | 'reject',
    actor: Actor,
    resourceTenantId: string,
  ) {
    const approval = await this.prisma.approval.findUnique({ where: { id: approvalId } })
    if (!approval) throw new NotFoundException('approval not found')

    const authz = this.authz.canDecide(actor, approval.action, resourceTenantId)
    if (!authz.ok) throw new ForbiddenException(authz.message)

    const next = decision === 'approve' ? ApprovalStatus.approved : ApprovalStatus.rejected
    if (!canTransition(approval.status as ApprovalStatus, next)) {
      throw new ConflictException(`cannot transition ${approval.status} -> ${next}`)
    }

    const decidedAt = new Date()
    const updated = await this.prisma.approval.update({
      where: { id: approvalId },
      data: {
        status: next,
        actorId: actor.id,
        decidedAt,
        leaseExpiresAt: next === ApprovalStatus.approved ? computeLeaseExpiry(decidedAt) : null,
      },
    })
    await this.audit.record({
      approvalId,
      event: decision === 'approve' ? 'approved' : 'rejected',
      actorId: actor.id,
      argsHash: approval.argsHash,
    })
    return updated
  }

  async execute(approvalId: string, actor: Actor, resourceTenantId: string) {
    const approval = await this.prisma.approval.findUnique({ where: { id: approvalId } })
    if (!approval) throw new NotFoundException('approval not found')

    const authz = this.authz.canDecide(actor, approval.action, resourceTenantId)
    if (!authz.ok) throw new ForbiddenException(authz.message)

    // 检查 1：状态必须是 approved
    if (approval.status !== ApprovalStatus.approved) {
      throw new ConflictException(`approval status is ${approval.status}, not approved`)
    }

    // 检查 2：租约未过期
    const now = new Date()
    if (approval.leaseExpiresAt && isLeaseExpired(approval.leaseExpiresAt, now)) {
      await this.prisma.approval.update({
        where: { id: approvalId },
        data: { status: ApprovalStatus.expired },
      })
      await this.audit.record({ approvalId, event: 'execute_denied_expired', actorId: actor.id })
      throw new GoneException('approval lease expired')
    }

    // 检查 3：参数快照哈希——防 TOCTOU 篡改
    const currentHash = hashArgs(JSON.parse(approval.argsJson))
    if (currentHash !== approval.argsHash) {
      await this.audit.record({
        approvalId,
        event: 'execute_denied_tampered',
        actorId: actor.id,
        detail: `expected ${approval.argsHash}, got ${currentHash}`,
      })
      throw new ConflictException('argument tampering detected')
    }

    // 检查 4：原子 CAS 抢占——防并发双执行
    const claimed = await this.prisma.approval.updateMany({
      where: { id: approvalId, status: ApprovalStatus.approved },
      data: { status: ApprovalStatus.executed, executedAt: now },
    })
    if (claimed.count === 0) {
      await this.audit.record({ approvalId, event: 'execute_denied_race', actorId: actor.id })
      throw new ConflictException('approval already consumed by another request')
    }

    // 抢占成功，执行 Tool
    const tool = this.toolRegistry.get(approval.action)
    const args = tool.schema.parse(JSON.parse(approval.argsJson))
    const result = await tool.execute(args)

    await this.audit.record({
      approvalId,
      event: 'executed',
      actorId: actor.id,
      argsHash: approval.argsHash,
    })
    return { ok: true, result }
  }
}
```

#### 5.3.7 service 层：approval.service.spec.ts（v3 核心用例）

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApprovalService } from './approval.service'
import { ApprovalStatus } from './contract/approval-status.enum'
import { hashArgs } from './hash/args-hash'

// 用内存 fake 替代 Prisma（只实现本测试用到的方法）
function makeFakePrisma(initial: any) {
  const row = { ...initial }
  return {
    row,
    approval: {
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => Object.assign(row, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (row.status === where.status) {
          Object.assign(row, data)
          return { count: 1 }
        }
        return { count: 0 }
      }),
    },
  }
}

const actor = { id: 'u-1', role: 'operator' as const, tenantId: 't-1' }
const tool = { schema: { parse: (x: unknown) => x }, execute: vi.fn(async () => ({ done: true })) }

describe('ApprovalService.execute（v3 防护）', () => {
  let audit: any
  beforeEach(() => {
    audit = { record: vi.fn(async () => {}) }
    tool.execute.mockClear()
  })

  it('参数篡改被拦截（TOCTOU）', async () => {
    const args = { anomalyId: 'a-123' }
    const prisma = makeFakePrisma({
      id: 'ap-1', action: 'changeAnomalyStatus',
      argsJson: JSON.stringify({ anomalyId: 'a-999' }), // 已被篡改
      argsHash: hashArgs(args), // 但哈希还是原来的
      status: ApprovalStatus.approved,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const svc = new ApprovalService(prisma as any, { get: () => tool } as any, { canDecide: () => ({ ok: true }) } as any, audit)
    await expect(svc.execute('ap-1', actor, 't-1')).rejects.toThrow('tampering')
    expect(tool.execute).not.toHaveBeenCalled()
  })

  it('租约过期被拦截', async () => {
    const args = { anomalyId: 'a-123' }
    const prisma = makeFakePrisma({
      id: 'ap-1', action: 'changeAnomalyStatus',
      argsJson: JSON.stringify(args), argsHash: hashArgs(args),
      status: ApprovalStatus.approved,
      leaseExpiresAt: new Date(Date.now() - 1000), // 已过期
    })
    const svc = new ApprovalService(prisma as any, { get: () => tool } as any, { canDecide: () => ({ ok: true }) } as any, audit)
    await expect(svc.execute('ap-1', actor, 't-1')).rejects.toThrow('expired')
    expect(tool.execute).not.toHaveBeenCalled()
  })

  it('并发双执行只成功一次（CAS）', async () => {
    const args = { anomalyId: 'a-123' }
    const prisma = makeFakePrisma({
      id: 'ap-1', action: 'changeAnomalyStatus',
      argsJson: JSON.stringify(args), argsHash: hashArgs(args),
      status: ApprovalStatus.approved,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const svc = new ApprovalService(prisma as any, { get: () => tool } as any, { canDecide: () => ({ ok: true }) } as any, audit)
    const [r1, r2] = await Promise.allSettled([
      svc.execute('ap-1', actor, 't-1'),
      svc.execute('ap-1', actor, 't-1'),
    ])
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled').length
    expect(ok).toBe(1)
    expect(tool.execute).toHaveBeenCalledTimes(1)
  })
})
```

### 5.4 v3 用到的知识点

#### 知识点 1：HITL（Human-in-the-loop）—— 高风险操作的人工闸门

- **解决的问题**：Agent 自主循环会生成写操作（改状态、重启、删除），完全自动化一旦模型判断错误就是生产事故；HITL 在"提议"和"执行"之间插入人工批准闸门
- **运行机制**：Agent Loop 遇到写 Tool 不直接执行，而是 `propose` 创建 pending 审批 + 推 `approval.required` 事件；用户批准后才 `execute`
- **项目落点**：`approval.service.ts` 的 `propose` / `decide` / `execute` 三段式
- **生产误区**：把批准状态放前端（隐藏按钮不是授权）；把 propose 和 execute 合成一个接口（失去人工闸门）；审批粒度太粗（把 10 个操作打包成一次批准，用户无法逐条判断）
- **验证方法**：不走 decide 直接调 execute，断言 409；越权 actor 调 decide 断言 403

#### 知识点 2：服务端权威（Server-authoritative Authorization）

- **解决的问题**：前端隐藏/禁用按钮只是 UX，攻击者可以直接构造 HTTP 请求绕过；授权判定必须在服务端
- **运行机制**：`AuthorizationGuard.canDecide` 在服务端校验 actor 的 role/tenant；actor 从 token 解析（不信任 body 里的 actorId）
- **项目落点**：`guard/authorization.guard.ts`；controller 从 `req.actor` 拿身份而不是 body
- **生产误区**：从请求 body 读 actorId（攻击者随便填）；只在 controller 校验漏了 service 的其他入口；viewer 能调 execute
- **验证方法**：12 类越权语料（跨租户、viewer 提权、伪造 actorId）全部 403

#### 知识点 3：TOCTOU（Time-of-check to Time-of-use）参数篡改

- **解决的问题**：用户批准时看到参数 A，执行时参数变成 B——检查时刻和使用时刻之间参数被改
- **运行机制**：`propose` 时把参数哈希 `argsHash` 固化；`execute` 时重新哈希当前参数比对，不一致拒绝
- **项目落点**：`hash/args-hash.ts` 的 `stableStringify` + `hashArgs`；`execute` 检查 3
- **生产误区**：直接 `JSON.stringify` 不排序（key 顺序不同误判篡改）；哈希里含时间戳/盐（每次都不同）；只比对参数不固化快照
- **验证方法**：`args-hash.spec.ts` 断言 key 顺序无关；service spec 制造篡改断言 409 且 Tool 未执行

#### 知识点 4：审批租约（Approval Lease）

- **解决的问题**：批准后长时间不执行，环境已变（服务器已恢复），执行就是误操作
- **运行机制**：`decide` 批准时算 `leaseExpiresAt = decidedAt + 10min`；`execute` 校验未过期，过期转 `expired` 状态并 410
- **项目落点**：`contract/approval-lease.ts` 纯函数；`execute` 检查 2
- **生产误区**：租约时间读系统时钟不可测；过期不改状态（下次还能试）；租约太长（等于没有）
- **验证方法**：mock `now` 为过期后时间断言 410；`approval-lease.ts` 单测边界

#### 知识点 5：CAS 一次性消费（Compare-And-Swap）

- **解决的问题**：`if (status === approved) then update` 是"检查后执行"竞态，并发下两个请求都通过检查、都执行
- **运行机制**：用 `updateMany where: { status: approved }` 原子地"抢占"，返回 `count`；count=1 说明抢到，count=0 说明已被别人消费
- **项目落点**：`execute` 检查 4 的 `updateMany` + `claimed.count === 0` 判断
- **生产误区**：先 `findUnique` 判断再 `update`（非原子）；用应用层锁（多实例失效）；不检查 count 直接执行
- **验证方法**：`Promise.allSettled` 并发两个 execute 断言只成功一次、Tool 只执行一次

#### 知识点 6：审批审计流水（Approval Audit Trail）

- **解决的问题**：误操作事故复盘需要完整决策链——谁在何时基于什么参数做了什么决定、被哪个防护拦截
- **运行机制**：`ApprovalAuditService.record` 在 propose/approve/reject/execute/各类拒绝时写一条不可变流水
- **项目落点**：`audit/approval-audit.service.ts`；service 每个关键分支都 `await audit.record`
- **生产误区**：只记成功不记拒绝（拦截了篡改却没留证据）；审计和业务同事务（审计失败回滚业务，本末倒置）；审计可被 update/delete
- **验证方法**：执行一次篡改攻击后查 `approvalAudit` 表应有 `execute_denied_tampered` 一条

### 5.5 边写边问自己

- `args-hash.ts` 为什么必须先 key 排序再哈希？（对象 key 顺序不保证，不排序会把语义相同的参数误判为篡改）
- 租约计算为什么是纯函数、传入 `now`？（不读系统时钟才能单测过期边界；生产里由 service 传 `new Date()`）
- CAS 的 `updateMany` 为什么比 `update` 安全？（`updateMany` 带 where 条件是数据库层原子操作，两个并发请求只有一个能匹配到 status=approved）
- actor 为什么从 token 解析而不是 body？（body 可被攻击者任意构造，token 由服务端签发不可伪造）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 前端确认弹窗后直接执行 | 服务端 propose/decide/execute 三段式 + 授权 | + 参数快照哈希 + 租约 + CAS + 审计 |
| **授权位置** | 前端（隐藏按钮） | 服务端 Guard（role/tenant） | 同 v2，全入口覆盖 |
| **执行入口** | 前端点击即调 Tool | 必须先 approved 才能 execute | 同 v2 + 4 道执行前检查 |
| **TOCTOU 防护** | 无 | 无（参数可被改） | argsHash 快照比对 |
| **过期控制** | 无 | 无（批准永久有效） | leaseExpiresAt + 410 |
| **并发双执行** | 可能多次 | 可能（检查后执行竞态） | CAS updateMany 一次性消费 |
| **审计** | 无 | 仅状态字段 | 完整决策流水（含拒绝） |
| **越权测试** | 全部能绕过 | 403 拦截 | 403 + 篡改/过期/重复无副作用 |
| **对齐后续 Day** | — | Day 30 M3 门禁基础 | Day 61-90 多 Agent 协同审批地基 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的核心逻辑在后端（审批权威、TOCTOU、CAS），但前端确认 UI 也有必须补的底子。配套深挖文档 `Day17深挖-前端底子补弱.html` 展开以下主题：

- **深挖 1：确认弹窗的 `<dialog>` 元素与焦点陷阱** —— 从 `ApprovalDialog.vue` 讲起。原生 `<dialog>` 的 `showModal()` 如何自动做焦点陷阱、`Esc` 关闭、`::backdrop` 遮罩，为什么手写 `div + position:fixed` 弹窗会漏掉键盘可访问性。
- **深挖 2：按钮的乐观 UI 与"执行中"防重复点击** —— 从执行按钮的 `disabled` 状态机讲起。为什么"点击后立即 disabled"不够（网络往返期间用户可能已经通过其他 tab 提交），前端乐观锁和后端 CAS 是纵深防御的两层。
- **深挖 3：`aria-live` 审批结果播报** —— 批准/拒绝/过期三种结果如何通过 `role="status"` / `role="alert"` 让屏幕阅读器用户感知。

深挖文档只讲原理和反例，不含动手脚手架（脚手架在 §1.5）。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按第 5.3 节的代码，完成三个测试文件：

- `hash/args-hash.spec.ts`（5 个用例：key 顺序无关、嵌套无关、值敏感、数组敏感、确定性）
- `contract/approval-lease.spec.ts`（3 个用例：未过期、刚好过期、已过期边界）
- `approval.service.spec.ts`（核心 3 个用例：TOCTOU 篡改拦截、租约过期拦截、并发 CAS 只成功一次）

运行：

```bash
pnpm --filter api test approval
```

预期：11 个用例全绿，特别是并发用例 `tool.execute` 只被调用一次。

### 7.7 F-1：反证实验 1（5 分钟）—— 去掉参数快照哈希

临时注释掉 `execute` 里的检查 3（参数哈希比对），然后：

1. propose 一个 `changeAnomalyStatus(anomalyId=a-123)`
2. 批准
3. 执行前手动 `UPDATE approvals SET args_json='{"anomalyId":"a-999"}' WHERE id='ap-1'`
4. 执行

观察：Tool 会对 `a-999`（用户从未批准的资源）执行成功。这就是 TOCTOU 漏洞的真实样子。恢复检查 3 后同样操作应返回 409。

### 7.8 F-2：反证实验 2（5 分钟）—— 去掉 CAS 改用检查后执行

临时把 `execute` 检查 4 的 `updateMany` 换成 `if (status===approved) { ...update... }` 非原子写法，然后用两个并发请求同时 execute 同一个 approval：

```bash
# 两个请求几乎同时打
curl -X POST /approval/ap-1/execute & curl -X POST /approval/ap-1/execute &
```

观察：Tool 被执行两次（例如告警被 resolve 两次、审计出现两条 executed）。恢复 CAS 后同样并发只成功一次。

### 7.9 F-3：验证 + 提交（10 分钟）

四件套：

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test && pnpm --filter api build
```

全绿后提交（Conventional Commits）：

```
feat(approval): server-authoritative HITL with TOCTOU/lease/CAS guards

- propose/decide/execute 三段式，授权在服务端 Guard
- argsHash 参数快照防 TOCTOU 篡改
- leaseExpiresAt 审批租约，过期 410
- CAS updateMany 一次性消费防并发双执行
- ApprovalAudit 完整决策流水

Refs: Day17
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day18 结束时集中 push。

---

## 8. 通过标准

- [ ] 未批准直接 execute 返回 409，未批准执行数为 0
- [ ] 越权 actor（跨租户 / viewer / 伪造 actorId）调 decide/execute 全部 403
- [ ] 参数篡改（DB 里 args 与 argsHash 不符）execute 返回 409，Tool 未执行
- [ ] 租约过期 execute 返回 410，状态转 expired
- [ ] 并发两个 execute 同一 approval 只成功一次，Tool 只执行一次
- [ ] `approvalAudit` 表对每一步（含各类拒绝）都有流水
- [ ] 四件套全绿，commit 含 `Refs: Day17`，未执行 `git push`

---

## 9. 提交物

- commit（含上述 message 模板）
- 测试输出（`pnpm --filter api test approval` 全绿截图或日志）
- 学习日志（记录 propose/decide/execute 三段式的设计取舍）
- 架构证据：审批状态图（pending→approved→executed/expired，rejected 终态）+ 威胁模型表（越权/篡改/过期/重复四类攻击 → 对应防护）
- AI Review 记录（哪些 UI/样板接受了 AI 生成、哪些授权逻辑拒绝了 AI 生成并说明理由）

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"Human-in-the-loop"的数据流或控制流；当天知识链"HITL、服务端授权、TOCTOU、审批租约、幂等"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（参数快照哈希 / CAS），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明"未批准执行数为 0、同 approval 只成功一次"已经达到；再说明当前实现距离企业生产标准还缺什么（例如多级审批、审批委托、审计防篡改签名），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. Agent 提议把 anomaly 改为 `resolved`，前端按钮隐藏但攻击者直接调用执行接口，未批准操作成功。请用 actor、approvalId、授权日志和 DB 变更定位；先关闭写 Tool 止损，再把批准与执行放到服务端并验证租户/角色，越权测试必须全部 403。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S30 OWASP GenAI](https://genai.owasp.org/)
2. 用户批准时看到参数 A，审批后模型把 serverId 换成 B；两个浏览器标签又同时提交，导致跨资源执行两次。请用审批快照、租约版本和幂等键证明 TOCTOU；先撤销未执行租约止损，再做参数哈希、过期检查和一次性消费，验证篡改、过期、重复均无副作用。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)

知识映射：HITL、服务端授权、TOCTOU、审批租约与幂等。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. Agent 工具调用展示组件如何支持人工确认（Human-in-the-loop）并处理工具失败？
   来源：[《2026微信读书前端面试-agent方向》](<../../资源/2026微信读书前端面试-agent方向.pdf>)，第 7 页。
2. AI 产品中如何处理幻觉或错误信息对用户体验的影响？
   来源：[《2026阿里妈妈高级前端工程师-AI产品方向》](<../../资源/2026阿里妈妈高级前端工程师-AI产品方向.pdf>)，第 9 页。

题目说明：对应 HITL、敏感操作确认和错误兜底；第二题原文答案明确要求高风险操作增加人工确认。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 11 Tool Registry（写 Tool 的 Schema/审计）、Day 12 Agent Loop（循环遇到写 Tool 时暂停）、Day 13 持久化幂等（审批记录落库）
- **本日**：把"高风险写操作"从 Agent 自动执行改造为服务端权威的人工审批闸门，抵御越权/TOCTOU/过期/并发四类攻击
- **对齐后续**：
  - Day 30 M3 门禁会要求"任何写操作都必须有服务端审批 + 审计链路"
  - Day 61-90 p2-agent-workbench 多 Agent 协同时，审批租约和 CAS 一次性消费是多 Agent 抢占同一资源的基础
- **能力跃迁**：从"前端弹窗确认"（UX 级）跃迁到"服务端权威审批 + 纵深防御"（安全工程级）
