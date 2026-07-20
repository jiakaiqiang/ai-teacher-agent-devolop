# Day 21：NestJS 架构深化（v1 现状耦合 → v2 Ports/Adapters 解耦 → v3 DI scope + 配置隔离）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-03 周一，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\apps\api`
角色视角：完成阶段一（Day1-20）p1-monitor 全链路、模块之间已经开始互相 import、第一次要在"不改外部合同"的前提下重构后端模块边界的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁
   Day 11-20：Tool Registry / Agent Loop / 持久化 / SSE / 时间线 / XSS / HITL / Trace / 演练 / 毕业考
   Day 21：NestJS 架构深化（模块边界 + DI scope + Ports/Adapters）  ← 今天在这里
   Day 22-30：后端深化 + M3 门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + 全栈（NestJS + LLM 集成 + RAG）

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 21 在阶段一收尾段的第 1 天**。前 20 天为了"当天能跑通"，模块之间的依赖是"哪里要用就哪里 import"，`AgentModule` 直接 import 了 `AnomalyModule` 的 Service、`MetricsModule` 又反过来 import `AgentModule` 的类型——耦合已经开始发臭。今天要在**不改任何外部合同（HTTP 路由、WebSocket 事件、SSE 格式、DB schema）** 的前提下，把模块边界重新划清楚。

### 到 Day 20 结束时项目已具备的能力

- **后端模块**（Day 6-19）：`ServersModule` / `MetricsModule` / `AnomalyModule` / `ToolsModule`（Tool Registry）/ `AgentModule`（Agent Loop）/ `PersistenceModule` / `ApprovalModule`（HITL）/ `TraceModule`
- **已经发臭的地方**：
  - `AgentModule` import `AnomalyModule`（Agent 要读异常）、`AnomalyModule` 又 import `AgentModule`（异常触发 Agent）——**双向 import**，靠 `forwardRef` 硬撑
  - `MetricsService` 里直接 `new OpenAIProvider()`——配置散落，测试时无法替换
  - `TraceModule` 被所有模块 import，但它又 import 了 `PersistenceModule`（写 trace 到 DB）——形成一个大环
- **外部合同（今天绝对不能动）**：
  - HTTP：`POST /agent/run` / `GET /agent/runs/:id` / `POST /agent/approvals/:id/decide` 等
  - WebSocket：`metrics.update` / `anomaly.detected` 事件
  - SSE：`AgentEventV1` 格式
  - DB：Prisma schema 的所有表结构

### 今天要解决的 4 个问题

1. **问题 1：双向 import 导致冷启动偶发 undefined**
   `AgentModule` 和 `AnomalyModule` 互相 import，靠 `forwardRef(() => XxxModule)` 打破编译期循环。但运行期 NestJS 的 provider 实例化顺序不确定，冷启动时偶发 `AnomalyService` 注入到 `AgentService` 时为 `undefined`（provider 还没实例化完）。测试环境因为模块加载顺序稳定，复现不了。

2. **问题 2：配置和实现硬编码，无法替换**
   `MetricsService` 构造函数里 `this.provider = new OpenAIProvider(process.env.OPENAI_KEY)`。换 Provider 要改 Service 源码；单测时无法注入 mock provider；不同环境（dev/test/prod）配置散落在各个 Service 里。

3. **问题 3：request-scoped provider 被误设为 singleton**
   多租户场景下 `TenantContext` 应该是 request-scoped（每个 HTTP 请求一个实例，隔离 `tenantId`）。如果误设为默认的 singleton，100 个并发请求共享同一个 `TenantContext` 实例，`tenantId` 互相覆盖，出现跨用户数据串台。

4. **问题 4：模块边界模糊，改一处牵连一片**
   `AgentModule` 直接依赖 `AnomalyService` 的**具体类**，`AnomalyService` 改个方法签名，`AgentModule` 就编译不过。没有接口（Port）隔离，模块之间是"实现依赖实现"而不是"实现依赖抽象"。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里做一次**纯重构**：不新增任何用户可见功能，把 `AgentModule` / `MetricsModule` / `AnomalyModule` 三个模块的边界重新划清楚。核心手段是 **Ports/Adapters（六边形架构）**：模块之间只依赖接口（Port），不依赖具体 Service；用 DI token 注入实现（Adapter）；解开 `AgentModule ↔ AnomalyModule` 的双向 import；把散落的配置收敛到 `ConfigModule` 并用 request-scoped 正确隔离租户上下文。**验收硬门禁：build/test 全绿、无新增循环依赖、外部合同零变化（HTTP/WS/SSE/DB 全部不动）**。

### 1.1 用户能看到什么

**关键**：今天是纯重构日，**用户什么变化都不应该看到**。这正是重构的成功标准——外部行为完全一致，内部结构大幅改善。

```
重构前后对比（用户视角）：

POST /agent/run
  body: { anomalyId: "a-123" }
  重构前响应：202 { runId: "r-01", status: "starting" }
  重构后响应：202 { runId: "r-01", status: "starting" }   ← 完全一致

WebSocket anomaly.detected 事件
  重构前 payload：{ anomalyId, serverId, metricType, severity }
  重构后 payload：{ anomalyId, serverId, metricType, severity }   ← 完全一致

SSE AgentEventV1
  重构前后格式、字段、顺序完全一致

DB
  重构前后 schema 零变化，migration 数量不变
```

开发者视角能看到的变化：

```
重构前 backend 模块依赖（有环）：

  AgentModule ⇄ AnomalyModule   （forwardRef 硬撑的双向依赖）
       ↓            ↓
  MetricsModule ← TraceModule → PersistenceModule
       ↑__________________________________|   （TraceModule 又被大家 import，形成大环）

重构后 backend 模块依赖（无环，单向）：

  AgentModule ──► AnomalyPort（接口）
  AnomalyModule ──► AgentTriggerPort（接口）
       两个模块都只依赖接口，不互相 import 具体类
       接口定义在独立的 contracts/ 目录，谁都能 import 但它不 import 任何人

  所有模块 ──► TracePort（接口）
  TraceModule 实现 TracePort，但不再 import PersistenceModule
       改为 PersistenceModule 实现 TraceSinkPort，TraceModule 依赖 TraceSinkPort 接口
```

### 1.2 这个模块在项目里承担什么

- **输入**：现有的 8 个后端模块（耦合、有环、配置散落）
- **输出**：模块边界清晰、依赖单向无环、配置收敛、租户上下文正确隔离的后端；外部合同（HTTP/WS/SSE/DB）零变化
- **对齐后续**：今天定义的 **Ports/Adapters 规范** 和 **DI token 命名约定** 是 Day 22-30 后端深化、阶段二（Day 31-60）LLM/RAG 大规模扩展的地基。阶段二会新增 `RagModule` / `EmbeddingModule` / `VectorStoreModule`，如果今天不把边界立清楚，到时候又是一团环

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 现状：模块互相 import 具体 Service，`forwardRef` 硬撑双向依赖 | `AgentModule` import `AnomalyModule`，构造函数注入 `AnomalyService` 具体类 | Nest Module/Provider 基础、`forwardRef` 的原理与代价 |
| **v1 痛点** | 冷启动偶发 undefined；改一个 Service 签名牵连一片；无法单测（依赖具体类） |  |  |
| **v2** | v1 + **Ports/Adapters**：模块间只依赖接口，用 DI token 注入实现 | 抽出 `contracts/anomaly.port.ts` 等接口；`AgentModule` 依赖 `ANOMALY_PORT` token | 依赖倒置原则（DIP）、Nest 自定义 provider（`useClass`/`useFactory`）、DI token |
| **v2 痛点** | 配置仍散落在各 Service；租户上下文用 singleton，并发串台 |  |  |
| **v3** | v2 + **配置隔离**（`ConfigModule` + `registerAs`）+ **request-scoped 租户上下文** | `config/` 目录集中配置；`TenantContext` 改 `Scope.REQUEST` | DI scope（DEFAULT/REQUEST/TRANSIENT）、配置命名空间、request-scoped 的性能代价与传播 |

