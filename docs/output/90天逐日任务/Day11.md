# Day 11：Tool Registry（v1 直接暴露 → v2 Schema 守门 → v3 完整审计）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-07-24 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：有 NestJS 后端经验、第一次为 Agent 场景设计 Tool 的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + Python/FastAPI + RAG）
   Day 11-20：Tool Registry + LangChain RAG + 向量检索
   Day 21-30：Agent 编排 + LangGraph 状态机

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 11 处在阶段一第 11 天**，Day 10 M2 门禁通过后，`p1-monitor` 后端已经具备完整的 CRUD + 状态机能力。从今天开始引入 **Agent Tool Calling**：让 LLM 能够调用后端的真实数据查询函数。

Day 11 的核心任务是搭建 **Tool Registry**——一个管理所有 Agent 工具的中央注册表，具备 Schema 校验、超时保护、结果裁剪和审计能力。这个 Registry 会被后面 Day 12（LangChain 集成）、Day 15（RAG 工具）、Day 18（多工具编排）反复使用。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`ToolsModule`**：注册三个只读运维工具（`listServers`、`getMetrics`、`getAlertDetail`），让它们能够被 LLM 通过 Function Calling 安全调用，并记录每次调用的审计日志。

### 1.1 用户能看到什么

**场景**：运维工程师在 Agent 对话框里问"srv-042 最近 10 分钟的 CPU 指标是多少？"

```
用户输入：srv-042 最近 10 分钟的 CPU 指标是多少？

Agent 内部流程：
1. LLM 生成 Function Call：
   {
     "name": "getMetrics",
     "arguments": {
       "serverId": "srv-042",
       "metricType": "cpu",
       "minutes": 10
     }
   }

2. Tool Registry 执行流程：
   ✓ Schema 校验：参数类型和范围检查通过
   ✓ 执行查询：调用 Prisma 查询最近 10 分钟数据
   ✓ 超时保护：查询在 5 秒内返回
   ✓ 结果裁剪：返回前 100 条记录
   ✓ 审计记录：记录 toolName/args/duration/resultSize

3. LLM 收到结果后生成回复：
   "srv-042 在最近 10 分钟内 CPU 平均使用率为 87%，
    峰值 95% 出现在 14:23，建议检查异常进程。"
```

用户看到的是最终的自然语言回复，但背后经过了完整的 Tool Registry 保护链路。

### 1.2 这个模块在项目里承担什么

- **输入**：LLM 生成的 Function Call（toolName + arguments JSON）
- **输出**：校验后的查询结果（JSON），附带审计记录
- **对齐后续**：今天定义的 **Tool 接口规范**（`ToolDefinition` / `ToolExecutor`）是 Day 12-20 所有 Agent 工具的合同基线

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 直接暴露 Prisma 查询给 LLM | 单文件、`prisma.metrics.findMany()` 直接返回 | Tool 的最小闭环、Function Calling 基本概念 |
| **v2** | v1 + **Zod Schema 校验** + **超时保护** | 抽离 `tool-schema.ts` + `Promise.race` 超时 | Zod 校验、超时机制、参数边界 |
| **v3** | v2 + **结果裁剪** + **审计日志** + **Registry 统一管理** | 完整分层（types/errors/audit/registry/tools/controller） | Registry 模式、最小权限、审计链、错误分类 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Tool Registry 涉及多个关注点（类型定义、错误处理、审计、注册、具体工具实现、HTTP 入口），如果不先在脑子里立起骨架，写到一半就会把类型、逻辑、IO 混在一起。看完这棵树，下面章节再出现 `src/tools/registry/tool-registry.service.ts` 时，你就能立刻定位它在架构中的位置。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── tools/                                    ← 【新增】Tool Registry 模块
│   ├── types/
│   │   └── tool.types.ts                     ← Tool 接口定义（ToolDefinition / ToolExecutor / ToolContext）
│   ├── errors/
│   │   └── tool.errors.ts                    ← Tool 专用错误类（SchemaError / TimeoutError / ExecutionError）
│   ├── audit/
│   │   └── tool-audit.service.ts             ← 审计日志服务（记录每次 Tool 调用）
│   ├── registry/
│   │   ├── tool-registry.service.ts          ← 中央注册表（注册/查找/执行 Tool）
│   │   └── tool-registry.service.spec.ts     ← Registry 单元测试
│   ├── implementations/                       ← 具体 Tool 实现
│   │   ├── list-servers.tool.ts              ← Tool 1：列出所有服务器
│   │   ├── get-metrics.tool.ts               ← Tool 2：查询指标数据
│   │   └── get-alert-detail.tool.ts          ← Tool 3：查询告警详情
│   ├── index.ts                              ← 桶文件（导出所有公开接口）
│   ├── tools.module.ts                       ← NestJS 模块（注册 ToolRegistry + Audit）
│   └── tools.controller.ts                   ← HTTP 入口（POST /tools/execute）
├── prisma/
│   └── prisma.service.ts                     ← 【沿用 Day07】Prisma 服务
└── main.ts                                   ← 【沿用】应用入口
```

**三版演进对应的文件差异**：

| 版本 | 新增文件 | 核心变化 |
|---|---|---|
| **v1** | `tools/get-metrics.tool.ts`（直接调 Prisma）<br>`tools/tools.controller.ts`（单路由） | 最小闭环：一个 Tool + 一个 HTTP 端点 |
| **v2** | `tools/types/tool.types.ts`<br>`tools/get-metrics.tool.ts`（加 Zod Schema） | 加入 Schema 校验 + 超时保护 |
| **v3** | `tools/errors/tool.errors.ts`<br>`tools/audit/tool-audit.service.ts`<br>`tools/registry/tool-registry.service.ts`<br>`tools/implementations/` 三个 Tool<br>`tools/tools.module.ts` | 完整分层：类型/错误/审计/注册表分离 |

**依赖方向（务必单向，反过来一次都不行）**：

```
tools.controller.ts
    ↓ 调用
tool-registry.service.ts ──→ tool-audit.service.ts
    ↓ 持有所有 Tool          ↓ 记录审计日志
