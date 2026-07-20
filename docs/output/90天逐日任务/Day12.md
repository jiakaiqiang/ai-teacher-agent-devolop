# Day 12：Agent Loop（v1 单次调用 → v2 循环+预算 → v3 终止+审计）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **补充真实项目情境题**：
> 1. Tool 连续返回空数组导致模型重复调用时，step/time/token 三类预算如何协同终止并向用户解释原因？
> 2. Provider 连续返回 429 时，如何区分有限重试、降级与终止，避免重试风暴并保留完整 trajectory？

任务版本：标准版
日期与时长：2026-07-25 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 11 Tool Registry、第一次实现 Agent 自主循环调用的开发者

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
   Day 12：Agent Loop（循环调用+预算+终止）           ← 今天在这里
   Day 13-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 12 在阶段一第 2 天**，Day 11 搭建完 Tool Registry 后，今天要让 LLM 能够**自主循环调用工具**，而不是"用户问一次、模型回一句"的单轮对话。

### 到 Day 11 结束时项目已具备的能力

- **后端**（Day 6-10）：Nest + Prisma + Postgres，服务器/指标/告警 CRUD，Z-Score 异常检测，服务端 FSM，乐观锁
- **前端**（Day 1-5, Day 9）：Vue3 + Vite + ECharts，WebSocket 实时推送，状态机 UI
- **Tool Registry**（Day 11）：三个只读运维 Tool（`listServers` / `getMetrics` / `getAlertDetail`），Schema 校验、超时保护、结果裁剪、审计日志

### 今天要解决的 4 个问题

1. **问题 1：单轮对话无法完成复杂诊断**  
   用户问"srv-042 为什么 CPU 异常？"，模型需要先调 `getMetrics` 看数据，发现峰值后再调 `getAlertDetail` 查告警，最后生成诊断。单轮 Function Calling 只能调一次工具就结束。

2. **问题 2：循环可能无限**  
   如果 Tool 返回空数组，模型可能反复调用同一工具 40 次仍未终止，token 消耗失控。

3. **问题 3：终止原因不明确**  
   循环结束后，用户不知道是"模型完成任务"还是"达到 step 上限被强制中断"，无法判断结果是否可信。

4. **问题 4：多 LLM Provider 切换困难**  
   今天用 OpenAI，明天换 Anthropic Claude，后天测试 Gemini，每次都要改 `agent.service.ts` 里的调用代码。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`AgentModule`**：实现 Agent Loop 引擎，让 LLM 能够在 step/time/token 预算约束下自主循环调用 Day 11 的三个 Tool，并记录每次循环的轨迹（trajectory）和终止原因（finish reason）。

### 1.1 用户能看到什么

**场景**：运维工程师在 Agent 对话框问"srv-042 为什么在 14:30 触发 CPU 告警？"

```
用户输入：srv-042 为什么在 14:30 触发 CPU 告警？

Agent 内部执行轨迹：

Step 1 [model_turn]:
  模型思考："需要先查看 srv-042 的 CPU 指标数据"
  生成 tool_call: getMetrics(serverId="srv-042", metricType="cpu", minutes=30)

Step 2 [tool_call]:
  Tool Registry 执行 getMetrics
  返回：[{timestamp: "14:28", value: 95.2}, {timestamp: "14:29", value: 96.8}, ...]

Step 3 [model_turn]:
  模型分析："14:30 前后 CPU 持续超过 95%，需要查看告警详情"
  生成 tool_call: getAlertDetail(serverId="srv-042")

Step 4 [tool_call]:
  Tool Registry 执行 getAlertDetail
  返回：{alertId: "a-123", threshold: 90, duration: "5min", status: "acknowledged"}

Step 5 [model_turn]:
  模型生成最终回复（无 tool_call）

终止原因：completed（模型主动结束）
总步数：5 / 20
总 token：1250 / 10000
总时长：3.2s / 30s

最终回复：
"srv-042 在 14:28-14:30 期间 CPU 使用率持续超过 95%（峰值 96.8%），
超过告警阈值 90% 达 5 分钟，系统自动触发告警。告警状态为 acknowledged，
建议检查该时间段的进程列表和网络流量。"
```

用户看到的是最终回复，但系统记录了完整的 5 步轨迹和 3 项预算消耗。

### 1.2 这个模块在项目里承担什么

- **输入**：用户问题（string）+ 可用工具列表（从 Day 11 Tool Registry 获取）
- **输出**：模型最终回复（string）+ 执行轨迹（trajectory）+ 终止原因（finish reason）+ 预算消耗
- **对齐后续**：今天定义的 **Agent Loop 合同**（`AgentRunConfig` / `AgentTrajectory` / `FinishReason`）是 Day 13-20（LangChain / LangGraph）的基础接口

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 单轮 Function Calling | 单文件、调一次 LLM API、无循环 | Function Calling 基本概念、tool_calls 解析 |
| **v2** | v1 + **循环调用** + **step/time/token 预算** | 抽离 `agent-loop.ts` + 预算检查 | while 循环终止条件、预算设计、时间/token 计数 |
| **v3** | v2 + **终止原因分类** + **Provider 抽象** + **轨迹审计** | 完整分层（types/provider/loop/service/controller） | Adapter 模式、终止原因枚举、trajectory 结构 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Agent Loop 涉及多个关注点（LLM Provider 抽象、循环控制、预算管理、轨迹记录、HTTP 入口），如果不先在脑子里立起骨架，写到一半就会把 API 调用、循环逻辑、预算检查混在一起。看完这棵树，下面章节再出现 `src/agent/loop/agent-loop.engine.ts` 时，你就能立刻定位它在架构中的位置。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── agent/                                    ← 【新增】Agent Loop 模块
│   ├── types/
│   │   ├── agent-config.types.ts             ← 运行配置（预算、超时）
│   │   ├── agent-trajectory.types.ts         ← 轨迹记录（step/event）
│   │   └── finish-reason.types.ts            ← 终止原因枚举
│   ├── provider/
│   │   ├── llm-provider.interface.ts         ← Provider 抽象接口
│   │   ├── openai-provider.ts                ← OpenAI 实现
│   │   └── provider.factory.ts               ← Provider 工厂
│   ├── loop/
│   │   ├── agent-loop.engine.ts              ← 循环引擎（核心逻辑）
│   │   ├── budget-tracker.ts                 ← 预算追踪器（step/time/token）
│   │   └── agent-loop.engine.spec.ts         ← 循环引擎单元测试
│   ├── audit/
│   │   └── trajectory-audit.service.ts       ← 轨迹审计服务
│   ├── index.ts                              ← 桶文件
│   ├── agent.module.ts                       ← NestJS 模块
│   ├── agent.service.ts                      ← 业务编排层
│   └── agent.controller.ts                   ← HTTP 入口（POST /agent/run）
├── tools/                                    ← 【Day 11 已有】Tool Registry
│   └── ...
├── prisma/
│   └── prisma.service.ts                     ← 【Day 07 已有】
└── main.ts
```

**三版演进对应的文件差异**：

| 版本 | 新增文件 | 核心变化 |
|---|---|---|
| **v1** | `agent/agent.service.ts`（单次调用）<br>`agent/agent.controller.ts` | 最小闭环：调一次 OpenAI API + 解析 tool_calls |
| **v2** | `agent/loop/agent-loop.engine.ts`<br>`agent/loop/budget-tracker.ts`<br>`agent/types/agent-config.types.ts` | 加入 while 循环 + step/time/token 预算检查 |
| **v3** | `agent/provider/llm-provider.interface.ts`<br>`agent/provider/openai-provider.ts`<br>`agent/provider/provider.factory.ts`<br>`agent/types/finish-reason.types.ts`<br>`agent/types/agent-trajectory.types.ts`<br>`agent/audit/trajectory-audit.service.ts` | 完整分层：Provider 抽象/终止原因/轨迹审计分离 |

**依赖方向（务必单向，反过来一次都不行）**：

```
agent.controller.ts
    ↓ 调用
agent.service.ts ──────────────→ trajectory-audit.service.ts
    ↓ 调用                       ↓ 记录轨迹
agent-loop.engine.ts
    ↓ 持有                   ↓ 持有
llm-provider.interface ← budget-tracker.ts
    ↑ 实现                   ↓ 追踪预算
openai-provider.ts ──→ ToolRegistry（Day 11）
```

**红线**：
- `agent-loop.engine.ts` 里出现 `import OpenAI from 'openai'` 就是抽象泄漏第一步。循环引擎只依赖 `LLMProvider` 接口，不依赖具体 Provider。
- `openai-provider.ts` 里出现 `import { PrismaService }` 就是职责混乱。Provider 只负责调用 LLM API，不直接访问数据库。

**动手前先问自己 3 个问题**：

1. 为什么 Provider 要抽象成接口而不是直接用 `OpenAI` SDK？  
   → 见 §5.4 知识点 5「Provider 抽象」：今天用 OpenAI，明天可能换 Claude/Gemini/本地模型。如果循环引擎直接依赖 `OpenAI` 类，每次换 Provider 都要改循环逻辑。

2. 为什么预算追踪要单独抽成 `budget-tracker.ts` 而不是在循环引擎里直接 `if (steps > maxSteps)`？  
   → 见 §5.4 知识点 2「预算设计」：step/time/token 三种预算的检查逻辑各不相同（step 是计数，time 是时间戳差值，token 是累加），抽成独立类后可以单独测试和复用。

3. 轨迹审计为什么要单独抽成 `trajectory-audit.service.ts` 而不是在循环结束后直接 `console.log(trajectory)`？  
   → 见 §5.4 知识点 6「轨迹审计」：审计是独立关注点，未来会接入 LangSmith/LangFuse/自建平台。如果写在循环引擎里，换审计方案就要改核心逻辑。

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

按第 5.3 节的代码写，边写边问自己下面的问题。

### 1.5.1 D-1：搭工程骨架 / 装依赖（5 分钟）

```bash
cd D:\demo\ai-techer\p1-monitor\apps\api