**用户最终在项目里交付的是 v3**。v1 是重构前的现状（要先如实还原它有多烂），v2 和 v3 是重构的两个阶段。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：架构重构最怕"改到一半迷路"——你把 `AnomalyService` 抽了接口，却忘了 `AgentModule` 那边还 import 着具体类，编译一堆红。如果不先在脑子里立起"重构后的目标树"，重构过程就会变成"哪里报错改哪里"的打地鼠。看完这棵树，下面章节再出现 `contracts/anomaly.port.ts` 时，你就能立刻定位它是"模块间契约层"。

**今天在 `p1-monitor/apps/api/src/` 下重构后的目标目录树（v3 完整版）**：

```
apps/api/src/
├── contracts/                              ← 【新增】模块间契约层（只有接口，不 import 任何模块）
│   ├── anomaly.port.ts                     ← AnomalyModule 对外暴露的接口
│   ├── agent-trigger.port.ts               ← AgentModule 对外暴露的触发接口
│   ├── metrics.port.ts                     ← MetricsModule 对外暴露的接口
│   ├── trace.port.ts                       ← 追踪接口（所有模块用）
│   ├── trace-sink.port.ts                  ← 追踪落地接口（TraceModule 依赖它）
│   └── tokens.ts                           ← 所有 DI token 常量集中定义
├── config/                                 ← 【新增】配置隔离层
│   ├── llm.config.ts                       ← registerAs('llm', ...) LLM 相关配置
│   ├── agent.config.ts                     ← registerAs('agent', ...) 预算/超时配置
│   └── config.validation.ts                ← 环境变量 zod 校验（启动即失败）
├── tenant/                                 ← 【新增】租户上下文（request-scoped）
│   ├── tenant-context.ts                   ← Scope.REQUEST provider
│   └── tenant.middleware.ts                ← 从请求头解析 tenantId 注入上下文
├── agent/                                  ← 【已有，重构】
│   ├── agent.module.ts                     ← 改：依赖 ANOMALY_PORT，不 import AnomalyModule
│   ├── agent.service.ts                    ← 改：注入 AnomalyPort 接口
│   └── adapters/
│       └── agent-trigger.adapter.ts        ← 新增：实现 AgentTriggerPort
├── anomaly/                                ← 【已有，重构】
│   ├── anomaly.module.ts                   ← 改：依赖 AGENT_TRIGGER_PORT
│   ├── anomaly.service.ts                  ← 改：不再直接 new，注入接口
│   └── adapters/
│       └── anomaly.adapter.ts              ← 新增：实现 AnomalyPort
├── metrics/                                ← 【已有，重构】
│   ├── metrics.module.ts
│   ├── metrics.service.ts                  ← 改：Provider 从构造函数注入，不 new
│   └── adapters/
│       └── metrics.adapter.ts              ← 新增：实现 MetricsPort
├── trace/                                  ← 【已有，重构】
│   ├── trace.module.ts                     ← 改：不再 import PersistenceModule
│   └── trace.service.ts                    ← 改：依赖 TRACE_SINK_PORT
├── persistence/                            ← 【已有，重构】
│   └── adapters/
│       └── trace-sink.adapter.ts           ← 新增：实现 TraceSinkPort（写 trace 到 DB）
└── main.ts                                 ← 改：挂 tenant.middleware
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `contracts/*.port.ts` | ✗（直接依赖具体类） | ✓ 接口定义 | ✓ 同 v2 |
| `contracts/tokens.ts` | ✗ | ✓ DI token 常量 | ✓ 同 v2 |
| `agent.module.ts` | import AnomalyModule（forwardRef） | 依赖 ANOMALY_PORT token | ✓ 同 v2 |
| `*/adapters/*.adapter.ts` | ✗ | ✓ 实现各 Port | ✓ 同 v2 |
| `config/*.config.ts` | ✗（配置散落 Service） | ✗ | ✓ registerAs 命名空间 |
| `tenant/tenant-context.ts` | ✗（或误设 singleton） | ✗ | ✓ Scope.REQUEST |
| `config.validation.ts` | ✗ | ✗ | ✓ 启动即校验环境变量 |

**依赖方向（务必单向，反过来一次都不行）**：

```
agent.module.ts ──► contracts/anomaly.port.ts（接口）
anomaly.module.ts ──► contracts/agent-trigger.port.ts（接口）
        两个模块通过接口解耦，谁都不 import 对方的 module

contracts/*.ts        ← 最底层，只有接口和 token，不 import 任何 module
config/*.ts           ← 只 import @nestjs/config 和 zod，不 import 业务模块
tenant/*.ts           ← 只依赖 @nestjs/common，不 import 业务模块

adapters 实现接口：
  agent/adapters/agent-trigger.adapter.ts  implements  AgentTriggerPort
  anomaly/adapters/anomaly.adapter.ts       implements  AnomalyPort
  persistence/adapters/trace-sink.adapter.ts implements TraceSinkPort
```

**红线**：
- `agent.module.ts` 里出现 `import { AnomalyModule } from '../anomaly/anomaly.module'` 就是重构失败——模块间只能通过 `contracts/` 的接口和 token 连接
- `contracts/anomaly.port.ts` 里出现 `import { AnomalyService }` 是塌方——契约层不能依赖任何实现
- 任何 `forwardRef(() => XxxModule)` 出现在重构后的代码里都是失败信号——用接口解耦后不再需要 forwardRef
- `MetricsService` 里出现 `new OpenAIProvider()` 是塌方——实现必须通过 DI 注入

**动手前先问自己 3 个问题**：

1. 为什么用接口（Port）解耦就能去掉 `forwardRef`？—— 见 §5.4 知识点 2「依赖倒置打破循环」
2. DI token 为什么要用 `Symbol` 或字符串常量，而不是直接用 class？—— 见 §5.4 知识点 3「DI token 与接口注入」
3. `TenantContext` 为什么必须 request-scoped，代价是什么？—— 见 §5.4 知识点 5「DI scope 的选择与代价」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认前置 + 装依赖（3 分钟）

按第 5.3 节的代码：

- 项目 `apps/api/` 已有 `@nestjs/common` / `@nestjs/core`（Day 06 装的）
- 需要 `@nestjs/config`（配置命名空间）：`pnpm --filter api add @nestjs/config`
- 需要 `zod`（环境变量校验，Day 07 可能已装）：`pnpm --filter api add zod`
- 装依赖图分析工具（可选，用于反证循环依赖）：`pnpm --filter api add -D madge`

**边写边问自己**：

- 为什么用 `@nestjs/config` 而不是直接读 `process.env`？（`registerAs` 提供命名空间 + 类型；`process.env` 到处散落无法集中校验）
- `madge` 是干什么的？（分析模块 import 图，`madge --circular src/` 能列出所有循环依赖，重构后应该输出 0 个环）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，新建 3 个顶层目录：

```
apps/api/src/
├── contracts/     ← 【新增】模块间契约（接口 + token）
├── config/        ← 【新增】配置命名空间
└── tenant/        ← 【新增】租户上下文
```

以及在 `agent/` `anomaly/` `metrics/` `persistence/` 下各建 `adapters/` 子目录。

**边写边问自己**：

- 为什么 `contracts/` 是顶层目录而不是放在某个模块下？（契约属于"所有模块共享的公共语言"，放在任何一个模块下都会造成"别人 import 我才能拿到接口"的隐性耦合）
- `adapters/` 为什么放在各自模块下而不是集中？（Adapter 是"某模块如何实现某接口"的实现细节，属于该模块私有）

### 1.5.3 D-3：写 contracts 层（5 分钟）

按第 5.3 节的代码：

- 写 `contracts/tokens.ts`（所有 DI token 常量）
- 写 `contracts/anomaly.port.ts` / `agent-trigger.port.ts` / `metrics.port.ts` / `trace.port.ts` / `trace-sink.port.ts`

**边写边问自己**：

- token 用 `Symbol('ANOMALY_PORT')` 还是字符串 `'ANOMALY_PORT'`？（Symbol 全局唯一不会撞名；字符串在大项目里可能和别的 token 重名。本课统一用 `Symbol`）
- Port 接口里应该放具体类的所有方法，还是只放调用方真正用到的方法？（只放调用方用到的——接口隔离原则 ISP。`AgentModule` 只需要 `AnomalyPort.getAnomaly(id)`，就不要把 `AnomalyService` 的 20 个方法全塞进接口）

### 1.5.4 D-4：写 config + tenant 层（4 分钟）

按第 5.3 节的代码：

- 写 `config/llm.config.ts` / `agent.config.ts`（`registerAs` 命名空间）
- 写 `config/config.validation.ts`（zod 校验环境变量，启动即失败）
- 写 `tenant/tenant-context.ts`（`Scope.REQUEST` provider）
- 写 `tenant/tenant.middleware.ts`（解析请求头 `x-tenant-id`）

**边写边问自己**：

- `config.validation.ts` 为什么要"启动即失败"？（缺 `OPENAI_KEY` 应该在进程启动时立刻崩溃报错，而不是等到第一个用户请求进来才 500——fail fast）
- `TenantContext` 用 `Scope.REQUEST`，注入它的 Service 会怎样？（会被"污染"成 request-scoped——见 §5.4 知识点 5 的传播代价）

### 1.5.5 D-5：写 adapters + 改各 module（6 分钟）

按第 5.3 节的代码：

- 写 `anomaly/adapters/anomaly.adapter.ts`（implements AnomalyPort）
- 写 `agent/adapters/agent-trigger.adapter.ts`（implements AgentTriggerPort）
- 写 `metrics/adapters/metrics.adapter.ts`
- 写 `persistence/adapters/trace-sink.adapter.ts`
- 改 `agent.module.ts`：用 `{ provide: ANOMALY_PORT, useClass: AnomalyAdapter }`，删掉 `import AnomalyModule` 和 `forwardRef`
- 改 `anomaly.module.ts`：同理依赖 `AGENT_TRIGGER_PORT`
- 改 `trace.module.ts`：依赖 `TRACE_SINK_PORT`，删掉 `import PersistenceModule`

**边写边问自己**：

- `useClass` 和 `useFactory` 什么时候用哪个？（`useClass` 直接给实现类；`useFactory` 需要在创建时做逻辑，比如根据配置选不同 Adapter）
- 删掉 `forwardRef` 后 build 报"can't resolve dependency"怎么办？（说明还有地方直接 import 具体类；用 `madge --circular` 定位剩余的环）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"耦合→Ports/Adapters→DI scope"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `contracts/*.port.ts` 和三个 module 的 provider 配置 | 能口述"接口如何打破 forwardRef 循环"、"DI token 如何注入" |
| C：读深挖 | 35 min | §6.5 前端底子补弱（`Day21深挖-前端底子补弱.html`） | 能回答"CommonJS 循环引用返回未完成的 exports 与 Nest DI 循环的异同" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个 spec 文件（接口注入、scope 隔离、无环校验） | `pnpm --filter api test` 全绿 |
| F-1：反证 1 | 5 min | §7.7 手动制造双向 import（不用接口），观察冷启动 undefined | 验证"没有 Ports/Adapters 是什么样子" |
| F-2：反证 2 | 5 min | §7.8 把 `TenantContext` 从 REQUEST 改回 singleton，并发请求串台 | 验证"scope 错设是什么样子" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + `madge --circular` + commit | commit 含 `Refs: Day21` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：现状——模块互相 import 具体 Service（重构前基线）

### 3.1 v1 要实现什么

v1 不是"要实现"，而是**如实还原重构前的现状**，让你看清它到底烂在哪。前 20 天为了当天跑通，`AgentModule` 和 `AnomalyModule` 互相 import 对方的 Service 具体类，靠 `forwardRef` 打破编译期循环。

**目标（还原现状）**：
- `AgentService` 构造函数注入 `AnomalyService`（具体类）
- `AnomalyService` 构造函数注入 `AgentService`（具体类）
- 两个 module 用 `forwardRef(() => XxxModule)` 互相 import
- `MetricsService` 里 `new OpenAIProvider()`

### 3.2 v1 目录结构

```
apps/api/src/
├── agent/
│   ├── agent.module.ts          ← import forwardRef(() => AnomalyModule)
│   └── agent.service.ts         ← 注入 AnomalyService 具体类
├── anomaly/
│   ├── anomaly.module.ts        ← import forwardRef(() => AgentModule)
│   └── anomaly.service.ts       ← 注入 AgentService 具体类
└── metrics/
    ├── metrics.module.ts
    └── metrics.service.ts       ← new OpenAIProvider() 硬编码
```

### 3.3 v1 完整代码

**apps/api/src/anomaly/anomaly.service.ts（v1 现状）**

```typescript
import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { AgentService } from '../agent/agent.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AnomalyService {
  constructor(
    private readonly prisma: PrismaService,
    // 异常检测后要触发 Agent——直接依赖 AgentService 具体类
    @Inject(forwardRef(() => AgentService))
    private readonly agentService: AgentService,
  ) {}

  async detectAndTrigger(serverId: string, metricType: string): Promise<void> {
    const anomaly = await this.runZScore(serverId, metricType)
    if (anomaly.isAnomalous) {
      // 直接调 AgentService 的具体方法
      await this.agentService.startRun({ anomalyId: anomaly.id })
    }
  }

  async getAnomaly(id: string) {
    return this.prisma.anomaly.findUnique({ where: { id } })
  }

  private async runZScore(serverId: string, metricType: string) {
    // Day 08 已有的 Z-Score 实现
    return { id: 'a-1', isAnomalous: true }
  }
}
```

**apps/api/src/agent/agent.service.ts（v1 现状）**

```typescript
import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { AnomalyService } from '../anomaly/anomaly.service'

@Injectable()
export class AgentService {
  constructor(
    // Agent 执行时要读异常详情——直接依赖 AnomalyService 具体类
    @Inject(forwardRef(() => AnomalyService))
    private readonly anomalyService: AnomalyService,
  ) {}

  async startRun(input: { anomalyId: string }): Promise<{ runId: string }> {
    // 反过来又调 AnomalyService 的具体方法
    const anomaly = await this.anomalyService.getAnomaly(input.anomalyId)
    // ... 启动 Agent Loop ...
    return { runId: 'r-01' }
  }
}
```

**apps/api/src/agent/agent.module.ts（v1 现状）**

```typescript
import { Module, forwardRef } from '@nestjs/common'
import { AgentService } from './agent.service'
import { AnomalyModule } from '../anomaly/anomaly.module'

@Module({
  // forwardRef 硬撑双向依赖
  imports: [forwardRef(() => AnomalyModule)],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
```

**apps/api/src/anomaly/anomaly.module.ts（v1 现状）**

```typescript
import { Module, forwardRef } from '@nestjs/common'
import { AnomalyService } from './anomaly.service'
import { AgentModule } from '../agent/agent.module'

@Module({
  imports: [forwardRef(() => AgentModule)],
  providers: [AnomalyService],
  exports: [AnomalyService],
})
export class AnomalyModule {}
```

**apps/api/src/metrics/metrics.service.ts（v1 现状）**

```typescript
import { Injectable } from '@nestjs/common'
import { OpenAIProvider } from '../agent/provider/openai-provider'

@Injectable()
export class MetricsService {
  // 配置和实现硬编码在构造函数里
  private readonly provider = new OpenAIProvider(process.env.OPENAI_KEY ?? '')

  async summarize(serverId: string): Promise<string> {
    // 用 this.provider 生成指标摘要
    return 'summary'
  }
}
```

### 3.4 v1 暴露的痛点

**痛点 1：冷启动偶发 provider undefined**

`forwardRef` 只是骗过 TypeScript 的编译期循环检查，运行期 NestJS 仍要决定"先实例化 AgentService 还是 AnomalyService"。绝大多数情况下顺序稳定，但在冷启动、模块加载顺序变化（比如新增一个模块打乱了顺序）时，偶发 `AgentService` 拿到的 `anomalyService` 是 `undefined`（对方还没实例化完）。调 `this.anomalyService.getAnomaly()` 直接 `Cannot read property of undefined`。测试环境模块加载顺序固定，复现不了，只在生产冷启动偶现。

**痛点 2：改一个 Service 签名牵连一片**

`AgentService.startRun` 依赖 `AnomalyService.getAnomaly` 的具体签名。哪天 `getAnomaly` 改成 `getAnomaly(id, options)`，`AgentService` 立刻编译不过。两个模块是"实现依赖实现"，任何一方改动都可能波及另一方。

**痛点 3：无法单测**

要单测 `AgentService`，就得构造一个真的 `AnomalyService`，而 `AnomalyService` 又依赖 `PrismaService` 和 `AgentService`……依赖链无限展开。没有接口隔离，mock 无从下手。

**痛点 4：配置散落、无法替换 Provider**

`MetricsService` 里 `new OpenAIProvider(process.env.OPENAI_KEY)`。换成 Anthropic 要改源码；单测想注入 mock provider 做不到；`OPENAI_KEY` 这类配置散落在十几个 Service 里，没有统一校验，缺失时到运行才报错。

---

## 4. v2：引入 Ports/Adapters 打破循环依赖

### 4.1 v2 要实现什么

用户视角：外部 HTTP/事件行为完全不变，但内部 `AgentModule` 和 `AnomalyModule` 不再互相 import 具体类，`forwardRef` 全部删除，`madge --circular` 输出 0 个环。

**做法**：
- 在 `contracts/` 定义 `AnomalyPort` / `AgentTriggerPort` 接口 + DI token
- `AgentService` 依赖 `AnomalyPort`（接口），不依赖 `AnomalyService`（类）
- `AnomalyService` 依赖 `AgentTriggerPort`（接口），不依赖 `AgentService`（类）
- 每个模块在自己内部提供 Adapter 实现对方需要的 Port

**依然不做**：
- 配置还没抽到 `@nestjs/config`（下一版）
- 租户 scope 隔离还没做（下一版）

### 4.2 v2 目录结构

```
apps/api/src/
├── contracts/
│   ├── tokens.ts                    ← 新增：DI token 常量
│   ├── anomaly.port.ts              ← 新增：Agent 需要的异常读取接口
│   └── agent-trigger.port.ts        ← 新增：Anomaly 需要的 Agent 触发接口
├── agent/
│   ├── adapters/
│   │   └── agent-trigger.adapter.ts ← 新增：实现 AgentTriggerPort
│   ├── agent.module.ts              ← 改：删 forwardRef，provide token
│   └── agent.service.ts             ← 改：注入 AnomalyPort 接口
└── anomaly/
    ├── adapters/
    │   └── anomaly.adapter.ts        ← 新增：实现 AnomalyPort
    ├── anomaly.module.ts             ← 改：删 forwardRef，provide token
    └── anomaly.service.ts            ← 改：注入 AgentTriggerPort 接口
```

### 4.3 v2 完整代码

**apps/api/src/contracts/tokens.ts（v2 全文）**

```typescript
/**
 * 所有模块间契约的 DI token。
 * 用 Symbol 保证全局唯一，绝不与其他 token 撞名。
 */
