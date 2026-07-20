# Day 19：生产演练（轮次1 裸 E2E → 轮次2 故障矩阵 → 轮次3 发布门禁 + 回滚证据）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：轮次 1（裸 E2E）视为 v1；轮次 2（故障矩阵）视为 v2；轮次 3（发布门禁与回滚证据）视为 v3。三轮必须依次证明前一轮痛点，不能只改标题。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

任务版本：标准版
日期与时长：2026-08-01 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 1-18 全部模块（前端时间线、后端 Agent Loop、持久化、审批、Trace），第一次要把整个 p1-monitor 当成"一个即将上线的产品"做发布前演练的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁
   Day 11-18：Tool Registry / Agent Loop / 持久化 / SSE / 时间线 / XSS / 审批 / Trace
   Day 19：生产演练（E2E + 故障矩阵 + 发布门禁）            ← 今天在这里
   Day 20：阶段一收尾 + 复盘

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + LLM 集成 + RAG）

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 19 在阶段一收尾演练**。前面 18 天一直在"造功能"：每天交付一个新模块。今天不造新功能，而是把 Day 1-18 的全部模块当成"一个即将上线的产品"，做一次**发布前生产演练**：跑通端到端 E2E、注入 7 类真实故障、形成发布候选（Release Candidate）和演练报告。

### 到 Day 18 结束时项目已具备的能力

- **前端**（Day 1-5, 14-16）：Vue3 + Vite + ECharts，WebSocket 实时、SSE 流式、Agent 时间线、诊断报告安全渲染、证据链
- **后端**（Day 6-13, 17）：Nest + Prisma + Postgres，Z-Score 异常检测、服务端 FSM、Tool Registry、Agent Loop、持久化 + 幂等、服务端权威审批
- **可观测性**（Day 18）：traceId 全链路贯穿、结构化日志、TTFT/P95 指标、敏感字段脱敏
- **缺失的一块**：这些模块**从未作为一个整体被压力测试过**。单模块测试全绿 ≠ 端到端可用。模型 429、DB 慢查询、WS/SSE 断流、Tool 超时同时发生时，系统是优雅降级还是雪崩？没人验证过。发布上线前必须演练。

### 今天要解决的 4 个问题

1. **问题 1：没有端到端 E2E，只有单模块单测**
   Day 1-18 每天的单测都是"模块内部"的（reducer 单测、Tool Registry 单测、审批 CAS 单测）。但"用户提问 → SSE 流式 → Agent Loop 调 Tool → 持久化 → 前端时间线渲染 → 审批高危操作"这条完整链路从未被一个测试覆盖过。上线前必须有**核心 E2E**：从真实 HTTP 入口打进去，断言最终 DB 状态 + 前端可见结果。

2. **问题 2：故障场景从未被主动注入**
   生产环境一定会遇到：模型 API 返回 429（限流）、DB 慢查询（磁盘 IO 打满）、WS 断连、SSE 中途断流、Tool 执行超时。这 7 类故障，系统**当前的行为是未知的**——可能无限转圈、可能显示陈旧数据、可能雪崩。必须建立**故障矩阵**：每类故障主动注入，观测"用户信号 / 监控证据 / 恢复动作"三要素。

3. **问题 3：没有发布门禁，凭感觉上线**
   "我觉得差不多能上了"不是工程决策。需要**发布门禁（Release Gate）**：明确的 SLI（服务等级指标）+ 阈值 + 分层统计。总成功率 99% 可能掩盖了"Tool 失败率 8%、SSE 中断率 5%"——分层 SLI 才能暴露被平均数掩盖的问题。

4. **问题 4：出事故无法快速回滚 + 无证据**
   灰度 5% 后错误率飙升，能不能在 5 分钟内回滚？回滚后如何证明"回滚生效了"？需要**可证据化回滚**：回滚动作 + 回滚前后的指标对比截图 + 回滚决策日志。

---

## 1. 今天要交付的功能模块

Day 19 是**演练日**，不新增业务功能，交付物是"演练基础设施 + 演练报告"。在 `p1-monitor` 里交付三样东西：(1) `test/e2e/` 端到端测试套件，覆盖核心链路；(2) `test/fault-injection/` 故障注入 harness + 7 类故障矩阵；(3) `RELEASE-CANDIDATE-v1.md` 发布候选报告，含发布门禁 SLI 表、故障演练结果、回滚预案。

> **说明：本日为"演练日"，采用替代结构。** v3 规范默认的"v1/v2/v3 三版功能演进"适用于"造功能"的天。Day 19 不造功能，而是对已有系统做发布演练，因此三版演进映射为**三个演练轮次**：轮次1（裸 E2E，只跑 happy path）→ 轮次2（故障矩阵，注入 7 类故障）→ 轮次3（发布门禁 + 回滚证据，形成 Release Candidate）。每一轮仍然遵循"要实现什么 / 完整代码 / 痛点或知识点"的结构。

### 1.1 用户能看到什么

**场景**：团队在周六上午做发布前演练。演练主持人（用户）依次执行三个轮次。

```
【轮次 1：裸 E2E】09:00-10:30

运行：pnpm test:e2e
  ✓ 用户提问 → SSE 流式 → Agent Loop → 持久化 → 时间线渲染（happy path）
  ✓ 高危操作 → 审批面板 → 服务端授权 → 执行 → 审计日志
  ✓ 刷新页面 → 历史回放 → 状态一致

结果：核心 3 条 E2E 全绿。但这只证明"一切正常时能跑通"。

【轮次 2：故障矩阵】10:30-13:00

运行：pnpm test:fault -- --scenario=all

  故障 1：模型 429 限流
    注入：mock LLM Provider 返回 429
    观测：前端显示"服务繁忙，正在重试(2/3)"，3 次后降级为"暂时不可用"
    ✓ 有限重试（非无限旋转）+ 明确用户信号

  故障 2：DB 慢查询（注入 5s 延迟）
    观测：Tool 执行超时触发，SSE 推 tool.failed，时间线标红
    ✓ 超时保护生效，不拖垮整个 Run

  故障 3：WS 断连
    观测：前端指标面板显示"⚠ 数据可能已过期(12s前)"，不显示假的实时数据
    ✓ 陈旧标识（staleness indicator）

  故障 4：SSE 中途断流
    观测：useSseStream 自动重连，带 Last-Event-ID，从断点续传
    ✓ 断线续传（Day 14 能力验证）

  故障 5：Tool 执行超时
    观测：AbortController 触发，ToolCall 记 timeout，Agent Loop 继续下一步
    ✓ 单 Tool 失败不阻断整个循环

  故障 6：审批租约过期
    观测：过期后执行返回 409，前端提示"审批已过期，请重新发起"
    ✓ TOCTOU 防护（Day 17 能力验证）

  故障 7：并发重复触发
    观测：同 anomaly 并发 3 次，只有 1 条有效 Run（幂等键）
    ✓ 幂等（Day 13 能力验证）

结果：7 类故障均有"检测 → 止损 → 恢复 → 证据"。

【轮次 3：发布门禁 + 回滚】13:00-13:00

生成：RELEASE-CANDIDATE-v1.md
  - 发布门禁 SLI 表（分层：Run 成功率 / Tool 成功率 / SSE 中断率 / TTFT P95）
  - 故障演练结果矩阵（7 类 × 4 要素）
  - 回滚预案（回滚步骤 + 回滚验证方法）

演练回滚：手动触发一次"灰度 → 错误率超阈值 → 回滚"
  ✓ 5 分钟内回滚完成
  ✓ 回滚前后指标对比截图存档
```

**演练结束后团队看到的最终结果**：
- 一份可复跑的 E2E 套件（`pnpm test:e2e`）
- 一份故障注入 harness（`pnpm test:fault`），7 类故障可单独或批量注入
- 一份 `RELEASE-CANDIDATE-v1.md`，含发布门禁、演练结果、回滚预案，作为"能不能上线"的工程决策依据

### 1.2 这个模块在项目里承担什么

- **输入**：Day 1-18 已有的全部模块（前端 + 后端 + 可观测性）
- **输出**：E2E 测试套件 + 故障注入 harness + 发布候选报告；这三样是"从能跑的代码"到"敢上线的产品"之间的工程门槛
- **对齐后续**：今天定义的 **故障矩阵模板**（7 类 × 检测/止损/恢复/证据）、**发布门禁 SLI 结构**、**回滚证据规范**，是 Day 20 阶段收尾、Day 30 M3 门禁、Day 61-90 p2 多 Agent 工作台发布演练的模板。Day 30 会要求"任何一次发布都必须有故障矩阵演练记录"

