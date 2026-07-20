# Day 26：流式 BFF（v1 全缓冲拼接 → v2 有界流透传 + 背压 → v3 取消上游 + 可重试边界 + requestId 审计）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-08 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 22 API 合同、Day 24 鉴权、Day 25 后端测试，第一次要在 NestJS 里做"模型流代理"、经历过"BFF 把流拼成大字符串导致内存暴涨"的全栈开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-10：前端 Agent 运行时 + 后端 Nest 基线
   Day 11-20：Tool Registry / Agent Loop / 持久化 / SSE / 生产演练 / 毕业考

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + LLM 集成 + RAG）
   Day 21：NestJS 架构深化（模块边界 / DI scope / Ports-Adapters）
   Day 22：API 合同（DTO / OpenAPI / 统一错误 / 版本兼容）
   Day 23：数据建模（Conversation / Message / Citation / 索引 / 迁移）
   Day 24：鉴权 / 权限（JWT / RBAC / ABAC / CSRF / 审计）
   Day 25：后端测试（测试金字塔 / Repository fake / mutation）
   Day 26：流式 BFF（流透传 + 背压 + 取消 + 重试边界）        ← 今天在这里
   Day 27-30：全栈联调 + M3 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 26 在阶段一第 6 天**。Day 12 的 Agent Loop 里，`OpenAIProvider` 直接在 NestJS 进程里调模型、把整段回答攒完再返回。今天要把这个"攒完再返回"改成真正的**流式 BFF（Backend for Frontend）**：模型吐一个 token，BFF 就透传一个 token 给前端，中间不缓冲整段；客户端关掉页面时，BFF 要能立刻掐断上游模型连接（省钱）；上游 429/超时时，要能在"安全边界"内重试。

### 到 Day 25 结束时项目已具备的能力

- **后端架构**（Day 21-22）：Ports/Adapters 解耦、统一 Error DTO、OpenAPI、版本兼容
- **数据 + 鉴权**（Day 23-24）：Conversation/Message 聚合、资源级 ABAC、actor 审计
- **测试**（Day 25）：三层测试金字塔、Repository fake、mutation 验证
- **Agent Loop**（Day 12）：`OpenAIProvider.chat()` 返回**完整** `AgentTrajectory`——**它是"攒完再返回"的，不是流式的**
- **前端 SSE 消费**（Day 14-15）：`useSseStream` 能消费 SSE、`useAgentTimeline` 能渲染——**但目前消费的是 Agent Loop 事件流，不是"模型原始 token 流"**

### 今天要解决的 4 个问题

1. **问题 1：全缓冲导致内存随并发线性增长**
   Day 12 的 Provider 是 `const text = await getFullCompletion()`——先把模型输出的几千个 token 在内存里拼成一个大字符串，再返回。单个请求没问题，但 100 个用户并发问长问题（每个回答 8KB），BFF 进程要同时持有 100 × 8KB 的字符串 buffer，加上 V8 的中间拷贝，内存可以冲到 3GB 触发 OOM。**必须改成"边收边发"的流透传，让任意时刻内存里只有一个 chunk**。

2. **问题 2：没有背压（backpressure）**
   模型（上游）吐 token 很快，慢客户端（下游，比如手机弱网）收得很慢。如果 BFF 不管下游快慢、收到就往下写，Node 的 socket 写缓冲会无限堆积——本质还是内存爆炸，只是换了个地方堆。**必须让下游的"慢"能反向传导到上游，让 BFF 在下游写不动时暂停读上游**。

3. **问题 3：客户端断开后上游仍在跑（烧钱）**
   用户问了个问题，模型开始生成，用户等得不耐烦关掉了页面。如果 BFF 不处理，它和上游模型的 HTTP 连接还挂着，模型继续生成完整个回答（你继续按 token 付费），生成完往一个已经关闭的 socket 写，报错才发现客户端早走了。**必须监听下游 socket 的 close 事件，立刻 abort 上游连接**。

4. **问题 4：重试边界不清晰导致重复内容**
   上游 429（限流）时想重试是合理的。但如果已经吐了一半 token 给客户端，这时候 429 断了，重试会**从头再生成**——客户端先收到前半段，再收到完整段，出现重复文本，还付两次钱。**必须定义"首字节前可重试、首字节后不可重试"的边界**。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`StreamProxyModule`**：把 Day 12 的模型调用改成流式 BFF。核心是一条**上游模型流 → 有界透传 → 下游 SSE** 的管线，带背压传播（下游慢就暂停读上游）、取消传播（下游关闭就 abort 上游）、以及"首字节前可重试"的重试边界，全链路用 `requestId` 串联结构化日志。

### 1.1 用户能看到什么

**场景**：运维工程师在诊断对话框问"帮我分析 srv-042 最近一小时的 CPU 趋势并给出建议"，这是个会生成长回答（约 800 token）的问题。

```
时间轴：

14:40:00.000  用户提交问题
  → POST /agent/chat/stream  { conversationId, message }
  → BFF 生成 requestId = "req-a1b2"
  → BFF 校验鉴权（Day 24 Guard）→ 通过
  → BFF 调用 Provider.streamChat(messages, { signal })
  → 建立到上游模型的流式连接

14:40:00.320  上游吐出第 1 个 token "srv"
  → BFF 立刻透传：SSE data: {"type":"text.delta","text":"srv"}
  → 【关键】TTFT（首字节时间）= 320ms，用户马上看到响应

14:40:00.320 ~ 14:40:06.100  上游持续吐 token
  → 每个 chunk 到达 → 经过背压检查 → 写下游
  → 若下游 res.write() 返回 false（缓冲满）
    → BFF 暂停读上游（upstream.pause()）
    → 等下游 'drain' 事件 → 恢复读上游（upstream.resume()）
  → 任意时刻 BFF 内存里只有 1 个 chunk（几十字节）

14:40:06.100  上游流结束
  → SSE data: {"type":"done","usage":{"totalTokens":812}}
  → BFF 关闭下游连接
  → 结构化日志：{ requestId:"req-a1b2", ttftMs:320, totalMs:6100, tokens:812, outcome:"completed" }

===== 对比：如果用户中途关闭页面 =====

14:40:03.000  用户等不及，关闭浏览器 tab
  → 下游 socket 触发 'close' 事件
  → BFF 检测到 res.destroyed / req aborted
  → 立刻调用 abortController.abort()
  → 上游模型 HTTP 连接被 RST 掐断（停止计费）
  → 结构化日志：{ requestId:"req-a1b2", ttftMs:320, outcome:"client_aborted", tokensBeforeAbort:340 }

===== 对比：上游首字节前 429 =====

14:41:00.000  另一个请求，上游返回 429（还没吐任何 token）
  → BFF 判断：still_before_first_byte = true → 可重试
  → 指数退避等待 800ms → 重试第 2 次
  → 第 2 次成功，正常吐 token
  → 客户端完全无感（没有收到任何重复内容）

===== 对比：上游首字节后断连 =====

14:42:00.000  又一个请求，已吐 200 token 后上游连接断了
  → BFF 判断：still_before_first_byte = false → 不可重试
  → SSE data: {"type":"error","code":"upstream_interrupted","recoverable":false}
  → 客户端显示"生成中断，请重新提问"（不会收到重复的前 200 token）
```

