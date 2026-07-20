# Day 22：API 合同（v1 三通道各自为政 → v2 统一 Error DTO + OpenAPI → v3 版本兼容 + 消费者合同测试）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-04 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 21 NestJS 架构深化、发现 REST/WS/SSE 三条通道各自返回不同错误格式、前端为同一个 429 写了三套分支的全栈开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁
   Day 11-20：Tool Registry / Agent Loop / 持久化 / SSE / 时间线 / XSS / HITL / Trace / 演练 / 毕业考

阶段二（Day 21-40）：AI 前端 → AI 全栈（工程深化）
   Day 21：NestJS 架构深化（Ports/Adapters + DI scope）
   Day 22：API 合同（DTO + OpenAPI + 统一错误 + 版本兼容 + 合同测试）  ← 今天在这里
   Day 23-30：数据层 / 鉴权 / 限流 / RAG 接入 / M3 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 22 在阶段一第 2 天**。Day 21 把后端模块边界理清了（Ports/Adapters、DI scope），今天要治理**对外合同**：REST、WebSocket、SSE 三条通道当前各自返回不同的错误格式、不同的响应包装，前端不得不为每条通道写一套解析分支。今天要统一成一份**版本化的 Error DTO + 响应合同**，用 OpenAPI 生成前端类型，用消费者合同测试锁死"类型漂移为 0"。

### 到 Day 21 结束时项目已具备的能力

- **后端**（Day 6-21）：Nest + Prisma + Postgres，Agent Loop、持久化、HITL 审批、Trace，模块边界经 Ports/Adapters 解耦
- **三条对外通道**：
  - REST（`GET /agent/runs/:id`、`POST /agent/anomaly-hook`）：返回 `{ data } | { error }`
  - WebSocket（`/ws` 实时指标推送）：错误时推一个字符串 `"rate limited"`
  - SSE（`/agent/runs/:id/stream`）：Provider 原始错误直接透传（`{ type: 'error', raw: {...openai 原始结构...} }`）
- **缺失的一块**：三通道的错误结构完全不一致。前端遇到同一个"限流 429"，在 REST 里读 `error.code`、在 WS 里做字符串匹配、在 SSE 里解析 OpenAI 原始结构——**同一个错误展示三种文案**，而且服务端一改字段前端就崩

### 今天要解决的 4 个问题

1. **问题 1：三通道错误格式不统一**
   REST 返回 `{ error: { code, message } }`，WS 返回裸字符串，SSE 透传 Provider 原始错误。前端要写三套 `catch` 分支，同一个 429（限流）在三个地方显示"请求过多""rate limited""Error: 429 Too Many Requests"三种文案。运维排查时无法用统一的 `error.code` 聚合告警。

2. **问题 2：响应包装不一致**
   有的接口返回 `{ data: {...} }`，有的直接返回 `{...}`，有的返回数组 `[...]`。前端每个接口都要记"这个要不要 `.data`"。新人接手时踩坑率极高。

3. **问题 3：类型漂移（Type Drift）**
   后端 DTO 用 TypeScript interface 手写，前端类型也手写一份。后端加一个字段，前端不知道；前端把 `status` 当成 `string`，后端其实是枚举。两份类型各自演化，线上才发现对不上。**必须有单一事实源（Single Source of Truth）**：后端定义 → 生成 OpenAPI → 生成前端类型。

4. **问题 4：版本演进破坏旧客户端**
   服务端给 `POST /anomaly-hook` 加了个必填字段 `severity`，旧客户端不带这个字段，8% 请求突然变 400。或者反过来：服务端在响应里加了个新字段 `retryCount`，旧的严格前端把"未知字段"当 fatal error 拒绝渲染。**必须定义 additive change 规则 + 弃用期 + 消费者合同测试**。

---

## 1. 今天要交付的功能模块

在 `p1-monitor` 里交付一套 **API 合同基础设施**：定义版本化的 `ApiEnvelope<T>`（统一响应包装）和 `ApiError`（统一错误 DTO），用一个全局 `HttpExceptionFilter` 把 REST/WS/SSE 三通道的错误都映射到同一份 `ApiError` 结构；用 `@nestjs/swagger` 从后端 DTO 生成 OpenAPI 文档，再用 `openapi-typescript` 生成前端类型（单一事实源）；用 Zod schema 做运行时校验；最后写消费者合同测试锁死"前端假设的字段 = 后端实际返回的字段"。

### 1.1 用户能看到什么

**场景**：运维工程师触发一次告警诊断，恰好 LLM Provider 正在限流（429）。

```
统一之前（v1）：

REST 触发     → 前端 catch: error.error.code === 'RATE_LIMITED'  → 弹窗"请求过多，请稍后"
WS 推送错误    → 前端 onmessage: msg === 'rate limited'（字符串匹配）→ toast "rate limited"
SSE 流错误     → 前端 onerror: JSON.parse(raw).error.type === 'rate_limit_exceeded' → 控制台报错，UI 无反馈

同一个 429，三种代码路径、三种文案、一个还漏了。


统一之后（v3）：

三条通道的错误都被服务端映射成同一份 ApiError：
{
  "apiVersion": "1.0",
  "error": {
    "code": "RATE_LIMITED",
    "message": "LLM 服务限流，系统将在 3 秒后自动重试",
    "retryable": true,
    "retryAfterMs": 3000,
    "traceId": "tr-abc123"
  }
}

前端只有一个 errorHandler：
- 读 error.code → 统一文案表
- 读 error.retryable → 决定是否显示"重试中"
- 读 error.traceId → 埋点/复制给运维

用户在三种触发方式下看到完全一致的错误提示："LLM 服务限流，3 秒后自动重试"，
并且可以一键复制 traceId。
```

### 1.2 这个模块在项目里承担什么

- **输入**：三条通道（REST controller 抛的异常、WS gateway 抛的异常、SSE 流里 Provider 返回的错误）
- **输出**：统一的 `ApiEnvelope<T>`（成功）/ `ApiError`（失败）结构 + OpenAPI 文档 + 生成的前端类型 + 消费者合同测试
- **对齐后续**：今天定义的 **`ApiError` 错误码枚举**、**`apiVersion` 版本策略**、**消费者合同测试** 是 Day 23-30（数据层 / 鉴权 / 限流 / RAG）以及 Day 61-90（p2 多 Agent 工作台跨服务通信）的地基。Day 30 M3 门禁会要求"任何对外错误都必须有稳定的 `error.code` 和 `traceId`"

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 三通道各自的错误格式（现状基线） | REST filter 各写各的、WS 推字符串、SSE 透传 Provider | 现状问题识别、错误格式的熵 |
| **v1 痛点** | 前端三套解析分支、同一错误三种文案、类型手写漂移 |  |  |
| **v2** | v1 + **统一 `ApiError` DTO** + **全局 HttpExceptionFilter** + **OpenAPI 生成前端类型** | 抽出 `contract/` 层（envelope/error/error-code）+ 全局 filter + swagger | 统一错误码设计、异常过滤器、OpenAPI、类型生成 |
| **v2 痛点** | 版本演进无策略——加必填字段破坏旧客户端；无合同测试，改字段线上才发现 |  |  |
| **v3** | v2 + **版本兼容策略**（additive change + 弃用期）+ **Zod 运行时校验** + **消费者合同测试** | 完整分层（contract/validation/versioning）+ contract test 套件 | additive/breaking change 分类、弃用期、Zod、消费者驱动合同测试（CDC） |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：API 合同涉及多个关注点（统一响应包装 / 统一错误 DTO / 三通道异常映射 / OpenAPI 生成 / 运行时校验 / 版本策略 / 合同测试），如果不先立起骨架，写到一半就会把"错误码枚举"散在各个 controller、把"响应包装"糊在每个 service 的返回值里、把"版本兼容"忘在脑后直到线上炸掉。看完这棵树，下面章节再出现 `contract/error/api-error.dto.ts` 时，你就能立刻定位它在架构中的位置。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── contract/                                   ← 【新增】对外合同层（单一事实源）
│   ├── envelope/
│   │   ├── api-envelope.dto.ts                 ← 统一成功响应包装 ApiEnvelope<T>
│   │   └── api-envelope.interceptor.ts         ← 自动包装 controller 返回值
│   ├── error/
│   │   ├── api-error.dto.ts                    ← 统一错误 DTO（code/message/retryable/traceId）
│   │   ├── error-code.enum.ts                  ← 错误码枚举（单一事实源）
│   │   ├── api-exception.ts                    ← 业务异常基类（携带 error-code）
│   │   ├── http-exception.filter.ts            ← 全局异常过滤器（REST）
│   │   ├── ws-exception.filter.ts              ← WS 异常过滤器
│   │   └── http-exception.filter.spec.ts       ← 过滤器单元测试
│   ├── validation/
│   │   ├── zod-validation.pipe.ts              ← Zod 运行时校验管道
│   │   └── zod-validation.pipe.spec.ts         ← 校验管道单元测试
│   ├── versioning/
│   │   ├── api-version.ts                      ← 版本常量 + 兼容策略（纯函数）
│   │   └── api-version.spec.ts                 ← 版本兼容单元测试
│   └── index.ts                                ← 桶文件
├── agent/                                       ← 【Day 12-21 已有】需接入统一 filter
├── anomaly/                                     ← 【已有】需接入统一 filter
├── main.ts                                      ← 【已有】挂全局 filter + interceptor + swagger
└── ...

