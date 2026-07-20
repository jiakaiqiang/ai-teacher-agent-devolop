# Day 18：Trace / 性能（v1 单点计时 → v2 traceId 贯穿 + 结构化日志 → v3 全链路 span + 指标分位 + 脱敏）

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
日期与时长：2026-07-31 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 17 服务端权威审批、已经把 Agent Loop / Tool / SSE / DB 全部串起来，第一次遇到"生成到一半停住但日志查不出卡在哪一层"的开发者

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
   Day 14：SSE 合同演进（AgentEventV1 + resume + 取消）
   Day 15：Agent 时间线（reducer + 派生状态 + 审计 UI）
   Day 16：证据与 XSS（净化管线 + 证据链）
   Day 17：Human-in-the-loop（服务端权威审批 + 租约 + 幂等消费）
   Day 18：Trace / 性能（traceId 全链路 + 指标分位 + 脱敏）  ← 今天在这里
   Day 19-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 18 在阶段一第 8 天**。前 7 天把功能一层层堆起来：Tool 能调、Loop 能循环、Run 能落库、SSE 能推、时间线能渲染、报告能安全展示、高危操作能审批。今天不加新功能，而是给整条链路装上**可观测性**：一个 `traceId` 从前端点击开始，贯穿 WebSocket、Agent Loop、Tool 调用、SSE 推送、DB 写入，让任何一次 Run 都能按 trace 重建完整时间线；同时测量真实的 TTFT / P95，并保证日志里不泄漏 API key、cookie、密码。

### 到 Day 17 结束时项目已具备的能力

- **后端**（Day 6-13, 17）：Nest + Prisma + Postgres，Z-Score 异常检测，服务端 FSM，Agent Loop，Tool Registry，持久化 + 幂等，服务端权威审批
- **前端**（Day 1, 14-16）：Vue3 时间线、SSE 客户端、reducer + 派生状态、Markdown 净化 + 证据链
- **缺失的一块**：出问题时**无法定位**。用户报"生成到一半停住"，运维打开日志看到的是一堆互不关联的行——前端有前端的日志、Agent 有 Agent 的日志、Tool 有 Tool 的日志、DB 有 DB 的日志，没有一根线把它们串起来。也没有任何地方记录"这次 Run 的首字延迟是多少、Tool 成功率多少、哪个 span 最慢"

### 今天要解决的 4 个问题

1. **问题 1：跨层日志无法关联**
   一次 Run 涉及 6 层（UI → WS → Agent Loop → Tool → SSE → DB）。每层各自 `console.log`，出事时运维要在 6 份日志里靠时间戳肉眼拼凑"哪条前端请求对应哪次 Tool 调用"。时间戳会因为时钟漂移对不齐，并发请求会交织在一起，根本拼不出来。**必须有一个 `traceId` 从入口生成，透传到每一层的每一条日志**。

2. **问题 2：没有真实性能数据**
   "Agent 响应慢"是主观感受。慢在哪？是 LLM 首字慢（TTFT 高）？还是某个 Tool 慢？还是 DB 写入慢？没有分层计时就只能猜。而且平均值会骗人——P50 正常但 P95 爆炸的情况（长尾）用平均值根本看不出来。**必须测量 TTFT、每个 span 的耗时、P50/P95/P99 分位数、Tool 成功率**。

3. **问题 3：长任务卡主线程**
   30KB 报告增量解析（Day 16）、大数组 reduce（Day 15）都可能产生 > 50ms 的长任务，阻塞主线程导致掉帧、点击无响应。**必须用 `PerformanceObserver` 监测 longtask，把超过阈值的任务上报**。

4. **问题 4：日志泄漏敏感信息**
   为了排查方便，开发时习惯 `logger.log('request', req.body)`——但 `req.body` 里可能有 API key、用户 cookie、密码。这些进了日志系统就等于泄漏（日志会被转发、归档、被更多人看到）。**必须有一层脱敏（redaction），在日志落地前把敏感字段替换成 `[REDACTED]`**。

---

## 1. 今天要交付的功能模块

在 `p1-monitor` 里交付一个跨前后端的 **`observability`** 关注点：后端 `apps/api/src/observability/` 提供 traceId 生成 / 透传（AsyncLocalStorage）、span 计时、结构化日志器、敏感字段脱敏；前端 `frontend/src/observability/` 提供 traceId 注入请求头、TTFT 测量、longtask 监测、指标分位聚合。目标是任何一次 Run 都能按 `traceId` 在结构化日志里重建完整的跨层时间线，并产出真实的 TTFT / P95 / Tool 成功率，且敏感字段泄漏为 0。

### 1.1 用户能看到什么

**场景**：运维工程师报告"srv-042 的诊断生成到一半就停住了"，SRE 拿着这次 Run 的 traceId 去查。

```
SRE 在日志系统里按 traceId 过滤：

trace=t-a1b2c3  span=ui.click            t=0ms      msg="用户点击诊断" runId=r-01
trace=t-a1b2c3  span=ws.connect          t=12ms     msg="WS 建立" 
trace=t-a1b2c3  span=agent.loop.start    t=45ms     msg="Agent Loop 启动" budget.steps=20
trace=t-a1b2c3  span=llm.first_token     t=1240ms   msg="首字到达" ttft_ms=1195   ← TTFT
trace=t-a1b2c3  span=tool.getMetrics     t=1580ms   msg="Tool 开始" args={"serverId":"srv-042"}
trace=t-a1b2c3  span=tool.getMetrics     t=3820ms   msg="Tool 完成" duration_ms=2240 ok=true
trace=t-a1b2c3  span=tool.getAlertDetail t=3850ms   msg="Tool 开始"
trace=t-a1b2c3  span=tool.getAlertDetail t=33851ms  msg="Tool 超时" duration_ms=30001 ok=false  ← 卡在这
trace=t-a1b2c3  span=agent.loop.end      t=33900ms  msg="Loop 终止" finish=tool_error

结论：卡在 getAlertDetail，30 秒超时。真实原因不是"生成停住"，
      而是第二个 Tool 打到了一个响应很慢的下游 API，触发了 Day 11 的超时保护。

同一份日志还能聚合出指标：
  TTFT:        p50=1195ms  p95=2400ms  p99=5100ms
  Tool 成功率:  getMetrics 99.2%   getAlertDetail 87.3%（今天恶化）
  longtask:    report 增量解析 max=48ms（未超 50ms 阈值）

脱敏验证：全链路日志里搜索 "sk-" / "cookie" / "password" → 0 命中
```

用户（运维）看到的是"诊断停住"，但 traceId 让 SRE 在 30 秒内定位到了确切的层和原因，而不是靠猜。

### 1.2 这个模块在项目里承担什么