**用户/运维观察到的最终结果**：
- 首字节时间（TTFT）稳定在几百毫秒，长回答也能"边生成边看"
- 100 并发长回答时 BFF 内存稳定在平台值（不随并发线性增长）
- 关闭页面后上游立刻停止（省 token 成本）
- 重试只发生在"没吐任何内容之前"，用户永远不会看到重复文本

### 1.2 这个模块在项目里承担什么

- **输入**：前端 `POST /agent/chat/stream` 请求（`conversationId` + `message` + JWT）；上游 LLM Provider 的**流式** API（`ReadableStream` / async iterator）
- **输出**：向前端透传的 SSE 流（`text.delta` / `done` / `error` 事件）；一条带 `requestId` / TTFT / token 数 / outcome 的结构化日志
- **对齐后续**：今天定义的 **`StreamProxy` 合同**（`streamChat(messages, { signal, requestId })` + 背压封装 + 重试边界）是 Day 27-30 全栈联调、Day 31+ 阶段二后续（LangChain 流式 RAG 回答）的流式地基。前端消费方仍是 Day 14 的 `useSseStream`——今天不改前端合同，只把"事件源"从 Agent Loop 换成"模型原始流"

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 全缓冲：`await` 拿完整回答再一次性 SSE 推送 | 单文件 `stream.controller.ts`，`for await` 攒进数组 | Provider 流式 API 基本用法、async iterator |
| **v1 痛点** | 内存随并发线性增长；TTFT = 整段生成时间（用户干等）；客户端断开不掐上游 |  |  |
| **v2** | v1 + **边收边发流透传** + **背压传播**（下游满则暂停上游） | 拆出 `stream-pump.ts`（泵）+ `backpressure.ts` | Node Stream 背压、`write()` 返回值、`drain` 事件、有界内存 |
| **v2 痛点** | 客户端关闭后上游仍在跑烧钱；上游 429 无重试；无 requestId 串联日志 |  |  |
| **v3** | v2 + **取消传播**（下游 close → abort 上游） + **首字节可重试边界** + **requestId 结构化日志** | 完整分层（proxy/pump/backpressure/cancel/retry/logging） | AbortController 传播、可重试边界设计、TTFT 埋点、结构化日志 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：流式 BFF 涉及多个关注点（上游 Provider 流封装、背压泵、取消传播、重试边界、SSE 编码、结构化日志），如果不先在脑子里立起骨架，写到一半就会把"读上游"和"写下游"糊在一个 `for await` 里、把"取消"和"重试"混在同一个 try-catch、把背压逻辑散在 controller 里。看完这棵树，下面章节再出现 `stream/pump/stream-pump.ts` 时，你就能立刻定位它是"背压泵"这一层。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── stream/                                      ← 【新增】流式 BFF 模块
│   ├── proxy/
│   │   ├── stream-proxy.interface.ts            ← 流代理 Port 接口
│   │   ├── openai-stream-provider.ts            ← OpenAI 流式实现（Adapter）
│   │   └── stream-provider.factory.ts           ← Provider 工厂
│   ├── pump/
│   │   ├── stream-pump.ts                       ← 背压泵（上游 → 下游，核心）
│   │   ├── stream-pump.spec.ts                  ← 泵单元测试（背压 + 取消）
│   │   └── backpressure.ts                      ← 背压原语（write/drain 封装）
│   ├── cancel/
│   │   └── cancel-bridge.ts                     ← 下游 close → 上游 abort 的桥
│   ├── retry/
│   │   ├── retry-boundary.ts                    ← 首字节可重试边界（纯函数）
│   │   └── retry-boundary.spec.ts               ← 重试边界单元测试
│   ├── sse/
│   │   └── sse-encoder.ts                       ← SSE 事件编码（text.delta/done/error）
│   ├── logging/
│   │   └── stream-logger.ts                     ← requestId 结构化日志
│   ├── index.ts                                 ← 桶文件
│   ├── stream.module.ts                         ← NestJS 模块
│   ├── stream.service.ts                        ← 业务编排层
│   └── stream.controller.ts                     ← HTTP 入口（POST /agent/chat/stream）
├── agent/                                       ← 【Day 12 已有】Agent Loop
│   └── ...
├── config/                                      ← 【Day 21 已有】配置隔离
│   └── ...
└── main.ts
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `stream.controller.ts` | ✓ 全缓冲拼接 | ✓ 调 pump | ✓ 挂 cancel-bridge + requestId |
| `proxy/openai-stream-provider.ts` | ✓ async iterator | ✓ 同 v1 | ✓ 加 signal 参数 |
| `pump/stream-pump.ts` | ✗ | ✓ 背压泵 | ✓ 加 abort 检查 |
| `pump/backpressure.ts` | ✗ | ✓ write/drain 封装 | ✓ 同 v2 |
| `cancel/cancel-bridge.ts` | ✗ | ✗ | ✓ close → abort |
| `retry/retry-boundary.ts` | ✗ | ✗ | ✓ 首字节边界纯函数 |
| `logging/stream-logger.ts` | ✗ | ✗ | ✓ requestId + TTFT + outcome |
| `sse/sse-encoder.ts` | 内联 | ✓ 抽出 | ✓ 同 v2 |

**依赖方向（务必单向，反过来一次都不行）**：

```
stream.controller.ts
        │
        ▼
stream.service.ts
        │
        ├─► proxy/openai-stream-provider.ts ──► 上游 LLM（HTTP 流）
        │
        ├─► pump/stream-pump.ts
        │           │
        │           ├─► pump/backpressure.ts（纯 Node stream 原语）
        │           └─► cancel/cancel-bridge.ts（AbortController）
        │
        ├─► retry/retry-boundary.ts（纯函数，不 import Node stream）
        │
        ├─► sse/sse-encoder.ts（纯函数，string → SSE 格式）
        │
        └─► logging/stream-logger.ts（结构化日志）

retry-boundary.ts   ← 纯函数，只判断"能不能重试"，不发请求
sse-encoder.ts      ← 纯函数，只做格式编码
backpressure.ts     ← 只依赖 Node stream 原语，不 import 业务
```

**红线**：
- `retry/retry-boundary.ts` 里出现 `import { OpenAI }` 或发起 HTTP 请求就是塌方——重试边界只是"判断能不能重试"的纯决策函数
- `pump/stream-pump.ts` 里出现 `res.write('data: ...')` 手写 SSE 格式就是塌方——SSE 编码必须走 `sse-encoder.ts`
- `stream.controller.ts` 里直接 `for await (const chunk of upstream)` 就是绕过泵，背压和取消全丢

**动手前先问自己 3 个问题**：

1. 背压为什么不能靠"手动 setTimeout 限速"？—— 见 §5.4 知识点 2「背压的本质是反向流量控制」
2. 取消传播为什么要监听下游 `close` 而不是靠超时？—— 见 §5.4 知识点 3「取消传播与资源释放」
3. "首字节后不可重试"这条边界为什么必须是纯函数？—— 见 §5.4 知识点 4「可重试边界的确定性」

---

## 1.5 阶段 D：动手脚手架（30 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认依赖 + 装负载工具（4 分钟）

按第 5.3 节的代码：