export const ANOMALY_PORT = Symbol('ANOMALY_PORT')
export const AGENT_TRIGGER_PORT = Symbol('AGENT_TRIGGER_PORT')
export const METRICS_PORT = Symbol('METRICS_PORT')
```

**apps/api/src/contracts/anomaly.port.ts（v2 全文）**

```typescript
/**
 * AgentModule 需要"读异常详情"的能力。
 * 接口隔离原则（ISP）：只声明 Agent 真正用到的方法，
 * 不把 AnomalyService 的全部 20 个方法都塞进来。
 */
export interface AnomalyDetail {
  id: string
  serverId: string
  metricType: string
  severity: 'low' | 'medium' | 'high'
}

export interface AnomalyPort {
  getAnomaly(id: string): Promise<AnomalyDetail | null>
}
```

**apps/api/src/contracts/agent-trigger.port.ts（v2 全文）**

```typescript
/**
 * AnomalyModule 需要"触发一次 Agent Run"的能力。
 * 同样只暴露一个方法，Anomaly 不需要知道 Agent 内部循环怎么跑。
 */
export interface AgentTriggerPort {
  startRun(input: { anomalyId: string }): Promise<{ runId: string }>
}
```

**apps/api/src/agent/agent.service.ts（v2）**

```typescript
import { Injectable, Inject } from '@nestjs/common'
import { ANOMALY_PORT } from '../contracts/tokens'
import type { AnomalyPort } from '../contracts/anomaly.port'