- **输入**：一次用户操作（前端点击）产生的 `traceId`，随请求头 `X-Trace-Id` 透传；每一层在自己的边界打点（span 开始 / 结束 + 结构化字段）
- **输出**：结构化日志（每行一个 JSON，含 `traceId` / `span` / `durationMs` / 业务字段）；聚合后的指标（TTFT / P50-P99 / Tool 成功率 / longtask）；脱敏后的安全日志
- **对齐后续**：今天定义的 **traceId 传播规则**（`X-Trace-Id` 头 + AsyncLocalStorage）、**结构化日志字段规范**、**脱敏白名单**，是 Day 30 M3 门禁"任一 Run 可按 trace 重建"的验收基础，也是 Day 61-90 p2 多 Agent 工作台跨 Agent 追踪的地基

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 在 Agent Loop 里手动 `Date.now()` 计时，`console.log` 打印耗时 | 单文件散落的计时代码 | 基本计时、`performance.now()` vs `Date.now()` |
| **v1 痛点** | 计时代码侵入业务、跨层无法关联、并发日志交织、平均值骗人、日志泄漏 key |  |  |
| **v2** | v1 + **traceId 贯穿**（AsyncLocalStorage）+ **结构化日志器**（JSON 每行）+ **脱敏** | 抽出 `trace-context.ts` + `structured-logger.ts` + `redactor.ts` | AsyncLocalStorage 上下文透传、结构化日志、字段脱敏白名单 |
| **v2 痛点** | 只有后端有 trace，前端 TTFT 测不到；只打点不聚合，看不到 P95；longtask 未监测 |  |  |
| **v3** | v2 + **span 计时器** + **前端 traceId 注入 + TTFT + longtask** + **指标分位聚合** | 完整分层（后端 context/logger/redactor/span + 前端 trace/metrics/longtask） | span 树、分位数算法（P50/P95/P99）、`PerformanceObserver`、前后端 trace 打通 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：可观测性最容易写成"到处塞 `console.log`"的一团乱麻。如果不先立骨架，计时代码会侵入每个业务方法、traceId 会靠参数一层层手动传、脱敏会漏掉某个日志点。看完这棵树，下面章节再出现 `observability/trace/trace-context.ts` 时，你就知道它是"用 AsyncLocalStorage 存 traceId、让任意深度的函数都能取到当前 trace"的那一层，而不是又一个要手动传参的东西。

**今天要建立的完整目录树（v3 完整版，跨前后端）**：

```
apps/api/src/
├── observability/                              ← 【新增】后端可观测性
│   ├── trace/
│   │   ├── trace-context.ts                    ← AsyncLocalStorage 存 traceId/spanId
│   │   ├── trace-context.spec.ts               ← 上下文透传单元测试
│   │   └── trace.middleware.ts                 ← Express 中间件：读 X-Trace-Id 或生成
│   ├── logger/
│   │   ├── structured-logger.ts                ← 结构化日志器（JSON 每行 + 自动带 traceId）
│   │   └── structured-logger.spec.ts           ← 日志器单元测试
│   ├── redact/
│   │   ├── redactor.ts                         ← 敏感字段脱敏（纯函数）
│   │   └── redactor.spec.ts                     ← 脱敏单元测试（12 类敏感字段）
│   ├── span/
│   │   ├── span-timer.ts                       ← span 计时器（start/end + 自动日志）
│   │   └── span-timer.spec.ts                   ← 计时器单元测试
│   ├── metrics/
│   │   ├── percentile.ts                       ← 分位数算法（纯函数 P50/P95/P99）
│   │   └── percentile.spec.ts                   ← 分位数单元测试
│   ├── index.ts                                ← 桶文件
│   └── observability.module.ts                 ← NestJS 模块（全局）
├── agent/loop/agent-loop.engine.ts             ← 【Day 12 已有】改：用 span-timer 包裹
├── tools/tool-registry.service.ts              ← 【Day 11 已有】改：Tool 调用打 span
└── main.ts                                     ← 【已有】改：挂 trace.middleware

frontend/src/
├── observability/                              ← 【新增】前端可观测性
│   ├── trace/
│   │   ├── trace-id.ts                         ← 生成 traceId + 注入请求头
│   │   └── trace-id.spec.ts                     ← 单元测试
│   ├── metrics/
│   │   ├── ttft.ts                             ← 首字延迟测量（SSE 首事件时间戳）
│   │   ├── percentile.ts                       ← 分位聚合（与后端同款算法）
│   │   └── ttft.spec.ts                         ← 单元测试
│   └── longtask/
│       ├── longtask-observer.ts                ← PerformanceObserver 监测长任务
│       └── longtask-observer.spec.ts            ← 单元测试
└── agent/stream/useSseStream.ts                ← 【Day 14 已有】改：注入 traceId 头 + 记 TTFT
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `trace/trace-context.ts` | ✗（手动传 traceId 参数） | ✓ AsyncLocalStorage | ✓ 加 spanId 栈 |
| `trace/trace.middleware.ts` | ✗ | ✓ 读头或生成 | ✓ 同 v2 |
| `logger/structured-logger.ts` | ✗（`console.log`） | ✓ JSON 每行 + 自动 traceId | ✓ 同 v2 |
| `redact/redactor.ts` | ✗ | ✓ 白名单脱敏 | ✓ 同 v2 |
| `span/span-timer.ts` | ✗（`Date.now()` 散落） | ✗ | ✓ start/end + 日志 |
| `metrics/percentile.ts` | ✗ | ✗ | ✓ P50/P95/P99 |
| 前端 `trace/trace-id.ts` | ✗ | ✗ | ✓ 生成 + 注入头 |
| 前端 `metrics/ttft.ts` | ✗ | ✗ | ✓ SSE 首字计时 |
| 前端 `longtask/longtask-observer.ts` | ✗ | ✗ | ✓ PerformanceObserver |

**依赖方向（务必单向，反过来一次都不行）**：

```
main.ts
  └─► trace.middleware.ts ──► trace-context.ts (AsyncLocalStorage)

agent-loop.engine.ts / tool-registry.service.ts
  └─► span/span-timer.ts
            │
            ├─► trace/trace-context.ts   ← 取当前 traceId/spanId
            └─► logger/structured-logger.ts
                        │
                        └─► redact/redactor.ts   ← 落地前脱敏

metrics/percentile.ts        ← 纯函数，不 import 任何东西
redact/redactor.ts           ← 纯函数，不 import trace/logger

前端：
useSseStream.ts
  ├─► observability/trace/trace-id.ts     ← 注入 X-Trace-Id 头
  └─► observability/metrics/ttft.ts       ← 记录首事件时间戳
