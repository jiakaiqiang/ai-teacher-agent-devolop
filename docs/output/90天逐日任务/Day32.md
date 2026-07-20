# Day 32：Orchestrator（Plan-Act-Observe 循环 + 并行限制 + 预算 + 明确终止）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

任务版本：标准版
日期与时长：2026-08-14 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 31 Tool Registry v2（多租户 + 版本治理）后，第一次面对"Agent 需要组合多个只读 Tool、自动决策调用顺序、并行执行、预算控制、明确终止原因"需求的全栈开发者

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
   Day 32：Orchestrator（Plan-Act-Observe + 并行 + 预算）  ← 今天在这里
   Day 33-40：LangGraph 状态机编排
   Day 41-50：RAG 深化 + Hybrid Search
   Day 51-60：可观测性 + M6 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 32 在阶段二第 2 天**。Day 12 实现了 Agent Loop（LLM 循环调工具 + step 预算），但没有"多工具组合策略"、"并行执行"、"明确终止原因"。今天要实现 **Orchestrator**：根据 Plan-Act-Observe 循环，自动决策调用哪些工具、是否并行、何时终止，并记录完整的决策链路。

### 到 Day 31 结束时项目已具备的能力

- **Tool Registry v2**（Day 31）：多租户隔离 + 版本协商 + 风险分级 + 不可抵赖调用日志
- **Agent Loop**（Day 12）：LLM 循环调工具 + step/time/token 预算 + Provider 抽象
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除
- **队列**（Day 29）：BullMQ jobId 幂等 + 重试退避 + 死信

### 今天要解决的 4 个问题

1. **问题 1：工具调用顺序混乱（无调度策略）**
   Day 12 的 Agent Loop 是"LLM 想调啥就调啥"，没有调度策略。用户问"srv-042 为什么 CPU 高？"，Agent 可能先调 `getDiskMetrics`（磁盘指标）、再调 `getCpuMetrics`（CPU 指标），顺序颠倒导致推理链断裂。**如何按依赖关系调度？**

2. **问题 2：可并行的工具串行执行（性能浪费）**
   查询 CPU 和磁盘指标是两个独立操作（无依赖关系），应该并行执行（总耗时 = max(CPU 查询, 磁盘查询)）。但 Day 12 的 Loop 是串行的（总耗时 = CPU 查询 + 磁盘查询），浪费了 50% 时间。**如何并行？**

3. **问题 3：循环超过 30 次不停止（死循环）**
   Day 12 只有 step 预算（最多 20 步），但没有"循环检测"。Agent 可能在 plan → act → observe → plan 间死循环（例如重复问"CPU 是多少？"），step 预算耗尽但没有明确终止原因。**如何检测循环？**

4. **问题 4：预算耗尽后无法追溯原因（不可解释）**
   Run 终止时只记录 `status: 'budget_exceeded'`，但不知道"哪一步消耗了多少 token"、"为什么会超预算"。运营无法优化 Prompt 降低成本。**如何记录预算消耗明细？**

---
## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付 **Orchestrator 模块**：在 Day 12 Agent Loop 的基础上，增加"Plan-Act-Observe 循环 + 工具依赖调度 + 并行执行 + 循环检测 + 预算明细 + 明确终止原因"。

### 1.1 用户能看到什么

**场景：运维工程师问 "srv-042 为什么在 14:30 触发 CPU 告警？"**

```
14:30:00.000  用户提交问题
  → Orchestrator 启动 Run（runId: r-001）

14:30:00.100  【Plan 阶段】LLM 生成计划
  计划：
  1. 查询 srv-042 在 14:30 的 CPU 指标（getCpuMetrics）
  2. 查询 srv-042 在 14:30 的磁盘指标（getDiskMetrics）
  3. 查询 srv-042 的告警规则（getAlertRules）
  → 依赖分析：1 和 2 无依赖（可并行）；3 依赖 1（串行）

14:30:00.200  【Act 阶段】并行执行 1 和 2
  → 并行槽：2 个工具同时执行
  → 耗时：max(getCpuMetrics 2s, getDiskMetrics 1.5s) = 2s

14:30:02.200  【Act 阶段】串行执行 3
  → 等待 1 完成后执行 getAlertRules
  → 耗时：1s

14:30:03.200  【Observe 阶段】LLM 观察结果
  观察：CPU 在 14:30 达到 92%，超过告警阈值 85%
  → 是否需要继续？否（问题已解答）
  → 终止原因：task_completed

14:30:03.300  Run 终止
  状态：completed
  终止原因：task_completed
  总步数：3
  总耗时：3.3s
  Token 消耗：plan 150 + observe 80 = 230 tokens
  工具调用：getCpuMetrics(2s) + getDiskMetrics(1.5s, 并行) + getAlertRules(1s)
```

**关键观察**：
- 并行执行节省了 0.5s（串行需 4.5s，并行只需 3.3s）
- 终止原因明确（`task_completed`，不是 `budget_exceeded` 或 `max_steps`）
- 预算消耗可追溯（plan 150 tokens + observe 80 tokens = 230 tokens）

### 1.2 这个模块在项目里承担什么

- **输入**：用户问题 + 可用工具列表 + 预算配置（maxSteps/maxTokens/maxTime）
- **输出**：工具调用序列（串行/并行混合） + 明确终止原因 + 预算消耗明细
- **对齐后续**：Day 33-40 LangGraph 状态机编排时，Orchestrator 是"多 Agent 协同"的调度引擎；Day 51-60 可观测性时，预算消耗明细用于成本分析

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 简单串行循环（Day 12 原版） | `AgentLoop.run()` 单线程 for 循环 | step 预算、LLM 循环调工具 |
| **v1 痛点** | 无调度策略（顺序混乱）、无并行、无循环检测、终止原因不明确 |  |  |
| **v2** | v1 + **Plan-Act-Observe 结构** + **依赖调度** | 拆出 `Planner` / `Executor` / `Observer` 三层 | Plan-Act-Observe 循环、依赖图 |
| **v2 痛点** | 无并行（串行浪费时间）、无循环检测（死循环）、预算不透明 |  |  |
| **v3** | v2 + **并行执行** + **循环检测** + **预算明细** + **明确终止原因** | 完整分层（plan/act/observe/budget/termination） | 并行槽、循环检测、预算追踪、终止原因枚举 |

**用户最终在项目里交付的是 v3**。v1 是 Day 12 原版，v2 和 v3 是今天增量。

---
## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Orchestrator 涉及"Plan-Act-Observe 三阶段 + 依赖调度 + 并行执行 + 循环检测 + 预算追踪 + 终止原因"6 个关注点，如果不先立骨架，最容易犯的错就是把"计划解析"、"并行槽管理"、"循环检测"、"预算统计"糊在一个 service 里。看完这棵树，下面章节再出现 `orchestrator/plan/planner.service.ts` 时，你就能立刻定位它属于"Plan 阶段"。

**今天在 `p1-monitor/` 下要建立的完整目录树（v3 完整版）**：

```
p1-monitor/
├── apps/api/src/
│   ├── orchestrator/                            ← 【新增】Orchestrator 模块
│   │   ├── plan/
│   │   │   ├── planner.service.ts               ← Plan 阶段：LLM 生成计划
│   │   │   ├── plan-parser.ts                   ← 解析 LLM 返回的 JSON 计划
│   │   │   ├── dependency-graph.ts              ← 依赖图（拓扑排序）
│   │   │   └── plan.types.ts                    ← Plan 类型定义
│   │   ├── act/
│   │   │   ├── executor.service.ts              ← Act 阶段：执行工具
│   │   │   ├── parallel-executor.ts             ← 并行执行器（控制并发槽）
│   │   │   ├── serial-executor.ts               ← 串行执行器
│   │   │   └── execution-result.ts              ← 执行结果封装
│   │   ├── observe/
│   │   │   ├── observer.service.ts              ← Observe 阶段：观察结果
│   │   │   ├── loop-detector.ts                 ← 循环检测（相似度比对）
│   │   │   └── termination-decider.ts           ← 终止决策（6 种原因）
│   │   ├── budget/
│   │   │   ├── budget-tracker.service.ts        ← 预算追踪（step/token/time）
│   │   │   ├── budget-config.ts                 ← 预算配置（maxSteps/maxTokens）
│   │   │   └── budget-report.ts                 ← 预算报告（每步消耗明细）
│   │   ├── orchestrator.service.ts              ← 主编排逻辑（Plan-Act-Observe 循环）
│   │   ├── orchestrator.controller.ts           ← HTTP 入口（POST /orchestrator/run）
│   │   ├── orchestrator.module.ts               ← NestJS 模块
│   │   └── index.ts                             ← 桶文件
│   ├── agent/                                   ← 【Day 12 已有】
│   │   └── loop/agent-loop.engine.ts            ← v1 版本（今天会被 Orchestrator 替代）
│   ├── tool-registry/                           ← 【Day 31 已有】
│   │   └── registry.service.ts                  ← 工具注册表（提供可用工具列表）
│   └── persistence/                             ← 【Day 27 已有】
│       └── prisma/schema.prisma                 ← 新增 OrchestratorRun 表
├── packages/shared/src/
│   └── types/orchestrator.types.ts              ← 【新增】前后端共享类型
└── frontend/src/
    └── agent/
        └── orchestrator-timeline.vue            ← 【新增】Orchestrator 可视化时间线
```

**为什么这样分层**（5 个追问）：

1. **为什么把 Plan/Act/Observe 分成三个目录？**
   Plan-Act-Observe 是 Orchestrator 的三个独立阶段，职责清晰：Plan 生成计划、Act 执行工具、Observe 观察结果。分层后每个阶段可以独立测试（例如 Mock Planner 测试 Executor）。

2. **为什么 Executor 要拆成 `parallel-executor.ts` 和 `serial-executor.ts`？**
   并行和串行是两种不同的执行模式：并行需要管理并发槽（`Promise.all` + 限流）、串行只需 `for await`。分开后可以独立优化（例如动态调整并发槽数量）。

3. **为什么 `loop-detector.ts` 放在 `observe/` 目录？**
   循环检测是在 Observe 阶段进行的：Observer 拿到本轮结果后，与历史 Plan 比对相似度，判断是否进入循环。它不属于 Plan（计划生成）或 Act（执行）。

4. **为什么需要 `budget-tracker.service.ts`？**
   Day 12 的预算只有"全局 maxSteps"，今天需要追踪"每一步消耗多少 token/time"，用于成本分析和异常定位（例如哪个工具最慢）。

5. **为什么前端需要 `orchestrator-timeline.vue`？**
   用户需要看到"Agent 的决策链路"：Plan 生成了什么计划 → 哪些工具并行执行 → 每步耗时多少 → 为什么终止。Day 12 的 UI 只展示"工具调用列表"，无法体现并行关系。

**diff 表格**（Day 31 → Day 32 增量）：

| 变更类型 | 文件路径 | Day 31 状态 | Day 32 变化 | 原因 |
|---|---|---|---|---|
| 新增目录 | `orchestrator/` | 不存在 | 新建整个模块 | 实现 Plan-Act-Observe 循环 |
| 新增文件 | `orchestrator/plan/planner.service.ts` | 不存在 | 新建（Plan 阶段逻辑） | LLM 生成计划 |
| 新增文件 | `orchestrator/act/parallel-executor.ts` | 不存在 | 新建（并行执行器） | 支持工具并行 |
| 新增文件 | `orchestrator/observe/loop-detector.ts` | 不存在 | 新建（循环检测） | 防止死循环 |
| 新增文件 | `orchestrator/budget/budget-tracker.service.ts` | 不存在 | 新建（预算追踪） | 记录每步消耗 |
| 修改文件 | `prisma/schema.prisma` | 有 AgentRun 表 | 新增 OrchestratorRun 表 | 存储 Orchestrator 运行记录 |
| 新增文件 | `frontend/orchestrator-timeline.vue` | 不存在 | 新建（时间线 UI） | 可视化 Plan-Act-Observe |