@Injectable()
export class AgentService {
  constructor(
    // 依赖接口，不依赖 AnomalyService 具体类
    @Inject(ANOMALY_PORT)
    private readonly anomalyPort: AnomalyPort,
  ) {}

  async startRun(input: { anomalyId: string }): Promise<{ runId: string }> {
    const anomaly = await this.anomalyPort.getAnomaly(input.anomalyId)
    if (!anomaly) {
      throw new Error(`anomaly not found: ${input.anomalyId}`)
    }
    // ... 启动 Agent Loop（用 anomaly.serverId / metricType）...
    return { runId: 'r-01' }
  }
}
```

**apps/api/src/anomaly/anomaly.service.ts（v2）**

```typescript
import { Injectable, Inject } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AGENT_TRIGGER_PORT } from '../contracts/tokens'
import type { AgentTriggerPort } from '../contracts/agent-trigger.port'

@Injectable()
export class AnomalyService {
  constructor(
    private readonly prisma: PrismaService,
    // 依赖接口，不依赖 AgentService 具体类
    @Inject(AGENT_TRIGGER_PORT)
    private readonly agentTrigger: AgentTriggerPort,
  ) {}

  async detectAndTrigger(serverId: string, metricType: string): Promise<void> {
    const anomaly = await this.runZScore(serverId, metricType)
    if (anomaly.isAnomalous) {
      await this.agentTrigger.startRun({ anomalyId: anomaly.id })
    }
  }