```

**红线**：
- `metrics/percentile.ts` 里出现 `import` 任何业务模块就是塌方——分位数算法是纯数学，必须能独立单测
- `redact/redactor.ts` 里出现 `import { StructuredLogger }` 是塌方——脱敏是纯函数（输入对象 → 输出脱敏对象），不能反过来依赖日志器
- 业务代码里出现 `console.log` 而不是 `logger.info` 就是绕过脱敏层——**任何日志都必须走 structured-logger**，否则脱敏形同虚设
- `agent-loop.engine.ts` 里出现 `req.headers['x-trace-id']` 是塌方——业务层不该知道 HTTP 头，traceId 必须从 `trace-context` 取

**动手前先问自己 3 个问题**：

1. traceId 为什么用 AsyncLocalStorage 而不是函数参数一层层传？—— 见 §5.4 知识点 1「上下文透传 vs 参数钻取」
2. 为什么必须看 P95 而不能只看平均值？—— 见 §5.4 知识点 4「分位数与长尾」
3. 脱敏为什么用白名单（默认脱敏）而不是黑名单（列举敏感词）？—— 见 §5.4 知识点 5「脱敏的默认拒绝策略」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认依赖（3 分钟）

按第 5.3 节的代码：

- 后端 `AsyncLocalStorage` 是 Node 内置（`node:async_hooks`），不用装
- 前端 `PerformanceObserver` 是浏览器内置 API，不用装
- 单测环境：前端 longtask 测试需要 mock `PerformanceObserver`，vitest 里手写 stub 即可
- 不新增运行时依赖

**边写边问自己**：

- `performance.now()` 和 `Date.now()` 计时有什么区别？（`performance.now()` 是单调时钟，不受系统时间调整影响，测耗时必须用它；`Date.now()` 会因为 NTP 校时突然跳变，测出负耗时）
- 为什么不直接上 OpenTelemetry SDK？（今天先手写最小可观测性理解原理；OTel 是生产级方案，但会引入大量抽象，学习阶段先理解 traceId 传播的本质）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，后端建 5 个子目录、前端建 3 个子目录：

```
apps/api/src/observability/{trace,logger,redact,span,metrics}/
frontend/src/observability/{trace,metrics,longtask}/
```

**边写边问自己**：

- 为什么 `redact/` 和 `logger/` 分开？（脱敏是纯函数、可独立测 12 类敏感字段；日志器是有副作用的 IO；分开才能各自演进）
- 为什么前后端各有一份 `percentile.ts`？（前端后端运行时不同，不能共享代码；但算法必须完全一致，靠单测保证两边行为相同——这是"契约测试"思路）

### 1.5.3 D-3：写纯函数层（redact + percentile）（5 分钟）

按第 5.3 节的代码：

- 写 `observability/redact/redactor.ts`（`redact(obj)` 纯函数）
- 写 `observability/redact/redactor.spec.ts`（12 类敏感字段用例）
- 写 `observability/metrics/percentile.ts`（`percentile(values, p)` 纯函数）
- 写 `observability/metrics/percentile.spec.ts`

**边写边问自己**：

- `redact` 遇到嵌套对象怎么办？（递归；但要防循环引用——见 §5.3 代码用 WeakSet）
- P95 在样本只有 3 个时怎么算？（线性插值 or 取最近秩；生产里样本少时分位数不可信，要标注样本量）

### 1.5.4 D-4：写 trace + logger + span 层（5 分钟）

按第 5.3 节的代码：

- 写 `observability/trace/trace-context.ts`（AsyncLocalStorage 封装）
- 写 `observability/trace/trace.middleware.ts`（读头或生成 traceId）
- 写 `observability/logger/structured-logger.ts`（JSON 每行 + 自动带 traceId + 落地前脱敏）
- 写 `observability/span/span-timer.ts`（start/end + 自动打 span 日志）

**边写边问自己**：

- `trace-context` 的 `run(traceId, fn)` 为什么要用回调形式？（AsyncLocalStorage.run 建立一个异步上下文作用域，作用域内所有 await 都能取到同一 traceId）
- span-timer 结束时如果业务抛异常，span 日志还会打吗？（必须打——用 try/finally；否则失败的 span 反而没记录，最需要排查的场景丢日志）

### 1.5.5 D-5：写前端观测 + 接入业务（5 分钟）

按第 5.3 节的代码：

- 写 `frontend/src/observability/trace/trace-id.ts`
- 写 `frontend/src/observability/metrics/ttft.ts`
- 写 `frontend/src/observability/longtask/longtask-observer.ts`
- 改 `agent-loop.engine.ts` / `tool-registry.service.ts`：用 span-timer 包裹
- 改 `useSseStream.ts`：注入 traceId 头 + 记 TTFT
- 改 `main.ts`：挂 trace.middleware

**边写边问自己**：

- 前端生成的 traceId 怎么传到后端？（放请求头 `X-Trace-Id`；WS 握手时放 query 或第一条消息）
- TTFT 从哪一刻算到哪一刻？（从发起请求到收到第一个 `text.delta` 事件；不是到连接建立，是到第一个有内容的字节）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"手动计时 → traceId 贯穿 → span+分位+脱敏"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `trace-context.ts` 和 `span-timer.ts` | 能口述"AsyncLocalStorage 如何让深层函数取到 traceId"、"span 如何自动关联" |
| C：读深挖 | 35 min | §6.5 前端底子补弱（`Day18深挖-前端底子补弱.html`） | 能回答"PerformanceObserver 的 longtask 从哪来"、"事件循环与长任务的关系" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，前后端 build 通过 |
| E：写核心测试 | 20 min | §7.6 spec 文件 | `pnpm test observability` 全绿 |
| F-1：反证 1 | 5 min | §7.7 手动去掉 AsyncLocalStorage，改用参数传 traceId | 观察"深层 Tool 调用丢失 traceId"，验证上下文透传的价值 |
| F-2：反证 2 | 5 min | §7.8 手动往日志塞一个含 apiKey 的对象，跳过脱敏 | 观察 key 明文进日志，验证脱敏层的必要性 |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day18` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（手动计时 + console.log）

### 3.1 v1 要实现什么

Day 12 的 Agent Loop 目前没有任何计时。v1 只做一件事：在 Loop 和 Tool 调用前后手动 `performance.now()`，把耗时 `console.log` 出来，先能看到"每一步花了多久"。

**目标**：
- Agent Loop 每个 step 前后计时
- Tool 调用前后计时
- 打印 TTFT（首字延迟）

**不做**：
- 不透传 traceId（并发请求日志会交织）
- 不结构化（纯文本 log，无法机器聚合）
- 不脱敏（args 可能含敏感字段）
- 不聚合分位数

### 3.2 v1 目录结构

```
apps/api/src/agent/loop/
└── agent-loop.engine.ts     ← 改：散落的 performance.now() 计时
```

### 3.3 v1 完整代码

**apps/api/src/agent/loop/agent-loop.engine.ts（v1 计时片段）**

```typescript
// Day 12 已有的 run 方法，v1 加了散落的计时
async run(config: AgentRunConfig): Promise<AgentTrajectory> {
  const loopStart = performance.now()
  let firstTokenAt: number | null = null

  const trajectory = await this.executeLoop(config, {
    onFirstToken: () => {
      firstTokenAt = performance.now()
      console.log(`TTFT: ${(firstTokenAt - loopStart).toFixed(0)}ms`)
    },
    onToolStart: (toolName) => {
      console.log(`Tool ${toolName} start at ${(performance.now() - loopStart).toFixed(0)}ms`)
    },
    onToolEnd: (toolName, ok) => {
      console.log(`Tool ${toolName} end ok=${ok} at ${(performance.now() - loopStart).toFixed(0)}ms`)
    },
  })

  const loopEnd = performance.now()
  console.log(`Loop total: ${(loopEnd - loopStart).toFixed(0)}ms, steps=${trajectory.steps.length}`)

  return trajectory
}
```

**输出示例（v1）**：

```
TTFT: 1195ms
Tool getMetrics start at 1340ms
Tool getMetrics end ok=true at 3580ms
Tool getAlertDetail start at 3610ms
Tool getAlertDetail end ok=false at 33611ms
Loop total: 33700ms, steps=4
```

### 3.4 v1 暴露的痛点

**痛点 1：并发请求日志交织**

两个用户同时触发诊断，两次 Loop 的日志会交替打印：

```
TTFT: 1195ms              ← 用户 A 的
TTFT: 980ms               ← 用户 B 的
Tool getMetrics start...  ← 是 A 还是 B 的？无法区分
Tool getMetrics start...
```

没有 traceId，根本分不清哪条日志属于哪次 Run。生产环境每秒几十个并发，日志完全是一锅粥。

**痛点 2：非结构化，无法机器聚合**