implementations/*.tool.ts ──→ PrismaService
    ↓ 实现 ToolDefinition    ↓ 查询数据库
tool.types.ts
```

**红线**：
- `implementations/*.tool.ts` 里出现 `import { Controller } from '@nestjs/common'` 就是层次塌方第一步。Tool 实现必须是纯业务逻辑，不依赖 HTTP 框架。
- `tool-registry.service.ts` 里出现 `import { PrismaService }` 就是职责混乱。Registry 只管理 Tool 生命周期，不直接访问数据库。

**动手前先问自己 3 个问题**：

1. 为什么 Tool 实现要放在 `implementations/` 目录而不是直接放在 `tools/` 根目录？  
   → 见 §5.4 知识点 2「Registry 模式」：未来会有 10+ 个 Tool，如果都平铺在根目录，`tools/` 会变成垃圾堆。`implementations/` 是"具体实现"的明确边界。

2. 为什么需要单独的 `tool.errors.ts` 而不是直接 `throw new Error()`？  
   → 见 §5.4 知识点 1「错误分类」：Schema 错误、超时错误、执行错误需要不同的处理策略（Schema 错误是客户端问题，超时是基础设施问题，执行错误需要重试）。统一的 `Error` 无法区分。

3. 审计日志为什么要单独抽成 `tool-audit.service.ts` 而不是在 Registry 里直接 `console.log()`？  
   → 见 §5.4 知识点 6「审计链」：审计是独立关注点，未来会接入 ELK/Prometheus/DataDog。如果写在 Registry 里，换审计方案就要改 Registry 核心逻辑。

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

按第 5.3 节的代码写，边写边问自己下面的问题。

### 1.5.1 D-1：搭工程骨架 / 装依赖（5 分钟）

```bash
cd D:\demo\ai-techer\p1-monitor\apps\api

# 安装 Zod（Schema 校验库）
pnpm add zod

# 创建目录
mkdir -p src/tools/{types,errors,audit,registry,implementations}
```

**边写边问自己**：
- 为什么选 Zod 而不是 Joi 或 class-validator？（Zod 有 TypeScript 类型推导，Schema 定义即类型定义）

### 1.5.2 D-2：实现类型层（5 分钟）

按第 5.3 节的代码写 `src/tools/types/tool.types.ts`。

**边写边问自己**：
- `ToolDefinition` 的 `schema` 字段为什么是 `z.ZodType` 而不是普通对象？（运行时校验需要可执行的 Schema）
- `ToolContext` 为什么要包含 `userId` 和 `requestId`？（审计追踪和权限控制的最小上下文）

### 1.5.3 D-3：实现错误层（3 分钟）

按第 5.3 节的代码写 `src/tools/errors/tool.errors.ts`。

**边写边问自己**：
- 为什么每个错误类都要继承 `Error` 并设置 `this.name`？（错误栈追踪和错误类型判断）

### 1.5.4 D-4：实现审计层（5 分钟）

按第 5.3 节的代码写 `src/tools/audit/tool-audit.service.ts`。

**边写边问自己**：
- 审计日志为什么要记录 `resultSize` 而不是完整的 `result`？（避免日志爆炸，只记元数据）
- 为什么 `logExecution` 是 `async` 方法？（未来接入外部日志系统需要异步写入）

### 1.5.5 D-5：实现 Registry 和 Tools（剩余时间）

按第 5.3 节的代码依次写：
- `src/tools/registry/tool-registry.service.ts`
- `src/tools/implementations/list-servers.tool.ts`
- `src/tools/implementations/get-metrics.tool.ts`
- `src/tools/implementations/get-alert-detail.tool.ts`
- `src/tools/tools.module.ts`
- `src/tools/tools.controller.ts`
- `src/tools/index.ts`

**边写边问自己**：
- Registry 的 `execute()` 方法为什么要按"查找 → 校验 → 超时包装 → 执行 → 裁剪 → 审计"六步执行？（每一步都是独立的保护层）
- 三个 Tool 的 `schema` 定义有什么共同模式？（都限制了参数范围：`minutes` 最大 1440，`limit` 最大 100）

---

## 2. 学习节奏（90 阅读 / 90 动手）

Day 11 总时长 180 分钟，分为 6 个阶段（A-F）：

| 阶段 | 时长 | 活动 | 输出 |
|---|---|---|---|
| **A：读文档头** | 30 分钟 | 阅读 §0-§1.4（位置/目标/目录结构） | 在脑子里建立 Tool Registry 的骨架图 |
| **B：读三版演进** | 30 分钟 | 阅读 §3-§5（v1/v2/v3 完整代码） | 理解"为什么 v3 要分这么多层" |
| **C：读知识点深挖** | 30 分钟 | 阅读 §5.4（6 个知识点）+ §6.5（HTML 深挖） | 记录每个知识点的"解决的问题/验证方法" |
| **D：搭骨架** | 60 分钟 | 执行 §1.5（D-1 到 D-5） | 10 个文件骨架全部创建 |
| **E：写测试** | 20 分钟 | 执行 §7.6（写 Registry + 3 个 Tool 的单元测试） | 至少 15 个测试用例通过 |
| **F：验收** | 10 分钟 | 执行 §7.7-§7.9（反证实验 + 提交） | commit + 反证记录 |

**阶段切换规则**：
- A → B：读完目录结构后，能闭眼说出"types/errors/audit/registry/implementations"五层各自的职责。
- B → C：读完 v3 代码后，能说出"v2 暴露的痛点是什么，v3 如何解决"。
- C → D：读完知识点后，能回答 §1.4.5 的 3 个问题。
- D → E：骨架搭完后，`pnpm typecheck` 通过（可能有逻辑未实现，但类型正确）。
- E → F：测试通过后，`pnpm test` 至少 15 个用例全绿。

---

## 3. v1：最小闭环

### 3.1 v1 要实现什么

**目标**：用最少的代码让 LLM 能够调用一个真实的数据库查询函数。

**功能范围**：
- 一个 Tool：`getMetrics`（查询最近 N 分钟的指标数据）
- 一个 HTTP 端点：`POST /tools/execute`
- 直接调用 Prisma，无校验、无超时、无审计

**用户视角**：
```bash
curl -X POST http://localhost:3000/tools/execute \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "getMetrics",
    "arguments": {
      "serverId": "srv-042",
      "metricType": "cpu",
      "minutes": 10
    }
  }'

# 返回：
{
  "success": true,
  "data": [
    { "timestamp": "2026-07-24T14:20:00Z", "value": 85.2 },
    { "timestamp": "2026-07-24T14:21:00Z", "value": 87.5 },
    ...
  ]
}
```

### 3.2 v1 完整代码

**apps/api/src/tools/get-metrics-v1.tool.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class GetMetricsToolV1 {
  constructor(private prisma: PrismaService) {}

  async execute(args: any): Promise<any> {
    const { serverId, metricType, minutes } = args
    
    const since = new Date(Date.now() - minutes * 60 * 1000)
    
    const metrics = await this.prisma.metric.findMany({
      where: {
        serverId,
        type: metricType,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
    })
    
    return metrics.map(m => ({
      timestamp: m.timestamp.toISOString(),
      value: m.value,
    }))
  }
}
```

**apps/api/src/tools/tools-v1.controller.ts**

```typescript
import { Controller, Post, Body } from '@nestjs/common'
import { GetMetricsToolV1 } from './get-metrics-v1.tool'

@Controller('tools')
export class ToolsControllerV1 {
  constructor(private getMetricsTool: GetMetricsToolV1) {}

  @Post('execute')
  async execute(@Body() body: { toolName: string; arguments: any }) {
    const { toolName, arguments: args } = body
    
    if (toolName === 'getMetrics') {
      const data = await this.getMetricsTool.execute(args)
      return { success: true, data }
    }
    
    return { success: false, error: 'Unknown tool' }
  }
}
```

**apps/api/src/tools/tools-v1.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { GetMetricsToolV1 } from './get-metrics-v1.tool'
import { ToolsControllerV1 } from './tools-v1.controller'

@Module({
  imports: [PrismaModule],
  controllers: [ToolsControllerV1],
  providers: [GetMetricsToolV1],
})
export class ToolsModuleV1 {}
```

### 3.3 v1 用到的知识点

**知识点 1：Function Calling 基本概念**

- **解决的问题**：LLM 只能生成文本，如何让它调用真实的函数（查数据库、调 API、读文件）？
- **运行机制**：LLM 生成结构化的 JSON（toolName + arguments），后端解析后调用对应函数，把结果返回给 LLM。
- **项目落点**：`POST /tools/execute` 接收 `{ toolName, arguments }`，路由到具体 Tool。
- **生产误区**：以为 LLM 能"直接执行代码"——实际上 LLM 只生成调用请求，执行权在服务端。
- **验证方法**：用 `curl` 手动发送 Function Call，看能否返回数据库结果。

**知识点 2：Tool 的最小接口**

- **解决的问题**：如何定义一个"可被 LLM 调用的函数"的最小形式？
- **运行机制**：Tool 至少需要 `name`（标识）+ `execute(args)`（执行逻辑）。
- **项目落点**：`GetMetricsToolV1.execute(args)` 是 Tool 的核心方法。
- **生产误区**：把 Tool 写成 NestJS Controller——Tool 应该是纯业务逻辑，不依赖 HTTP。
- **验证方法**：能否在单元测试里直接 `new GetMetricsToolV1(prisma).execute(args)` 而不启动 HTTP 服务？

### 3.4 v1 暴露的痛点

1. **无参数校验**：`args.minutes` 可能是负数、字符串、或者 1000000，直接传给数据库会崩溃。
2. **无超时保护**：如果查询卡住 30 秒，整个请求挂起，用户无感知。
3. **无结果限制**：返回 10 万条记录会撑爆内存和 LLM context。
4. **无错误分类**：数据库连接失败、参数错误、查询超时都返回同一个 500 错误。
5. **硬编码路由**：每加一个 Tool 就要在 Controller 里加一个 `if`，100 个 Tool 就是 100 个 `if`。

**下一版改进方向**：加入 Zod Schema 校验 + 超时保护。

---

## 4. v2：加入 Schema 校验和超时保护

### 4.1 v2 要实现什么

**目标**：在 v1 基础上加入参数校验和超时保护，防止非法输入和慢查询。

**功能范围**：
- 用 Zod 定义 `getMetrics` 的参数 Schema（`minutes` 范围 1-1440，`metricType` 枚举）
- 用 `Promise.race` 实现 5 秒超时
- 抽离 `ToolDefinition` 接口

**新增保护**：
```typescript
// 参数校验
const schema = z.object({
  serverId: z.string().min(1),
  metricType: z.enum(['cpu', 'memory', 'disk']),
  minutes: z.number().int().min(1).max(1440), // 最多查 24 小时
})

// 超时保护
const result = await Promise.race([
  tool.execute(args),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), 5000)
  ),
])
```

### 4.2 v2 完整代码

**apps/api/src/tools/types/tool.types.ts**

```typescript
import { z } from 'zod'

export interface ToolDefinition<TArgs = any, TResult = any> {
  name: string
  description: string
  schema: z.ZodType<TArgs>
  execute: (args: TArgs, context: ToolContext) => Promise<TResult>
}

export interface ToolContext {
  userId?: string
  requestId: string
  timestamp: Date
}
```

**apps/api/src/tools/get-metrics-v2.tool.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { PrismaService } from '../prisma/prisma.service'
import { ToolDefinition, ToolContext } from './types/tool.types'

const GetMetricsSchema = z.object({
  serverId: z.string().min(1),
  metricType: z.enum(['cpu', 'memory', 'disk']),
  minutes: z.number().int().min(1).max(1440),
})

type GetMetricsArgs = z.infer<typeof GetMetricsSchema>

interface MetricResult {
  timestamp: string
  value: number
}

@Injectable()
export class GetMetricsToolV2 implements ToolDefinition<GetMetricsArgs, MetricResult[]> {
  name = 'getMetrics'
  description = 'Query server metrics for the last N minutes'
  schema = GetMetricsSchema

  constructor(private prisma: PrismaService) {}

  async execute(args: GetMetricsArgs, context: ToolContext): Promise<MetricResult[]> {
    const { serverId, metricType, minutes } = args
    
    const since = new Date(Date.now() - minutes * 60 * 1000)
    
    const metrics = await this.prisma.metric.findMany({
      where: {
        serverId,
        type: metricType,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
    })
    
    return metrics.map(m => ({
      timestamp: m.timestamp.toISOString(),
      value: m.value,
    }))
  }
}
```

**apps/api/src/tools/tools-v2.controller.ts**

```typescript
import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common'
import { GetMetricsToolV2 } from './get-metrics-v2.tool'
import { ToolContext } from './types/tool.types'
import { randomUUID } from 'crypto'

@Controller('tools')
export class ToolsControllerV2 {
  private readonly TIMEOUT_MS = 5000

  constructor(private getMetricsTool: GetMetricsToolV2) {}

  @Post('execute')
  async execute(@Body() body: { toolName: string; arguments: any }) {
    const { toolName, arguments: rawArgs } = body
    
    if (toolName !== 'getMetrics') {
      throw new HttpException('Unknown tool', HttpStatus.NOT_FOUND)
    }

    // Schema 校验
    const parseResult = this.getMetricsTool.schema.safeParse(rawArgs)
    if (!parseResult.success) {
      throw new HttpException({
        error: 'Invalid arguments',
        details: parseResult.error.format(),
      }, HttpStatus.BAD_REQUEST)
    }

    const context: ToolContext = {
      requestId: randomUUID(),
      timestamp: new Date(),
    }

    // 超时保护
    try {
      const result = await Promise.race([
        this.getMetricsTool.execute(parseResult.data, context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tool execution timeout')), this.TIMEOUT_MS)
        ),
      ])
      
      return { success: true, data: result }
    } catch (error) {
      if (error.message === 'Tool execution timeout') {
        throw new HttpException('Tool execution timeout', HttpStatus.REQUEST_TIMEOUT)
      }
      throw new HttpException('Tool execution failed', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
```

### 4.3 v2 用到的知识点

**知识点 3：Zod Schema 校验**

- **解决的问题**：如何在运行时校验 LLM 生成的参数是否合法？
- **运行机制**：Zod 提供 `safeParse()`，返回 `{ success, data/error }`，失败时包含详细错误信息。
- **项目落点**：`GetMetricsSchema` 限制 `minutes` 范围 1-1440，`metricType` 只能是 cpu/memory/disk。
- **生产误区**：用 TypeScript 类型约束代替运行时校验——TS 类型编译后消失，无法防止运行时非法输入。
- **验证方法**：发送 `{ minutes: -1 }` 或 `{ metricType: 'invalid' }`，应该返回 400 错误。

**知识点 4：超时保护机制**

- **解决的问题**：如何防止慢查询卡住整个请求？
- **运行机制**：`Promise.race([执行, 超时Promise])`，先完成的 Promise 决定结果。
- **项目落点**：5 秒超时，超时后抛出 `REQUEST_TIMEOUT` 错误。
- **生产误区**：以为设置数据库连接超时就够了——连接超时只保护连接阶段，查询本身可能慢。
- **验证方法**：写一个故意慢的查询（`SELECT pg_sleep(10)`），看 5 秒后是否超时。

### 4.4 v2 暴露的痛点

1. **无结果裁剪**：即使参数合法，返回 1 万条记录仍然会撑爆内存。
2. **无审计日志**：无法追踪哪个用户在什么时间调用了什么 Tool。
3. **硬编码 Tool 查找**：Controller 里仍然是 `if (toolName === 'getMetrics')`，加新 Tool 仍需改代码。
4. **错误处理粗糙**：所有执行错误都返回 500，无法区分是数据库错误还是业务逻辑错误。
5. **无最小权限**：所有 Tool 都能访问所有数据，没有字段白名单。

**下一版改进方向**：引入 Registry 统一管理 Tool + 审计日志 + 结果裁剪。

---

## 5. v3：完整的 Tool Registry

### 5.1 v3 要实现什么

**目标**：建立完整的 Tool Registry 架构，支持动态注册、统一执行、审计日志和结果裁剪。

**功能范围**：
- 三个只读 Tool：`listServers` / `getMetrics` / `getAlertDetail`
- Registry 统一管理所有 Tool（注册、查找、执行）
- 审计服务记录每次调用（toolName / args / duration / resultSize）
- 结果裁剪（最多返回 100 条记录）
- 自定义错误类（SchemaError / TimeoutError / ExecutionError）

**架构图**：
```
HTTP Request
    ↓
ToolsController
    ↓
ToolRegistryService.execute(toolName, args)
    ├─ 1. 查找 Tool
    ├─ 2. Schema 校验
    ├─ 3. 超时包装
    ├─ 4. 执行 Tool
    ├─ 5. 结果裁剪
    └─ 6. 审计记录
    ↓
返回结果
```

### 5.2 v3 目录结构

```
apps/api/src/tools/
├── types/tool.types.ts
├── errors/tool.errors.ts
├── audit/tool-audit.service.ts
├── registry/
│   ├── tool-registry.service.ts
│   └── tool-registry.service.spec.ts
├── implementations/
│   ├── list-servers.tool.ts
│   ├── get-metrics.tool.ts
│   └── get-alert-detail.tool.ts
├── index.ts
├── tools.module.ts
└── tools.controller.ts
```

### 5.3 v3 完整代码

#### 5.3.1 类型定义

**apps/api/src/tools/types/tool.types.ts**

```typescript
import { z } from 'zod'

/**
 * Tool 定义接口
 * 每个 Tool 必须实现此接口才能被 Registry 注册
 */
export interface ToolDefinition<TArgs = any, TResult = any> {
  /** Tool 唯一标识符 */
  name: string
  
  /** Tool 描述（给 LLM 看的，解释这个 Tool 做什么） */
  description: string
  
  /** 参数 Schema（用于运行时校验） */
  schema: z.ZodType<TArgs>
  
  /** 执行函数 */
  execute: (args: TArgs, context: ToolContext) => Promise<TResult>
}

/**
 * Tool 执行上下文
 * 包含调用追踪和权限信息
 */
export interface ToolContext {
  /** 用户 ID（用于权限检查和审计） */
  userId?: string
  
  /** 请求 ID（用于日志追踪） */
  requestId: string
  
  /** 调用时间戳 */
  timestamp: Date
}

/**
 * Tool 执行结果
 * 统一的返回格式
 */
export interface ToolResult<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  meta: {
    toolName: string
    duration: number
    resultSize: number
    truncated: boolean
  }
}
```

#### 5.3.2 错误定义

**apps/api/src/tools/errors/tool.errors.ts**

```typescript
/**
 * Tool 专用错误基类
 */
export abstract class ToolError extends Error {
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Schema 校验失败
 * HTTP 400 - 客户端错误
 */
export class ToolSchemaError extends ToolError {
  readonly code = 'TOOL_SCHEMA_ERROR'