# 安装 OpenAI SDK
pnpm add openai

# 创建目录
mkdir -p src/agent/{types,provider,loop,audit}
```

**边写边问自己**：
- 为什么选 OpenAI SDK 而不是直接用 axios 调 API？（SDK 封装了流式响应、重试、类型定义，减少样板代码）
- 为什么环境变量 `OPENAI_API_KEY` 要在 `.env` 里而不是硬编码？（安全+多环境切换）

### 1.5.2 D-2：实现类型层（5 分钟）

按第 5.3 节的代码依次写：
- `src/agent/types/agent-config.types.ts`
- `src/agent/types/finish-reason.types.ts`
- `src/agent/types/agent-trajectory.types.ts`

**边写边问自己**：
- `AgentRunConfig` 的三种预算为什么都是可选的？（不同场景对预算要求不同，调试时可能只限制 step）
- `FinishReason` 为什么要区分 `completed`/`max_steps`/`max_time`/`max_tokens`/`error` 五种？（用户需要知道是正常结束还是被强制中断）

### 1.5.3 D-3：实现 Provider 层（5 分钟）

按第 5.3 节的代码依次写：
- `src/agent/provider/llm-provider.interface.ts`
- `src/agent/provider/openai-provider.ts`
- `src/agent/provider/provider.factory.ts`

**边写边问自己**：
- `LLMProvider` 接口为什么只有一个 `chat()` 方法？（Agent Loop 只需要"发送消息+工具定义、返回回复+tool_calls"这个合同）
- `OpenAIProvider` 为什么要把 `tool_calls` 转换成统一格式而不是直接返回原始响应？（不同 Provider 的响应格式不同，统一格式后循环引擎不用关心 Provider 细节）

### 1.5.4 D-4：实现循环引擎（剩余时间）

按第 5.3 节的代码依次写：
- `src/agent/loop/budget-tracker.ts`
- `src/agent/loop/agent-loop.engine.ts`
- `src/agent/audit/trajectory-audit.service.ts`
- `src/agent/agent.service.ts`
- `src/agent/agent.controller.ts`
- `src/agent/agent.module.ts`
- `src/agent/index.ts`

**边写边问自己**：
- 循环引擎的 `while` 循环为什么要先检查预算再调用 LLM？（如果先调用后检查，可能浪费一次昂贵的 API 调用）
- 轨迹里为什么要记录每个 step 的 `timestamp`？（排查性能问题时需要知道哪一步耗时最长）

---

## 2. 学习节奏（90 阅读 / 90 动手）

Day 12 总时长 180 分钟，分为 6 个阶段（A-F）：

| 阶段 | 时长 | 活动 | 输出 |
|---|---|---|---|
| **A：读文档头** | 30 分钟 | 阅读 §0-§1.4（位置/目标/目录结构） | 在脑子里建立 Agent Loop 的骨架图 |
| **B：读三版演进** | 30 分钟 | 阅读 §3-§5（v1/v2/v3 完整代码） | 理解"为什么 v3 要抽象 Provider" |
| **C：读知识点深挖** | 30 分钟 | 阅读 §5.4（6 个知识点）+ §6.5（HTML 深挖） | 记录每个知识点的"解决的问题/验证方法" |
| **D：搭骨架** | 60 分钟 | 执行 §1.5（D-1 到 D-4） | 12 个文件骨架全部创建 |
| **E：写测试** | 20 分钟 | 执行 §7.6（写循环引擎 + 预算追踪器单元测试） | 至少 12 个测试用例通过 |
| **F：验收** | 10 分钟 | 执行 §7.7-§7.9（反证实验 + 提交） | commit + 反证记录 |

**阶段切换规则**：
- A → B：读完目录结构后，能闭眼说出"types/provider/loop/audit"四层各自的职责。
- B → C：读完 v3 代码后，能说出"v2 暴露的痛点是什么，v3 如何解决"。
- C → D：读完知识点后，能回答 §1.4.5 的 3 个问题。
- D → E：骨架搭完后，`pnpm typecheck` 通过（可能有逻辑未实现，但类型正确）。
- E → F：测试通过后，`pnpm test` 至少 12 个用例全绿。

---

## 3. v1：最小闭环

### 3.1 v1 要实现什么

**目标**：用最少的代码让 LLM 能够调用一次 Tool Registry 的工具。

**功能范围**：
- 单次调用 OpenAI API，携带 Day 11 的 3 个工具定义
- 解析返回的 `tool_calls`，调用 Tool Registry 执行
- 返回工具执行结果，但**不继续循环**

**用户视角**：
```bash
curl -X POST http://localhost:3000/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "message": "srv-042 最近 10 分钟的 CPU 是多少？"
  }'

# 返回：
{
  "success": true,
  "reply": "（模型尚未看到工具结果，只返回 tool_call）",
  "toolCalls": [
    {
      "id": "call_abc123",
      "name": "getMetrics",
      "arguments": "{\"serverId\":\"srv-042\",\"metricType\":\"cpu\",\"minutes\":10}"
    }
  ]
}
```

**v1 的问题**：只调用一次就结束，模型无法看到工具返回的数据，无法生成基于数据的诊断。

### 3.2 v1 完整代码

**apps/api/src/agent/agent.service.v1.ts**

```typescript
import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import { ToolRegistryService } from '../tools/registry/tool-registry.service'

@Injectable()
export class AgentServiceV1 {
  private openai: OpenAI

  constructor(private toolRegistry: ToolRegistryService) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async run(message: string): Promise<any> {
    // 1. 从 Tool Registry 获取所有工具定义
    const tools = this.toolRegistry.listTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema,
      },
    }))

    // 2. 调用 OpenAI API
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: '你是一个运维诊断助手。' },
        { role: 'user', content: message },
      ],
      tools,
    })

    const message = response.choices[0].message

    // 3. 解析 tool_calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls = message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }))

      return {
        success: true,
        reply: message.content || '（正在调用工具）',
        toolCalls,
      }
    }

    return {
      success: true,
      reply: message.content,
      toolCalls: [],
    }
  }
}
```

**apps/api/src/agent/agent.controller.v1.ts**

```typescript
import { Controller, Post, Body } from '@nestjs/common'
import { AgentServiceV1 } from './agent.service.v1'

@Controller('agent')
export class AgentControllerV1 {
  constructor(private agentService: AgentServiceV1) {}

  @Post('run')
  async run(@Body() body: { message: string }) {
    return this.agentService.run(body.message)
  }
}
```

### 3.3 v1 暴露的痛点

1. **无法完成多步推理**：模型说"我需要调用 getMetrics"，但调用后就结束了，没有机会看到数据并生成诊断。
2. **用户体验差**：返回的是 `tool_calls` JSON，不是自然语言回复，用户看不懂。
3. **无预算控制**：如果模型陷入死循环（虽然 v1 不会循环，但为 v2 埋雷），无法止损。

---

## 4. v2：加循环和预算

### 4.1 v2 要实现什么

**目标**：在 v1 基础上加入 while 循环，让模型能够"调用工具 → 看结果 → 再调用工具 → 看结果"，直到生成最终回复或达到预算上限。

**新增功能**：
- while 循环：只要模型返回 `tool_calls` 就继续循环
- step 预算：最多循环 20 次
- time 预算：最多运行 30 秒
- token 预算：最多消耗 10000 tokens

**用户视角**：
```bash
curl -X POST http://localhost:3000/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "message": "srv-042 最近 10 分钟的 CPU 是多少？",
    "config": {
      "maxSteps": 20,
      "maxTimeMs": 30000,
      "maxTokens": 10000
    }
  }'

# 返回（经过 3 步循环）：
{
  "success": true,
  "reply": "srv-042 在最近 10 分钟内 CPU 平均使用率为 87%，峰值 95%...",
  "steps": 3,
  "tokensUsed": 1250,
  "timeMs": 3200,
  "finishReason": "completed"
}
```

### 4.2 v2 完整代码

**apps/api/src/agent/types/agent-config.types.ts**

```typescript
export interface AgentRunConfig {
  maxSteps?: number      // 最大步数，默认 20
  maxTimeMs?: number     // 最大运行时间（毫秒），默认 30000
  maxTokens?: number     // 最大 token 消耗，默认 10000
}

export const DEFAULT_AGENT_CONFIG: Required<AgentRunConfig> = {
  maxSteps: 20,
  maxTimeMs: 30000,
  maxTokens: 10000,
}
```

**apps/api/src/agent/loop/budget-tracker.ts**

```typescript
import { AgentRunConfig, DEFAULT_AGENT_CONFIG } from '../types/agent-config.types'

export class BudgetTracker {
  private steps = 0
  private tokensUsed = 0
  private startTime: number

  constructor(private config: Required<AgentRunConfig>) {
    this.startTime = Date.now()
  }

  static create(config?: AgentRunConfig): BudgetTracker {
    const fullConfig = { ...DEFAULT_AGENT_CONFIG, ...config }
    return new BudgetTracker(fullConfig)
  }

  incrementStep(): void {
    this.steps++
  }