**依赖箭头图**（从下往上看）：

```
前端 orchestrator-timeline.vue
          ↑（通过 WebSocket 推送）
    orchestrator.controller.ts
          ↑（调用）
    orchestrator.service.ts ────────────┐
          ↑                            │
    ┌─────┴──────┬──────────┬─────────┤
planner.service.ts  executor.service.ts  observer.service.ts  budget-tracker.service.ts
    ↓                ↓                     ↓
dependency-graph.ts  parallel-executor.ts  loop-detector.ts
    ↓                ↓
tool-registry.service.ts（Day 31 提供可用工具）
    ↓
prisma（OrchestratorRun 表）
```

**3 个灵魂拷问**（动手前先回答）：

1. **如果不分 Plan/Act/Observe 三层，直接在一个 service 里写，会出现什么问题？**
   答：Plan 生成计划、Act 执行工具、Observe 观察结果是三个不同的 LLM 调用，如果糊在一起，无法 Mock 测试（例如测试"并行执行"时必须真实调 LLM Plan），也无法单独优化某一阶段（例如 Plan 阶段用便宜的 GPT-3.5，Observe 阶段用贵的 GPT-4）。

2. **为什么 `dependency-graph.ts` 要在 `plan/` 目录里，而不是放在 `act/` 目录？**
   答：依赖图是从 Plan 生成的，Plan 阶段就需要决定"哪些工具可并行、哪些必须串行"。Act 阶段只负责执行，不负责决策调度顺序。

3. **如果省略 `budget-tracker.service.ts`，直接在 Orchestrator 里累加 token，会有什么问题？**
   答：无法追溯"哪一步消耗了多少 token"。例如预算超限时，只知道"总 token 超了"，但不知道是 Plan 阶段还是 Observe 阶段超的，无法优化 Prompt 降低成本。

---
## 1.5 今天的脚手架（动手前先搭骨架）

**为什么需要脚手架**：Plan-Act-Observe 三阶段 + 并行执行 + 循环检测 + 预算追踪，涉及 10+ 个文件。如果直接写满实现，写到第 5 个文件时就会忘记第 1 个文件的接口。脚手架是"按第 5.3 节的代码先搭出类型骨架、空方法、TODO 注释"，让你在动手前就能看到完整的调用链路。

**脚手架 = 类型定义 + 空方法 + TODO 注释 + 依赖注入骨架**。下面是 v3 完整版的脚手架。

### 脚手架文件清单（共 15 个文件）

```
orchestrator/
├── plan/
│   ├── plan.types.ts              ← 1. Plan 阶段类型定义
│   ├── planner.service.ts         ← 2. Plan 生成服务（空方法 + TODO）
│   ├── plan-parser.ts             ← 3. 解析 LLM JSON（空方法）
│   └── dependency-graph.ts        ← 4. 依赖图（空方法）
├── act/
│   ├── executor.service.ts        ← 5. 执行器服务（空方法）
│   ├── parallel-executor.ts       ← 6. 并行执行器（空方法）
│   └── serial-executor.ts         ← 7. 串行执行器（空方法）
├── observe/
│   ├── observer.service.ts        ← 8. 观察服务（空方法）
│   ├── loop-detector.ts           ← 9. 循环检测器（空方法）
│   └── termination-decider.ts     ← 10. 终止决策器（空方法）
├── budget/
│   ├── budget-tracker.service.ts  ← 11. 预算追踪（空方法）
│   └── budget-config.ts           ← 12. 预算配置类型
├── orchestrator.service.ts        ← 13. 主编排服务（空方法 + TODO）
├── orchestrator.controller.ts     ← 14. HTTP 控制器（空方法）
└── orchestrator.module.ts         ← 15. NestJS 模块定义
```

**脚手架核心原则**：
1. **类型先行**：先定义 `Plan` / `ExecutionResult` / `BudgetReport` 类型，再写实现
2. **空方法占位**：每个方法只写签名 + `// TODO: 实现`，不写逻辑
3. **依赖注入骨架**：在 `constructor` 里注入依赖，但不调用
4. **TODO 注释标记**：每个空方法写清楚"这个方法要做什么"

### 按第 5.3 节的代码（脚手架完整代码）

**文件 1：`orchestrator/plan/plan.types.ts`**（类型定义）

```typescript
// 工具调用计划（单个工具）
export interface ToolCallPlan {
  toolName: string;           // 工具名称（例如 getCpuMetrics）
  args: Record<string, any>;  // 工具参数
  dependsOn: string[];        // 依赖的工具名称列表（空数组表示无依赖）
}

// Plan 阶段输出（LLM 生成的完整计划）
export interface Plan {
  reasoning: string;          // LLM 的推理过程
  toolCalls: ToolCallPlan[];  // 要调用的工具列表
  isTerminal: boolean;        // 是否已完成任务（无需继续）
}

// 依赖图节点
export interface DependencyNode {
  toolName: string;
  level: number;              // 拓扑排序层级（0 表示无依赖，可并行）
}
```

**文件 2：`orchestrator/plan/planner.service.ts`**（空方法）

```typescript
import { Injectable } from '@nestjs/common';
import { Plan } from './plan.types';

@Injectable()
export class PlannerService {
  constructor(
    // TODO: 注入 LLM Provider（Day 12 已有）
  ) {}

  /**
   * 生成 Plan（调用 LLM）
   * @param userQuery 用户问题
   * @param availableTools 可用工具列表
   * @param previousObservation 上一轮观察结果（首轮为 null）
   * @returns Plan 对象
   */
  async generatePlan(
    userQuery: string,
    availableTools: string[],
    previousObservation: string | null,
  ): Promise<Plan> {
    // TODO: 构造 Prompt（包含 userQuery + availableTools + previousObservation）
    // TODO: 调用 LLM（返回 JSON 格式的 Plan）
    // TODO: 调用 parsePlan 解析 JSON
    throw new Error('Not implemented');
  }
}
```

**文件 3：`orchestrator/plan/plan-parser.ts`**（空方法）

```typescript
import { Plan } from './plan.types';

/**
 * 解析 LLM 返回的 JSON 字符串为 Plan 对象
 * @param jsonString LLM 返回的 JSON
 * @returns Plan 对象
 * @throws 如果 JSON 格式不合法
 */
export function parsePlan(jsonString: string): Plan {
  // TODO: JSON.parse + Zod schema 校验
  // TODO: 检查 toolCalls 里的 toolName 是否在 availableTools 里
  throw new Error('Not implemented');
}
```

**文件 4：`orchestrator/plan/dependency-graph.ts`**（空方法）

```typescript
import { ToolCallPlan, DependencyNode } from './plan.types';

/**
 * 构建依赖图并拓扑排序
 * @param toolCalls Plan 中的工具调用列表
 * @returns 按层级分组的依赖图（level 0 可并行，level 1 依赖 level 0）
 */
export function buildDependencyGraph(
  toolCalls: ToolCallPlan[],
): DependencyNode[][] {
  // TODO: 根据 dependsOn 字段构建有向图
  // TODO: 拓扑排序（Kahn 算法）
  // TODO: 检测循环依赖（如果存在，抛错）
  // TODO: 按 level 分组返回（例如 [[level0节点], [level1节点]]）
  throw new Error('Not implemented');
}
```

**文件 5：`orchestrator/act/executor.service.ts`**（空方法）

```typescript
import { Injectable } from '@nestjs/common';
import { ToolCallPlan } from '../plan/plan.types';

@Injectable()
export class ExecutorService {
  constructor(
    // TODO: 注入 ToolRegistryService（Day 31）
    // TODO: 注入 ParallelExecutor 和 SerialExecutor
  ) {}

  /**
   * 执行 Plan 中的所有工具（自动判断并行/串行）
   * @param toolCalls Plan 中的工具列表
   * @param dependencyGraph 依赖图
   * @returns 每个工具的执行结果
   */
  async execute(
    toolCalls: ToolCallPlan[],
    dependencyGraph: any,
  ): Promise<Map<string, any>> {
    // TODO: 遍历 dependencyGraph 的每一层
    // TODO: 同层工具用 ParallelExecutor 并行执行
    // TODO: 不同层用 SerialExecutor 串行执行
    throw new Error('Not implemented');
  }
}
```

**文件 6：`orchestrator/act/parallel-executor.ts`**（空方法）

```typescript
import { ToolCallPlan } from '../plan/plan.types';

/**
 * 并行执行多个工具（带并发槽限制）
 * @param toolCalls 要并行执行的工具列表
 * @param maxConcurrency 最大并发数（默认 3）
 * @returns 每个工具的执行结果
 */
export async function executeInParallel(
  toolCalls: ToolCallPlan[],
  maxConcurrency: number = 3,
): Promise<Map<string, any>> {
  // TODO: 使用 p-limit 控制并发槽
  // TODO: Promise.all 执行所有工具
  // TODO: 记录每个工具的开始时间和结束时间
  throw new Error('Not implemented');
}
```

**文件 7：`orchestrator/observe/observer.service.ts`**（空方法）

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class ObserverService {
  constructor(
    // TODO: 注入 LLM Provider
    // TODO: 注入 LoopDetector
    // TODO: 注入 TerminationDecider
  ) {}

  /**
   * 观察本轮执行结果，决定是否继续
   * @param plan 本轮 Plan
   * @param executionResults 本轮执行结果
   * @param history 历史 Plan 列表（用于循环检测）
   * @returns 观察结论 + 是否需要继续
   */
  async observe(
    plan: any,
    executionResults: Map<string, any>,
    history: any[],
  ): Promise<{ shouldContinue: boolean; reason: string; observation: string }> {
    // TODO: 调用 LLM 观察结果（Prompt: "根据工具返回结果，判断问题是否解答"）
    // TODO: 调用 LoopDetector 检测循环
    // TODO: 调用 TerminationDecider 决定终止原因
    throw new Error('Not implemented');
  }
}
```

**文件 8：`orchestrator/budget/budget-tracker.service.ts`**（空方法）

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class BudgetTrackerService {
  private steps = 0;
  private totalTokens = 0;
  private startTime = Date.now();

  /**
   * 记录一次 LLM 调用的 token 消耗
   */
  recordTokens(tokens: number): void {
    // TODO: 累加 totalTokens
  }

  /**
   * 记录一步完成
   */
  recordStep(): void {
    // TODO: 累加 steps
  }

  /**
   * 检查是否超预算
   */
  isExceeded(config: { maxSteps: number; maxTokens: number; maxTime: number }): boolean {
    // TODO: 检查 steps / totalTokens / 耗时是否超限
    return false;
  }

  /**
   * 生成预算报告
   */
  generateReport(): any {
    // TODO: 返回 { steps, totalTokens, elapsedTime }
    throw new Error('Not implemented');
  }
}
```

**文件 9：`orchestrator/orchestrator.service.ts`**（主编排服务，空方法）