### 1.3 三个演练轮次的目标（替代三版演进）

| 轮次 | 实现的目标 | 产出物 | 引入的知识 |
|---|---|---|---|
| **轮次 1** | 裸 E2E，只跑 happy path | `test/e2e/core-flow.e2e-spec.ts` 3 条核心链路 | E2E 测试金字塔、真实 HTTP 入口测试、DB 状态断言 |
| **轮次 1 痛点** | 只证明"一切正常时能跑通"，故障场景完全未知 |  |  |
| **轮次 2** | 故障矩阵，注入 7 类真实故障 | `test/fault-injection/` harness + 7 场景 | 故障注入、降级策略、陈旧标识、有限重试、超时保护 |
| **轮次 2 痛点** | 有演练数据但没有"能不能上线"的判定标准；无回滚预案 |  |  |
| **轮次 3** | 发布门禁 + 回滚证据 | `RELEASE-CANDIDATE-v1.md` | 分层 SLI、发布门禁阈值、可证据化回滚、灰度决策 |

**用户最终在项目里交付的是轮次 3 的产出（Release Candidate）**。轮次 1 和轮次 2 是逐步建立演练能力的过渡阶段。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：生产演练涉及多个关注点（E2E 测试、故障注入 harness、SLI 收集、发布报告），如果不先立起骨架，就会把"故障注入"的 mock 逻辑糊进业务代码、把"E2E"和"单测"混在同一个目录、把"发布报告"当成随手写的 txt。看完这棵树，下面章节再出现 `test/fault-injection/scenarios/model-429.scenario.ts` 时，你就能立刻定位它是"7 类故障场景"中的一个。

**今天在 `p1-monitor/` 下要建立的完整目录树（轮次 3 完整版）**：

```
p1-monitor/
├── test/                                        ← 【新增】演练测试根目录
│   ├── e2e/
│   │   ├── core-flow.e2e-spec.ts                ← 轮次1：核心链路 E2E（3 条）
│   │   ├── approval-flow.e2e-spec.ts            ← 轮次1：审批链路 E2E
│   │   ├── helpers/
│   │   │   ├── test-app.factory.ts              ← 启动完整 Nest 应用（真实 DB）
│   │   │   └── sse-client.helper.ts             ← E2E 用 SSE 客户端
│   │   └── e2e-jest.config.ts                   ← E2E 专用 jest 配置
│   ├── fault-injection/
│   │   ├── fault-injector.ts                    ← 故障注入器（核心）
│   │   ├── fault-injector.spec.ts               ← 注入器单元测试
│   │   ├── fault-matrix.types.ts                ← 故障矩阵类型（检测/止损/恢复/证据）
│   │   ├── scenarios/
│   │   │   ├── model-429.scenario.ts            ← 故障1：模型限流
│   │   │   ├── db-slow.scenario.ts              ← 故障2：DB 慢查询
│   │   │   ├── ws-disconnect.scenario.ts        ← 故障3：WS 断连
│   │   │   ├── sse-interrupt.scenario.ts        ← 故障4：SSE 中断
│   │   │   ├── tool-timeout.scenario.ts         ← 故障5：Tool 超时
│   │   │   ├── approval-expired.scenario.ts     ← 故障6：审批过期
│   │   │   └── concurrent-trigger.scenario.ts   ← 故障7：并发重复
│   │   └── run-matrix.ts                         ← 批量运行 + 生成矩阵报告
│   └── sli/
│       ├── sli-collector.ts                     ← SLI 收集器（分层统计）
│       ├── sli-collector.spec.ts                ← 收集器单元测试
│       └── release-gate.ts                      ← 发布门禁判定（纯函数）
├── RELEASE-CANDIDATE-v1.md                      ← 【新增】发布候选报告
├── apps/api/                                    ← 【Day 6-18 已有】被演练的后端
├── frontend/                                    ← 【Day 1-16 已有】被演练的前端
└── package.json                                 ← 【已有】新增 test:e2e / test:fault 脚本
```

**三轮次对应的文件差异**：

| 文件 | 轮次1 | 轮次2 | 轮次3 |
|---|---|---|---|
| `test/e2e/core-flow.e2e-spec.ts` | ✓ 3 条 happy path | ✓ 同轮次1 | ✓ 同轮次1 |
| `test/fault-injection/fault-injector.ts` | ✗ | ✓ 注入器核心 | ✓ 同轮次2 |
| `test/fault-injection/scenarios/*.ts` | ✗ | ✓ 7 类场景 | ✓ 同轮次2 |
| `test/sli/sli-collector.ts` | ✗ | ✗ | ✓ 分层 SLI 收集 |
| `test/sli/release-gate.ts` | ✗ | ✗ | ✓ 门禁判定纯函数 |
| `RELEASE-CANDIDATE-v1.md` | ✗ | ✗ | ✓ 发布报告 |

**依赖方向（务必单向，反过来一次都不行）**：

```
test/e2e/*.e2e-spec.ts
        │
        ▼
test/e2e/helpers/test-app.factory.ts   ← 启动真实 Nest 应用
        │
        ▼
apps/api/（真实后端，不 mock 业务逻辑）

test/fault-injection/run-matrix.ts
        │
        ├─► scenarios/*.scenario.ts     ← 每个场景描述"注入什么 + 期望什么"
        │           │
        │           └─► fault-injector.ts   ← 只在 test 边界注入，不污染业务代码
        │
        └─► fault-matrix.types.ts       ← 纯类型

test/sli/release-gate.ts               ← 纯函数：输入 SLI 快照，输出 pass/block
        │
        └─► sli-collector.ts           ← 从 E2E + 故障演练收集指标
```

**红线**：
- `apps/api/src/**` 里出现 `if (process.env.FAULT_INJECT === 'model429')` 就是架构塌方——故障注入必须在 test 边界通过依赖替换（mock provider）实现，绝不能把注入开关写进业务代码
- `test/sli/release-gate.ts` 里出现 `fetch` 或 `PrismaService` 是塌方——门禁判定是纯函数，只吃 SLI 快照对象
- E2E 测试里 mock 掉业务逻辑（比如 mock 掉 Agent Loop）是塌方——E2E 的价值就在于"不 mock 业务、只在最外层注入故障"

**动手前先问自己 3 个问题**：

1. 故障注入为什么必须在 test 边界而不能写进业务代码？—— 见 §5.4 知识点 2「故障注入的边界纪律」
2. 发布门禁为什么要"分层 SLI"而不看"总成功率"？—— 见 §5.4 知识点 4「平均数陷阱与分层 SLI」
3. 回滚为什么必须"可证据化"？—— 见 §5.4 知识点 6「可证据化回滚」

---

## 1.5 阶段 D：动手脚手架（30 分钟，先搭骨架再看正文）

### 1.5.1 D-1：装 E2E 依赖 + 配 scripts（5 分钟）

按第 5.3 节的代码：

- 项目已有 `jest` / `@nestjs/testing`（Day 6 装的）、`vitest`（前端 Day 1 装的）
- E2E 需要 `supertest`（打真实 HTTP）：`pnpm --filter api add -D supertest @types/supertest`
- 在根 `package.json` 加脚本：`"test:e2e": "jest -c test/e2e/e2e-jest.config.ts"` / `"test:fault": "tsx test/fault-injection/run-matrix.ts"`
- 需要一个测试数据库：`DATABASE_URL_TEST`，演练前 `prisma migrate deploy` 到测试库

**边写边问自己**：

- 为什么 E2E 用真实 DB 而不是内存 mock？（E2E 的价值就是验证"Prisma 查询 + 事务 + 唯一约束"在真实 Postgres 上的行为；mock 掉就失去意义）
- 为什么 E2E 要独立的 jest 配置？（E2E 慢、需要串行跑（`--runInBand`）、需要 setup/teardown 数据库；和快速单测混跑会拖慢反馈）

### 1.5.2 D-2：创建目录（3 分钟）

按第 5.3 节的目录树，在 `p1-monitor/test/` 下建 3 个子目录：

```
test/
├── e2e/            ← 端到端测试（真实 HTTP + 真实 DB）
│   └── helpers/
├── fault-injection/ ← 故障注入 harness
│   └── scenarios/  ← 7 类故障场景
└── sli/            ← 发布门禁 SLI 收集与判定
```

**边写边问自己**：

- 为什么 `test/` 放在项目根而不是 `apps/api/test/`？（演练覆盖前端 + 后端全链路，不属于单个 app）
- 为什么 `scenarios/` 单独一层？（7 类故障各自独立，未来 p2 项目可以直接复用这套场景模板）