`console.log('TTFT: 1195ms')` 是给人看的字符串。要统计"过去 1 小时 TTFT 的 P95"，得写正则去解析这行文本，脆弱且低效。生产可观测性要求**结构化**（每行一个 JSON），日志系统才能按字段聚合。

**痛点 3：计时代码侵入业务**

`performance.now()` 和 `console.log` 散落在业务方法里，`run` 方法一半是业务一半是计时。加一个新的计时点就要改业务代码，计时逻辑无法复用。

**痛点 4：日志泄漏敏感字段**

如果 `console.log('Tool args', args)`，而 `args` 里有 `{ apiKey: 'sk-xxx' }`，key 就明文进了日志。开发时为了排查方便经常这么干，然后忘了删，上线就泄漏。

---

## 4. v2：traceId 贯穿全链路 + 结构化日志

### 4.1 v2 要实现什么

用户视角：一次 Run 从前端点击到后端 Tool 执行，所有日志都带同一个 `traceId`；日志是每行一个 JSON，可以直接 `grep traceId | jq` 重建整条链路的时间线。

**目标**：
- 前端生成 `traceId`，通过 `X-Trace-Id` 头传给后端
- 后端 `trace.middleware` 用 `AsyncLocalStorage` 建立 traceId 上下文
- `structured-logger` 每行输出 JSON，自动带上当前上下文的 traceId
- Tool 层、Loop 层深处的日志无需手动传 traceId，从上下文自动取

**依然不做**：
- 不脱敏（args 直接进日志）
- 不聚合分位数（只是每次打点，没有 P95 统计）

### 4.2 v2 目录结构

```
apps/api/src/observability/
├── trace/
│   ├── trace-context.ts        ← 新增：AsyncLocalStorage 封装
│   └── trace.middleware.ts     ← 新增：读头/生成 traceId
└── logger/
    └── structured-logger.ts    ← 新增：JSON 每行 + 自动带 traceId

frontend/src/observability/
└── trace/
    └── trace-id.ts             ← 新增：生成 + 存储 traceId
```

### 4.3 v2 完整代码

**apps/api/src/observability/trace/trace-context.ts（v2 全文）**

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TraceStore {
  traceId: string
  spanStack: string[]   // 当前 span 名称栈，用于嵌套 span 的父子关系
}

const storage = new AsyncLocalStorage<TraceStore>()

/**
 * 在给定 traceId 的上下文里运行一段异步逻辑。
 * 作用域内所有 await 链上的代码都能通过 getTraceId() 取到同一个 traceId，
 * 无需一层层手动传参。
 */
export function runWithTrace<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ traceId, spanStack: [] }, fn)
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId
}

export function getSpanStack(): string[] {
  return storage.getStore()?.spanStack ?? []
}

export function pushSpan(name: string): void {
  storage.getStore()?.spanStack.push(name)
}

export function popSpan(): void {
  storage.getStore()?.spanStack.pop()
}
```

**apps/api/src/observability/trace/trace.middleware.ts（v2 全文）**

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { runWithTrace } from './trace-context'

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // 优先用上游传来的 traceId（保证跨服务贯穿），没有才生成
    const incoming = req.header('X-Trace-Id')
    const traceId = incoming && isValidTraceId(incoming) ? incoming : randomUUID()

    // 回写响应头，前端能拿到最终生效的 traceId
    res.setHeader('X-Trace-Id', traceId)

    // 建立异步上下文：next() 之后所有 handler / service 都在这个作用域内
    runWithTrace(traceId, async () => {
      next()
    })
  }
}

function isValidTraceId(id: string): boolean {
  // 只接受 UUID 或 32 位 hex，防止上游注入超长字符串污染日志
  return /^[0-9a-fA-F-]{8,36}$/.test(id)
}
```

**apps/api/src/observability/logger/structured-logger.ts（v2 全文）**

```typescript
import { Injectable } from '@nestjs/common'
import { getTraceId, getSpanStack } from '../trace/trace-context'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

@Injectable()
export class StructuredLogger {
  /**
   * 每行输出一个 JSON，自动附加当前上下文的 traceId 和 span 栈。
   * 生产里换成写文件 / 发到日志系统，格式不变。
   */
  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      traceId: getTraceId() ?? 'no-trace',
      span: getSpanStack().join('>') || undefined,
      ...fields,   // v2 还没脱敏，v3 会在这里插入 redact
    }
    // 每行一个 JSON，机器可解析
    process.stdout.write(JSON.stringify(entry) + '\n')
  }

  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields)
  }

  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields)
  }

  error(message: string, fields?: LogFields): void {
    this.log('error', message, fields)
  }
}
```

**frontend/src/observability/trace/trace-id.ts（v2 全文）**

```typescript
/**
 * 前端为一次 Run 生成 traceId，并在请求头/WS 里带上。
 * 存 sessionStorage，保证同一次会话的刷新前后 traceId 一致，
 * 方便前后端日志按同一 traceId 关联。
 */
const KEY_PREFIX = 'trace:'

export function generateTraceId(): string {
  // 浏览器原生 crypto.randomUUID
  return crypto.randomUUID()
}

export function getOrCreateTraceId(runId: string): string {
  const key = `${KEY_PREFIX}${runId}`
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const id = generateTraceId()
  sessionStorage.setItem(key, id)
  return id
}

export function traceHeaders(traceId: string): Record<string, string> {
  return { 'X-Trace-Id': traceId }
}
```

**接入点：useSseStream.ts（v2 增量）**

```typescript
// frontend/src/agent/stream/useSseStream.ts（Day 14 已有，v2 加 traceId 头）
import { getOrCreateTraceId, traceHeaders } from '@/observability/trace/trace-id'

export function useSseStream(runId: string) {
  const traceId = getOrCreateTraceId(runId)
  // fetch-based SSE（Day 14 的实现）加上 trace 头
  const res = fetch(`/agent/runs/${runId}/stream`, {
    headers: { ...traceHeaders(traceId), Accept: 'text/event-stream' },
  })
  // ... Day 14 已有的流式解析
}
```

### 4.4 v2 暴露的痛点

**痛点 1：计时还是手写散落**

v2 解决了 traceId 贯穿，但 Tool 和 Loop 里的计时还是手动 `performance.now()` + `logger.info`。每个 span 的开始/结束要手写两行，忘写一行就丢一半数据。需要一个 `span-timer` 把"计时 + 打点 + 异常也打点"封装成一个原语。

**痛点 2：日志还在泄漏敏感字段**

`logger.info('tool args', { args })` 里 `args` 可能含 `{ token: 'xxx', password: 'yyy' }`。v2 的 logger 把 fields 直接展开进 JSON，没有任何过滤。需要在 logger 落地前插入一层脱敏。

**痛点 3：只有打点，没有分位数**

每次 Run 打一条 `TTFT: 1195ms` 日志，但要回答"最近 100 个 Run 的 TTFT P95 是多少"，还得把日志捞出来手动算。需要一个进程内的 `metrics-collector` 累积样本，随时能算 P50/P95/P99。

**痛点 4：慢 Tool 无法定位是哪一步慢**

v1/v2 只知道"Loop 总共 33 秒"，但不知道是 LLM 慢还是某个 Tool 慢还是网络慢。需要 span 的父子嵌套，把 33 秒拆解成 `llm.call=1.2s + tool.getMetrics=2.2s + tool.getAlertDetail=30s`（一眼看出 getAlertDetail 超时了）。