apps/api/test/
└── contract/
    ├── agent-run.contract.spec.ts              ← 【新增】消费者合同测试：GET /agent/runs/:id
    └── anomaly-hook.contract.spec.ts           ← 【新增】消费者合同测试：POST /anomaly-hook

frontend/src/
├── api/
│   ├── generated/
│   │   └── api-types.ts                        ← 【新增】openapi-typescript 生成（不手改）
│   ├── error-handler.ts                        ← 【新增】统一错误处理（读 ApiError）
│   └── error-messages.ts                       ← 【新增】error.code → 中文文案表
└── ...
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `contract/error/error-code.enum.ts` | ✗（错误码散落） | ✓ 集中枚举 | ✓ 同 v2 + 弃用标记 |
| `contract/error/api-error.dto.ts` | ✗ | ✓ 统一结构 | ✓ + `apiVersion` 字段 |
| `contract/error/http-exception.filter.ts` | ✗（各 controller 各写） | ✓ 全局 filter | ✓ 同 v2 |
| `contract/envelope/api-envelope.interceptor.ts` | ✗ | ✓ 自动包装 | ✓ 同 v2 |
| `contract/validation/zod-validation.pipe.ts` | ✗ | ✗ | ✓ 运行时校验 |
| `contract/versioning/api-version.ts` | ✗ | ✗ | ✓ additive/breaking 分类 |
| `frontend/src/api/generated/api-types.ts` | ✗（手写类型） | ✓ OpenAPI 生成 | ✓ 同 v2 |
| `test/contract/*.contract.spec.ts` | ✗ | ✗ | ✓ 消费者合同测试 |

**依赖方向（务必单向，反过来一次都不行）**：

```
main.ts（挂全局 filter/interceptor/swagger）
    │
    ▼
agent/anomaly controllers ──抛──► contract/error/api-exception.ts
    │                                      │
    │                                      └─► contract/error/error-code.enum.ts（纯枚举）
    ▼
contract/error/http-exception.filter.ts ──► contract/error/api-error.dto.ts
contract/envelope/api-envelope.interceptor.ts ──► contract/envelope/api-envelope.dto.ts
contract/validation/zod-validation.pipe.ts ──► （Zod schema，纯运行时）
contract/versioning/api-version.ts ──► （纯函数，不 import 任何 Nest 依赖）

前端：
frontend/src/api/error-handler.ts ──► generated/api-types.ts（生成的类型）
                                  ──► error-messages.ts（code → 文案）
```

**红线**：
- `contract/error/error-code.enum.ts` 里出现 `import { HttpException }` 就是塌方——错误码是纯数据，前后端都要能引用（前端通过生成的类型间接引用）
- 任何 controller 里出现 `throw new Error('rate limited')`（裸字符串）就是塌方——必须 `throw new ApiException(ErrorCode.RATE_LIMITED, ...)`
- `frontend/src/api/generated/api-types.ts` 被手工修改就是塌方——它是生成产物，改了下次生成就覆盖；要改字段去改后端 DTO
- `contract/versioning/api-version.ts` 里出现 `import { PrismaService }` 是塌方——版本兼容判断是纯函数

**动手前先问自己 3 个问题**：

1. 为什么错误码要用 enum 集中定义而不是每个 controller 写字符串？—— 见 §5.4 知识点 1「错误码作为单一事实源」
2. OpenAPI 生成的类型为什么不能手改？—— 见 §5.4 知识点 4「单一事实源与类型漂移」
3. 消费者合同测试和普通 E2E 测试有什么区别？—— 见 §5.4 知识点 6「消费者驱动合同测试」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：装依赖（3 分钟）

按第 5.3 节的代码：

- 后端：`pnpm --filter api add @nestjs/swagger zod`
- 前端类型生成：`pnpm --filter api add -D openapi-typescript`
- 合同测试：`pnpm --filter api add -D supertest @types/supertest`（Day 10 可能已装）

**边写边问自己**：

- 为什么用 `zod` 而不是 `class-validator`？（zod 的 schema 可以复用为 TypeScript 类型 `z.infer<>`，前后端共享一份；class-validator 只能校验不能导出类型）
- `openapi-typescript` 是运行时依赖还是开发依赖？（开发依赖——它只在 build 前生成类型文件，运行时不需要）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `apps/api/src/contract/` 下建 4 个子目录：

```
contract/
├── envelope/
├── error/
├── validation/
└── versioning/
```

**边写边问自己**：

- 为什么 `error/` 和 `envelope/` 分开？（error 是失败路径，envelope 是成功路径包装；两者独立演化）
- 为什么 `versioning/` 单独一层？（版本兼容是"跨接口"的横切策略，不属于任何单个 error 或 envelope）

### 1.5.3 D-3：写 error-code 枚举 + ApiError DTO（4 分钟）

按第 5.3 节的代码：

- 写 `contract/error/error-code.enum.ts`（错误码集中枚举 + `retryable` 映射）
- 写 `contract/error/api-error.dto.ts`（统一错误结构 + swagger 装饰器）
- 写 `contract/error/api-exception.ts`（业务异常基类）

**边写边问自己**：

- 错误码用字符串 enum（`RATE_LIMITED = 'RATE_LIMITED'`）而不是数字 enum，为什么？（字符串在日志/网络里可读；数字 enum 序列化后是 `3`，运维看不懂）
- `retryable` 为什么绑在错误码上而不是每次抛异常时手填？（同一个错误码的可重试性是固定的领域知识，绑在枚举上避免"同一个错误有时说能重试有时说不能"）

### 1.5.4 D-4：写全局 filter + interceptor（6 分钟）

按第 5.3 节的代码：

- 写 `contract/error/http-exception.filter.ts`（捕获所有异常 → 映射 ApiError）
- 写 `contract/error/ws-exception.filter.ts`（WS 通道的异常映射）
- 写 `contract/envelope/api-envelope.dto.ts` + `api-envelope.interceptor.ts`（自动包装成功响应）
- 在 `main.ts` 里 `app.useGlobalFilters(...)` + `app.useGlobalInterceptors(...)`

**边写边问自己**：

- filter 和 interceptor 的执行顺序？（interceptor 先包装成功响应；如果抛异常，interceptor 不处理，交给 filter；filter 是"最后一道兜底"）
- WS 为什么要单独的 filter？（WS 的异常上下文是 `WsArgumentsHost` 而不是 `HttpArgumentsHost`，拿不到 `response.status()`，要用 `client.emit('error', ...)`）

### 1.5.5 D-5：写 validation + versioning + 合同测试 + 前端类型生成（5 分钟）

按第 5.3 节的代码：