  async getAnomaly(id: string) {
    return this.prisma.anomaly.findUnique({ where: { id } })
  }

  private async runZScore(serverId: string, metricType: string) {
    return { id: 'a-1', isAnomalous: true }
  }
}
```

**apps/api/src/anomaly/adapters/anomaly.adapter.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import type { AnomalyPort, AnomalyDetail } from '../../contracts/anomaly.port'
import { AnomalyService } from '../anomaly.service'

/**
 * Adapter：把 AnomalyService 的能力"适配"成 AnomalyPort 接口。
 * AgentModule 拿到的是这个 Adapter（通过 ANOMALY_PORT token），
 * 完全不知道背后是 AnomalyService。
 */
@Injectable()
export class AnomalyAdapter implements AnomalyPort {
  constructor(private readonly anomalyService: AnomalyService) {}

  async getAnomaly(id: string): Promise<AnomalyDetail | null> {
    const raw = await this.anomalyService.getAnomaly(id)
    if (!raw) return null
    // 把 Prisma 模型投影成契约里的 AnomalyDetail（防止内部字段泄漏）
    return {
      id: raw.id,
      serverId: raw.serverId,
      metricType: raw.metricType,
      severity: raw.severity as AnomalyDetail['severity'],
    }
  }
}
```

**apps/api/src/agent/adapters/agent-trigger.adapter.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import type { AgentTriggerPort } from '../../contracts/agent-trigger.port'
import { AgentService } from '../agent.service'

@Injectable()
export class AgentTriggerAdapter implements AgentTriggerPort {
  constructor(private readonly agentService: AgentService) {}

  async startRun(input: { anomalyId: string }): Promise<{ runId: string }> {
    return this.agentService.startRun(input)
  }
}
```

**apps/api/src/agent/agent.module.ts（v2）**

```typescript
import { Module } from '@nestjs/common'
import { AgentService } from './agent.service'
import { AgentTriggerAdapter } from './adapters/agent-trigger.adapter'
import { AnomalyAdapter } from '../anomaly/adapters/anomaly.adapter'
import { AnomalyService } from '../anomaly/anomaly.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ANOMALY_PORT, AGENT_TRIGGER_PORT } from '../contracts/tokens'

@Module({
  imports: [PrismaModule],
  providers: [
    AgentService,
    AnomalyService,
    // 本模块需要的 AnomalyPort：用 AnomalyAdapter 实现
    { provide: ANOMALY_PORT, useClass: AnomalyAdapter },
    // 本模块对外提供的 AgentTriggerPort
    { provide: AGENT_TRIGGER_PORT, useClass: AgentTriggerAdapter },
  ],
  exports: [AGENT_TRIGGER_PORT, AgentService],
})
export class AgentModule {}
```

> 说明：v2 为了先打破循环，把 `AnomalyService` 临时放进 `AgentModule` 的 providers。这仍不够干净（两个模块各自持有对方 Service 实例），v3 会用共享的 `SharedDomainModule` + `exports` token 彻底理顺，让每个 Service 只实例化一次。

### 4.4 v2 暴露的痛点

**痛点 1：配置仍然硬编码散落**

`MetricsService` 里还是 `new OpenAIProvider(process.env.OPENAI_KEY)`。Ports/Adapters 解决了模块间循环，但没解决"配置从哪来"。`OPENAI_KEY` 缺失仍是运行期才报错，换 Provider 仍要改源码。

**痛点 2：Service 被重复实例化**

v2 里 `AnomalyService` 同时出现在 `AnomalyModule.providers` 和 `AgentModule.providers`，NestJS 会在两个模块各实例化一次。如果 `AnomalyService` 持有状态（缓存、连接池），两个实例状态不一致，出诡异 bug。

**痛点 3：没有租户隔离**

100 个并发请求进来，所有请求共享同一个单例 Service。如果 Service 里存了 `this.tenantId`（比如从第一个请求拿到的），后续请求会读到别人的 tenantId——跨用户数据串台。这是本课情境题 2 的核心风险，v2 没有防护。

---

## 5. v3：DI scope + 配置隔离 + 共享域模块（终态）

### 5.1 v3 要实现什么

用户视角：
1. 外部 HTTP/事件合同零变化（继承 v2）
2. `madge --circular src/` 输出 0 个环（继承 v2）
3. 每个 Service 全局只实例化一次（消除 v2 的重复实例化）
4. 配置全部经 `@nestjs/config` + 校验 schema，缺 key 在**启动期**（不是运行期）就 fail-fast
5. `tenantId` 用 `REQUEST` scope 隔离，100 并发请求互不串台

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/
├── contracts/
│   ├── tokens.ts                        ← v2 已有
│   ├── anomaly.port.ts                  ← v2 已有
│   ├── agent-trigger.port.ts            ← v2 已有
│   └── metrics.port.ts                  ← 新增
├── shared/
│   ├── shared-domain.module.ts          ← 新增：统一实例化 + re-export
│   └── request-context.ts               ← 新增：REQUEST scope 租户上下文
├── config/
│   ├── config.schema.ts                 ← 新增：zod 环境变量校验
│   └── config.module.ts                 ← 新增：@nestjs/config 封装
├── agent/
│   ├── adapters/agent-trigger.adapter.ts ← v2 已有
│   ├── agent.module.ts                  ← 改：import SharedDomainModule
│   └── agent.service.ts                 ← 改：注入 RequestContext
├── anomaly/
│   ├── adapters/anomaly.adapter.ts       ← v2 已有
│   ├── anomaly.module.ts                ← 改：import SharedDomainModule
│   └── anomaly.service.ts               ← v2 已有
└── metrics/
    ├── metrics.module.ts
    └── metrics.service.ts               ← 改：从 ConfigService 读 key
```

### 5.3 v3 完整代码

#### 5.3.1 config 层：config.schema.ts