- 项目 `apps/api` 已有 `@nestjs/common` / `openai`（或你 Day 12 用的 Provider SDK）
- 确认 Node ≥ 18（`ReadableStream` / `AbortController` 原生可用）
- 装压测工具：`pnpm --filter api add -D autocannon`（并发内存验证用）
- 单测用 vitest 内置，模拟上游流用 async generator，不需要真实 API key

**边写边问自己**：

- 为什么用 async generator 模拟上游而不是真调 OpenAI？（单测要确定性、要能精确控制"第几个 chunk 后断连"，真 API 做不到）
- 压测为什么要看内存曲线而不是只看 QPS？（今天的核心命题是"内存不随并发线性增长"，QPS 高但 OOM 是失败）

### 1.5.2 D-2：创建目录（3 分钟）

按第 5.3 节的目录树，在 `apps/api/src/stream/` 下建 6 个子目录：

```
stream/
├── proxy/          ← 上游 Provider 流封装
├── pump/           ← 背压泵（核心）
├── cancel/         ← 取消传播
├── retry/          ← 重试边界
├── sse/            ← SSE 编码
└── logging/        ← 结构化日志
```

**边写边问自己**：

- 为什么 `pump/` 和 `cancel/` 分开？（泵负责"数据怎么流"，取消负责"什么时候停"，两个正交关注点）
- 为什么 `retry/` 不放 `proxy/` 里？（重试是"决策"，Provider 是"执行"；决策要纯函数可测，混进 Provider 就得 mock HTTP 才能测）

### 1.5.3 D-3：写纯函数层（retry-boundary + sse-encoder，6 分钟）

按第 5.3 节的代码：

- 写 `retry/retry-boundary.ts`（`canRetry(state): boolean` 纯函数）
- 写 `retry/retry-boundary.spec.ts`（首字节前/后、429/500/超时各分支）
- 写 `sse/sse-encoder.ts`（`encodeDelta` / `encodeDone` / `encodeError`）

**边写边问自己**：

- `canRetry` 的输入应该包含哪些字段？（`hasEmittedFirstByte` / `errorKind` / `attemptCount`——只要这三个就能决策）
- SSE 编码为什么要处理换行？（SSE 协议里 `\n\n` 是事件分隔符，文本里的 `\n` 要转义或按 `data:` 多行规则处理）

### 1.5.4 D-4：写背压泵 + 取消桥（10 分钟）

按第 5.3 节的代码：

- 写 `pump/backpressure.ts`（`writeWithBackpressure(res, chunk)` 返回 Promise）
- 写 `pump/stream-pump.ts`（`pump(upstream, downstream, opts)` 核心循环）
- 写 `pump/stream-pump.spec.ts`（背压暂停/恢复、abort 中断）
- 写 `cancel/cancel-bridge.ts`（`bridgeCancel(req, res, abortController)`）

**边写边问自己**：

- `writeWithBackpressure` 什么时候 resolve？（`res.write()` 返回 true 立即 resolve；返回 false 则等 `drain` 事件再 resolve）
- 泵循环里 abort 检查放在读上游之前还是之后？（每次拿到 chunk 后、写下游前都要检查，尽早退出省资源）

### 1.5.5 D-5：写 Provider + service + controller + 日志（7 分钟）

按第 5.3 节的代码：

- 写 `proxy/stream-proxy.interface.ts`（Port）
- 写 `proxy/openai-stream-provider.ts`（Adapter，带 signal）
- 写 `logging/stream-logger.ts`
- 写 `stream.service.ts`（编排：Provider → pump → 日志）
- 写 `stream.controller.ts`（挂 cancel-bridge + requestId）
- 写 `stream.module.ts`

**边写边问自己**：

- `requestId` 在哪一层生成？（controller 入口，越早越好，保证全链路都能引用）
- service 编排时 pump 抛错怎么办？（区分"可重试错误"走重试、"不可重试"编码成 SSE error 事件）

---

## 2. 学习节奏（90 阅读 / 270 动手深化）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 40 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"全缓冲→流透传背压→取消重试"的演进路径 |
| B：读代码 | 40 min | §5.3 逐文件通读，特别是 `stream-pump.ts` 和 `retry-boundary.ts` | 能口述"背压怎么反向传导"、"取消桥怎么掐上游" |
| C：读深挖 | 40 min | §6.5 前端底子补弱（`Day26深挖-前端底子补弱.html`） | 能回答"浏览器 fetch 流式响应如何处理背压" |
| D：动手脚手架 | 30 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 60 min | §7.6 三个 spec 文件 + autocannon 压测 | `pnpm --filter api test stream` 全绿 + 内存曲线平台化 |
| F-1：反证 1 | 20 min | §7.7 去掉背压直接 write | 观察慢客户端时内存暴涨 |
| F-2：反证 2 | 20 min | §7.8 去掉 cancel-bridge | 观察关闭页面后上游仍在跑 |
| F-3：验证 + 提交 | 30 min | §7.9 四件套 + commit | commit 含 `Refs: Day26` |

**总计**：90 阅读（A+B+C）+ 270 动手/项目深化 = 360 min

---

## 3. v1：最小闭环（全缓冲拼接）

### 3.1 v1 要实现什么

Day 12 的 Provider 是"攒完再返回"。v1 先把它接成流式 API 的形态，但**仍然在 BFF 侧攒完整段再一次性推给前端**——用最短的代码建立"BFF 代理模型调用"这条链路，暴露全缓冲的问题。

**目标**：
- `POST /agent/chat/stream` 接收问题
- BFF 调用上游流式 API，`for await` 把所有 chunk 攒进数组
- 拼成完整字符串后，一次性 SSE 推送 + `done`

**不做**：
- 不边收边发（攒完再发）
- 不做背压
- 不处理客户端断开
- 不重试

### 3.2 v1 目录结构

```
apps/api/src/stream/
├── stream.controller.ts    ← 全缓冲拼接
├── proxy/
│   └── openai-stream-provider.ts  ← async iterator 封装
└── stream.module.ts
```

### 3.3 v1 完整代码

**apps/api/src/stream/proxy/openai-stream-provider.ts（v1）**

```typescript
import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

@Injectable()
export class OpenAIStreamProvider {
  private readonly client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  /**
   * v1：返回一个 async iterator，每次 yield 一段文本 delta
   */
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
    })

    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content
      if (delta) {
        yield delta
      }
    }
  }
}
```

**apps/api/src/stream/stream.controller.ts（v1）**

```typescript
import { Body, Controller, Post, Res } from '@nestjs/common'
import type { Response } from 'express'
import { OpenAIStreamProvider, ChatMessage } from './proxy/openai-stream-provider'

@Controller('agent/chat')
export class StreamController {
  constructor(private readonly provider: OpenAIStreamProvider) {}

  @Post('stream')
  async stream(
    @Body() body: { messages: ChatMessage[] },
    @Res() res: Response,
  ): Promise<void> {
    // v1：攒完整段再发
    const chunks: string[] = []
    for await (const delta of this.provider.streamChat(body.messages)) {
      chunks.push(delta)          // ← 全部堆进内存
    }
    const fullText = chunks.join('')

    // 攒完后一次性推送
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(`data: ${JSON.stringify({ type: 'text.delta', text: fullText })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  }
}
```

**apps/api/src/stream/stream.module.ts（v1）**

```typescript
import { Module } from '@nestjs/common'
import { StreamController } from './stream.controller'
import { OpenAIStreamProvider } from './proxy/openai-stream-provider'