- 写 `contract/validation/zod-validation.pipe.ts`（Zod 运行时校验）
- 写 `contract/versioning/api-version.ts`（additive/breaking 分类纯函数）
- 写 `test/contract/agent-run.contract.spec.ts`（消费者合同测试）
- 配置 swagger + 生成前端类型：`pnpm --filter api openapi:gen`（package.json script）
- 写 `frontend/src/api/error-handler.ts` + `error-messages.ts`

**边写边问自己**：

- Zod pipe 校验失败时抛什么？（`ApiException(ErrorCode.VALIDATION_FAILED, ...)`，让它走统一 filter，前端拿到统一格式）
- 消费者合同测试断言什么？（前端"假设存在"的字段，后端真实响应里必须存在且类型一致——见 §5.3）
- 前端类型生成放在 build 之前还是之后？（之前——`prebuild` 钩子里跑 `openapi:gen`，保证 build 时用的是最新类型）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 30 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"各自为政→统一 DTO→版本策略+合同测试"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `http-exception.filter.ts` 和 `agent-run.contract.spec.ts` | 能口述"三通道异常如何汇聚到一个 filter"、"合同测试锁死了什么" |
| C：读深挖 | 30 min | §6.5 前端底子补弱（`Day22深挖-前端底子补弱.html`） | 能回答"OpenAPI 生成的类型如何避免手写漂移" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 20 min | §7.6 filter/pipe/version/contract 四类测试 | `pnpm --filter api test contract` 全绿 |
| F-1：反证 1 | 5 min | §7.7 手动去掉全局 filter，观察三通道错误格式重新分裂 | 验证"没有统一 filter 是什么样子" |
| F-2：反证 2 | 5 min | §7.8 手动给后端 DTO 加必填字段但不改前端，跑合同测试 | 观察合同测试变红，验证"合同测试如何拦截漂移" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day22` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：现状——三通道各自为政（合同治理前的基线）

### 3.1 v1 要实现什么

v1 不是"要新写"的代码，而是**如实记录现状**：REST/WS/SSE 三条通道当前各自返回什么错误格式，前端各自怎么解析。把现状原样摆出来，才能看清痛点。

**现状（Day 21 结束时的真实代码）**：
- REST：每个 controller 的 `catch` 各写各的 `{ error: ... }`
- WS：gateway 直接 `client.emit('error', 'rate limited')`（裸字符串）
- SSE：Provider 错误直接 `res.write(\`data: ${JSON.stringify(providerError)}\n\n\`)`

### 3.2 v1 目录结构

```
apps/api/src/
├── agent/agent.controller.ts       ← REST：自己 catch 自己包 { error }
├── agent/agent.gateway.ts          ← WS：emit 裸字符串
├── agent/agent-sse.controller.ts   ← SSE：透传 Provider 原始错误
└── （没有 contract/ 层）

frontend/src/
├── api/rest-client.ts              ← catch: 读 error.error.code
├── ws/ws-client.ts                 ← onmessage: 字符串匹配
└── agent/stream/useSseStream.ts    ← onerror: JSON.parse Provider 结构
```

### 3.3 v1 完整代码

**apps/api/src/agent/agent.controller.ts（v1 现状片段）**

```typescript
import { Controller, Get, Param, NotFoundException } from '@nestjs/common'

@Controller('agent/runs')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get(':id')
  async getRun(@Param('id') id: string) {
    const run = await this.agentService.findRun(id)
    if (!run) {
      // v1：每个 controller 自己决定错误格式
      throw new NotFoundException({ error: { code: 'RUN_NOT_FOUND', msg: '找不到' } })
    }
    // v1：有的接口包 data，有的不包
    return { data: run }
  }

  @Get()
  async listRuns() {
    // v1：这个接口直接返回数组，不包 data
    return this.agentService.listRuns()
  }
}
```

**apps/api/src/agent/agent.gateway.ts（v1 现状片段）**

```typescript
import { WebSocketGateway, SubscribeMessage, WsResponse } from '@nestjs/websockets'

@WebSocketGateway({ path: '/ws' })
export class AgentGateway {
  @SubscribeMessage('subscribe-metrics')
  async handleSubscribe(client: Socket, payload: { serverId: string }) {
    try {
      const stream = await this.metricsService.subscribe(payload.serverId)
      return { event: 'metrics', data: stream }
    } catch (err) {
      // v1：WS 错误推裸字符串
      client.emit('error', 'rate limited')
    }
  }
}
```

**apps/api/src/agent/agent-sse.controller.ts（v1 现状片段）**

```typescript
@Controller('agent/runs')
export class AgentSseController {
  @Sse(':id/stream')
  streamRun(@Param('id') id: string): Observable<MessageEvent> {
    return this.agentService.runStream(id).pipe(
      catchError((providerError) => {
        // v1：SSE 直接透传 Provider 原始错误
        return of({
          data: JSON.stringify({ type: 'error', raw: providerError }),
        } as MessageEvent)
      }),
    )
  }
}
```

**frontend/src/api/rest-client.ts（v1 现状片段）**

```typescript
export async function getRun(id: string) {
  const res = await fetch(`/agent/runs/${id}`)
  if (!res.ok) {
    const body = await res.json()
    // v1：前端要知道 REST 的错误在 body.error.code
    throw new Error(body.error?.code ?? 'UNKNOWN')
  }
  const body = await res.json()
  // v1：前端要记住这个接口包了 data
  return body.data
}
```

### 3.4 v1 暴露的痛点

**痛点 1：同一个 429 三种解析路径、三种文案**

REST 里前端读 `body.error.code === 'RATE_LIMITED'`，WS 里做字符串匹配 `msg === 'rate limited'`，SSE 里解析 `JSON.parse(raw).error.type === 'rate_limit_exceeded'`。三段代码、三种文案，其中 SSE 那段还因为 Provider 换了结构而静默失效。

**痛点 2：响应包装不一致，前端每个接口都要记**

`getRun` 返回 `{ data: run }`（要 `.data`），`listRuns` 返回数组（不要 `.data`）。前端调用方每次都要翻后端代码确认"这个到底包没包 data"。新人 100% 踩坑。

**痛点 3：类型手写，两端各自漂移**

前端 `rest-client.ts` 里 `run` 的类型是手写的 `interface Run { id: string; status: string }`。后端 `status` 其实是 8 值枚举（Day 13 定义的 `ExecutionStatus`）。前端写 `if (run.status === 'done')`——后端根本没有 `'done'` 这个值，是 `'completed'`。编译器发现不了，线上才暴露。

**痛点 4：没有 traceId，跨通道无法关联**

REST 报错、WS 断流、SSE 中断是同一次请求引发的，但三个错误没有共同的 `traceId`（Day 18 虽然做了 trace，但没进对外错误结构）。运维拿到用户截图，无法关联到后端日志。

---

## 4. v2：统一 Error DTO + Envelope + 全局 filter + OpenAPI

### 4.1 v2 要实现什么

用户视角（这里的"用户"是前端开发者和运维）：无论 REST/WS/SSE 哪条通道，错误都是同一个 `ApiError` 结构（`code` / `message` / `retryable` / `traceId` / `details?`）；成功响应统一包 `ApiEnvelope`（`data` + `meta`）；后端用 swagger 装饰器声明 OpenAPI，前端用 `openapi-typescript` 生成类型，消除手写漂移。

**目标**：
- 定义 `ErrorCode` 枚举 + `ApiError` DTO
- 全局 `HttpExceptionFilter` + `WsExceptionFilter`：所有异常汇聚成 `ApiError`
- 全局 `ApiEnvelopeInterceptor`：所有成功响应包成 `{ data, meta }`
- swagger 装饰器 + `openapi:gen` 生成前端类型

**依然不做**：
- 不做版本兼容策略（additive/breaking 分类）
- 不做消费者合同测试（类型漂移在编译期能抓一部分，但"前端假设的字段后端删了"还抓不住）

### 4.2 v2 目录结构

```
apps/api/src/contract/
├── envelope/
│   ├── api-envelope.dto.ts          ← 新增：{ data, meta } 结构
│   └── api-envelope.interceptor.ts  ← 新增：自动包装成功响应
└── error/
    ├── error-code.enum.ts           ← 新增：错误码集中枚举 + retryable 映射
    ├── api-error.dto.ts             ← 新增：统一错误结构
    ├── api-exception.ts             ← 新增：业务异常基类
    ├── http-exception.filter.ts     ← 新增：REST 异常映射
    └── ws-exception.filter.ts       ← 新增：WS 异常映射
```

### 4.3 v2 完整代码

**apps/api/src/contract/error/error-code.enum.ts（v2 全文）**

```typescript
/**
 * 错误码集中枚举。字符串 enum：网络/日志里可读。
 * 新增错误码必须同时在 RETRYABLE 里声明可重试性。
 */
export enum ErrorCode {
  // 客户端错误（4xx）
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  RUN_NOT_FOUND = 'RUN_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  APPROVAL_EXPIRED = 'APPROVAL_EXPIRED',
  // 服务端/依赖错误（5xx / 依赖）
  RATE_LIMITED = 'RATE_LIMITED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  DB_UNAVAILABLE = 'DB_UNAVAILABLE',
  INTERNAL = 'INTERNAL',
}

/** 每个错误码到 HTTP 状态码的映射 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.RUN_NOT_FOUND]: 404,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.APPROVAL_EXPIRED]: 409,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.PROVIDER_ERROR]: 502,
  [ErrorCode.DB_UNAVAILABLE]: 503,
  [ErrorCode.INTERNAL]: 500,
}

/** 可重试性绑定在错误码上（领域知识，不由调用方临时决定） */
export const ERROR_RETRYABLE: Record<ErrorCode, boolean> = {
  [ErrorCode.VALIDATION_FAILED]: false,
  [ErrorCode.RUN_NOT_FOUND]: false,
  [ErrorCode.UNAUTHORIZED]: false,
  [ErrorCode.FORBIDDEN]: false,
  [ErrorCode.APPROVAL_EXPIRED]: false,
  [ErrorCode.RATE_LIMITED]: true,
  [ErrorCode.PROVIDER_ERROR]: true,
  [ErrorCode.DB_UNAVAILABLE]: true,
  [ErrorCode.INTERNAL]: false,
}
```

**apps/api/src/contract/error/api-error.dto.ts（v2 全文）**

```typescript
import { ApiProperty } from '@nestjs/swagger'
import { ErrorCode } from './error-code.enum'

/**
 * 对外统一错误结构。三通道（REST/WS/SSE）共用。
 * swagger 装饰器让它进入 OpenAPI，前端由此生成类型。
 */
export class ApiErrorDto {
  @ApiProperty({ enum: ErrorCode, description: '机器可读错误码' })
  code!: ErrorCode

  @ApiProperty({ description: '给最终用户看的中文消息' })
  message!: string

  @ApiProperty({ description: '前端是否可以自动重试' })
  retryable!: boolean

  @ApiProperty({ description: '全链路追踪 ID，用于关联后端日志' })
  traceId!: string

  @ApiProperty({ required: false, description: '结构化细节（如校验失败的字段）' })
  details?: Record<string, unknown>
}
```

**apps/api/src/contract/error/api-exception.ts（v2 全文）**

```typescript
import { ErrorCode, ERROR_HTTP_STATUS, ERROR_RETRYABLE } from './error-code.enum'

/**
 * 业务异常基类。抛它就能保证进入统一 filter 后
 * 拿到正确的 HTTP 状态码和 retryable 标记。
 */
export class ApiException extends Error {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.httpStatus = ERROR_HTTP_STATUS[code]
    this.retryable = ERROR_RETRYABLE[code]
    this.details = details
  }
}
```

**apps/api/src/contract/error/http-exception.filter.ts（v2 全文）**

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { ApiException } from './api-exception'
import { ErrorCode, ERROR_HTTP_STATUS, ERROR_RETRYABLE } from './error-code.enum'
import type { ApiErrorDto } from './api-error.dto'

/**
 * 捕获所有异常，映射成统一 ApiErrorDto。
 * 优先级：ApiException（业务） > HttpException（框架） > 未知（兜底 INTERNAL）
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter')

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    // traceId 由 Day 18 的中间件挂在 request 上
    const traceId = (request as Request & { traceId?: string }).traceId ?? 'no-trace'

    const apiError = this.toApiError(exception, traceId)

    // 5xx 记 error 日志，4xx 记 warn（不刷屏）
    if (apiError.__httpStatus >= 500) {
      this.logger.error(`[${traceId}] ${apiError.code}: ${apiError.message}`, exception instanceof Error ? exception.stack : undefined)
    } else {
      this.logger.warn(`[${traceId}] ${apiError.code}: ${apiError.message}`)
    }

    const { __httpStatus, ...body } = apiError
    response.status(__httpStatus).json(body)
  }

  private toApiError(
    exception: unknown,
    traceId: string,
  ): ApiErrorDto & { __httpStatus: number } {
    if (exception instanceof ApiException) {
      return {
        code: exception.code,
        message: exception.message,
        retryable: exception.retryable,
        traceId,
        details: exception.details,
        __httpStatus: exception.httpStatus,
      }
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      // 框架异常映射到最接近的错误码
      const code = status === 404 ? ErrorCode.RUN_NOT_FOUND
        : status === 401 ? ErrorCode.UNAUTHORIZED
        : status === 403 ? ErrorCode.FORBIDDEN
        : status === 400 ? ErrorCode.VALIDATION_FAILED
        : ErrorCode.INTERNAL
      return {
        code,
        message: exception.message,
        retryable: ERROR_RETRYABLE[code],
        traceId,
        __httpStatus: status,
      }
    }
    // 未知异常：兜底 INTERNAL，绝不把原始 stack 泄漏给客户端
    return {
      code: ErrorCode.INTERNAL,
      message: '服务器内部错误',
      retryable: false,
      traceId,
      __httpStatus: ERROR_HTTP_STATUS[ErrorCode.INTERNAL],
    }
  }
}
```

**apps/api/src/contract/error/ws-exception.filter.ts（v2 全文）**

```typescript
import { Catch, ArgumentsHost } from '@nestjs/common'
import { BaseWsExceptionFilter } from '@nestjs/websockets'
import { Socket } from 'socket.io'
import { ApiException } from './api-exception'
import { ErrorCode } from './error-code.enum'

/**
 * WS 通道的异常映射。
 * WS 拿不到 HTTP response.status()，改用 client.emit('error', ApiError)。
 * 关键：emit 的 payload 结构和 REST 的 body 完全一致（前端用同一个 handler）。
 */
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>()
    const traceId = (client.handshake as { traceId?: string }).traceId ?? 'no-trace'

    const apiError =
      exception instanceof ApiException
        ? {
            code: exception.code,
            message: exception.message,
            retryable: exception.retryable,
            traceId,
            details: exception.details,
          }
        : {
            code: ErrorCode.INTERNAL,
            message: '服务器内部错误',
            retryable: false,
            traceId,
          }

    client.emit('error', apiError)
  }
}
```

**apps/api/src/contract/envelope/api-envelope.dto.ts（v2 全文）**

```typescript
import { ApiProperty } from '@nestjs/swagger'