---

## 5. v3：span 嵌套计时 + 脱敏管线 + 分位数聚合 + 长任务观测（终态）

### 5.1 v3 要实现什么

用户视角：
1. 任一 Run 都能按 traceId 从前端到 DB 重建完整时间线，每一步耗时清晰（span 嵌套）
2. 记录真实的 TTFT / P50 / P95 / P99 / Tool 成功率，随时可查
3. 日志敏感字段（token / password / apiKey / cookie）泄漏数为 0（脱敏管线兜底）
4. 前端长任务（> 50ms 的解析/渲染）被 `PerformanceObserver` 捕获并上报
5. 慢 Tool 能通过 span 分解一眼定位（`tool.getAlertDetail=30s` 而不是"Loop 总共慢"）

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/observability/
├── trace/
│   ├── trace-context.ts          ← v2 已有
│   └── trace.middleware.ts       ← v2 已有
├── span/
│   ├── span-timer.ts             ← 新增：计时 + 嵌套 + 自动打点
│   └── span-timer.spec.ts        ← 新增
├── logger/
│   └── structured-logger.ts      ← v2 已有，v3 接入 redact
├── redact/
│   ├── redact.ts                 ← 新增：敏感字段白名单脱敏（纯函数）
│   └── redact.spec.ts            ← 新增
├── metrics/
│   ├── metrics-collector.ts      ← 新增：样本累积 + 分位数
│   └── metrics-collector.spec.ts ← 新增
├── observability.module.ts       ← 新增
└── index.ts                      ← 新增桶文件

frontend/src/observability/
├── trace/trace-id.ts             ← v2 已有
└── longtask/
    └── long-task-observer.ts     ← 新增：PerformanceObserver 捕获长任务
```

### 5.3 v3 完整代码

#### 5.3.1 redact 层：redact.ts（纯函数脱敏）

```typescript
// apps/api/src/observability/redact/redact.ts

/**
 * 敏感字段名黑名单（大小写不敏感、匹配子串）。
 * 默认拒绝：任何 key 命中黑名单就把值替换成 '[REDACTED]'。
 * 纯函数：深拷贝输入，不改原对象，可 100% 单测。
 */
const SENSITIVE_PATTERNS = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'sessionid',
  'session_id',
  'privatekey',
  'private_key',
  'creditcard',
  'ssn',
]

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 8   // 防止环 / 超深对象拖垮日志

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p))
}

export function redact(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]'
  if (input === null || input === undefined) return input
  if (typeof input !== 'object') return input

  if (Array.isArray(input)) {
    return input.map((item) => redact(item, depth + 1))
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED
    } else {
      out[key] = redact(value, depth + 1)
    }
  }
  return out
}
```

#### 5.3.2 redact 层：redact.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { redact } from './redact'

describe('redact', () => {
  it('顶层敏感字段被替换', () => {
    const out = redact({ user: 'alice', password: 'p@ss', token: 'abc' })
    expect(out).toEqual({ user: 'alice', password: '[REDACTED]', token: '[REDACTED]' })
  })

  it('嵌套对象里的敏感字段也被替换', () => {
    const out = redact({ req: { headers: { authorization: 'Bearer x', accept: 'json' } } })
    expect(out).toEqual({ req: { headers: { authorization: '[REDACTED]', accept: 'json' } } })
  })

  it('数组里的对象逐个脱敏', () => {
    const out = redact([{ apiKey: 'k1' }, { name: 'ok' }])
    expect(out).toEqual([{ apiKey: '[REDACTED]' }, { name: 'ok' }])
  })

  it('大小写不敏感 + 子串匹配', () => {
    const out = redact({ X_API_KEY: 'v', userToken: 't' })
    expect(out).toEqual({ X_API_KEY: '[REDACTED]', userToken: '[REDACTED]' })
  })

  it('不修改原对象（纯函数）', () => {
    const src = { password: 'p' }
    redact(src)
    expect(src.password).toBe('p')
  })

  it('超深对象在 MAX_DEPTH 处截断', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 12; i++) deep = { nested: deep }
    const out = JSON.stringify(redact(deep))
    expect(out).toContain('[MAX_DEPTH]')
  })
})
```

#### 5.3.3 span 层：span-timer.ts（嵌套计时）

```typescript
// apps/api/src/observability/span/span-timer.ts
import { pushSpan, popSpan, getTraceId } from '../trace/trace-context'
import { StructuredLogger } from '../logger/structured-logger'
import { MetricsCollector } from '../metrics/metrics-collector'

/**
 * 把"计时 + 成功打点 + 异常也打点 + span 出栈"封装成一个原语。
 * 用法：await withSpan('tool.getMetrics', logger, metrics, async () => { ... })
 * 无论回调成功还是抛错，都会记录 durationMs 并弹出 span；异常继续向上抛。
 */
export async function withSpan<T>(
  name: string,
  logger: StructuredLogger,
  metrics: MetricsCollector,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now()
  pushSpan(name)
  try {
    const result = await fn()
    const durationMs = Math.round(performance.now() - start)
    logger.info('span.end', { span: name, durationMs, ok: true })
    metrics.record(name, durationMs, true)
    return result
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    // 关键：异常路径也要打点，否则慢+失败的 span 会从统计里消失
    logger.error('span.end', { span: name, durationMs, ok: false, error: message })
    metrics.record(name, durationMs, false)
    throw err
  } finally {
    popSpan()
  }
}
```

#### 5.3.4 span 层：span-timer.spec.ts

```typescript
import { describe, it, expect, vi } from 'vitest'
import { withSpan } from './span-timer'
import { runWithTrace } from '../trace/trace-context'

function makeStubs() {
  const logs: unknown[] = []
  const samples: Array<{ name: string; ms: number; ok: boolean }> = []
  const logger = {
    info: (m: string, f?: Record<string, unknown>) => logs.push({ m, ...f }),
    error: (m: string, f?: Record<string, unknown>) => logs.push({ m, ...f }),
  } as never
  const metrics = {
    record: (name: string, ms: number, ok: boolean) => samples.push({ name, ms, ok }),
  } as never
  return { logs, samples, logger, metrics }
}

describe('withSpan', () => {
  it('成功路径记录 ok:true 并返回结果', async () => {
    const { samples, logger, metrics } = makeStubs()
    const out = await runWithTrace('t1', () =>
      withSpan('tool.x', logger, metrics, async () => 42),
    )
    expect(out).toBe(42)
    expect(samples[0]).toMatchObject({ name: 'tool.x', ok: true })
  })

  it('异常路径记录 ok:false 并继续抛错', async () => {
    const { samples, logger, metrics } = makeStubs()
    await expect(
      runWithTrace('t1', () =>
        withSpan('tool.y', logger, metrics, async () => {
          throw new Error('boom')
        }),
      ),
    ).rejects.toThrow('boom')
    expect(samples[0]).toMatchObject({ name: 'tool.y', ok: false })
  })
})
```

#### 5.3.5 metrics 层：metrics-collector.ts（分位数聚合）