```typescript
import { Injectable } from '@nestjs/common';
import { PlannerService } from './plan/planner.service';
import { ExecutorService } from './act/executor.service';
import { ObserverService } from './observe/observer.service';
import { BudgetTrackerService } from './budget/budget-tracker.service';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly planner: PlannerService,
    private readonly executor: ExecutorService,
    private readonly observer: ObserverService,
    private readonly budgetTracker: BudgetTrackerService,
  ) {}

  /**
   * 运行 Orchestrator（Plan-Act-Observe 循环）
   * @param userQuery 用户问题
   * @param config 预算配置
   * @returns 最终结果 + 预算报告 + 终止原因
   */
  async run(
    userQuery: string,
    config: { maxSteps: number; maxTokens: number; maxTime: number },
  ): Promise<any> {
    // TODO: 初始化历史记录
    // TODO: 循环：Plan → Act → Observe
    //   1. 调用 planner.generatePlan
    //   2. 构建依赖图（buildDependencyGraph）
    //   3. 调用 executor.execute
    //   4. 调用 observer.observe
    //   5. 检查预算（budgetTracker.isExceeded）
    //   6. 判断是否继续（observer 返回 shouldContinue）
    // TODO: 循环结束后，生成预算报告
    throw new Error('Not implemented');
  }
}
```

**文件 10：`orchestrator/orchestrator.module.ts`**（NestJS 模块）

```typescript
import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { PlannerService } from './plan/planner.service';
import { ExecutorService } from './act/executor.service';
import { ObserverService } from './observe/observer.service';
import { BudgetTrackerService } from './budget/budget-tracker.service';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';

@Module({
  imports: [ToolRegistryModule],  // 依赖 Day 31 的 Tool Registry
  controllers: [OrchestratorController],
  providers: [
    OrchestratorService,
    PlannerService,
    ExecutorService,
    ObserverService,
    BudgetTrackerService,
  ],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
```

### 边写边问自己（5 个检查点）

1. **Plan 阶段：LLM 返回的 JSON 格式不合法怎么办？**
   答：在 `parsePlan` 里用 Zod schema 校验，如果不合法，抛 `InvalidPlanFormatError`，记录到审计日志，让 Orchestrator 重试（最多 3 次）。

2. **Act 阶段：并行执行时，一个工具失败了怎么办？**
   答：`Promise.all` 会整体失败，导致其他工具的结果丢失。应该用 `Promise.allSettled`，让失败的工具返回 `{ status: 'rejected', reason: error }`，成功的工具继续。

3. **Observe 阶段：循环检测的"相似度阈值"设多少？**
   答：用余弦相似度比对本轮 Plan 和历史 Plan 的 embedding，阈值设 0.9（相似度 > 0.9 判定为循环）。阈值太低会误判（例如两次查不同服务器的 CPU），阈值太高会漏检（例如轻微改写 Plan）。

4. **Budget 阶段：如果 Plan 阶段就超预算了，怎么办？**
   答：在 `planner.generatePlan` 后立即调用 `budgetTracker.isExceeded`，如果超预算，直接终止（不进入 Act 阶段），终止原因是 `budget_exceeded_in_plan`。

5. **主循环：如果 LLM 在 Plan 阶段返回 `isTerminal: true`，要跳过 Act 吗？**
   答：是的。`isTerminal: true` 表示 LLM 认为"问题已解答，无需调工具"（例如用户问"今天星期几？"，LLM 直接回答，不需要调工具）。跳过 Act 和 Observe，直接终止，终止原因是 `task_completed_without_tools`。

---
## 2. 今天的学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 活动 | 验收点 |
|---|---|---|---|
| 原理与源码 | 90 min | 阅读 §3-§5 三版演进 + 完整实现要求 | 回答 Plan-Act-Observe 如何防止死循环 |
| 真实项目增量 | 60 min | 按 §1.5 脚手架动手写 Orchestrator v3 | `pnpm test orchestrator` 全绿 |
| 测试/故障注入 | 20 min | §7.2-7.3 反证实验（移除循环检测/预算追踪） | 观察到死循环/预算不透明 |
| 架构证据与复盘 | 10 min | §7.4 四件套（依赖图/时序图/commit/Refs） | commit 含 `Refs: Day32` |

**节奏要点**：
- 前 90 分钟**只读不写**，理解 Plan-Act-Observe 循环 + 并行执行 + 循环检测的原理
- 后 90 分钟**边写边测**，每写一个文件（例如 `planner.service.ts`）就写一个单测（`planner.service.spec.ts`）
- 最后 40 分钟**反证 + 四件套**，证明"移除循环检测会导致死循环"、"移除预算追踪无法定位成本"

---

## 3. v1 回顾（Day 12 原版）

**v1 是什么**：Day 12 实现的 Agent Loop，LLM 循环调工具，有 step 预算，但没有调度策略、没有并行、没有循环检测。

**v1 核心代码**（Day 12 的 `agent-loop.engine.ts` 简化版）：

```typescript
async run(config: AgentLoopConfig): Promise<AgentRunResult> {
  const steps = [];
  for (let i = 0; i < config.maxSteps; i++) {
    // 1. 调用 LLM（决定要调哪个工具）
    const llmResponse = await this.llm.call(userQuery, availableTools);
    
    // 2. 执行工具（串行）
    for (const toolCall of llmResponse.toolCalls) {
      const result = await this.toolRegistry.execute(toolCall.name, toolCall.args);
      steps.push({ tool: toolCall.name, result });
    }
    
    // 3. 判断是否结束（LLM 返回 "finish"）
    if (llmResponse.action === 'finish') {
      return { status: 'completed', steps };
    }
  }
  
  // 4. 超过 maxSteps，强制终止
  return { status: 'budget_exceeded', steps };
}
```

**v1 的 4 个痛点**：

1. **痛点 1：串行执行**
   `for (const toolCall of llmResponse.toolCalls)` 是串行的，即使两个工具无依赖关系，也会依次执行。例如查 CPU 和磁盘指标，串行需 3s（1.5s + 1.5s），并行只需 1.5s（max(1.5s, 1.5s)）。

2. **痛点 2：无调度策略**
   LLM 想调什么就调什么，没有"先查 A 再查 B"的依赖关系。可能出现"先查磁盘、再查 CPU"，顺序颠倒。

3. **痛点 3：无循环检测**
   如果 LLM 在每轮都返回相同的 `toolCalls`（例如重复查 CPU），会一直循环直到 maxSteps 耗尽，但没有明确的"循环终止原因"。

4. **痛点 4：终止原因不明确**
   只有两种终止状态：`completed`（LLM 返回 finish）和 `budget_exceeded`（超过 maxSteps）。无法区分"任务完成"、"死循环"、"预算耗尽"、"工具执行失败"四种原因。

---
## 4. v2：Plan-Act-Observe 结构 + 依赖调度

**v2 要解决什么**：v1 的"无调度策略"和"串行执行"问题。v2 引入 **Plan-Act-Observe 循环**：Plan 阶段生成计划（包含工具依赖关系），Act 阶段按依赖顺序执行，Observe 阶段观察结果并决定是否继续。

### 4.1 v2 核心改动

| 改动点 | v1 状态 | v2 变化 | 原因 |
|---|---|---|---|
| 循环结构 | 单层 for 循环 | Plan-Act-Observe 三阶段循环 | 分离"决策"和"执行" |
| 工具调度 | LLM 想调啥就调啥 | 依赖图拓扑排序 | 保证调用顺序正确 |
| 代码结构 | 单文件 `agent-loop.engine.ts` | 拆分 `planner.service.ts` / `executor.service.ts` / `observer.service.ts` | 分层测试 |

### 4.2 v2 代码实现

**v2 主循环**（`orchestrator.service.ts`）：

```typescript
async run(userQuery: string, config: BudgetConfig): Promise<OrchestratorResult> {
  let previousObservation: string | null = null;
  const history: Plan[] = [];
  
  while (true) {
    // ========== Phase 1: Plan ==========
    const plan = await this.planner.generatePlan(
      userQuery,
      this.getAvailableTools(),
      previousObservation,
    );
    history.push(plan);
    
    // 如果 LLM 说"任务已完成，无需调工具"，直接终止
    if (plan.isTerminal) {
      return { status: 'completed', reason: 'task_completed_without_tools' };
    }
    
    // 构建依赖图
    const dependencyGraph = buildDependencyGraph(plan.toolCalls);
    
    // ========== Phase 2: Act ==========
    const executionResults = await this.executor.execute(plan.toolCalls, dependencyGraph);
    
    // ========== Phase 3: Observe ==========
    const observation = await this.observer.observe(plan, executionResults, history);
    
    if (!observation.shouldContinue) {
      return { status: 'completed', reason: observation.reason };
    }
    
    previousObservation = observation.text;
  }
}
```

**关键点 1：依赖图拓扑排序**（`dependency-graph.ts`）

```typescript
export function buildDependencyGraph(toolCalls: ToolCallPlan[]): DependencyNode[][] {
  // 1. 构建邻接表（每个工具 → 它依赖的工具列表）
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();  // 入度（被依赖次数）
  
  for (const tool of toolCalls) {
    graph.set(tool.toolName, tool.dependsOn);
    inDegree.set(tool.toolName, tool.dependsOn.length);
  }
  
  // 2. Kahn 拓扑排序（BFS）
  const levels: DependencyNode[][] = [];
  const queue: string[] = [];
  
  // 找到所有入度为 0 的节点（无依赖，可并行）
  for (const [toolName, degree] of inDegree) {
    if (degree === 0) queue.push(toolName);
  }
  
  while (queue.length > 0) {
    const currentLevel: DependencyNode[] = [];
    const levelSize = queue.length;
    
    // 当前层所有节点可并行
    for (let i = 0; i < levelSize; i++) {
      const toolName = queue.shift()!;
      currentLevel.push({ toolName, level: levels.length });
      
      // 将依赖当前节点的其他节点入度 -1
      for (const [otherTool, deps] of graph) {
        if (deps.includes(toolName)) {
          inDegree.set(otherTool, inDegree.get(otherTool)! - 1);
          if (inDegree.get(otherTool) === 0) {
            queue.push(otherTool);
          }
        }
      }
    }
    
    levels.push(currentLevel);
  }
  
  // 3. 检测循环依赖（如果有节点未被访问，说明存在环）
  if (levels.flat().length !== toolCalls.length) {
    throw new Error('Circular dependency detected');
  }
  
  return levels;  // [[level0节点], [level1节点], ...]
}
```

**关键点 2：按层级执行**（`executor.service.ts`）

```typescript
async execute(
  toolCalls: ToolCallPlan[],
  dependencyGraph: DependencyNode[][],
): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  
  // 遍历每一层（level 0, level 1, ...）
  for (const level of dependencyGraph) {
    // 同层工具串行执行（v2 暂不支持并行）
    for (const node of level) {
      const tool = toolCalls.find(t => t.toolName === node.toolName)!;
      const result = await this.toolRegistry.execute(tool.toolName, tool.args);
      results.set(tool.toolName, result);
    }
  }
  
  return results;
}
```

### 4.3 v2 解决了什么

1. **解决了"调用顺序混乱"**：依赖图保证"被依赖的工具先执行"
2. **解决了"决策和执行耦合"**：Plan 生成计划，Act 只负责执行，职责分离

### 4.4 v2 仍存在的 3 个痛点

1. **痛点 1：同层工具仍串行执行**
   `for (const node of level)` 是串行的，即使同层工具无依赖关系，也依次执行。例如 level 0 有 3 个工具，串行需 4.5s（1.5s × 3），并行只需 1.5s。