/** 成功响应的 meta 部分 */
export class ApiMetaDto {
  @ApiProperty({ description: '全链路追踪 ID' })
  traceId!: string

  @ApiProperty({ description: '服务端处理时间戳（ISO）' })
  timestamp!: string
}

/**
 * 成功响应统一包装 { data, meta }。
 * 用泛型基类描述，具体 data 类型由各接口的 @ApiOkResponse 声明。
 */
export class ApiEnvelopeDto<T> {
  data!: T
  meta!: ApiMetaDto
}
```

**apps/api/src/contract/envelope/api-envelope.interceptor.ts（v2 全文）**

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Request } from 'express'

/**
 * 自动把 controller 返回的裸数据包成 { data, meta }。
 * controller 里 return run，客户端收到 { data: run, meta: {...} }。
 * SSE 流式响应不经过这里（SSE 用 @Sse 装饰器，走 message-event 通道）。
 */
@Injectable()
export class ApiEnvelopeInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { traceId?: string }>()
    const traceId = request.traceId ?? 'no-trace'

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {
          traceId,
          timestamp: new Date().toISOString(),
        },
      })),
    )
  }
}
```

**apps/api/src/agent/agent.controller.ts（v2 改造后）**

```typescript
import { Controller, Get, Param } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { ApiException } from '../contract/error/api-exception'
import { ErrorCode } from '../contract/error/error-code.enum'
import { AgentRunDto } from './dto/agent-run.dto'

@ApiTags('agent-runs')
@Controller('agent/runs')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get(':id')
  @ApiOkResponse({ type: AgentRunDto })
  async getRun(@Param('id') id: string): Promise<AgentRunDto> {
    const run = await this.agentService.findRun(id)
    if (!run) {
      // v2：抛统一异常，filter 会映射成 ApiError
      throw new ApiException(ErrorCode.RUN_NOT_FOUND, `找不到运行记录 ${id}`)
    }
    // v2：直接 return 裸数据，interceptor 自动包 { data, meta }
    return run
  }

  @Get()
  @ApiOkResponse({ type: [AgentRunDto] })
  async listRuns(): Promise<AgentRunDto[]> {
    return this.agentService.listRuns()
  }
}
```