  constructor(
    message: string,
    public readonly details: any,
  ) {
    super(message)
  }
}

/**
 * Tool 执行超时
 * HTTP 408 - 服务端性能问题
 */
export class ToolTimeoutError extends ToolError {
  readonly code = 'TOOL_TIMEOUT'

  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Tool '${toolName}' execution timeout after ${timeoutMs}ms`)
  }
}

/**
 * Tool 执行失败
 * HTTP 500 - 服务端逻辑错误
 */
export class ToolExecutionError extends ToolError {
  readonly code = 'TOOL_EXECUTION_ERROR'

  constructor(
    public readonly toolName: string,
    public readonly cause: Error,
  ) {
    super(`Tool '${toolName}' execution failed: ${cause.message}`)
  }
}

/**
 * Tool 未找到
 * HTTP 404 - 客户端错误
 */
export class ToolNotFoundError extends ToolError {
  readonly code = 'TOOL_NOT_FOUND'

  constructor(public readonly toolName: string) {
    super(`Tool '${toolName}' not found in registry`)
  }
}
```

#### 5.3.3 审计服务

**apps/api/src/tools/audit/tool-audit.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common'

export interface ToolAuditLog {
  toolName: string
  userId?: string
  requestId: string
  arguments: any
  timestamp: Date
  duration: number
  success: boolean
  error?: string
  resultSize: number
}

@Injectable()
export class ToolAuditService {
  private readonly logger = new Logger(ToolAuditService.name)

  /**
   * 记录 Tool 调用审计日志
   * 生产环境应写入 ELK / Prometheus / DataDog
   */
  async logExecution(log: ToolAuditLog): Promise<void> {
    // 当前实现：写入结构化日志
    this.logger.log({
      event: 'tool_execution',
      ...log,
      // 敏感参数脱敏
      arguments: this.sanitizeArgs(log.arguments),
    })

    // TODO: 生产环境写入外部审计系统
    // await this.auditRepository.save(log)
  }

  /**
   * 脱敏敏感参数
   */
  private sanitizeArgs(args: any): any {
    if (!args || typeof args !== 'object') return args

    const sanitized = { ...args }
    const sensitiveKeys = ['password', 'token', 'apiKey', 'secret']

    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '***REDACTED***'
      }
    }

    return sanitized
  }
}
```


#### 5.3.4 Registry 服务

**apps/api/src/tools/registry/tool-registry.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import {
  ToolDefinition,
  ToolContext,
  ToolResult,
} from '../types/tool.types'
import {
  ToolNotFoundError,
  ToolSchemaError,
  ToolTimeoutError,
  ToolExecutionError,
} from '../errors/tool.errors'
import { ToolAuditService } from '../audit/tool-audit.service'

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name)
  private readonly tools = new Map<string, ToolDefinition>()
  private readonly TIMEOUT_MS = 5000
  private readonly MAX_RESULT_SIZE = 100

  constructor(private readonly auditService: ToolAuditService) {}

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool already registered, overwriting`)
    }
    this.tools.set(tool.name, tool)
    this.logger.log(`Tool registered`)
  }

  registerAll(tools: ToolDefinition[]): void {
    tools.forEach(tool => this.register(tool))
  }

  find(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  listTools(): string[] {
    return Array.from(this.tools.keys())
  }

  async execute<T = any>(
    toolName: string,
    rawArgs: any,
    context: ToolContext,
  ): Promise<ToolResult<T>> {
    const startTime = Date.now()

    try {
      const tool = this.tools.get(toolName)
      if (!tool) {
        throw new ToolNotFoundError(toolName)
      }

      const parseResult = tool.schema.safeParse(rawArgs)
      if (!parseResult.success) {
        throw new ToolSchemaError(
          'Invalid tool arguments',
          parseResult.error.format(),
        )
      }

      const result = await this.executeWithTimeout(
        tool,
        parseResult.data,
        context,
      )

      const truncatedResult = this.truncateResult(result)
      const duration = Date.now() - startTime

      await this.auditService.logExecution({
        toolName,
        userId: context.userId,
        requestId: context.requestId,
        arguments: rawArgs,
        timestamp: context.timestamp,
        duration,
        success: true,
        resultSize: this.getResultSize(result),
      })

      return {
        success: true,
        data: truncatedResult.data,
        meta: {
          toolName,
          duration,
          resultSize: this.getResultSize(result),
          truncated: truncatedResult.truncated,
        },
      }
    } catch (error) {
      const duration = Date.now() - startTime

      await this.auditService.logExecution({
        toolName,
        userId: context.userId,
        requestId: context.requestId,
        arguments: rawArgs,
        timestamp: context.timestamp,
        duration,
        success: false,
        error: error.message,
        resultSize: 0,
      })

      return {
        success: false,
        error: {
          code: error.code || 'UNKNOWN_ERROR',
          message: error.message,
          details: error.details,
        },
        meta: {
          toolName,
          duration,
          resultSize: 0,
          truncated: false,
        },
      }
    }
  }

  private async executeWithTimeout<TArgs, TResult>(
    tool: ToolDefinition<TArgs, TResult>,
    args: TArgs,
    context: ToolContext,
  ): Promise<TResult> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new ToolTimeoutError(tool.name, this.TIMEOUT_MS))
      }, this.TIMEOUT_MS)
    })

    try {
      return await Promise.race([
        tool.execute(args, context),
        timeoutPromise,
      ])
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        throw error
      }
      throw new ToolExecutionError(tool.name, error)
    }
  }

  private truncateResult<T>(result: T): { data: T; truncated: boolean } {
    if (Array.isArray(result)) {
      if (result.length > this.MAX_RESULT_SIZE) {
        return {
          data: result.slice(0, this.MAX_RESULT_SIZE) as T,
          truncated: true,
        }
      }
    }
    return { data: result, truncated: false }
  }

  private getResultSize(result: any): number {
    if (Array.isArray(result)) {
      return result.length
    }
    if (result && typeof result === 'object') {
      return Object.keys(result).length
    }
    return 1
  }
}
```


#### 5.3.5 具体 Tool 实现

**apps/api/src/tools/implementations/list-servers.tool.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { ToolDefinition, ToolContext } from '../types/tool.types'

const ListServersSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
})

type ListServersArgs = z.infer<typeof ListServersSchema>

interface ServerInfo {
  id: string
  name: string
  status: string
}

@Injectable()
export class ListServersTool implements ToolDefinition<ListServersArgs, ServerInfo[]> {
  name = 'listServers'
  description = 'List all monitored servers with their current status'
  schema = ListServersSchema

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: ListServersArgs, context: ToolContext): Promise<ServerInfo[]> {
    const servers = await this.prisma.server.findMany({
      take: args.limit,
      select: {
        id: true,
        name: true,
        status: true,
      },
      orderBy: { name: 'asc' },
    })

    return servers.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
    }))
  }
}
```

**apps/api/src/tools/implementations/get-metrics.tool.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { ToolDefinition, ToolContext } from '../types/tool.types'

const GetMetricsSchema = z.object({
  serverId: z.string().min(1),
  metricType: z.enum(['cpu', 'memory', 'disk']),
  minutes: z.number().int().min(1).max(1440),
})

type GetMetricsArgs = z.infer<typeof GetMetricsSchema>

interface MetricData {
  timestamp: string
  value: number
}

@Injectable()
export class GetMetricsTool implements ToolDefinition<GetMetricsArgs, MetricData[]> {
  name = 'getMetrics'
  description = 'Query server metrics for the last N minutes'
  schema = GetMetricsSchema

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: GetMetricsArgs, context: ToolContext): Promise<MetricData[]> {
    const { serverId, metricType, minutes } = args
    
    const since = new Date(Date.now() - minutes * 60 * 1000)
    
    const metrics = await this.prisma.metric.findMany({
      where: {
        serverId,
        type: metricType,
        timestamp: { gte: since },
      },
      select: {
        timestamp: true,
        value: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 1000,
    })
    
    return metrics.map(m => ({
      timestamp: m.timestamp.toISOString(),
      value: m.value,
    }))
  }
}
```

**apps/api/src/tools/implementations/get-alert-detail.tool.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { ToolDefinition, ToolContext } from '../types/tool.types'

const GetAlertDetailSchema = z.object({
  alertId: z.string().uuid(),
})

type GetAlertDetailArgs = z.infer<typeof GetAlertDetailSchema>

interface AlertDetail {
  id: string
  serverId: string
  serverName: string
  metricType: string
  severity: string
  status: string
  message: string
  createdAt: string
  updatedAt: string
}

@Injectable()
export class GetAlertDetailTool implements ToolDefinition<GetAlertDetailArgs, AlertDetail | null> {
  name = 'getAlertDetail'
  description = 'Get detailed information about a specific alert'
  schema = GetAlertDetailSchema

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: GetAlertDetailArgs, context: ToolContext): Promise<AlertDetail | null> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: args.alertId },
      include: {
        server: {
          select: {
            name: true,
          },
        },
      },
    })

    if (!alert) {
      return null
    }

    return {
      id: alert.id,
      serverId: alert.serverId,
      serverName: alert.server.name,
      metricType: alert.metricType,
      severity: alert.severity,
      status: alert.status,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    }
  }
}
```


#### 5.3.6 Module 和 Controller

**apps/api/src/tools/tools.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { ToolAuditService } from './audit/tool-audit.service'
import { ToolRegistryService } from './registry/tool-registry.service'
import { ListServersTool } from './implementations/list-servers.tool'
import { GetMetricsTool } from './implementations/get-metrics.tool'
import { GetAlertDetailTool } from './implementations/get-alert-detail.tool'
import { ToolsController } from './tools.controller'

@Module({
  imports: [PrismaModule],
  controllers: [ToolsController],
  providers: [
    ToolAuditService,
    ToolRegistryService,
    ListServersTool,
    GetMetricsTool,
    GetAlertDetailTool,
  ],
  exports: [ToolRegistryService],
})
export class ToolsModule {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly listServersTool: ListServersTool,
    private readonly getMetricsTool: GetMetricsTool,
    private readonly getAlertDetailTool: GetAlertDetailTool,
  ) {
    this.registry.registerAll([
      this.listServersTool,
      this.getMetricsTool,
      this.getAlertDetailTool,
    ])
  }
}
```

**apps/api/src/tools/tools.controller.ts**

```typescript
import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common'
import { ToolRegistryService } from './registry/tool-registry.service'
import { ToolContext } from './types/tool.types'
import { randomUUID } from 'crypto'

@Controller('tools')
export class ToolsController {
  constructor(private readonly registry: ToolRegistryService) {}

  @Post('execute')
  async execute(
    @Body() body: { toolName: string; arguments: any; userId?: string },
  ) {
    const { toolName, arguments: rawArgs, userId } = body

    const context: ToolContext = {
      userId,
      requestId: randomUUID(),
      timestamp: new Date(),
    }

    const result = await this.registry.execute(toolName, rawArgs, context)

    if (!result.success) {
      const error = result.error
      
      if (error.code === 'TOOL_NOT_FOUND') {
        throw new HttpException(error, HttpStatus.NOT_FOUND)
      }
      
      if (error.code === 'TOOL_SCHEMA_ERROR') {
        throw new HttpException(error, HttpStatus.BAD_REQUEST)
      }
      
      if (error.code === 'TOOL_TIMEOUT') {
        throw new HttpException(error, HttpStatus.REQUEST_TIMEOUT)
      }
      
      throw new HttpException(error, HttpStatus.INTERNAL_SERVER_ERROR)
    }

    return result
  }

  @Post('list')
  async listTools() {
    return {
      tools: this.registry.listTools(),
    }
  }
}
```

**apps/api/src/tools/index.ts**

```typescript
export * from './types/tool.types'
export * from './errors/tool.errors'
export * from './audit/tool-audit.service'
export * from './registry/tool-registry.service'
export * from './implementations/list-servers.tool'
export * from './implementations/get-metrics.tool'
export * from './implementations/get-alert-detail.tool'
export * from './tools.module'
export * from './tools.controller'
```



---

### 5.4 v3 用到的知识点（6个核心知识点）

#### 知识点1：错误分类（ToolError 体系）

**解决的问题**
Tool 执行可能因多种原因失败：工具不存在、Schema 校验不通过、执行超时、执行逻辑抛错。统一的错误分类体系让调用方能根据错误类型决策（重试 / 降级 / 上报）。

**运行机制**
```typescript
// 基类：ToolError
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

// 子类：ToolNotFoundError
export class ToolNotFoundError extends ToolError {
  constructor(toolName: string, availableTools: string[]) {
    super(
      `Tool "${toolName}" not found`,
      'TOOL_NOT_FOUND',
      { availableTools }
    )
  }
}
```

- 每种错误继承 `ToolError`，携带 `code` 字段供程序判断
- `details` 字段存放上下文信息（如可用工具列表、超时阈值）
- NestJS 全局异常过滤器捕获后统一返回格式

**项目落点**
```typescript
// tools/errors/tool.errors.ts
export class ToolNotFoundError extends ToolError { ... }
export class ToolSchemaError extends ToolError { ... }
export class ToolTimeoutError extends ToolError { ... }
export class ToolExecutionError extends ToolError { ... }

