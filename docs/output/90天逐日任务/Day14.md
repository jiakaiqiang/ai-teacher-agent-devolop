# Day 14：SSE 合同演进（v1 单版本裸推 → v2 versioned + 断包处理 → v3 resume/取消/审计）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

任务版本：标准版
日期与时长：2026-07-27 周一，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 13 持久化 / 幂等、第一次把 Agent Loop 的 trajectory 落库、经历过"WebSocket 断线丢事件"痛点的开发者

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
   Day 13：持久化 / 幂等（事务+幂等键+执行状态+恢复）
   Day 14：SSE 合同演进（v1 单版本 → v2 断包 → v3 resume）  ← 今天在这里
   Day 15-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 14 在阶段一第 4 天**。Day 12 让 LLM 能循环调工具、Day 13 让 Run 能可靠落库，今天要把 Day 01 定义的 9 种 `AgentEvent` **升级为带版本号的合同**，通过 SSE 从服务端推给前端，覆盖 UTF-8 断包、重复 sequence、断线续传、客户端取消四种真实网络问题。

### 到 Day 13 结束时项目已具备的能力

- **前端**（Day 1-5, Day 9）：Vue3 + Vite + ECharts，Agent 事件时间线，状态机 UI，服务端权威 FSM
- **后端 Agent Loop**（Day 11-13）：Tool Registry、Agent Loop 引擎、持久化 + 幂等 + 事务 + 崩溃恢复
- **通信层**（Day 3-5）：WebSocket 推送指标、告警实时数据；**AgentEvent 只在前端内存里跑，还没接真实后端**
- **缺失的一块**：Agent Loop 在服务端跑出 trajectory 后，如何**实时**把 9 种事件推给前端？前端如何在断线重连后**不丢事件、不重复渲染**？

### 今天要解决的 4 个问题

1. **问题 1：AgentEvent 合同没有版本号**
   Day 01 定义了 9 种事件类型（`run.started` / `text.delta` / `tool.started` / ...），但没有 `version` 字段。今天升级到 `text.delta.payload.text` 支持 markdown、明天需要新增 `tool.retry` 事件，前端老版本会因为遇到未知 `type` 直接崩掉；服务端老版本不认识 `version: 'v2'` 的请求会返回 500。**版本化合同**（`{ version: 'v1', type: 'text.delta', ... }`）是"服务端升级 vs 前端升级"错峰演进的地基。

2. **问题 2：UTF-8 中文被切在两个 chunk 中间**
   SSE 传输 `data: {"text": "故障恢复"}` 时，`故` 字在 UTF-8 里是 3 字节 `E6 95 85`。TCP 层可能把这 3 字节切成两个 chunk 发送：chunk1 `E6`，chunk2 `95 85 ...`。如果前端每收到一个 chunk 就 `new TextDecoder().decode(bytes)`，`E6` 会被解码成 `�`（U+FFFD 替换字符），页面显示乱码，`JSON.parse` 也会直接抛错。正确做法是**在 `TextDecoder` 里保持 stream=true 状态**，跨 chunk 累积不完整的字节。

3. **问题 3：SSE 断线重连时的重复 sequence**
   前端 EventSource 在 sequence 508 后网络断开，浏览器自动重连并携带 `Last-Event-ID: 500`（因为它记住的最后成功事件是 500）。服务端从 500 开始重放，前端会**重复收到 501-508**这 8 个事件。Day 01 的 reducer 有 sequence 去重（`event.sequence <= state.lastSequence` 就跳过），但如果没有正确回放 `Last-Event-ID`，用户会看到"AI 输出重复了 8 段文字、工具卡片重复了 2 次"。

4. **问题 4：用户取消对话后上游还在生成**
   前端 UI 显示"AI 正在思考..."，用户等了 3 秒觉得太慢点了取消按钮。浏览器 `eventSource.close()` 只关了前端连接，但**服务端 Agent Loop 还在跑**：LLM 还在生成 token（花着 OpenAI 的钱）、Tool 还在查数据库（占着连接池）、Diagnosis 还在写入 DB（污染审计日志）。正确做法是通过 `AbortController` **把取消信号从前端传播到服务端**，服务端在下一次 step 循环开始前检查 `signal.aborted`，主动结束循环并标记 Run 为 `cancelled`。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付 **`SseModule`**，在 `p1-monitor/frontend` 里交付 **`sse-client` 模块**：把 Day 01 定义的 9 种 `AgentEvent` 升级为 `AgentEventV1`（带 `version` 字段的版本化合同），从服务端通过 SSE 推给前端，覆盖 UTF-8 断包、`Last-Event-ID` resume、`AbortController` 取消传播三条实际网络问题。

### 1.1 用户能看到什么

**场景**：运维工程师在 Agent 对话框问 "srv-042 为什么在 14:30 触发 CPU 告警？"，服务端 Agent Loop 通过 SSE 把 8 个事件推给前端。

```
时间轴：

14:30:00.000  用户点击"发送"
  → 前端：new EventSource('/agent/runs/r-01/stream')
  → 服务端：res.setHeader('Content-Type', 'text/event-stream')

14:30:00.100  服务端推第 1 个事件
  data: {"version":"v1","type":"run.started","runId":"r-01","sequence":1,"occurredAt":"2026-07-27T06:30:00.100Z","payload":{}}
  id: 1

14:30:00.500  服务端推 text.delta（首个中文字符跨 chunk）
  chunk 1 到达前端：data: {"version":"v1","type":"text.delta",...,"payload":{"text":"故"    ← 故 = 故，UTF-8 是 E6 95 85
  chunk 2 到达前端：障恢复..."}}\n\n     ← 后续字符
  前端 TextDecoder(stream: true) 正确拼接为完整的 JSON
  id: 2

14:30:01.200  服务端推 tool.started
  data: {"version":"v1","type":"tool.started","sequence":3,"payload":{"callId":"c-01","toolName":"getMetrics","argumentSummary":"srv-042 CPU 30min"}}
  id: 3

14:30:01.800  网络断开（前端 EventSource 自动重连）
  前端：EventSource 触发 'error' 事件，浏览器 3 秒后自动重连
  重连请求：GET /agent/runs/r-01/stream，Header: Last-Event-ID: 3

14:30:04.900  服务端收到 Last-Event-ID: 3
  从 sequence 4 开始重放（不是从 1 重放，前端已经有 1-3）
  data: {"version":"v1","type":"tool.succeeded","sequence":4,...}
  id: 4
  data: {"version":"v1","type":"text.delta","sequence":5,"payload":{"text":"分析结论：..."}}
  id: 5
  ...

14:30:07.000  用户点击"取消"按钮
  前端：abortController.abort()；eventSource.close()
  前端：fetch('/agent/runs/r-01/cancel', {method:'POST'})
  服务端：AgentLoopEngine 在下一次 step 开始时检查 signal，主动结束
  服务端：Persist AgentRun.status = 'cancelled'
  服务端最后推一条事件：
  data: {"version":"v1","type":"run.cancelled","sequence":8,"payload":{"reason":"user_cancelled"}}
  id: 8
```

前端观察到的最终结果：
- 事件流从 sequence 1 到 8 完整收到
- 中文文本正确渲染（无 `�` 乱码）
- 断线重连后**不重复**渲染 tool 卡片、**不重复**追加文本
- 用户点击"取消"后 500ms 内 LLM 停止生成，DB 里 AgentRun.status = `cancelled`

### 1.2 这个模块在项目里承担什么

- **输入**：Day 13 的 `AgentLoopEngine.run(config, { signal })` 内部循环产生的 9 种 `AgentEvent` + 可选的 `Last-Event-ID` 头
- **输出**：SSE HTTP 响应流（每条 `data: ...\nid: N\n\n`）+ 客户端 `AbortController.abort()` 到服务端 `signal.aborted` 的取消传播链路
- **对齐后续**：今天定义的 **`AgentEventV1` 合同**（`version: 'v1'` + `sequence` + `id`）是 Day 15-20（LangChain 流式输出）、Day 30（M3 端到端门禁）的传输层基座。Day 30 会要求"任何一次 Agent Run 从服务端启动到前端 UI 更新全链路可回放"

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 单版本 SSE 裸推，前端 `EventSource` 直接消费 | 服务端单文件 `sse.controller.ts`（`res.write('data: ...')`）+ 前端 `useSseStream.ts`（`onmessage` 直接 `JSON.parse`） | SSE 协议、`Content-Type: text/event-stream`、EventSource 基本用法 |
| **v1 痛点** | 无版本号（前后端升级会崩）、无中文断包处理（乱码）、无 resume（断线重复）、无取消传播（服务端浪费资源） |  |  |
| **v2** | v1 + **`AgentEventV1` 版本化合同** + **UTF-8 断包处理** | 拆出 `agent-event-v1.ts` 类型 + 前端 `chunked-parser.ts` + `TextDecoder(stream:true)` | 版本化 payload 设计、`fetch` + `ReadableStream` 手动解析（替代 EventSource）、`TextDecoder` 流式解码状态 |
| **v2 痛点** | 断线重复渲染、用户取消后服务端不停 |  |  |
| **v3** | v2 + **`Last-Event-ID` resume cursor** + **`AbortController` 取消传播** + **事件审计** | 完整分层（contract/parser/resume/cancel/audit） | Resume cursor 语义、EventSource 与 `fetch+ReadableStream` 的取舍、AbortSignal 跨进程传播、SSE 审计日志 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：SSE 合同涉及前端/后端两端 + 4 个关注点（版本化合同/UTF-8 断包/resume/取消），如果不先立骨架，最容易犯的错就是把"合同定义"、"解析逻辑"、"resume 判断"、"取消传播"糊在一个 controller 里。看完这棵树，下面章节再出现 `frontend/src/agent/stream/chunked-parser.ts` 时，你就能立刻定位它属于"前端 SSE 解析层"。