**apps/api/package.json（新增 openapi:gen script）**

```json
{
  "scripts": {
    "openapi:gen": "ts-node scripts/gen-openapi.ts && openapi-typescript openapi.json -o ../frontend/src/api/generated-types.ts",
    "prebuild": "pnpm openapi:gen"
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：没有版本兼容策略，加字段就炸旧客户端**

后端给 `AgentRunDto` 加了个必填字段 `tenantId`。旧前端（还没重新生成类型）发的请求没带这个字段，Zod 校验失败返回 400，8% 老客户端集体报错。v2 的 OpenAPI 能生成类型，但**没有规则约束"什么改动算 additive、什么算 breaking"**，改字段全凭手感。

**痛点 2：类型生成能防"字段类型不一致"，防不住"字段被删"**

`openapi-typescript` 生成的类型能让前端 `run.status` 的取值范围对上后端枚举。但如果后端某天删了 `details` 字段，前端重新生成类型后 `run.details` 就没了——**编译时前端还没重新生成，运行时才发现 `undefined`**。需要消费者合同测试：前端声明"我依赖这些字段"，后端 CI 跑合同测试验证这些字段还在。

**痛点 3：新客户端把未知字段当 fatal**

反过来，后端 additive 加了个可选字段 `costUsd`，新前端的严格 schema 校验（Day 15 的 audit-schema 白名单思路）把未知字段当作错误拒绝。additive change 本应向前兼容，却因为前端"默认拒绝未知字段"而变成 breaking。需要明确区分"审计白名单"（安全场景，拒绝未知）和"响应解析"（兼容场景，忽略未知）。

---

## 5. v3：版本兼容策略 + 消费者合同测试（终态）

### 5.1 v3 要实现什么

用户视角：
1. 后端 DTO 改动被明确分类为 additive（可选加字段/加枚举值）或 breaking（删字段/改类型/加必填），breaking 走弃用期
2. 前端用"兼容解析器"（`parseCompat`）忽略未知字段、对缺失可选字段给默认值，不再把 additive 改动当 fatal
3. 消费者合同测试：前端声明"依赖哪些字段"，后端 CI 跑测试验证这些字段没被删/没改类型
4. 三通道（REST/WS/SSE）的 429 展示同一套文案（继承 v2）
5. 类型漂移为 0：CI 里 `openapi:gen` 后 `git diff --exit-code` 保证生成类型已提交

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/contract/
├── envelope/                        ← v2 已有
├── error/                           ← v2 已有
└── versioning/
    ├── change-policy.ts             ← 新增：additive/breaking 分类规则（纯函数）
    ├── change-policy.spec.ts        ← 新增：分类规则单元测试
    └── deprecation.registry.ts      ← 新增：弃用字段登记 + 弃用期

apps/frontend/src/api/
├── generated-types.ts               ← 生成物（勿手改）
├── parse-compat.ts                  ← 新增：兼容解析器（忽略未知 + 默认值）
├── parse-compat.spec.ts             ← 新增：兼容解析单元测试
└── contract/
    ├── consumer-contract.ts         ← 新增：前端声明依赖的字段
    └── consumer-contract.spec.ts    ← 新增：消费者合同测试（后端 CI 也跑）
```

### 5.3 v3 完整代码

#### 5.3.1 后端：change-policy.ts（改动分类纯函数）

```typescript
// apps/api/src/contract/versioning/change-policy.ts

/** 单个字段的 schema 描述（从 OpenAPI schema 抽取的最小信息） */
export interface FieldShape {
  name: string
  type: string          // 'string' | 'number' | 'boolean' | 'object' | ...
  required: boolean
}

export type SchemaShape = Record<string, FieldShape>

export type ChangeKind = 'additive' | 'breaking' | 'none'

export interface ChangeReport {
  kind: ChangeKind
  reasons: string[]
}

/**
 * 比较新旧两个 schema，判定改动是 additive 还是 breaking。
 *
 * 规则：
 *   - additive（向前兼容）：新增可选字段、新增枚举值、把必填改为可选
 *   - breaking（不兼容）：删字段、改类型、新增必填字段、把可选改为必填
 *
 * 纯函数：输入两个 shape，输出报告；不查网络、不读文件。
 */
export function classifyChange(
  oldShape: SchemaShape,
  newShape: SchemaShape,
): ChangeReport {
  const reasons: string[] = []
  let breaking = false
  let additive = false

  // 检查旧字段：删除或改类型 = breaking
  for (const [name, oldField] of Object.entries(oldShape)) {
    const newField = newShape[name]
    if (!newField) {
      breaking = true
      reasons.push(`字段 "${name}" 被删除（breaking）`)
      continue
    }
    if (newField.type !== oldField.type) {
      breaking = true
      reasons.push(`字段 "${name}" 类型从 ${oldField.type} 改为 ${newField.type}（breaking）`)
    }
    if (!oldField.required && newField.required) {
      breaking = true
      reasons.push(`字段 "${name}" 从可选变必填（breaking）`)
    }
    if (oldField.required && !newField.required) {
      additive = true
      reasons.push(`字段 "${name}" 从必填变可选（additive）`)
    }
  }

  // 检查新字段：新增必填 = breaking，新增可选 = additive
  for (const [name, newField] of Object.entries(newShape)) {
    if (oldShape[name]) continue
    if (newField.required) {
      breaking = true
      reasons.push(`新增必填字段 "${name}"（breaking）`)
    } else {
      additive = true
      reasons.push(`新增可选字段 "${name}"（additive）`)
    }
  }

  if (breaking) return { kind: 'breaking', reasons }
  if (additive) return { kind: 'additive', reasons }
  return { kind: 'none', reasons: [] }
}
```

#### 5.3.2 后端：change-policy.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { classifyChange, type SchemaShape } from './change-policy'

const base: SchemaShape = {
  id: { name: 'id', type: 'string', required: true },
  status: { name: 'status', type: 'string', required: true },
}

describe('classifyChange', () => {
  it('无变化返回 none', () => {
    expect(classifyChange(base, base).kind).toBe('none')
  })

  it('新增可选字段是 additive', () => {
    const next: SchemaShape = { ...base, costUsd: { name: 'costUsd', type: 'number', required: false } }
    expect(classifyChange(base, next).kind).toBe('additive')
  })

  it('新增必填字段是 breaking', () => {
    const next: SchemaShape = { ...base, tenantId: { name: 'tenantId', type: 'string', required: true } }
    const report = classifyChange(base, next)
    expect(report.kind).toBe('breaking')
    expect(report.reasons[0]).toContain('tenantId')
  })

  it('删除字段是 breaking', () => {
    const next: SchemaShape = { id: base.id }
    expect(classifyChange(base, next).kind).toBe('breaking')
  })

  it('改字段类型是 breaking', () => {
    const next: SchemaShape = { ...base, status: { name: 'status', type: 'number', required: true } }
    expect(classifyChange(base, next).kind).toBe('breaking')
  })

  it('必填变可选是 additive（向前兼容）', () => {
    const next: SchemaShape = { ...base, status: { name: 'status', type: 'string', required: false } }
    expect(classifyChange(base, next).kind).toBe('additive')
  })
})
```

#### 5.3.3 后端：deprecation.registry.ts

```typescript
// apps/api/src/contract/versioning/deprecation.registry.ts