// tools/registry/tool-registry.service.ts
async execute(toolName: string, args: unknown, context: ToolContext) {
  const tool = this.tools.get(toolName)
  if (!tool) {
    throw new ToolNotFoundError(toolName, Array.from(this.tools.keys()))
  }
  // ... 其他错误场景
}
```

**生产误区**
1. ❌ 所有错误都抛 `Error('Failed')`，调用方无法区分失败原因
2. ❌ 错误 message 包含动态内容但无结构化 `details`，日志难以解析
3. ❌ 自定义错误不继承基类，catch 块需要多个 `instanceof` 判断

**验证方法**
```bash
# 测试1：工具不存在
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"unknown","args":{}}'
# 预期：{"code":"TOOL_NOT_FOUND","details":{"availableTools":[...]}}

# 测试2：Schema 校验失败
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get-metrics","args":{"serverId":""}}'
# 预期：{"code":"TOOL_SCHEMA_ERROR","details":{"issues":[...]}}
```

---

#### 知识点2：Registry 模式（工具注册表）

**解决的问题**
系统有 10+ 工具，硬编码 `if (name === 'listServers') { ... }` 会导致：
- 新增工具需改多处代码
- 无法动态查询可用工具列表
- 权限控制、审计逻辑散落各处

Registry 模式集中管理工具生命周期（注册 / 查询 / 执行）。

**运行机制**
```typescript
// 1. 定义统一接口
interface ToolDefinition {
  name: string
  description: string
  schema: ZodSchema<any>
  execute: (args: any, context: ToolContext) => Promise<any>
}

// 2. Registry 存储工具
class ToolRegistryService {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  async execute(toolName: string, args: unknown, context: ToolContext) {
    const tool = this.tools.get(toolName)
    if (!tool) throw new ToolNotFoundError(...)
    // 统一的校验 / 超时 / 审计逻辑
    return await tool.execute(args, context)
  }
}

// 3. 工具实现只需声明 Definition
export const listServersTool: ToolDefinition = {
  name: 'list-servers',
  schema: z.object({ status: z.enum(['active', 'inactive']).optional() }),
  execute: async (args, ctx) => { ... },
}
```

**项目落点**
```typescript
// tools/registry/tool-registry.service.ts
@Injectable()
export class ToolRegistryService {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void { ... }
  registerAll(tools: ToolDefinition[]): void { ... }
  listTools(): Array<{ name: string; description: string }> { ... }
  async execute(toolName: string, args: unknown, context: ToolContext) { ... }
}

// tools/tools.module.ts
@Module({
  providers: [ToolRegistryService, ...],
  exports: [ToolRegistryService],
})
export class ToolsModule implements OnModuleInit {
  onModuleInit() {
    this.registry.registerAll([
      listServersTool,
      getMetricsTool,
      getAlertDetailTool,
    ])
  }
}
```

**生产误区**
1. ❌ 每次调用 `execute` 都重新构造工具实例（性能浪费）
2. ❌ Registry 不做权限检查，权限逻辑散落在每个 Tool 的 `execute` 里
3. ❌ 未记录工具注册顺序，同名工具覆盖时无日志告警

**验证方法**
```bash
# 测试1：查询工具列表
curl http://localhost:3000/api/tools/list
# 预期：{"tools":[{"name":"list-servers","description":"..."},{"name":"get-metrics","description":"..."},...]}

# 测试2：执行已注册工具
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"list-servers","args":{"status":"active"}}'
# 预期：{"success":true,"data":[...]}

# 测试3：动态注册新工具（开发环境）
# 在 tools/implementations/ 新增 foo.tool.ts，重启后调用 /list 应自动出现
```

---

#### 知识点3：Schema 校验与类型推导（Zod）

**解决的问题**
Tool 参数来自 AI 生成，可能传入非法值：
- `serverId: 123`（应该是 string）
- `limit: -1`（应该 > 0）
- 缺失必填字段 `serverId`

Zod Schema 在运行时校验参数，并提供 TypeScript 类型推导。

**运行机制**
```typescript
import { z } from 'zod'

// 1. 定义 Schema
const GetMetricsArgsSchema = z.object({
  serverId: z.string().min(1, 'serverId cannot be empty'),
  metricNames: z.array(z.string()).optional(),
  startTime: z.number().int().positive().optional(),
  endTime: z.number().int().positive().optional(),
})

// 2. 推导类型
type GetMetricsArgs = z.infer<typeof GetMetricsArgsSchema>
// 等价于：
// type GetMetricsArgs = {
//   serverId: string
//   metricNames?: string[]
//   startTime?: number
//   endTime?: number
// }

// 3. 运行时校验
const result = GetMetricsArgsSchema.safeParse(args)
if (!result.success) {
  throw new ToolSchemaError('get-metrics', result.error.issues)
}
const validArgs: GetMetricsArgs = result.data
```

**项目落点**
```typescript
// tools/implementations/get-metrics.tool.ts
const GetMetricsArgsSchema = z.object({
  serverId: z.string().min(1),
  metricNames: z.array(z.string()).optional(),
  startTime: z.number().int().positive().optional(),
  endTime: z.number().int().positive().optional(),
})

type GetMetricsArgs = z.infer<typeof GetMetricsArgsSchema>

export const getMetricsTool: ToolDefinition<GetMetricsArgs> = {
  name: 'get-metrics',
  schema: GetMetricsArgsSchema,
  execute: async (args: GetMetricsArgs, ctx) => {
    // args 已通过校验，TS 类型安全
    const metrics = await ctx.prisma.metric.findMany({
      where: { serverId: args.serverId },
    })
    return metrics
  },
}

// tools/registry/tool-registry.service.ts
async execute(toolName: string, args: unknown, context: ToolContext) {
  const tool = this.tools.get(toolName)
  const parseResult = tool.schema.safeParse(args)
  if (!parseResult.success) {
    throw new ToolSchemaError(toolName, parseResult.error.issues)
  }
  // 校验通过后才执行
  return await tool.execute(parseResult.data, context)
}
```

**生产误区**
1. ❌ 只在类型层面定义接口，运行时不校验，AI 传错参数直接崩溃
2. ❌ Schema 定义过于宽松（`z.string()` 允许空字符串），未加 `.min(1)` 约束
3. ❌ 错误信息只有 `Invalid input`，未将 Zod 的 `issues` 数组暴露给调用方

**验证方法**
```bash
# 测试1：缺失必填字段
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"get-metrics","args":{}}'
# 预期：{"code":"TOOL_SCHEMA_ERROR","details":{"issues":[{"path":["serverId"],"message":"Required"}]}}

# 测试2：类型错误
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"get-metrics","args":{"serverId":123}}'
# 预期：{"code":"TOOL_SCHEMA_ERROR","details":{"issues":[{"path":["serverId"],"message":"Expected string, received number"}]}}

# 测试3：自定义约束（空字符串）
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"get-metrics","args":{"serverId":""}}'
# 预期：{"code":"TOOL_SCHEMA_ERROR","details":{"issues":[{"path":["serverId"],"message":"serverId cannot be empty"}]}}
```

---

#### 知识点4：超时保护机制（Promise.race + AbortController）

**解决的问题**
Tool 可能因以下原因长时间挂起：
- 查询大表未加索引
- 外部 API 无响应
- 死循环 / 内存泄漏

超时机制保证在固定时间内返回结果或抛出 `ToolTimeoutError`。

**运行机制**
```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new ToolTimeoutError(errorMessage, timeoutMs)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise])
}

// 使用示例
const result = await withTimeout(
  tool.execute(args, context),
  5000,
  `Tool "${toolName}" execution timeout`
)
```

原理：
1. `Promise.race` 同时运行原任务和超时定时器
2. 哪个先完成就返回哪个的结果
3. 超时定时器触发时 reject `ToolTimeoutError`

**项目落点**
```typescript
// tools/registry/tool-registry.service.ts
@Injectable()
export class ToolRegistryService {
  private readonly TIMEOUT_MS = 5000

  async execute(toolName: string, args: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(toolName)
    if (!tool) throw new ToolNotFoundError(...)

    const parseResult = tool.schema.safeParse(args)
    if (!parseResult.success) throw new ToolSchemaError(...)

    const startTime = Date.now()

    try {
      // 超时保护
      const data = await this.withTimeout(
        tool.execute(parseResult.data, context),
        this.TIMEOUT_MS,
        `Tool "${toolName}" execution timeout`
      )

      const duration = Date.now() - startTime
      const result: ToolResult = {
        success: true,
        data: this.truncateResult(data),
        metadata: { executionTime: duration },
      }

      await this.auditService.logExecution({
        toolName,
        args: parseResult.data,
        result,
        duration,
        userId: context.userId,
      })

      return result
    } catch (error) {
      // ... 错误处理
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ToolTimeoutError(errorMessage, timeoutMs)), timeoutMs)
    })
    return Promise.race([promise, timeoutPromise])
  }
}
```

**生产误区**
1. ❌ 超时后 Promise 仍在后台运行（未使用 `AbortController` 取消）
2. ❌ 所有工具使用统一超时值（查询工具 5s，分析工具应该 30s）
3. ❌ 超时错误被捕获后未清理资源（数据库连接、文件句柄）

**验证方法**
```bash
# 测试1：模拟慢查询
# 修改 get-metrics.tool.ts：
async execute(args, ctx) {
  await new Promise(resolve => setTimeout(resolve, 6000)) // 睡眠 6s
  return []
}

curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"get-metrics","args":{"serverId":"s1"}}'
# 预期：5s 后返回 {"code":"TOOL_TIMEOUT","details":{"timeoutMs":5000}}

# 测试2：正常执行
# 恢复 get-metrics.tool.ts 正常逻辑
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"list-servers","args":{}}'
# 预期：< 1s 返回结果
```

---

#### 知识点5：结果裁剪（防止超大响应）

**解决的问题**
Tool 返回的数据可能过大：
- `list-servers` 返回 10000 台服务器（每台 2KB，总计 20MB）
- `get-metrics` 返回 1 小时的秒级数据（3600 条记录）

超大响应导致：
- 网络传输慢
- AI Token 消耗爆炸
- 前端渲染卡顿

结果裁剪机制限制返回记录数。

**运行机制**
```typescript
private truncateResult(data: any): any {
  if (Array.isArray(data)) {
    if (data.length > this.MAX_RESULT_SIZE) {
      this.logger.warn(`Result truncated: ${data.length} -> ${this.MAX_RESULT_SIZE}`)
      return {
        items: data.slice(0, this.MAX_RESULT_SIZE),
        total: data.length,
        truncated: true,
      }
    }
    return data
  }
  return data
}

// 使用示例
const data = await tool.execute(args, context)
const result: ToolResult = {
  success: true,
  data: this.truncateResult(data), // 裁剪前 10000 条 -> 裁剪后 100 条
  metadata: { executionTime: duration },
}
```

**项目落点**
```typescript
// tools/registry/tool-registry.service.ts
@Injectable()
export class ToolRegistryService {
  private readonly MAX_RESULT_SIZE = 100

  async execute(toolName: string, args: unknown, context: ToolContext): Promise<ToolResult> {
    // ... 校验、执行
    const data = await tool.execute(parseResult.data, context)

    const result: ToolResult = {
      success: true,
      data: this.truncateResult(data), // 裁剪逻辑
      metadata: { executionTime: duration },
    }

    return result
  }

  private truncateResult(data: any): any {
    if (Array.isArray(data)) {
      if (data.length > this.MAX_RESULT_SIZE) {
        this.logger.warn(`Result truncated: ${data.length} -> ${this.MAX_RESULT_SIZE}`)
        return {
          items: data.slice(0, this.MAX_RESULT_SIZE),
          total: data.length,
          truncated: true,
        }
      }
    }
    return data
  }
}
```

**生产误区**
1. ❌ 直接在数据库层 `LIMIT 100`，导致无法统计总数（用户不知道还有多少数据）
2. ❌ 裁剪后未设置 `truncated: true` 标记，AI 误以为只有 100 条数据
3. ❌ 裁剪逻辑在每个 Tool 里重复实现，未统一到 Registry

**验证方法**
```bash
# 测试1：大量数据
# 在数据库插入 500 台服务器
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"list-servers","args":{}}'
# 预期：{"success":true,"data":{"items":[...100条...],"total":500,"truncated":true}}

# 测试2：少量数据
# 数据库只有 10 台服务器
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"list-servers","args":{}}'
# 预期：{"success":true,"data":[...10条...]} (无 truncated 字段)
```

---

#### 知识点6：审计链（ToolAuditService）

**解决的问题**
生产环境需回答：
- 谁在什么时间调用了哪个工具？
- 传入的参数是什么？
- 执行结果是成功还是失败？
- 执行耗时多久？
- 是否访问了敏感数据（serverId / alertId）？

审计服务将所有调用记录持久化到数据库，支持事后溯源。

**运行机制**
```typescript
// 1. 定义审计日志结构
interface AuditLogEntry {
  toolName: string
  args: Record<string, any>
  result: ToolResult
  duration: number
  userId: string
  timestamp: Date
}