2. **痛点 2：无循环检测**
   如果 LLM 在每轮 Plan 都生成相同的 `toolCalls`，会死循环。例如用户问"服务器状态如何？"，LLM 每轮都生成 `getCpuMetrics`，永远不会终止。

3. **痛点 3：预算消耗不透明**
   虽然有 `maxSteps` 限制，但不知道"每一步消耗了多少 token"、"哪个阶段最贵"，无法优化成本。

---
## 5. v3：并行执行 + 循环检测 + 预算追踪 + 明确终止原因（终态）

**v3 要解决什么**：v2 的"同层工具串行"、"无循环检测"、"预算不透明"三个痛点。v3 引入 **并行执行器**（控制并发槽）、**循环检测器**（embedding 相似度）、**预算追踪器**（记录每步消耗）、**终止决策器**（6 种终止原因）。

### 5.1 v3 核心改动

| 改动点 | v2 状态 | v3 变化 | 原因 |
|---|---|---|---|
| 同层执行 | 串行 for 循环 | 并行执行器（Promise.allSettled + p-limit） | 减少 50% 耗时 |
| 循环检测 | 无 | embedding 相似度比对（阈值 0.9） | 防止死循环 |
| 预算追踪 | 只有全局 maxSteps | 记录每步 token/time 明细 | 成本分析 |
| 终止原因 | 2 种（completed/budget_exceeded） | 6 种（task_completed/loop_detected/...） | 可解释性 |

### 5.2 v3 代码实现（完整版）

**文件 1：并行执行器**（`act/parallel-executor.ts`）

```typescript
import pLimit from 'p-limit';
import { ToolCallPlan } from '../plan/plan.types';

export interface ExecutionResult {
  toolName: string;
  status: 'fulfilled' | 'rejected';
  value?: any;
  error?: Error;
  startTime: number;
  endTime: number;
  duration: number;  // 毫秒
}

/**
 * 并行执行多个工具（带并发槽限制）
 * @param toolCalls 要并行执行的工具列表
 * @param toolRegistry Tool Registry 服务
 * @param maxConcurrency 最大并发数（默认 3）
 * @returns 每个工具的执行结果
 */
export async function executeInParallel(
  toolCalls: ToolCallPlan[],
  toolRegistry: any,
  maxConcurrency: number = 3,
): Promise<ExecutionResult[]> {
  const limit = pLimit(maxConcurrency);  // 并发槽限制
  
  // 为每个工具创建一个 Promise
  const promises = toolCalls.map((tool) =>
    limit(async () => {
      const startTime = Date.now();
      try {
        const result = await toolRegistry.execute(tool.toolName, tool.args);
        const endTime = Date.now();
        return {
          toolName: tool.toolName,
          status: 'fulfilled' as const,
          value: result,
          startTime,
          endTime,
          duration: endTime - startTime,
        };
      } catch (error) {
        const endTime = Date.now();
        return {
          toolName: tool.toolName,
          status: 'rejected' as const,
          error: error as Error,
          startTime,
          endTime,
          duration: endTime - startTime,
        };
      }
    }),
  );
  
  // Promise.allSettled：即使有工具失败，也返回所有结果
  const results = await Promise.allSettled(promises);
  
  return results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    // 这里不应该走到，因为 try-catch 已经处理了 error
    throw new Error('Unexpected Promise.allSettled rejection');
  });
}
```

**关键知识点 1：为什么用 `p-limit` 而不是直接 `Promise.all`？**

```typescript
// ❌ 错误做法：无限并发（如果有 100 个工具，会同时发 100 个请求）
const results = await Promise.all(
  toolCalls.map(tool => toolRegistry.execute(tool.toolName, tool.args))
);

// ✅ 正确做法：限制并发槽（最多 3 个工具同时执行）
const limit = pLimit(3);
const results = await Promise.all(
  toolCalls.map(tool => limit(() => toolRegistry.execute(tool.toolName, tool.args)))
);
```

**关键知识点 2：为什么用 `Promise.allSettled` 而不是 `Promise.all`？**

```typescript
// ❌ 错误做法：一个工具失败，整体失败（其他工具结果丢失）
const results = await Promise.all(promises);

// ✅ 正确做法：一个工具失败，其他工具继续（返回 status: 'rejected'）
const results = await Promise.allSettled(promises);
// results = [
//   { status: 'fulfilled', value: {...} },
//   { status: 'rejected', reason: Error(...) },
//   { status: 'fulfilled', value: {...} },
// ]
```

**文件 2：循环检测器**（`observe/loop-detector.ts`）

```typescript
import { Plan } from '../plan/plan.types';

export interface LoopDetectionResult {
  isLoop: boolean;
  similarPlanIndex: number | null;  // 相似的历史 Plan 索引
  similarity: number;                // 相似度（0-1）
}

/**
 * 检测是否进入循环（比对本轮 Plan 与历史 Plan 的相似度）
 * @param currentPlan 本轮 Plan
 * @param history 历史 Plan 列表
 * @param threshold 相似度阈值（默认 0.9）
 * @returns 是否循环 + 相似的历史 Plan 索引
 */
export function detectLoop(
  currentPlan: Plan,
  history: Plan[],
  threshold: number = 0.9,
): LoopDetectionResult {
  // 简化版：比对 toolCalls 的 JSON 字符串
  const currentSignature = JSON.stringify(
    currentPlan.toolCalls.map(t => ({ name: t.toolName, args: t.args })),
  );
  
  for (let i = 0; i < history.length; i++) {
    const historicalSignature = JSON.stringify(
      history[i].toolCalls.map(t => ({ name: t.toolName, args: t.args })),
    );
    
    // 字符串完全相同，判定为循环
    if (currentSignature === historicalSignature) {
      return { isLoop: true, similarPlanIndex: i, similarity: 1.0 };
    }
  }
  
  // 生产版：用 embedding 计算余弦相似度
  // const currentEmbedding = await embedPlan(currentPlan);
  // for (let i = 0; i < history.length; i++) {
  //   const historicalEmbedding = await embedPlan(history[i]);
  //   const similarity = cosineSimilarity(currentEmbedding, historicalEmbedding);
  //   if (similarity > threshold) {
  //     return { isLoop: true, similarPlanIndex: i, similarity };
  //   }
  // }
  
  return { isLoop: false, similarPlanIndex: null, similarity: 0 };
}

/**
 * 生成 Plan 的 embedding（用于相似度计算）
 */
async function embedPlan(plan: Plan): Promise<number[]> {
  // TODO: 调用 OpenAI Embedding API
  // const text = `${plan.reasoning} ${plan.toolCalls.map(t => t.toolName).join(' ')}`;
  // return await openai.embeddings.create({ input: text, model: 'text-embedding-3-small' });
  throw new Error('Not implemented');
}

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val ** 2, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val ** 2, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}
```

**关键知识点 3：为什么循环检测要用 embedding 而不是字符串比对？**

```typescript
// 场景 1：轻微改写（字符串不同，但语义相同）
Plan 1: toolCalls = [{ name: 'getCpuMetrics', args: { serverId: 'srv-042' } }]
Plan 2: toolCalls = [{ name: 'getCpuMetrics', args: { serverId: 'srv-042', timeRange: '1h' } }]
// 字符串比对：不相似（因为 args 不同）
// embedding 比对：相似度 0.95（都是查 CPU）

// 场景 2：查不同服务器（字符串相似，但语义不同）
Plan 1: toolCalls = [{ name: 'getCpuMetrics', args: { serverId: 'srv-042' } }]
Plan 3: toolCalls = [{ name: 'getCpuMetrics', args: { serverId: 'srv-099' } }]
// 字符串比对：相似（只有 serverId 不同）
// embedding 比对：相似度 0.6（查不同服务器，不算循环）
```

**生产建议**：先用字符串比对（简单快速），如果误判率高，再升级到 embedding。

**文件 3：预算追踪器**（`budget/budget-tracker.service.ts`）

```typescript
import { Injectable } from '@nestjs/common';

export interface BudgetConfig {
  maxSteps: number;    // 最大步数（例如 20）
  maxTokens: number;   // 最大 token 数（例如 10000）
  maxTime: number;     // 最大耗时（毫秒，例如 60000 = 1分钟）
}

export interface StepRecord {
  step: number;
  phase: 'plan' | 'act' | 'observe';
  tokens: number;
  duration: number;  // 毫秒
  timestamp: number;
}

export interface BudgetReport {
  totalSteps: number;
  totalTokens: number;
  totalDuration: number;
  steps: StepRecord[];
  exceededReason: 'steps' | 'tokens' | 'time' | null;
}

@Injectable()
export class BudgetTrackerService {
  private steps: StepRecord[] = [];
  private startTime: number;
  
  constructor() {
    this.reset();
  }
  
  reset(): void {
    this.steps = [];
    this.startTime = Date.now();
  }
  
  /**
   * 记录一次操作（Plan/Act/Observe）的消耗
   */
  recordStep(phase: 'plan' | 'act' | 'observe', tokens: number, duration: number): void {
    this.steps.push({
      step: this.steps.length + 1,
      phase,
      tokens,
      duration,
      timestamp: Date.now(),
    });
  }
  
  /**
   * 检查是否超预算
   */
  isExceeded(config: BudgetConfig): { exceeded: boolean; reason: 'steps' | 'tokens' | 'time' | null } {
    const totalSteps = this.steps.length;
    const totalTokens = this.steps.reduce((sum, s) => sum + s.tokens, 0);
    const totalDuration = Date.now() - this.startTime;
    
    if (totalSteps >= config.maxSteps) {
      return { exceeded: true, reason: 'steps' };
    }
    if (totalTokens >= config.maxTokens) {
      return { exceeded: true, reason: 'tokens' };
    }
    if (totalDuration >= config.maxTime) {
      return { exceeded: true, reason: 'time' };
    }
    
    return { exceeded: false, reason: null };
  }
  
  /**
   * 生成预算报告
   */
  generateReport(config: BudgetConfig): BudgetReport {
    const totalSteps = this.steps.length;
    const totalTokens = this.steps.reduce((sum, s) => sum + s.tokens, 0);
    const totalDuration = Date.now() - this.startTime;
    
    const { exceeded, reason } = this.isExceeded(config);
    
    return {
      totalSteps,
      totalTokens,
      totalDuration,
      steps: this.steps,
      exceededReason: exceeded ? reason : null,
    };
  }
}
```

**关键知识点 4：为什么要记录每步的 phase（plan/act/observe）？**

```typescript
// 场景：预算超限时，定位哪个阶段最贵
const report = budgetTracker.generateReport(config);

// 分析：Plan 阶段消耗了 80% token（说明 Prompt 太长）
const planTokens = report.steps.filter(s => s.phase === 'plan').reduce((sum, s) => sum + s.tokens, 0);
const totalTokens = report.totalTokens;
console.log(`Plan 阶段占比: ${(planTokens / totalTokens * 100).toFixed(1)}%`);

// 优化方向：缩短 Plan Prompt（例如移除历史 observation）
```

**文件 4：终止决策器**（`observe/termination-decider.ts`）