```typescript
import { z } from 'zod'

/**
 * 环境变量校验 schema。
 * 启动期一次性校验：缺 key、格式错、端口非数字 —— 直接 fail-fast，
 * 而不是等某个请求走到 new OpenAIProvider() 才崩。
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY 不能为空'),
  OPENAI_BASE_URL: z.string().url().optional(),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(20),
})

export type AppConfig = z.infer<typeof configSchema>
```

#### 5.3.2 config 层：config.module.ts

```typescript
import { Global, Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config'
import { configSchema } from './config.schema'

/**
 * @Global：配置到处都要用，标记为全局模块避免每个模块都 import。
 * validate：启动期跑 zod 校验，抛错则进程不启动。
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => {
        const parsed = configSchema.safeParse(raw)
        if (!parsed.success) {
          // 启动期 fail-fast：打印所有缺失/错误的字段
          const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n')
          throw new Error(`环境变量校验失败：\n${issues}`)
        }
        return parsed.data
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
```

#### 5.3.3 shared 层：request-context.ts

```typescript
import { Injectable, Scope, Inject } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import type { Request } from 'express'

/**
 * REQUEST scope：NestJS 为【每个进来的 HTTP 请求】新建一个实例。
 * 这是解决"跨用户 tenantId 串台"的关键——单例会共享状态，
 * request-scope 保证每个请求有自己独立的 tenantId。
 */
@Injectable({ scope: Scope.REQUEST })
export class RequestContext {
  readonly tenantId: string
  readonly traceId: string

  constructor(@Inject(REQUEST) req: Request) {
    // 从请求头拿租户和 trace（Day 18 已建立 traceId 传播）
    this.tenantId = (req.headers['x-tenant-id'] as string) ?? 'unknown'
    this.traceId = (req.headers['x-trace-id'] as string) ?? 'no-trace'
  }
}
```

#### 5.3.4 shared 层：shared-domain.module.ts

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AnomalyService } from '../anomaly/anomaly.service'
import { AgentService } from '../agent/agent.service'
import { MetricsService } from '../metrics/metrics.service'
import { AnomalyAdapter } from '../anomaly/adapters/anomaly.adapter'
import { AgentTriggerAdapter } from '../agent/adapters/agent-trigger.adapter'
import { RequestContext } from './request-context'
import {
  ANOMALY_PORT,
  AGENT_TRIGGER_PORT,
  METRICS_PORT,
} from '../contracts/tokens'

/**
 * 共享域模块：统一实例化所有跨模块 Service + Adapter，
 * 通过 exports 让 AgentModule / AnomalyModule 复用同一份实例，
 * 消除 v2 的"重复实例化"问题。
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AnomalyService,
    AgentService,
    MetricsService,
    RequestContext,
    { provide: ANOMALY_PORT, useClass: AnomalyAdapter },
    { provide: AGENT_TRIGGER_PORT, useClass: AgentTriggerAdapter },
    { provide: METRICS_PORT, useClass: MetricsService },
  ],
  exports: [
    ANOMALY_PORT,
    AGENT_TRIGGER_PORT,
    METRICS_PORT,
    AgentService,
    AnomalyService,
    MetricsService,
    RequestContext,
  ],
})
export class SharedDomainModule {}
```

#### 5.3.5 metrics 层：metrics.service.ts（从 ConfigService 读 key）

```typescript
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/config.schema'
import type { MetricsPort } from '../contracts/metrics.port'

@Injectable()
export class MetricsService implements MetricsPort {
  private readonly apiKey: string
  private readonly baseUrl?: string

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    // 配置从 ConfigService 拿，已在启动期校验过，这里保证非空
    this.apiKey = this.config.get('OPENAI_API_KEY', { infer: true })
    this.baseUrl = this.config.get('OPENAI_BASE_URL', { infer: true })
  }

  async getMetrics(serverId: string, metricType: string) {
    // ... 用 this.apiKey / this.baseUrl 调用 ...
    return { serverId, metricType, points: [] as number[] }
  }
}
```

#### 5.3.6 agent 层：agent.service.ts（注入 RequestContext）

```typescript
import { Injectable, Inject } from '@nestjs/common'
import { ANOMALY_PORT } from '../contracts/tokens'
import type { AnomalyPort } from '../contracts/anomaly.port'
import { RequestContext } from '../shared/request-context'

@Injectable()
export class AgentService {
  constructor(
    @Inject(ANOMALY_PORT)
    private readonly anomalyPort: AnomalyPort,
    // 注入 request-scoped 上下文；AgentService 自身也会被提升为 request scope
    private readonly ctx: RequestContext,
  ) {}

  async startRun(input: { anomalyId: string }): Promise<{ runId: string }> {
    const anomaly = await this.anomalyPort.getAnomaly(input.anomalyId)
    if (!anomaly) {
      throw new Error(`anomaly not found: ${input.anomalyId}`)
    }
    // tenantId 来自当前请求，绝不会串到别的请求
    const tenantId = this.ctx.tenantId
    // ... 启动 Agent Loop，落库时带上 tenantId ...
    return { runId: `r-${tenantId}-01` }
  }
}
```

#### 5.3.7 agent 层：agent.module.ts（v3）

```typescript
import { Module } from '@nestjs/common'
import { SharedDomainModule } from '../shared/shared-domain.module'

/**
 * v3：AgentModule 不再自己 provide 一堆东西，
 * 只 import SharedDomainModule，复用共享实例。
 * controller 在这里挂（省略）。
 */
@Module({
  imports: [SharedDomainModule],
})
export class AgentModule {}
```

#### 5.3.8 契约测试：contract-stability.spec.ts

```typescript
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'

/**
 * 重构的核心验收：外部合同零变化。
 * 这个测试在重构前先跑一遍存基线，重构后再跑必须完全一致。
 */