// 2. 审计服务记录日志
@Injectable()
export class ToolAuditService {
  async logExecution(entry: AuditLogEntry): Promise<void> {
    await this.prisma.toolAuditLog.create({
      data: {
        toolName: entry.toolName,
        args: this.sanitize(entry.args), // 脱敏
        result: entry.result,
        duration: entry.duration,
        userId: entry.userId,
        timestamp: entry.timestamp || new Date(),
      },
    })
  }

  private sanitize(data: any): any {
    // 移除敏感字段（password / token）
    const sensitiveKeys = ['password', 'token', 'apiKey']
    const sanitized = { ...data }
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '***REDACTED***'
      }
    }
    return sanitized
  }
}

// 3. Registry 在执行前后调用审计
async execute(toolName: string, args: unknown, context: ToolContext) {
  const startTime = Date.now()
  try {
    const data = await tool.execute(args, context)
    const duration = Date.now() - startTime

    const result: ToolResult = { success: true, data, metadata: { executionTime: duration } }

    await this.auditService.logExecution({
      toolName,
      args,
      result,
      duration,
      userId: context.userId,
    })

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    const result: ToolResult = { success: false, error: error.message }

    await this.auditService.logExecution({
      toolName,
      args,
      result,
      duration,
      userId: context.userId,
    })

    throw error
  }
}
```

**项目落点**
```typescript
// tools/audit/tool-audit.service.ts
@Injectable()
export class ToolAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logExecution(entry: AuditLogEntry): Promise<void> {
    await this.prisma.toolAuditLog.create({
      data: {
        toolName: entry.toolName,
        args: this.sanitize(entry.args),
        result: entry.result,
        duration: entry.duration,
        userId: entry.userId,
        timestamp: entry.timestamp || new Date(),
      },
    })
  }

  private sanitize(data: any): any { ... }
}

// tools/registry/tool-registry.service.ts
async execute(toolName: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    const data = await this.withTimeout(...)
    const duration = Date.now() - startTime

    const result: ToolResult = { success: true, data: this.truncateResult(data), metadata: { executionTime: duration } }

    await this.auditService.logExecution({
      toolName,
      args: parseResult.data,
      result,
      duration,
      userId: context.userId,
    })

    return result
  } catch (error) {
    const duration = Date.now() - startTime

    const result: ToolResult = {
      success: false,
      error: error instanceof ToolError ? error.message : 'Unknown error',
      metadata: { executionTime: duration },
    }

    await this.auditService.logExecution({
      toolName,
      args: parseResult.data,
      result,
      duration,
      userId: context.userId,
    })

    throw error
  }
}
```

**生产误区**
1. ❌ 审计日志同步写入数据库，导致 Tool 执行变慢（应该用消息队列异步写入）
2. ❌ 未对敏感字段脱敏，审计日志泄露用户密码 / Token
3. ❌ 只记录成功调用，失败调用未记录（无法排查问题）

**验证方法**
```bash
# 测试1：执行工具后查询审计日志
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"list-servers","args":{}}'

# 查询数据库
psql -d monitoring -c "SELECT tool_name, args, duration, user_id FROM tool_audit_log ORDER BY timestamp DESC LIMIT 1;"
# 预期：
# tool_name   | args | duration | user_id
# list-servers | {}   | 234      | user-123

# 测试2：失败调用也被记录
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"unknown","args":{}}'

psql -d monitoring -c "SELECT tool_name, result FROM tool_audit_log ORDER BY timestamp DESC LIMIT 1;"
# 预期：
# tool_name | result
# unknown   | {"success":false,"error":"Tool \"unknown\" not found"}
```

---

---

## 6. 三版对比一览表（看清进化路径）

| 对比维度 | v1 最小闭环 | v2 Schema + 超时 | v3 生产级 Registry |
|---------|------------|----------------|-------------------|
| **文件数** | 2 个 | 3 个 | 9 个 |
| **代码行数** | ~80 行 | ~150 行 | ~600 行 |
| **工具定义方式** | Controller 方法 | Controller 方法 + Schema | ToolDefinition 接口 |
| **参数校验** | 无 | Zod Schema | Zod Schema（Registry 统一校验） |
| **超时保护** | 无 | 有（5s） | 有（5s，可配置） |
| **结果裁剪** | 无 | 无 | 有（100 条） |
| **错误分类** | 通用 Error | 通用 Error | 4 种自定义 ToolError |
| **审计日志** | 无 | 无 | 有（ToolAuditService） |
| **工具注册** | 硬编码路由 | 硬编码路由 | 动态注册（Registry） |
| **可扩展性** | 差（新增工具改 Controller） | 差（新增工具改 Controller） | 好（新增工具只需实现 ToolDefinition） |
| **测试难度** | 中（需启动 NestJS） | 中（需启动 NestJS） | 低（Registry 可独立测试） |
| **生产就绪** | ❌ 不可用 | ⚠️ 勉强可用 | ✅ 可用 |

**关键差异总结**

1. **v1 → v2**：加入 Schema 校验和超时保护，防止非法输入和挂起
2. **v2 → v3**：引入 Registry 模式、错误分类、审计日志，满足生产环境的可观测性和可扩展性需求
3. **代码量增长原因**：
   - v1 只有 Controller 和 Tool 实现
   - v2 增加 Schema 定义
   - v3 增加 Registry、Audit、Error、Types 四层抽象

**实战建议**

- 学习阶段：从 v1 开始，理解最小闭环
- 小团队项目（< 5 个工具）：使用 v2
- 企业级项目（10+ 工具 + 多人协作）：必须使用 v3

---

### 6.5 前端底子补弱：details + summary 折叠面板（审计日志展示）

#### 主题：`<details>` + `<summary>` 折叠面板

**场景锚点**
Tool 审计日志需要展示：
- 工具名称 + 执行时间 + 状态（成功 / 失败）：默认可见
- 完整的 `args`、`result`、`duration` 数据：点击后展开

使用原生 `<details>` + `<summary>` 实现无 JS 的折叠面板。

---

#### 6.5.1 项目代码（审计日志展示）

**apps/web/src/components/AuditLogViewer.tsx**

```tsx
import React from 'react'

interface AuditLog {
  id: string
  toolName: string
  args: Record<string, any>
  result: { success: boolean; data?: any; error?: string }
  duration: number
  userId: string
  timestamp: string
}

export function AuditLogViewer({ logs }: { logs: AuditLog[] }) {
  return (
    <div className="audit-log-viewer">
      {logs.map(log => (
        <details key={log.id} className="audit-log-item">
          <summary className="audit-log-summary">
            <span className={`status ${log.result.success ? 'success' : 'failure'}`}>
              {log.result.success ? '✅' : '❌'}
            </span>
            <span className="tool-name">{log.toolName}</span>
            <span className="timestamp">{new Date(log.timestamp).toLocaleString()}</span>
            <span className="duration">{log.duration}ms</span>
          </summary>
          
          <div className="audit-log-details">
            <section>
              <h4>Arguments</h4>
              <pre>{JSON.stringify(log.args, null, 2)}</pre>
            </section>
            
            <section>
              <h4>Result</h4>
              <pre>{JSON.stringify(log.result, null, 2)}</pre>
            </section>
            
            <section>
              <h4>Metadata</h4>
              <ul>
                <li>User ID: {log.userId}</li>
                <li>Duration: {log.duration}ms</li>
                <li>Timestamp: {log.timestamp}</li>
              </ul>
            </section>
          </div>
        </details>
      ))}
    </div>
  )
}
```

**apps/web/src/styles/audit-log.css**

```css
.audit-log-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.audit-log-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.audit-log-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f9fafb;
  cursor: pointer;
  list-style: none; /* 移除默认三角箭头 */
  user-select: none;
}

.audit-log-summary::-webkit-details-marker {
  display: none; /* 移除 Chrome 的默认标记 */
}

.audit-log-summary::before {
  content: '▶';
  font-size: 12px;
  color: #6b7280;
  transition: transform 0.2s;
}

details[open] .audit-log-summary::before {
  transform: rotate(90deg);
}

.audit-log-summary:hover {
  background: #f3f4f6;
}

.status {
  font-size: 18px;
}

.tool-name {
  font-weight: 600;
  color: #111827;
}

.timestamp {
  color: #6b7280;
  font-size: 14px;
}

.duration {
  margin-left: auto;
  font-size: 14px;
  color: #9ca3af;
}

.audit-log-details {
  padding: 16px;
  background: #ffffff;
  border-top: 1px solid #e5e7eb;
}

.audit-log-details section {
  margin-bottom: 16px;
}

.audit-log-details section:last-child {
  margin-bottom: 0;
}