  addTokens(count: number): void {
    this.tokensUsed += count
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime
  }

  getSteps(): number {
    return this.steps
  }

  getTokensUsed(): number {
    return this.tokensUsed
  }

  // 检查是否超过任一预算
  isExceeded(): { exceeded: boolean; reason?: string } {
    if (this.steps >= this.config.maxSteps) {
      return { exceeded: true, reason: 'max_steps' }
    }
    if (this.getElapsedMs() >= this.config.maxTimeMs) {
      return { exceeded: true, reason: 'max_time' }
    }
    if (this.tokensUsed >= this.config.maxTokens) {
      return { exceeded: true, reason: 'max_tokens' }
    }
    return { exceeded: false }
  }
}
```

**apps/api/src/agent/loop/agent-loop.engine.v2.ts**

```typescript
import OpenAI from 'openai'
import { BudgetTracker } from './budget-tracker'
import { AgentRunConfig } from '../types/agent-config.types'
import { ToolRegistryService } from '../../tools/registry/tool-registry.service'

export class AgentLoopEngineV2 {
  private openai: OpenAI

  constructor(private toolRegistry: ToolRegistryService) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async run(userMessage: string, config?: AgentRunConfig) {
    const budget = BudgetTracker.create(config)
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: '你是一个运维诊断助手。' },
      { role: 'user', content: userMessage },
    ]

    const tools = this.toolRegistry.listTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema,
      },
    }))

    // 循环直到模型不再调用工具或预算用尽
    while (true) {
      // 检查预算
      const budgetCheck = budget.isExceeded()
      if (budgetCheck.exceeded) {
        return {
          success: true,
          reply: '（达到预算上限）',
          steps: budget.getSteps(),
          tokensUsed: budget.getTokensUsed(),
          timeMs: budget.getElapsedMs(),
          finishReason: budgetCheck.reason,
        }
      }

      budget.incrementStep()

      // 调用 LLM
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages,
        tools,
      })

      const choice = response.choices[0]
      const assistantMessage = choice.message

      // 记录 token 消耗
      if (response.usage) {
        budget.addTokens(response.usage.total_tokens)
      }

      // 如果没有 tool_calls，说明模型完成任务
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return {
          success: true,
          reply: assistantMessage.content || '',
          steps: budget.getSteps(),
          tokensUsed: budget.getTokensUsed(),
          timeMs: budget.getElapsedMs(),
          finishReason: 'completed',
        }
      }

      // 有 tool_calls，执行工具
      messages.push(assistantMessage)

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name
        const toolArgs = JSON.parse(toolCall.function.arguments)

        try {
          const result = await this.toolRegistry.execute(toolName, toolArgs, {
            userId: 'system',
            requestId: `agent-${Date.now()}`,
          })

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
        } catch (error: any) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${error.message}`,
          })
        }
      }
    }
  }
}
```

### 4.3 v2 暴露的痛点

1. **Provider 耦合**：循环引擎直接依赖 `OpenAI` 类，换成 Claude/Gemini 需要重写整个循环逻辑。
2. **终止原因不明确**：只返回字符串 `'max_steps'`/`'completed'`，没有类型约束，容易拼写错误。
3. **无轨迹审计**：循环结束后只能看到最终回复，无法追溯中间步骤（哪个 tool 被调用了多少次、每步耗时多少）。
4. **错误处理粗糙**：Tool 执行失败时只记录 `Error: xxx`，模型可能会陷入重试同一个失败的工具。

---

## 5. v3：终态

### 5.1 v3 要实现什么

**目标**：在 v2 基础上抽象 Provider、规范终止原因、记录完整轨迹、优化错误处理。

**新增功能**：
- Provider 抽象：定义 `LLMProvider` 接口，循环引擎只依赖接口
- 终止原因枚举：`FinishReason` 类型安全
- 轨迹记录：每一步的 `type`（model_turn / tool_call）、`timestamp`、`data`
- 审计服务：循环结束后自动记录轨迹到审计日志

### 5.2 v3 目录结构

（与 §1.4 完全一致，此处省略）

### 5.3 v3 完整代码

**apps/api/src/agent/types/finish-reason.types.ts**

```typescript
// 终止原因：必须是以下 5 种之一
export type FinishReason =
  | 'completed'      // 模型主动结束（无 tool_calls）
  | 'max_steps'      // 达到最大步数
  | 'max_time'       // 达到最大时间
  | 'max_tokens'     // 达到最大 token
  | 'error'          // 执行过程中出现错误

export function isFinishReason(value: string): value is FinishReason {
  return ['completed', 'max_steps', 'max_time', 'max_tokens', 'error'].includes(value)
}
```

**apps/api/src/agent/types/agent-trajectory.types.ts**

```typescript
// 单步轨迹事件
export type TrajectoryStep =
  | {
      type: 'model_turn'
      timestamp: string
      data: {
        content?: string
        toolCalls?: Array<{
          id: string
          name: string
          arguments: string
        }>
      }
    }
  | {
      type: 'tool_call'
      timestamp: string
      data: {
        toolCallId: string
        toolName: string
        arguments: any
        result?: any
        error?: string
      }
    }

// 完整轨迹
export interface AgentTrajectory {
  runId: string
  userMessage: string
  steps: TrajectoryStep[]
  finishReason: FinishReason
  totalSteps: number
  totalTokens: number
  totalTimeMs: number
  createdAt: string
}
```

**apps/api/src/agent/types/agent-config.types.ts**

```typescript
export interface AgentRunConfig {
  maxSteps?: number      // 最大步数，默认 20
  maxTimeMs?: number     // 最大运行时间（毫秒），默认 30000
  maxTokens?: number     // 最大 token 消耗，默认 10000
}

export const DEFAULT_AGENT_CONFIG: Required<AgentRunConfig> = {
  maxSteps: 20,
  maxTimeMs: 30000,
  maxTokens: 10000,
}
```




**apps/api/src/agent/provider/llm-provider.interface.ts**

```typescript
// 统一的 LLM Provider 接口
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: string
  }>
  toolCallId?: string  // 用于 tool role
}

export interface LLMTool {
  name: string
  description: string
  parameters: any  // JSON Schema
}

export interface LLMResponse {
  content?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: string
  }>
  usage?: {
    totalTokens: number
  }
}

export interface LLMProvider {
  chat(messages: LLMMessage[], tools: LLMTool[]): Promise<LLMResponse>
}
```

**apps/api/src/agent/provider/openai-provider.ts**

```typescript
import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMResponse,
} from './llm-provider.interface'

@Injectable()
export class OpenAIProvider implements LLMProvider {
  private openai: OpenAI

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async chat(messages: LLMMessage[], tools: LLMTool[]): Promise<LLMResponse> {
    // 转换消息格式
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(
      msg => {
        if (msg.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: msg.toolCallId!,
            content: msg.content || '',
          }
        }
        if (msg.role === 'assistant' && msg.toolCalls) {
          return {
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })),
          }
        }
        return {
          role: msg.role,
          content: msg.content || '',
        }
      },
    )

    // 转换工具格式
    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))

    // 调用 OpenAI API
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: openaiMessages,
      tools: openaiTools,
    })

    const choice = response.choices[0]
    const message = choice.message

    // 转换响应格式
    return {
      content: message.content || undefined,
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      usage: response.usage
        ? { totalTokens: response.usage.total_tokens }
        : undefined,
    }
  }
}
```

**apps/api/src/agent/provider/provider.factory.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { LLMProvider } from './llm-provider.interface'
import { OpenAIProvider } from './openai-provider'

@Injectable()
export class ProviderFactory {
  create(providerName: string): LLMProvider {
    switch (providerName) {
      case 'openai':
        return new OpenAIProvider()
      // 未来可以加入其他 Provider
      // case 'claude':
      //   return new ClaudeProvider()
      default:
        throw new Error(`Unknown provider: ${providerName}`)
    }
  }
}
```

**apps/api/src/agent/loop/budget-tracker.ts**

```typescript
import { AgentRunConfig, DEFAULT_AGENT_CONFIG } from '../types/agent-config.types'
import { FinishReason } from '../types/finish-reason.types'

export class BudgetTracker {
  private steps = 0
  private tokensUsed = 0
  private startTime: number

  constructor(private config: Required<AgentRunConfig>) {
    this.startTime = Date.now()
  }

  static create(config?: AgentRunConfig): BudgetTracker {
    const fullConfig = { ...DEFAULT_AGENT_CONFIG, ...config }
    return new BudgetTracker(fullConfig)
  }

  incrementStep(): void {
    this.steps++
  }

  addTokens(count: number): void {
    this.tokensUsed += count
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime
  }

  getSteps(): number {
    return this.steps
  }

  getTokensUsed(): number {
    return this.tokensUsed
  }