```typescript
// apps/api/src/observability/metrics/metrics-collector.ts
import { Injectable } from '@nestjs/common'

interface SpanStats {
  count: number
  okCount: number
  samples: number[]   // 环形缓冲：只保留最近 N 条，防内存无限增长
}

const MAX_SAMPLES = 1000

@Injectable()
export class MetricsCollector {
  private readonly stats = new Map<string, SpanStats>()

  record(name: string, durationMs: number, ok: boolean): void {
    let s = this.stats.get(name)
    if (!s) {
      s = { count: 0, okCount: 0, samples: [] }
      this.stats.set(name, s)
    }
    s.count += 1
    if (ok) s.okCount += 1
    s.samples.push(durationMs)
    // 环形：超过上限丢最旧的，保证内存有界
    if (s.samples.length > MAX_SAMPLES) s.samples.shift()
  }

  /**
   * 计算某个 span 的分位数。分位数用"最近邻插值"简化实现：
   * 排序后取 index = ceil(p * n) - 1。
   */
  percentile(name: string, p: number): number | null {
    const s = this.stats.get(name)
    if (!s || s.samples.length === 0) return null
    const sorted = [...s.samples].sort((a, b) => a - b)
    const idx = Math.max(0, Math.ceil(p * sorted.length) - 1)
    return sorted[idx]
  }

  successRate(name: string): number | null {
    const s = this.stats.get(name)
    if (!s || s.count === 0) return null
    return s.okCount / s.count
  }

  snapshot(): Record<string, { p50: number | null; p95: number | null; p99: number | null; successRate: number | null; count: number }> {
    const out: Record<string, ReturnType<MetricsCollector['snapshotOne']>> = {}
    for (const name of this.stats.keys()) {
      out[name] = this.snapshotOne(name)
    }
    return out
  }

  private snapshotOne(name: string) {
    return {
      p50: this.percentile(name, 0.5),
      p95: this.percentile(name, 0.95),
      p99: this.percentile(name, 0.99),
      successRate: this.successRate(name),
      count: this.stats.get(name)?.count ?? 0,
    }
  }
}
```

#### 5.3.6 metrics 层：metrics-collector.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { MetricsCollector } from './metrics-collector'

describe('MetricsCollector', () => {
  it('P50/P95 计算正确', () => {
    const m = new MetricsCollector()
    for (let i = 1; i <= 100; i++) m.record('tool.x', i, true)
    expect(m.percentile('tool.x', 0.5)).toBe(50)
    expect(m.percentile('tool.x', 0.95)).toBe(95)
    expect(m.percentile('tool.x', 0.99)).toBe(99)
  })

  it('成功率统计正确', () => {
    const m = new MetricsCollector()
    m.record('tool.y', 10, true)
    m.record('tool.y', 10, true)
    m.record('tool.y', 10, false)
    expect(m.successRate('tool.y')).toBeCloseTo(2 / 3)
  })

  it('无样本返回 null', () => {
    const m = new MetricsCollector()
    expect(m.percentile('none', 0.95)).toBeNull()
    expect(m.successRate('none')).toBeNull()
  })

  it('环形缓冲保证内存有界（最多 1000 条）', () => {
    const m = new MetricsCollector()
    for (let i = 0; i < 2000; i++) m.record('tool.z', i, true)
    // 只保留最近 1000 条 [1000..1999]，P50 应该在 1500 附近
    const p50 = m.percentile('tool.z', 0.5)!
    expect(p50).toBeGreaterThanOrEqual(1400)
    expect(p50).toBeLessThanOrEqual(1600)
  })
})
```

#### 5.3.7 logger v3 增量：接入 redact

```typescript
// apps/api/src/observability/logger/structured-logger.ts（v3 改动点）
import { redact } from '../redact/redact'

log(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    traceId: getTraceId() ?? 'no-trace',
    span: getSpanStack().join('>') || undefined,
    // v3：落地前统一脱敏，任何 fields 都过一遍 redact
    ...(redact(fields) as LogFields),
  }
  process.stdout.write(JSON.stringify(entry) + '\n')
}
```

#### 5.3.8 前端长任务观测：long-task-observer.ts

```typescript
// frontend/src/observability/longtask/long-task-observer.ts

/**
 * 用 PerformanceObserver 捕获 > 50ms 的长任务（阻塞主线程 = 掉帧）。
 * 长任务通常来自：大 Markdown 解析、大列表渲染、同步 JSON.parse。
 * 捕获后上报给后端（带 traceId），配合后端 span 一起看"哪一步卡了前端"。
 */
export interface LongTaskReport {
  traceId: string
  durationMs: number
  startTime: number
  attribution: string
}

export function observeLongTasks(
  traceId: string,
  onReport: (report: LongTaskReport) => void,
): () => void {
  if (typeof PerformanceObserver === 'undefined') {
    return () => {}   // 环境不支持（如 SSR / 老浏览器）时优雅降级
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      onReport({
        traceId,
        durationMs: Math.round(entry.duration),
        startTime: Math.round(entry.startTime),
        attribution: (entry as PerformanceEntry & { name: string }).name ?? 'unknown',
      })
    }
  })

  try {
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    return () => {}   // 某些浏览器不支持 longtask entryType
  }

  return () => observer.disconnect()
}
```

#### 5.3.9 接入点：agent-loop.engine.ts 用 withSpan 包裹

```typescript
// apps/api/src/agent/loop/agent-loop.engine.ts（v3 改动点）
import { withSpan } from '../../observability/span/span-timer'