.audit-log-details h4 {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.audit-log-details pre {
  background: #f9fafb;
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  overflow-x: auto;
}

.audit-log-details ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.audit-log-details li {
  padding: 4px 0;
  font-size: 14px;
  color: #6b7280;
}
```

---

#### 6.5.2 设计点拆解（5 个关键设计点）

**设计点1：无 JS 折叠交互**

```html
<details>
  <summary>点击展开</summary>
  <div>隐藏内容</div>
</details>
```

- `<details>` 默认状态：`closed`（内容隐藏）
- 点击 `<summary>` 后：浏览器自动切换为 `open` 状态
- 无需 `onClick` 事件，完全由浏览器原生支持

**设计点2：移除默认三角箭头**

```css
.audit-log-summary {
  list-style: none; /* 移除 Firefox 的默认箭头 */
}

.audit-log-summary::-webkit-details-marker {
  display: none; /* 移除 Chrome 的默认标记 */
}
```

默认情况下，浏览器会在 `<summary>` 前显示一个三角箭头。通过上述 CSS 移除后，自定义箭头。

**设计点3：自定义展开 / 收起箭头**

```css
.audit-log-summary::before {
  content: '▶'; /* 收起状态：右箭头 */
  transition: transform 0.2s;
}

details[open] .audit-log-summary::before {
  transform: rotate(90deg); /* 展开状态：下箭头 */
}
```

- `::before` 伪元素插入箭头图标
- `details[open]` 属性选择器匹配展开状态
- `transform: rotate(90deg)` 实现旋转动画

**设计点4：`<summary>` 作为表格行布局**

```css
.audit-log-summary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.duration {
  margin-left: auto; /* 推到右侧 */
}
```

- `display: flex` 将 `<summary>` 内的元素横向排列
- `gap: 12px` 统一间距
- `margin-left: auto` 将 duration 推到最右侧

**设计点5：展开内容的层次布局**

```html
<div className="audit-log-details">
  <section>
    <h4>Arguments</h4>
    <pre>{JSON.stringify(log.args, null, 2)}</pre>
  </section>
  <section>
    <h4>Result</h4>
    <pre>{JSON.stringify(log.result, null, 2)}</pre>
  </section>
</div>
```

- 每个 `<section>` 包含一个标题 + 内容块
- `<pre>` 标签保留 JSON 格式化空格
- `overflow-x: auto` 处理超长内容

---

#### 6.5.3 原理深挖（`<details>` 的 DOM API）

**原理1：`open` 属性控制展开状态**

```html
<!-- 默认收起 -->
<details>
  <summary>点击展开</summary>
  <div>内容</div>
</details>

<!-- 默认展开 -->
<details open>
  <summary>点击收起</summary>
  <div>内容</div>
</details>
```

JavaScript 可以直接操作 `open` 属性：

```javascript
const details = document.querySelector('details')

// 展开
details.open = true

// 收起
details.open = false

// 切换
details.open = !details.open
```

**原理2：`toggle` 事件监听展开 / 收起**

```javascript
const details = document.querySelector('details')

details.addEventListener('toggle', (event) => {
  if (details.open) {
    console.log('展开了')
  } else {
    console.log('收起了')
  }
})
```

用途：
- 展开时加载数据（懒加载）
- 收起时清理资源
- 统计用户交互行为

**原理3：CSS 属性选择器 `details[open]`**

```css
/* 收起状态 */
details {
  border: 1px solid #ccc;
}

/* 展开状态 */
details[open] {
  border-color: #3b82f6;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}
```

CSS 可以根据 `open` 属性的存在与否应用不同样式。

**原理4：浏览器兼容性**

- ✅ Chrome 12+
- ✅ Firefox 49+
- ✅ Safari 6+
- ✅ Edge 79+
- ❌ IE（不支持，需要 polyfill）

**Polyfill 方案**（兼容 IE）：

```javascript
// details-polyfill.js
if (!('open' in document.createElement('details'))) {
  document.addEventListener('click', (event) => {
    if (event.target.tagName === 'SUMMARY') {
      const details = event.target.parentElement
      if (details.tagName === 'DETAILS') {
        if (details.hasAttribute('open')) {
          details.removeAttribute('open')
        } else {
          details.setAttribute('open', '')
        }
      }
    }
  })
}
```

---

#### 6.5.4 反例（3 个常见错误）

**反例1：在 `<summary>` 外层套 `<div>`**

❌ 错误写法：

```html
<details>
  <div>
    <summary>标题</summary>
  </div>
  <div>内容</div>
</details>
```

❌ 问题：`<summary>` 必须是 `<details>` 的**直接子元素**，否则浏览器不会识别为可点击区域。

✅ 正确写法：

```html
<details>
  <summary>
    <div>标题</div>
  </summary>
  <div>内容</div>
</details>
```

---

**反例2：用 `display: none` 隐藏内容**

❌ 错误写法：

```css
details > div {
  display: none;
}

details[open] > div {
  display: block;
}
```

❌ 问题：
1. 破坏了 `<details>` 的语义化
2. 屏幕阅读器无法正确解析展开 / 收起状态

✅ 正确写法：
不要手动控制内容的显示 / 隐藏，让浏览器原生处理。

---

**反例3：在 `<summary>` 上阻止默认事件**

❌ 错误写法：

```javascript
document.querySelector('summary').addEventListener('click', (event) => {
  event.preventDefault() // 阻止默认展开行为
  // 自定义逻辑
})
```

❌ 问题：阻止默认事件后，`<details>` 无法展开。

✅ 正确写法：
如果需要自定义逻辑，在逻辑执行后让默认行为继续：

```javascript
document.querySelector('summary').addEventListener('click', (event) => {
  // 自定义逻辑（如埋点）
  console.log('用户点击了 summary')
  // 不调用 event.preventDefault()，让浏览器继续处理展开 / 收起
})
```

---

#### 6.5.5 分层提问（3 个层次）

**L1：基础层（记忆）**

Q1：`<details>` 和 `<summary>` 的作用是什么？  
A1：`<details>` 创建可折叠内容块，`<summary>` 是折叠块的标题，点击后展开 / 收起内容。

Q2：如何让 `<details>` 默认展开？  
A2：添加 `open` 属性：`<details open>`。

Q3：如何移除浏览器默认的三角箭头？  
A3：CSS 添加 `list-style: none` 和 `::-webkit-details-marker { display: none }`。

---

**L2：应用层（理解）**

Q4：如何实现"只允许同时展开一个 details"（手风琴效果）？  
A4：监听 `toggle` 事件，当某个 details 展开时，关闭其他 details：

```javascript
document.querySelectorAll('details').forEach(details => {
  details.addEventListener('toggle', () => {
    if (details.open) {
      document.querySelectorAll('details').forEach(other => {
        if (other !== details) {
          other.open = false
        }
      })
    }
  })
})
```

Q5：如何实现"展开时从服务器加载数据"（懒加载）？  
A5：监听 `toggle` 事件，当 `open` 为 true 且数据未加载时发起请求：

```javascript
details.addEventListener('toggle', async () => {
  if (details.open && !details.dataset.loaded) {
    const data = await fetch('/api/audit-logs/' + details.dataset.id).then(r => r.json())
    details.querySelector('.content').innerHTML = JSON.stringify(data, null, 2)
    details.dataset.loaded = 'true'
  }
})
```

Q6：如何让 `<summary>` 的右侧显示状态图标（✅ / ❌）？  
A6：使用 `display: flex` + `margin-left: auto`：

```css
.audit-log-summary {
  display: flex;
  align-items: center;
}

.status-icon {
  margin-left: auto; /* 推到右侧 */
}
```

---

**L3：系统层（迁移）**

Q7：如果项目已经用 `div + onClick` 实现了折叠面板，迁移到 `<details>` 有哪些好处？  
A7：
1. **无障碍性**：屏幕阅读器自动识别展开 / 收起状态
2. **无 JS 依赖**：即使 JS 加载失败，折叠功能仍可用
3. **语义化**：搜索引擎能更好地理解内容结构
4. **代码量减少**：不需要手动管理 state 和 onClick

Q8：`<details>` 在移动端有哪些注意事项？  
A8：
1. `<summary>` 的 `padding` 要足够大（至少 44x44px），方便触摸
2. 展开内容不要过长，避免滚动嵌套
3. 在 iOS Safari 中，`<summary>` 默认有蓝色高亮，需要用 `-webkit-tap-highlight-color: transparent` 移除

Q9：如何实现"展开时添加动画"？  
A9：使用 CSS `@keyframes`：

```css
details[open] > .content {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

#### 6.5.6 项目对手戏（与后端 API 的配合）

**场景：审计日志列表 + 详情展开**

1. **后端提供列表 API**（只返回摘要信息）

```typescript
// GET /api/tools/audit-logs
{
  logs: [
    {
      id: 'log-1',
      toolName: 'list-servers',
      timestamp: '2026-07-16T10:30:00Z',
      duration: 234,
      success: true,
    },
    // ... 更多日志
  ]
}
```

2. **前端渲染 `<details>` 列表**

```tsx
export function AuditLogList() {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    fetch('/api/tools/audit-logs')
      .then(r => r.json())
      .then(data => setLogs(data.logs))
  }, [])

  return (
    <div>
      {logs.map(log => (
        <details key={log.id} onToggle={(e) => handleToggle(e, log.id)}>
          <summary>
            {log.toolName} - {log.timestamp} - {log.duration}ms
          </summary>
          <div className="content" data-log-id={log.id}>
            加载中...
          </div>
        </details>
      ))}
    </div>
  )
}
```

3. **展开时加载详情**

```typescript
async function handleToggle(event: React.SyntheticEvent<HTMLDetailsElement>, logId: string) {
  const details = event.currentTarget
  if (details.open) {
    const contentDiv = details.querySelector('.content')
    if (!contentDiv.dataset.loaded) {
      const data = await fetch(`/api/tools/audit-logs/${logId}`).then(r => r.json())
      contentDiv.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`
      contentDiv.dataset.loaded = 'true'
    }
  }
}
```

4. **后端提供详情 API**

```typescript
// GET /api/tools/audit-logs/:id
{
  id: 'log-1',
  toolName: 'list-servers',
  args: { status: 'active' },
  result: {
    success: true,
    data: { items: [...], total: 500, truncated: true }
  },
  duration: 234,
  userId: 'user-123',
  timestamp: '2026-07-16T10:30:00Z',
}
```

**关键配合点**

- 列表 API 只返回必要字段，减少带宽
- 详情 API 按需加载，避免一次性传输所有数据
- 前端用 `data-loaded` 防止重复加载

---

#### 6.5.7 面试真题（3 道递进题）

**真题1：`<details>` 和 `<dialog>` 的区别？**

| 特性 | `<details>` | `<dialog>` |
|-----|------------|-----------|
| 用途 | 折叠面板（内联内容） | 模态框（覆盖内容） |
| 默认行为 | 点击 summary 展开 / 收起 | 需要 JS 调用 `showModal()` |
| 布局影响 | 展开时推开下方内容 | 展开时覆盖页面 |
| 关闭方式 | 再次点击 summary | `<form method="dialog">` 或 `dialog.close()` |
| 无障碍 | 自动添加 `aria-expanded` | 自动添加 `role="dialog"` + focus 管理 |

---

**真题2：如何实现"点击 details 外部区域时收起"？**

```javascript
document.addEventListener('click', (event) => {
  const details = document.querySelector('details[open]')
  if (details && !details.contains(event.target)) {
    details.open = false
  }
})
```

注意：
- `details.contains(event.target)` 判断点击是否在 details 内部
- 如果点击在外部，设置 `details.open = false`

---

**真题3：如何实现"展开时滚动到 details 顶部"？**

```javascript
details.addEventListener('toggle', () => {
  if (details.open) {
    details.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
})
```

用途：
- 列表很长时，展开后自动滚动到当前项
- 提升用户体验（无需手动滚动找到展开内容）

---

---

## 7. 项目验收清单（必须全部通过）

### 7.1 A：v1 最小闭环能跑通

```bash
# 1. 启动 API 服务
cd apps/api
pnpm run dev

# 2. 测试 list-servers 工具
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"list-servers","args":{}}'

# 预期输出
{
  "success": true,
  "data": [
    {"id":"s1","name":"web-server-01","status":"active","ip":"10.0.1.10"},
    {"id":"s2","name":"api-server-01","status":"active","ip":"10.0.1.20"}
  ]
}
```

**通过标准**
- 返回 HTTP 200
- `success: true`
- `data` 数组包含至少 1 台服务器

---

### 7.2 B：v2 Schema 校验生效

**测试1：缺失必填字段**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get-metrics","args":{}}'

# 预期输出
{
  "code": "TOOL_SCHEMA_ERROR",
  "message": "Schema validation failed for tool \"get-metrics\"",
  "details": {
    "issues": [
      {
        "path": ["serverId"],
        "message": "Required"
      }
    ]
  }
}
```

**测试2：类型错误**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get-metrics","args":{"serverId":123}}'

# 预期输出
{
  "code": "TOOL_SCHEMA_ERROR",
  "details": {
    "issues": [
      {
        "path": ["serverId"],
        "message": "Expected string, received number"
      }
    ]
  }
}
```

**测试3：自定义约束（空字符串）**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get-metrics","args":{"serverId":""}}'

# 预期输出
{
  "code": "TOOL_SCHEMA_ERROR",
  "details": {
    "issues": [
      {
        "path": ["serverId"],
        "message": "String must contain at least 1 character(s)"
      }
    ]
  }
}
```

**通过标准**
- 3 个测试全部返回 `TOOL_SCHEMA_ERROR`
- `details.issues` 数组包含详细错误信息

---

### 7.3 C：v2 超时保护生效

**测试步骤**

1. **模拟慢工具**：修改 `get-metrics.tool.ts`

```typescript
// apps/api/src/tools/implementations/get-metrics.tool.ts
export const getMetricsTool: ToolDefinition<GetMetricsArgs> = {
  name: 'get-metrics',
  description: 'Get server metrics',
  schema: GetMetricsArgsSchema,
  async execute(args: GetMetricsArgs, context: ToolContext) {
    // 模拟慢查询：睡眠 6 秒
    await new Promise(resolve => setTimeout(resolve, 6000))
    
    return []
  },
}
```

2. **调用工具**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get-metrics","args":{"serverId":"s1"}}'

# 预期输出（5秒后返回）
{
  "code": "TOOL_TIMEOUT",
  "message": "Tool \"get-metrics\" execution timeout",
  "details": {
    "timeoutMs": 5000
  }
}
```

3. **恢复正常逻辑**

```typescript
// 删除 setTimeout，恢复原始逻辑
async execute(args: GetMetricsArgs, context: ToolContext) {
  const metrics = await context.prisma.metric.findMany({
    where: { serverId: args.serverId },
  })
  return metrics
}
```

**通过标准**
- 模拟慢查询时，5 秒后返回 `TOOL_TIMEOUT`
- 恢复正常逻辑后，1 秒内返回正常数据

---

### 7.4 D：v3 Registry 能动态注册工具

**测试步骤**

1. **查询初始工具列表**

```bash
curl http://localhost:3000/api/tools/list

# 预期输出
{
  "tools": [
    {"name":"list-servers","description":"List all servers"},
    {"name":"get-metrics","description":"Get server metrics"},
    {"name":"get-alert-detail","description":"Get alert details"}
  ]
}
```

2. **新增测试工具**

创建 `apps/api/src/tools/implementations/test-tool.tool.ts`

```typescript
import { z } from 'zod'
import { ToolDefinition, ToolContext } from '../types/tool.types'

const TestToolArgsSchema = z.object({
  message: z.string(),
})

type TestToolArgs = z.infer<typeof TestToolArgsSchema>

export const testTool: ToolDefinition<TestToolArgs> = {
  name: 'test-tool',
  description: 'Test tool for verification',
  schema: TestToolArgsSchema,
  async execute(args: TestToolArgs, context: ToolContext) {
    return { echo: args.message }
  },
}
```

3. **在 Module 中注册**

```typescript
// apps/api/src/tools/tools.module.ts
import { testTool } from './implementations/test-tool.tool'

export class ToolsModule implements OnModuleInit {
  onModuleInit() {
    this.registry.registerAll([
      listServersTool,
      getMetricsTool,
      getAlertDetailTool,
      testTool, // 新增
    ])
  }
}
```

4. **重启服务，验证工具已注册**

```bash
curl http://localhost:3000/api/tools/list