describe('外部合同稳定性（重构前后必须一致）', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /agent/run 返回结构不变', async () => {
    const res = await request(app.getHttpServer())
      .post('/agent/run')
      .set('x-tenant-id', 'tenant-a')
      .send({ anomalyId: 'a-123' })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('runId')
    // 合同字段快照：重构不允许改这些字段名
    expect(Object.keys(res.body).sort()).toEqual(['runId'])
  })

  it('并发 100 请求 tenantId 不串台', async () => {
    const server = app.getHttpServer()
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        request(server)
          .post('/agent/run')
          .set('x-tenant-id', `tenant-${i}`)
          .send({ anomalyId: 'a-123' }),
      ),
    )
    // 每个响应的 runId 应该带自己的 tenantId
    results.forEach((res, i) => {
      expect(res.body.runId).toContain(`tenant-${i}`)
    })
  })
})
```

### 5.4 v3 用到的知识点

#### 知识点 1：Module 边界（按业务能力划分，不按技术分层）

- **解决的问题**：把所有 controller 放一个 `controllers/` 目录、所有 service 放 `services/` 目录，看起来整齐，但改一个业务要跨 5 个目录，且无法限制"谁能调谁"。
- **运行机制**：NestJS Module 是 DI 容器的边界单元。一个 provider 只有被本模块 `providers` 声明或从其他模块 `exports` 才能注入。这个边界就是"访问控制"。
- **项目落点**：`agent/` `anomaly/` `metrics/` 按业务能力划分；每个模块内部才有 controller/service/adapter 分层。
- **生产误区**：把 `AgentController` 放进 `AnomalyModule`（边界错乱）；一个 `CommonModule` 塞几十个不相关 provider（变成垃圾桶）。
- **验证方法**：`madge --circular src/` 无环；删掉某模块的 export，依赖它的模块应该编译失败（证明边界被 DI 强制）。

#### 知识点 2：DI Scope（DEFAULT / REQUEST / TRANSIENT）

- **解决的问题**：单例（DEFAULT）在整个进程生命周期只有一个实例，如果它持有 `this.tenantId` 这种请求相关状态，100 个并发请求会互相覆盖。
- **运行机制**：`DEFAULT` 全局单例；`REQUEST` 每个请求一个实例（NestJS 通过 DI 树的"scope 传染"把依赖它的 provider 也变成 request scope）；`TRANSIENT` 每次注入都新建。
- **项目落点**：`RequestContext` 用 `Scope.REQUEST`，注入它的 `AgentService` 自动变成 request scope。
- **生产误区**：把 request-scoped 错标 singleton → 跨用户串台（情境题 2）；滥用 request scope（每个请求都重建整棵依赖树，性能损耗大）。
- **验证方法**：并发 100 请求带不同 `x-tenant-id`，断言每个响应带自己的 tenantId（见 `contract-stability.spec.ts`）。

#### 知识点 3：Ports/Adapters（六边形架构）

- **解决的问题**：两个模块互相依赖具体类 → 循环依赖 → `forwardRef` 补丁 → 冷启动偶发 `undefined`（情境题 1）。
- **运行机制**：定义接口（Port）+ DI token；依赖方注入接口，提供方写 Adapter 实现接口。双方都只认接口，编译期就不存在"A 类 import B 类且 B 类 import A 类"的环。
- **项目落点**：`contracts/anomaly.port.ts` + `anomaly/adapters/anomaly.adapter.ts`；`AgentService` 注入 `ANOMALY_PORT` 而非 `AnomalyService`。
- **生产误区**：Port 接口把 Service 的全部方法都抄一遍（违反接口隔离，等于没解耦）；Adapter 里写业务逻辑（Adapter 只做投影/转换）。
- **验证方法**：删除 `forwardRef`，`madge --circular` 仍为 0；给 Port 换一个 Mock Adapter，`AgentService` 单测无需启动 `AnomalyModule`。

#### 知识点 4：循环依赖的三种解法与取舍

- **解决的问题**：Nest 冷启动时 provider 实例化有先后，环上的 provider 可能拿到 `undefined`。
- **运行机制**：三种解法 —— (a) `forwardRef` 让 Nest 延迟解析（治标，仍是环）；(b) 抽公共依赖到第三个模块（消除环）；(c) Ports/Adapters 用接口反转依赖（本课选的，最干净）。
- **项目落点**：本课删掉所有 `forwardRef`，改用 (c)；共享实例用 (b) 的 `SharedDomainModule`。
- **生产误区**：无脑 `forwardRef` 掩盖设计问题；环还在，只是"暂时不崩"。
- **验证方法**：`madge --circular` 前后对比（重构前 N 个环 → 重构后 0）；冷启动 100 次无 `undefined` provider 错误。

#### 知识点 5：配置隔离与启动期校验（fail-fast）

- **解决的问题**：`process.env.OPENAI_KEY` 散落各处，缺失时运行到某个请求才崩，且难定位。
- **运行机制**：`@nestjs/config` + zod `validate`，启动时一次性校验所有 env，缺失/格式错直接抛错、进程不启动。Service 通过 `ConfigService` 类型安全地读。
- **项目落点**：`config/config.schema.ts` + `config.module.ts`；`MetricsService` 从 `ConfigService` 读 key。
- **生产误区**：把校验放运行期（第一个请求才发现缺 key）；把 key 打到日志（Day 18 脱敏红线）。
- **验证方法**：删掉 `OPENAI_API_KEY` 后 `pnpm start` 立即报"环境变量校验失败"并列出字段，进程退出码非 0。

#### 知识点 6：契约稳定性测试（重构的安全网）

- **解决的问题**：重构最大的风险是"内部改干净了，外部行为悄悄变了"。
- **运行机制**：重构前对所有外部端点跑一遍测试存快照（状态码、响应字段名、事件结构）；重构后再跑必须完全一致。
- **项目落点**：`test/contract-stability.spec.ts`，覆盖 HTTP 端点 + WS/SSE 事件结构。
- **生产误区**：重构后才补测试（失去基线）；只测 happy path，不测响应字段名（改字段名不报错）。
- **验证方法**：重构前 `git stash` 存基线输出，重构后 diff 为空。

### 5.5 边写边问自己

- Ports/Adapters 的接口应该定义在 `contracts/`（中立）还是消费方模块里？（中立目录，否则又制造依赖方向问题）
- `SharedDomainModule` 会不会变成新的"垃圾桶模块"？（只放真正跨模块共享的；单模块私有的 Service 不进来）
- request scope 传染到 controller 后，每请求重建依赖树，QPS 高时怎么办？（只让最小子树 request scope；重的单例依赖用 `TRANSIENT` 边界隔离，或改用 `AsyncLocalStorage` 存 tenantId 而不提升整树 scope）

---

## 6. 三版对比一览表

| 维度 | v1（现状耦合） | v2（Ports/Adapters 解耦） | v3（DI scope + 配置隔离） |
|---|---|---|---|
| **功能** | 三模块互相 import 具体类 | 用接口反转依赖，解开循环 | 统一实例化 + request 隔离 + 配置校验 |
| **模块依赖** | AgentModule ↔ AnomalyModule 双向 | 单向：都依赖 `contracts/` | 单向 + `SharedDomainModule` 复用 |
| **循环依赖** | 有环，靠 `forwardRef` 撑 | `madge --circular` = 0 | = 0（且删掉所有 forwardRef） |
| **实例化** | 各模块各自 new，重复实例 | 仍有重复实例 | 全局单份实例（shared 统一 provide） |
| **DI scope** | 全 singleton（tenantId 会串台） | 全 singleton | RequestContext = REQUEST scope |
| **配置管理** | `process.env.X` 散落各处 | 同 v1 | ConfigService + zod 启动期校验 |
| **配置缺失时** | 运行期某请求崩 | 运行期崩 | 启动期 fail-fast，进程不起 |
| **换实现代价** | 改 import + 改构造函数 | 换 Adapter 一行 | 换 Adapter 一行 |
| **对齐后续 Day** | —— | Day 22-30 复用 Port | Day 31+ p1 全栈多租户地基 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

> 本节是**后端架构深化**日，但"依赖注入 / 控制反转 / 循环依赖"是前后端通吃的架构概念。前端 Vue 的 `provide/inject`、React 的 Context、Angular 的 DI 本质同源。深挖 HTML 从今天的 Ports/Adapters 讲起，横向对照前端框架的 DI 心智模型。

**深挖文档**：`output/Day21深挖-前端底子补弱.html`（需另建，8 子节结构见教学规范 §6.1）

今天深挖的 4 个锚点：

1. **深挖 1：控制反转（IoC）—— 从 `@Inject(ANOMALY_PORT)` 讲起**
   对照 Vue3 `provide('anomalyPort', impl)` / `inject('anomalyPort')`，讲清"谁创建、谁持有、谁注入"。
2. **深挖 2：循环依赖 —— 从 CommonJS vs ESM 的加载差异讲起**
   PDF 面试题 1 的直接展开：`require` 循环拿到半成品 `exports`，ESM 循环拿到 TDZ 未初始化绑定。
3. **深挖 3：DI Scope 传染 —— 从 request-scope 讲起**
   对照前端"组件级 provide vs 应用级 provide"的生命周期差异。
4. **深挖 4：接口隔离原则 —— 从 Port 接口该多大讲起**
   为什么 Port 不该把 Service 全部方法抄一遍。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按第 5.3 节的代码，补齐 3 个测试文件：

- `test/contract-stability.spec.ts`（外部合同快照 + 并发 tenantId 隔离，见 §5.3.8）
- `agent/agent.service.spec.ts`（用 Mock Adapter 注入 `ANOMALY_PORT`，无需启动 AnomalyModule）
- `config/config.schema.spec.ts`（缺 key、格式错、默认值三类用例）

运行：`pnpm --filter api test`，要求全绿。

### 7.7 F-1：反证实验 1（5 分钟）—— 故意制造循环依赖

在 `agent.service.ts` 里把 `@Inject(ANOMALY_PORT) anomalyPort: AnomalyPort` 改回 `private readonly anomalyService: AnomalyService`，并在 `AgentModule` import `AnomalyModule`、`AnomalyModule` import `AgentModule`。

观察：
- `pnpm --filter api start` 冷启动，看 Nest 是否报 `Nest can't resolve dependencies` 或 provider `undefined`
- `npx madge --circular src/` 输出新增的环