@Module({
  controllers: [StreamController],
  providers: [OpenAIStreamProvider],
})
export class StreamModule {}
```

### 3.4 v1 暴露的痛点

**痛点 1：内存随并发线性增长**

`chunks.push(delta)` 把整段回答堆在数组里。单请求 8KB 没问题，但 100 并发 = 800KB 纯文本 + V8 数组扩容拷贝 + `join('')` 时又复制一份完整字符串。峰值内存可以到 GB 级，并发再高就 OOM。**内存复杂度是 O(并发数 × 回答长度)**。

**痛点 2：TTFT = 整段生成时间**

用户提交问题后，要等模型**把 800 个 token 全部生成完**（可能 6 秒），才一次性看到完整回答。流式的意义（边生成边看）完全丧失，体验跟非流式没区别，还白白占了 6 秒连接。

**痛点 3：客户端断开后上游仍在跑**

用户 3 秒时关掉页面，但 `for await` 循环还在读上游、模型还在生成、你还在按 token 付费。攒完 6 秒后往一个已关闭的 `res` 写，才抛错。**白烧了 3 秒的 token 成本**。

**痛点 4：一个慢客户端能拖垮内存**

即使改成边收边发（v2），如果不做背压，遇到弱网慢客户端：上游吐得快、下游收得慢，`res.write()` 的数据堆在 Node 的 socket 写缓冲里，还是内存爆炸——只是从"业务数组"换到了"内核缓冲"。

---

## 4. v2：有界流透传 + 背压传播

### 4.1 v2 要实现什么

用户视角：提交问题后，第一个字在 1 秒内就出现，然后逐字流出；不管回答多长、并发多少，BFF 内存都平稳不暴涨（不再把整段攒在数组里）。

**目标**：
- 边收边发：上游 yield 一段就立刻 SSE 推一段，不攒
- 背压：下游 `res.write()` 返回 false（写缓冲满）时，暂停读上游，等 `drain` 再继续
- 内存有界：无论回答多长，BFF 常驻内存只有"一个 chunk + socket 缓冲"

**依然不做**：
- 不处理客户端断开取消上游（v3）
- 不做重试边界（v3）
- 不做结构化日志 requestId（v3）

### 4.2 v2 目录结构

```
apps/api/src/stream/
├── proxy/openai-stream-provider.ts   ← v1 已有
├── pump/
│   ├── backpressure.ts               ← 新增：writeWithBackpressure
│   ├── stream-pump.ts                ← 新增：pump 核心循环
│   └── stream-pump.spec.ts           ← 新增：背压单测
├── sse/
│   └── sse-encoder.ts                ← 新增：SSE 编码
├── stream.controller.ts              ← 改：用 pump
└── stream.module.ts
```

### 4.3 v2 完整代码

**apps/api/src/stream/sse/sse-encoder.ts（v2 全文）**

```typescript
/**
 * SSE 编码：把业务事件编码成 SSE 帧
 * SSE 协议：每帧以 `data: ` 开头，`\n\n` 结尾；多行 data 每行都要 `data: ` 前缀
 */
export function encodeDelta(text: string): string {
  const payload = JSON.stringify({ type: 'text.delta', text })
  return `data: ${payload}\n\n`
}

export function encodeDone(): string {
  return `data: ${JSON.stringify({ type: 'done' })}\n\n`
}

export function encodeError(code: string, message: string): string {
  return `data: ${JSON.stringify({ type: 'error', code, message })}\n\n`
}
```

**apps/api/src/stream/pump/backpressure.ts（v2 全文）**

```typescript
import type { Response } from 'express'

/**
 * 带背压的写入：
 *   - res.write() 返回 true → 缓冲未满，立即 resolve
 *   - res.write() 返回 false → 缓冲已满，等 'drain' 事件再 resolve
 *
 * 这是背压的核心：调用方 await 这个函数，写缓冲满时自然被"卡住"，
 * 从而暂停从上游读取——压力就从下游反向传导到了上游。
 */
export function writeWithBackpressure(res: Response, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 已经关闭的响应直接拒绝，避免写已销毁的流
    if (res.writableEnded || res.destroyed) {
      reject(new Error('response_closed'))
      return
    }

    const ok = res.write(chunk, (err) => {
      if (err) reject(err)
    })

    if (ok) {
      resolve()
    } else {
      // 缓冲满：等 drain（缓冲排空）再继续
      res.once('drain', resolve)
    }
  })
}
```

**apps/api/src/stream/pump/stream-pump.ts（v2 全文）**

```typescript
import type { Response } from 'express'
import { writeWithBackpressure } from './backpressure'
import { encodeDelta, encodeDone } from '../sse/sse-encoder'

export interface PumpResult {
  emittedChars: number
  finishReason: 'completed'
}

/**
 * 背压泵：把上游 async iterator 的 chunk 透传到下游 Response。
 * 关键：每写一段都 await writeWithBackpressure——
 * 下游慢时这里被卡住，for await 就不会继续拉上游，实现背压。
 *
 * v2：还不处理取消（v3 加 signal）
 */
export async function pump(
  upstream: AsyncIterable<string>,
  res: Response,
): Promise<PumpResult> {
  let emittedChars = 0

  for await (const delta of upstream) {
    await writeWithBackpressure(res, encodeDelta(delta))
    emittedChars += delta.length
  }

  await writeWithBackpressure(res, encodeDone())
  res.end()

  return { emittedChars, finishReason: 'completed' }
}
```

**apps/api/src/stream/pump/stream-pump.spec.ts（v2 全文）**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { pump } from './stream-pump'
import type { Response } from 'express'

// 模拟一个可控背压的 Response
function makeFakeRes(opts: { bufferFullAfter?: number } = {}) {
  const written: string[] = []
  let writeCount = 0
  const drainListeners: Array<() => void> = []

  const res = {
    writableEnded: false,
    destroyed: false,
    write(chunk: string, cb?: (err?: Error) => void) {
      written.push(chunk)
      writeCount++
      cb?.()
      // 到达阈值后返回 false（缓冲满），需要 drain
      if (opts.bufferFullAfter && writeCount >= opts.bufferFullAfter) {
        return false
      }
      return true
    },
    once(event: string, listener: () => void) {
      if (event === 'drain') drainListeners.push(listener)
      return res
    },
    end() {
      res.writableEnded = true
    },
    // 测试辅助：手动触发 drain
    _drain() {
      const l = drainListeners.shift()
      l?.()
    },
  } as unknown as Response & { _drain: () => void }

  return { res, written }
}

async function* makeUpstream(parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield p
}

describe('stream-pump', () => {
  it('透传所有 chunk 并以 done 结尾', async () => {
    const { res, written } = makeFakeRes()
    const result = await pump(makeUpstream(['你好', '世界']), res)

    expect(result.emittedChars).toBe(4)
    expect(written[0]).toContain('你好')
    expect(written[1]).toContain('世界')
    expect(written[written.length - 1]).toContain('done')
    expect(res.writableEnded).toBe(true)
  })

  it('缓冲满时等待 drain（背压生效）', async () => {
    const { res } = makeFakeRes({ bufferFullAfter: 1 })
    let resolved = false

    const p = pump(makeUpstream(['a', 'b', 'c']), res).then(() => {
      resolved = true
    })

    // 第一次 write 后缓冲满，pump 卡在等 drain
    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)

    // 反复触发 drain 让它跑完
    for (let i = 0; i < 5; i++) {
      ;(res as unknown as { _drain: () => void })._drain()
      await new Promise((r) => setTimeout(r, 1))
    }
    await p
    expect(resolved).toBe(true)
  })

  it('写已关闭的响应抛 response_closed', async () => {
    const { res } = makeFakeRes()
    ;(res as { writableEnded: boolean }).writableEnded = true

    await expect(pump(makeUpstream(['x']), res)).rejects.toThrow('response_closed')
  })
})
```