  // 检查是否超过任一预算，返回终止原因
  checkBudget(): { exceeded: boolean; reason?: FinishReason } {
    if (this.steps >= this.config.maxSteps) {
      return { exceeded: true, reason: 'max_steps' }
    }
    if (this.getElapsedMs() >= this.config.maxTimeMs) {
      return { exceeded: true, reason: 'max_time' }
    }
    if (this.tokensUsed >= this.config.maxTokens) {
      return { exceeded: true, reason: 'max_tokens' }
    }
    return { exceeded: false }
  }
}
```

**apps/api/src/agent/loop/agent-loop.engine.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'
import { LLMProvider, LLMMessage, LLMTool } from '../provider/llm-provider.interface'
import { BudgetTracker } from './budget-tracker'
import { AgentRunConfig } from '../types/agent-config.types'
import { FinishReason } from '../types/finish-reason.types'
import { AgentTrajectory, TrajectoryStep } from '../types/agent-trajectory.types'
import { ToolRegistryService } from '../../tools/registry/tool-registry.service'

export interface AgentLoopResult {
  runId: string
  reply: string
  finishReason: FinishReason
  trajectory: AgentTrajectory
}

@Injectable()
export class AgentLoopEngine {
  constructor(private toolRegistry: ToolRegistryService) {}

  async run(
    provider: LLMProvider,
    userMessage: string,
    config?: AgentRunConfig,
  ): Promise<AgentLoopResult> {
    const runId = uuidv4()
    const budget = BudgetTracker.create(config)
    const steps: TrajectoryStep[] = []

    const messages: LLMMessage[] = [
      { role: 'system', content: '你是一个运维诊断助手。' },
      { role: 'user', content: userMessage },
    ]

    const tools: LLMTool[] = this.toolRegistry.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    }))

    let finishReason: FinishReason = 'completed'
    let finalReply = ''

    try {
      // 循环直到模型不再调用工具或预算用尽
      while (true) {
        // 检查预算
        const budgetCheck = budget.checkBudget()
        if (budgetCheck.exceeded) {
          finishReason = budgetCheck.reason!
          finalReply = '（达到预算上限，任务未完成）'
          break
        }

        budget.incrementStep()

        // 调用 LLM
        const response = await provider.chat(messages, tools)

        // 记录 token 消耗
        if (response.usage) {
          budget.addTokens(response.usage.totalTokens)
        }

        // 记录模型回复步骤
        steps.push({
          type: 'model_turn',
          timestamp: new Date().toISOString(),
          data: {
            content: response.content,
            toolCalls: response.toolCalls,
          },
        })

        // 如果没有 tool_calls，说明模型完成任务
        if (!response.toolCalls || response.toolCalls.length === 0) {
          finishReason = 'completed'
          finalReply = response.content || '（模型未返回内容）'
          break
        }

        // 有 tool_calls，构造 assistant 消息
        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        })

        // 执行每个工具
        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.name
          let toolArgs: any

          try {
            toolArgs = JSON.parse(toolCall.arguments)
          } catch (error) {
            const errorMsg = 'Invalid JSON in tool arguments'
            messages.push({
              role: 'tool',
              toolCallId: toolCall.id,
              content: JSON.stringify({ error: errorMsg }),
            })
            steps.push({
              type: 'tool_call',
              timestamp: new Date().toISOString(),
              data: {
                toolCallId: toolCall.id,
                toolName,
                arguments: toolCall.arguments,
                error: errorMsg,
              },
            })
            continue
          }

          try {
            const result = await this.toolRegistry.execute(toolName, toolArgs, {
              userId: 'system',
              requestId: runId,
            })

            messages.push({
              role: 'tool',
              toolCallId: toolCall.id,
              content: JSON.stringify(result),
            })

            steps.push({
              type: 'tool_call',
              timestamp: new Date().toISOString(),
              data: {
                toolCallId: toolCall.id,
                toolName,
                arguments: toolArgs,
                result,
              },
            })
          } catch (error: any) {
            const errorMsg = error.message || 'Tool execution failed'
            messages.push({
              role: 'tool',
              toolCallId: toolCall.id,
              content: JSON.stringify({ error: errorMsg }),
            })

            steps.push({
              type: 'tool_call',
              timestamp: new Date().toISOString(),
              data: {
                toolCallId: toolCall.id,
                toolName,
                arguments: toolArgs,
                error: errorMsg,
              },
            })
          }
        }
      }
    } catch (error: any) {
      finishReason = 'error'
      finalReply = `执行出错：${error.message}`
    }

    const trajectory: AgentTrajectory = {
      runId,
      userMessage,
      steps,
      finishReason,
      totalSteps: budget.getSteps(),
      totalTokens: budget.getTokensUsed(),
      totalTimeMs: budget.getElapsedMs(),
      createdAt: new Date().toISOString(),
    }

    return {
      runId,
      reply: finalReply,
      finishReason,
      trajectory,
    }
  }
}
```

**apps/api/src/agent/provider/openai-provider.ts**

```typescript
import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import { LLMProvider, LLMMessage, LLMTool, LLMResponse } from './llm-provider.interface'

@Injectable()
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async chat(messages: LLMMessage[], tools: LLMTool[]): Promise<LLMResponse> {
    // 转换为 OpenAI SDK 格式
    const openaiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content ?? '',
      ...(m.toolCalls ? { tool_calls: m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })) } : {}),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    }))

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages as any,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
    })

    const choice = completion.choices[0]
    const message = choice.message

    // 转换为统一格式
    return {
      content: message.content ?? null,
      toolCalls: message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      },
      finishReason: choice.finish_reason,
    }
  }
}
```

**apps/api/src/agent/provider/provider.factory.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { LLMProvider } from './llm-provider.interface'
import { OpenAIProvider } from './openai-provider'

export type ProviderName = 'openai' | 'anthropic' | 'gemini'

@Injectable()
export class ProviderFactory {
  constructor(private openaiProvider: OpenAIProvider) {}

  getProvider(name: ProviderName = 'openai'): LLMProvider {
    switch (name) {
      case 'openai':
        return this.openaiProvider
      case 'anthropic':
        throw new Error('Anthropic Provider 未实现，参见 Day 20')
      case 'gemini':
        throw new Error('Gemini Provider 未实现')
      default:
        throw new Error(`未知 Provider: ${name}`)
    }
  }
}
```

**apps/api/src/agent/loop/budget-tracker.ts**

```typescript
import { AgentRunConfig, DEFAULT_AGENT_CONFIG } from '../types/agent-config.types'
import { FinishReason } from '../types/finish-reason.types'

export class BudgetTracker {
  private startTime: number
  private stepCount = 0
  private tokenCount = 0
  private config: Required<AgentRunConfig>

  constructor(config?: AgentRunConfig) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config }
    this.startTime = Date.now()
  }

  incrementStep(): void {
    this.stepCount += 1
  }

  addTokens(tokens: number): void {
    this.tokenCount += tokens
  }

  /**
   * 检查是否超预算。返回 null 表示未超预算，返回 FinishReason 表示因该原因超预算。
   * 三种预算独立检查，任一超过即触发终止。
   */
  checkExceeded(): FinishReason | null {
    if (this.stepCount >= this.config.maxSteps) {
      return 'max_steps'
    }
    if (Date.now() - this.startTime >= this.config.maxTimeMs) {
      return 'max_time'
    }
    if (this.tokenCount >= this.config.maxTokens) {
      return 'max_tokens'
    }
    return null
  }

  getStats() {
    return {
      steps: this.stepCount,
      timeMs: Date.now() - this.startTime,
      tokens: this.tokenCount,
      limits: this.config,
    }
  }
}
```

**apps/api/src/agent/loop/agent-loop.engine.ts**

```typescript
import { Injectable, Inject } from '@nestjs/common'
import { LLMProvider, LLMMessage, LLMTool } from '../provider/llm-provider.interface'
import { ToolRegistryService } from '../../tools/registry/tool-registry.service'
import { AgentRunConfig } from '../types/agent-config.types'
import { AgentTrajectory, TrajectoryStep } from '../types/agent-trajectory.types'
import { FinishReason } from '../types/finish-reason.types'
import { BudgetTracker } from './budget-tracker'

export interface AgentRunResult {
  finalMessage: string
  trajectory: AgentTrajectory
  finishReason: FinishReason
}

@Injectable()
export class AgentLoopEngine {
  constructor(
    @Inject('LLMProvider') private provider: LLMProvider,
    private toolRegistry: ToolRegistryService,
  ) {}