**今天在 `p1-monitor/` 下要建立的完整目录树（v3 完整版）**：

```
p1-monitor/
├── apps/api/src/
│   ├── sse/                                     ← 【新增】SSE 服务端模块
│   │   ├── contract/
│   │   │   ├── agent-event-v1.ts                ← 版本化事件类型（v1 合同）
│   │   │   ├── agent-event-v1.spec.ts           ← 合同 schema 单测
│   │   │   └── event-envelope.ts                ← SSE 帧封装（data/id/event/retry）
│   │   ├── resume/
│   │   │   ├── event-store.ts                   ← 事件缓存（按 runId 存 sequence）
│   │   │   ├── event-store.spec.ts              ← 缓存单测
│   │   │   └── resume.strategy.ts               ← Last-Event-ID 解析 + 起点定位
│   │   ├── cancel/
│   │   │   ├── cancel-registry.service.ts       ← runId → AbortController 注册表
│   │   │   └── cancel-registry.service.spec.ts  ← 注册表单测
│   │   ├── audit/
│   │   │   └── sse-audit.service.ts             ← SSE 帧审计（观测重复率、断包率）
│   │   ├── sse.controller.ts                    ← HTTP 入口（GET stream + POST cancel）
│   │   ├── sse.module.ts                        ← NestJS 模块
│   │   ├── sse.service.ts                       ← 业务编排（从 Agent Loop 收事件写 SSE）
│   │   └── index.ts                             ← 桶文件
│   ├── agent/                                   ← 【Day 12-13 已有】
│   │   └── loop/agent-loop.engine.ts            ← 需要改：接入 signal + eventEmitter
│   └── persistence/                             ← 【Day 13 已有】
├── frontend/src/
│   ├── agent/stream/                            ← 【新增】前端 SSE 客户端
│   │   ├── contract/
│   │   │   └── agent-event-v1.ts                ← 与服务端共享的合同类型（复制版）
│   │   ├── parser/
│   │   │   ├── chunked-parser.ts                ← UTF-8 断包 + SSE 帧解析
│   │   │   └── chunked-parser.spec.ts           ← 手工构造断包字节的单测
│   │   ├── resume/
│   │   │   └── resume-tracker.ts                ← 记录 lastEventId
│   │   ├── cancel/
│   │   │   └── cancel-signal.ts                 ← AbortController 封装
│   │   ├── useSseStream.ts                      ← Vue composable（编排层）
│   │   └── index.ts
│   └── features/agent-run/
│       └── ui/AgentRunPanel.vue                 ← 【Day 01 已有】接入 useSseStream
└── docs/
    └── adr/
        └── ADR-014-sse-vs-ws.md                 ← 【新增】SSE 与 WebSocket 取舍决策
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `sse/contract/agent-event-v1.ts` | ✗（前端直接用 Day 01 的 AgentEvent） | ✓ 加 `version: 'v1'` 字段 | ✓ 同 v2 |
| `sse/contract/event-envelope.ts` | ✗ 硬编码在 controller 里 | ✓ 抽出 SSE 帧封装 | ✓ 同 v2 |
| 前端 SSE 客户端 | 用 `EventSource`（浏览器内置） | 换成 `fetch` + `ReadableStream` | ✓ 同 v2 + 加 lastEventId 追踪 |
| `parser/chunked-parser.ts` | ✗ | ✓ TextDecoder(stream:true) | ✓ 同 v2 |
| `resume/event-store.ts` | ✗ | ✗ | ✓ 服务端缓存 |
| `resume/resume.strategy.ts` | ✗ | ✗ | ✓ Last-Event-ID → 起点 |
| `cancel/cancel-registry.service.ts` | ✗ | ✗ | ✓ AbortController 注册表 |
| `cancel/cancel-signal.ts`（前端） | ✗ | ✗ | ✓ 前端触发 POST /cancel |
| ADR-014 | ✗ | ✗ | ✓ SSE vs WS 决策 |

**依赖方向（务必单向，反过来一次都不行）**：

```
前端：
AgentRunPanel.vue
    │
    ▼
useSseStream.ts（composable 编排层）
    │
    ├─► parser/chunked-parser.ts ──► contract/agent-event-v1.ts（纯类型）
    │
    ├─► resume/resume-tracker.ts（纯类）
    │
    └─► cancel/cancel-signal.ts（纯类）

后端：
sse.controller.ts（HTTP 入口）
    │
    ▼
sse.service.ts（业务编排）
    │
    ├─► agent/loop/agent-loop.engine.ts（Day 12）
    │
    ├─► contract/event-envelope.ts（纯函数）
    │
    ├─► resume/resume.strategy.ts ──► resume/event-store.ts ──► prisma
    │
    ├─► cancel/cancel-registry.service.ts（内存 Map）
    │
    └─► audit/sse-audit.service.ts ──► prisma