# 预期输出（包含 test-tool）
{
  "tools": [
    {"name":"list-servers","description":"List all servers"},
    {"name":"get-metrics","description":"Get server metrics"},
    {"name":"get-alert-detail","description":"Get alert details"},
    {"name":"test-tool","description":"Test tool for verification"}
  ]
}
```

5. **调用新工具**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"test-tool","args":{"message":"hello"}}'

# 预期输出
{
  "success": true,
  "data": {"echo":"hello"},
  "metadata": {"executionTime":5}
}
```

**通过标准**
- `/tools/list` 返回 4 个工具（包含 test-tool）
- 调用 test-tool 返回正确结果
- 无需修改 Controller 代码

---

### 7.5 E：v3 审计日志被记录

**测试步骤**

1. **执行工具**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"list-servers","args":{"status":"active"}}'
```

2. **查询数据库审计日志**

```sql
-- 进入 PostgreSQL
psql -U postgres -d monitoring

-- 查询最近 1 条审计日志
SELECT 
  tool_name,
  args,
  result->>'success' as success,
  duration,
  user_id,
  timestamp
FROM tool_audit_log
ORDER BY timestamp DESC
LIMIT 1;
```

**预期输出**

```
 tool_name    | args                      | success | duration | user_id  | timestamp
--------------+---------------------------+---------+----------+----------+-------------------------
 list-servers | {"status":"active"}       | true    | 234      | user-123 | 2026-07-16 10:30:45.123
```

3. **执行失败的工具（验证失败日志也被记录）**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"unknown","args":{}}'
```

**查询失败日志**

```sql
SELECT 
  tool_name,
  result->>'success' as success,
  result->>'error' as error
FROM tool_audit_log
ORDER BY timestamp DESC
LIMIT 1;
```

**预期输出**

```
 tool_name | success | error
-----------+---------+-------------------------------------
 unknown   | false   | Tool "unknown" not found
```

**通过标准**
- 成功调用被记录，`success: true`
- 失败调用被记录，`success: false`，包含错误信息
- 审计日志包含 `args`、`result`、`duration`、`userId`

---

### 7.6 F：写核心逻辑单元测试

创建 `apps/api/src/tools/registry/tool-registry.service.spec.ts`

```typescript
import { Test } from '@nestjs/testing'
import { ToolRegistryService } from './tool-registry.service'
import { ToolAuditService } from '../audit/tool-audit.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ToolDefinition, ToolContext } from '../types/tool.types'
import { z } from 'zod'
import { ToolNotFoundError, ToolSchemaError, ToolTimeoutError } from '../errors/tool.errors'

describe('ToolRegistryService', () => {
  let service: ToolRegistryService
  let auditService: ToolAuditService

  const mockTool: ToolDefinition = {
    name: 'mock-tool',
    description: 'Mock tool for testing',
    schema: z.object({ value: z.string() }),
    async execute(args: any) {
      return { result: args.value }
    },
  }

  const mockSlowTool: ToolDefinition = {
    name: 'slow-tool',
    description: 'Slow tool for timeout testing',
    schema: z.object({}),
    async execute() {
      await new Promise(resolve => setTimeout(resolve, 10000))
      return {}
    },
  }

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        {
          provide: ToolAuditService,
          useValue: {
            logExecution: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile()

    service = module.get<ToolRegistryService>(ToolRegistryService)
    auditService = module.get<ToolAuditService>(ToolAuditService)
  })

  describe('register', () => {
    it('should register a tool', () => {
      service.register(mockTool)
      const tools = service.listTools()
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('mock-tool')
    })

    it('should overwrite existing tool with warning', () => {
      service.register(mockTool)
      service.register(mockTool)
      const tools = service.listTools()
      expect(tools).toHaveLength(1)
    })
  })

  describe('execute', () => {
    const context: ToolContext = {
      prisma: {} as any,
      userId: 'test-user',
    }

    beforeEach(() => {
      service.register(mockTool)
    })

    it('should execute tool successfully', async () => {
      const result = await service.execute('mock-tool', { value: 'test' }, context)
      
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ result: 'test' })
      expect(result.metadata?.executionTime).toBeGreaterThan(0)
      expect(auditService.logExecution).toHaveBeenCalled()
    })

    it('should throw ToolNotFoundError for unknown tool', async () => {
      await expect(
        service.execute('unknown', {}, context)
      ).rejects.toThrow(ToolNotFoundError)
    })

    it('should throw ToolSchemaError for invalid args', async () => {
      await expect(
        service.execute('mock-tool', { value: 123 }, context)
      ).rejects.toThrow(ToolSchemaError)
    })

    it('should throw ToolTimeoutError for slow tool', async () => {
      service.register(mockSlowTool)

      await expect(
        service.execute('slow-tool', {}, context)
      ).rejects.toThrow(ToolTimeoutError)
    }, 10000)

    it('should log audit even on failure', async () => {
      try {
        await service.execute('unknown', {}, context)
      } catch (error) {
        // 预期抛出错误
      }

      expect(auditService.logExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'unknown',
          result: expect.objectContaining({
            success: false,
          }),
        })
      )
    })
  })

  describe('truncateResult', () => {
    it('should truncate large arrays', async () => {
      const largeTool: ToolDefinition = {
        name: 'large-tool',
        description: 'Returns large array',
        schema: z.object({}),
        async execute() {
          return Array.from({ length: 500 }, (_, i) => ({ id: i }))
        },
      }

      service.register(largeTool)

      const result = await service.execute('large-tool', {}, {
        prisma: {} as any,
        userId: 'test-user',
      })

      expect(result.data.truncated).toBe(true)
      expect(result.data.items).toHaveLength(100)
      expect(result.data.total).toBe(500)
    })

    it('should not truncate small arrays', async () => {
      const result = await service.execute('mock-tool', { value: 'test' }, {
        prisma: {} as any,
        userId: 'test-user',
      })

      expect(result.data.truncated).toBeUndefined()
    })
  })
})
```

**运行测试**

```bash
cd apps/api
pnpm test tool-registry.service.spec.ts

# 预期输出
PASS  src/tools/registry/tool-registry.service.spec.ts
  ToolRegistryService
    register
      ✓ should register a tool (5ms)
      ✓ should overwrite existing tool with warning (3ms)
    execute
      ✓ should execute tool successfully (45ms)
      ✓ should throw ToolNotFoundError for unknown tool (8ms)
      ✓ should throw ToolSchemaError for invalid args (6ms)
      ✓ should throw ToolTimeoutError for slow tool (5023ms)
      ✓ should log audit even on failure (12ms)
    truncateResult
      ✓ should truncate large arrays (38ms)
      ✓ should not truncate small arrays (7ms)

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

**通过标准**
- 所有 9 个测试通过
- 覆盖 Registry 核心逻辑：注册 / 执行 / 校验 / 超时 / 裁剪 / 审计

---

### 7.7 G-1：反证实验1（移除超时保护）

**目的**：验证超时保护的必要性

**步骤**

1. **备份原始代码**

```bash
cp apps/api/src/tools/registry/tool-registry.service.ts apps/api/src/tools/registry/tool-registry.service.ts.bak
```

2. **移除超时保护逻辑**

```typescript
// apps/api/src/tools/registry/tool-registry.service.ts
async execute(toolName: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  // ... 省略校验逻辑

  const startTime = Date.now()

  try {
    // ❌ 移除超时保护，直接执行
    const data = await tool.execute(parseResult.data, context)

    // ... 其余逻辑不变
  }
}
```

3. **模拟慢工具**

```typescript
// apps/api/src/tools/implementations/get-metrics.tool.ts
async execute(args: GetMetricsArgs, context: ToolContext) {
  await new Promise(resolve => setTimeout(resolve, 30000)) // 睡眠 30 秒
  return []
}
```

4. **调用工具**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get-metrics","args":{"serverId":"s1"}}'

# 现象：请求挂起 30 秒才返回
```

5. **恢复代码**

```bash
cp apps/api/src/tools/registry/tool-registry.service.ts.bak apps/api/src/tools/registry/tool-registry.service.ts
```

**结论**
- 移除超时保护后，慢工具导致请求长时间挂起
- 超时保护机制能保证在 5 秒内返回（成功或超时错误）

---

### 7.8 G-2：反证实验2（移除结果裁剪）

**目的**：验证结果裁剪的必要性

**步骤**

1. **备份原始代码**

```bash
cp apps/api/src/tools/registry/tool-registry.service.ts apps/api/src/tools/registry/tool-registry.service.ts.bak
```

2. **移除结果裁剪逻辑**

```typescript
// apps/api/src/tools/registry/tool-registry.service.ts
async execute(toolName: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  // ... 省略其他逻辑

  const result: ToolResult = {
    success: true,
    data: data, // ❌ 直接返回原始数据，不裁剪
    metadata: { executionTime: duration },
  }

  return result
}
```

3. **插入大量测试数据**

```sql
-- 插入 5000 台服务器
INSERT INTO server (id, name, status, ip)
SELECT 
  'server-' || generate_series,
  'Server ' || generate_series,
  'active',
  '10.0.' || (generate_series / 256) || '.' || (generate_series % 256)
FROM generate_series(1, 5000);
```

4. **调用 list-servers**

```bash
curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"list-servers","args":{}}' \
  > response.json

# 查看响应大小
ls -lh response.json
# 输出：-rw-r--r-- 1 user user 2.5M Jul 16 10:30 response.json
```

**现象**
- 响应体积 2.5MB（5000 条记录 × 每条 500 字节）
- 传输时间 > 10 秒（取决于网络带宽）
- 前端渲染卡顿（大量 DOM 节点）

5. **恢复代码并测试**

```bash
cp apps/api/src/tools/registry/tool-registry.service.ts.bak apps/api/src/tools/registry/tool-registry.service.ts

curl -X POST http://localhost:3000/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName":"list-servers","args":{}}' \
  > response-truncated.json

ls -lh response-truncated.json
# 输出：-rw-r--r-- 1 user user 52K Jul 16 10:31 response-truncated.json
```

**对比**

| 指标 | 无裁剪 | 有裁剪 |
|-----|-------|-------|
| 响应体积 | 2.5MB | 52KB |
| 传输时间 | > 10s | < 1s |
| 返回记录数 | 5000 | 100（+ total: 5000） |

**结论**
- 结果裁剪将响应体积减少 98%
- 传输时间减少 90%
- 用户仍能通过 `total` 字段知道总数

---

### 7.9 H：验证 + 提交

**步骤1：运行完整测试套件**

```bash
cd apps/api
pnpm test

# 预期输出
Test Suites: 5 passed, 5 total
Tests:       27 passed, 27 total
```

**步骤2：手动验证核心流程**

```bash
# 1. 查询工具列表
curl http://localhost:3000/api/tools/list

# 2. 执行成功的工具
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"list-servers","args":{}}'

# 3. 触发 Schema 错误
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"get-metrics","args":}'

# 4. 触发工具不存在错误
curl -X POST http://localhost:3000/api/tools/execute \
  -d '{"toolName":"unknown","args":{}}'

# 5. 验证审计日志
psql -d monitoring -c "SELECT COUNT(*) FROM tool_audit_log;"
```

**步骤3：检查代码质量**

```bash
# 类型检查
pnpm run type-check

# Lint 检查
pnpm run lint

# 格式化
pnpm run format
```

**步骤4：提交代码**

```bash
git add .
git commit -m "feat(tools): implement Tool Registry v3 with audit and timeout

- Add ToolDefinition interface for unified tool structure
- Implement ToolRegistryService with dynamic registration
- Add 4 custom ToolError classes (NotFound/Schema/Timeout/Execution)
- Implement ToolAuditService for execution logging
- Add timeout protection (5s) and result truncation (100 items)
- Implement 3 tools: list-servers, get-metrics, get-alert-detail
- Add comprehensive unit tests (9 test cases, 100% coverage)

Breaking Changes: None (new feature)
"
```

**通过标准**
- 所有单元测试通过
- 手动验证 5 个核心流程全部正常
- 无 TypeScript / ESLint 错误
- Git commit message 符合规范

---


---

## 8. 通过标准（同行 Code Review 视角）

**8.1 架构层面**
- ✅ Registry 模式将工具注册、执行、审计逻辑集中管理
- ✅ ToolDefinition 接口统一工具定义，新增工具无需改动 Controller
- ✅ 错误分类体系（4 种 ToolError）让调用方能根据错误类型决策

**8.2 可靠性层面**
- ✅ Schema 校验防止非法输入导致的崩溃
- ✅ 超时保护（5s）防止慢查询挂起整个请求
- ✅ 结果裁剪（100 条）防止超大响应消耗网络和内存

**8.3 可观测性层面**
- ✅ 审计服务记录所有工具调用（成功 + 失败）
- ✅ 敏感字段脱敏（password / token）
- ✅ 记录执行耗时，支持性能分析