  /**
   * 运行 Agent Loop。核心循环逻辑：
   * 1. 检查预算 → 若超预算立即终止
   * 2. 调用 LLM → 拿到回复和 tool_calls
   * 3. 若无 tool_calls → 模型主动完成，返回 completed
   * 4. 若有 tool_calls → 执行每个 Tool，把结果追加到 messages
   * 5. 回到步骤 1
   */
  async run(
    userMessage: string,
    tools: LLMTool[],
    config?: AgentRunConfig,
  ): Promise<AgentRunResult> {
    const budget = new BudgetTracker(config)
    const trajectory: AgentTrajectory = { steps: [], stats: null as any }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是运维诊断助手，可以调用工具查询服务器指标和告警详情。分析问题时先收集数据，再给出结论。',
      },
      { role: 'user', content: userMessage },
    ]

    let finalMessage = ''
    let finishReason: FinishReason = 'completed'

    while (true) {
      // 步骤 1：检查预算
      const exceeded = budget.checkExceeded()
      if (exceeded) {
        finishReason = exceeded
        finalMessage = `[执行被强制终止：${exceeded}]`
        break
      }

      // 步骤 2：调用 LLM
      budget.incrementStep()
      const stepIndex = trajectory.steps.length + 1
      const stepStart = Date.now()

      let response
      try {
        response = await this.provider.chat(messages, tools)
      } catch (err) {
        finishReason = 'error'
        finalMessage = `[LLM 调用失败：${(err as Error).message}]`
        trajectory.steps.push({
          index: stepIndex,
          type: 'error',
          content: (err as Error).message,
          durationMs: Date.now() - stepStart,
          timestamp: new Date().toISOString(),
        })
        break
      }

      budget.addTokens(response.tokensUsed)

      // 记录模型回合
      trajectory.steps.push({
        index: stepIndex,
        type: 'model_turn',
        content: response.content,
        toolCalls: response.toolCalls,
        tokensUsed: response.tokensUsed,
        durationMs: Date.now() - stepStart,
        timestamp: new Date().toISOString(),
      })

      // 步骤 3：无 tool_calls → 模型完成
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalMessage = response.content
        finishReason = 'completed'
        break
      }

      // 步骤 4：执行每个 Tool 并追加结果到 messages
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      })

      for (const toolCall of response.toolCalls) {
        const toolStart = Date.now()
        let toolResult: string
        let toolStep: TrajectoryStep

        try {
          const args = JSON.parse(toolCall.arguments)
          const result = await this.toolRegistry.execute(toolCall.name, args, {
            userId: 'agent-loop',
            requestId: `agent-${Date.now()}`,
          })
          toolResult = JSON.stringify(result)
          toolStep = {
            index: trajectory.steps.length + 1,
            type: 'tool_call',
            toolName: toolCall.name,
            toolArgs: args,
            toolResult: result,
            durationMs: Date.now() - toolStart,
            timestamp: new Date().toISOString(),
          }
        } catch (err) {
          toolResult = JSON.stringify({ error: (err as Error).message })
          toolStep = {
            index: trajectory.steps.length + 1,
            type: 'tool_call',
            toolName: toolCall.name,
            toolArgs: {},
            toolError: (err as Error).message,
            durationMs: Date.now() - toolStart,
            timestamp: new Date().toISOString(),
          }
        }

        trajectory.steps.push(toolStep)
        messages.push({
          role: 'tool',
          content: toolResult,
          toolCallId: toolCall.id,
        })
      }
    }

    trajectory.stats = budget.getStats()
    return { finalMessage, trajectory, finishReason }
  }
}
```

**apps/api/src/agent/audit/trajectory-audit.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { AgentTrajectory } from '../types/agent-trajectory.types'
import { FinishReason } from '../types/finish-reason.types'

interface AuditRecord {
  timestamp: string
  userMessage: string
  finalMessage: string
  finishReason: FinishReason
  stepCount: number
  totalTokens: number
  totalTimeMs: number
  trajectory: AgentTrajectory
}

@Injectable()
export class TrajectoryAuditService {
  private readonly logger = new Logger(TrajectoryAuditService.name)

  /**
   * 记录一次 Agent Loop 执行。生产环境可替换为写入 LangSmith / LangFuse / 自建平台。
   * 这里先用日志打印做验证。
   */
  async logRun(
    userMessage: string,
    result: {
      finalMessage: string
      trajectory: AgentTrajectory
      finishReason: FinishReason
    },
  ): Promise<void> {
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      userMessage,
      finalMessage: result.finalMessage,
      finishReason: result.finishReason,
      stepCount: result.trajectory.steps.length,
      totalTokens: result.trajectory.stats.tokens,
      totalTimeMs: result.trajectory.stats.timeMs,
      trajectory: result.trajectory,
    }

    this.logger.log(
      `[Agent Run] finish=${record.finishReason} steps=${record.stepCount} tokens=${record.totalTokens} time=${record.totalTimeMs}ms`,
    )

    // 生产环境：await this.langsmithClient.createRun(record)
  }
}
```

**apps/api/src/agent/agent.service.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { AgentLoopEngine, AgentRunResult } from './loop/agent-loop.engine'
import { TrajectoryAuditService } from './audit/trajectory-audit.service'
import { ToolRegistryService } from '../tools/registry/tool-registry.service'
import { AgentRunConfig } from './types/agent-config.types'

@Injectable()
export class AgentService {
  constructor(
    private loopEngine: AgentLoopEngine,
    private auditService: TrajectoryAuditService,
    private toolRegistry: ToolRegistryService,
  ) {}

  async run(userMessage: string, config?: AgentRunConfig): Promise<AgentRunResult> {
    // 把 Day 11 Tool Registry 里的所有 Tool 转成 LLM 可识别的格式
    const tools = this.toolRegistry.listAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.zodToJsonSchema(tool.schema),
    }))

    const result = await this.loopEngine.run(userMessage, tools, config)
    await this.auditService.logRun(userMessage, result)
    return result
  }

  /**
   * 简化版 Zod → JSON Schema 转换。生产环境用 zod-to-json-schema 库。
   */
  private zodToJsonSchema(schema: any): Record<string, unknown> {
    // 这里由 Day 11 Tool Registry 提供更完整的转换，或用 zod-to-json-schema 库
    return schema._def?.jsonSchema || { type: 'object', properties: {} }
  }
}
```

**apps/api/src/agent/agent.controller.ts**

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common'
import { AgentService } from './agent.service'
import { AgentRunConfig } from './types/agent-config.types'

interface AgentRunDto {
  userMessage: string
  config?: AgentRunConfig
}

@Controller('agent')
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Post('run')
  async run(@Body() dto: AgentRunDto) {
    if (!dto.userMessage || typeof dto.userMessage !== 'string') {
      throw new HttpException('userMessage 必须是非空字符串', HttpStatus.BAD_REQUEST)
    }

    const result = await this.agentService.run(dto.userMessage, dto.config)

    return {
      success: true,
      finalMessage: result.finalMessage,
      finishReason: result.finishReason,
      stats: result.trajectory.stats,
      trajectory: result.trajectory,
    }
  }
}
```

**apps/api/src/agent/agent.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'
import { AgentLoopEngine } from './loop/agent-loop.engine'
import { TrajectoryAuditService } from './audit/trajectory-audit.service'
import { ProviderFactory } from './provider/provider.factory'
import { OpenAIProvider } from './provider/openai-provider'
import { ToolsModule } from '../tools/tools.module'