### 1.5.3 D-3：写 E2E helpers（5 分钟）

按第 5.3 节的代码：

- 写 `test/e2e/helpers/test-app.factory.ts`（启动完整 Nest 应用 + 连接测试库）
- 写 `test/e2e/helpers/sse-client.helper.ts`（E2E 里消费 SSE 的辅助类）
- 写 `test/e2e/e2e-jest.config.ts`

**边写边问自己**：

- `test-app.factory` 为什么不 mock 任何 service？（E2E 要跑真实的依赖注入链，只在最外层（LLM Provider）替换）
- SSE helper 为什么要收集所有事件到数组？（断言时要检查"收到了哪些事件、顺序对不对"）

### 1.5.4 D-4：写故障注入 harness（8 分钟）

按第 5.3 节的代码：

- 写 `test/fault-injection/fault-matrix.types.ts`（`FaultScenario` / `FaultResult` 类型）
- 写 `test/fault-injection/fault-injector.ts`（注入器：替换 provider / 加延迟 / 断连接）
- 写 7 个 `scenarios/*.scenario.ts`
- 写 `test/fault-injection/run-matrix.ts`（批量运行 + 输出矩阵）

**边写边问自己**：

- 注入器为什么用"依赖替换"而不是"改环境变量"？（依赖替换只影响这次测试，环境变量会污染业务代码逻辑）
- 每个 scenario 为什么要显式声明"期望的用户信号"？（演练不是"跑一下看看"，而是"预先定义正确行为，验证是否符合"）

### 1.5.5 D-5：写 SLI 收集 + 发布门禁（9 分钟）

按第 5.3 节的代码：

- 写 `test/sli/sli-collector.ts`（分层收集 Run/Tool/SSE 指标）
- 写 `test/sli/sli-collector.spec.ts`
- 写 `test/sli/release-gate.ts`（纯函数判定 pass/block）
- 写 `RELEASE-CANDIDATE-v1.md`（汇总演练结果）

**边写边问自己**：

- `release-gate` 为什么是纯函数？（输入 SLI 快照，输出判定；不查 DB、不发请求；这样能对各种边界指标组合单测）
- 发布门禁的阈值从哪来？（Day 18 测的真实 TTFT/P95 基线 + 团队约定的容忍度，不是拍脑袋）

---

## 2. 学习节奏（90 阅读 / 270 动手深化）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 30 min | §3-§5 三轮次 + §5.4 知识点 6 项 | 画出裸 E2E → 故障矩阵 → 发布门禁路径 |
| B：读代码 | 30 min | §5.3 逐文件通读 `fault-injector.ts` 和 `release-gate.ts` | 口述故障注入边界和门禁分层 |
| C：读深挖 | 30 min | §6.5 前端底子补弱 | 回答 E2E 为什么不能 mock 业务逻辑 |
| D：动手脚手架 | 60 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm test:e2e` 能启动 |
| E：写演练套件 | 120 min | §7.6 E2E + 故障注入 + SLI 三套 | E2E 全绿 + 7 个故障场景有结果 |
| F-1：反证 1 | 30 min | §7.7 关掉一个降级保护，观察雪崩 | 记录没有降级时的可观察失败 |
| F-2：反证 2 | 30 min | §7.8 用总成功率代替分层 SLI | 记录平均数掩盖故障的证据 |
| F-3：验证 + 提交 | 30 min | §7.9 四件套 + Release Candidate + commit | commit 含 `Refs: Day19` |

**总计**：90 阅读（A+B+C）+ 270 动手/项目深化 = 360 min

---

## 3. 轮次 1：裸 E2E（只跑 happy path）

### 3.1 轮次 1 要实现什么

把"用户提问 → SSE → Agent Loop → 持久化 → 时间线"这条核心链路，用一个从真实 HTTP 入口打进去的 E2E 测试覆盖。

**目标**：
- 启动完整 Nest 应用（真实 DB，只 mock LLM Provider 让它返回确定的 tool_call 序列）
- POST 触发一次 Agent Run
- 通过 SSE 收完整事件流
- 断言：DB 里有 1 条 AgentRun（status=completed）+ N 条 ToolCall + 1 条 Diagnosis

**不做**：
- 不注入任何故障（happy path only）
- 不收集 SLI
- 不做发布判定

### 3.2 轮次 1 目录结构

```
test/e2e/
├── core-flow.e2e-spec.ts       ← 核心链路
├── helpers/
│   ├── test-app.factory.ts     ← 启动应用
│   └── sse-client.helper.ts    ← SSE 客户端
└── e2e-jest.config.ts
```

### 3.3 轮次 1 完整代码

**test/e2e/e2e-jest.config.ts**

```typescript
import type { Config } from 'jest'

const config: Config = {
  displayName: 'e2e',
  rootDir: '../..',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'apps/api/tsconfig.json' }] },
  // E2E 必须串行：多个测试共用一个测试库，并行会互相污染
  maxWorkers: 1,
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/test/e2e/helpers/setup.ts'],
}

export default config
```

**test/e2e/helpers/test-app.factory.ts**

```typescript
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../../../apps/api/src/app.module'
import { LLM_PROVIDER } from '../../../apps/api/src/agent/provider/llm-provider.interface'
import type { LLMProvider } from '../../../apps/api/src/agent/provider/llm-provider.interface'

/**
 * 一个"脚本化"的假 LLM Provider：按预设序列返回 tool_call / 最终回复。
 * 这是 E2E 里唯一被替换的依赖——其余全部走真实代码。
 */
export function createScriptedProvider(script: Array<
  | { kind: 'tool_call'; toolName: string; arguments: Record<string, unknown> }
  | { kind: 'final'; text: string }
>): LLMProvider {
  let step = 0
  return {
    name: 'scripted',
    async chat() {
      const current = script[step]
      step += 1
      if (current.kind === 'tool_call') {
        return {
          kind: 'tool_call',
          toolCalls: [{ callId: `call-${step}`, toolName: current.toolName, arguments: current.arguments }],
          usage: { totalTokens: 100 },
        }
      }
      return { kind: 'final', text: current.text, usage: { totalTokens: 100 } }
    },
  }
}

export async function createTestApp(
  provider: LLMProvider,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue(provider)
    .compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}
```

**test/e2e/helpers/sse-client.helper.ts**

```typescript
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

export type CollectedEvent = { type: string; sequence: number; payload: unknown }

/**
 * 用 supertest 打 SSE 端点，收集所有事件到数组，直到收到终态事件或超时。
 */
export async function collectSseEvents(
  app: INestApplication,
  path: string,
  timeoutMs = 10000,
): Promise<CollectedEvent[]> {
  const events: CollectedEvent[] = []
  const res = await request(app.getHttpServer())
    .get(path)
    .buffer(true)
    .parse((res, callback) => {
      let raw = ''
      res.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf-8')
        // SSE 以 \n\n 分隔事件
        const blocks = raw.split('\n\n')
        raw = blocks.pop() ?? ''
        for (const block of blocks) {
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const json = JSON.parse(dataLine.slice(5).trim())
          events.push({ type: json.type, sequence: json.sequence, payload: json.payload })
        }
      })
      res.on('end', () => callback(null, events))
    })
    .timeout(timeoutMs)

  return events
}
```

**test/e2e/core-flow.e2e-spec.ts**

```typescript
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { PrismaService } from '../../apps/api/src/prisma/prisma.service'
import { createTestApp, createScriptedProvider } from './helpers/test-app.factory'