记录现象后**还原代码**。这验证了"没有 Ports/Adapters 时循环依赖长什么样"。

### 7.8 F-2：反证实验 2（5 分钟）—— 把 request scope 错设为 singleton

把 `RequestContext` 的 `@Injectable({ scope: Scope.REQUEST })` 改成 `@Injectable()`（默认 singleton）。

观察：
- 跑 `contract-stability.spec.ts` 的"并发 100 请求"用例
- 断言失败：多个请求的 `runId` 里的 tenantId 互相串台（拿到的是最后一个请求覆盖的值）

记录现象后**还原代码**。这验证了情境题 2 的"跨用户数据串台"根因。

### 7.9 F-3：验证 + 提交（10 分钟）

四件套全绿：

```bash
pnpm --filter api typecheck && \
pnpm --filter api lint && \
pnpm --filter api test && \
pnpm --filter api build
```

外加架构专属校验：

```bash
npx madge --circular apps/api/src/    # 必须输出 "No circular dependency found!"
```

Conventional Commits 提交模板：

```
refactor(api): 按 Ports/Adapters 重构 Agent/Anomaly/Metrics 模块边界

- 抽出 contracts/ 定义 Port 接口 + DI token，反转模块依赖方向
- 删除所有 forwardRef，madge --circular 归零
- RequestContext 用 REQUEST scope 隔离 tenantId
- @nestjs/config + zod 启动期校验环境变量（fail-fast）
- 外部 HTTP/事件合同零变化（contract-stability.spec.ts 快照一致）

Refs: Day21
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day22 结束时集中 push。

---

## 8. 通过标准

- [ ] `pnpm --filter api build` / `test` / `lint` / `typecheck` 四件套全绿
- [ ] `npx madge --circular apps/api/src/` 输出 0 个环
- [ ] 外部 HTTP/事件合同零变化（`contract-stability.spec.ts` 重构前后快照一致）
- [ ] 删除了所有 `forwardRef`
- [ ] `RequestContext` 是 REQUEST scope，并发 100 请求 tenantId 不串台
- [ ] 缺 `OPENAI_API_KEY` 时进程启动期 fail-fast，退出码非 0
- [ ] 提交了后端模块依赖图（重构前 vs 后）+ ADR（为什么选 Ports/Adapters 而非 forwardRef）

---

## 9. 提交物

1. commit（含 `Refs: Day21`，未执行 `git push`）
2. 四件套输出截图 + `madge --circular` 输出（重构前后对比）
3. 后端模块依赖图（C4 Component 级）：重构前（有环）vs 重构后（无环）
4. ADR：《为什么用 Ports/Adapters 解循环依赖而不是 forwardRef》
5. 学习日志：三版演进中你踩的坑（尤其 request scope 传染）
6. AI Review 记录：AI 帮你机械移动了哪些文件、你拒绝了哪些"顺手重构"建议

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（`POST /agent/run`）到最终输出，解释重构后的控制流；知识链"Module 边界 → DI scope → Ports/Adapters → 循环依赖 → 配置隔离"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果把 `RequestContext` 从 REQUEST scope 改回 singleton，线上会出现什么可观察现象？请给出最小复现（并发请求带不同 tenantId）、定位证据（SQL tenant 条件 + provider instance id）、恢复动作和一条防复发测试。
3. 请引用今天的 `contract-stability.spec.ts` 和 `madge` 输出，证明"外部合同零变化 + 循环依赖归零"已达成；再说明当前 DI 设计距离企业生产标准还缺什么（如 AsyncLocalStorage 替代 request scope 提升性能），下一步如何演进。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 重构后 `AgentModule` 与 `AnomalyModule` 互相 import，冷启动偶发 provider 为 undefined；测试环境未复现。请用模块依赖图、Nest 启动日志和实例 scope 定位；先回滚重构止损，再以 Ports/Adapters 解开循环并隔离配置，验证外部 API/事件合同零变化。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S23 NestJS modules](https://docs.nestjs.com/modules)
2. 把 request-scoped provider 错设为 singleton 后，100 并发请求共享 tenantId，出现跨用户数据串台。请记录 provider instance、请求上下文和 SQL tenant 条件定位；先禁用共享缓存止损，再修复 DI scope 与边界适配器，执行并发隔离 E2E 验证泄漏为 0。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：Nest Module 边界、DI scope、循环依赖、Ports/Adapters 与配置隔离。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. Node.js 的模块加载机制是怎样的？循环引用时 CommonJS 与 ESM 有什么差异？
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 4 页。
2. 如何解决 Agent 流程图中的循环依赖问题？
   来源：[《2026京东前端面试-大模型方向》](<../../资源/2026京东前端面试-大模型方向.pdf>)，第 12 页。

题目说明：映射 Nest Module 边界、循环依赖、Ports/Adapters；资料中没有直接 Nest DI scope 原题。第一题的 CommonJS/ESM 循环加载差异见 §6.5 深挖 2。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 11-20 建立的 Agent/Tool/Metrics/Anomaly 各模块（阶段一），此时代码能跑但模块边界混乱、有隐式循环依赖。
- **今天**：不加新功能，纯粹重构模块边界 —— 用 Ports/Adapters 解耦、DI scope 隔离租户、配置集中校验。这是从"能跑的原型"到"可维护的工程"的关键一课。
- **指向**：
  - Day 22-25：在干净的模块边界上接入 LangChain RAG（新模块只依赖 `contracts/` Port，不碰其他模块内部）
  - Day 30：M3 门禁会检查"新增模块是否遵守依赖方向 + 无循环依赖"
  - Day 31+：p1 全栈多租户，今天的 `RequestContext` + tenantId 隔离是多租户数据隔离的地基