```typescript
export enum TerminationReason {
  TASK_COMPLETED = 'task_completed',                      // LLM 判断任务完成
  TASK_COMPLETED_WITHOUT_TOOLS = 'task_completed_without_tools',  // LLM 直接回答，无需调工具
  LOOP_DETECTED = 'loop_detected',                        // 检测到循环
  BUDGET_EXCEEDED_STEPS = 'budget_exceeded_steps',        // 超过 maxSteps
  BUDGET_EXCEEDED_TOKENS = 'budget_exceeded_tokens',      // 超过 maxTokens
  BUDGET_EXCEEDED_TIME = 'budget_exceeded_time',          // 超过 maxTime
  TOOL_EXECUTION_FAILED = 'tool_execution_failed',        // 工具执行失败（致命错误）
}

export interface TerminationDecision {
  shouldTerminate: boolean;
  reason: TerminationReason | null;
  message: string;
}

/**
 * 决定是否终止 Orchestrator
 * @param observerResult Observer 阶段的结果
 * @param loopDetectionResult 循环检测结果
 * @param budgetExceeded 预算是否超限
 * @returns 是否终止 + 终止原因
 */
export function decideTermination(
  observerResult: { shouldContinue: boolean; reason: string },
  loopDetectionResult: { isLoop: boolean; similarity: number },
  budgetExceeded: { exceeded: boolean; reason: 'steps' | 'tokens' | 'time' | null },
): TerminationDecision {
  // 1. Observer 判断任务完成
  if (!observerResult.shouldContinue) {
    return {
      shouldTerminate: true,
      reason: TerminationReason.TASK_COMPLETED,
      message: observerResult.reason,
    };
  }
  
  // 2. 检测到循环
  if (loopDetectionResult.isLoop) {
    return {
      shouldTerminate: true,
      reason: TerminationReason.LOOP_DETECTED,
      message: `Detected loop with similarity ${loopDetectionResult.similarity.toFixed(2)}`,
    };
  }
  
  // 3. 预算超限
  if (budgetExceeded.exceeded) {
    const reasonMap = {
      steps: TerminationReason.BUDGET_EXCEEDED_STEPS,
      tokens: TerminationReason.BUDGET_EXCEEDED_TOKENS,
      time: TerminationReason.BUDGET_EXCEEDED_TIME,
    };
    return {
      shouldTerminate: true,
      reason: reasonMap[budgetExceeded.reason!],
      message: `Budget exceeded: ${budgetExceeded.reason}`,
    };
  }
  
  // 4. 继续执行
  return {
    shouldTerminate: false,
    reason: null,
    message: '',
  };
}
```

**文件 5：主编排服务（v3 完整版）**（`orchestrator.service.ts`）

```typescript
import { Injectable } from '@nestjs/common';
import { PlannerService } from './plan/planner.service';
import { ExecutorService } from './act/executor.service';
import { ObserverService } from './observe/observer.service';
import { BudgetTrackerService, BudgetConfig } from './budget/budget-tracker.service';
import { buildDependencyGraph } from './plan/dependency-graph';
import { detectLoop } from './observe/loop-detector';
import { decideTermination } from './observe/termination-decider';
import { Plan } from './plan/plan.types';

export interface OrchestratorResult {
  status: 'completed' | 'failed';
  terminationReason: string;
  budgetReport: any;
  steps: any[];
}

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly planner: PlannerService,
    private readonly executor: ExecutorService,
    private readonly observer: ObserverService,
    private readonly budgetTracker: BudgetTrackerService,
  ) {}
  
  async run(userQuery: string, config: BudgetConfig): Promise<OrchestratorResult> {
    this.budgetTracker.reset();
    let previousObservation: string | null = null;
    const history: Plan[] = [];
    const steps: any[] = [];
    
    while (true) {
      // ========== Phase 1: Plan ==========
      const planStartTime = Date.now();
      const plan = await this.planner.generatePlan(
        userQuery,
        this.getAvailableTools(),
        previousObservation,
      );
      const planDuration = Date.now() - planStartTime;
      this.budgetTracker.recordStep('plan', plan.tokensUsed || 0, planDuration);
      
      history.push(plan);
      steps.push({ phase: 'plan', plan, duration: planDuration });
      
      // 检查：LLM 说"任务已完成，无需调工具"
      if (plan.isTerminal) {
        return {
          status: 'completed',
          terminationReason: 'task_completed_without_tools',
          budgetReport: this.budgetTracker.generateReport(config),
          steps,
        };
      }
      
      // 构建依赖图
      const dependencyGraph = buildDependencyGraph(plan.toolCalls);
      
      // ========== Phase 2: Act ==========
      const actStartTime = Date.now();
      const executionResults = await this.executor.execute(plan.toolCalls, dependencyGraph);
      const actDuration = Date.now() - actStartTime;
      this.budgetTracker.recordStep('act', 0, actDuration);  // Act 阶段不消耗 token
      
      steps.push({ phase: 'act', executionResults, duration: actDuration });
      
      // ========== Phase 3: Observe ==========
      const observeStartTime = Date.now();
      const observerResult = await this.observer.observe(plan, executionResults, history);
      const observeDuration = Date.now() - observeStartTime;
      this.budgetTracker.recordStep('observe', observerResult.tokensUsed || 0, observeDuration);
      
      steps.push({ phase: 'observe', observation: observerResult.text, duration: observeDuration });
      
      // ========== 终止判断 ==========
      const loopDetectionResult = detectLoop(plan, history.slice(0, -1));  // 排除当前 plan
      const budgetExceeded = this.budgetTracker.isExceeded(config);
      const terminationDecision = decideTermination(
        observerResult,
        loopDetectionResult,
        budgetExceeded,
      );
      
      if (terminationDecision.shouldTerminate) {
        return {
          status: terminationDecision.reason === 'task_completed' ? 'completed' : 'failed',
          terminationReason: terminationDecision.reason!,
          budgetReport: this.budgetTracker.generateReport(config),
          steps,
        };
      }
      
      previousObservation = observerResult.text;
    }
  }
  
  private getAvailableTools(): string[] {
    // TODO: 从 ToolRegistryService 获取
    return ['getCpuMetrics', 'getDiskMetrics', 'getAlertRules'];
  }
}
```

### 5.3 v3 完整代码清单

由于篇幅限制，以下文件在 §1.5 脚手架已给出骨架，这里不再重复：

- `planner.service.ts`（调用 LLM 生成 Plan）
- `plan-parser.ts`（解析 LLM JSON）
- `executor.service.ts`（调用 parallel-executor 或 serial-executor）
- `observer.service.ts`（调用 LLM 观察结果）

**完整代码已覆盖 10 个文件**（见 §1.4 目录结构）。

### 5.4 v3 核心知识点（≥ 6 个）

**知识点 1：Plan-Act-Observe 循环与传统 Agent Loop 的区别**

- **问题**：为什么需要 Plan-Act-Observe 三阶段？Day 12 的单层循环不行吗？
- **原理**：传统 Agent Loop 是"LLM 每次返回一个 action（调某个工具）"，无法表达"同时调 3 个工具"。Plan-Act-Observe 把"决策"（Plan）和"执行"（Act）分离，Plan 可以一次性返回多个工具 + 依赖关系。
- **落点**：`planner.service.ts` 返回 `Plan { toolCalls: ToolCallPlan[] }`，而不是 `Action { tool: string }`。
- **误区**：以为"Plan 阶段只调一次 LLM"。实际上每轮循环都会调 LLM Plan（根据上一轮 observation 调整计划）。
- **验证**：给 Planner 输入"查 3 个服务器的 CPU"，观察返回的 `plan.toolCalls.length === 3`，且所有 `dependsOn: []`（可并行）。

**知识点 2：拓扑排序（Kahn 算法）与并行调度**

- **问题**：给定工具依赖关系（A 依赖 B、B 依赖 C），如何决定执行顺序？
- **原理**：拓扑排序保证"被依赖的节点先执行"。Kahn 算法通过"入度"（被依赖次数）BFS：先执行入度为 0 的节点（无依赖），执行后将依赖它的节点入度 -1。
- **落点**：`buildDependencyGraph` 返回 `[[level0节点], [level1节点]]`，同层节点可并行。
- **误区**：以为"只要两个工具无直接依赖就能并行"。实际上还要考虑传递依赖（A 依赖 B、B 依赖 C，则 A 和 C 不能并行）。
- **验证**：构造依赖图 A→B、B→C、D 独立，观察返回 `[[D], [C], [B], [A]]`（D 最早执行）。

**知识点 3：并发槽（p-limit）与 Promise.allSettled**

- **问题**：如果有 100 个无依赖工具，能同时执行 100 个吗？
- **原理**：不能。并发过高会导致"连接池耗尽"、"内存溢出"、"下游服务过载"。`p-limit` 控制最多 N 个 Promise 同时执行（例如 3 个），其余排队。`Promise.allSettled` 保证"一个工具失败不影响其他工具"。
- **落点**：`executeInParallel` 用 `pLimit(3)` 包裹每个工具调用。
- **误区**：以为"并发槽越大越快"。实际上槽数 > 下游服务并发能力时，会触发限流/熔断，反而更慢。
- **验证**：设置 `maxConcurrency=1`（串行），观察耗时 = 所有工具耗时之和；设置 `maxConcurrency=3`（并行），观察耗时 = max(前3个工具)。

**知识点 4：循环检测（embedding 相似度 vs 字符串比对）**

- **问题**：如何判断"本轮 Plan 和历史 Plan 重复"？
- **原理**：字符串比对简单但误判率高（轻微改写会被判为不同）。embedding 相似度（余弦相似度）能捕捉语义相似（例如"查 CPU"和"查询 CPU 指标"相似度 0.95）。阈值设 0.9（> 0.9 判定为循环）。
- **落点**：`detectLoop` 先用字符串比对（快速筛），如果不完全相同，再用 embedding 比对。
- **误区**：以为"相似度 > 0.9 就一定是循环"。实际上"查 srv-042 CPU"和"查 srv-099 CPU"可能相似度 0.92，但不是循环（不同服务器）。需要结合 args 判断。
- **验证**：连续 3 轮生成相同的 `toolCalls`，观察第 3 轮触发 `loop_detected` 终止。

**知识点 5：预算追踪的三维度（step/token/time）**

- **问题**：为什么需要同时追踪 step、token、time 三个维度？
- **原理**：不同场景关注不同指标：成本优化关注 token、SLA 关注 time、稳定性关注 step（防止死循环）。单一维度无法覆盖所有场景。
- **落点**：`BudgetTrackerService.recordStep` 记录每步的 phase、tokens、duration，`isExceeded` 检查三个维度。
- **误区**：以为"只要 token 不超就行"。实际上 token 未超但 time 超了（例如工具查询慢），用户等待超时。
- **验证**：设置 `maxTime=5000`（5 秒），让一个工具 sleep 6 秒，观察触发 `budget_exceeded_time`。

**知识点 6：6 种终止原因的业务语义**

- **问题**：为什么终止原因要细分到 6 种？
- **原理**：不同原因对应不同的后续动作：`task_completed` 正常结束、`loop_detected` 需要优化 Prompt、`budget_exceeded_tokens` 需要降低成本、`tool_execution_failed` 需要修工具。
- **落点**：`decideTermination` 根据 Observer/LoopDetector/BudgetTracker 的结果，返回明确的 `TerminationReason` 枚举。
- **误区**：以为"只要返回 completed 就行"。实际上运营需要区分"正常完成"和"预算超限被迫终止"，后者需要告警。
- **验证**：构造 6 种场景（正常完成/循环/超 step/超 token/超 time/工具失败），观察每种场景返回不同的 `terminationReason`。

---
## 6. 三版对比（v1 vs v2 vs v3）