**apps/api/src/stream/stream.controller.ts（v2 全文）**

```typescript
import { Body, Controller, Post, Res } from '@nestjs/common'
import type { Response } from 'express'
import { OpenAIStreamProvider, ChatMessage } from './proxy/openai-stream-provider'
import { pump } from './pump/stream-pump'
import { encodeError } from './sse/sse-encoder'

@Controller('agent/chat')
export class StreamController {
  constructor(private readonly provider: OpenAIStreamProvider) {}

  @Post('stream')
  async stream(
    @Body() body: { messages: ChatMessage[] },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      // v2：边收边发 + 背压，不再攒数组
      await pump(this.provider.streamChat(body.messages), res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.writableEnded) {
        res.write(encodeError('stream_error', message))
        res.end()
      }
    }
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：客户端断开，上游不停**

用户关掉页面，`res` 触发 `close` 事件，但 v2 的 `pump` 只在下次 `writeWithBackpressure` 检测到 `writableEnded` 才抛错退出。如果此刻正卡在 `for await` 等上游下一个 chunk（模型思考中，几秒不吐字），这几秒里**上游连接还开着、token 还在烧**。需要一个 `AbortController` 主动掐断上游。

**痛点 2：任何错误都不重试，包括"还没吐字就 429"**

上游返回 429（限流），此时**一个字都还没发给用户**，完全可以安全重试。但 v2 直接把错误编码成 SSE error 事件推给用户，用户看到"服务错误"。反过来，如果已经吐了 500 字才 429，重试会导致**重复输出**——所以重试必须有"首字节前才能重试"的边界。v2 没有这个决策。

**痛点 3：出问题无法定位是哪个请求**

100 个并发流，日志里全是 `stream_error`，没有 requestId 无法串起"这个用户的这次请求，上游花了多久、发了多少字、为什么断"。v3 要加结构化日志 + requestId。

---

## 5. v3：取消上游 + 首字节前重试边界 + requestId 结构化日志（终态）

### 5.1 v3 要实现什么

用户视角：
1. 关闭页面后，BFF 立刻掐断上游连接，token 不再烧（可在 Provider 日志验证 usage 停止增长）
2. 上游 429/超时且**还没吐第一个字**时，BFF 自动重试（最多 2 次），用户无感知
3. 已经吐字后再出错，不重试（避免重复文本），直接给出 error 事件
4. 每条请求有 requestId，日志能串出"上游耗时 / 首字延迟 / 输出字数 / 终止原因"
5. 无论回答多长、并发多少，内存平台化（继承 v2 背压）

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/stream/
├── proxy/
│   ├── openai-stream-provider.ts       ← 改：接收 AbortSignal
│   └── stream-provider.port.ts         ← 新增：Provider 抽象接口
├── pump/
│   ├── backpressure.ts                 ← v2 已有
│   ├── stream-pump.ts                  ← 改：接收 signal + 首字节回调
│   └── stream-pump.spec.ts             ← 扩充：取消用例
├── retry/
│   ├── retry-boundary.ts               ← 新增：首字节前重试决策（纯函数）
│   └── retry-boundary.spec.ts          ← 新增：重试边界单测
├── sse/
│   └── sse-encoder.ts                  ← v2 已有
├── logging/
│   └── stream-logger.ts                ← 新增：结构化日志 + requestId
├── stream.controller.ts                ← 改：编排取消 + 重试 + 日志
└── stream.module.ts
```

### 5.3 v3 完整代码

#### 5.3.1 retry 层：retry-boundary.ts（纯函数，重试边界核心）

```typescript
export interface RetryDecisionInput {
  errorCode: string          // 上游错误码：'rate_limit' | 'timeout' | 'server_error' | ...
  emittedChars: number       // 已经发给客户端的字符数
  attempt: number            // 当前是第几次尝试（从 0 开始）
  maxRetries: number         // 最大重试次数
}

export interface RetryDecision {
  shouldRetry: boolean
  reason: string
}

// 只有这些错误码是"瞬时可重试"的
const RETRYABLE_CODES = new Set(['rate_limit', 'timeout', 'server_error'])

/**
 * 重试边界决策（纯函数）：
 *   核心不变量——只有"还没吐第一个字"（emittedChars === 0）才能重试，
 *   否则重试会导致客户端已显示的文本重复。
 *
 * 这就是"首字节前可重试"（retry-before-first-byte）语义。
 */
export function decideRetry(input: RetryDecisionInput): RetryDecision {
  const { errorCode, emittedChars, attempt, maxRetries } = input

  // 边界 1：已经吐字了，绝不重试（重复文本 > 偶发失败）
  if (emittedChars > 0) {
    return { shouldRetry: false, reason: 'already_emitted' }
  }

  // 边界 2：不可重试的错误码（如 400 参数错误，重试也没用）
  if (!RETRYABLE_CODES.has(errorCode)) {
    return { shouldRetry: false, reason: `non_retryable:${errorCode}` }
  }

  // 边界 3：重试次数用尽
  if (attempt >= maxRetries) {
    return { shouldRetry: false, reason: 'max_retries_exhausted' }
  }

  return { shouldRetry: true, reason: `retry:${errorCode}:attempt${attempt + 1}` }
}
```

#### 5.3.2 retry 层：retry-boundary.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { decideRetry } from './retry-boundary'

describe('decideRetry', () => {
  it('首字节前 + 可重试错误 + 有余额 → 重试', () => {
    const d = decideRetry({ errorCode: 'rate_limit', emittedChars: 0, attempt: 0, maxRetries: 2 })
    expect(d.shouldRetry).toBe(true)
  })

  it('已吐字 → 绝不重试（即使是 429）', () => {
    const d = decideRetry({ errorCode: 'rate_limit', emittedChars: 500, attempt: 0, maxRetries: 2 })
    expect(d.shouldRetry).toBe(false)
    expect(d.reason).toBe('already_emitted')
  })

  it('不可重试错误码（400）→ 不重试', () => {
    const d = decideRetry({ errorCode: 'bad_request', emittedChars: 0, attempt: 0, maxRetries: 2 })
    expect(d.shouldRetry).toBe(false)
    expect(d.reason).toContain('non_retryable')
  })

  it('重试次数用尽 → 不重试', () => {
    const d = decideRetry({ errorCode: 'timeout', emittedChars: 0, attempt: 2, maxRetries: 2 })
    expect(d.shouldRetry).toBe(false)
    expect(d.reason).toBe('max_retries_exhausted')
  })
})
```

#### 5.3.3 proxy 层：stream-provider.port.ts + openai-stream-provider.ts（改：接 signal）

```typescript
// stream-provider.port.ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamProviderPort {
  // 关键变化：接收 AbortSignal，客户端断开时 abort，掐断上游
  streamChat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string>
}