export interface DeprecatedField {
  dto: string
  field: string
  since: string        // 弃用起始日期（ISO）
  removeAfter: string  // 最早移除日期（ISO），弃用期至少 90 天
  replacement?: string
}

/**
 * 弃用字段登记表。breaking 删字段前必须先在这里登记，
 * 走完弃用期（≥ 90 天）才能真正删除。
 * CI 会检查：removeAfter 未到的字段不允许从 DTO 里删掉。
 */
export const DEPRECATED_FIELDS: readonly DeprecatedField[] = [
  {
    dto: 'AgentRunDto',
    field: 'legacyStatus',
    since: '2026-08-04',
    removeAfter: '2026-11-04',
    replacement: 'executionStatus',
  },
]

/** 判断某字段现在是否允许被物理删除 */
export function canRemoveField(dto: string, field: string, now: Date): boolean {
  const entry = DEPRECATED_FIELDS.find((d) => d.dto === dto && d.field === field)
  if (!entry) return false // 未登记弃用，不允许直接删
  return now >= new Date(entry.removeAfter)
}
```

#### 5.3.4 前端：parse-compat.ts（兼容解析器）

```typescript
// apps/frontend/src/api/parse-compat.ts

/**
 * 兼容解析：用于解析"响应数据"（不是安全审计场景）。
 *   - 忽略未知字段（additive 加字段不报错）
 *   - 缺失的可选字段给默认值
 *
 * 与 Day 15 的 audit-schema 白名单相反：
 *   - audit-schema：安全场景，未知字段 = [redacted]（默认拒绝）
 *   - parse-compat：兼容场景，未知字段忽略（默认放行）
 * 两者用途不同，不可互换。
 */
export interface FieldSpec<T> {
  key: string
  parse: (raw: unknown) => T
  default?: T
}

export function parseCompat<T extends Record<string, unknown>>(
  raw: unknown,
  specs: { [K in keyof T]: FieldSpec<T[K]> },
): T {
  const source = (raw ?? {}) as Record<string, unknown>
  const result = {} as T

  for (const key of Object.keys(specs) as (keyof T)[]) {
    const spec = specs[key]
    const rawValue = source[spec.key]
    if (rawValue === undefined || rawValue === null) {
      if (spec.default !== undefined) {
        result[key] = spec.default
      } else {
        throw new Error(`必填字段缺失：${spec.key}`)
      }
    } else {
      result[key] = spec.parse(rawValue)
    }
  }
  // 未知字段：不复制到 result，静默忽略（这就是"兼容"）
  return result
}

// 常用解析器
export const asString = (v: unknown): string => {
  if (typeof v !== 'string') throw new Error(`期望 string，得到 ${typeof v}`)
  return v
}
export const asNumber = (v: unknown): number => {
  if (typeof v !== 'number') throw new Error(`期望 number，得到 ${typeof v}`)
  return v
}
```

#### 5.3.5 前端：parse-compat.spec.ts

```typescript
import { describe, it, expect } from 'vitest'
import { parseCompat, asString, asNumber } from './parse-compat'

interface RunView {
  id: string
  totalTokens: number
}

const specs = {
  id: { key: 'id', parse: asString },
  totalTokens: { key: 'totalTokens', parse: asNumber, default: 0 },
}

describe('parseCompat', () => {
  it('正常解析', () => {
    const r = parseCompat<RunView>({ id: 'r-01', totalTokens: 120 }, specs)
    expect(r).toEqual({ id: 'r-01', totalTokens: 120 })
  })

  it('忽略未知字段（additive 兼容）', () => {
    const r = parseCompat<RunView>({ id: 'r-01', totalTokens: 120, costUsd: 0.03 }, specs)
    expect(r).toEqual({ id: 'r-01', totalTokens: 120 })
    expect('costUsd' in r).toBe(false)
  })

  it('缺失可选字段给默认值', () => {
    const r = parseCompat<RunView>({ id: 'r-01' }, specs)
    expect(r.totalTokens).toBe(0)
  })

  it('缺失必填字段抛错', () => {
    expect(() => parseCompat<RunView>({ totalTokens: 5 }, specs)).toThrow('必填字段缺失：id')
  })
})
```

#### 5.3.6 前端：consumer-contract.ts + 合同测试

```typescript
// apps/frontend/src/api/contract/consumer-contract.ts

/**
 * 消费者合同：前端在这里声明"我依赖后端返回的哪些字段"。
 * 后端 CI 会 import 这份声明，对照最新 OpenAPI 验证这些字段还在、类型没变。
 * 这样即使前端还没重新生成类型，后端删字段时 CI 就会红。
 */
export const CONSUMER_CONTRACTS = {
  AgentRunDto: {
    requiredFields: [
      { name: 'id', type: 'string' },
      { name: 'executionStatus', type: 'string' },
      { name: 'totalSteps', type: 'number' },
    ],
  },
  ApiErrorDto: {
    requiredFields: [
      { name: 'code', type: 'string' },
      { name: 'message', type: 'string' },
      { name: 'retryable', type: 'boolean' },
      { name: 'traceId', type: 'string' },
    ],
  },
} as const
```

```typescript
// apps/frontend/src/api/contract/consumer-contract.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONSUMER_CONTRACTS } from './consumer-contract'

/**
 * 消费者合同测试：读后端生成的 openapi.json，
 * 验证前端声明依赖的字段都还在、类型对得上。
 * 后端 CI 也跑这个 spec（通过 workspace 引用），
 * 于是后端删字段 / 改类型时这里立刻变红。
 */
function loadOpenApiSchemas(): Record<string, { properties: Record<string, { type: string }>; required?: string[] }> {
  const raw = readFileSync(new URL('../../../../api/openapi.json', import.meta.url), 'utf-8')
  return JSON.parse(raw).components.schemas
}

describe('消费者合同', () => {
  const schemas = loadOpenApiSchemas()

  for (const [dtoName, contract] of Object.entries(CONSUMER_CONTRACTS)) {
    describe(dtoName, () => {
      const schema = schemas[dtoName]

      it('DTO 在 OpenAPI 中存在', () => {
        expect(schema, `${dtoName} 从 OpenAPI 消失了`).toBeDefined()
      })

      for (const field of contract.requiredFields) {
        it(`字段 ${field.name} 存在且类型为 ${field.type}`, () => {
          const prop = schema?.properties?.[field.name]
          expect(prop, `${dtoName}.${field.name} 被删除`).toBeDefined()
          expect(prop.type, `${dtoName}.${field.name} 类型漂移`).toBe(field.type)
        })
      }
    })
  }
})
```

#### 5.3.7 前端：三通道统一错误 handler

```typescript
// apps/frontend/src/api/handle-api-error.ts
import { parseCompat, asString } from './parse-compat'

export interface ApiError {
  code: string
  message: string
  retryable: boolean
  traceId: string
}

const errorSpecs = {
  code: { key: 'code', parse: asString },
  message: { key: 'message', parse: asString },
  retryable: { key: 'retryable', parse: (v: unknown) => Boolean(v), default: false },
  traceId: { key: 'traceId', parse: asString, default: 'no-trace' },
}

/**
 * 三通道（REST body / WS error payload / SSE error frame）
 * 统一走这个函数解析。因为后端保证了三通道结构一致，
 * 前端只需一套 handler、一套文案映射。
 */
export function handleApiError(raw: unknown): ApiError {
  return parseCompat<ApiError>(raw, errorSpecs)
}