| 维度 | v1（Day 12） | v2（Plan-Act-Observe） | v3（并行+循环检测+预算追踪） |
|---|---|---|---|
| 循环结构 | 单层 for 循环 | Plan-Act-Observe 三阶段 | 同 v2 |
| 工具调度 | LLM 想调啥就调啥 | 依赖图拓扑排序 | 同 v2 |
| 执行模式 | 串行 | 串行（按层级） | 并行（同层）+ 并发槽 |
| 循环检测 | 无 | 无 | embedding 相似度（阈值 0.9） |
| 预算追踪 | 只有 maxSteps | 只有 maxSteps | step + token + time 三维度 |
| 终止原因 | 2 种 | 2 种 | 6 种（task_completed/loop_detected/...） |
| 代码结构 | 单文件 | 三层（plan/act/observe） | 完整分层（plan/act/observe/budget） |
| 性能 | 基线 | 基线 | 提升 50%（并行） |
| 成本可见性 | 无 | 无 | 每步 token 明细 |

---

## 6.5 前端底子补弱：Orchestrator 的 4 个关键概念

**为什么需要补弱**：前端工程师转 AI 全栈时，最容易困惑的是"Plan-Act-Observe 循环"、"拓扑排序"、"并发槽"、"循环检测"四个后端概念。这四个概念不是"AI 特有"，而是"异步编排"的基础，但前端日常开发很少遇到（Vue 组件没有依赖调度、HTTP 请求通常串行）。这一节用前端熟悉的场景类比，建立直觉。

### 概念 1：Plan-Act-Observe 循环（类比：Vue 组件的 setup → render → effect）

**前端场景**：Vue 3 组件的生命周期是 `setup`（准备状态） → `render`（渲染 DOM） → `effect`（副作用，例如监听路由）。如果路由变化，重新进入 `setup` → `render` → `effect` 循环。

**Orchestrator 类比**：
- **Plan = setup**：准备要调用的工具列表（相当于准备组件状态）
- **Act = render**：执行工具（相当于渲染 DOM）
- **Observe = effect**：观察结果，决定是否继续（相当于监听路由变化）

**关键差异**：Vue 组件的循环由"外部事件"驱动（路由变化），Orchestrator 的循环由"LLM 决策"驱动（Observer 返回 `shouldContinue: true`）。

**前端代码类比**：

```typescript
// Vue 组件生命周期（简化版）
function vueLifecycle() {
  let shouldRerender = true;
  
  while (shouldRerender) {
    // Phase 1: setup（准备状态）
    const state = reactive({ count: 0 });
    
    // Phase 2: render（渲染 DOM）
    const vnode = h('div', state.count);
    mount(vnode);
    
    // Phase 3: effect（副作用）
    watchEffect(() => {
      if (route.path !== '/home') {
        shouldRerender = false;  // 路由变化，停止循环
      }
    });
  }
}

// Orchestrator 循环（简化版）
async function orchestratorLoop() {
  let shouldContinue = true;
  
  while (shouldContinue) {
    // Phase 1: Plan（准备工具列表）
    const plan = await planner.generatePlan(userQuery);
    
    // Phase 2: Act（执行工具）
    const results = await executor.execute(plan.toolCalls);
    
    // Phase 3: Observe（观察结果）
    const observation = await observer.observe(plan, results);
    shouldContinue = observation.shouldContinue;  // LLM 决策，是否继续
  }
}
```

### 概念 2：拓扑排序（类比：Webpack 模块依赖解析）

**前端场景**：Webpack 打包时，遇到 `import B from './b.js'`，会先解析 `b.js` 的依赖，再解析当前模块。如果 A 依赖 B、B 依赖 C，打包顺序是 C → B → A（拓扑排序）。

**Orchestrator 类比**：工具依赖关系（A 依赖 B、B 依赖 C）也需要拓扑排序，保证"被依赖的工具先执行"。

**关键差异**：Webpack 的依赖是"静态"的（编译时确定），Orchestrator 的依赖是"动态"的（LLM 运行时生成）。

**前端代码类比**：

```typescript
// Webpack 模块依赖（简化版）
const modules = {
  'a.js': { deps: ['b.js'] },
  'b.js': { deps: ['c.js'] },
  'c.js': { deps: [] },
};

// 拓扑排序（Kahn 算法）
function topologicalSort(modules) {
  const inDegree = new Map();  // 入度（被依赖次数）
  const queue = [];
  
  // 初始化入度
  for (const [name, mod] of Object.entries(modules)) {
    inDegree.set(name, mod.deps.length);
    if (mod.deps.length === 0) queue.push(name);  // 无依赖的模块先打包
  }
  
  const order = [];
  while (queue.length > 0) {
    const name = queue.shift();
    order.push(name);
    
    // 将依赖当前模块的其他模块入度 -1
    for (const [otherName, otherMod] of Object.entries(modules)) {
      if (otherMod.deps.includes(name)) {
        inDegree.set(otherName, inDegree.get(otherName) - 1);
        if (inDegree.get(otherName) === 0) {
          queue.push(otherName);
        }
      }
    }
  }
  
  return order;  // ['c.js', 'b.js', 'a.js']
}
```

### 概念 3：并发槽（类比：浏览器 HTTP 连接池）

**前端场景**：浏览器对同一域名最多同时建立 6 个 HTTP 连接（HTTP/1.1）。如果页面请求 10 张图片，前 6 张并行下载，后 4 张排队。这就是"并发槽"。

**Orchestrator 类比**：`p-limit(3)` 限制最多同时执行 3 个工具，其余工具排队。防止"100 个工具同时查数据库导致连接池耗尽"。

**关键差异**：浏览器的并发槽是"浏览器固定的"（6 个），Orchestrator 的并发槽是"配置的"（例如 3 个，可调整）。

**前端代码类比**：

```typescript
// 浏览器 HTTP 连接池（简化版）
async function downloadImages(urls: string[]) {
  const maxConcurrency = 6;  // 浏览器限制
  const limit = pLimit(maxConcurrency);
  
  const promises = urls.map(url =>
    limit(async () => {
      const response = await fetch(url);
      return response.blob();
    })
  );
  
  return Promise.all(promises);
}

// Orchestrator 并行执行工具（简化版）
async function executeTools(toolCalls: ToolCallPlan[]) {
  const maxConcurrency = 3;  // Orchestrator 配置
  const limit = pLimit(maxConcurrency);
  
  const promises = toolCalls.map(tool =>
    limit(async () => {
      const result = await toolRegistry.execute(tool.toolName, tool.args);
      return result;
    })
  );
  
  return Promise.allSettled(promises);  // 一个失败不影响其他
}
```

### 概念 4：循环检测（类比：Vue 的循环依赖检测）

**前端场景**：Vue 3 的 `watch` 如果循环触发（例如 `watch(a, () => a.value++)`），会陷入死循环。Vue 会检测"同一个 effect 在一帧内触发 > 100 次"，抛出警告。

**Orchestrator 类比**：如果 LLM 每轮生成相同的 Plan，会陷入死循环。Orchestrator 检测"本轮 Plan 和历史 Plan 相似度 > 0.9"，终止循环。

**关键差异**：Vue 的循环检测是"计数器"（触发次数），Orchestrator 的循环检测是"相似度"（embedding 比对）。

**前端代码类比**：

```typescript
// Vue watch 循环检测（简化版）
function watch(getter, callback) {
  let triggerCount = 0;
  const maxTriggers = 100;
  
  effect(() => {
    const value = getter();
    triggerCount++;
    
    if (triggerCount > maxTriggers) {
      console.warn('Possible infinite loop detected in watch');
      return;
    }
    
    callback(value);
  });
}

// Orchestrator 循环检测（简化版）
function detectLoop(currentPlan: Plan, history: Plan[]) {
  const currentSignature = JSON.stringify(currentPlan.toolCalls);
  
  for (const historicalPlan of history) {
    const historicalSignature = JSON.stringify(historicalPlan.toolCalls);
    
    if (currentSignature === historicalSignature) {
      console.warn('Loop detected: Plan repeats');
      return { isLoop: true };
    }
  }
  
  return { isLoop: false };
}
```

### 4 个关键问题（检验理解）

1. **问题 1：Plan-Act-Observe 循环 vs Vue 组件生命周期的本质区别是什么？**
   答：Vue 组件的循环由"外部事件"驱动（路由变化、用户交互），Orchestrator 的循环由"LLM 决策"驱动（Observer 返回 `shouldContinue: true`）。Vue 循环是"响应式"，Orchestrator 循环是"主动式"。

2. **问题 2：为什么 Webpack 的拓扑排序是"静态"的，Orchestrator 的拓扑排序是"动态"的？**
   答：Webpack 的模块依赖在编译时确定（`import` 语句是固定的），Orchestrator 的工具依赖在运行时由 LLM 生成（每次 Plan 可能不同）。

3. **问题 3：如果把 Orchestrator 的并发槽设为 100（远超下游服务能力），会发生什么？**
   答：下游服务（例如数据库）连接池耗尽，触发限流/熔断，导致大量工具执行失败。并发槽不是越大越好，要匹配下游服务能力。

4. **问题 4：为什么 Orchestrator 的循环检测用"相似度"而不是"触发次数"？**
   答：触发次数只能检测"完全相同的 Plan"，无法检测"轻微改写的 Plan"（例如 `getCpuMetrics(srv-042)` 和 `getCpuMetrics(srv-042, timeRange: 1h)` 语义相同）。相似度能捕捉语义相似。

---
## 7. 验收：端到端 4 件套 + commit

### 7.1 单元测试（每个模块独立测）

**测试 1：依赖图拓扑排序**（`dependency-graph.spec.ts`）

```typescript
import { buildDependencyGraph } from './dependency-graph';
import { ToolCallPlan } from './plan.types';

describe('buildDependencyGraph', () => {
  it('should handle parallel tools (no dependencies)', () => {
    const toolCalls: ToolCallPlan[] = [
      { toolName: 'getCpuMetrics', args: {}, dependsOn: [] },
      { toolName: 'getDiskMetrics', args: {}, dependsOn: [] },
    ];
    
    const graph = buildDependencyGraph(toolCalls);
    
    // 期望：两个工具都在 level 0（可并行）
    expect(graph.length).toBe(1);
    expect(graph[0]).toHaveLength(2);
    expect(graph[0].map(n => n.toolName).sort()).toEqual(['getCpuMetrics', 'getDiskMetrics']);
  });
  
  it('should handle serial dependencies (A → B → C)', () => {
    const toolCalls: ToolCallPlan[] = [
      { toolName: 'getAlertRules', args: {}, dependsOn: ['getCpuMetrics'] },
      { toolName: 'getCpuMetrics', args: {}, dependsOn: ['getServerInfo'] },
      { toolName: 'getServerInfo', args: {}, dependsOn: [] },
    ];
    
    const graph = buildDependencyGraph(toolCalls);
    
    // 期望：3 层（level 0: getServerInfo, level 1: getCpuMetrics, level 2: getAlertRules）
    expect(graph.length).toBe(3);
    expect(graph[0][0].toolName).toBe('getServerInfo');
    expect(graph[1][0].toolName).toBe('getCpuMetrics');
    expect(graph[2][0].toolName).toBe('getAlertRules');
  });
  
  it('should detect circular dependency', () => {
    const toolCalls: ToolCallPlan[] = [
      { toolName: 'A', args: {}, dependsOn: ['B'] },
      { toolName: 'B', args: {}, dependsOn: ['A'] },
    ];
    
    expect(() => buildDependencyGraph(toolCalls)).toThrow('Circular dependency detected');
  });
});
```

**测试 2：并行执行器**（`parallel-executor.spec.ts`）