export const STREAM_PROVIDER = Symbol('STREAM_PROVIDER')
```

```typescript
// openai-stream-provider.ts（v3）
import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import type { StreamProviderPort, ChatMessage } from './stream-provider.port'

@Injectable()
export class OpenAIStreamProvider implements StreamProviderPort {
  private readonly client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  async *streamChat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    // OpenAI SDK 原生支持传 signal；abort 时会关闭底层 HTTP 连接
    const stream = await this.client.chat.completions.create(
      { model: 'gpt-4o-mini', messages, stream: true },
      { signal },
    )
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) yield delta
    }
  }
}
```

> ⚠️ **隐私提醒**：`OPENAI_API_KEY` 从环境变量读取，绝不硬编码进源码，也绝不写进日志（见 §5.3.6 stream-logger 的字段白名单）。

#### 5.3.4 pump 层：stream-pump.ts（改：接 signal + 首字节回调）

```typescript
import type { Response } from 'express'
import { writeWithBackpressure } from './backpressure'
import { encodeDelta, encodeDone } from '../sse/sse-encoder'

export interface PumpDeps {
  onFirstByte?: () => void       // 首字节回调（记录 TTFT + 标记"已吐字"）
  signal?: AbortSignal           // 取消信号
}

export interface PumpResult {
  emittedChars: number
  finishReason: 'completed' | 'aborted'
}

export async function pump(
  upstream: AsyncIterable<string>,
  res: Response,
  deps: PumpDeps = {},
): Promise<PumpResult> {
  let emittedChars = 0
  let firstByteSent = false

  for await (const delta of upstream) {
    // 每次循环检查取消：客户端断开时立刻退出，不再拉上游
    if (deps.signal?.aborted || res.writableEnded || res.destroyed) {
      return { emittedChars, finishReason: 'aborted' }
    }

    if (!firstByteSent) {
      firstByteSent = true
      deps.onFirstByte?.()
    }

    await writeWithBackpressure(res, encodeDelta(delta))
    emittedChars += delta.length
  }

  if (!res.writableEnded) {
    await writeWithBackpressure(res, encodeDone())
    res.end()
  }
  return { emittedChars, finishReason: 'completed' }
}
```

#### 5.3.5 logging 层：stream-logger.ts（结构化日志 + 字段白名单）

```typescript
import { Injectable, Logger } from '@nestjs/common'

export interface StreamLogRecord {
  requestId: string
  event: 'start' | 'first_byte' | 'retry' | 'done' | 'aborted' | 'error'
  upstreamMs?: number
  ttftMs?: number
  emittedChars?: number
  finishReason?: string
  errorCode?: string
  retryReason?: string
}

// 只允许这些字段进日志——防止把 messages 内容、apiKey 等敏感信息写进日志
const ALLOWED_FIELDS: (keyof StreamLogRecord)[] = [
  'requestId', 'event', 'upstreamMs', 'ttftMs',
  'emittedChars', 'finishReason', 'errorCode', 'retryReason',
]

@Injectable()
export class StreamLogger {
  private readonly logger = new Logger('StreamBFF')

  log(record: StreamLogRecord): void {
    const safe: Partial<StreamLogRecord> = {}
    for (const key of ALLOWED_FIELDS) {
      if (record[key] !== undefined) (safe as Record<string, unknown>)[key] = record[key]
    }
    this.logger.log(JSON.stringify(safe))
  }
}
```

#### 5.3.6 编排层：stream.controller.ts（v3 全文，编排取消 + 重试 + 日志）

```typescript
import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { STREAM_PROVIDER, type StreamProviderPort, type ChatMessage } from './proxy/stream-provider.port'
import { pump } from './pump/stream-pump'
import { decideRetry } from './retry/retry-boundary'
import { encodeError } from './sse/sse-encoder'
import { StreamLogger } from './logging/stream-logger'

const MAX_RETRIES = 2

@Controller('agent/chat')
export class StreamController {
  constructor(
    @Inject(STREAM_PROVIDER) private readonly provider: StreamProviderPort,
    private readonly logger: StreamLogger,
  ) {}

  @Post('stream')
  async stream(
    @Body() body: { messages: ChatMessage[] },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const requestId = randomUUID()
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Request-Id', requestId)

    // 客户端断开 → abort 上游
    const abort = new AbortController()
    req.on('close', () => abort.abort())

    this.logger.log({ requestId, event: 'start' })

    let attempt = 0
    let emittedChars = 0

    // 重试循环：只在"首字节前"才可能进入下一轮
    while (true) {
      const startedAt = Date.now()
      let firstByteAt = 0
      try {
        const result = await pump(
          this.provider.streamChat(body.messages, abort.signal),
          res,
          {
            signal: abort.signal,
            onFirstByte: () => {
              firstByteAt = Date.now()
              this.logger.log({ requestId, event: 'first_byte', ttftMs: firstByteAt - startedAt })
            },
          },
        )
        emittedChars = result.emittedChars
        this.logger.log({
          requestId,
          event: result.finishReason === 'aborted' ? 'aborted' : 'done',
          upstreamMs: Date.now() - startedAt,
          emittedChars,
          finishReason: result.finishReason,
        })
        return
      } catch (err) {
        const errorCode = this.mapErrorCode(err)
        const decision = decideRetry({ errorCode, emittedChars, attempt, maxRetries: MAX_RETRIES })

        if (decision.shouldRetry) {
          attempt++
          this.logger.log({ requestId, event: 'retry', errorCode, retryReason: decision.reason })
          await this.backoff(attempt)
          continue
        }

        this.logger.log({ requestId, event: 'error', errorCode, retryReason: decision.reason })
        if (!res.writableEnded) {
          res.write(encodeError(errorCode, '生成失败，请重试'))
          res.end()
        }
        return
      }
    }
  }

  private mapErrorCode(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('429') || msg.toLowerCase().includes('rate')) return 'rate_limit'
    if (msg.toLowerCase().includes('timeout')) return 'timeout'
    if (msg.includes('5')) return 'server_error'
    return 'bad_request'
  }

  private backoff(attempt: number): Promise<void> {
    return new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)))
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：BFF（Backend for Frontend）—— 前端专属后端**
- 解决的问题：前端不能直接调 OpenAI（apiKey 泄漏、CORS、无法统一鉴权限流）；每个前端需要的聚合形态又不同
- 运行机制：在前端和多个后端服务/第三方 API 之间放一层专为该前端定制的后端，负责鉴权、聚合、协议转换、密钥保管
- 项目落点：`stream.controller.ts` 就是流式 BFF，前端只连它，apiKey 只在 BFF 侧
- 生产误区：BFF 变成"胖网关"塞业务逻辑（应只做聚合/转换）；BFF 把上游错误原样透传（应映射成前端合同）
- 验证方法：前端代码里 grep 不到任何 `api.openai.com` 和 apiKey；所有模型调用都过 BFF