contract/*.ts       ← 只声明类型和 schema，不 import service
parser/*.ts         ← 前端纯逻辑，不 import Vue
resume.strategy.ts  ← 纯函数，输入 Last-Event-ID 输出 startSequence
```

**红线**：
- `contract/agent-event-v1.ts` 里出现 `import { HttpService }` 或 `import { PrismaService }` 就是架构塌方——合同只描述数据形状
- 前端 `parser/chunked-parser.ts` 里出现 `import { ref } from 'vue'` 是塌方——parser 必须能在纯 Node 环境单测
- `sse.controller.ts` 里直接 `res.write('data:...')` 拼接字符串是塌方——SSE 帧格式应该走 `event-envelope.ts` 的封装

**动手前先问自己 3 个问题**：

1. `chunked-parser.ts` 为什么必须能在纯 Node 环境跑？—— 见 §5.4 知识点 2「UTF-8 断包与 TextDecoder(stream:true)」
2. `Last-Event-ID` 为什么放在 HTTP Header 而不是 URL query？—— 见 §5.4 知识点 4「Resume cursor 的传输位置」
3. 前端 `AbortController.abort()` 怎么让服务端知道？—— 见 §5.4 知识点 5「取消传播的跨进程边界」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认依赖 + 装 fetch 相关工具（3 分钟）

按第 5.3 节的代码：

- 后端：`p1-monitor/apps/api` 已经有 NestJS，`res.write()` 是 Express 原生方法，不需要额外依赖
- 前端：Vite + Vue3 环境已有 `fetch` API，但要装 `@microsoft/fetch-event-source` 做 fallback（可选，v3 里我们手写 parser 就不需要）
- 单测环境：`pnpm --filter frontend add -D @vitest/browser`（可选，用于跑 TextDecoder 相关测试；不装的话 vitest 用 node 环境也能跑）

**边写边问自己**：

- 为什么不用 EventSource？（不支持自定义 Header，无法传 auth token；不支持 POST；浏览器兼容性和 fetch 差不多）
- 为什么不用 socket.io？（socket.io 是 WebSocket 之上的封装，多一层协议开销；SSE 本身是 HTTP 长连接，走标准反代/CDN 都没问题）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树：

**后端**：在 `apps/api/src/sse/` 下建 4 个子目录：`contract/` `resume/` `cancel/` `audit/`
**前端**：在 `frontend/src/agent/stream/` 下建 4 个子目录：`contract/` `parser/` `resume/` `cancel/`

**边写边问自己**：

- 为什么前后端各有一份 `contract/agent-event-v1.ts`？（前后端隔离，不能通过 workspace 引用共享，因为前端类型和后端 Prisma 类型有细微差异；共享要走 codegen）
- 为什么前端叫 `agent/stream/` 而不是 `services/sse/`？（`stream` 是领域概念——事件流；`services` 是技术分类——太泛化）

### 1.5.3 D-3：定义 `AgentEventV1` 合同（4 分钟）

按第 5.3 节的代码：

- 写 `apps/api/src/sse/contract/agent-event-v1.ts`（`version: 'v1'` 判别联合）
- 写 `apps/api/src/sse/contract/event-envelope.ts`（SSE 帧封装函数）
- 前端 `frontend/src/agent/stream/contract/agent-event-v1.ts` **同一份复制**（不同 workspace 不共享）

**边写边问自己**：

- 为什么 `version` 字段类型是 `'v1'` 字面量而不是 `string`？（future v2 加进来时 TypeScript 能自动窄化，`if (event.version === 'v1')` 分支里 payload 类型确定）
- SSE 帧的 `event:` 字段和 payload 里的 `type` 字段是同一个东西吗？（不是——`event:` 是 HTTP 层字段用于浏览器 EventSource 路由，payload.type 是应用层字段；我们 v3 只用 `data:` 和 `id:`，不用 `event:`）

### 1.5.4 D-4：实现前端 `chunked-parser.ts`（6 分钟）

按第 5.3 节的代码：

- 写 `frontend/src/agent/stream/parser/chunked-parser.ts`（`ChunkedParser` 类，维护 TextDecoder 和 `\n\n` 缓冲）
- 写 `frontend/src/agent/stream/parser/chunked-parser.spec.ts`（手工构造 UTF-8 断包字节的 8 个用例）

**边写边问自己**：

- 为什么 `TextDecoder` 一定要 `stream: true`？（不加 stream 参数，遇到不完整字节 decode 会返回 `�` 替换字符）
- 缓冲区什么时候清空？（当遇到 `\n\n` 完整分隔符时，把 `\n\n` 之前的部分作为一条完整帧提取出来）
- parser 需要保持 `event: xxx` 类型的状态吗？（v3 我们只解析 `data:` 和 `id:` 两行；`event:` 忽略）

### 1.5.5 D-5：实现 resume + cancel + 编排（5 分钟）

按第 5.3 节的代码：

- 写 `apps/api/src/sse/resume/event-store.ts`（`Map<runId, EventV1[]>` 或者 Postgres 的 `agent_events` 表）
- 写 `apps/api/src/sse/resume/resume.strategy.ts`（纯函数：`resolveStartSequence(lastEventId, storedEvents)`）
- 写 `apps/api/src/sse/cancel/cancel-registry.service.ts`（`Map<runId, AbortController>`）
- 写 `apps/api/src/sse/sse.service.ts`（业务编排）
- 写 `apps/api/src/sse/sse.controller.ts`（`GET /agent/runs/:runId/stream` + `POST /agent/runs/:runId/cancel`）
- 写 `apps/api/src/sse/sse.module.ts`
- 写 `frontend/src/agent/stream/resume/resume-tracker.ts`
- 写 `frontend/src/agent/stream/cancel/cancel-signal.ts`
- 写 `frontend/src/agent/stream/useSseStream.ts`（Vue composable）
- 改 `frontend/src/features/agent-run/ui/AgentRunPanel.vue`（接入 useSseStream）
- 写 `docs/adr/ADR-014-sse-vs-ws.md`

**边写边问自己**：

- `event-store` 用内存 Map 还是 Postgres？（v3 教学版用 Postgres 表 `agent_events`，因为进程重启后 resume 还要能工作；生产可以用 Redis Stream）
- `cancel-registry` 为什么必须是 Map 不能是 Postgres？（`AbortController` 是运行时对象，无法序列化；跨进程取消需要用 Redis pub/sub 或 SIGTERM）
- `useSseStream` 为什么在 `onUnmounted` 里必须 `abort()`？（组件卸载了但 fetch 请求还在，后续 push 的事件更新已销毁的 ref 会报错）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"裸推→版本化→resume+取消"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `chunked-parser.ts` 和 `resume.strategy.ts` | 能口述"UTF-8 断包是怎么被 TextDecoder 缓冲的"、"Last-Event-ID 怎么决定起点" |
| C：读深挖 | 35 min | §6.5 前端底子补弱（`Day14深挖-前端底子补弱.html`） | 能回答"EventSource 和 fetch+ReadableStream 各自的取舍" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build && pnpm --filter frontend build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个测试文件 | `pnpm --filter frontend test chunked-parser` 全绿 + 后端 `resume.strategy` 全绿 |
| F-1：反证 1 | 5 min | §7.7 手动去掉 `TextDecoder(stream:true)`，观察中文乱码 | 观察 `�` 替换字符，验证"没有流式解码时的样子" |
| F-2：反证 2 | 5 min | §7.8 手动断开网络，观察断线重复渲染 | 观察 tool 卡片重复出现，验证"没有 resume/去重时的样子" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day14` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（EventSource 裸推）

### 3.1 v1 要实现什么

Day 12 的 Agent Loop 在服务端跑完后返回 `AgentTrajectory`。v1 只做一件事：**把 trajectory 里的每一步事件通过 SSE 推给前端**，前端用浏览器原生 `EventSource` 消费。

**目标**：
- 服务端 `GET /agent/runs/:runId/stream` 返回 `Content-Type: text/event-stream`
- Agent Loop 每完成一个 step，`res.write('data: ' + JSON.stringify(event) + '\n\n')` 推给前端
- 前端 `new EventSource(url).onmessage = e => reducer(state, JSON.parse(e.data))`

**不做**：
- 事件没有 `version` 字段
- 不处理 UTF-8 断包（EventSource 默认按浏览器实现，UTF-8 处理由浏览器负责但仍可能有边界问题）
- 不支持断线续传（EventSource 自动重连但不传 Last-Event-ID）
- 不支持客户端取消（EventSource 关闭后服务端继续跑）

### 3.2 v1 目录结构

```
apps/api/src/
├── sse/
│   ├── sse.controller.ts     ← 单文件，硬编码 SSE 帧
│   └── sse.module.ts
└── agent/loop/agent-loop.engine.ts   ← 加个 eventEmitter，Loop 内推事件

frontend/src/
└── agent/stream/
    └── useSseStream.ts       ← 单文件，new EventSource
```

### 3.3 v1 完整代码

**apps/api/src/sse/sse.controller.ts（v1 全文）**

```typescript
import { Controller, Get, Param, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AgentLoopEngine } from '../agent/loop/agent-loop.engine'

@Controller('agent/runs')
export class SseController {
  constructor(private readonly agentLoop: AgentLoopEngine) {}

  @Get(':runId/stream')
  async stream(@Param('runId') runId: string, @Res() res: Response): Promise<void> {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // 订阅 Agent Loop 事件（假设 agentLoop 内部有 EventEmitter）
    const handler = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    this.agentLoop.on(runId, handler)

    // 客户端断开时清理
    res.on('close', () => {
      this.agentLoop.off(runId, handler)
      // 注意：v1 不主动 abort Agent Loop，服务端继续跑
    })
  }
}
```

**apps/api/src/sse/sse.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { SseController } from './sse.controller'
import { AgentModule } from '../agent/agent.module'

@Module({
  imports: [AgentModule],
  controllers: [SseController],
})
export class SseModule {}
```

**apps/api/src/agent/loop/agent-loop.engine.ts（v1 增量）**

```typescript
import { Injectable } from '@nestjs/common'
import { EventEmitter } from 'events'

@Injectable()
export class AgentLoopEngine extends EventEmitter {
  async run(config: AgentRunConfig): Promise<AgentTrajectory> {
    const trajectory: AgentTrajectory = { steps: [], usage: {...}, finishReason: 'running' }

    // v1：每完成一步就 emit
    this.emit(config.runId, { type: 'run.started', runId: config.runId, sequence: 1, occurredAt: new Date().toISOString(), payload: {} })

    // ... 循环调用 LLM 和 Tool ...
    // 每一步 emit 一个事件

    this.emit(config.runId, { type: 'run.finished', runId: config.runId, sequence: 8, occurredAt: new Date().toISOString(), payload: { summary: '...' } })

    return trajectory
  }
}
```

**frontend/src/agent/stream/useSseStream.ts（v1 全文）**

```typescript
import { ref, onUnmounted } from 'vue'
import { reduceAgentEvent, initialAgentRunState, type AgentRunState } from '@/domain/agent/agent-run-state'

export function useSseStream(runId: string) {
  const state = ref<AgentRunState>(initialAgentRunState)
  const eventSource = new EventSource(`/agent/runs/${runId}/stream`)

  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data)  // v1：假设永远是完整 JSON
    state.value = reduceAgentEvent(state.value, event)
  }

  eventSource.onerror = () => {
    console.error('SSE connection error, browser will auto-reconnect')
    // v1：浏览器自动重连，但不传 Last-Event-ID
  }

  onUnmounted(() => {
    eventSource.close()
    // v1：只关前端，不通知服务端；服务端 Agent Loop 继续跑
  })

  return { state }
}
```

**frontend/src/features/agent-run/ui/AgentRunPanel.vue（v1 集成点）**

```vue
<template>
  <div class="agent-run-panel">
    <div v-for="item in state.timeline" :key="item.key">
      {{ item.title }}: {{ item.detail }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSseStream } from '@/agent/stream/useSseStream'
const props = defineProps<{ runId: string }>()
const { state } = useSseStream(props.runId)
</script>
```

### 3.4 v1 暴露的痛点

**痛点 1：无版本号，前后端升级会崩**

明天服务端升级：新增 `tool.retry` 事件；前端老版本 reducer 里 `switch (event.type)` 走到 `default` 分支，`assertNever` 抛错，整个 Agent 面板挂掉。或者前端先升级：给 `text.delta.payload` 加 `markdown: boolean` 字段，服务端老版本发的旧格式在新前端里解析成 `markdown: undefined`，模板逻辑 `if (payload.markdown)` 走进了错误分支。**没有版本号 = 无法演进**。

**痛点 2：UTF-8 中文断包（EventSource 表面上没问题但实际有边界情况）**

EventSource 的浏览器实现**确实**处理了 UTF-8 断包，但：
- 只在 `data:` 完整行里保证 UTF-8 完整，跨帧（`\n\n` 分隔）拼接的 payload 如果服务端一次 `res.write` 里塞多个 chunk 就会出问题
- 更重要的是：**v2 我们要换成 `fetch` + `ReadableStream` 手动解析**（为了支持自定义 Header），这时候必须自己处理 UTF-8

现在你先在 `useSseStream` 里刻意用 `text.delta` 推一段被 TCP 切开的中文，观察部分浏览器（旧版 Safari）会显示 `?` 或 `�`。

**痛点 3：断线重复渲染**

EventSource 的自动重连**默认不传 Last-Event-ID**（只有当服务端主动发 `retry:` 字段时才传）。断线场景：
- sequence 508 断开
- 浏览器 3 秒后自动重连 `GET /stream`
- 服务端不知道前端已经收到哪些事件，从 sequence 1 开始重放
- 前端 reducer 有 sequence 去重，但**每次重放事件都会触发 UI 重新计算**（性能浪费）；如果 reducer 没有 sequence 去重（v1 的 reducer 是 Day 01 写的，有 sequence 去重）就会重复渲染

**痛点 4：用户取消不传播**

前端点"取消" → `eventSource.close()` → 只关了前端 HTTP 连接。服务端 `res.on('close')` 触发，但 v1 只 `off(handler)`，**没有 `agentLoop.abort(runId)`**。Agent Loop 继续调用 LLM：
- OpenAI 账单还在涨
- Tool Registry 还在查 DB 连接池
- 最后 Diagnosis 还会写入 DB，UI 上看不到但审计日志里有一条"用户已取消但仍生成了 Diagnosis"的诡异记录

**痛点 5：进程重启事件丢失**

Agent Loop 跑到 step 5 服务端重启（发布新版本）。前端 EventSource 自动重连，服务端**新进程根本没有这个 runId 的 EventEmitter 订阅**，前端永远收不到剩下的事件。UI 卡在"正在思考..."。

---

## 4. v2：加事件版本 + UTF-8 流式解码 + fetch/ReadableStream

### 4.1 v2 要实现什么

用户视角：事件带上 `version: 'v1'` 字段，前后端有明确的兼容合同；用 `fetch` + `ReadableStream` + `TextDecoder({ stream: true })` 手动解析 SSE 帧，中文断包不再乱码。

**依然不做**：
- 不支持 Last-Event-ID 续传（断线后仍从头开始）
- 不支持客户端取消传播（关连接不 abort Loop）

### 4.2 v2 目录结构

```
apps/api/src/sse/
├── protocol/
│   ├── event-version.ts       ← 新增：'v1' 版本常量 + 事件契约
│   └── sse-frame.ts           ← 新增：SSE 帧格式化（data:/id:/event:/retry:）
├── sse.controller.ts          ← 改：用 sse-frame 格式化输出
└── sse.module.ts

frontend/src/agent/stream/
├── parser/
│   ├── sse-line-parser.ts     ← 新增：处理 fetch/ReadableStream + TextDecoder
│   └── sse-line-parser.spec.ts ← 单元测试（中文断包）
└── useSseStream.ts             ← 改：用 fetch + parser
```

### 4.3 v2 完整代码

**apps/api/src/sse/protocol/event-version.ts**

```typescript
// SSE 事件版本合同（前后端共享）
export const SSE_EVENT_VERSION = 'v1' as const
export type SseEventVersion = typeof SSE_EVENT_VERSION

// 版本化的事件外壳
export type VersionedAgentEvent = {
  version: SseEventVersion
  // Day 01 的 AgentEvent 全部字段
  type: string
  runId: string
  sequence: number
  occurredAt: string
  payload: Record<string, unknown>
}
```

**apps/api/src/sse/protocol/sse-frame.ts**

```typescript
// SSE 帧格式化：把一个事件对象序列化成一段 SSE 帧文本
export function formatSseFrame(params: {
  data: unknown
  id?: string | number      // Last-Event-ID
  event?: string            // 事件类型（可选）
  retry?: number            // 客户端重连间隔（毫秒）
}): string {
  const lines: string[] = []
  if (params.event) lines.push(`event: ${params.event}`)
  if (params.id !== undefined) lines.push(`id: ${params.id}`)
  if (params.retry !== undefined) lines.push(`retry: ${params.retry}`)

  const dataStr = typeof params.data === 'string' ? params.data : JSON.stringify(params.data)
  // 多行 data 每行前缀 "data: "
  for (const line of dataStr.split('\n')) {
    lines.push(`data: ${line}`)
  }

  return lines.join('\n') + '\n\n'   // 空行结束帧
}
```

**apps/api/src/sse/sse.controller.ts（v2 全文）**

```typescript
import { Controller, Get, Param, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AgentLoopEngine } from '../agent/loop/agent-loop.engine'
import { SSE_EVENT_VERSION, type VersionedAgentEvent } from './protocol/event-version'
import { formatSseFrame } from './protocol/sse-frame'

@Controller('agent/runs')
export class SseController {
  constructor(private readonly agentLoop: AgentLoopEngine) {}

  @Get(':runId/stream')
  async stream(@Param('runId') runId: string, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')  // Nginx 反向代理时禁止缓冲
    res.flushHeaders()

    // 发送 retry 指令告诉浏览器重连间隔
    res.write(formatSseFrame({ data: '', retry: 3000 }))

    const handler = (event: VersionedAgentEvent) => {
      // v2：包一层 version，保持向后兼容
      const versioned: VersionedAgentEvent = { version: SSE_EVENT_VERSION, ...event }
      res.write(formatSseFrame({
        data: versioned,
        id: event.sequence,    // Last-Event-ID 用 sequence
        event: event.type,
      }))
    }
    this.agentLoop.on(runId, handler)

    res.on('close', () => {
      this.agentLoop.off(runId, handler)
      // v2 依然不 abort Loop
    })
  }
}
```

**frontend/src/agent/stream/parser/sse-line-parser.ts**

```typescript
// SSE 逐行解析器，处理 UTF-8 断包
// 输入：ReadableStream<Uint8Array>
// 输出：AsyncGenerator<{ id?: string, event?: string, data: string }>

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ id?: string; event?: string; data: string }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  //                                          ^^^^^^^^^^^^ 关键：stream=true 时不完整字节留在内部 buffer

  let buffer = ''    // 未组成完整 SSE 帧的行缓冲
  let currentEvent: { id?: string; event?: string; data: string } = { data: '' }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      // 关键：{ stream: true } 告诉 decoder 后面还有数据，UTF-8 不完整字节留在内部
      buffer += decoder.decode(value, { stream: true })

      // 按行处理
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''    // 最后一行可能不完整，留到下次

      for (const line of lines) {
        if (line === '') {
          // 空行 = 一个事件结束
          if (currentEvent.data !== '') {
            yield currentEvent
          }
          currentEvent = { data: '' }
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6)
          currentEvent.data = currentEvent.data === '' ? data : currentEvent.data + '\n' + data
        } else if (line.startsWith('id: ')) {
          currentEvent.id = line.slice(4)
        } else if (line.startsWith('event: ')) {
          currentEvent.event = line.slice(7)
        }
        // 忽略以 : 开头的注释行、忽略其他字段
      }
    }
    // 流结束，flush decoder 内部剩余字节
    buffer += decoder.decode()
    if (buffer !== '' && currentEvent.data !== '') {
      yield currentEvent
    }
  } finally {
    reader.releaseLock()
  }
}
```

**frontend/src/agent/stream/parser/sse-line-parser.spec.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { parseSseStream } from './sse-line-parser'

// 辅助：从 Uint8Array 数组构造 ReadableStream
function chunksToStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

describe('parseSseStream', () => {
  it('解析单个完整事件', async () => {
    const encoder = new TextEncoder()
    const stream = chunksToStream([encoder.encode('data: hello\n\n')])
    const events = []
    for await (const e of parseSseStream(stream)) events.push(e)
    expect(events).toEqual([{ data: 'hello' }])
  })

  it('中文事件不被断包切乱：一次性 chunk', async () => {
    const encoder = new TextEncoder()
    const stream = chunksToStream([encoder.encode('data: 故障恢复\n\n')])
    const events = []
    for await (const e of parseSseStream(stream)) events.push(e)
    expect(events).toEqual([{ data: '故障恢复' }])
  })

  it('中文事件跨 chunk 断包（把"障"的 3 个字节切成 2+1）', async () => {
    const bytes = new TextEncoder().encode('data: 故障恢复\n\n')
    // "故障恢复" 的 UTF-8：故=E6 95 85, 障=E9 9A 9C, 恢=E6 81 A2, 复=E5 A4 8D
    // 找到 "障" 的第一个字节位置，切在字符中间
    // 'data: ' = 6 字节，'故' = 3 字节，所以 "障" 的第一字节位置 = 9
    const chunk1 = bytes.slice(0, 10)   // 切在 "障" 中间（"障"的第 1 字节之后）
    const chunk2 = bytes.slice(10)
    const stream = chunksToStream([chunk1, chunk2])
    const events = []
    for await (const e of parseSseStream(stream)) events.push(e)
    expect(events).toEqual([{ data: '故障恢复' }])
  })

  it('两个事件之间的空行分隔', async () => {
    const encoder = new TextEncoder()
    const stream = chunksToStream([encoder.encode('data: one\n\ndata: two\n\n')])
    const events = []
    for await (const e of parseSseStream(stream)) events.push(e)
    expect(events).toEqual([{ data: 'one' }, { data: 'two' }])
  })

  it('id 字段被正确提取', async () => {
    const encoder = new TextEncoder()
    const stream = chunksToStream([encoder.encode('id: 42\ndata: hello\n\n')])
    const events = []
    for await (const e of parseSseStream(stream)) events.push(e)
    expect(events).toEqual([{ id: '42', data: 'hello' }])
  })

  it('多行 data 被拼接（换行分隔）', async () => {
    const encoder = new TextEncoder()
    const stream = chunksToStream([encoder.encode('data: line1\ndata: line2\n\n')])
    const events = []
    for await (const e of parseSseStream(stream)) events.push(e)
    expect(events).toEqual([{ data: 'line1\nline2' }])
  })
})
```

**frontend/src/agent/stream/useSseStream.ts（v2 全文）**

```typescript
import { ref, onUnmounted } from 'vue'
import { reduceAgentEvent, initialAgentRunState, type AgentRunState } from '@/domain/agent/agent-run-state'
import { parseSseStream } from './parser/sse-line-parser'

export function useSseStream(runId: string) {
  const state = ref<AgentRunState>(initialAgentRunState)
  const abortController = new AbortController()

  async function start() {
    const res = await fetch(`/agent/runs/${runId}/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: abortController.signal,
    })
    if (!res.body) throw new Error('SSE response has no body')

    for await (const frame of parseSseStream(res.body)) {
      try {
        const event = JSON.parse(frame.data)
        // v2：检查 version 字段，未来 v2 事件老前端可以拒绝或降级
        if (event.version !== 'v1') {
          console.warn('Unsupported event version:', event.version)
          continue
        }
        state.value = reduceAgentEvent(state.value, event)
      } catch (err) {
        console.error('Failed to parse SSE frame:', frame, err)
      }
    }
  }

  start().catch((err) => {
    if (err.name !== 'AbortError') console.error('SSE stream error:', err)
  })

  onUnmounted(() => {
    abortController.abort()
    // v2 依然不通知服务端 abort Loop
  })

  return { state }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：断线后从头重放，事件重复渲染**

用户在 sequence 508 断线（3G 网络切换）。v2 前端 `fetch` 抛 `TypeError: NetworkError`，进入 catch 分支就结束了。用户手动刷新页面 → 重新发起 fetch → 服务端从 sequence 1 开始重放整个 trajectory → 前端 reducer 有 sequence 去重（Day 01 的规则 A：`event.sequence <= state.lastSequence` 返回 state）所以状态正确，**但** 508 个事件都要走一遍 reducer，UI 会闪一下白（reactive 计算全部重跑）。生产上用户观感很差。

**痛点 2：客户端取消不传播**

用户点"取消对话" → `abortController.abort()` → fetch 抛 AbortError → 前端连接关闭。服务端 `res.on('close')` 触发 `agentLoop.off(handler)`，但 **Agent Loop 还在跑**：
- 已经开始的 LLM 调用要等 30 秒超时
- 已经启动的 Tool 调用要跑完
- 最后 Diagnosis 还是会写进 DB（Day 13 的持久化不会因为前端断开而回滚）

审计日志里会出现"用户取消后 60 秒生成了一条 Diagnosis"的诡异事件。

**痛点 3：服务端进程重启事件丢失**

Agent Loop 在服务端跑到 step 5，服务端重启（发布新版本）。前端 fetch 断开、AbortError；用户刷新页面重连；**新进程的 `AgentLoopEngine` 没有这个 runId 的 EventEmitter 订阅**（EventEmitter 是内存对象），前端永远收不到剩下的事件。

正解：从 Day 13 已经持久化的 `AgentRun` + `ToolCall` 表里查历史事件回放给前端，然后如果 status 还是 `running` 再从 EventEmitter 订阅未来事件。

---

## 5. v3：Last-Event-ID 续传 + 客户端取消传播 + DB 回放（终态）

### 5.1 v3 要实现什么

用户视角：
- 断线重连时前端发 `Last-Event-ID: 507`（或用 URL query），服务端从 sequence 508 开始重放，前端一个事件都不重复
- 用户点"取消对话"时，前端发 `POST /agent/runs/:id/cancel` 通知服务端 abort Loop，Loop 内部检查 `AbortSignal` 并中止 LLM/Tool 调用
- 服务端重启后前端重连，先从 DB 查历史事件回放，再挂内存 EventEmitter 订阅未来事件；用户完全感知不到"服务端重启过"

### 5.2 v3 目录结构

```
apps/api/src/sse/
├── protocol/
│   ├── event-version.ts
│   ├── sse-frame.ts
│   └── resume-cursor.ts        ← 新增：Last-Event-ID 解析 + 边界校验
├── replay/
│   ├── db-replay.service.ts    ← 新增：从 AgentRun/ToolCall 表回放事件
│   └── db-replay.service.spec.ts
├── cancel/
│   ├── run-abort-registry.ts   ← 新增：runId → AbortController 的注册表
│   └── run-abort-registry.spec.ts
├── sse.controller.ts           ← 改：解析 Last-Event-ID + DB 回放 + AbortController
├── sse.module.ts
└── index.ts

frontend/src/agent/stream/
├── parser/
│   ├── sse-line-parser.ts
│   └── sse-line-parser.spec.ts
├── cursor/
│   ├── event-cursor.ts         ← 新增：本地缓存最新 sequence
│   └── event-cursor.spec.ts
└── useSseStream.ts             ← 改：断线重连 + Last-Event-ID + 取消 POST
```

### 5.3 v3 完整代码

**apps/api/src/sse/protocol/resume-cursor.ts**

```typescript
// Last-Event-ID 解析规则（服务端）
// 前端可以从两个位置传入 cursor：
//   1. HTTP header: Last-Event-ID: 507   （SSE 标准）
//   2. URL query:   ?since=507            （轮询/手动重连场景）

export type ResumeCursor = {
  since: number   // 从 sequence > since 开始
}

export function parseResumeCursor(input: {
  header?: string
  query?: string | number
}): ResumeCursor {
  // 优先 header（标准），fallback query
  const raw = input.header ?? input.query
  if (raw === undefined || raw === null || raw === '') {
    return { since: -1 }   // 从头开始
  }
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`Invalid resume cursor: ${raw}`)
  }
  return { since: n }
}
```

**apps/api/src/sse/replay/db-replay.service.ts**

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { VersionedAgentEvent } from '../protocol/event-version'
import { SSE_EVENT_VERSION } from '../protocol/event-version'

@Injectable()
export class DbReplayService {
  constructor(private readonly prisma: PrismaService) {}

  // 从 DB 里查这个 runId 已经落库的事件，转成 VersionedAgentEvent
  // 只回放 sequence > since 的事件
  async replay(runId: string, since: number): Promise<VersionedAgentEvent[]> {
    const events: VersionedAgentEvent[] = []

    // 1. AgentRun 本身：started / finished / failed
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId } })
    if (!run) return events

    if (run.startedAt && 0 > since) {
      events.push({
        version: SSE_EVENT_VERSION,
        type: 'run.started',
        runId,
        sequence: 0,
        occurredAt: run.startedAt.toISOString(),
        payload: {},
      })
    }

    // 2. ToolCall：每次调用一对 tool.started + tool.succeeded/failed
    const toolCalls = await this.prisma.toolCall.findMany({
      where: { agentRunId: runId },
      orderBy: { createdAt: 'asc' },
    })
    let seq = 1
    for (const tc of toolCalls) {
      if (seq > since) {
        events.push({
          version: SSE_EVENT_VERSION,
          type: 'tool.started',
          runId,
          sequence: seq,
          occurredAt: tc.createdAt.toISOString(),
          payload: { callId: tc.id, toolName: tc.toolName, argumentSummary: tc.argumentJson },
        })
      }
      seq++
      if (tc.errorCode) {
        if (seq > since) {
          events.push({
            version: SSE_EVENT_VERSION,
            type: 'tool.failed',
            runId,
            sequence: seq,
            occurredAt: tc.createdAt.toISOString(),
            payload: { callId: tc.id, code: tc.errorCode, message: 'from DB replay' },
          })
        }
      } else {
        if (seq > since) {
          events.push({
            version: SSE_EVENT_VERSION,
            type: 'tool.succeeded',
            runId,
            sequence: seq,
            occurredAt: tc.createdAt.toISOString(),
            payload: { callId: tc.id, resultSummary: tc.resultJson ?? '', durationMs: tc.durationMs },
          })
        }
      }
      seq++
    }

    // 3. Diagnosis / 终态
    const diagnosis = await this.prisma.diagnosis.findFirst({
      where: { agentRunId: runId },
      orderBy: { createdAt: 'asc' },
    })
    if (diagnosis && run.finishedAt) {
      if (seq > since) {
        events.push({
          version: SSE_EVENT_VERSION,
          type: run.status === 'completed' ? 'run.finished' : 'run.failed',
          runId,
          sequence: seq,
          occurredAt: run.finishedAt.toISOString(),
          payload: { summary: diagnosis.summary, code: run.status === 'failed' ? 'unknown' : undefined, message: '' },
        })
      }
    }

    return events
  }
}
```

**apps/api/src/sse/cancel/run-abort-registry.ts**

```typescript
import { Injectable } from '@nestjs/common'

// runId → AbortController 的进程内注册表
// 服务端启动一个 Agent Loop 时把 controller 注册进来
// 用户 POST /cancel 时找到 controller 并调 abort()
@Injectable()
export class RunAbortRegistry {
  private readonly controllers = new Map<string, AbortController>()

  register(runId: string): AbortController {
    // 如果已存在（进程重启前的残留），先 abort 老的
    const existing = this.controllers.get(runId)
    if (existing) existing.abort()

    const controller = new AbortController()
    this.controllers.set(runId, controller)
    return controller
  }

  cancel(runId: string, reason = 'user_cancelled'): boolean {
    const controller = this.controllers.get(runId)
    if (!controller) return false
    controller.abort(reason)
    this.controllers.delete(runId)
    return true
  }

  unregister(runId: string): void {
    this.controllers.delete(runId)
  }

  getSignal(runId: string): AbortSignal | undefined {
    return this.controllers.get(runId)?.signal
  }
}
```

**apps/api/src/sse/cancel/run-abort-registry.spec.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { RunAbortRegistry } from './run-abort-registry'

describe('RunAbortRegistry', () => {
  it('register 后 getSignal 能拿到未 abort 的 signal', () => {
    const reg = new RunAbortRegistry()
    const controller = reg.register('r-1')
    expect(reg.getSignal('r-1')?.aborted).toBe(false)
    expect(controller.signal.aborted).toBe(false)
  })

  it('cancel 后 signal.aborted = true', () => {
    const reg = new RunAbortRegistry()
    reg.register('r-1')
    expect(reg.cancel('r-1')).toBe(true)
    expect(reg.getSignal('r-1')).toBeUndefined()   // 已删除
  })

  it('cancel 不存在的 runId 返回 false', () => {
    const reg = new RunAbortRegistry()
    expect(reg.cancel('r-none')).toBe(false)
  })

  it('重复 register 同一个 runId 会 abort 老的', () => {
    const reg = new RunAbortRegistry()
    const first = reg.register('r-1')
    const second = reg.register('r-1')
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  it('unregister 后 signal 消失但不 abort', () => {
    const reg = new RunAbortRegistry()
    const controller = reg.register('r-1')
    reg.unregister('r-1')
    expect(reg.getSignal('r-1')).toBeUndefined()
    expect(controller.signal.aborted).toBe(false)   // unregister 不 abort，只是解绑
  })
})
```

**apps/api/src/sse/sse.controller.ts（v3 全文）**

```typescript
import { Controller, Get, Post, Param, Query, Headers, Res, HttpCode } from '@nestjs/common'
import type { Response } from 'express'
import { AgentLoopEngine } from '../agent/loop/agent-loop.engine'
import { SSE_EVENT_VERSION, type VersionedAgentEvent } from './protocol/event-version'
import { formatSseFrame } from './protocol/sse-frame'
import { parseResumeCursor } from './protocol/resume-cursor'
import { DbReplayService } from './replay/db-replay.service'
import { RunAbortRegistry } from './cancel/run-abort-registry'

@Controller('agent/runs')
export class SseController {
  constructor(
    private readonly agentLoop: AgentLoopEngine,
    private readonly dbReplay: DbReplayService,
    private readonly abortRegistry: RunAbortRegistry,
  ) {}

  @Get(':runId/stream')
  async stream(
    @Param('runId') runId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('since') sinceQuery: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    res.write(formatSseFrame({ data: '', retry: 3000 }))

    // 1. 解析 cursor
    const cursor = parseResumeCursor({ header: lastEventId, query: sinceQuery })

    // 2. 先从 DB 回放历史事件
    const historyEvents = await this.dbReplay.replay(runId, cursor.since)
    let lastSent = cursor.since
    for (const event of historyEvents) {
      res.write(formatSseFrame({
        data: event,
        id: event.sequence,
        event: event.type,
      }))
      lastSent = event.sequence
    }

    // 3. 挂 EventEmitter 订阅未来事件（跳过已回放的 sequence）
    const handler = (event: VersionedAgentEvent) => {
      if (event.sequence <= lastSent) return   // DB 回放已经发过了
      const versioned: VersionedAgentEvent = { version: SSE_EVENT_VERSION, ...event }
      res.write(formatSseFrame({
        data: versioned,
        id: event.sequence,
        event: event.type,
      }))
      lastSent = event.sequence
    }
    this.agentLoop.on(runId, handler)

    // 4. 客户端断开时 unsubscribe，但不 abort Loop（用户可能只是切网络）
    res.on('close', () => {
      this.agentLoop.off(runId, handler)
    })
  }

  @Post(':runId/cancel')
  @HttpCode(200)
  cancel(@Param('runId') runId: string): { cancelled: boolean } {
    // 显式取消：找到 AbortController，通知 Loop 内部 abort
    const cancelled = this.abortRegistry.cancel(runId, 'user_cancelled')
    return { cancelled }
  }
}
```

**apps/api/src/sse/sse.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { SseController } from './sse.controller'
import { DbReplayService } from './replay/db-replay.service'
import { RunAbortRegistry } from './cancel/run-abort-registry'
import { AgentModule } from '../agent/agent.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [AgentModule, PrismaModule],
  controllers: [SseController],
  providers: [DbReplayService, RunAbortRegistry],
  exports: [RunAbortRegistry],   // AgentLoopEngine 需要用它注册 AbortController
})
export class SseModule {}
```

**apps/api/src/agent/loop/agent-loop.engine.ts（v3 改动点）**

```typescript
// Day 12 已有代码 ... 增加 AbortSignal 支持
import { RunAbortRegistry } from '../../sse/cancel/run-abort-registry'

@Injectable()
export class AgentLoopEngine {
  constructor(
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistryService,
    private readonly persistence: PersistenceService,
    private readonly abortRegistry: RunAbortRegistry,   // ← v3 新增
  ) {}

  async run(config: AgentRunConfig): Promise<AgentTrajectory> {
    // 注册 AbortController，把 signal 传给内部 LLM/Tool 调用
    const controller = this.abortRegistry.register(config.runId)
    const signal = controller.signal

    try {
      const trajectory = await this.executeLoop({ ...config, signal })
      await this.persistence.persist(config.anomalyId, trajectory)
      return trajectory
    } finally {
      this.abortRegistry.unregister(config.runId)
    }
  }

  private async executeLoop(config: AgentRunConfig & { signal: AbortSignal }): Promise<AgentTrajectory> {
    // 每次循环开始检查 signal
    while (!this.shouldStop()) {
      if (config.signal.aborted) {
        return { ...currentTrajectory, finishReason: 'user_cancelled' }
      }
      // 把 signal 传给 provider.call（fetch 会接管）
      const response = await this.provider.call(messages, tools, { signal: config.signal })
      // 把 signal 传给 tool.execute（每个 Tool 内部 fetch/DB 调用都接 signal）
      const toolResult = await this.toolRegistry.execute(toolCall.name, toolCall.args, { signal: config.signal })
      currentTrajectory.steps.push({ type: 'tool.result', tool: toolCall.name, result: toolResult })
      messages.push({ role: 'tool', content: JSON.stringify(toolResult), toolCallId: toolCall.id })
      if (response.finishReason === 'stop') {
        return { ...currentTrajectory, finishReason: 'completed' }
      }
    }
  }
}
```

**frontend/src/agent/stream/cursor/event-cursor.ts**

```typescript
// 本地缓存最新收到的 sequence，断线重连时用
// 用 localStorage 保证刷新页面后仍能续传

const STORAGE_KEY_PREFIX = 'agent-run-cursor:'

export function loadCursor(runId: string): number {
  const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${runId}`)
  if (!raw) return -1
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? -1 : n
}

export function saveCursor(runId: string, sequence: number): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${runId}`, String(sequence))
}

export function clearCursor(runId: string): void {
  localStorage.removeItem(`${STORAGE_KEY_PREFIX}${runId}`)
}
```

**frontend/src/agent/stream/cursor/event-cursor.spec.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { loadCursor, saveCursor, clearCursor } from './event-cursor'

describe('event-cursor', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('无缓存时 loadCursor 返回 -1', () => {
    expect(loadCursor('r-1')).toBe(-1)
  })

  it('saveCursor 后 loadCursor 能读回', () => {
    saveCursor('r-1', 42)
    expect(loadCursor('r-1')).toBe(42)
  })

  it('损坏数据时 loadCursor 返回 -1', () => {
    localStorage.setItem('agent-run-cursor:r-1', 'not-a-number')
    expect(loadCursor('r-1')).toBe(-1)
  })

  it('clearCursor 后再 loadCursor 返回 -1', () => {
    saveCursor('r-1', 42)
    clearCursor('r-1')
    expect(loadCursor('r-1')).toBe(-1)
  })
})
```

**frontend/src/agent/stream/useSseStream.ts（v3 全文）**

```typescript
import { ref, onUnmounted } from 'vue'
import { reduceAgentEvent, initialAgentRunState, type AgentRunState } from '@/domain/agent/agent-run-state'
import { parseSseStream } from './parser/sse-line-parser'
import { loadCursor, saveCursor, clearCursor } from './cursor/event-cursor'

export function useSseStream(runId: string) {
  const state = ref<AgentRunState>(initialAgentRunState)
  const abortController = new AbortController()
  let reconnectAttempt = 0

  async function connectOnce() {
    const since = loadCursor(runId)
    const res = await fetch(`/agent/runs/${runId}/stream?since=${since}`, {
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(since) },
      signal: abortController.signal,
    })
    if (!res.body) throw new Error('SSE response has no body')

    for await (const frame of parseSseStream(res.body)) {
      try {
        const event = JSON.parse(frame.data)
        if (event.version !== 'v1') {
          console.warn('Unsupported event version:', event.version)
          continue
        }
        state.value = reduceAgentEvent(state.value, event)
        saveCursor(runId, event.sequence)
        // 收到终态时清 cursor（不需要续传了）
        if (['completed', 'failed', 'cancelled'].includes(state.value.status)) {
          clearCursor(runId)
        }
        reconnectAttempt = 0   // 成功接收后重置重连计数
      } catch (err) {
        console.error('Failed to parse SSE frame:', frame, err)
      }
    }
  }

  async function startWithReconnect() {
    while (!abortController.signal.aborted) {
      try {
        await connectOnce()
        // 正常 EOF（终态），不重连
        return
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        // 网络错误：指数退避重连
        reconnectAttempt++
        if (reconnectAttempt > 5) {
          console.error('SSE reconnect exceeded max attempts')
          return
        }
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 30000)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  startWithReconnect()

  async function cancel() {
    // 通知服务端 abort Loop
    await fetch(`/agent/runs/${runId}/cancel`, { method: 'POST' }).catch(() => {})
    abortController.abort()
    clearCursor(runId)
  }

  onUnmounted(() => {
    abortController.abort()
    // 组件销毁时不主动 cancel Loop（用户可能只是切页面）
  })

  return { state, cancel }
}
```

### 5.4 v3 用到的知识点

1. **SSE 帧格式（`data:` / `id:` / `event:` / `retry:`）**
   - 解决的问题：HTTP 单向持续推送、防止代理缓冲、天然复用 HTTP 认证/HTTPS/CORS 基础设施
   - 运行机制：`Content-Type: text/event-stream`、每帧以空行结束、字段用 `field: value` 语法、多个 `data:` 行会被拼成一个字符串（换行分隔）
   - 项目落点：`sse-frame.ts` 的 `formatSseFrame`、`sse.controller.ts` 的 `res.setHeader` + `res.write`
   - 生产误区：忘记设 `Cache-Control: no-cache`（浏览器或代理缓存 SSE 响应，永远收不到数据）；忘记 `X-Accel-Buffering: no`（Nginx 默认缓冲 SSE，前端要等 8KB 才能收到）；`data:` 行内含 `\n` 不拆分（浏览器只把 `\n\n` 作为帧结束，你就构造了非法帧）
   - 验证方法：`curl -N /agent/runs/r-1/stream` 应该看到 `data: {...}\n\nid: 1\n\n...` 流式输出；打开浏览器 DevTools Network → EventStream 面板能看到事件列表

2. **`TextDecoder({ stream: true })` 流式解码**
   - 解决的问题：UTF-8 变长编码（1-4 字节），一个字符可能被 TCP/HTTP chunk 切成两半；如果每块独立 decode，跨块字符会解码成 U+FFFD 替换字符（就是那个问号菱形）
   - 运行机制：`decoder.decode(chunk, { stream: true })` 会把不完整字节留在 decoder 内部 buffer，等下次调用时拼接；流结束时调 `decoder.decode()`（无参数）flush 剩余字节
   - 项目落点：`sse-line-parser.ts` 的 `TextDecoder('utf-8', { fatal: false })` + `decoder.decode(value, { stream: true })`
   - 生产误区：`new TextDecoder().decode(chunk)` 每次新建 decoder（buffer 每次都清空，跨块字符必错）；`{ fatal: true }` 遇到不完整字节抛错（应该用 `fatal: false` 配合 stream 模式）；忘记流结束时 flush（最后一个字符如果不完整会丢）
   - 验证方法：单测里手动构造"故障恢复"的字节数组，切在字符中间（比如 E9 后面切开），断言 decoder 能正确还原；`echo -n "中文" | xxd` 查看字节序列辅助设计测试

3. **事件版本合同（`version: 'v1'`）**
   - 解决的问题：前后端解耦、演进不破坏老客户端。今天 v1 只有 9 种 type，明天 v2 加了 `tool.paused`；老前端能识别 v2 事件的 version 字段并选择降级或忽略，而不是解析出未知 type 崩溃
   - 运行机制：所有事件对象加一个 `version: 'v1'` 字段；前端在 reduce 之前先看 version，未知版本走 fallback（比如警告 + 忽略、或调 `/api/version-mismatch` 上报）；后端引入 `type: 'tool.paused'` 之前先升 `version: 'v2'`
   - 项目落点：`event-version.ts` 的 `SSE_EVENT_VERSION` 常量、`useSseStream.ts` 里 `if (event.version !== 'v1') continue`
   - 生产误区：直接在 v1 的 union 里加新 type 而不升版本（老客户端崩溃）；把 version 塞进 payload 里（无法在 reduce 之前查）；每加一个字段就升 major 版本（版本号爆炸）
   - 验证方法：写一个"未来 v2 事件"的 fixture，前端不应崩溃、应该 console.warn；服务端加个 `version=v2 事件计数` metrics，观察线上老客户端占比

4. **Last-Event-ID 与 `id:` 字段（续传）**
   - 解决的问题：断线重连时"从上次收到的 sequence 之后开始"，避免重复渲染/重复计费
   - 运行机制：SSE 帧的 `id: 507` 会被浏览器（EventSource API）在重连时自动放到 `Last-Event-ID` header；用 fetch/ReadableStream 时需要手动读 sequence 并保存
   - 项目落点：`resume-cursor.ts` 的 `parseResumeCursor`、`event-cursor.ts` 的 `saveCursor`、`sse.controller.ts` 里 `@Headers('last-event-id')`
   - 生产误区：cursor 只存内存（刷新页面就丢）；cursor 存在 sessionStorage 而不是 localStorage（关掉标签页丢失）；服务端信任前端传的 cursor 不做上界校验（前端传 `since=999999` 服务端直接返回空，用户永远看不到内容）
   - 验证方法：DevTools Network 面板 Offline 模拟断网 5 秒，恢复后应该看到请求 header `Last-Event-ID: xxx`；断线前后前端 timeline 事件数一致（无重复、无遗漏）

5. **DB 回放（服务端进程重启的鲁棒性）**
   - 解决的问题：EventEmitter 是内存对象，服务端进程重启后新进程没有旧 runId 的订阅；如果只从 EventEmitter 推事件，用户重连后什么都收不到
   - 运行机制：连接时先从 `AgentRun`/`ToolCall`/`Diagnosis` 表查出已完成的事件转成 VersionedAgentEvent 序列一次性 push；然后再挂 EventEmitter 订阅未来事件；用 `lastSent` 变量记录最大 sequence 避免 DB 事件和 EventEmitter 事件重复
   - 项目落点：`db-replay.service.ts` 的 `replay(runId, since)`、`sse.controller.ts` 里先 replay 再 subscribe
   - 生产误区：先 subscribe 再 replay（EventEmitter 推的事件 sequence < replay 最后一条，前端 reducer 去重规则会丢事件）；replay 后不记录 `lastSent`（未来事件重复推）；DB 里的 ToolCall 和 EventEmitter 里的 tool.started 事件 sequence 对不上（回放序列破碎）
   - 验证方法：跑到 step 3 时 kill 服务端进程重启，前端应该无缝重连并看到完整 5 步；DB 里插一条 `AgentRun.status='completed'` 但 EventEmitter 没订阅的 runId，重连应该能收到完整回放然后 EOF

6. **客户端取消传播（`AbortController` + `POST /cancel`）**
   - 解决的问题：用户"关闭对话"后 Agent Loop 还在跑，浪费 LLM/Tool 调用成本；审计里出现"用户取消后又生成一条 Diagnosis"的诡异事件
   - 运行机制：服务端为每个 runId 维护 AbortController（`RunAbortRegistry`）；`POST /cancel` 时调 `controller.abort('user_cancelled')`；LLM/Tool 调用把 signal 传给内部 fetch，fetch 收到 abort 抛 AbortError，Loop 捕获后走终态分支
   - 项目落点：`run-abort-registry.ts` 全部逻辑、`agent-loop.engine.ts` 里 `signal` 从 registry 拿并透传给 provider/tool
   - 生产误区：只关 SSE 连接不发 cancel POST（服务端 Loop 继续跑）；cancel 请求发出但服务端不检查 signal（LLM 调用超时前不会 abort）；signal 只传给 LLM 不传给 Tool（Tool 内的 HTTP 调用继续，DB 事务继续）；abort 后不清理 AbortController（内存泄漏）
   - 验证方法：跑 Agent 时点"取消"，服务端日志应该 30ms 内看到"AbortError caught"；DB 里这条 Run 的 `status = 'cancelled'` 而不是 'completed'；`SELECT count(*) FROM diagnoses WHERE agent_run_id = 'r-xxx'` = 0

7. **指数退避重连**
   - 解决的问题：网络抖动时前端立即重连会打爆服务端；一直不重连用户体验差
   - 运行机制：`connectOnce()` 抛错后等 `min(1000 * 2 ** attempt, 30000)` 毫秒再试；成功接收事件后重置 attempt；超过 5 次放弃
   - 项目落点：`useSseStream.ts` 的 `startWithReconnect` 循环
   - 生产误区：无退避（服务端崩了前端每秒 fetch 一次，恢复时 QPS 尖峰）；无上限（重试 20 次要等 100 万秒）；attempt 不重置（连上后如果又断，退避从上次继续，用户体验诡异）
   - 验证方法：DevTools Network 面板 Throttling → Offline 5 秒然后恢复，观察 fetch 请求间隔应该是 2s → 4s → 8s 而不是 1s → 1s → 1s；服务端连续 crash-restart 时，前端总能在 30 秒内重连成功

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 服务端能推事件、前端能显示 | v1 + 事件版本 + UTF-8 流式解码 | v2 + Last-Event-ID 续传 + 客户端取消 + DB 回放 |
| **事件类型 / 数据模型** | 明文 JSON.stringify，无版本字段 | `VersionedAgentEvent`（含 `version: 'v1'`） | 同 v2 |
| **状态存储** | 前端 `state = ref()` 内存 | 同 v1 | 前端 `state = ref()` + `localStorage` cursor；服务端 EventEmitter + DB 回放 |
| **归约逻辑** | Day 01 reducer 直接接 SSE | reducer + `parseSseStream` 生成器 | reducer + `parseSseStream` + `if (event.sequence <= lastSent) skip` 去重 |
| **可测试** | 手动 mock 全字符串 | `sse-line-parser.spec.ts` 12 个 case | v2 + `db-replay.service.spec.ts` + `run-abort-registry.spec.ts` + `event-cursor.spec.ts` |
| **架构层次** | 一个 controller | protocol 层拆出 | protocol/replay/cancel 三个子目录，controller 只做编排 |
| **换事件源代价** | 换成 WebSocket 要重写整个前端逻辑 | 换成 WebSocket 只改 controller 层，reducer 不变 | 同 v2；还可换存储层（EventEmitter → Redis Pub/Sub）不影响 controller |
| **编译期抓遗漏** | 事件类型是 `any`，reducer 里拼错字段编译过 | `VersionedAgentEvent` 判别联合 + reducer `assertNever` | 同 v2 |
| **对齐后续 Day** | Day 15 LLM 流式响应会用同一套 protocol | Day 30 M3 门禁验收"事件回放" | 同 v2；Day 61 多 Agent 协同会复用 `RunAbortRegistry` 抽象 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

配套深挖 HTML 文件 `output/Day13深挖-前端底子补弱.html`（复用 Day13 深挖文件，追加两节 Day14 内容）或独立创建 `output/Day14深挖-前端底子补弱.html`，展开以下四个知识点：

- **深挖 1：SSE 协议与 fetch/ReadableStream 组合的三层抽象** —— 从 TCP chunk → UTF-8 bytes → SSE 帧 → JSON 事件的完整解码链
- **深挖 2：TextDecoder 的流式模式与 BOM/替换字符** —— 变长编码在 chunk 边界的行为、`{ stream: true }` 的 buffer 状态
- **深挖 3：事件版本管理与判别联合的组合** —— Day 01 的 `AgentEvent` 演进为 `VersionedAgentEvent` 的过程、broken change 处理
- **深挖 4：AbortController / AbortSignal 的传播与 fetch 集成** —— signal 从组件卸载 → useSseStream → fetch → 服务端；服务端 signal 从 controller → Loop → Provider → Tool

深挖 HTML 结构按规范 §6.1：8 子节（场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法）。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

必写 4 个测试文件：

1. **`apps/api/src/sse/protocol/sse-frame.spec.ts`**（6 个 case）
   - 单行 data 正确格式化
   - 多行 data 用 `\ndata:` 分隔
   - 带 id/event/retry 字段
   - JSON payload 不被换行破坏
   - VersionedAgentEvent 序列化包含 version 字段
   - 结尾必须有 `\n\n`

2. **`apps/api/src/sse/replay/db-replay.service.spec.ts`**（8 个 case）
   - 无 runId 返回空数组
   - AgentRun 只 started 未完成时只返回 1 个事件
   - 有 3 条 ToolCall 时返回 1+6=7 个事件（start+succeeded 各 3 对）
   - ToolCall 有 errorCode 时返回 tool.failed 而不是 tool.succeeded
   - AgentRun completed 时最后一个事件是 run.finished
   - AgentRun failed 时最后一个事件是 run.failed
   - `since=5` 时只返回 sequence > 5 的事件
   - sequence 严格递增（1,2,3,... 无跳号）

3. **`apps/api/src/sse/cancel/run-abort-registry.spec.ts`**（5 个 case，已在 §5.3 全文给出）

4. **`frontend/src/agent/stream/parser/sse-line-parser.spec.ts`**（12 个 case，已在 §4 v2 全文给出）

5. **`frontend/src/agent/stream/cursor/event-cursor.spec.ts`**（4 个 case，已在 §5.3 全文给出）

跑 `pnpm --filter api test sse` + `pnpm --filter frontend test stream` 应该全绿，覆盖率 90%+。

### 7.7 F-1：反证实验 1（5 分钟）—— 手动去掉 `TextDecoder({ stream: true })`

在 `sse-line-parser.ts` 里把：

```typescript
buffer += decoder.decode(value, { stream: true })
```

改成：

```typescript
buffer += new TextDecoder().decode(value)   // 每块新建 decoder，无 stream
```

然后跑一个包含中文的 Agent Run（可以在 fixture 里塞 `payload: { text: '故障恢复中...' }`），观察：

- 前端 timeline 中的中文变成 `??故障?` 或 `?复中...`
- 打开 DevTools Console 应该看到 `SyntaxError: Unexpected token ...` （JSON 解析失败）
- 记录：改动前后的 `git diff`、错误的 Console 输出截图、恢复正常后的 timeline 截图

结论：`{ stream: true }` 是必需的，不是"性能优化"。

### 7.8 F-2：反证实验 2（5 分钟）—— 手动去掉 sequence 去重

在 `agent-run-state.ts`（Day 01 已有的 reducer）里把：

```typescript
if (event.sequence <= state.lastSequence) return state
```

**注释掉**（不删，方便还原），然后触发一次断线重连（DevTools Offline 3 秒然后恢复）：

- 前端 timeline 里同一段"模型输出"文字出现两次
- 或者同一个 tool.started 卡片出现两个
- DB 里没有脏数据（因为 sequence 是前端 reducer 用的，不改动 DB）

还原去重规则后重跑，timeline 只有一份。

结论：sequence 去重是"断线重连"场景的必要保护，不能因为觉得多余而删掉。

### 7.9 F-3：验证 + 提交（10 分钟）

**四件套**：

```bash
cd D:\demo\ai-techer\p1-monitor
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter api test
pnpm --filter api build

pnpm --filter frontend typecheck
pnpm --filter frontend lint
pnpm --filter frontend test
pnpm --filter frontend build
```

八条全绿后再提交。

**Conventional Commits 模板**：

```
feat(sse): add versioned event contract with Last-Event-ID resume and cancel propagation

- protocol: add v1 event version + SSE frame formatter
- replay: DbReplayService restores events from AgentRun/ToolCall tables
- cancel: RunAbortRegistry tracks AbortController per runId
- frontend: TextDecoder({ stream: true }) fixes UTF-8 chunk boundary
- frontend: event-cursor persists sequence in localStorage for resume

Refs: Day14
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day15 结束时集中 push。

---

## 8. 通过标准

- [ ] §3 v1 能跑通：`curl -N /agent/runs/r-1/stream` 收到 event-stream 帧，前端 timeline 出现 5 步事件
- [ ] §4 v2 能通过 UTF-8 边界测试：中文字符被切在两个 chunk 也不乱码
- [ ] §5 v3 断线重连不重复：DevTools Offline 3 秒后恢复，timeline 事件数不增加
- [ ] §5 v3 取消传播：点"取消"后 30ms 内服务端日志出现 `AbortError caught`，DB 中 `status='cancelled'`
- [ ] §5 v3 DB 回放：kill 服务端进程再重启，前端重连能看到完整 5 步
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 前后端各 4 条全绿
- [ ] Git commit 信息含 `Refs: Day14`
- [ ] 没有 `git push`
- [ ] 深挖 HTML 4 个 section 内容完整（8 子节 × 4 = 32 段）

---

## 9. 提交物

- `apps/api/src/sse/` 完整目录（protocol/replay/cancel + module + controller）
- `frontend/src/agent/stream/` 完整目录（parser/cursor + useSseStream）
- 5 个测试文件（sse-frame / db-replay / run-abort-registry / sse-line-parser / event-cursor）
- 反证实验记录（两段 diff + Console 截图 + timeline 截图）
- 深挖 HTML 文件（4 个 section）
- 学习日志（写在 `output/学习日志/Day14.md`，含反证实验思考和课末 3 个核心问题的答案）
- 架构证据（在 `docs/adr/` 加一条 ADR：`0014-sse-vs-websocket.md`，记录取舍理由）

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"SSE 合同演进"的数据流或控制流；当天知识链"SSE、UTF-8 chunk、事件版本、Resume cursor、客户端取消"分别在哪一层起作用，为什么按这个顺序学习？

2. 如果故意移除今天最关键的保护机制（比如 `TextDecoder({ stream: true })` 或 `sequence` 去重或 `AbortController.abort()`），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么（比如 SSE 认证、Redis Pub/Sub 替换 EventEmitter、跨进程 AbortController 分布式协调），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 中文"故障恢复"的 UTF-8 字节被拆在两个 chunk（比如 E6 95 85 障 | E9 9A 9C 恢 E5 A4 8D），parser 每块独立 decode，页面出现乱码且事件 JSON 解析失败。请保存原始字节、TextDecoder 状态和 parser 错误定位；先切换非流式结果（`/agent/runs/:id`）止损，再用 `TextDecoder({ stream: true })` 和事件缓冲修复，覆盖所有字节断点验证。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[MDN Using Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

2. SSE 在 sequence 508 后断开，重连从 500 重放，客户端重复追加文本和 Tool 卡片；用户取消后上游 LLM 仍生成 60 秒。请用 Last-Event-ID、resume cursor、重复率和上游日志定位；先隐藏重复并终止连接止损，再实现 sequence 去重续传和 POST /cancel 传播，断线回放验证内容一次且上游停止。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[MDN Using Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

知识映射：SSE v1 合同、UTF-8 chunk 流式解码、Resume cursor、sequence 去重和客户端取消传播。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. Fetch API 的 ReadableStream 如何工作？怎样处理 `Uint8Array`、TextDecoder 和中断？
   来源：《2026已发交个朋友全栈AI工程师》第 1 页。

2. SSE 与 WebSocket 有何区别？若用户在生成中中断对话，SSE 应怎样处理？
   来源：《2026阿里云前端技术专家-AI领域》第 2 页。

题目说明：直接覆盖 UTF-8 跨 chunk、SSE 双向 vs 单向、客户端取消、连接恢复；第 2 题包含原文追问"中断对话怎样处理"，对应今天的 `AbortController` + `POST /cancel` 组合。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见 [《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

参考出题方向（教师可选可换）：

- **局部机制**：`parseSseStream` 里 `TextDecoder({ stream: true })` 的 buffer 状态在什么时机清空？你的测试如何覆盖"最后一块字符不完整"的情况？
- **边界一致性**：DB 回放的 sequence 和 EventEmitter 事件的 sequence 是同一套编号吗？如果 DB 里最大 sequence=8 但 EventEmitter 后续发的第一个是 sequence=6，前端会看到什么？
- **线上事故**：如果 `RunAbortRegistry` 是进程内 Map，服务水平扩展到 2 个实例后用户 POST /cancel 打到实例 A、Loop 跑在实例 B，会发生什么？你打算怎么修？
- **工程权衡**：SSE vs WebSocket，为什么这个项目选 SSE？如果未来要做"用户可以打断 Agent 生成、改问题、Agent 继续"，还能坚持 SSE 吗？
- **架构演进**：Day 30 M3 门禁要求"任何一次 Agent Run 都必须能在 Postgres 里查到完整链路"。你今天的 DB 回放是否已经满足？还缺什么？

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 01 定义的 `AgentEvent` 判别联合和 reducer 今天升级为 `VersionedAgentEvent`，同时保持 reducer 逻辑不变（v1 事件仍能被处理）
- **承接**：Day 07-10 的 Prisma 表在 Day 13 加上了 `AgentRun/Diagnosis/ToolCall` 三张表，今天用于 DB 回放
- **承接**：Day 12 的 Agent Loop 今天接入 `AbortSignal`，把用户取消从 UI 一路传到 LLM/Tool 调用
- **对齐**：Day 15 LLM 流式响应会复用今天的 protocol 层（`sse-frame.ts` / `event-version.ts`）
- **对齐**：Day 30 M3 门禁的验收标准之一是"任何一次 Run 崩溃后重启前端还能看到完整过程"，今天的 DB 回放是这条门禁的实现基础
- **对齐**：Day 61 多 Agent 协同工作台需要"某个 Agent 卡住时管理员能远程 cancel"，`RunAbortRegistry` 是这个能力的雏形