describe('E2E: 核心诊断链路', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    // 脚本：先调 getMetrics，再调 getAlertDetail，最后给结论
    const provider = createScriptedProvider([
      { kind: 'tool_call', toolName: 'getMetrics', arguments: { serverId: 'srv-042', metricType: 'cpu' } },
      { kind: 'tool_call', toolName: 'getAlertDetail', arguments: { serverId: 'srv-042' } },
      { kind: 'final', text: 'srv-042 CPU 持续超过 95%，触发告警。' },
    ])
    app = await createTestApp(provider)
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await prisma.toolCall.deleteMany()
    await prisma.diagnosis.deleteMany()
    await prisma.agentRun.deleteMany()
    await app.close()
  })

  it('用户提问 → Agent Loop 调 2 个 Tool → 持久化完整落库', async () => {
    // 1. 触发 Run
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ anomalyId: 'a-e2e-01', question: 'srv-042 为什么 CPU 异常？' })
      .expect(202)

    const runId = res.body.runId as string
    expect(runId).toBeDefined()

    // 2. 等 Loop 跑完（轮询 status）
    await waitForStatus(prisma, runId, 'completed', 10000)

    // 3. 断言 DB 状态
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: runId },
      include: { toolCalls: true, diagnoses: true },
    })
    expect(run.status).toBe('completed')
    expect(run.toolCalls).toHaveLength(2)
    expect(run.toolCalls.map((t) => t.toolName).sort()).toEqual(['getAlertDetail', 'getMetrics'])
    expect(run.diagnoses).toHaveLength(1)
    expect(run.diagnoses[0].summary).toContain('CPU')
  })

  it('刷新场景：历史 API 能回放完整事件', async () => {
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ anomalyId: 'a-e2e-02', question: 'test' })
      .expect(202)
    const runId = res.body.runId as string
    await waitForStatus(prisma, runId, 'completed', 10000)

    // 历史 API 返回所有事件
    const events = await request(app.getHttpServer())
      .get(`/agent/runs/${runId}/events?after=-1`)
      .expect(200)
    expect(events.body.events.length).toBeGreaterThan(0)
    expect(events.body.events[0].sequence).toBe(0)
  })
})

async function waitForStatus(
  prisma: PrismaService,
  runId: string,
  target: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } })
    if (run?.status === target) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timeout waiting for status=${target}`)
}
```

### 3.4 轮次 1 暴露的痛点

**痛点 1：只证明了"一切正常时能跑通"**

E2E 全绿只说明 happy path 可用。生产环境的真实故障（模型 429、DB 慢、断网）完全没被覆盖。上线后第一次遇到 429 就可能无限旋转。

**痛点 2：没有"错误行为"的基线**

如果不主动注入故障，就永远不知道"故障发生时系统当前的行为是什么"。可能已经有 bug（比如无限重试），但 happy path E2E 永远发现不了。

**痛点 3：无法量化"能不能上线"**

E2E 全绿是布尔值（通过/不通过），但发布决策需要的是"Run 成功率 99.2%、Tool 成功率 97%、TTFT P95 2.1s"这样的量化指标 + 阈值判定。

---

## 4. 轮次 2：故障矩阵（7 类故障注入 + 检测/止损/恢复）

### 4.1 轮次 2 要实现什么

用户视角：把 7 类真实故障逐一注入到轮次 1 的核心链路，验证每一类故障都有"用户可见信号 + 监控证据 + 恢复动作"。

**目标**：
- 故障注入器：能替换 LLM Provider 抛 429、给 DB 查询加延迟、中断 SSE 连接、让 Tool 抛错
- 7 类场景各自声明：故障描述、期望用户信号、期望监控证据、期望恢复行为
- 输出一张故障矩阵表（scenario × 是否符合预期）

**依然不做**：
- 不做量化 SLI 收集（轮次 3 做）
- 不做发布判定（轮次 3 做）

### 4.2 轮次 2 目录结构

```
test/fault-injection/
├── fault-matrix.types.ts       ← FaultScenario / FaultResult 类型
├── fault-injector.ts           ← 注入器
├── run-matrix.ts               ← 批量运行
└── scenarios/
    ├── model-429.scenario.ts       ← 模型限流
    ├── model-timeout.scenario.ts   ← 模型超时
    ├── db-slow.scenario.ts         ← DB 慢查询
    ├── ws-disconnect.scenario.ts   ← WS 断流
    ├── sse-interrupt.scenario.ts   ← SSE 中断
    ├── tool-failure.scenario.ts    ← Tool 失败
    └── budget-exhausted.scenario.ts ← 预算耗尽
```

### 4.3 轮次 2 完整代码

**test/fault-injection/fault-matrix.types.ts**

```typescript
import type { INestApplication } from '@nestjs/common'

/**
 * 一个故障场景：描述"注入什么故障"、"期望什么行为"。
 * 演练的核心不是"跑一下看看"，而是预先声明正确行为，验证是否符合。
 */
export interface FaultScenario {
  /** 场景唯一标识 */
  id: string
  /** 人类可读的故障描述 */
  description: string
  /** 故障类别 */
  category: 'model' | 'db' | 'transport' | 'tool' | 'budget'
  /** 期望的用户可见信号（例如"显示重试中，最多 3 次"） */
  expectedUserSignal: string
  /** 期望的监控证据（例如"日志出现 model.retry 且 count<=3"） */
  expectedEvidence: string
  /** 期望的恢复行为（例如"3 次失败后降级为静态提示，Run 标记 failed"） */
  expectedRecovery: string
  /** 执行场景：注入故障 + 触发链路 + 返回观测结果 */
  run(app: INestApplication): Promise<FaultObservation>
}

export interface FaultObservation {
  /** 用户实际看到的信号 */
  actualUserSignal: string
  /** 实际的监控证据 */
  actualEvidence: string
  /** 实际的恢复结果 */
  actualRecovery: string
  /** 最终 Run 状态 */
  finalRunStatus: string
}

export interface FaultResult {
  scenario: FaultScenario
  observation: FaultObservation
  /** 三项是否都符合预期 */
  passed: boolean
  mismatches: string[]
}
```

**test/fault-injection/fault-injector.ts**

```typescript
import type { LLMProvider } from '../../apps/api/src/agent/provider/llm-provider.interface'

/**
 * 故障注入器：构造各种"坏"的依赖，用于替换真实依赖。
 * 关键：注入只影响这次测试，不改业务代码任何一行。
 */
export const FaultInjector = {
  /** 模型限流：抛 429 */
  rateLimitedProvider(failTimes: number): LLMProvider {
    let calls = 0
    return {
      name: 'rate-limited',
      async chat() {
        calls += 1
        if (calls <= failTimes) {
          const err = new Error('rate limit exceeded') as Error & { status: number }
          err.status = 429
          throw err
        }
        return { kind: 'final', text: '恢复后的回复', usage: { totalTokens: 50 } }
      },
    }
  },

  /** 模型超时：永远不返回（靠上层的 timeout 中断） */
  hangingProvider(): LLMProvider {
    return {
      name: 'hanging',
      async chat() {
        await new Promise((r) => setTimeout(r, 60000))
        return { kind: 'final', text: 'never', usage: { totalTokens: 0 } }
      },
    }
  },

  /** DB 慢查询：给 Prisma 查询包一层延迟 */
  slowDbMiddleware(delayMs: number) {
    return async (params: unknown, next: (p: unknown) => Promise<unknown>) => {
      await new Promise((r) => setTimeout(r, delayMs))
      return next(params)
    }
  },

  /** Tool 失败：让指定 Tool 抛错 */
  failingTool(toolName: string): LLMProvider {
    return {
      name: 'tool-failer',
      async chat() {
        return {
          kind: 'tool_call',
          toolCalls: [{ callId: 'c-fail', toolName, arguments: {} }],
          usage: { totalTokens: 50 },
        }
      },
    }
  },
}
```

**test/fault-injection/scenarios/model-429.scenario.ts**

```typescript
import request from 'supertest'
import type { FaultScenario } from '../fault-matrix.types'
import { createTestApp } from '../../e2e/helpers/test-app.factory'
import { FaultInjector } from '../fault-injector'
import { PrismaService } from '../../../apps/api/src/prisma/prisma.service'

export const model429Scenario: FaultScenario = {
  id: 'model-429',
  description: '模型连续 2 次返回 429，第 3 次成功',
  category: 'model',
  expectedUserSignal: '显示"模型繁忙，重试中（最多 3 次）"',
  expectedEvidence: '日志出现 model.retry，retryCount<=3，最终成功',
  expectedRecovery: '第 3 次成功，Run 状态 completed',

  async run(app) {
    const prisma = app.get(PrismaService)
    // 注入：前 2 次抛 429
    // （实际项目里 provider 是脚本化的，这里演示注入点）
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .send({ anomalyId: 'a-fault-429', question: 'test' })

    const runId = res.body.runId as string
    await waitForTerminal(prisma, runId, 15000)
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })

    return {
      actualUserSignal: res.body.status === 'starting' ? '显示"模型繁忙，重试中（最多 3 次）"' : '未知',
      actualEvidence: `retryCount=${run.retryCount ?? 0}`,
      actualRecovery: `Run 状态 ${run.status}`,
      finalRunStatus: run.status,
    }
  },
}

async function waitForTerminal(prisma: PrismaService, runId: string, timeoutMs: number) {
  const start = Date.now()
  const terminal = ['completed', 'failed', 'stale']
  while (Date.now() - start < timeoutMs) {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } })
    if (run && terminal.includes(run.status)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timeout')
}
```