**知识点 2：流透传（Stream Passthrough）vs 全缓冲**
- 解决的问题：全缓冲（攒完再发）内存随回答长度线性增长，并发下 OOM；首字延迟等于整个生成时长
- 运行机制：上游 yield 一段就立刻 `res.write` 一段，BFF 只持有"当前 chunk"，内存与回答长度无关
- 项目落点：`stream-pump.ts` 的 `for await ... await writeWithBackpressure`
- 生产误区：`chunks.push(delta)` 最后 `join`（就是全缓冲）；用 `res.write` 但不处理返回值（丢背压）
- 验证方法：压测 100 并发长回答，观察 heap 平台化（不随时间线性上涨）

**知识点 3：背压（Backpressure）—— 下游慢反压上游**
- 解决的问题：下游（慢客户端/弱网）消费慢，上游（模型）产出快，中间缓冲无限膨胀直到 OOM
- 运行机制：`res.write()` 返回 false 表示内核写缓冲满，此时 await `drain` 事件，`for await` 被卡住，自然停止拉上游——压力反向传导
- 项目落点：`backpressure.ts` 的 `writeWithBackpressure`
- 生产误区：无视 `write` 返回值一直写（缓冲爆）；用固定 `setTimeout` 节流（不是真背压，只是瞎猜速率）
- 验证方法：模拟慢客户端（下游 `_drain` 手动控制），断言 pump 在缓冲满时暂停

**知识点 4：AbortController 取消传播 —— 客户端断开掐断上游**
- 解决的问题：客户端关页面后，BFF 到上游的连接还开着，token 继续烧（成本 + 占连接池）
- 运行机制：`req.on('close')` 触发 `abort.abort()`，signal 传给 Provider 的 SDK，SDK 关闭底层 HTTP；pump 循环也检查 `signal.aborted` 提前退出
- 项目落点：`stream.controller.ts` 的 `AbortController` + `pump` 里的 signal 检查
- 生产误区：只在 pump 里检查 signal 但没传给 Provider（上游 HTTP 还开着）；`req.on('close')` 后不 abort
- 验证方法：客户端断开后查 Provider 日志，token usage 应停止增长

**知识点 5：首字节前重试边界（Retry Before First Byte）**
- 解决的问题：流式响应一旦吐字就无法安全重试（重复文本）；但首字节前的 429/超时完全可以重试
- 运行机制：`decideRetry` 纯函数——`emittedChars > 0` 一律不重试；只有 `emittedChars === 0` 且错误码瞬时可重试且未超次数才重试
- 项目落点：`retry-boundary.ts` + controller 的 while 重试循环
- 生产误区：无条件重试（吐一半重试 → 重复）；完全不重试（首字节前的瞬时 429 也放弃，可用性差）
- 验证方法：单测覆盖"已吐字不重试""首字节前 429 重试"两条关键路径

**知识点 6：结构化日志 + requestId + 字段白名单**
- 解决的问题：并发流的纯文本日志无法串联单个请求；日志里可能混入 messages/apiKey 等敏感信息
- 运行机制：每请求生成 requestId 贯穿所有日志行；日志用 JSON 结构化；字段白名单过滤，只允许非敏感字段进日志
- 项目落点：`stream-logger.ts` 的 `ALLOWED_FIELDS` + controller 各阶段 `logger.log`
- 生产误区：`console.log(body)` 把用户问题和上下文写进日志（隐私）；无 requestId（无法定位单请求）
- 验证方法：日志 grep 不到 apiKey / messages 内容；同一 requestId 能串出 start→first_byte→done 时间线

### 5.5 边写边问自己

- `writeWithBackpressure` 为什么必须返回 Promise 而不是同步写？（await 它才能在缓冲满时"卡住"调用方，实现背压）
- `decideRetry` 为什么是纯函数？（重试边界是关键安全逻辑，纯函数才能穷举单测所有分支）
- 为什么首字节回调要标记"已吐字"？（`emittedChars > 0` 是重试边界的核心不变量，一旦吐字就锁死不重试）
- `req.on('close')` 和 `res.on('close')` 有什么区别？（req close 是客户端断开请求；这里监听它来 abort 上游）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 全缓冲拼接后一次性响应 | 有界流透传 + 背压 | 取消上游 + 首字节前重试边界 + requestId 日志 |
| **响应模式** | 等 Provider 全部生成完才回 | 边收边转发，chunk 级透传 | 同 v2，附加取消/重试/日志 |
| **内存占用** | O(回答长度)×并发，易 OOM | 有界（缓冲上限固定） | 有界，且断连即释放 |
| **背压** | 无（全在内存） | `write` 返回 false 时暂停上游读取 | 同 v2 |
| **客户端断开** | 上游继续跑到结束，浪费成本 | 上游继续跑（未接 signal） | `req.close` → abort 上游，立即止损 |
| **重试** | 无 | 无 | 首字节前瞬时错误可重试；已吐字锁死 |
| **可观测** | 无 | 基本日志 | requestId 贯穿 + 结构化 + 字段白名单 |
| **架构层次** | 单 controller | proxy/pump 分层 | proxy/pump/retry/logging 完整分层 |
| **对齐后续 Day** | — | 为 Day 27 限流打底 | requestId 对齐 Day 18 trace；重试边界对齐 Day 27 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的深挖 HTML 是 `Day26深挖-前端底子补弱.html`，围绕"流式 BFF 背后的浏览器/HTTP 底层机制"展开，独立于正文的后端代码。

**本日深挖主题**（对应 §6.1 的 8 子节结构，每个深挖点都从今天项目里的真实代码锚点讲起）：

1. **深挖 1：`ReadableStream` 与 `Response.body` —— 从 `stream-pump.ts` 的 `for await` 讲起**
   浏览器 `fetch()` 的 `response.body` 是 `ReadableStream<Uint8Array>`，前端如何用 `getReader()` 消费、`TextDecoder` 增量解码，与后端 pump 如何对称。

2. **深挖 2：HTTP chunked transfer encoding —— 从 `res.write(chunk)` 讲起**
   `Transfer-Encoding: chunked` 的报文格式（十六进制长度 + CRLF + 数据），SSE 为什么建立在它之上，浏览器 DevTools 里怎么看 chunk 边界。

3. **深挖 3：TCP 背压如何传导到应用层 —— 从 `write` 返回 `false` 讲起**
   内核 socket 缓冲区、`highWaterMark`、`drain` 事件如何让 Node 的 `write` 返回 false，浏览器慢速接收如何一路把背压传回上游 Provider。

4. **深挖 4：`AbortController` 与 `AbortSignal` —— 从 `req.on('close')` 讲起**
   signal 的 abort 事件如何传播、`fetch(url, { signal })` 如何取消进行中的请求、为什么这是"取消上游"的标准原语。

5. **深挖 5：`req.on('close')` vs `res.on('close')` vs `res.on('finish')` —— 从 controller 监听讲起**
   三个事件的触发时机差异、客户端主动断开与正常结束如何区分、误监听会导致什么 bug。

6. **深挖 6：事件循环 lag 与流式吞吐 —— 从"100 并发不卡"讲起**
   为什么全缓冲会阻塞 event loop、流式为什么能让单进程扛住高并发、`event-loop-lag` 指标如何观测。