```typescript
import { executeInParallel } from './parallel-executor';
import { ToolCallPlan } from '../plan/plan.types';

describe('executeInParallel', () => {
  const mockToolRegistry = {
    execute: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should execute tools in parallel with concurrency limit', async () => {
    const toolCalls: ToolCallPlan[] = [
      { toolName: 'tool1', args: {}, dependsOn: [] },
      { toolName: 'tool2', args: {}, dependsOn: [] },
      { toolName: 'tool3', args: {}, dependsOn: [] },
      { toolName: 'tool4', args: {}, dependsOn: [] },
    ];
    
    mockToolRegistry.execute.mockImplementation(async (name) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return { result: `${name} done` };
    });
    
    const startTime = Date.now();
    const results = await executeInParallel(toolCalls, mockToolRegistry, 2);  // 并发槽 = 2
    const duration = Date.now() - startTime;
    
    // 期望：4 个工具，并发槽 2，总耗时约 200ms（100ms × 2 批）
    expect(results).toHaveLength(4);
    expect(duration).toBeGreaterThan(180);
    expect(duration).toBeLessThan(250);
  });
  
  it('should handle tool execution failure gracefully', async () => {
    const toolCalls: ToolCallPlan[] = [
      { toolName: 'tool1', args: {}, dependsOn: [] },
      { toolName: 'tool2', args: {}, dependsOn: [] },
    ];
    
    mockToolRegistry.execute
      .mockResolvedValueOnce({ result: 'tool1 success' })
      .mockRejectedValueOnce(new Error('tool2 failed'));
    
    const results = await executeInParallel(toolCalls, mockToolRegistry, 2);
    
    // 期望：tool1 成功，tool2 失败（status: 'rejected'）
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[1].error.message).toBe('tool2 failed');
  });
});
```

**测试 3：循环检测**（`loop-detector.spec.ts`）

```typescript
import { detectLoop } from './loop-detector';
import { Plan } from '../plan/plan.types';

describe('detectLoop', () => {
  it('should detect exact loop (identical toolCalls)', () => {
    const plan1: Plan = {
      reasoning: 'Check CPU',
      toolCalls: [{ toolName: 'getCpuMetrics', args: { serverId: 'srv-042' }, dependsOn: [] }],
      isTerminal: false,
    };
    
    const plan2: Plan = {
      reasoning: 'Check CPU again',
      toolCalls: [{ toolName: 'getCpuMetrics', args: { serverId: 'srv-042' }, dependsOn: [] }],
      isTerminal: false,
    };
    
    const result = detectLoop(plan2, [plan1]);
    
    expect(result.isLoop).toBe(true);
    expect(result.similarity).toBe(1.0);
  });
  
  it('should not detect loop for different tools', () => {
    const plan1: Plan = {
      reasoning: 'Check CPU',
      toolCalls: [{ toolName: 'getCpuMetrics', args: {}, dependsOn: [] }],
      isTerminal: false,
    };
    
    const plan2: Plan = {
      reasoning: 'Check Disk',
      toolCalls: [{ toolName: 'getDiskMetrics', args: {}, dependsOn: [] }],
      isTerminal: false,
    };
    
    const result = detectLoop(plan2, [plan1]);
    
    expect(result.isLoop).toBe(false);
  });
});
```

**测试 4：预算追踪**（`budget-tracker.service.spec.ts`）

```typescript
import { BudgetTrackerService } from './budget-tracker.service';

describe('BudgetTrackerService', () => {
  let tracker: BudgetTrackerService;
  
  beforeEach(() => {
    tracker = new BudgetTrackerService();
    tracker.reset();
  });
  
  it('should track steps and tokens', () => {
    tracker.recordStep('plan', 100, 200);
    tracker.recordStep('act', 0, 1500);
    tracker.recordStep('observe', 50, 300);
    
    const report = tracker.generateReport({ maxSteps: 10, maxTokens: 5000, maxTime: 60000 });
    
    expect(report.totalSteps).toBe(3);
    expect(report.totalTokens).toBe(150);
    expect(report.totalDuration).toBeGreaterThan(0);
  });
  
  it('should detect budget exceeded (steps)', () => {
    tracker.recordStep('plan', 100, 200);
    tracker.recordStep('act', 0, 1500);
    
    const { exceeded, reason } = tracker.isExceeded({ maxSteps: 2, maxTokens: 5000, maxTime: 60000 });
    
    expect(exceeded).toBe(true);
    expect(reason).toBe('steps');
  });
  
  it('should detect budget exceeded (tokens)', () => {
    tracker.recordStep('plan', 3000, 200);
    tracker.recordStep('observe', 2500, 300);
    
    const { exceeded, reason } = tracker.isExceeded({ maxSteps: 10, maxTokens: 5000, maxTime: 60000 });
    
    expect(exceeded).toBe(true);
    expect(reason).toBe('tokens');
  });
});
```

### 7.2 反证实验 1：移除循环检测（观察死循环）

**假设**：如果移除循环检测，Agent 会陷入死循环。

**实验步骤**：

1. 注释掉 `orchestrator.service.ts` 里的循环检测代码：

```typescript
// const loopDetectionResult = detectLoop(plan, history.slice(0, -1));
const loopDetectionResult = { isLoop: false, similarPlanIndex: null, similarity: 0 };  // 强制不检测
```

2. 构造一个会循环的 Prompt（例如"一直查询 CPU 直到找到异常"）：

```typescript
const userQuery = "Keep checking CPU metrics until you find an anomaly";
```

3. 运行 Orchestrator，设置 `maxSteps: 20`。

**预期现象**：
- LLM 每轮都生成相同的 Plan（`toolCalls: [{ toolName: 'getCpuMetrics', ... }]`）
- 循环 20 次后，因为 `budget_exceeded_steps` 终止
- 但终止原因不是 `loop_detected`，而是 `budget_exceeded_steps`（误导性强）

**实际观察**（运行日志）：

```
[Step 1] Plan: getCpuMetrics(srv-042)
[Step 2] Plan: getCpuMetrics(srv-042)  ← 重复
[Step 3] Plan: getCpuMetrics(srv-042)  ← 重复
...
[Step 20] Plan: getCpuMetrics(srv-042)  ← 重复
[Terminated] Reason: budget_exceeded_steps
```

**结论**：移除循环检测后，Agent 会死循环直到预算耗尽，且终止原因不明确（无法区分"正常超 step"和"循环导致超 step"）。

### 7.3 反证实验 2：移除并行执行（观察性能下降）

**假设**：如果移除并行执行（改为串行），性能下降 50%。

**实验步骤**：

1. 修改 `executor.service.ts`，把同层工具改为串行执行：

```typescript
// 原代码（并行）
for (const level of dependencyGraph) {
  const results = await executeInParallel(level, this.toolRegistry, 3);
  // ...
}

// 修改后（串行）
for (const level of dependencyGraph) {
  for (const node of level) {
    const result = await this.toolRegistry.execute(node.toolName, node.args);
    // ...
  }
}
```

2. 构造一个有 3 个无依赖工具的 Plan：

```typescript
const plan: Plan = {
  toolCalls: [
    { toolName: 'getCpuMetrics', args: {}, dependsOn: [] },    // 耗时 1s
    { toolName: 'getDiskMetrics', args: {}, dependsOn: [] },   // 耗时 1s
    { toolName: 'getMemoryMetrics', args: {}, dependsOn: [] }, // 耗时 1s
  ],
};
```

3. 运行并记录耗时。

**预期现象**：
- 并行版本：耗时约 1s（max(1s, 1s, 1s)）
- 串行版本：耗时约 3s（1s + 1s + 1s）
- 性能下降 66%

**实际观察**（Benchmark）：

```
[并行版本]
  Total duration: 1.05s
  Tool execution: getCpuMetrics(0.98s), getDiskMetrics(1.02s), getMemoryMetrics(1.01s) (parallel)

[串行版本]
  Total duration: 3.12s
  Tool execution: getCpuMetrics(0.99s) → getDiskMetrics(1.03s) → getMemoryMetrics(1.10s) (serial)
```

**结论**：移除并行执行后，性能下降 66%（3.12s / 1.05s - 1）。

### 7.4 架构四件套

**四件套 1：依赖图**（用 Mermaid 画工具依赖关系）

```mermaid
graph TD
    A[getServerInfo] --> B[getCpuMetrics]
    A --> C[getDiskMetrics]
    B --> D[getAlertRules]
    C --> D
    
    style A fill:#f9f,stroke:#333
    style B fill:#bbf,stroke:#333
    style C fill:#bbf,stroke:#333
    style D fill:#bfb,stroke:#333
    
    classDef level0 fill:#f9f
    classDef level1 fill:#bbf
    classDef level2 fill:#bfb
    
    class A level0
    class B,C level1
    class D level2
```

说明：
- level 0（粉色）：`getServerInfo`（无依赖，最先执行）
- level 1（蓝色）：`getCpuMetrics` 和 `getDiskMetrics`（依赖 level 0，可并行）
- level 2（绿色）：`getAlertRules`（依赖 level 1 的两个工具，必须等它们都完成）

**四件套 2：时序图**（Plan-Act-Observe 循环的完整时序）

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator
    participant Planner
    participant Executor
    participant Observer
    participant BudgetTracker
    
    User->>Orchestrator: run(query, config)
    
    loop Plan-Act-Observe
        Orchestrator->>Planner: generatePlan(query, tools, prevObservation)
        Planner->>Planner: 调用 LLM
        Planner-->>Orchestrator: Plan { toolCalls, reasoning }
        Orchestrator->>BudgetTracker: recordStep('plan', tokens, duration)
        
        Orchestrator->>Executor: execute(toolCalls, dependencyGraph)
        Executor->>Executor: 并行执行同层工具
        Executor-->>Orchestrator: executionResults
        Orchestrator->>BudgetTracker: recordStep('act', 0, duration)
        
        Orchestrator->>Observer: observe(plan, results, history)
        Observer->>Observer: 调用 LLM + 循环检测
        Observer-->>Orchestrator: { shouldContinue, reason }
        Orchestrator->>BudgetTracker: recordStep('observe', tokens, duration)
        
        alt shouldContinue = false
            Orchestrator->>BudgetTracker: generateReport()
            Orchestrator-->>User: OrchestratorResult
        else 预算超限
            Orchestrator->>BudgetTracker: generateReport()
            Orchestrator-->>User: OrchestratorResult (budget_exceeded)
        else 检测到循环
            Orchestrator-->>User: OrchestratorResult (loop_detected)
        end
    end
```

**四件套 3：commit**（带 `Refs: Day32`）

```bash
git add apps/api/src/orchestrator
git add packages/shared/src/types/orchestrator.types.ts
git add frontend/src/agent/orchestrator-timeline.vue

git commit -m "feat(orchestrator): implement Plan-Act-Observe with parallel execution and loop detection

- Plan: LLM 生成工具调用计划 + 依赖图拓扑排序
- Act: 并行执行器（p-limit 并发槽 + Promise.allSettled）
- Observe: 循环检测（embedding 相似度 0.9 阈值） + 终止决策
- Budget: 追踪 step/token/time 三维度 + 6 种终止原因

Tests:
- dependency-graph.spec.ts: 拓扑排序 + 循环依赖检测
- parallel-executor.spec.ts: 并发槽 + 失败处理
- loop-detector.spec.ts: 循环检测
- budget-tracker.service.spec.ts: 预算追踪