@Module({
  imports: [ToolsModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentLoopEngine,
    TrajectoryAuditService,
    ProviderFactory,
    OpenAIProvider,
    {
      provide: 'LLMProvider',
      useFactory: (factory: ProviderFactory) => factory.create('openai'),
      inject: [ProviderFactory],
    },
  ],
})
export class AgentModule {}
```

**apps/api/src/agent/index.ts**

```typescript
export * from './types/agent-config.types'
export * from './types/finish-reason.types'
export * from './types/agent-trajectory.types'
export * from './provider/llm-provider.interface'
export * from './loop/agent-loop.engine'
export * from './agent.service'
export * from './agent.module'
```

### 5.4 v3 用到的知识点

#### 知识点 1：Agent Loop（模型自主循环）

- **解决的问题**：单轮 Function Calling 只能"调一次工具就结束"。复杂问题需要模型多次调用工具、观察结果、决策下一步。Agent Loop 让模型自己决定"要不要再调工具、什么时候结束"。
- **运行机制**：
  - 循环体：send messages → LLM 返回 `tool_calls` 或纯文本
  - 如果返回 `tool_calls`：执行工具、把结果加入 messages、进入下一轮
  - 如果返回纯文本：说明模型认为任务完成，循环结束
  - 每轮循环前检查预算，超预算强制终止
- **项目落点**：`agent-loop.engine.ts` 的 `while (true)` 循环。三种退出路径：模型无 tool_calls（正常）、预算超限（强制）、异常抛出（error）。
- **生产误区**：
  - 误区 1：无限循环。忘记加预算检查或退出条件写错，模型可能反复调用同一工具。
  - 误区 2：把 tool 执行结果直接 return 给用户。用户看到的应该是模型对结果的自然语言解读，不是工具原始 JSON。
  - 误区 3：不把 tool_call 加入 messages。OpenAI API 要求 tool 结果必须对应之前的 tool_call_id，缺一不可。
- **验证方法**：
  - 单元测试：mock Provider 依次返回"tool_calls → tool_calls → 纯文本"，断言循环执行了 3 步后结束。
  - 反证实验：故意让 mock Provider 一直返回 tool_calls（模拟死循环），断言 `max_steps` 触发终止。

#### 知识点 2：预算设计（step / time / token 三维）

- **解决的问题**：单一"最大步数"约束不够。有的模型每步 100ms 返回、有的每步 5s 返回；有的任务每步 100 token、有的每步 5000 token。只限 step 无法防止时间/成本失控。三维预算独立生效，任一触发即终止。
- **运行机制**：
  - `maxSteps`：计数器每轮 +1，达到上限触发 `max_steps`
  - `maxTimeMs`：记录 `startTime`，每轮检查 `Date.now() - startTime`，超时触发 `max_time`
  - `maxTokens`：累加每次 LLM 响应的 `usage.total_tokens`，超限触发 `max_tokens`
- **项目落点**：`budget-tracker.ts` 的 `checkExceeded()` 方法。返回 `FinishReason | null`，null 表示可以继续，否则立即终止循环。
- **生产误区**：
  - 误区 1：把预算检查放在循环体末尾。应该放在**每次调用 LLM 之前**，否则会浪费一次昂贵的 API 调用。
  - 误区 2：预算写死在代码里。生产环境应该按用户等级/任务类型动态调整（免费用户 5 步、付费 20 步）。
  - 误区 3：不记录预算消耗。用户不知道为什么被中断，无法优化 prompt。
- **验证方法**：
  - 单元测试：构造 `BudgetTracker({ maxSteps: 3 })`，连续 `incrementStep()` 3 次后 `checkExceeded()` 返回 `'max_steps'`。
  - 集成测试：构造一个只调工具不终结的场景，观察实际耗费是否在预算内。

#### 知识点 3：终止原因分类（Finish Reason）

- **解决的问题**：循环结束后，用户和上层系统需要知道**为什么结束**。是模型完成任务？还是被预算强制中断？还是异常？不同原因需要不同的后续处理：`completed` 展示结果，`max_steps` 提示用户扩大预算，`error` 展示错误并支持重试。
- **运行机制**：
  - `completed`：LLM 返回纯文本（无 tool_calls）
  - `max_steps`/`max_time`/`max_tokens`：预算追踪器检测到超限
  - `error`：任意步骤抛出异常
  - 终止原因是**有限枚举**，不允许字符串自由拼接
- **项目落点**：`finish-reason.types.ts` 的 `type FinishReason = 'completed' | 'max_steps' | 'max_time' | 'max_tokens' | 'error'`。循环引擎返回的 `AgentRunResult` 中 `finishReason` 字段是必填。
- **生产误区**：
  - 误区 1：只用 `success: boolean` 表示结束状态。丢失了"为什么失败"的信息，无法针对性优化。
  - 误区 2：把终止原因写在自由文本字段。上层系统无法可靠地按原因分类处理。
  - 误区 3：不区分 `max_steps` 和 `error`。前者是"任务复杂需要更多预算"，后者是"系统故障需要修复"，处理策略完全不同。
- **验证方法**：
  - 单元测试：分别构造五种触发场景，断言返回的 `finishReason` 与预期一致。
  - UI 验证：前端根据 `finishReason` 显示不同图标（成功打勾/预算耗尽提示/错误红叉）。

#### 知识点 4：Tool Call ID 匹配（tool_call_id ↔ tool result）

- **解决的问题**：LLM 一次可能返回多个 `tool_calls`（并发调用），每个 tool 的结果必须**精确匹配**回原始 call_id，否则模型无法关联"哪个结果属于哪个调用"。
- **运行机制**：
  - LLM 返回：`tool_calls: [{id: "call_abc", ...}, {id: "call_xyz", ...}]`
  - 执行工具后，messages 追加：`{role: 'tool', tool_call_id: 'call_abc', content: ...}` 和 `{role: 'tool', tool_call_id: 'call_xyz', content: ...}`
  - 下一轮 LLM 通过 `tool_call_id` 找到对应结果
- **项目落点**：`agent-loop.engine.ts` 的 `for (const toolCall of response.toolCalls)` 循环。每个 tool 执行完立即 push 到 messages，保持 `tool_call_id` 一一对应。
- **生产误区**：
  - 误区 1：并发执行 tool 后按错误顺序 push messages。虽然 tool_call_id 能匹配，但顺序错乱会让某些模型（比如 Claude）报错。
  - 误区 2：某个 tool 执行失败就直接 return，不把失败结果 push 回 messages。会导致下一轮 LLM 找不到对应结果，报"Missing tool result for call_abc"。
  - 误区 3：手动生成 tool_call_id。必须使用 LLM 返回的原始 id，不能自己造。
- **验证方法**：
  - 单元测试：mock Provider 返回两个 tool_calls，断言 messages 中 tool 结果的 `tool_call_id` 与原始 call.id 完全一致。
  - 反证实验：故意在 tool 结果里改一个字符，观察下一轮 LLM 是否报错。

#### 知识点 5：Provider 抽象（Adapter 模式）

- **解决的问题**：今天用 OpenAI，明天可能换 Claude（Anthropic）、Gemini（Google）、Qwen（阿里）、本地部署的 LLaMA。如果循环引擎直接 `import OpenAI`，每次换 Provider 都要改核心逻辑。用 Adapter 模式把 Provider 抽象成接口，切换 Provider 只改配置。
- **运行机制**：
  - 定义统一接口 `LLMProvider`：`chat(messages, tools) => Promise<LLMResponse>`
  - 每个 Provider 实现该接口：`OpenAIProvider`、`ClaudeProvider`、`GeminiProvider`
  - 循环引擎只依赖接口，不知道具体是哪家
  - 工厂 `ProviderFactory.create(name)` 根据配置返回具体实例
- **项目落点**：`llm-provider.interface.ts` 定义合同，`openai-provider.ts` 是第一个实现，`provider.factory.ts` 是选择器。循环引擎通过 NestJS 依赖注入拿到 `LLMProvider`，不 `import OpenAI`。
- **生产误区**：
  - 误区 1：接口过度抽象。为了"兼容所有 Provider"设计一堆通用字段，反而丢失了各 Provider 的特色能力（比如 Claude 的 prompt caching、OpenAI 的 JSON mode）。
  - 误区 2：抽象泄漏。接口里出现 `openai_specific_field`，说明抽象没做好。
  - 误区 3：Provider 内部处理业务逻辑。Provider 只负责"把 messages 传给 LLM、把响应转成统一格式"，不做工具执行、不做重试、不做审计。
- **验证方法**：
  - 单元测试：写一个 `MockProvider` 实现 `LLMProvider` 接口，注入到循环引擎，断言循环逻辑不因 Provider 变化而失效。
  - 集成测试：切换 `OPENAI_API_KEY` 为无效值，观察是否只有 `openai-provider.ts` 报错，循环引擎不受影响。

#### 知识点 6：轨迹审计（Trajectory Recording）

- **解决的问题**：Agent 循环是黑盒——用户只看到最终回复，看不到"模型调了哪些工具、每步用了多少 token、卡在哪一步"。轨迹审计把每一步都记录下来，便于排查问题、优化 prompt、做效果评估。
- **运行机制**：
  - 每轮循环产生一个 `TrajectoryStep`：类型（model_turn / tool_call / tool_result / finished）、时间戳、内容
  - 循环结束后打包成 `AgentTrajectory`：包含所有 steps + 总预算消耗
  - 审计服务（`TrajectoryAuditService`）负责持久化：日志打印/写数据库/上报 LangSmith
- **项目落点**：`agent-trajectory.types.ts` 定义 step 类型，`agent-loop.engine.ts` 在每步 push 一条记录，`trajectory-audit.service.ts` 在循环结束后写审计。
- **生产误区**：
  - 误区 1：审计写在循环体里。会拖慢主流程（如果审计接口慢），应该异步或在循环外统一处理。
  - 误区 2：记录完整 tool 结果。tool 可能返回大量数据（比如 1000 条日志），审计存储会爆炸。应该记录元数据（结果长度、字段数）或裁剪后的样本。
  - 误区 3：把用户敏感数据写到审计。审计通常给多个团队看，密码/token/PII 必须脱敏。
- **验证方法**：
  - 单元测试：mock Provider 返回 3 步的场景，断言 `trajectory.steps.length === 3` 且每步类型正确。
  - 生产验证：查询近 1 小时的审计日志，统计各 `finishReason` 的分布，找出 `max_steps` 占比过高的场景（可能需要优化 prompt）。

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 单轮 Function Calling（调一次工具就结束） | 循环调用 + 三维预算约束 | 循环 + 预算 + 终止原因 + Provider 抽象 + 轨迹审计 |
| **事件类型 / 数据模型** | 直接用 OpenAI 原生响应类型 | 引入 AgentRunConfig（预算配置） | 完整领域模型：AgentRunConfig / AgentTrajectory / TrajectoryStep / FinishReason / LLMResponse |
| **状态存储** | 无状态，每次调用独立 | 循环内维护 messages 数组和 budgetTracker | 完整轨迹（trajectory）+ 预算追踪器 + 审计记录 |
| **归约逻辑** | 直接返回 LLM 响应 | 循环内累加 messages、检查预算、执行 tool | 分层归约：Provider 归一响应 到 循环归约 messages 到 审计归约 trajectory |
| **可测试** | 只能集成测试（依赖真实 API） | 可 mock 部分场景但仍依赖 OpenAI 类型 | 完全可测：MockProvider 实现接口即可，无需真实 API |
| **架构层次** | 单文件（agent.service.ts） | 两层（service + loop） | 五层（types / provider / loop / audit / service） |
| **换事件源代价** | 换 Provider 要改 agent.service.ts 里的调用代码 | 换 Provider 要改循环引擎里的 API 调用逻辑 | 换 Provider 只加一个 xxx-provider.ts，循环引擎不动 |
| **编译期抓遗漏** | any 类型泛滥，运行时才发现字段缺失 | AgentRunConfig 有类型但 Provider 响应仍是 any | 完整类型链：LLMProvider 接口约束 + FinishReason 判别联合 + TrajectoryStep 判别联合，编译期能抓 case 遗漏 |
| **对齐后续 Day** | Day 13 LangChain 无法复用 | Day 13-15 LangChain 集成需要重写循环 | Day 13-20 LangChain/LangGraph 可以直接把 LLMProvider 接口对接到 ChatOpenAI / ChatAnthropic，FinishReason 直接映射到 LangGraph 的 END 节点 |

---

## 6.5 前端底子补弱：HTML form 与 AbortController 结合的取消能力

**为什么放在 Agent Loop 这一天讲**：Agent Loop 会跑 30 秒以上，前端必须让用户能"中途取消"。这依赖两个原生能力：form 的 submit / formdata 事件、fetch 的 AbortController 信号。

### 6.5.1 场景锚点

用户在 Agent 对话框输入"srv-042 CPU 异常分析"，Agent Loop 开始执行。等了 10 秒还没结果，用户不耐烦想取消。前端要做两件事：
1. 阻止 form 重复提交（防止用户狂点导致 100 个 Agent 同时跑）
2. 通过 AbortController 中断已经发出的请求

### 6.5.2 项目代码

apps/web/src/features/agent-chat/AgentChatForm.vue 的核心模板与脚本：

```vue
<template>
  <form @submit.prevent="handleSubmit">
    <textarea
      v-model="userInput"
      :disabled="isRunning"
      required
      maxlength="500"
      placeholder="问点什么..."
    />
    <div class="actions">
      <button type="submit" :disabled="isRunning || !userInput.trim()">
        提交
      </button>
      <button type="button" v-if="isRunning" @click="handleCancel">
        取消
      </button>
    </div>
    <p v-if="finishReason === 'max_steps'" class="warn">
      模型达到最大步数，未完成任务。请优化提问或联系管理员扩大预算。
    </p>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const userInput = ref('')