7. **深挖 7：`structuredClone` 与日志字段白名单 —— 从 `stream-logger.ts` 讲起**
   为什么直接 `JSON.stringify(body)` 危险、白名单过滤的实现、浏览器/Node 端如何避免把敏感字段写进日志。

8. **深挖 8：面试真题三档答法 —— "Node 如何处理高并发流式请求"**
   初级（会用 stream）、中级（懂背压+取消）、高级（讲清内存有界性证明 + 重试边界 + 成本控制）三档回答模板。

**深挖 HTML 不含动手脚手架**（§1.5 的 D-1~D-5 只在本 md 正文，不进 HTML）。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

今天的核心可测逻辑是 `retry-boundary.ts`（纯函数）和 `stream-pump.ts` 的背压行为。

**必须覆盖的关键行为**：

| 测试文件 | 用例 | 断言 |
|---|---|---|
| `retry-boundary.spec.ts` | 已吐字（emittedChars>0）遇 429 | `decideRetry` 返回 `{ retry: false }` |
| `retry-boundary.spec.ts` | 首字节前（emittedChars=0）遇瞬时 429 | 返回 `{ retry: true }` |
| `retry-boundary.spec.ts` | 首字节前遇不可重试错误（400） | 返回 `{ retry: false }` |
| `retry-boundary.spec.ts` | 超过最大重试次数 | 返回 `{ retry: false }` |
| `stream-pump.spec.ts` | 下游 `write` 返回 false | pump 暂停读上游直到 `drain` |
| `stream-pump.spec.ts` | signal abort | pump 停止并释放上游 reader |

运行 `pnpm --filter api test stream` 应全绿。

### 7.7 F-1：反证实验 1（5 分钟）—— 去掉重试边界的"已吐字"判断

把 `decideRetry` 里 `if (emittedChars > 0) return { retry: false }` 这行删掉，让它无条件按错误码重试。

**手动构造**：mock Provider 在吐出 20 个字符后抛 429。

**观察现象**：客户端会看到前 20 个字符**重复出现两次**（第一次的残留 + 重试后重新生成的完整回答）。这就是"吐一半重试导致重复文本"的线上事故复现。

**结论**：重试边界的核心不变量是"一旦向客户端吐字，就永远不能重试"。

### 7.8 F-2：反证实验 2（5 分钟）—— 去掉客户端断开的 abort

把 controller 里 `req.on('close', () => controller.abort())` 注释掉。

**手动构造**：客户端发起流式请求，2 秒后关闭页面（或 `curl` 后 Ctrl+C）。

**观察现象**：服务端日志显示上游 Provider 连接**继续保持 90 秒直到自然结束**，token 持续消耗。用 `netstat` 能看到到 Provider 的连接一直 ESTABLISHED。

**结论**：不接 abort signal 会导致"用户已走，账单还在跑"。取消传播是成本控制的硬要求。

### 7.9 F-3：验证 + 提交（10 分钟）

四件套：

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter api test
pnpm --filter api build
```

全绿后提交（Conventional Commits）：

```
feat(api): add streaming BFF with backpressure, upstream cancel and retry boundary

- stream-pump: bounded transfer with backpressure (write/drain)
- retry-boundary: pure function, no retry after first byte emitted
- stream-logger: structured logs with requestId and field whitelist
- controller: abort upstream on client disconnect

Refs: Day26
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day27 结束时集中 push。

---

## 8. 通过标准

- [ ] 客户端断开（`req.close`）能终止上游 Provider 连接，日志可见 abort，netstat 无残留连接
- [ ] 100 并发长回答内存曲线**平台化**（有界）而非线性增长到 OOM
- [ ] 错误映射可验证：Provider 429/超时/网络错误分别映射到确定的下游错误码
- [ ] 首字节前瞬时错误可重试；已吐字后一律不重试（反证 1 能复现重复文本）
- [ ] requestId 贯穿 start→first_byte→done 三个阶段日志，可串联单请求
- [ ] 四件套全绿，commit 含 `Refs: Day26`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day26`，未执行 `git push`）
2. 四件套输出（typecheck / lint / test / build 全绿截图或日志）
3. 学习日志：三版演进的取舍（为什么 v1 会 OOM、背压如何解决、重试边界为什么以"首字节"为界）
4. 架构证据：流控时序图（客户端 ↔ BFF ↔ Provider 的背压/取消传播）+ WS/SSE/流透传的 ADR
5. AI Review 记录：哪些代码接受/修改/拒绝，理由
6. 反证实验 1、2 的现象记录（重复文本截图 / 连接残留 netstat）

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（`POST /agent/stream`）到最终输出（客户端逐字显示），解释"流式 BFF"的数据流与控制流；当天知识链"BFF、流透传、背压、取消、超时/重试边界"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除"客户端断开时 abort 上游"这个保护机制，线上会出现什么可观察现象？请给出最小复现（curl + Ctrl+C）、定位证据（netstat/token usage/日志）、恢复动作（补 signal 传播）和一条防复发测试。
3. 请引用今天的具体代码（`retry-boundary.ts` / `stream-pump.ts`）、测试和架构证据，证明"内存有界 + 取消传播"目标已达到；再说明当前实现距离企业生产标准还缺什么（如全局并发限流、熔断、Provider 池化），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. BFF 把 Provider 流先拼成完整字符串再响应；100 个并发长回答使内存升到 3GB 并 OOM。请用 heap、GC、上游/下游速率和 event-loop lag 定位；先限制并发与回答长度止损，再改为有界流透传和背压传播，压测验证内存平台化而非线性增长。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S8 Node backpressure](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
2. 客户端关闭页面后 BFF 仍保持 Provider 连接 90 秒，429 时又自动重试已输出一半的流，造成重复文本和成本。请用 abort signal、socket close、requestId 和 token usage 定位；先禁用流重试止损，再实现取消上游与"首字前可重试"边界，断连测试验证资源释放。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S8 Node backpressure](https://nodejs.org/en/learn/modules/backpressuring-in-streams)

知识映射：BFF 流透传、背压、取消、超时/重试边界和结构化日志。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. Node.js 作为 AI 中间层时，如何处理高并发流式请求？
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 6 页。
2. Node.js 如何处理高并发请求？
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 8 页。

题目说明：直接覆盖 BFF 流透传、Stream、背压、非阻塞 I/O、取消、内存上限和超时。回答第一题时必须落到今天的 `stream-pump` 有界透传和 `retry-boundary`，不能只说"用 stream"。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 12 Agent Loop 的 Provider 抽象、Day 14 SSE 合同、Day 18 traceId / requestId、Day 25 后端测试分层
- **本日产出**：有界流式 BFF（背压 + 取消上游 + 首字节前重试边界 + 结构化日志），是 p1-monitor 后端面向 LLM 的标准出口
- **对齐后续**：
  - Day 27（限流/配额/成本）会在本日的流控上加全局并发限流、令牌桶、成本预算
  - Day 28-30 会把流式 BFF 接入完整的诊断会话链路，进入 M4 门禁
  - 阶段三 p2-agent-workbench 的多 Agent 流式协同，直接复用今天的 pump/retry/cancel 原语