**8.4 测试覆盖**
- ✅ 单元测试覆盖 Registry 核心逻辑（9 个测试用例）
- ✅ 反证实验验证超时保护和结果裁剪的必要性
- ✅ 手动测试覆盖 5 个核心流程

---

## 9. 提交物（证明你真的做完了）

**9.1 代码文件**（9 个核心文件）

apps/api/src/tools/
├── types/tool.types.ts
├── errors/tool.errors.ts
├── audit/tool-audit.service.ts
├── registry/tool-registry.service.ts
├── registry/tool-registry.service.spec.ts
├── implementations/list-servers.tool.ts
├── implementations/get-metrics.tool.ts
├── implementations/get-alert-detail.tool.ts
├── tools.module.ts
├── tools.controller.ts
└── index.ts

**9.2 Git 提交记录**

git log --oneline -1
输出：feat(tools): implement Tool Registry v3 with audit and timeout


---

## 10. 课末3个核心问题（面试高频）

### 问题1：为什么需要 Registry 模式？

**L1：可扩展性**
硬编码 if-else：新增工具需要修改 Controller 代码
Registry 模式：新增工具只需实现 ToolDefinition 接口并注册

**L2：统一逻辑**
硬编码方式：Schema 校验、超时保护、审计日志在每个工具里重复实现
Registry 模式：这些逻辑在 Registry 层统一处理

**L3：测试隔离**
Registry 可以独立测试，工具实现也可以独立测试

---

### 问题2：超时保护用 Promise.race 实现，超时后原始 Promise 还在运行吗？

**回答**

是的，原始 Promise 仍在运行。Promise.race 只是返回最快完成的那个，不会取消其他 Promise。

**生产级解决方案（AbortController）**

使用 AbortController 主动取消任务：

private async withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      controller.abort()
      reject(new ToolTimeoutError('timeout', timeoutMs))
    }, timeoutMs)
  })

  return Promise.race([fn(controller.signal), timeoutPromise])
}

---

### 问题3：审计日志记录失败会影响工具执行吗？

**当前实现会影响**

生产级处理方案：

方案1：Try-Catch 包裹
try {
  await this.auditService.logExecution({ ... })
} catch (error) {
  this.logger.error('Audit log failed', error)
}

方案2：异步审计（不阻塞返回）
this.auditService.logExecution({ ... }).catch(error => {
  this.logger.error('Audit log failed', error)
})

方案3：消息队列（最稳定）
await this.eventBus.publish(new ToolExecutedEvent({ ... }))


---

## 11. 真实项目情境题

### 情境1：AI 传入的 serverId 在数据库中不存在，应该返回什么？

**推荐方案：Registry 层拦截**

在 ToolDefinition 中增加 validate 钩子：

interface ToolDefinition<T = any> {
  name: string
  description: string
  schema: ZodSchema<T>
  validate?: (args: T, context: ToolContext) => Promise<void>
  execute: (args: T, context: ToolContext) => Promise<any>
}

export const getMetricsTool: ToolDefinition<GetMetricsArgs> = {
  name: 'get-metrics',
  schema: GetMetricsArgsSchema,
  
  async validate(args: GetMetricsArgs, context: ToolContext) {
    const server = await context.prisma.server.findUnique({
      where: { id: args.serverId },
    })
    if (!server) {
      throw new ToolExecutionError(
        `Server "${args.serverId}" not found`,
        'SERVER_NOT_FOUND'
      )
    }
  },
  
  async execute(args: GetMetricsArgs, context: ToolContext) {
    const metrics = await context.prisma.metric.findMany({
      where: { serverId: args.serverId },
    })
    return metrics
  },
}

---

### 情境2：生产环境审计表已有 1000 万条记录，查询变慢怎么办？

**优化方案**

1. 添加索引
CREATE INDEX idx_tool_audit_log_user_timestamp 
ON tool_audit_log (user_id, timestamp DESC);

2. 分区表（按月分区）
CREATE TABLE tool_audit_log (...) PARTITION BY RANGE (timestamp);

3. 冷热数据分离
热数据表：最近 30 天
冷数据表：30 天前

4. 归档到对象存储（S3）
3 个月前的数据归档到 S3，存储成本降低 90%

---

### 情境3：同一个用户在 1 秒内调用 100 次工具，怎么防止滥用？

**方案1：内存限流（单实例）**

@Injectable()
export class RateLimiterService {
  private readonly userLimits = new Map<string, number[]>()
  private readonly WINDOW_MS = 1000
  private readonly MAX_REQUESTS = 10

  async checkLimit(userId: string): Promise<void> {
    const now = Date.now()
    const userRequests = this.userLimits.get(userId) || []
    
    const validRequests = userRequests.filter(
      timestamp => now - timestamp < this.WINDOW_MS
    )
    
    if (validRequests.length >= this.MAX_REQUESTS) {
      throw new Error('Rate limit exceeded')
    }
    
    validRequests.push(now)
    this.userLimits.set(userId, validRequests)
  }
}

**方案2：Redis 限流（分布式）**

async checkLimit(userId: string): Promise<void> {
  const key = `rate-limit:${userId}`
  const current = await this.redis.incr(key)
  
  if (current === 1) {
    await this.redis.expire(key, 1)
  }
  
  if (current > 10) {
    throw new Error('Rate limit exceeded')
  }
}


---

## 12. PDF 面试题（带答案）

### 12.1 选择题

**题目1：Registry 模式的主要优势是？**

A. 提高代码执行速度  
B. 减少内存占用  
C. 提高可扩展性和可维护性  
D. 降低服务器负载  

**答案：C**

解析：Registry 模式通过统一的接口管理工具，新增工具无需修改现有代码，提高了可扩展性。同时将通用逻辑（校验、超时、审计）集中在 Registry 层，提高了可维护性。

---

**题目2：Zod Schema 的 safeParse 和 parse 的区别是？**

A. safeParse 更快  
B. safeParse 不会抛出异常，而 parse 会  
C. safeParse 支持异步校验  
D. 没有区别  

**答案：B**

解析：
- safeParse 返回 { success: boolean, data?: T, error?: ZodError }，不会抛异常
- parse 校验失败时直接抛出 ZodError

生产环境推荐使用 safeParse，因为可以自定义错误处理逻辑。

---

**题目3：以下哪个不是 ToolError 的子类？**

A. ToolNotFoundError  
B. ToolSchemaError  
C. ToolTimeoutError  
D. ToolPermissionError  

**答案：D**

解析：Day11 实现的 4 种错误是：
- ToolNotFoundError（工具不存在）
- ToolSchemaError（Schema 校验失败）
- ToolTimeoutError（执行超时）
- ToolExecutionError（执行逻辑错误）

ToolPermissionError 是扩展场景，Day11 未实现。

---

### 12.2 编程题

**题目：实现一个支持重试机制的 Tool 执行器**

要求：
1. 当工具执行失败时，自动重试最多 3 次
2. 只有 ToolExecutionError 和 ToolTimeoutError 才重试
3. ToolNotFoundError 和 ToolSchemaError 不重试
4. 重试间隔：1s、2s、4s（指数退避）

**参考答案**

async executeWithRetry(
  toolName: string,
  args: unknown,
  context: ToolContext,
  maxRetries: number = 3
): Promise<ToolResult> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.execute(toolName, args, context)
    } catch (error) {
      lastError = error
      
      // 不重试的错误类型
      if (
        error instanceof ToolNotFoundError ||
        error instanceof ToolSchemaError
      ) {
        throw error
      }
      
      // 最后一次尝试失败，直接抛错
      if (attempt === maxRetries) {
        throw error
      }
      
      // 指数退避：1s、2s、4s
      const delay = Math.pow(2, attempt) * 1000
      this.logger.warn(
        `Tool execution failed, retrying in ${delay}ms`,
        error
      )
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError
}

---

**免责声明**

本文档中的面试题和答案仅供学习参考，实际面试题目和答案可能因公司、岗位、时间而异。建议结合项目实践深度理解，而非死记硬背。


---

## 13. 完成后教师五连问

### 问题1：你觉得 Registry 模式最大的好处是什么？

**参考回答**

最大的好处是可扩展性。新增工具只需实现 ToolDefinition 接口并注册，无需修改 Controller 或 Registry 的核心逻辑。这符合开闭原则（对扩展开放，对修改关闭）。

同时，Registry 将通用逻辑（Schema 校验、超时保护、审计日志）集中处理，避免在每个工具里重复实现，提高了可维护性。

---

### 问题2：如果让你优化这个系统，你会从哪个方向入手？

**参考回答**

我会从以下 3 个方向优化：

1. 性能优化
   - 审计日志改为异步写入（消息队列）
   - 添加 Redis 缓存工具元数据
   - 数据库审计表添加索引和分区

2. 可靠性优化
   - 实现 AbortController 超时取消机制
   - 添加重试机制（针对临时性错误）
   - 添加断路器（防止某个工具故障影响整个系统）

3. 可观测性优化
   - 添加 OpenTelemetry 链路追踪
   - 添加 Prometheus 指标（调用次数、成功率、耗时分布）
   - 添加告警规则（超时率 > 10% 时告警）

---

### 问题3：v1 / v2 / v3 三个版本，你在实际项目中会用哪个？

**参考回答**

取决于项目规模：

- v1（最小闭环）：用于 MVP 验证，快速上线（1-2 天）
- v2（Schema + 超时）：用于小型项目（< 5 个工具，< 1000 日活）
- v3（生产级 Registry）：用于企业级项目（10+ 工具，多人协作，需要审计）

实际项目中，我会先用 v1 验证需求，确认有价值后再升级到 v3。避免过早优化。

---

### 问题4：如果审计日志写入失败，你会怎么处理？

**参考回答**

不应该让审计日志写入失败影响工具执行。我会用以下方案：

1. Try-Catch 包裹审计逻辑
try {
  await this.auditService.logExecution({ ... })
} catch (error) {
  this.logger.error('Audit log failed', error)
}

2. 异步写入（不阻塞返回）
this.auditService.logExecution({ ... }).catch(error => {
  this.logger.error('Audit log failed', error)
})

3. 消息队列（最稳定）
将审计事件发送到 RabbitMQ，单独的 Worker 消费队列并写入数据库，失败时自动重试。

---

### 问题5：这个项目你学到了什么？

**参考回答**

我学到了以下 3 点：

1. 架构模式的价值
   - Registry 模式让系统更易扩展
   - 错误分类让错误处理更精细
   - 审计链让系统更可观测

2. 渐进式设计
   - 先实现 v1 最小闭环（验证需求）
   - 再加 v2 健壮性（Schema + 超时）
   - 最后升级 v3 生产级（Registry + 审计）
   - 避免一开始就追求完美

3. 生产环境的复杂性
   - 超时保护不只是 Promise.race，还要考虑资源泄漏
   - 审计日志不能阻塞业务逻辑
   - 大表查询需要索引 / 分区 / 归档


---

## 14. 本 Day 在 90 天路线中的锚点

### 14.1 前置依赖

- Day07-09：NestJS 基础
  - Module / Controller / Service 依赖注入
  - 理解装饰器（@Injectable、@Module）
  - 掌握 NestJS 异常处理

- Day10：Zod Schema 校验
  - 理解 Schema 定义和类型推导
  - 掌握 safeParse 和错误处理

### 14.2 后续内容

- Day12-13：Vercel AI SDK Tool Calling
  - 使用 Day11 的 Tool Registry 作为底层实现
  - 将工具暴露给 AI（Claude / GPT）

- Day14-16：LangChain.js RAG
  - 工具作为 RAG 的数据源之一
  - 审计日志用于追踪 RAG 查询

- Day17-20：LangGraph.js 状态机编排
  - 工具作为 Agent 的 Action
  - Registry 支持动态加载工具到状态机

### 14.3 技能树位置

90 天 Agent 全栈工程师
├── 基础阶段（Day01-10）
│   └── Day10：Zod Schema 校验
├── 后端核心（Day11-20）
│   ├── Day11：Tool Registry（本节）← 你在这里
│   ├── Day12-13：AI SDK Tool Calling
│   ├── Day14-16：LangChain RAG
│   └── Day17-20：LangGraph 状态机
├── 前端 AI 交互（Day21-30）
└── 生产部署（Day31-40）

---

**Day11 完成标志**

当你能做到以下 3 点，说明已完全掌握：

1. ✅ 能独立实现 v3 版本的 Tool Registry（无需看文档）
2. ✅ 能解释清楚 3 个核心问题（Registry 模式 / 超时保护 / 审计日志）
3. ✅ 能应对 3 个真实项目情境题（serverId 不存在 / 审计表优化 / 限流防滥用）

恭喜你完成 Day11！明天继续 Day12：Vercel AI SDK Tool Calling。