const isRunning = ref(false)
const finishReason = ref<string | null>(null)
let abortController: AbortController | null = null

async function handleSubmit() {
  if (isRunning.value) return
  isRunning.value = true
  finishReason.value = null
  abortController = new AbortController()

  try {
    const res = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: userInput.value }),
      signal: abortController.signal,
    })
    const data = await res.json()
    finishReason.value = data.finishReason
  } catch (err: any) {
    if (err.name === 'AbortError') {
      finishReason.value = 'cancelled'
    } else {
      finishReason.value = 'error'
    }
  } finally {
    isRunning.value = false
    abortController = null
  }
}

function handleCancel() {
  abortController?.abort()
}
</script>
```

### 6.5.3 设计点拆解

- **@submit.prevent**：阻止 form 默认提交行为（会刷新页面）。等价于 event.preventDefault()。
- **type submit vs type button**：默认 button 的 type 是 submit，点击会触发 form submit。取消按钮必须显式写 type="button"，否则会被识别成"再次提交"。
- **:disabled="isRunning"**：HTML 原生 disabled 属性会阻止 form 提交，比 JS 判断更可靠。即使用户绕过 Vue 逻辑也无法触发。
- **required / maxlength**：HTML 原生校验。浏览器会自动阻止空输入或超长输入，无需 JS。
- **AbortController.abort()**：调用后 fetch 会立即 reject AbortError。后端如果监听了 req.on close，可以停止 LLM 调用。

### 6.5.4 原理

AbortController 的机制：
- new AbortController() 创建一个控制器
- controller.signal 是一个 AbortSignal 对象，可传给任何支持它的 API（fetch、setTimeout、addEventListener）
- controller.abort() 广播中断信号，所有监听该 signal 的操作立即中断
- signal.aborted 是布尔值，可以查询当前状态

后端 Express/Nest 也能读取这个信号：req.on close 或 req.aborted。

### 6.5.5 反例

- **反例 1**：不用 AbortController，只在前端 finally 里 isRunning = false。请求仍在后端跑，浪费 API 费用。
- **反例 2**：用 setTimeout 30000 而不用 signal。超时后前端认为失败，但后端仍会返回结果，UI 状态错乱。
- **反例 3**：取消按钮不设 type="button"。用户点取消反而触发 submit，Agent Loop 又跑一次。

### 6.5.6 分层提问

1. **入门**：为什么 form 的默认按钮 type 是 submit？（HTML 规范历史遗留，早期 form 只有一个提交按钮）
2. **进阶**：AbortController 能取消已经发送到服务器的请求吗？（能中断连接，但服务器可能已经开始处理，需要服务器端也监听中断）
3. **深入**：多个 fetch 共享同一个 signal，abort 一次会怎样？（所有 fetch 同时被中断）

### 6.5.7 项目对手戏

对手问：我用 Promise.race 加 setTimeout 也能实现超时取消，为什么要用 AbortController？

回答：Promise.race 只能让前端认为超时，请求本身还在发送、后端还在处理。AbortController 是双向的——前端中断 fetch、后端读到 aborted 信号可以停止 LLM 调用，节省真金白银的 API 费用。对 Agent Loop 这种一次调用几毛钱的场景，双向取消是必备。

### 6.5.8 面试真题三档答法

问：如何实现前端取消 fetch 请求？

- **初级答**：用 AbortController，new 一个 controller，把 signal 传给 fetch，需要取消时调用 abort()。
- **中级答**：AbortController 是 DOM 标准的中断信号机制，一个 controller 可以广播给多个 fetch、setTimeout、addEventListener。fetch 收到 abort 后会 reject AbortError，可以在 catch 里区分处理。
- **高级答**：AbortController 是双向的，服务器端也能通过 req.on close 或 req.aborted 感知客户端中断，从而停止耗时操作。在 Agent Loop 场景下，需要前后端配合：前端 abort 后，后端要在 while 循环里检查 req.aborted 并跳出，避免继续消耗 LLM token。同时要处理 race condition——如果 abort 发生在 fetch 返回后、data.json() 之前，仍会抛 AbortError，需要在 catch 里判断 finishReason 是否已收到部分数据。

---

---

## §7 验证

### §7.1 - §7.5（本日不涉及，全部前置到 §1.5）

### §7.6 单元 + 集成测试

**§7.6.1 Loop 终止原因单元测试**（`apps/api/src/agent/__tests__/loop.spec.ts`）

```typescript
import { AgentLoop } from '../loop';
import type { LlmProvider, ToolRegistry, Trajectory } from '../types';

const makeProvider = (responses: any[]): LlmProvider => {
  let i = 0;
  return {
    name: 'stub',
    invoke: async () => responses[i++] ?? { finishReason: 'stop', message: { role: 'assistant', content: 'done' } },
  };
};

const makeRegistry = (): ToolRegistry => ({
  get: (name) => ({ name, execute: async () => ({ ok: true, data: { echoed: name } }) }),
  list: () => [],
});

describe('AgentLoop terminate reasons', () => {
  it('stops on finishReason=stop', async () => {
    const loop = new AgentLoop(
      makeProvider([{ finishReason: 'stop', message: { role: 'assistant', content: 'final' } }]),
      makeRegistry(),
      { maxSteps: 10, maxTokens: 10000, maxDurationMs: 30000 },
    );
    const r = await loop.run({ userInput: 'x' });
    expect(r.terminate).toBe('stop');
    expect(r.trajectory.length).toBeGreaterThan(0);
  });

  it('stops on maxSteps', async () => {
    const responses = Array.from({ length: 20 }, () => ({
      finishReason: 'tool_call',
      message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'listServers', args: {} }] },
    }));
    const loop = new AgentLoop(makeProvider(responses), makeRegistry(), { maxSteps: 3, maxTokens: 100000, maxDurationMs: 30000 });
    const r = await loop.run({ userInput: 'x' });
    expect(r.terminate).toBe('max_steps');
    expect(r.stepCount).toBe(3);
  });

  it('stops on maxTokens', async () => {
    const responses = Array.from({ length: 20 }, () => ({
      finishReason: 'tool_call',
      usage: { promptTokens: 500, completionTokens: 500 },
      message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'listServers', args: {} }] },
    }));
    const loop = new AgentLoop(makeProvider(responses), makeRegistry(), { maxSteps: 100, maxTokens: 2000, maxDurationMs: 30000 });
    const r = await loop.run({ userInput: 'x' });
    expect(r.terminate).toBe('max_tokens');
  });

  it('stops on abort signal', async () => {
    const ac = new AbortController();
    const responses = Array.from({ length: 20 }, () => ({
      finishReason: 'tool_call',
      message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'listServers', args: {} }] },
    }));
    const loop = new AgentLoop(makeProvider(responses), makeRegistry(), { maxSteps: 100, maxTokens: 100000, maxDurationMs: 30000 });
    setTimeout(() => ac.abort(), 20);
    const r = await loop.run({ userInput: 'x', signal: ac.signal });
    expect(r.terminate).toBe('abort');
  });
});
```

**§7.6.2 Provider 429 重试映射测试**（`apps/api/src/agent/__tests__/provider.spec.ts`）

```typescript
import { OpenAiProvider } from '../providers/openai.provider';