async run(config: AgentRunConfig): Promise<AgentTrajectory> {
  return withSpan('agent.run', this.logger, this.metrics, async () => {
    // 每次 LLM 调用是一个子 span
    const llmResult = await withSpan('llm.call', this.logger, this.metrics,
      () => this.provider.chat(messages))

    // 每次 Tool 调用是一个子 span（span 名带工具名，方便定位慢 Tool）
    const toolResult = await withSpan(`tool.${toolName}`, this.logger, this.metrics,
      () => this.toolRegistry.execute(toolName, args))

    let current: AgentTrajectory = { runId: config.runId, steps: [], finishReason: 'running' }
    while (!this.shouldStop(current)) {
      const step = await this.executeStep(current, config)
      current = { ...current, steps: [...current.steps, step] }
    }
    return { ...current, finishReason: current.finishReason === 'running' ? 'completed' : current.finishReason }
  })
}
```

### 5.4 v3 用到的知识点

#### 知识点 1：分布式追踪与 traceId 传播

- **解决的问题**：一次 Run 跨越前端 / WS / HTTP / Agent Loop / Tool / DB 六层，出问题时日志散在各处无法关联
- **运行机制**：入口生成一个全局唯一 traceId，通过请求头（`X-Trace-Id`）跨进程传播；进程内用 `AsyncLocalStorage` 在 await 链上隐式携带，无需手动传参
- **项目落点**：`trace.middleware.ts` 读头/生成、`trace-context.ts` 的 `runWithTrace`、前端 `trace-id.ts`
- **生产误区**：不校验上游 traceId 就直接用（攻击者传超长字符串污染日志/撑爆索引）；用请求级变量而非 `AsyncLocalStorage`（深层 service 拿不到）；每层各自生成新 traceId（链路断裂）
- **验证方法**：抽 100 个 Run，`grep <traceId> app.log | jq` 能重建完整时间线，无断点

#### 知识点 2：`AsyncLocalStorage` 的隐式上下文传播

- **解决的问题**：traceId 要在几十层调用深处可用，逐层加参数会污染所有函数签名
- **运行机制**：Node 的 `AsyncLocalStorage` 基于 `async_hooks`，在 `run(store, fn)` 作用域内的所有异步操作（Promise / setTimeout / await）都能通过 `getStore()` 拿到同一个 store
- **项目落点**：`trace-context.ts`，`runWithTrace` 包住 `next()`，之后所有 handler 都在作用域内
- **生产误区**：在 `run()` 外面调 `getStore()` 返回 undefined（middleware 顺序错了）；把 store 当成可变全局态到处写（应该只读 traceId，span 栈用 push/pop 配对）；忘记 `AsyncLocalStorage` 有性能开销（高频路径慎用，但 traceId 场景可接受）
- **验证方法**：单测里 `runWithTrace('t1', async () => { await sleep(10); expect(getTraceId()).toBe('t1') })` 验证 await 后仍能取到

#### 知识点 3：结构化日志（JSON per line）

- **解决的问题**：纯文本日志（`console.log('tool done in', ms, 'ms')`）无法机器解析、无法按字段过滤聚合
- **运行机制**：每行输出一个 JSON 对象，字段固定（ts/level/msg/traceId/span/...），下游用 `jq` / Loki / ELK 直接查询聚合
- **项目落点**：`structured-logger.ts`，`process.stdout.write(JSON.stringify(entry) + '\n')`
- **生产误区**：JSON 里塞多行字符串（破坏 per-line 解析）；字段名不统一（`traceId` vs `trace_id` vs `tid` 混用导致查不全）；日志级别不分（全 info，线上无法降噪）
- **验证方法**：`cat app.log | jq -c 'select(.level=="error")'` 能筛出所有错误且每行合法 JSON

#### 知识点 4：TTFT / P50 / P95 / P99 分位数

- **解决的问题**：平均值掩盖长尾（P50 正常但 P95 恶化意味着一部分用户体验极差），必须看分位数
- **运行机制**：累积样本数组，排序后按 `ceil(p*n)-1` 取分位点；用环形缓冲（保留最近 N 条）保证内存有界
- **项目落点**：`metrics-collector.ts` 的 `percentile` / `snapshot`
- **生产误区**：只记平均值（长尾被平均掉）；样本无上限（内存泄漏）；用固定桶直方图但桶设计不合理（分辨率不够）；P99 样本太少不可信（< 100 个样本的 P99 是噪声）
- **验证方法**：`metrics-collector.spec.ts` 灌 1-100 的样本，断言 P50=50 / P95=95 / P99=99

#### 知识点 5：敏感字段脱敏（默认拒绝白名单反转）

- **解决的问题**：日志里意外记录 token / password / cookie，是最常见的合规事故（日志系统权限往往比数据库宽）
- **运行机制**：在日志落地前统一过一层 `redact`，递归遍历对象，key 命中敏感黑名单就替换成 `[REDACTED]`；纯函数深拷贝不改原对象
- **项目落点**：`redact.ts`，`structured-logger.ts` 在 `...redact(fields)` 处接入
- **生产误区**：只脱敏顶层字段（嵌套的 `req.headers.authorization` 漏掉）；用精确匹配而非子串（`X_API_KEY` 漏掉）；脱敏放在业务代码里逐处调用（一定会漏，必须收口到 logger）；脱敏改了原对象导致业务拿到 `[REDACTED]`
- **验证方法**：`redact.spec.ts` 覆盖顶层/嵌套/数组/大小写/纯函数；集成测试跑一次 Run 后 `grep -iE 'token|password' app.log` 应该只匹配到 `[REDACTED]`

#### 知识点 6：长任务（Long Task）与主线程阻塞

- **解决的问题**：前端 > 50ms 的同步任务会阻塞主线程导致掉帧/卡顿，但用户只报"卡"，开发者不知道卡在哪
- **运行机制**：`PerformanceObserver` 订阅 `longtask` entryType，浏览器自动上报超过 50ms 的任务；捕获后带 traceId 上报，和后端 span 拼成完整链路
- **项目落点**：`long-task-observer.ts`，在 `ReportView` 挂载时启动
- **生产误区**：不做环境降级（老浏览器 / SSR 没有 `PerformanceObserver` 直接崩）；捕获后同步上报（上报本身又造成长任务）；只看后端 span 忽略前端（30KB Markdown 解析卡在前端，后端 span 全绿）
- **验证方法**：故意在渲染里加 `for` 循环占 100ms，observer 应捕获一条 durationMs≈100 的 longtask

### 5.5 边写边问自己

- `AsyncLocalStorage` 和 React 的 Context 有什么本质区别？（前者是运行时的异步调用链传播，后者是组件树的静态传播）
- 为什么 `withSpan` 的异常路径也要 `metrics.record`？（慢且失败的 span 最需要观测，漏掉会让 P95 虚低）
- 脱敏为什么必须收口到 logger 而不是业务层？（业务层逐处调用一定会漏，收口到唯一出口才能保证 0 泄漏）
- P99 需要多少样本才可信？（至少 100 个，否则 P99 就是单个噪声样本）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 单点 `console.log` 打点，各层各记各的 | traceId 贯穿全链路 + 结构化 JSON 日志 | span 嵌套计时 + 分位数聚合 + 脱敏 + 长任务观测 |
| **事件类型 / 数据模型** | 无结构，纯文本字符串 | `{ ts, level, msg, traceId }` | `{ ts, level, msg, traceId, span, ...redacted }` + SpanStats |
| **状态存储** | 无（打到 stdout 就丢） | 无（仍是 stdout，但可 grep traceId） | 内存 MetricsCollector（环形缓冲，有界） |
| **归约逻辑** | 无 | traceId 传播 | span push/pop 配对 + 分位数排序取点 + redact 递归 |
| **可测试** | 无法测（副作用打印） | 弱（traceId 传播可测） | 强（redact / span / metrics 全纯函数或可注入 stub） |
| **架构层次** | 散落各处 | trace + logger 两层 | trace / span / logger / redact / metrics / longtask 六层收口 |
| **换观测后端代价** | 全量改 console.log | 改 logger 输出格式一处 | 改 logger 输出 + metrics snapshot 导出一处 |
| **编译期抓遗漏** | 无 | 弱 | traceId 必经 `runWithTrace`、脱敏必经 logger 收口 |
| **对齐后续 Day** | 无 | Day 19-20 RAG 检索耗时观测 | Day 30 M3 门禁"任一 Run 可按 trace 重建"、Day 61+ 多 Agent 链路 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的深挖文档：`output/Day18深挖-前端底子补弱.html`

深挖主题（对应今天代码里的关键知识点，每个展开 8 子节：场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法）：

1. **深挖 1：`AsyncLocalStorage` 与异步上下文传播** —— 从今天项目里的 `trace-context.ts` 讲起
   - 为什么 `await` 之后还能拿到同一个 traceId？`async_hooks` 到底 hook 了什么？
   - 对比浏览器端为什么没有等价物（前端 traceId 只能显式传或存闭包）

2. **深挖 2：`PerformanceObserver` 与长任务** —— 从今天项目里的 `long-task-observer.ts` 讲起
   - `longtask` / `event` / `paint` 几种 entryType 的区别
   - 50ms 阈值从哪来（RAIL 模型），主线程阻塞如何导致掉帧

3. **深挖 3：分位数为什么比平均值重要** —— 从今天项目里的 `metrics-collector.ts` 讲起
   - P50/P95/P99 的统计含义，长尾如何被平均值掩盖
   - 前端场景：TTFB / FCP / LCP / INP 的分位数监控

深挖 HTML 只讲原理，不放动手脚手架（脚手架在 §1.5）。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按 §5.3 的 spec 文件，在项目里写下并跑通：

- `observability/redact/redact.spec.ts`（6 个用例：顶层/嵌套/数组/大小写/纯函数/超深）
- `observability/span/span-timer.spec.ts`（2 个用例：成功路径/异常路径都打点）
- `observability/metrics/metrics-collector.spec.ts`（4 个用例：分位数/成功率/空样本/环形缓冲）

```bash
pnpm --filter api test observability
```

期望：12 个用例全绿。

### 7.7 F-1：反证实验 1（5 分钟）—— 移除 redact 收口

手动把 `structured-logger.ts` 里的 `...redact(fields)` 改回 `...fields`，然后跑一次带 `authorization` 头的 Run：

```bash
pnpm --filter api test:e2e --grep "trace" 
grep -iE 'bearer|password|token' app.log
```

**观察**：日志里出现明文 `authorization: Bearer xxx`。这验证了"脱敏必须收口到 logger 唯一出口"——只要有一处日志不过 redact，就会泄漏。改回来。

### 7.8 F-2：反证实验 2（5 分钟）—— 移除 span 异常打点

手动把 `withSpan` 的 `catch` 块里的 `metrics.record(name, durationMs, false)` 删掉，然后制造一个慢且失败的 Tool（sleep 5s 后 throw）：

```bash
pnpm --filter api test observability
```

**观察**：`metrics.snapshot()` 里这个慢 Tool 的 P95 明显偏低——因为最慢的那些失败样本从统计里消失了。这验证了"异常路径必须打点，否则 P95 虚低误导容量规划"。改回来。

### 7.9 F-3：验证 + 提交（10 分钟）

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter api test
pnpm --filter api build
```