/** 错误码到用户文案的唯一映射（429 只有一处文案） */
export const ERROR_MESSAGES: Record<string, string> = {
  RATE_LIMITED: '请求过于频繁，请稍后重试',
  PROVIDER_ERROR: '模型服务暂时不可用，正在重试',
  RUN_NOT_FOUND: '找不到该运行记录',
  INTERNAL: '服务器开小差了，请稍后再试',
}
```

### 5.4 v3 用到的知识点

#### 知识点 1：统一 Error DTO —— 三通道一套错误合同

- **解决的问题**：REST 返回 `{error}`、WS 返回字符串、SSE 返回 Provider 原始错误，前端写三套分支，同一个 429 出现三种文案
- **运行机制**：定义 `ApiErrorDto`（code/message/retryable/traceId），REST 用 `HttpExceptionFilter`、WS 用 `WsExceptionFilter` 都汇聚成这个结构；SSE 的 error frame 也用同结构；前端一个 `handleApiError` 通吃
- **项目落点**：`contract/error/*.ts`；`agent.controller.ts` 抛 `ApiException`；前端 `handle-api-error.ts`
- **生产误区**：把 HTTP 状态码当唯一错误信号（前端拿不到细分 code，无法区分"429 限流可重试"和"429 配额耗尽不可重试"）；错误消息里泄漏 stack trace / SQL / 内部路径；每个通道各自定义错误格式
- **验证方法**：对 REST/WS/SSE 分别触发一个 `RATE_LIMITED`，断言前端收到的三个 payload 结构完全一致、文案是同一条

#### 知识点 2：additive vs breaking 改动分类

- **解决的问题**：改 DTO 全凭手感，加个必填字段就炸 8% 旧客户端；不知道什么改动需要走弃用期
- **运行机制**：`classifyChange(old, new)` 纯函数对比 schema shape：新增可选/加枚举值/必填转可选 = additive；删字段/改类型/新增必填/可选转必填 = breaking；CI 里对 `git` 上一版 OpenAPI 和当前版跑分类，breaking 必须人工审批 + 登记弃用
- **项目落点**：`versioning/change-policy.ts`、`deprecation.registry.ts`
- **生产误区**：把"加字段"一律当安全（新增必填也是加字段，但是 breaking）；breaking 改动不给弃用期直接上线；弃用期太短（< 一个发布周期，慢的客户端还没升级就被删）
- **验证方法**：`change-policy.spec.ts` 覆盖 6 类改动；CI 脚本对真实 OpenAPI diff 跑分类，breaking 时 exit 1

#### 知识点 3：消费者合同测试（Consumer-Driven Contract）

- **解决的问题**：类型生成能防"字段类型不一致"，防不住"后端删了前端依赖的字段"——前端没重新生成类型前，编译期发现不了
- **运行机制**：前端在 `consumer-contract.ts` 声明依赖的字段清单；`consumer-contract.spec.ts` 读后端 `openapi.json` 验证这些字段存在且类型对；**后端 CI 也跑这个 spec**（通过 monorepo workspace 引用），后端删字段时后端 CI 立刻红
- **项目落点**：`frontend/src/api/contract/consumer-contract.ts` + spec；后端 CI pipeline 增加 `pnpm --filter frontend test consumer-contract`
- **生产误区**：只在前端跑合同测试（后端改动时前端 CI 不触发，等下次前端提交才发现，为时已晚）；合同声明所有字段（过度约束，后端删个没人用的字段也红）；合同测试不进 CI（变成一次性文档）
- **验证方法**：手动删后端 `AgentRunDto.executionStatus`，跑后端 CI，`consumer-contract.spec.ts` 必须红

#### 知识点 4：兼容解析 vs 安全白名单（两种"未知字段"策略）

- **解决的问题**：新前端严格拒绝未知字段，导致后端 additive 加字段反而变成 breaking
- **运行机制**：区分两种场景——响应解析用 `parseCompat`（忽略未知、缺失给默认，向前兼容）；安全审计用 Day 15 的 audit-schema 白名单（未知 = redacted，默认拒绝）；同一个"未知字段"在两个场景相反处理
- **项目落点**：`frontend/src/api/parse-compat.ts`（兼容）vs `agent/contract/audit-schema.ts`（安全）
- **生产误区**：全站用一种策略（安全场景放行 = 泄漏；兼容场景拒绝 = additive 变 breaking）；`parseCompat` 用在审计面板（把该 redact 的字段放行）
- **验证方法**：`parse-compat.spec.ts` 断言未知字段被忽略、缺失可选给默认；对比 audit-schema 断言未知字段被 redact

#### 知识点 5：ApiEnvelope —— 成功响应的统一包装

- **解决的问题**：有的接口返回裸数组、有的返回对象、有的把分页信息混在 data 里，前端每个接口单独处理 meta（traceId/分页）
- **运行机制**：全局 `ApiEnvelopeInterceptor` 把 controller 返回值包成 `{ data, meta }`，meta 带 traceId + timestamp；controller 只 return 裸数据，不关心 envelope
- **项目落点**：`contract/envelope/api-envelope.interceptor.ts`；全局注册在 `main.ts`
- **生产误区**：SSE 流也套 envelope（SSE 是逐帧的 message-event，套 envelope 破坏流式语义——本日 interceptor 排除 `@Sse` 路由）；envelope 嵌套 envelope（内部服务间调用又包一层）；meta 里放业务数据（meta 只放横切关注点）
- **验证方法**：E2E 断言 `GET /agent/runs/:id` 返回 `{ data: {...}, meta: { traceId, timestamp } }`；SSE 端点返回裸 message-event 不带 envelope

#### 知识点 6：类型漂移零容忍（生成物入库 + CI diff 校验）

- **解决的问题**：前端手写的类型和后端 DTO 慢慢漂移；或生成的类型没提交，不同开发机生成结果不一致
- **运行机制**：`openapi:gen` 从 swagger 装饰器生成 `openapi.json` → `openapi-typescript` 生成前端 `generated-types.ts`；把生成物提交入库；CI 里 `prebuild` 重新生成后 `git diff --exit-code`，有差异说明"有人改了 DTO 但没重新生成类型"，CI 红
- **项目落点**：`package.json` 的 `openapi:gen` + `prebuild`；CI pipeline 的 `git diff --exit-code`
- **生产误区**：生成物不入库（每次 CI 重新生成，无法 review 类型改动）；`generated-types.ts` 手改（下次生成被覆盖）；只在本地生成不在 CI 校验（漂移照样发生）
- **验证方法**：改后端 DTO 但不跑 `openapi:gen`，CI 的 `git diff --exit-code` 必须红；跑一次生成后 diff 为空

### 5.5 边写边问自己

- `classifyChange` 为什么是纯函数？（只对比两个 shape，不读文件不查网络；这样 6 类改动能 100% 单测覆盖，CI 脚本只负责"读 OpenAPI 喂给它"）
- 消费者合同测试为什么后端 CI 也要跑？（合同的价值在于"后端改动时立刻知道破坏了哪个消费者"；只在前端跑就退化成"前端自己的回归测试"，失去 consumer-driven 的意义）
- `parseCompat` 和 audit-schema 白名单能合并成一个工具吗？（不能——它们对未知字段的默认策略相反：一个放行一个拒绝；合并会逼调用方每次传 flag，比两个清晰的工具更易错）
- Error DTO 里的 `retryable` 为什么由后端定而不是前端判断？（可重试性是领域知识——只有后端知道这个 429 是"限流可重试"还是"配额耗尽不可重试"；前端按状态码猜必然出错）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 三通道各自错误格式 | 统一 Error DTO + Envelope | + 版本兼容策略 + 消费者合同 |
| **错误合同 / 数据模型** | REST `{error}` / WS string / SSE 原始错误 | `ApiErrorDto`（code/message/retryable/traceId） | 同 v2 + `parseCompat` 前端兼容解析 |
| **成功响应** | 裸数组 / 裸对象混用 | `ApiEnvelope { data, meta }` | 同 v2（SSE 排除） |
| **改动分类** | 无，凭手感改 DTO | 无 | `classifyChange` additive/breaking + 弃用登记 |
| **可测试** | 无合同测试 | filter 单测 | + 消费者合同测试（前后端 CI 共跑） |
| **架构层次** | 错误处理散在各 controller | `contract/` 集中 | + `versioning/` 演进策略 |
| **换客户端版本代价** | 加必填炸 8% 旧客户端 | 仍会炸（无兼容解析） | additive 不炸、breaking 走弃用期 |
| **编译期抓遗漏** | 前端手写类型，漂移无感 | 生成类型 | + CI `git diff --exit-code` 零漂移 |
| **对齐后续 Day** | —— | Day 23-30 全栈联调基线 | Day 30 M3 门禁"合同零漂移"硬指标 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的合同治理牵出几个前端/TypeScript 底层机制，独立深挖文档见 `Day22深挖-前端底子补弱.html`，涵盖：

- **深挖 1：TypeScript 结构类型（structural typing）与合同** —— 从 `ApiErrorDto` 讲起，为什么"鸭子类型"让未知字段能被静默接受，`parseCompat` 如何利用这一点
- **深挖 2：`as const` 与字面量类型收窄** —— 从 `CONSUMER_CONTRACTS` 讲起，`as const` 如何把 `type: 'string'` 收窄成字面量而非 `string`，让合同声明能做精确比对
- **深挖 3：泛型约束 `<T extends Record<string, unknown>>`** —— 从 `parseCompat` 讲起，泛型如何在"通用工具"和"类型安全"之间取平衡，对应 PDF 第 2 题"封装 AI 接口请求时怎样应用泛型"
- **深挖 4：JSON 序列化的隐性合同** —— `undefined` vs `null` 在 `JSON.stringify` 里的差异，为什么 additive 加字段前端会收到 `undefined` 而不是键缺失
- **深挖 5：OpenAPI schema 到 TypeScript 的映射规则** —— `openapi-typescript` 如何处理 `nullable`、`oneOf`、枚举，生成物为什么长那样

深挖文档遵循 8 子节结构（场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法），此处不展开动手脚手架。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按 §5.3 的代码，确保以下 spec 全绿：

- `change-policy.spec.ts`：6 类改动分类（none/additive×2/breaking×3）
- `parse-compat.spec.ts`：4 个用例（正常/忽略未知/缺失默认/缺失必填抛错）
- `consumer-contract.spec.ts`：读 OpenAPI 验证 `AgentRunDto` / `ApiErrorDto` 字段存在且类型对
- 后端 filter 单测：REST/WS 异常都映射成 `ApiErrorDto`

运行：

```bash
pnpm --filter api test contract
pnpm --filter frontend test api
```

预期：全绿，消费者合同测试对当前 OpenAPI 通过。

### 7.7 F-1：反证实验 1（5 分钟）—— 删后端依赖字段

手动把 `AgentRunDto` 里的 `executionStatus` 字段注释掉，重新 `pnpm --filter api openapi:gen`，然后跑：

```bash
pnpm --filter frontend test consumer-contract
```

**预期观察**：`consumer-contract.spec.ts` 变红，报 `AgentRunDto.executionStatus 被删除`。这验证了"消费者合同能在后端删字段时立刻报警"，而不是等前端重新生成类型才发现。看完把字段改回来。

### 7.8 F-2：反证实验 2（5 分钟）—— 前端严格解析未知字段

临时把 `parseCompat` 换成"遇到未知字段抛错"的严格版本，然后给后端某个 DTO 加一个可选字段 `costUsd`，重新生成类型并跑前端解析：

**预期观察**：前端把这个 additive 改动当 fatal 报错。这验证了"没有兼容解析时，后端加字段会炸旧客户端"。看完恢复 `parseCompat` 的忽略未知逻辑，再跑一次，additive 改动不再报错。

### 7.9 F-3：验证 + 提交（10 分钟）

四件套 + 类型漂移校验：

```bash
pnpm --filter api openapi:gen        # 重新生成 OpenAPI + 前端类型
git diff --exit-code apps/api/openapi.json apps/frontend/src/api/generated-types.ts
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`git diff --exit-code` 若非空说明"改了 DTO 但没提交生成物"，先 `git add` 生成物。

提交信息模板（Conventional Commits）：

```
refactor(contract): 统一三通道错误合同 + 版本兼容策略 + 消费者合同测试

- 定义 ApiErrorDto（code/message/retryable/traceId），REST/WS/SSE 三通道统一
- ApiEnvelope 包装成功响应（SSE 路由排除）
- classifyChange 分类 additive/breaking，deprecation 登记弃用期
- 前端 parseCompat 兼容解析（忽略未知 + 缺失默认）
- 消费者合同测试进前后端 CI，OpenAPI 生成物入库 + git diff 零漂移校验

Refs: Day22
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day23 结束时集中 push。

---

## 8. 通过标准

- 消费者合同测试覆盖 `AgentRunDto` / `ApiErrorDto` 等关键接口，前后端 CI 都跑
- 类型漂移为 0：`git diff --exit-code` 对生成物为空
- 三通道（REST/WS/SSE）同一个 429 展示同一套文案（同一个 code 映射）
- `classifyChange` 6 类改动分类单测全绿；breaking 改动能在 CI 被拦截
- `parseCompat` 对 additive 加字段兼容（不报错），对缺失必填抛错
- 四件套全绿，commit 含 `Refs: Day22`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day22`，未执行 `git push`）
2. 四件套输出 + `pnpm --filter api openapi:gen` 后 `git diff --exit-code` 为空的证据
3. 学习日志：三通道错误合同统一前后的前端分支数对比
4. 架构证据：合同生命周期图（additive/breaking/弃用期）+ 消费者合同测试在 CI 的位置
5. AI Review 记录：OpenAPI 装饰器 / 类型候选哪些接受、哪些因错误语义被改

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（前端发一个会 429 的请求）到最终输出（用户看到的文案），解释"API 合同"的数据流；当天知识链"DTO、OpenAPI、统一错误、版本兼容、合同测试"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除消费者合同测试（或版本兼容解析），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码（`classifyChange` / `parseCompat` / `consumer-contract.spec.ts`）、测试和架构证据，证明"类型漂移为 0、旧客户端不被 additive 改动破坏"已经达到；再说明距离企业生产标准还缺什么（如契约测试工具 Pact、schema registry），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. REST 返回 `{error}`，WS 返回字符串，SSE 返回 Provider 原始错误；前端为三套分支且同一 429 展示三种文案。请收集合同比对和客户端分支覆盖定位漂移；先统一映射到兼容错误码止损，再定义版本化 Error DTO/OpenAPI，消费者合同验证三通道语义一致。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S24 NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)
2. 服务端新增必填字段后旧客户端 8% 请求变 400，新客户端又把未知字段当 fatal。请用客户端版本、Schema diff 和状态码分布定位；先恢复可选兼容止损，再制定 additive change、弃用期和合同测试，灰度验证新旧版本均通过且类型漂移为 0。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S3 阿里 AI 前端](https://campus-talent.alibaba.com/campus/position/199904460001)

知识映射：DTO、OpenAPI、统一错误、版本兼容和消费者合同测试。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. GraphQL 与 RESTful API 相比有什么差异？
   来源：[《2024字节前端面试题（45题）》](<../../资源/2024字节前端面试题（45题）.pdf>)，第 20 页。
2. TypeScript 泛型是什么？封装 AI 接口请求时怎样应用？
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 1 页。

题目说明：对应 API/DTO 合同、精确数据、OpenAPI 类型生成和接口演进；答题需额外补充统一错误与版本兼容。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 21 的模块边界重构（Ports/Adapters 已把跨模块依赖显式化，今天在此基础上把跨"前后端"的合同也显式化）
- **今天产出**：统一 Error DTO / ApiEnvelope / 版本兼容策略 / 消费者合同测试，是"前后端合同零漂移"的地基
- **指向**：
  - Day 23-29：全栈联调（LLM 集成 / RAG），今天的 Error DTO 和 Envelope 是所有新接口的默认形态
  - Day 30：M3 门禁把"合同零漂移 + 消费者合同测试全绿"列为硬指标
  - Day 61-90：p2-agent-workbench 多 Agent 协同，多个 Agent 服务之间的通信直接复用今天的合同规范