describe('OpenAiProvider retry policy', () => {
  it('retries on 429 up to 3 times with exponential backoff', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      if (calls < 3) return new Response('', { status: 429, headers: { 'retry-after': '0' } });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    };
    const p = new OpenAiProvider({ apiKey: 'x', fetchImpl: fakeFetch as any, maxRetries: 3 });
    const r = await p.invoke({ messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(r.finishReason).toBe('stop');
    expect(calls).toBe(3);
  });

  it('gives up after 3 retries and returns terminate=provider_error', async () => {
    const fakeFetch = async () => new Response('', { status: 429, headers: { 'retry-after': '0' } });
    const p = new OpenAiProvider({ apiKey: 'x', fetchImpl: fakeFetch as any, maxRetries: 3 });
    await expect(p.invoke({ messages: [{ role: 'user', content: 'x' }], tools: [] })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMIT' });
  });

  it('does not retry on 400 (client error)', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    };
    const p = new OpenAiProvider({ apiKey: 'x', fetchImpl: fakeFetch as any, maxRetries: 3 });
    await expect(p.invoke({ messages: [{ role: 'user', content: 'x' }], tools: [] })).rejects.toMatchObject({ code: 'PROVIDER_BAD_REQUEST' });
    expect(calls).toBe(1);
  });
});
```

**§7.6.3 端到端：异常触发 → Agent 诊断 → Trajectory 落库**（`apps/api/test/e2e/agent-diagnose.e2e-spec.ts`）

```typescript
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Agent diagnose e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    prisma = m.get(PrismaService);
    await app.init();
    await prisma.agentRun.deleteMany();
  });
  afterAll(async () => app.close());

  it('POST /agent/diagnose returns structured report + persists trajectory', async () => {
    const alert = await prisma.alert.create({ data: { serverId: 'srv-e2e', metric: 'cpu', value: 99, status: 'NEW', version: 0 } });
    const res = await request(app.getHttpServer())
      .post('/agent/diagnose')
      .send({ alertId: alert.id });
    expect(res.status).toBe(201);
    expect(res.body.terminate).toMatch(/stop|max_steps|max_tokens/);
    expect(res.body.report).toBeDefined();
    expect(Array.isArray(res.body.trajectory)).toBe(true);

    const persisted = await prisma.agentRun.findFirst({ where: { alertId: alert.id } });
    expect(persisted).toBeDefined();
    expect(persisted!.stepCount).toBeGreaterThan(0);
  });
});
```

三组测试全部通过后才算 §7.6 结束。

### §7.7 反证实验 1 —— 拿掉 maxSteps 预算

**目的**：证明没有 step 预算时，Loop 会因 Tool 返回空导致无限循环，token 快速烧尽。

**动作**：

在 `apps/api/src/agent/loop.ts` 里把 `budget.maxSteps` 检查注释掉：

```typescript
async run(input: LoopInput): Promise<LoopResult> {
  const t0 = Date.now();
  while (true) {
    // if (this.stepCount >= this.budget.maxSteps) return this.terminate('max_steps');  ← 反证实验 1
    if (Date.now() - t0 > this.budget.maxDurationMs) return this.terminate('max_duration');
    // ... 后续
  }
}
```

同时用 stub tool 让 `listServers` 一直返回 `{ ok: true, data: [] }`，让模型误以为需要继续调用。

**期待现象**：

1. `§7.6.1` 的 `stops on maxSteps` 用例断言超时（因为不再返回 `max_steps`）。
2. Loop 转而在 `max_tokens` 或 `max_duration` 上停止，`trajectory.length` 大幅上涨（>= 20 步）。
3. 前端 AgentRunPanel 在 UI 上显示 tokens 数字快速跳到 4000+，用户能看到"预算烧尽"的可观测反馈。

**记录到 `docs/reversal-experiments/2026-07-25-no-max-steps.md`**（结构：动作 / 期待现象 / 实际现象 / 恢复动作 / 结论证据）。

**恢复**：撤销注释，重跑 §7.6.1 三组终止用例，确认再次绿。

### §7.8 反证实验 2 —— Provider 无限重试

**目的**：证明 Provider Adapter 的 `maxRetries` 边界失效后，一次 429 会引发指数放大的重试风暴。

**动作**：

在 `apps/api/src/agent/providers/openai.provider.ts` 的 `invoke()` 里，把 `maxRetries` 判断改为 `while (true)`：

```typescript
let retries = 0;
while (true) {
  const res = await this.fetchImpl(url, options);
  if (res.status === 429) {
    // if (retries >= this.maxRetries) throw new ProviderRateLimitError();  ← 反证实验 2
    retries++;
    await new Promise(r => setTimeout(r, Math.pow(2, retries) * 100));
    continue;
  }
  // ...
}
```

**期待现象**：

1. `§7.6.2` 的 `gives up after 3 retries` 用例超时红。
2. 单个请求可能重试几十次，Prometheus 计数器 `agent_provider_retry_count{code=429}` 快速上涨。
3. 若同时有并发请求，会形成"雪崩"——每个都重试，Provider 侧压力放大 10-100 倍。

**记录到 `docs/reversal-experiments/2026-07-25-infinite-retry.md`**。

**恢复**：撤销代码改动，重跑 §7.6.2 三组用例，确认再次绿。

### §7.9 四件套 + commit（不推送）

```bash
cd D:/demo/ai-techer/p1-monitor
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Commit：

```bash
git add apps/api/src/agent/ \
        apps/api/test/e2e/agent-diagnose.e2e-spec.ts \
        apps/web/src/features/agent-run/ \
        docs/reversal-experiments/2026-07-25-*.md

git commit -m "feat(agent): add agent loop with 3-budget and provider abstraction

- add loop.ts with maxSteps / maxTokens / maxDurationMs budgets
- add openai/anthropic provider adapters with retry policy
- add /agent/diagnose endpoint + trajectory persistence
- add AgentRunPanel with cancel button (AbortController)
- add 2 reversal experiments (no maxSteps + infinite retry)

Refs: Day12"
```

**禁止 `git push`**，禁止部署，禁止在生产 API key 上跑测试。

---

## §8 v3 自检清单（对齐规范 §8）

按顺序逐项打勾，一个不过要回去补。

1. `§0 项目当前状态` 明确列出 Day11 已完成的 Tool Registry 能力与今天要新增的 Agent Loop 4 类问题（Loop 状态图 / 三类预算 / Provider 抽象 / 终止原因）。
2. `§1.4` 有 5 个子块：rationale / tree / diff-table / 依赖箭头 / 3 个理解问题。
3. `§1.5` 出现"按第 5.3 节的代码"和"边写边问自己"两条指令。
4. `§5` 覆盖 v1 → v2 → v3 三层演进，每层给出代码与遗留问题。
5. `§5.3` 完整代码零省略号、零"…此处略"（Loop / Provider / Endpoint / 前端 Panel 四段完整）。
6. `§5.4` 六个知识点，每点五要素俱全（解决的问题 / 运行机制 / 项目落点 / 生产误区 / 验证方法）。
7. `§6.5` 存在，主题聚焦 HTML/表单原生能力（本日：form + AbortController 双向取消）。
8. `§7.6/§7.7/§7.8` 分别给出单元/集成/E2E 测试代码与两个反证实验。
9. `§7.9` 明确禁止 `git push`，commit message 含 `Refs: Day12`。
10. 全文 0 处 `> ✅` 或 `> ❌` 块引用格式。
11. `§12` 保留 PDF 面试题原文与"不能替代教师五连问"的免责声明。

---

## §9 AI 与人分工

- 人写：`loop.ts` 主循环、三类预算判断顺序、Provider Adapter 的重试策略、Trajectory 序列化、前端 AbortController 取消按钮。
- AI 辅助：OpenAI/Anthropic SDK 调用样板、Prisma AgentRun schema、单元测试用例枚举、README 章节。
- 记录：AI Review 里必须写清每段 AI 建议的接受/修改/拒绝理由；核心 Loop 控制流、预算判断顺序、重试映射一律不得由 AI 代写。

---

## §10 时间盒

- 原理与源码理解 90 分钟：读完本文 §1、§3-§5.4、§7.7、§7.8；不写代码。
- 真实项目增量 180 分钟：写 `loop.ts` → Provider Adapter → `/agent/diagnose` endpoint → 前端 AgentRunPanel → Trajectory 持久化。
- 测试与故障注入 60 分钟：跑 §7.6 三组测试；执行 §7.7、§7.8 两次反证实验。
- 架构证据 + AI Review + 复盘 30 分钟：更新架构证据文档，回答课末三题。

超时提醒：若"真实项目增量"块超过 270 分钟，停下评估卡在哪一层——是 Provider SDK 调用姿势不对（去 §5.4 知识点 5），还是 Loop 终止判断顺序颠倒（去 §5.4 知识点 3）。

---

## §11 通过标准

- `§7.6.1` Loop 4 种终止原因（stop / max_steps / max_tokens / abort）测试全绿。
- `§7.6.2` Provider 429 重试与 400 不重试测试全绿。
- `§7.6.3` E2E 从异常触发到 Trajectory 落库通过。
- `§7.7` `§7.8` 两次反证实验都记录了"动作 / 期待现象 / 实际现象 / 恢复动作 / 结论证据"五项。
- commit 存在且 message 以 `Refs: Day12` 结尾；本地无 `git push`。
- 至少一次真实模型调用（OpenAI 或 Anthropic）完成一次异常诊断，report 字段可读。

---

## §12 PDF 面试题

以下两道来源于公开 PDF 面试题，作为知识对照点保留，**不能替代**教师依据真实 diff 现场提出的五连问。教师验收权在教师，本节仅供自查。

1. 如何实现 AI Agent 的 Function Calling 流程？
   来源：《2026已发交个朋友全栈AI工程师》，第 6 页。
2. 项目中如何处理大模型调用超时或失败？
   来源：《2026京东前端面试-大模型方向》，第 8 页。

对应知识：Agent Loop 主循环、tool_call/tool_result 消息组装、三类预算、Provider 重试与终止映射。

---

## §13 课末 3 个核心问题（写完后先答这三题，再进入教师五连问）

1. 从前端 AgentRunPanel 的"诊断"按钮 click 到数据库 `AgentRun` 表插入一行 `terminate='stop'` 的记录，请指着 `loop.ts` 与 `openai.provider.ts` 的代码解释完整数据流。三类预算（step / token / duration）分别在哪几行判断？如果颠倒判断顺序（先 token 再 step），会带来什么可观察的差异？
2. 如果故意移除本日最关键的保护机制（选一个：maxSteps / Provider maxRetries / 前端 AbortController），线上会看到什么可观察现象？请给出最小复现、定位证据（哪张表、哪条日志、哪个 Prom 指标）、临时止损与根因修复、以及一条防复发测试。
3. 引用今天 `loop.ts`、`openai.provider.ts` 与 `AgentRunPanel.vue` 的具体代码段，证明"预算生效、真实模型完成一次诊断、失败能被明确解释"三项目标已经达成；再说明本实现距离企业生产标准还缺什么（比如：多 Provider 路由、Prompt 缓存、结果 Eval 标签、跨租户配额），并给出下一步演进路径。

---

## §14 教师五连问（教师在真实 diff 前现场发问，不预设题目）

学生提交 commit、测试输出、学习日志、反证记录、架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"发问 5 道。评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