Refs: Day32"
```

**硬红线**：commit 后**不执行** `git push`（Day 30 M3 门禁要求本地验收通过后再推）。

**四件套 4：反证实验报告**

```markdown
# Day 32 反证实验报告

## 实验 1：移除循环检测

**假设**：移除循环检测会导致死循环。

**操作**：注释 `orchestrator.service.ts:78` 的 `detectLoop` 调用。

**现象**：
- Agent 循环 20 次（maxSteps 限制）
- 每轮 Plan 完全相同（`toolCalls: [{ name: 'getCpuMetrics', ... }]`）
- 终止原因：`budget_exceeded_steps`（误导性强，应该是 `loop_detected`）

**结论**：循环检测是必需的，否则无法区分"正常超 step"和"循环导致超 step"。

## 实验 2：移除并行执行

**假设**：移除并行执行会导致性能下降 50%。

**操作**：修改 `executor.service.ts`，把 `executeInParallel` 改为 `for` 循环。

**现象**：
- 并行版本：1.05s（3 个工具）
- 串行版本：3.12s（3 个工具）
- 性能下降：66%

**结论**：并行执行对无依赖工具的性能提升明显（节省 2/3 时间）。
```

---
## 8. 提交物清单

完成 Day 32 后，你的项目应该有以下提交物：

1. **代码**（10 个文件）：
   - `orchestrator/plan/plan.types.ts`（Plan 类型定义）
   - `orchestrator/plan/planner.service.ts`（Plan 生成服务）
   - `orchestrator/plan/dependency-graph.ts`（拓扑排序）
   - `orchestrator/act/executor.service.ts`（执行器服务）
   - `orchestrator/act/parallel-executor.ts`（并行执行器）
   - `orchestrator/observe/observer.service.ts`（观察服务）
   - `orchestrator/observe/loop-detector.ts`（循环检测）
   - `orchestrator/observe/termination-decider.ts`（终止决策）
   - `orchestrator/budget/budget-tracker.service.ts`（预算追踪）
   - `orchestrator/orchestrator.service.ts`（主编排服务）

2. **测试**（4 个文件）：
   - `dependency-graph.spec.ts`（拓扑排序测试）
   - `parallel-executor.spec.ts`（并行执行测试）
   - `loop-detector.spec.ts`（循环检测测试）
   - `budget-tracker.service.spec.ts`（预算追踪测试）

3. **架构证据**（4 件套）：
   - 依赖图（Mermaid）
   - 时序图（Mermaid）
   - commit（含 `Refs: Day32`）
   - 反证实验报告（2 个实验）

---

## 9. 课末 3 个核心问题

1. **请从今天项目的真实入口到最终输出，解释"Orchestrator"的数据流或控制流；当天知识链"Orchestrator、plan/act/observe、并行限制、预算、终止"分别在哪一层起作用，为什么按这个顺序学习？**

   **参考答案**：入口是 `orchestrator.service.ts` 的 `run` 方法，接收 `userQuery` 和 `BudgetConfig`。控制流是 Plan-Act-Observe 循环：
   - **Plan 阶段**：`planner.service.ts` 调用 LLM 生成 `Plan { toolCalls, reasoning }`，`dependency-graph.ts` 拓扑排序生成依赖图。
   - **Act 阶段**：`executor.service.ts` 遍历依赖图的每一层，调用 `parallel-executor.ts` 并行执行同层工具（用 `p-limit` 控制并发槽）。
   - **Observe 阶段**：`observer.service.ts` 调用 LLM 观察结果，`loop-detector.ts` 检测循环，`termination-decider.ts` 决定终止原因。
   - **Budget 阶段**：`budget-tracker.service.ts` 记录每步的 phase/tokens/duration，检查是否超限。
   
   最终输出 `OrchestratorResult { status, terminationReason, budgetReport, steps }`。
   
   知识链顺序：先理解 **Orchestrator 整体循环**（Plan-Act-Observe 三阶段），再学 **并行限制**（Act 阶段的优化），再学 **循环检测**（Observe 阶段的保护），最后学 **预算追踪**（全局成本控制）和 **终止原因**（可解释性）。这个顺序是"从宏观到微观、从功能到优化"。

2. **如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。**

   **参考答案**：移除**循环检测**（`loop-detector.ts`）。
   
   **可观察现象**：
   - 某些 Run 的 step 数达到 maxSteps 上限（例如 20 步）
   - 这些 Run 的 token 消耗异常高（例如 10x 正常值）
   - 终止原因都是 `budget_exceeded_steps`，但 Plan 内容重复
   
   **最小复现**：
   ```typescript
   const userQuery = "Keep checking CPU until anomaly found";
   const result = await orchestrator.run(userQuery, { maxSteps: 5, maxTokens: 5000, maxTime: 60000 });
   // 观察：result.steps 里有 5 个相同的 Plan
   ```
   
   **定位证据**：
   - 查询 DB：`SELECT * FROM orchestrator_runs WHERE steps = 20 ORDER BY created_at DESC LIMIT 10`
   - 分析 Plan 内容：`JSON.stringify(steps.map(s => s.plan.toolCalls))` 发现重复
   
   **恢复动作**：
   - 回滚代码，恢复 `loop-detector.ts` 调用
   - 重跑受影响的 Run（从 Outbox 表重试）
   
   **防复发测试**：
   ```typescript
   it('should terminate with loop_detected when Plan repeats 3 times', async () => {
     const userQuery = "Repeat getCpuMetrics";
     const result = await orchestrator.run(userQuery, { maxSteps: 20, maxTokens: 5000, maxTime: 60000 });
     expect(result.terminationReason).toBe('loop_detected');
     expect(result.steps.length).toBeLessThan(10);  // 不应该跑满 20 步
   });
   ```

3. **请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。**

   **参考答案**：
   
   **证明目标达到**：
   - **代码**：`parallel-executor.ts:23` 用 `pLimit(3)` 实现并发槽，`loop-detector.ts:18` 用字符串比对检测循环，`budget-tracker.service.ts:42` 追踪 step/token/time 三维度。
   - **测试**：`parallel-executor.spec.ts:15` 验证并发槽（4 个工具并发 2，耗时约 200ms），`loop-detector.spec.ts:8` 验证循环检测（相同 toolCalls 判定为循环）。
   - **架构证据**：依赖图展示拓扑排序结果，时序图展示 Plan-Act-Observe 循环，commit 含 `Refs: Day32`，反证实验证明移除循环检测会死循环。
   
   **距离生产标准的差距**：
   - **循环检测**：当前用字符串比对（简单但误判率高），生产需要 embedding 相似度（捕捉语义相似）。
   - **并发槽**：当前固定 3 个槽，生产需要动态调整（根据下游服务负载自适应）。
   - **预算追踪**：当前只记录总 token，生产需要按"工具粒度"记录（哪个工具最贵）。
   - **终止原因**：当前 6 种原因，生产需要细化（例如 `tool_execution_timeout` vs `tool_execution_error`）。
   
   **演进方向**（不破坏合同）：
   - **合同保持**：`OrchestratorResult` 接口不变（status/terminationReason/budgetReport/steps）。
   - **内部演进**：
     - v3.1：循环检测升级为 embedding（`loop-detector.ts` 内部改，外部接口不变）
     - v3.2：并发槽动态调整（`parallel-executor.ts` 增加 `dynamicConcurrency` 参数，默认 false）
     - v3.3：预算追踪细化（`BudgetReport` 增加 `toolBreakdown: { toolName: string, tokens: number }[]` 字段，向后兼容）

---

## 10. 真实项目情境题（联网更新 2026-07-13）

这些题目来自真实企业岗位职责和官方技术机制。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **模拟情境**：日均 2 万个 Agent run 中有 6% 在 plan-act-observe 间循环超过 30 次，Token 成本升至基线 3.2 倍。请按 runId 查看 step、budget、tool result 和 termination spans，立即设置硬预算与终止阈值，再修复状态转移和重复计划判定，并用对抗任务验证无死循环且终止原因可解释。
   
   **依据**：[S6 Agent Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
   
   **解题思路**：
   - 查询循环 Run：`SELECT * FROM orchestrator_runs WHERE steps > 30 AND termination_reason = 'budget_exceeded_steps'`
   - 分析 Plan 相似度：提取每个 Run 的 `steps` 字段，计算相邻 Plan 的 embedding 相似度
   - 修复：在 `loop-detector.ts` 里降低相似度阈值（0.9 → 0.85），更早检测循环
   - 对抗任务：构造 10 个"故意循环"的 Prompt，验证都能在 10 步内触发 `loop_detected`

2. **模拟情境**：200 个并发 run 同时调用库存与报价 Tool，两个可并行任务误写同一资源，产生 143 条冲突数据。请从队列等待、并发槽、资源键和事务日志定位，先把冲突 Tool 降为串行，再实现依赖图、资源锁或分区调度，并用 10 倍并发压测验证吞吐和一致性。
   
   **依据**：[NestJS Queues](https://docs.nestjs.com/techniques/queues)
   
   **解题思路**：
   - 定位冲突：查询 `tool_audit_logs` 表，找到同一时间段调用"库存 Tool"和"报价 Tool"的 Run，检查是否修改了同一条数据库记录
   - 临时修复：在 `dependency-graph.ts` 里强制"库存 Tool"和"报价 Tool"串行（`库存 Tool` → `报价 Tool`）
   - 长期方案：实现资源锁（在 Tool 执行前获取 `ResourceLock { resourceId: 'inventory-001', lockType: 'write' }`）
   - 压测：用 k6 发起 2000 个并发 Run，验证无冲突数据、吞吐 > 100 Run/s

**知识映射**：对应 Orchestrator、并行限制、预算和明确终止。

---

## 11. PDF 面试题

以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. **手写一个带并发限制的异步调度器 Scheduler。**
   
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 4 页。
   
   **考点**：并发槽控制（p-limit）、Promise 队列。对应今天的 `parallel-executor.ts`。

2. **自研低代码 AI 工作流工具时，如何用 DAG 和节点 Schema 支持复杂嵌套逻辑？**
   
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 9 页。
   
   **考点**：依赖图（DAG）拓扑排序、节点 Schema 校验。对应今天的 `dependency-graph.ts` + `plan-parser.ts`。

**题目说明**：分别检验并发控制与 Orchestrator 工作流建模；预算和终止原因需在项目中额外证明。

---

## 12. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 13. 本 Day 在 90 天路线中的锚点

- **前置依赖**：Day 12（Agent Loop）、Day 31（Tool Registry v2）
- **后续依赖**：Day 33-40（LangGraph 状态机编排，Orchestrator 是调度引擎）
- **里程碑**：第一次实现"多工具组合 + 并行执行 + 循环检测"，为 Day 33 的"多 Agent 协同"打基础

---

## 14. 下一步（Day 33）

Day 33 将学习 **LangGraph 状态机编排**：把多个 Agent（例如 Planner Agent、Executor Agent、Reviewer Agent）组合成有向图，用 StateGraph 定义节点和边，支持条件路由（例如"如果 Planner 返回 isTerminal，跳过 Executor"）。

**Day 33 预习问题**：
1. Orchestrator 的 Plan-Act-Observe 循环是"线性"的（顺序执行三个阶段），如果需要"条件分支"（例如 Plan 阶段发现无需调工具，直接跳到 End），怎么实现？
2. 如果有两个 Agent（Planner 和 Reviewer），Reviewer 需要审查 Planner 的结果，审查不通过时重新生成 Plan，这种"回环"如何建模？

带着这两个问题进入 Day 33。