四件套全绿后提交：

```
feat(observability): traceId 全链路 + span 计时 + 分位数 + 脱敏 + 长任务观测

- trace: AsyncLocalStorage 传播 traceId，middleware 读头/生成
- span: withSpan 嵌套计时，成功/异常都打点
- metrics: MetricsCollector 环形缓冲 + P50/P95/P99 + 成功率
- redact: 敏感字段默认拒绝白名单，收口到 logger
- longtask: 前端 PerformanceObserver 捕获 > 50ms 长任务

Refs: Day18
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day19 结束时集中 push。

---

## 8. 通过标准

- [ ] 任一 Run 可按 traceId 从前端到 DB 重建完整时间线（抽查 100 个无断点）
- [ ] 记录真实 TTFT / P50 / P95 / P99 / Tool 成功率，`GET /observability/metrics` 可查
- [ ] 敏感字段泄漏数为 0（`grep -iE 'token|password|cookie' app.log` 只匹配 `[REDACTED]`）
- [ ] 前端长任务被捕获并带 traceId 上报
- [ ] 慢 Tool 能通过 span 分解定位（span 名带工具名）
- [ ] 12 个单元测试全绿
- [ ] 四件套全绿，commit 含 `Refs: Day18`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day18`）
2. 四件套输出截图 / 日志
3. 学习日志：`AsyncLocalStorage` 传播原理、分位数为什么比平均值重要、脱敏为什么收口
4. 架构证据：可观测性地图（traceId 如何贯穿六层）+ 性能预算表（TTFT/P95 目标值）
5. AI Review 记录：埋点模板 / 数据汇总由 AI 生成，指标定义和脱敏字段白名单由人定；记录接受 / 修改 / 拒绝理由
6. 反证实验 1 / 2 的观察记录

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（前端点击 / webhook）到最终输出（诊断结论 + 指标快照），解释"Trace/性能"的数据流；当天知识链"Trace → 结构化日志 → TTFT/P95 → 长任务 → 脱敏"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除 redact 收口（今天最关键的合规保护），线上会出现什么可观察现象？请给出最小复现、定位证据（grep 命令）、恢复动作和一条防复发测试。
3. 请引用今天的具体代码（`withSpan` / `MetricsCollector` / `redact`）、测试和架构证据，证明"任一 Run 可按 trace 重建、敏感泄漏为 0"已达到；再说明距离企业生产标准还缺什么（如：采样率、OTLP 导出、告警阈值），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 10% 的 Run 没有 traceId，用户只报告"生成到一半停住"，前端、SSE、Tool、DB 日志无法关联。请从请求头、span/context 和结构化日志找出丢失位置；先按 runId 临时关联止损，再统一传播 traceId，并抽查 100 个 Run 验证可重建完整时间线。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S33 OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/instrumentation/)
2. 新 Tool 让 TTFT 从 1.2s 升到 6.5s，P50 正常但 P95 恶化，日志还记录了 API key。请用 span 分解、长任务、内存和脱敏扫描定位；先降级慢 Tool 并删除敏感日志止损，再修复关键路径和字段白名单，压测验证 TTFT/P95 回归且泄漏为 0。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：Trace、结构化日志、TTFT/P95、长任务和敏感字段脱敏。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 如何建立一套前端 AI 应用质量监控体系？
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 9 页。
2. 如何监控 AI 产品的性能和质量？有哪些关键指标？
   来源：[《2026阿里妈妈高级前端工程师-AI产品方向》](<../../资源/2026阿里妈妈高级前端工程师-AI产品方向.pdf>)，第 6 页。

题目说明：直接覆盖 TraceID、TTFT、TPS、流式中断率、5xx、质量指标和链路追踪。对应今天的 `MetricsCollector` 分位数、`withSpan` 计时、结构化日志。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

预期方向（仅供准备，不是标准答案）：

1. **局部机制**：`AsyncLocalStorage` 是怎么在 `await` 之后还能拿到同一个 traceId 的？`async_hooks` 的 init/before/after 回调分别在什么时机触发？
2. **边界一致性**：如果前端传了一个 traceId，你的 middleware 是直接信任还是校验？校验哪些（长度/格式/字符集）？
3. **线上事故**：日志里发现记录了用户 cookie，你如何定位是哪一处日志漏了 redact？如何保证以后不再发生？
4. **工程权衡**：`AsyncLocalStorage` 有性能开销，为什么 traceId 场景可以接受但不能滥用？环形缓冲 1000 条样本对 P99 精度有什么影响？
5. **架构演进**：现在 metrics 在内存里，进程重启就丢。要接 Prometheus / OTLP 需要改哪里？怎么保证不破坏已有的 `withSpan` 接口？

---

## 14. 本 Day 在 90 天路线中的锚点

- **承上**：Day 12 Agent Loop、Day 13 持久化、Day 17 审批——今天给这些链路装上"可观测的眼睛"，任一步慢/错都能定位
- **启下**：
  - Day 19-20 LangChain RAG：检索 / Embedding / Rerank 各是一个 span，用今天的 `withSpan` 观测慢在哪一环
  - Day 30 M3 门禁：验收标准明确要求"任一 Run 可按 trace 重建完整时间线"，今天是它的地基
  - Day 61-90 p2-agent-workbench 多 Agent 协同：多个 Agent 的 traceId 需要串成一棵调用树，今天的 span 嵌套是雏形
- **合同锚点**：今天定义的 `withSpan(name, ...)` 计时原语、`MetricsCollector.snapshot()` 指标结构、`redact` 脱敏白名单，是后续所有天可观测性的统一入口