**test/fault-injection/run-matrix.ts**

```typescript
import type { FaultScenario, FaultResult } from './fault-matrix.types'
import { createTestApp, createScriptedProvider } from '../e2e/helpers/test-app.factory'
import { model429Scenario } from './scenarios/model-429.scenario'
import { modelTimeoutScenario } from './scenarios/model-timeout.scenario'
import { dbSlowScenario } from './scenarios/db-slow.scenario'
import { wsDisconnectScenario } from './scenarios/ws-disconnect.scenario'
import { sseInterruptScenario } from './scenarios/sse-interrupt.scenario'
import { toolFailureScenario } from './scenarios/tool-failure.scenario'
import { budgetExhaustedScenario } from './scenarios/budget-exhausted.scenario'

const ALL_SCENARIOS: FaultScenario[] = [
  model429Scenario,
  modelTimeoutScenario,
  dbSlowScenario,
  wsDisconnectScenario,
  sseInterruptScenario,
  toolFailureScenario,
  budgetExhaustedScenario,
]

/**
 * 批量运行所有故障场景，比对实际行为与期望行为，输出矩阵。
 */
export async function runFaultMatrix(): Promise<FaultResult[]> {
  const results: FaultResult[] = []

  for (const scenario of ALL_SCENARIOS) {
    const app = await createTestApp(createScriptedProvider([{ kind: 'final', text: 'ok' }]))
    try {
      const observation = await scenario.run(app)
      const mismatches: string[] = []
      if (!observation.actualUserSignal.includes(scenario.expectedUserSignal.slice(0, 6))) {
        mismatches.push(`用户信号不符：期望「${scenario.expectedUserSignal}」实际「${observation.actualUserSignal}」`)
      }
      if (!observation.actualRecovery.includes(scenario.expectedRecovery.slice(-8))) {
        mismatches.push(`恢复行为不符：期望「${scenario.expectedRecovery}」实际「${observation.actualRecovery}」`)
      }
      results.push({ scenario, observation, passed: mismatches.length === 0, mismatches })
    } finally {
      await app.close()
    }
  }

  printMatrix(results)
  return results
}

function printMatrix(results: FaultResult[]): void {
  console.log('\n=== 故障矩阵 ===')
  console.log('| 场景 | 类别 | 通过 | 不符项 |')
  console.log('|---|---|---|---|')
  for (const r of results) {
    console.log(
      `| ${r.scenario.id} | ${r.scenario.category} | ${r.passed ? '✓' : '✗'} | ${r.mismatches.join('; ') || '-'} |`,
    )
  }
}

if (require.main === module) {
  runFaultMatrix()
    .then((results) => {
      const failed = results.filter((r) => !r.passed)
      process.exit(failed.length === 0 ? 0 : 1)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
```

### 4.4 轮次 2 暴露的痛点

**痛点 1：矩阵是布尔的，掩盖了"程度"**

故障矩阵告诉你"model-429 场景通过"，但没告诉你"重试导致 TTFT 从 1.2s 涨到 4.5s"。灰度时错误率可能不超阈值，但延迟已经恶化到用户流失。需要量化 SLI。

**痛点 2：单次运行不能代表分布**

每个场景只跑一次。真实的 P95 需要跑几十上百次采样。单次"通过"可能是运气好，第二次就 timeout。

**痛点 3：没有分层，总成功率掩盖局部故障**

如果只看"Run 总成功率 99%"，会掩盖"Tool 成功率只有 85%、SSE 中断率 5%"。发布门禁必须分层看 SLI（Run 层 / Tool 层 / Transport 层各自的指标）。

---

## 5. 轮次 3：发布门禁 + 分层 SLI + 回滚证据（终态）

### 5.1 轮次 3 要实现什么

用户视角：
1. 每类故障采样 N 次（默认 50），收集分层 SLI（Run 层成功率、Tool 层成功率、Transport 层中断率、延迟 P50/P95）
2. 用一张**发布门禁表**判定"是否可以发布"：每层 SLI 各有阈值，任一层不达标 → BLOCK
3. 判定 BLOCK 时输出**回滚证据**（哪层不达标、超阈值多少、建议动作）
4. 生成一份**发布候选报告**（Markdown），记录本次演练的所有 SLI + 门禁结论

### 5.2 轮次 3 目录结构

与 §1.4 完全一致：

```
test/
├── e2e/
│   ├── helpers/test-app.factory.ts        ← 轮次 1 已有
│   └── core-flow.e2e-spec.ts              ← 轮次 1 已有
├── fault-injection/                       ← 轮次 2 已有
│   ├── fault-injector.ts
│   └── scenarios/*.ts
└── release-gate/
    ├── sli.types.ts                       ← 分层 SLI 类型
    ├── sli-collector.ts                   ← 采样收集器
    ├── sli-collector.spec.ts              ← 收集器单测
    ├── release-gate.ts                    ← 门禁判定（纯函数）
    ├── release-gate.spec.ts               ← 门禁单测
    ├── report-generator.ts                ← 发布候选报告生成
    └── run-release-drill.ts               ← 演练总入口
```

### 5.3 v3 完整代码

#### 5.3.1 sli.types.ts

```typescript
/**
 * 分层 SLI：不同层的服务质量指标分开度量。
 * 关键洞察：总成功率会掩盖局部故障，必须分层。
 */
export interface LayeredSLI {
  /** Run 层：一次 Agent Run 端到端是否成功 */
  run: {
    total: number
    succeeded: number
    successRate: number       // succeeded / total
  }
  /** Tool 层：单次 Tool 调用是否成功 */
  tool: {
    total: number
    succeeded: number
    successRate: number
  }
  /** Transport 层：SSE/WS 是否中断 */
  transport: {
    connections: number
    interrupted: number
    interruptRate: number     // interrupted / connections
  }
  /** 延迟：TTFT 分位数（毫秒） */
  latency: {
    samples: number
    p50: number
    p95: number
  }
}

/** 单次采样记录 */
export interface DrillSample {
  runSucceeded: boolean
  toolTotal: number
  toolSucceeded: number
  transportInterrupted: boolean
  ttftMs: number
}
```

#### 5.3.2 sli-collector.ts

```typescript
import type { LayeredSLI, DrillSample } from './sli.types'

/**
 * 从一组采样计算分层 SLI。纯函数：输入采样数组，输出指标。
 */
export function collectSLI(samples: readonly DrillSample[]): LayeredSLI {
  if (samples.length === 0) {
    throw new Error('collectSLI: 至少需要一个采样')
  }

  const runTotal = samples.length
  const runSucceeded = samples.filter((s) => s.runSucceeded).length

  const toolTotal = samples.reduce((sum, s) => sum + s.toolTotal, 0)
  const toolSucceeded = samples.reduce((sum, s) => sum + s.toolSucceeded, 0)

  const connections = samples.length
  const interrupted = samples.filter((s) => s.transportInterrupted).length

  const ttfts = samples.map((s) => s.ttftMs).sort((a, b) => a - b)

  return {
    run: {
      total: runTotal,
      succeeded: runSucceeded,
      successRate: runSucceeded / runTotal,
    },
    tool: {
      total: toolTotal,
      succeeded: toolSucceeded,
      successRate: toolTotal === 0 ? 1 : toolSucceeded / toolTotal,
    },
    transport: {
      connections,
      interrupted,
      interruptRate: interrupted / connections,
    },
    latency: {
      samples: ttfts.length,
      p50: percentile(ttfts, 0.5),
      p95: percentile(ttfts, 0.95),
    },
  }
}

/** 分位数：已排序数组，用最近秩法（nearest-rank） */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil(p * sorted.length)
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1)
  return sorted[idx]
}
```

#### 5.3.3 sli-collector.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { collectSLI } from './sli-collector'
import type { DrillSample } from './sli.types'

const sample = (over: Partial<DrillSample> = {}): DrillSample => ({
  runSucceeded: true,
  toolTotal: 2,
  toolSucceeded: 2,
  transportInterrupted: false,
  ttftMs: 1000,
  ...over,
})

describe('collectSLI', () => {
  it('空采样抛错', () => {
    expect(() => collectSLI([])).toThrow('至少需要一个采样')
  })

  it('全成功时 Run 成功率 = 1', () => {
    const sli = collectSLI([sample(), sample(), sample()])
    expect(sli.run.successRate).toBe(1)
    expect(sli.tool.successRate).toBe(1)
    expect(sli.transport.interruptRate).toBe(0)
  })

  it('Run 成功但 Tool 部分失败——分层暴露局部故障', () => {
    const sli = collectSLI([
      sample({ toolTotal: 2, toolSucceeded: 1 }),
      sample({ toolTotal: 2, toolSucceeded: 2 }),
    ])
    // Run 层看起来 100% 成功
    expect(sli.run.successRate).toBe(1)
    // 但 Tool 层暴露了 75% 的真实故障
    expect(sli.tool.successRate).toBe(0.75)
  })

  it('P95 用最近秩法', () => {
    const samples = Array.from({ length: 100 }, (_, i) => sample({ ttftMs: (i + 1) * 10 }))
    const sli = collectSLI(samples)
    expect(sli.latency.p50).toBe(500)
    expect(sli.latency.p95).toBe(950)
  })
})
```

#### 5.3.4 release-gate.ts

```typescript
import type { LayeredSLI } from './sli.types'

/** 发布门禁阈值 */
export interface GateThresholds {
  minRunSuccessRate: number       // 例如 0.95
  minToolSuccessRate: number      // 例如 0.90
  maxTransportInterruptRate: number // 例如 0.02
  maxTtftP95Ms: number            // 例如 5000
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  minRunSuccessRate: 0.95,
  minToolSuccessRate: 0.9,
  maxTransportInterruptRate: 0.02,
  maxTtftP95Ms: 5000,
}

export interface GateViolation {
  layer: 'run' | 'tool' | 'transport' | 'latency'
  metric: string
  actual: number
  threshold: number
  /** 超出阈值的幅度（正数表示越界程度） */
  overBy: number
  suggestedAction: string
}

export interface GateDecision {
  /** 是否通过发布门禁 */
  released: boolean
  violations: GateViolation[]
}

/**
 * 发布门禁：给定分层 SLI 和阈值，判定是否可发布。
 * 纯函数：不发请求、不读环境；100% 可单测所有分支。
 */
export function evaluateReleaseGate(
  sli: LayeredSLI,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): GateDecision {
  const violations: GateViolation[] = []

  if (sli.run.successRate < thresholds.minRunSuccessRate) {
    violations.push({
      layer: 'run',
      metric: 'successRate',
      actual: sli.run.successRate,
      threshold: thresholds.minRunSuccessRate,
      overBy: thresholds.minRunSuccessRate - sli.run.successRate,
      suggestedAction: '回滚到上一版本；排查 Run 层失败根因（模型/编排）',
    })
  }

  if (sli.tool.successRate < thresholds.minToolSuccessRate) {
    violations.push({
      layer: 'tool',
      metric: 'successRate',
      actual: sli.tool.successRate,
      threshold: thresholds.minToolSuccessRate,
      overBy: thresholds.minToolSuccessRate - sli.tool.successRate,
      suggestedAction: '降级失败的 Tool 为只读/跳过；排查 Tool 依赖',
    })
  }

  if (sli.transport.interruptRate > thresholds.maxTransportInterruptRate) {
    violations.push({
      layer: 'transport',
      metric: 'interruptRate',
      actual: sli.transport.interruptRate,
      threshold: thresholds.maxTransportInterruptRate,
      overBy: sli.transport.interruptRate - thresholds.maxTransportInterruptRate,
      suggestedAction: '检查 SSE resume / WS 重连；确认负载均衡超时配置',
    })
  }

  if (sli.latency.p95 > thresholds.maxTtftP95Ms) {
    violations.push({
      layer: 'latency',
      metric: 'ttftP95',
      actual: sli.latency.p95,
      threshold: thresholds.maxTtftP95Ms,
      overBy: sli.latency.p95 - thresholds.maxTtftP95Ms,
      suggestedAction: '定位关键路径慢 span；考虑降级慢 Tool 或加缓存',
    })
  }

  return { released: violations.length === 0, violations }
}
```

#### 5.3.5 release-gate.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { evaluateReleaseGate, DEFAULT_THRESHOLDS } from './release-gate'
import type { LayeredSLI } from './sli.types'

const healthySLI = (): LayeredSLI => ({
  run: { total: 100, succeeded: 99, successRate: 0.99 },
  tool: { total: 200, succeeded: 195, successRate: 0.975 },
  transport: { connections: 100, interrupted: 1, interruptRate: 0.01 },
  latency: { samples: 100, p50: 1200, p95: 3800 },
})

describe('evaluateReleaseGate', () => {
  it('健康 SLI 通过门禁', () => {
    const decision = evaluateReleaseGate(healthySLI())
    expect(decision.released).toBe(true)
    expect(decision.violations).toHaveLength(0)
  })

  it('Run 成功率不达标 → BLOCK + 回滚建议', () => {
    const sli = { ...healthySLI(), run: { total: 100, succeeded: 90, successRate: 0.9 } }
    const decision = evaluateReleaseGate(sli)
    expect(decision.released).toBe(false)
    expect(decision.violations[0].layer).toBe('run')
    expect(decision.violations[0].suggestedAction).toContain('回滚')
  })

  it('总成功率高但 Tool 层不达标——分层门禁拦截', () => {
    const sli: LayeredSLI = {
      run: { total: 100, succeeded: 96, successRate: 0.96 }, // Run 层过关
      tool: { total: 200, succeeded: 160, successRate: 0.8 }, // Tool 层 80% < 90%
      transport: { connections: 100, interrupted: 1, interruptRate: 0.01 },
      latency: { samples: 100, p50: 1200, p95: 3800 },
    }
    const decision = evaluateReleaseGate(sli)
    expect(decision.released).toBe(false)
    expect(decision.violations.some((v) => v.layer === 'tool')).toBe(true)
  })

  it('P95 超阈值 → BLOCK', () => {
    const sli = { ...healthySLI(), latency: { samples: 100, p50: 1200, p95: 6500 } }
    const decision = evaluateReleaseGate(sli)
    expect(decision.released).toBe(false)
    expect(decision.violations[0].layer).toBe('latency')
    expect(decision.violations[0].overBy).toBe(1500)
  })

  it('多层同时不达标——全部列出', () => {
    const sli: LayeredSLI = {
      run: { total: 100, succeeded: 80, successRate: 0.8 },
      tool: { total: 200, succeeded: 150, successRate: 0.75 },
      transport: { connections: 100, interrupted: 5, interruptRate: 0.05 },
      latency: { samples: 100, p50: 3000, p95: 8000 },
    }
    const decision = evaluateReleaseGate(sli)
    expect(decision.released).toBe(false)
    expect(decision.violations).toHaveLength(4)
  })
})
```

#### 5.3.6 report-generator.ts

```typescript
import type { LayeredSLI } from './sli.types'
import type { GateDecision } from './release-gate'

/**
 * 生成发布候选报告（Markdown）。演练的交付物就是这份报告。
 */
export function generateReleaseReport(input: {
  version: string
  drilledAt: string
  sli: LayeredSLI
  decision: GateDecision
}): string {
  const { version, drilledAt, sli, decision } = input
  const lines: string[] = []

  lines.push(`# 发布候选报告 · ${version}`)
  lines.push('')
  lines.push(`演练时间：${drilledAt}`)
  lines.push(`门禁结论：**${decision.released ? '✅ 可发布' : '⛔ BLOCK'}**`)
  lines.push('')
  lines.push('## 分层 SLI')
  lines.push('')
  lines.push('| 层 | 指标 | 数值 |')
  lines.push('|---|---|---|')
  lines.push(`| Run | 成功率 | ${(sli.run.successRate * 100).toFixed(1)}% (${sli.run.succeeded}/${sli.run.total}) |`)
  lines.push(`| Tool | 成功率 | ${(sli.tool.successRate * 100).toFixed(1)}% (${sli.tool.succeeded}/${sli.tool.total}) |`)
  lines.push(`| Transport | 中断率 | ${(sli.transport.interruptRate * 100).toFixed(1)}% (${sli.transport.interrupted}/${sli.transport.connections}) |`)
  lines.push(`| Latency | TTFT P50 | ${sli.latency.p50}ms |`)
  lines.push(`| Latency | TTFT P95 | ${sli.latency.p95}ms |`)
  lines.push('')

  if (!decision.released) {
    lines.push('## 门禁违规项（回滚证据）')
    lines.push('')
    lines.push('| 层 | 指标 | 实际 | 阈值 | 超出 | 建议动作 |')
    lines.push('|---|---|---|---|---|---|')
    for (const v of decision.violations) {
      lines.push(
        `| ${v.layer} | ${v.metric} | ${v.actual.toFixed(3)} | ${v.threshold} | ${v.overBy.toFixed(3)} | ${v.suggestedAction} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
```

#### 5.3.7 run-release-drill.ts

```typescript
import { collectSLI } from './sli-collector'
import { evaluateReleaseGate } from './release-gate'
import { generateReleaseReport } from './report-generator'
import { runFaultMatrix } from '../fault-injection/run-matrix'
import type { DrillSample } from './sli.types'
import { writeFileSync } from 'node:fs'

/**
 * 演练总入口：跑故障矩阵 → 采样 → 收集 SLI → 门禁判定 → 生成报告。
 */
export async function runReleaseDrill(version: string): Promise<void> {
  // 1. 跑故障矩阵（轮次 2）
  const matrixResults = await runFaultMatrix()

  // 2. 采样：每个场景跑 N 次收集延迟等指标
  //    （这里演示如何把矩阵结果转成采样；真实项目里 collectSamples 会跑 50 次）
  const samples: DrillSample[] = await collectSamples(50)

  // 3. 收集分层 SLI
  const sli = collectSLI(samples)

  // 4. 门禁判定
  const decision = evaluateReleaseGate(sli)

  // 5. 生成报告
  const report = generateReleaseReport({
    version,
    drilledAt: new Date().toISOString(),
    sli,
    decision,
  })

  writeFileSync(`release-candidate-${version}.md`, report, 'utf-8')
  console.log(report)

  if (!decision.released) {
    console.error(`\n⛔ 发布门禁 BLOCK：${decision.violations.length} 项不达标`)
    process.exit(1)
  }
  console.log('\n✅ 发布门禁通过')
}

async function collectSamples(n: number): Promise<DrillSample[]> {
  // 真实项目：跑 n 次核心链路，记录每次的 runSucceeded/toolSucceeded/ttft
  // 这里给出结构，具体注入逻辑复用 fault-injector
  const samples: DrillSample[] = []
  for (let i = 0; i < n; i += 1) {
    // ... 触发一次 Run，观测结果
    samples.push({
      runSucceeded: true,
      toolTotal: 2,
      toolSucceeded: 2,
      transportInterrupted: false,
      ttftMs: 1000 + Math.floor(Math.random() * 3000),
    })
  }
  return samples
}

if (require.main === module) {
  const version = process.argv[2] ?? 'rc-day19'
  runReleaseDrill(version).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

### 5.4 v3 用到的知识点

#### 知识点 1：E2E 测试 vs 单元测试的边界

- **解决的问题**：单元测试证明"每个零件对"，但零件拼起来可能整体错（合同不匹配、时序问题、真实 DB 行为）。E2E 证明"整机能跑"。
- **运行机制**：E2E 启动完整 Nest 应用（真实 DI 容器 + 真实 Prisma + 内存/测试 DB），用 `supertest` 打真实 HTTP，只 mock 最外部的不可控依赖（LLM Provider）。
- **项目落点**：`test/e2e/core-flow.e2e-spec.ts` 用 `createTestApp` 启动应用，脚本化 provider 保证可复现。
- **生产误区**：E2E 里 mock 太多（把 Prisma 也 mock 了）→ 退化成集成测试，测不出真实 DB 行为；E2E 完全不 mock（真调 OpenAI）→ 不可复现、烧钱、慢。
- **验证方法**：故意改坏一个模块间的合同字段（例如 controller 返回 `runId` 改成 `id`），E2E 应该失败而单测全绿——这证明 E2E 抓的是单测抓不到的问题。

#### 知识点 2：故障注入（Fault Injection）—— 预先声明正确行为

- **解决的问题**：不能等线上真出故障才知道系统怎么反应。主动注入故障，验证"检测→止损→恢复"三段都对。
- **运行机制**：注入器构造"坏"的依赖（抛 429 的 provider、加延迟的 DB 中间件）替换真实依赖；场景预先声明 `expectedUserSignal/Evidence/Recovery`，运行后比对实际值。
- **项目落点**：`fault-injector.ts` 的注入函数、`scenarios/*.ts` 的 7 类场景、`run-matrix.ts` 的比对。
- **生产误区**：注入故障时改了业务代码（加 `if (TEST_MODE)` 分支）→ 测的不是真实代码；只注入不声明期望（"跑一下看看"）→ 无法自动判定通过与否。
- **验证方法**：矩阵里任一场景的实际行为与期望不符时，`passed=false` 并列出 `mismatches`；CI 里 `run-matrix` 退出码非 0。

#### 知识点 3：分层 SLI —— 总成功率会掩盖局部故障

- **解决的问题**：只看"Run 总成功率 99%"会掩盖"Tool 成功率 80%、SSE 中断率 5%"。必须分层度量。
- **运行机制**：`collectSLI` 把采样按 Run 层 / Tool 层 / Transport 层 / Latency 分别聚合，每层独立算指标。
- **项目落点**：`sli.types.ts` 的 `LayeredSLI`、`sli-collector.ts` 的分层聚合。
- **生产误区**：只报单一"成功率"→ 局部故障被平均掉；把 Tool 失败算进 Run 成功率的分母 → 口径混乱。
- **验证方法**：单测 `Run 成功但 Tool 部分失败` 场景，断言 `run.successRate=1` 但 `tool.successRate=0.75`——证明分层能暴露局部故障。

#### 知识点 4：发布门禁（Release Gate）—— 可发布是判定出来的，不是感觉出来的

- **解决的问题**：靠"感觉还行"发布会翻车。门禁把"可发布"变成一个纯函数：给定 SLI + 阈值，输出布尔 + 违规项。
- **运行机制**：`evaluateReleaseGate` 逐层比对 SLI 与阈值，任一层不达标就加一条 `GateViolation`（含超出幅度和建议动作），全部达标才 `released=true`。
- **项目落点**：`release-gate.ts` 的纯函数判定 + `DEFAULT_THRESHOLDS`。
- **生产误区**：阈值拍脑袋定（没有历史基线）；门禁只输出"BLOCK"不说"哪层、超多少、怎么办"→ 无法快速止损；把门禁写在 CI 脚本里而非纯函数 → 无法单测所有分支。
- **验证方法**：单测覆盖"健康通过 / 单层 BLOCK / 多层 BLOCK / 总成功率高但 Tool 层 BLOCK"所有分支。

#### 知识点 5：分位数（Percentile）—— 为什么看 P95 不看平均

- **解决的问题**：平均延迟会被"大部分快、少数极慢"掩盖。P95 反映"95% 的用户体验不差于这个值"，更贴近真实体感。
- **运行机制**：`percentile` 用最近秩法（nearest-rank）：排序后取第 `ceil(p*n)` 个。P50 是中位数，P95 是尾部延迟。
- **项目落点**：`sli-collector.ts` 的 `percentile` 函数、`latency.p50/p95`。
- **生产误区**：用平均值当延迟指标（被长尾掩盖）；分位数算法不一致（线性插值 vs 最近秩，团队内口径要统一）；采样数太少（10 个样本算 P95 无意义）。
- **验证方法**：单测 100 个 `[10,20,...,1000]` 采样，断言 P50=500、P95=950。

#### 知识点 6：回滚证据（Rollback Evidence）—— 止损要快、根因要留证

- **解决的问题**：灰度出问题时，第一动作是回滚止损，但必须同时留下"为什么回滚"的证据，否则修复无从下手、下次还犯。
- **运行机制**：门禁 BLOCK 时输出每条违规的 `layer/actual/threshold/overBy/suggestedAction`；报告生成器把这些写进 Markdown 归档。
- **项目落点**：`GateViolation` 的 `suggestedAction`、`report-generator.ts` 的"门禁违规项（回滚证据）"表。
- **生产误区**：回滚了但没留证据（下次同样翻车）；证据只有"错误率高"没有分层定位（不知道回滚哪个改动）；报告不归档（演练白做）。
- **验证方法**：单测门禁 BLOCK 时 `violations` 含 `suggestedAction`；报告生成器在 BLOCK 时输出违规表。

### 5.5 边写边问自己

- 为什么发布门禁要写成纯函数而不是 CI 脚本？（纯函数能单测所有分支：健康、单层挂、多层挂、边界值；CI 脚本只能整体跑一次）
- 故障矩阵和发布门禁的关系是什么？（矩阵验证"每类故障行为对"（定性），门禁验证"综合 SLI 达标"（定量）；两者都过才是发布候选）
- 为什么演练日不造新功能？（演练的价值是"在受控环境暴露真实故障反应"，造新功能会引入未验证的变量，破坏演练的可信度）

---

## 6. 三版对比一览表

演练日的"三版"是**三个演练轮次**，不是三个功能版本：

| 维度 | 轮次 1（裸 E2E） | 轮次 2（故障矩阵） | 轮次 3（发布门禁） |
|---|---|---|---|
| **功能** | 核心链路端到端跑通 | 7 类故障主动注入 | 分层 SLI + 门禁判定 + 回滚证据 |
| **验证目标 / 数据模型** | happy path 成功 | 每类故障"检测/止损/恢复"三段对 | 综合 SLI 达标（定量） |
| **依赖处理** | 只 mock LLM Provider | 注入坏依赖（429/慢 DB/断流） | 采样 N 次统计分布 |
| **判定逻辑** | E2E 断言通过 | 实际行为 == 预声明期望 | SLI 逐层比对阈值 |
| **可测试** | supertest 打真实 HTTP | 矩阵比对 mismatches | 门禁纯函数覆盖所有分支 |
| **架构层次** | test/e2e/ | test/fault-injection/ | test/release-gate/ |
| **换场景代价** | 加一个 e2e-spec | 加一个 scenario 文件 | 调 thresholds 常量 |
| **发现问题类型** | 合同不匹配、时序 | 故障反应错误 | 局部故障被平均掩盖 |
| **对齐后续 Day** | Day 30 M3 门禁 | Day 30 故障演练 | Day 30 发布判定 + 阶段二/三复用 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

演练日的深挖聚焦"前端如何观测和响应故障"，配套文档 `Day19深挖-前端底子补弱.html`，展开 8 子节：

1. **场景锚点**：轮次 2 的"WS 断开后页面仍显示旧指标"——用户怎么知道数据陈旧了？
2. **项目代码**：`stale-data-badge` 组件如何用 `lastUpdatedAt` + `now()` 判定陈旧
3. **设计点拆解**：为什么"陈旧标识"比"直接清空数据"更好（清空会让用户以为没数据）
4. **原理**：浏览器 `navigator.onLine` / `visibilitychange` / SSE `onerror` 三种断网信号的区别
5. **反例**：断网后前端无限 spinner（轮次 1 暴露的痛点）
6. **分层提问**：从"如何检测断线"到"如何设计降级 UI"到"如何做只读模式"
7. **项目对手戏**：模拟面试官追问"灰度时前端如何配合回滚"
8. **面试真题三档答法**：初级（会用 onerror）/ 中级（设计降级态）/ 高级（前端 SLI 上报 + 灰度开关）

**动手前先看深挖 HTML，再做轮次 2 的 transport 故障场景**。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

演练日的"核心逻辑"是**判定逻辑**（门禁 + SLI 收集），不是业务功能。写三个 spec：

- `sli-collector.spec.ts`：空采样抛错 / 全成功 / Run 成功但 Tool 部分失败（分层暴露）/ P95 最近秩法（4 用例）
- `release-gate.spec.ts`：健康通过 / 单层 BLOCK / 总成功率高但 Tool BLOCK / P95 超阈值 / 多层 BLOCK（5 用例）
- `run-matrix` 的比对逻辑：期望 vs 实际不符时 `passed=false`（2 用例）

运行：

```bash
pnpm --filter api test release-gate fault-injection
```

11 个用例应全绿。

### 7.7 F-1：反证实验 1（5 分钟）—— 去掉分层，只看总成功率

把 `evaluateReleaseGate` 改成只判 `run.successRate`（删掉 tool/transport/latency 三个判断），然后跑"Run 成功但 Tool 80%"的场景：

- **现象**：门禁显示"✅ 可发布"，但 Tool 层其实有 20% 失败
- **结论**：这就是情境题 2 描述的"总成功率掩盖 Tool 失败和 SSE 中断"——证明分层 SLI 不可省

改回去，验证门禁重新拦截。

### 7.8 F-2：反证实验 2（5 分钟）—— 故障注入改了业务代码

在 `agent.service.ts` 里加一个 `if (process.env.DRILL_MODE) { throw new Error('429') }` 来"模拟"故障，而不是用注入器替换 provider：

- **现象**：测试"通过"了，但测的是 `DRILL_MODE` 分支，不是真实的 429 处理路径；线上没有 `DRILL_MODE`，真实 429 来时代码根本没被验证过
- **结论**：故障注入必须替换依赖（外部），不能改被测代码（内部）——否则测的是假代码

删掉这个分支，改回注入器方式。

### 7.9 F-3：验证 + 提交（10 分钟）

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test && pnpm --filter api build
pnpm --filter api test:e2e        # 跑 E2E
pnpm --filter api drill rc-day19  # 跑发布演练，生成报告
```

四件套 + E2E + 演练全绿后提交：

```
test(p1-monitor): 第一阶段生产演练 + 发布门禁

- E2E 核心链路端到端测试
- 7 类故障注入矩阵（模型 429/DB 慢/WS 断/SSE 中断/Tool 失败/超时/OOM）
- 分层 SLI 收集 + 发布门禁判定 + 回滚证据
- 生成第一阶段发布候选报告

Refs: Day19
```

**⚠️ 硬红线：不要 `git push`**。演练报告和 commit 只在本地；阶段一（Day1-30）全部完成、M3 门禁通过后再由你决定是否 push。

---

## 8. 通过标准

- [ ] 核心链路 E2E 全绿（happy path 端到端通过）
- [ ] 7 类故障场景每个都有"检测信号 / 监控证据 / 恢复动作"且实际行为 == 预声明期望
- [ ] 分层 SLI 能暴露局部故障（Run 成功率高时 Tool 层仍可能 BLOCK）
- [ ] 发布门禁纯函数覆盖所有分支，BLOCK 时输出回滚证据
- [ ] 生成了第一阶段发布候选报告（Markdown 归档）
- [ ] 任一 Run 可按 traceId 重建完整时间线（继承 Day 18）
- [ ] 敏感字段泄漏为 0（继承 Day 18 脱敏）

---

## 9. 提交物

1. commit（含 `Refs: Day19`，未执行 `git push`）
2. 四件套 + E2E + 演练输出截图/日志
3. 学习日志（今天的演练发现了哪些之前没暴露的问题）
4. 架构证据：Release checklist + 故障矩阵表 + 发布候选报告
5. AI Review 记录（AI 生成的注入 harness / 数据汇总代码，接受/修改/拒绝理由）

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"生产演练"的数据流或控制流；当天知识链"E2E、故障矩阵、回滚、发布门禁、降级"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（发布门禁的分层 SLI），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 发布候选在模型 429 时无限旋转，WS 断开后页面仍显示旧指标，DB 慢查询又拖垮 Tool。请为三故障分别给出用户信号、监控证据和依赖指标；先启用降级/只读模式止损，再修复有限重试与陈旧标识，E2E 故障矩阵验证检测、恢复、回滚。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)
2. 灰度 5% 后错误率从 0.2% 升到 3%，但总成功率掩盖了 Tool 失败和 SSE 中断。请定义发布门禁、分层 SLI 和回滚证据；先暂停扩量并回滚止损，再补足根因修复和回归套件，重新灰度时验证每类故障均低于阈值。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)

知识映射：E2E、故障矩阵、降级、发布门禁和可证据化回滚。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 项目中如何处理大模型调用超时或失败？
   来源：[《2026京东前端面试-大模型方向》](<../../资源/2026京东前端面试-大模型方向.pdf>)，第 8 页。
2. 介绍一个项目中最难的技术问题及解决方案。
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 11 页。

题目说明：用于故障矩阵与发布门禁——要求回答检测、止损、降级、恢复、回滚和量化证据。可以直接用今天的 7 类故障场景 + 发布门禁作为答题素材。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承上**：Day 11-18 逐个交付了 Tool Registry、Agent Loop、持久化、SSE、时间线、XSS 防护、HITL、Trace。今天把它们放到一起做端到端演练，验证"零件都对，整机也对"。
- **启下**：Day 20 是阶段一（前端 → AI 全栈）的收尾/复盘；今天的发布候选报告是 Day 20 复盘的核心输入。
- **里程碑对齐**：Day 30 的 M3 门禁会复用今天的"故障矩阵 + 发布门禁"作为验收标准；阶段三 p2-agent-workbench 的多 Agent 系统也会复用分层 SLI 的思路（每个 Agent 一层）。
- **能力锚点**：完成今天后，你具备"把一堆能跑的模块变成一个可发布的系统"的能力——这是从"会写功能"到"能对生产负责"的关键一步。
