# Day 15：Agent 时间线（v1 前端裸接 SSE → v2 历史 API 回放 + 合并 → v3 派生状态 + 审计 UI + 持久化恢复）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-07-28 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\frontend`
角色视角：完成 Day 01 前端 reducer + 9 种 AgentEvent、Day 13 后端持久化 + 幂等、Day 14 SSE 合同 v1 + resume + 取消，第一次要把 Day 01 内存里跑的 `AgentRunPanel.vue` 接上真实后端事件流的开发者

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
   Day 15：Agent 时间线（Event reducer + 派生状态 + 持久化恢复 + 审计 UI）  ← 今天在这里
   Day 16-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 15 在阶段一第 5 天**。Day 01 定义了前端 reducer 和 9 种 `AgentEvent`（但事件只跑在 fixture 数组里）、Day 13 让后端把 Run 落到 Postgres、Day 14 让服务端能通过 SSE 把事件实时推给前端。今天要把这三条线合并：**让 Day 01 写的 `AgentRunPanel.vue` 接上真实 SSE 和历史 API，同时能承受 4 种真实网络问题（刷新、重连、乱序、工具失败）**。

### 到 Day 14 结束时项目已具备的能力

- **前端 reducer**（Day 01）：`domain/agent/agent-run-state.ts` 里 9 种 `AgentEvent` 判别联合 + 纯函数 `reduceAgentEvent`，跑在 fixture `sample-run.ts` 上
- **服务端 Agent Loop**（Day 12-13）：Tool Registry、循环调用、预算追踪、Run 持久化、执行状态 8 态、心跳 + stale scanner
- **服务端 SSE**（Day 14）：`AgentEventV1` 版本化合同、`Last-Event-ID` resume、`AbortController` 取消传播、事件审计（DB 表 `agent_events`）
- **前端 SSE 客户端**（Day 14）：`useSseStream` composable、`chunked-parser` UTF-8 断包解码、`resume-tracker` lastEventId 记录、`cancel-signal` AbortController 封装
- **缺失的一块**：Day 01 的 `AgentRunPanel.vue` 里 `receivedEvents` 数组还是 fixture 假数据；刷新页面就丢；用户点开某条 Run 的详情页看不到历史；reducer 一份 state 塞了所有信息，无法单独渲染"Tool 卡片列表"和"审批面板"；运维排查事故时无法回放"这条 Run 到底收到了哪几个原始事件"

### 今天要解决的 4 个问题

1. **问题 1：刷新页面丢失所有状态（内存态）**
   Day 01 的 `App.vue` 里 `receivedEvents = ref<AgentEvent[]>([])` 是内存变量。用户在诊断跑到第 5 秒时不小心 F5 刷新，页面重进后 `receivedEvents.value = []`，UI 从 `idle` 开始渲染——但服务端的 Agent Run 还在跑（Day 13 的 AgentRun 在 DB 里是 `running`），用户看到的是"从未发生过"的假空白页面。**必须在页面挂载时先从后端拉历史事件（`GET /runs/:id/events`）灌进 reducer，再订阅 SSE 拿增量**。

2. **问题 2：历史与实时的合流**
   历史 API 返回 `[event1..event100]`（截止到某个 sequence），SSE 从 sequence 101 开始推——理想情况。但真实情况：历史 API 返回时 SSE 已经在推第 105 号事件了，前端在 t=0 收到"history: 1-100"，t=0.5 收到"stream: 105"，t=1.2 才收到"stream: 101/102/103/104"（乱序到达）。如果直接顺序调用 `reduceAgentEvent`，reducer 在收到 105 时判定"已经跑到 105"，后续 101-104 触发 sequence 去重被吞掉，UI 少 4 个事件。**必须让 reducer 支持"双入口"（history 入口 + stream 入口），并在合并层做去重和排序**。

3. **问题 3：一份 state 塞所有——UI 无法独立渲染**
   Day 01 的 `AgentRunState.timeline` 是**一维扁平数组**，所有 kind（text / tool / approval / error / result）混在一起。今天 UI 要求：Tool 卡片列表要有单独的展开/收起、Approval 面板要有单独的批准/拒绝按钮、Text 输出要作为主区显示。如果直接从 `timeline` 里 `filter(item => item.kind === 'tool')`，每次 reducer 更新都要把整个数组遍历 3 遍（O(3N)），而且组件无法响应"只有 tool 更新时才重渲染 Tool 卡片列表"。**必须把 state 拆成三份派生状态：`RunView` / `ToolListView` / `ApprovalView`，通过 selector 从 raw state 计算**。

4. **问题 4：审计 UI——运维排查事故看不到"原始事件"**
   Day 01 的 timeline 是**解读后的展示层**（"完成 (1800ms)：CPU 平均 87%"），运维事故复盘时需要看到"原始事件"（`{ type: 'tool.succeeded', payload: { callId, resultSummary, durationMs } }`）。今天要在 `AgentRunPanel.vue` 加一个"审计"折叠面板，展示这条 Run 收到的所有原始事件（含 `version`、`sequence`、`occurredAt`），点击可展开 payload JSON。**这也是"隐私红线"的合规基础：审计面板只展示 `AgentEventV1` 合同里的字段，不展示模型的 Chain of Thought（reasoning tokens）**——即使服务端不小心把 CoT 塞进 payload，前端也会 schema 校验拒绝渲染。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/frontend` 里交付一个模块 **`agent/timeline`**：把 Day 01 的 `AgentRunPanel.vue` 从 fixture 数据接上真实后端。挂载时先从 `GET /runs/:id/events` 拉历史事件回放，再通过 Day 14 的 `useSseStream` 订阅增量 SSE；合并层做 sequence 去重和排序；reducer 输出的 raw state 通过 3 个 selector 派生出 Run/Tool/Approval 三个独立视图；面板底部展示"审计"折叠面板显示原始事件流；覆盖刷新、重连、乱序、工具失败四类场景。

### 1.1 用户能看到什么

**场景**：运维工程师打开 `/runs/r-01` 页面查看诊断详情，这条 Run 已经跑了 2 分钟，服务端已存 30 条事件，剩下 20 条即将推送。

```
时间轴：

14:32:00.000  用户导航到 /runs/r-01
  → 前端组件挂载：AgentRunPanel.vue setup 阶段
  → 并行发起两个动作：
     (1) GET /agent/runs/r-01/events?after=-1 拉历史
     (2) new EventSource(...)  订阅 SSE

14:32:00.150  历史 API 返回 30 条事件（sequence 0..29）
  → 前端 reducer 依次消费，state.lastSequence = 29
  → UI 渲染：Run 状态徽章、7 张 Tool 卡片、1 个已批准 Approval、5 段 text.delta

14:32:00.200  SSE 首条消息 (sequence 32)
  → 合并层检查：32 > 29，接受
  → reducer 更新 state.lastSequence = 32
  → UI 增量渲染：新增 1 张 Tool 卡片"loading"

14:32:00.500  SSE 迟到消息 (sequence 30)  ← 网络乱序
  → 合并层检查：30 > 29，接受
  → reducer 更新 state.lastSequence = 32（不回退）
  → 但 timeline 里正确插入 sequence 30 的 tool 卡片
  → UI 增量渲染：sequence 30-32 三张卡片按顺序

14:32:01.200  SSE 收到 tool.failed (sequence 33)
  → reducer 处理：找到 callId 对应的 tool 卡片，更新 detail 为"失败 [rate_limit]"
  → UI：Tool 卡片标红，触发派生 selector 重算 ToolListView

14:32:02.000  用户点击"审计"折叠面板
  → 派生 selector rawEventsView 计算返回 33 条原始事件
  → UI 渲染：每条事件展开 JSON payload
  → 隐私 schema 校验：如果服务端某条事件里含未定义字段 reasoning，
    前端拦截并渲染 [redacted: unknown field]

14:32:05.000  用户 F5 刷新页面
  → 前端 lastEventId 已通过 sessionStorage 持久化 (=33)
  → 组件重挂载：
     (1) GET /agent/runs/r-01/events?after=33 只拉增量历史
     (2) new EventSource(..., { headers: { 'Last-Event-ID': '33' } })
  → 服务端从 sequence 34 开始重放
  → UI：0.3 秒内完整恢复，无闪烁、无重复卡片

14:32:07.000  完全断网 3 秒后网络恢复
  → useSseStream 自动重连，带 Last-Event-ID: 45
  → 服务端从 46 重放
  → UI：无重复渲染（合并层 sequence 去重）
```

**前端观察到的最终结果**：
- 页面加载 < 500ms 内看到完整历史 + 实时事件流
- 刷新后 < 300ms 恢复到刷新前的状态
- 网络断开重连后不重复渲染任何卡片
- 审计面板可以按 sequence 顺序查看每条原始事件，未知字段被替换为 `[redacted]`
- Tool 失败时只有 Tool 卡片区域重渲染，Run 状态徽章和 Text 输出不受影响

### 1.2 这个模块在项目里承担什么

- **输入**：Day 14 的 `useSseStream(runId, lastEventId)` 增量事件流 + 新增的历史 API `GET /agent/runs/:runId/events?after=<seq>` 返回的历史事件数组
- **输出**：`AgentRunPanel.vue` 挂载后 300ms 内渲染完整历史 + 实时增量的时间线；派生 selector 分离 Run/Tool/Approval 三个视图；审计面板可查看原始事件流
- **对齐后续**：今天定义的 **`mergeHistoryAndStream`** 合并规则、**派生 selector** 命名规范、**审计面板** 数据模型，是 Day 16-20 LangChain RAG 流式回答界面、Day 30 M3 端到端门禁、Day 61-90 p2-agent-workbench 多 Agent 协同工作台的展示层地基。Day 30 会要求"任何一次 Agent Run 都必须能从 URL 直接进入并完整恢复"

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | Day 01 的 reducer 直接消费 Day 14 的 SSE 事件，无历史 API 接入 | `AgentRunPanel.vue` 里 `onMounted` 直接 `useSseStream`；`fixtures/sample-run.ts` 被删掉 | SSE 流式消费、`useSseStream` 集成、Vue composable 生命周期 |
| **v1 痛点** | 刷新页面即丢；只能看到"从组件挂载那一刻起"的新事件；已发生的历史看不到 |  |  |
| **v2** | v1 + **历史 API 回放**（挂载时先拉 `/runs/:id/events`）+ **合并层**（去重排序） | 拆出 `history/history-api.ts` + `reducer/merge-history-stream.ts` | REST + SSE 双入口设计、sequence 去重与排序、race condition 处理 |
| **v2 痛点** | reducer 输出的 timeline 是一维数组，Tool/Approval 视图无法独立渲染；运维排查看不到原始事件；隐私红线（CoT）在合同层没有强制 |  |  |
| **v3** | v2 + **派生状态 selector**（Run/Tool/Approval 三视图） + **审计 UI**（原始事件面板 + 隐私 schema 校验）+ **持久化恢复**（sessionStorage lastEventId） | 完整分层（contract/reducer/derived/history/stream/audit/persistence） | Selector 模式、派生状态解耦、原始事件的合同校验、`sessionStorage` 持久化、Vue 3 `computed` 缓存机制 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Agent 时间线涉及前端 5 个关注点（历史 API 客户端 / SSE 流客户端 / 合并层 / reducer + 派生 selector / 审计 UI + 隐私 schema 校验），如果不先在脑子里立起骨架，写到一半就会把"拉历史"和"订阅 SSE"糊在同一个 composable 里、把"合并去重"塞进 reducer、把"派生 selector"当成组件内 computed 藏在 vue 文件里、把"隐私校验"忘在服务端。看完这棵树，下面章节再出现 `frontend/src/agent/reducer/derived/tool-list-view.ts` 时，你就能立刻定位它是"派生状态层"的一个 selector。

**今天在 `p1-monitor/frontend/src/` 下要建立的完整目录树（v3 完整版）**：

```
frontend/src/
├── agent/
│   ├── contract/
│   │   ├── agent-event-v1.ts                   ← 【Day 14 已有】版本化事件合同（前端副本）
│   │   └── audit-schema.ts                     ← 【新增】审计面板的隐私 schema（拒绝渲染未知字段）
│   ├── reducer/
│   │   ├── agent-run-state.ts                  ← 【Day 01 已有，v3 需要新增派生入口】raw state + reducer
│   │   ├── agent-run-state.spec.ts             ← 【Day 01 已有】reducer 单元测试
│   │   ├── merge-history-stream.ts             ← 【新增】历史事件 + SSE 事件合流去重
│   │   ├── merge-history-stream.spec.ts        ← 【新增】合并层单元测试
│   │   └── derived/
│   │       ├── run-view.ts                     ← 【新增】派生 Run 视图（status/summary/error）
│   │       ├── tool-list-view.ts               ← 【新增】派生 Tool 卡片列表视图
│   │       ├── approval-view.ts                ← 【新增】派生 Approval 视图（pending/decided）
│   │       ├── raw-events-view.ts              ← 【新增】派生原始事件视图（审计用）
│   │       └── derived.spec.ts                 ← 【新增】派生 selector 单元测试
│   ├── history/
│   │   ├── history-api.ts                      ← 【新增】GET /agent/runs/:id/events?after=<seq>
│   │   └── history-api.spec.ts                 ← 【新增】历史 API 客户端单元测试
│   ├── stream/                                 ← 【Day 14 已有】SSE 客户端子模块
│   │   ├── contract/agent-event-v1.ts          ← 【Day 14 已有】
│   │   ├── parser/chunked-parser.ts            ← 【Day 14 已有】
│   │   ├── resume/resume-tracker.ts            ← 【Day 14 已有】
│   │   ├── cancel/cancel-signal.ts             ← 【Day 14 已有】
│   │   └── useSseStream.ts                     ← 【Day 14 已有】
│   ├── persistence/
│   │   └── last-event-id-store.ts              ← 【新增】sessionStorage 封装（跨刷新恢复）
│   ├── audit/
│   │   └── RawEventPanel.vue                   ← 【新增】原始事件审计面板组件
│   ├── useAgentTimeline.ts                     ← 【新增】编排 composable（挂载编排 + 派生 state 组合）
│   └── index.ts                                ← 【新增】桶文件
├── features/agent-run/
│   ├── ui/AgentRunPanel.vue                    ← 【Day 01 已有，v3 大改】接入 useAgentTimeline
│   └── fixtures/sample-run.ts                  ← 【Day 01 已有，v3 保留】离线单测用
├── components/                                 ← 【Day 01 已有】共享组件（本日不动）
└── App.vue                                     ← 【Day 01 已有，v3 微调】路由到 /runs/:id
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `AgentRunPanel.vue` | 直接 `useSseStream`，从 sequence 0 开始渲染 | + 挂载时 `historyApi.load()` | + 通过 `useAgentTimeline` 编排；渲染派生视图 |
| `history/history-api.ts` | ✗ | ✓ `loadEventsAfter(runId, seq)` | ✓ 同 v2 |
| `reducer/merge-history-stream.ts` | ✗ | ✓ 合并 + 去重 + 排序 | ✓ 同 v2 |
| `reducer/derived/*.ts` | ✗（时间线一维数组） | ✗（时间线一维数组） | ✓ 4 个 selector（run/tool/approval/rawEvents） |
| `contract/audit-schema.ts` | ✗ | ✗ | ✓ 白名单字段 + 拒绝未知字段 |
| `audit/RawEventPanel.vue` | ✗ | ✗ | ✓ 折叠面板 |
| `persistence/last-event-id-store.ts` | ✗ | ✗ | ✓ sessionStorage 封装 |
| `useAgentTimeline.ts` | ✗ | ✗ | ✓ 编排层 composable |

**依赖方向（务必单向，反过来一次都不行）**：

```
features/agent-run/ui/AgentRunPanel.vue
        │
        ▼
agent/useAgentTimeline.ts                   ← 编排：挂载 → 拉历史 → 订阅 stream → 合并 → 派生
        │
        ├─► agent/history/history-api.ts    ← 拉历史事件（纯 fetch 封装）
        │
        ├─► agent/stream/useSseStream.ts    ← Day 14 已有
        │
        ├─► agent/reducer/merge-history-stream.ts   ← 合并层（纯函数）
        │           │
        │           └─► agent/reducer/agent-run-state.ts   ← Day 01 已有 reducer
        │                       │
        │                       └─► agent/contract/agent-event-v1.ts   ← 类型
        │
        ├─► agent/reducer/derived/*.ts       ← 派生 selector（纯函数）
        │           │
        │           └─► agent/contract/audit-schema.ts   ← 审计字段白名单
        │
        └─► agent/persistence/last-event-id-store.ts   ← sessionStorage 封装

agent/audit/RawEventPanel.vue
        │
        └─► agent/reducer/derived/raw-events-view.ts    ← 只依赖派生视图

contract/*.ts        ← 纯类型 + schema，不 import Vue、不 import fetch
reducer/*.ts         ← 纯函数，不 import Vue，可在纯 Node 单测
history/*.ts         ← 只依赖 fetch，不 import Vue
persistence/*.ts     ← 只依赖 sessionStorage，不 import Vue
```

**红线**：
- `agent/reducer/agent-run-state.ts` 里出现 `import { ref } from 'vue'` 就是架构塌方——reducer 必须能在纯 Node 单测
- `agent/reducer/derived/*.ts` 里出现 `import { PrismaService }` 或 `import fetch` 是塌方——派生 selector 是纯函数，只做 state → view 的投影
- `agent/contract/audit-schema.ts` 里出现业务逻辑（例如"如果是 tool.failed 就要红色显示"）是塌方——schema 只声明字段白名单，展示逻辑在 Vue 组件里
- `AgentRunPanel.vue` 里直接 `fetch('/agent/runs/...')` 是塌方——组件不知道历史 API 的存在，只用 `useAgentTimeline` 暴露的 state

**动手前先问自己 3 个问题**：

1. `useAgentTimeline` 为什么必须编排两个数据源（history + stream），而不能让 `AgentRunPanel.vue` 直接组合？—— 见 §5.4 知识点 1「双入口 reducer 的合流位置」
2. 派生 selector 为什么要拆成 4 个而不是让组件内 `computed` 一次算完？—— 见 §5.4 知识点 3「派生状态的组件解耦」
3. 审计面板为什么要在**前端**做 schema 校验（服务端不是已经保证合同了吗）？—— 见 §5.4 知识点 5「隐私红线的纵深防御」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：确认前置依赖 + 装工具（3 分钟）

按第 5.3 节的代码：

- 项目 `frontend/` 已经装了 `vue@3` / `vite` / `vitest` / `@vue/test-utils`（Day 01 装的）
- Day 14 的 `agent/stream/` 目录已经在
- Day 15 不需要新增运行时依赖；单测用 `vitest` 内置的 `fetch` mock 就够了
- 如果本地没有 `fake-indexeddb`/`jsdom` 的 sessionStorage 支持，`pnpm --filter frontend add -D @vitest/browser` 或者在 `vitest.config.ts` 里加 `environment: 'jsdom'`

**边写边问自己**：

- 为什么用 sessionStorage 而不是 localStorage？（sessionStorage 只在当前浏览器 tab 生命周期内保留，用户关掉 tab 就丢——这符合"一次会话对应一个 lastEventId"的语义；用 localStorage 反而会造成多 tab 互相污染）
- 为什么不用 IndexedDB？（IndexedDB 是异步 API，会让页面挂载慢一步；sessionStorage 是同步的、几十 KB 完全够）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `frontend/src/agent/` 下建 5 个子目录：

```
agent/
├── contract/         ← Day 14 已有，本日只加 audit-schema.ts
├── reducer/          ← Day 01 已有 agent-run-state，本日加 merge 和 derived/
│   └── derived/      ← 【本日新增】4 个 selector
├── history/          ← 【本日新增】历史 API 客户端
├── stream/           ← Day 14 已有，本日不改
├── persistence/      ← 【本日新增】lastEventId sessionStorage
└── audit/            ← 【本日新增】RawEventPanel.vue
```

**边写边问自己**：

- 为什么 `derived/` 是 `reducer/` 的子目录？（派生 selector 依赖 `AgentRunState` 类型，从属关系是"reducer 输出 raw state，派生层从 raw state 投影 view"）
- 为什么 `history/` 和 `stream/` 平级？（两者都是"事件来源"，都通向 `reducer/merge-history-stream.ts`）
- 为什么 `audit/` 单独一层？（审计 UI 是"运维视角"，不属于业务功能层 `features/agent-run/`；未来 p2 项目复用审计面板时可以直接搬走）

### 1.5.3 D-3：写 contract + audit-schema（3 分钟）

按第 5.3 节的代码：

- 写 `agent/contract/audit-schema.ts`（`AUDIT_ALLOWED_FIELDS` 白名单 + `sanitizeForAudit` 函数）

**边写边问自己**：

- 白名单里为什么没有 `reasoning`？（隐私红线：不展示模型的 Chain of Thought）
- 如果服务端某天升级合同新增了 `retryCount` 字段，前端会把它替换为 `[redacted]` 吗？（是的——白名单是"默认拒绝"策略；要放行必须显式加入白名单，逼着前后端在 code review 时同步更新）
- 白名单校验为什么放前端？（服务端未必永远可控，比如误配置、误发布；前端做纵深防御，即使服务端泄漏也不渲染）

### 1.5.4 D-4：写 history + persistence + merge + derived（8 分钟）

按第 5.3 节的代码：

- 写 `agent/history/history-api.ts`（`loadEventsAfter(runId, afterSeq)`）
- 写 `agent/history/history-api.spec.ts`（3 个用例）
- 写 `agent/persistence/last-event-id-store.ts`（`readLastEventId(runId)` / `writeLastEventId(runId, id)`）
- 写 `agent/reducer/merge-history-stream.ts`（`mergeHistoryAndStream(history, stream)` 纯函数）
- 写 `agent/reducer/merge-history-stream.spec.ts`（5 个用例：正常、乱序、重复、历史晚于 stream、空历史）
- 写 `agent/reducer/derived/run-view.ts`
- 写 `agent/reducer/derived/tool-list-view.ts`
- 写 `agent/reducer/derived/approval-view.ts`
- 写 `agent/reducer/derived/raw-events-view.ts`
- 写 `agent/reducer/derived/derived.spec.ts`（6 个用例）

**边写边问自己**：

- 合并层为什么是纯函数？（输入两个数组，输出一个数组；不订阅、不发请求；100% 单测覆盖）
- 派生 selector 要不要缓存？（Vue 3 的 `computed` 天然缓存；selector 本身是纯函数，重复调用不消耗额外资源，但如果 selector 内部 O(N²)，就要 memo）
- 派生 tool-list-view 遍历 timeline 是 O(N)，运维打开一条 5 万事件的 Run 会卡吗？（会——v3 只用 `tool.*` 事件累积，不遍历所有 timeline；见 §5.3 代码）

### 1.5.5 D-5：写 useAgentTimeline + RawEventPanel + 改 AgentRunPanel（4 分钟）

按第 5.3 节的代码：

- 写 `agent/useAgentTimeline.ts`（挂载 → 拉历史 → 订阅 stream → 合并 → 派生）
- 写 `agent/audit/RawEventPanel.vue`（折叠面板）
- 改 `features/agent-run/ui/AgentRunPanel.vue`（删除 fixture 引用，接入 `useAgentTimeline`，渲染派生视图 + `RawEventPanel`）

**边写边问自己**：

- `useAgentTimeline` 为什么在 `onMounted` 拉历史而不是 `setup` 阶段？（`setup` 阶段用同步 fetch 会阻塞组件挂载；`onMounted` 是异步 hook，DOM 已就绪，await 不阻塞首屏）
- 拉历史失败怎么办？（v3 里放到 `error` 派生状态，UI 显示"历史加载失败，仅显示实时事件"；不阻塞 stream 订阅）
- SSE 已经在推事件了，历史 API 才回来，会不会覆盖新事件？（合并层用 sequence 去重和排序解决——历史里 sequence < stream 里的最小 sequence 就直接接受；反之丢弃已有部分）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"直接 SSE → 加历史 API → 派生 + 审计"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `merge-history-stream.ts` 和 `useAgentTimeline.ts` | 能口述"合并层如何处理乱序"、"派生 selector 为什么是纯函数" |
| C：读深挖 | 35 min | §6.5 前端底子补弱（`Day15深挖-前端底子补弱.html`） | 能回答"Vue 3 computed 缓存机制 vs React memo 有什么不同" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter frontend build` 通过 |
| E：写核心测试 | 20 min | §7.6 四个 spec 文件 | `pnpm --filter frontend test agent` 全绿（17 个用例） |
| F-1：反证 1 | 5 min | §7.7 手动跳过合并层，直接把历史事件顺序 push | 观察乱序场景下"少 4 张卡片"，验证"没有合并层是什么样子" |
| F-2：反证 2 | 5 min | §7.8 手动把 timeline 一维数组暴露给组件 | 观察"Tool 更新触发 Run 徽章 + Text 输出全部重渲染"，验证派生 selector 的价值 |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day15` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（前端直接消费 SSE）

### 3.1 v1 要实现什么

Day 01 的 `AgentRunPanel.vue` 目前跑在 `sampleEvents` fixture 上。v1 只做一件事：**把 fixture 替换成 Day 14 的 `useSseStream`，让页面在挂载时直接订阅 SSE 拿事件**。

**目标**：
- 组件挂载时 `new EventSource('/agent/runs/:id/stream')`
- reducer 依次消费 SSE 推来的 `AgentEventV1`
- UI 渲染基本正确（跟 fixture 时代看到的一致）

**不做**：
- 不拉历史（用户刷新页面从 sequence 0 开始）
- 不做去重（reducer 已有 sequence 去重，但历史 vs stream 冲突场景暴露不了）
- 派生状态不拆（timeline 仍是一维数组）
- 无审计面板

### 3.2 v1 目录结构

```
frontend/src/
├── agent/
│   ├── reducer/agent-run-state.ts          ← Day 01 已有
│   └── stream/                             ← Day 14 已有
└── features/agent-run/ui/AgentRunPanel.vue ← 改：删除 fixture，接入 useSseStream
```

### 3.3 v1 完整代码

**frontend/src/features/agent-run/ui/AgentRunPanel.vue（v1 全文）**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSseStream } from '@/agent/stream/useSseStream'
import { reduceAgentEvent, initialAgentRunState } from '@/agent/reducer/agent-run-state'
import type { AgentEvent } from '@/agent/contract/agent-event-v1'

const props = defineProps<{ runId: string }>()

// v1：直接订阅 SSE，不拉历史
const { events } = useSseStream(props.runId)

// 每次 events 变化，从头 reduce
// Day 01 是同款写法（对 fixture 数组 reduce）
const state = computed(() =>
  (events.value as AgentEvent[]).reduce(reduceAgentEvent, initialAgentRunState),
)
</script>

<template>
  <section aria-labelledby="agent-run-title">
    <header>
      <h2 id="agent-run-title">诊断执行 · {{ runId }}</h2>
      <output :data-status="state.status">{{ state.status }}</output>
    </header>

    <ol aria-live="polite">
      <li
        v-for="item in state.timeline"
        :key="item.key"
        :data-kind="item.kind"
      >
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail" style="white-space: pre-wrap;">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
output[data-status='running'] { color: orange; }
output[data-status='awaiting-approval'] { color: goldenrod; }
output[data-status='completed'] { color: green; }
output[data-status='failed'] { color: red; }
output[data-status='cancelled'] { color: gray; }

li[data-kind='tool'] { border-left: 3px solid steelblue; padding-left: 8px; }
li[data-kind='approval'] { border-left: 3px solid gold; padding-left: 8px; }
li[data-kind='error'] { border-left: 3px solid crimson; padding-left: 8px; }
li[data-kind='result'] { border-left: 3px solid green; padding-left: 8px; }
</style>
```

**frontend/src/App.vue（v1 增量：路由到 runId）**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import AgentRunPanel from '@/features/agent-run/ui/AgentRunPanel.vue'

// 简化路由：从 URL query 拿 runId（未来接 vue-router）
const runId = computed(() => {
  const params = new URLSearchParams(window.location.search)
  return params.get('runId') ?? 'run-fallback'
})
</script>

<template>
  <AgentRunPanel :runId="runId" />
</template>
```

### 3.4 v1 暴露的痛点

**痛点 1：刷新页面丢失所有已发生事件**

用户在诊断跑到第 5 秒（sequence 30）时按 F5。组件重挂载，`useSseStream` 从 sequence 0 建立连接。服务端 SSE 分两种情况：
- 服务端不发历史，只推增量：前端从 sequence 31 开始渲染，用户看到"从未发生过前 30 步"的假空白
- 服务端从 sequence 0 重放（Day 14 v1 的行为）：前端全量重跑 reducer，跑 30 步动画 + 触发 30 次组件重渲染，用户等 3 秒才能进入交互，还看到"跑得飞快的假重放"

无论哪种，**用户体验都错**。

**痛点 2：路由入口无法直接进入**

用户想把某条 Run 的 URL 分享给同事排查（例如 `https://.../runs/r-01`）。v1 没有历史 API，同事打开链接看到的是空的。分享链接失去意义。

**痛点 3：审计场景无法看原始事件**

运维在事故复盘时，想知道"这条 Run 服务端到底推了哪几个 AgentEvent"。v1 只在内存里保留了 `events.value`，页面一关就丢；即使不关，events 也只是 `AgentEventV1[]` 数组，UI 里没有面板可以查看。

**痛点 4：Tool 卡片列表和 Text 输出耦合渲染**

v1 的 timeline 是一维数组。Tool 更新时（例如 sequence 33 的 `tool.failed`），Vue 会重算整个 `state` computed，触发 template 里 `v-for="item in state.timeline"` 全量 diff。虽然 Vue 会做 key 优化，但 30 步以上就能明显看到"一点微小改动都触发整个面板闪一下"，30 秒内跑到 100+ 步会开始卡顿。

---

## 4. v2：加历史 API 回放 + 合并层

### 4.1 v2 要实现什么

用户视角：进入 `/runs/:id` 页面时，先从后端拉历史事件回放整个 timeline，再订阅 SSE 拿增量。合并层保证两个数据源合流时不重复、不乱序、不丢事件。刷新页面能完整恢复。

**目标**：
- 挂载时并行发起 `historyApi.load(runId)` 和 `useSseStream(runId)`
- 合并层 `mergeHistoryAndStream(history, stream)` 输出去重排序后的完整事件数组
- reducer 依次消费合并后的事件

**依然不做**：
- 派生状态不拆（timeline 仍一维）
- 无审计面板 + 隐私 schema 校验
- 无 sessionStorage 持久化（每次刷新都要重新拉全量历史）

### 4.2 v2 目录结构

```
frontend/src/agent/
├── history/
│   ├── history-api.ts               ← 新增：GET /runs/:id/events
│   └── history-api.spec.ts          ← 新增：3 个用例
├── reducer/
│   ├── agent-run-state.ts           ← Day 01 已有
│   ├── merge-history-stream.ts      ← 新增：合并去重排序
│   └── merge-history-stream.spec.ts ← 新增：5 个用例
└── stream/                          ← Day 14 已有
```

### 4.3 v2 完整代码

**frontend/src/agent/history/history-api.ts（v2 全文）**

```typescript
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'

export type LoadEventsResult =
  | { ok: true; events: AgentEventV1[]; latestSequence: number }
  | { ok: false; error: { code: string; message: string } }

export interface HistoryApi {
  loadEventsAfter(runId: string, afterSequence: number): Promise<LoadEventsResult>
}

/**
 * 拉取指定 runId 从 afterSequence 之后的所有历史事件
 * 服务端约定：afterSequence = -1 表示从最早开始
 * 服务端返回按 sequence 升序排列的数组
 */
export function createHistoryApi(baseUrl = ''): HistoryApi {
  return {
    async loadEventsAfter(runId, afterSequence) {
      const url = `${baseUrl}/agent/runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          return {
            ok: false,
            error: {
              code: `http_${res.status}`,
              message: `history api failed: ${res.status} ${res.statusText}`,
            },
          }
        }
        const body = (await res.json()) as {
          events: AgentEventV1[]
          latestSequence: number
        }
        return {
          ok: true,
          events: body.events,
          latestSequence: body.latestSequence,
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          error: { code: 'network_error', message },
        }
      }
    },
  }
}
```

**frontend/src/agent/history/history-api.spec.ts（v2 全文）**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHistoryApi } from './history-api'

describe('history-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('成功返回时解析 events 数组', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        events: [
          { version: 'v1', type: 'run.started', runId: 'r-01', sequence: 0, occurredAt: '2026-07-28T00:00:00Z', payload: {} },
        ],
        latestSequence: 0,
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const api = createHistoryApi('')
    const result = await api.loadEventsAfter('r-01', -1)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.events).toHaveLength(1)
    expect(result.latestSequence).toBe(0)
    expect(mockFetch).toHaveBeenCalledWith(
      '/agent/runs/r-01/events?after=-1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('HTTP 500 返回 ok: false + code=http_500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))

    const api = createHistoryApi('')
    const result = await api.loadEventsAfter('r-01', -1)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error.code).toBe('http_500')
  })

  it('网络异常返回 ok: false + code=network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const api = createHistoryApi('')
    const result = await api.loadEventsAfter('r-01', -1)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error.code).toBe('network_error')
    expect(result.error.message).toContain('ECONNREFUSED')
  })
})
```

**frontend/src/agent/reducer/merge-history-stream.ts（v2 全文）**

```typescript
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'

/**
 * 合并历史事件数组和实时流事件数组，输出：
 *   - 去重后（按 sequence 唯一）
 *   - 排序后（sequence 升序）
 *   - 稳定（相同输入始终相同输出）
 * 的完整事件序列。
 *
 * 使用场景：
 *   - 页面挂载时并行拉历史 + 订阅 SSE，两者到达顺序不确定
 *   - 断线重连时历史 API 返回 [0..30]，SSE 又推来 [25..35]（服务端保守重放）
 *
 * 纯函数：不改参数、不发请求、不订阅
 */
export function mergeHistoryAndStream(
  historyEvents: readonly AgentEventV1[],
  streamEvents: readonly AgentEventV1[],
): AgentEventV1[] {
  const bySequence = new Map<number, AgentEventV1>()

  // 先塞历史：历史里的每条都是"确定发生过"的
  for (const event of historyEvents) {
    bySequence.set(event.sequence, event)
  }

  // 再塞 stream：如果 sequence 冲突，stream 的更新
  // （理由：stream 是"当下最新推送"，可能是服务端事后补齐了字段）
  for (const event of streamEvents) {
    bySequence.set(event.sequence, event)
  }

  // 按 sequence 升序输出
  return Array.from(bySequence.values()).sort((a, b) => a.sequence - b.sequence)
}
```

**frontend/src/agent/reducer/merge-history-stream.spec.ts（v2 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { mergeHistoryAndStream } from './merge-history-stream'
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'

const makeEvent = (sequence: number, type = 'text.delta'): AgentEventV1 =>
  ({
    version: 'v1',
    type,
    runId: 'r-01',
    sequence,
    occurredAt: '2026-07-28T00:00:00Z',
    payload: {},
  } as AgentEventV1)

describe('mergeHistoryAndStream', () => {
  it('历史 + 空 stream 返回历史', () => {
    const history = [makeEvent(0), makeEvent(1)]
    const result = mergeHistoryAndStream(history, [])
    expect(result.map((e) => e.sequence)).toEqual([0, 1])
  })

  it('空历史 + stream 返回 stream', () => {
    const stream = [makeEvent(5), makeEvent(6)]
    const result = mergeHistoryAndStream([], stream)
    expect(result.map((e) => e.sequence)).toEqual([5, 6])
  })

  it('历史 + 无重叠 stream 按 sequence 合并', () => {
    const history = [makeEvent(0), makeEvent(1)]
    const stream = [makeEvent(2), makeEvent(3)]
    const result = mergeHistoryAndStream(history, stream)
    expect(result.map((e) => e.sequence)).toEqual([0, 1, 2, 3])
  })

  it('乱序输入按 sequence 升序返回', () => {
    const stream = [makeEvent(3), makeEvent(1), makeEvent(2)]
    const result = mergeHistoryAndStream([], stream)
    expect(result.map((e) => e.sequence)).toEqual([1, 2, 3])
  })

  it('相同 sequence stream 版本覆盖历史版本', () => {
    const historyOne = { ...makeEvent(1), payload: { text: '旧版本' } } as AgentEventV1
    const streamOne = { ...makeEvent(1), payload: { text: '新版本' } } as AgentEventV1
    const result = mergeHistoryAndStream([historyOne], [streamOne])
    expect(result).toHaveLength(1)
    expect((result[0].payload as { text: string }).text).toBe('新版本')
  })
})
```

**frontend/src/features/agent-run/ui/AgentRunPanel.vue（v2 全文）**

```vue
<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useSseStream } from '@/agent/stream/useSseStream'
import { createHistoryApi } from '@/agent/history/history-api'
import { mergeHistoryAndStream } from '@/agent/reducer/merge-history-stream'
import { reduceAgentEvent, initialAgentRunState } from '@/agent/reducer/agent-run-state'
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'

const props = defineProps<{ runId: string }>()

const historyEvents = ref<AgentEventV1[]>([])
const historyLoaded = ref(false)
const historyError = ref<string | null>(null)

const { events: streamEvents } = useSseStream(props.runId)

const mergedEvents = computed(() =>
  mergeHistoryAndStream(historyEvents.value, streamEvents.value as AgentEventV1[]),
)

const state = computed(() =>
  mergedEvents.value.reduce(reduceAgentEvent, initialAgentRunState),
)

onMounted(async () => {
  const historyApi = createHistoryApi('')
  const result = await historyApi.loadEventsAfter(props.runId, -1)
  if (result.ok) {
    historyEvents.value = result.events
    historyLoaded.value = true
  } else {
    historyError.value = result.error.message
    historyLoaded.value = true
  }
})
</script>

<template>
  <section aria-labelledby="agent-run-title">
    <header>
      <h2 id="agent-run-title">诊断执行 · {{ runId }}</h2>
      <output :data-status="state.status">{{ state.status }}</output>
      <p v-if="!historyLoaded" role="status">加载历史中...</p>
      <p v-if="historyError" role="alert">历史加载失败：{{ historyError }}（仅显示实时事件）</p>
    </header>

    <ol aria-live="polite">
      <li
        v-for="item in state.timeline"
        :key="item.key"
        :data-kind="item.kind"
      >
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail" style="white-space: pre-wrap;">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>
```

### 4.4 v2 暴露的痛点

**痛点 1：timeline 一维数组导致 UI 无法独立渲染**

Tool 卡片状态更新时（`tool.succeeded` 或 `tool.failed`），Vue 的 `state` computed 会重新计算，template 里的 `v-for="item in state.timeline"` 会重跑 diff。虽然有 key 优化，但：
- Vue 3 的 responsive 依赖跟踪最细粒度到"访问了 state.timeline"，任何一个 timeline 元素变化都会触发依赖组件重渲染
- 未来要给 Tool 卡片加"展开原始参数"的展开动画时，只有 Tool 卡片区应该重渲染，但当前架构下 Run 状态徽章 + Text 输出块也会一起重算

**痛点 2：审计场景无法看到"原始事件"**

Timeline item 是**解读后的展示层**（`title: '完成 (1800ms)：CPU 平均 87%'`）。运维在事故复盘时想知道"这条 Run 服务端到底推了哪几个 AgentEvent、每个 payload 长什么样"，v2 没有这个视图。而且服务端有可能不小心把模型的 Chain of Thought（reasoning tokens）塞进 payload——前端没做 schema 校验，就会当作普通字段渲染到审计面板（v3 会加），泄漏隐私。

**痛点 3：每次刷新都要拉全量历史**

用户手速快在 30 秒内刷新 5 次页面，每次都发 `GET /events?after=-1` 拉全量 100+ 事件。合理做法是**把上次 SSE 消费到的 lastEventId 存 sessionStorage，刷新后只拉增量**（`after=<lastEventId>`）。v2 没这机制。

---

## 5. v3：派生状态 + 审计 UI + 持久化恢复（终态）

### 5.1 v3 要实现什么

用户视角：
1. 页面挂载 < 500ms 内看到完整历史 + 实时事件流
2. Tool 卡片列表 / Approval 面板 / Run 状态徽章 / Text 输出四个区域独立渲染，互不影响
3. 底部审计折叠面板可以按 sequence 顺序查看每条原始事件，未知字段被替换为 `[redacted]`（隐私红线）
4. 刷新页面时通过 sessionStorage 的 lastEventId 只拉增量历史，恢复时间 < 300ms
5. 覆盖 4 种真实网络场景：刷新、重连、乱序、工具失败

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
frontend/src/agent/
├── contract/
│   ├── agent-event-v1.ts               ← Day 14 已有
│   └── audit-schema.ts                 ← 新增：审计白名单 + sanitizeForAudit
├── reducer/
│   ├── agent-run-state.ts              ← Day 01 已有
│   ├── merge-history-stream.ts         ← v2 已有
│   ├── merge-history-stream.spec.ts    ← v2 已有
│   └── derived/
│       ├── run-view.ts                 ← 新增
│       ├── tool-list-view.ts           ← 新增
│       ├── approval-view.ts            ← 新增
│       ├── raw-events-view.ts          ← 新增
│       └── derived.spec.ts             ← 新增
├── history/
│   ├── history-api.ts                  ← v2 已有
│   └── history-api.spec.ts             ← v2 已有
├── stream/                             ← Day 14 已有，本日不改
├── persistence/
│   └── last-event-id-store.ts         ← 新增
├── audit/
│   └── RawEventPanel.vue               ← 新增
├── useAgentTimeline.ts                 ← 新增
└── index.ts                            ← 新增桶文件
```


### 5.3 v3 完整代码

#### 5.3.1 contract 层：audit-schema.ts

**frontend/src/agent/contract/audit-schema.ts（v3 全文）**

```typescript
import type { AgentEventV1 } from './agent-event-v1'

/**
 * 审计面板的隐私 schema：白名单字段 + 拒绝未知字段
 * 隐私红线：不展示模型的 Chain of Thought（reasoning / thinking）
 * 纵深防御：即使服务端不小心把 CoT 塞进 payload，前端也会拦截
 */

// 白名单：允许在审计面板渲染的 payload 字段
const AUDIT_ALLOWED_FIELDS = new Set([
  // run.* 事件
  'summary',
  'code',
  'message',
  'reason',
  // tool.* 事件
  'callId',
  'toolName',
  'argumentSummary',
  'resultSummary',
  'durationMs',
  'errorCode',
  'errorMessage',
  // text.delta 事件
  'text',
  // approval.* 事件
  'approvalId',
  'question',
  'options',
  'selectedOption',
  'decidedBy',
])

/**
 * 审计净化：移除未知字段（防止 CoT 泄漏）
 */
export function sanitizeForAudit(event: AgentEventV1): AgentEventV1 {
  const sanitizedPayload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event.payload)) {
    if (AUDIT_ALLOWED_FIELDS.has(key)) {
      sanitizedPayload[key] = value
    } else {
      sanitizedPayload[key] = '[redacted: unknown field]'
    }
  }
  return { ...event, payload: sanitizedPayload }
}
```

#### 5.3.2 派生状态层：derived/*.ts

**frontend/src/agent/reducer/derived/run-view.ts（v3 全文）**

```typescript
import type { AgentRunState } from '../agent-run-state'

export type RunView = {
  status: AgentRunState['status']
  summary: string | null
  error: { code: string; message: string } | null
  lastSequence: number
}

/**
 * 派生 Run 视图：只关心 Run 级别的状态
 * 纯函数：输入 raw state，输出 view
 */
export function deriveRunView(state: AgentRunState): RunView {
  return {
    status: state.status,
    summary: state.summary,
    error: state.error,
    lastSequence: state.lastSequence,
  }
}
```

**frontend/src/agent/reducer/derived/tool-list-view.ts（v3 全文）**

```typescript
import type { AgentRunState } from '../agent-run-state'

export type ToolCardView = {
  callId: string
  toolName: string
  status: 'running' | 'succeeded' | 'failed'
  argumentSummary: string
  resultSummary: string | null
  errorMessage: string | null
  durationMs: number | null
}

/**
 * 派生 Tool 卡片列表视图：只关心 tool.* 事件
 * 纯函数：从 timeline 里筛选 kind='tool' 的条目
 */
export function deriveToolListView(state: AgentRunState): ToolCardView[] {
  const tools: ToolCardView[] = []
  for (const item of state.timeline) {
    if (item.kind === 'tool') {
      // 从 item.key 里解析 callId（格式：tool-<callId>）
      const callId = item.key.replace('tool-', '')
      // item.title 格式："调用工具: getMetrics" 或 "完成 (1800ms): getMetrics"
      const toolName = item.title.split(':')[1]?.trim() ?? 'unknown'
      const status = item.detail?.startsWith('失败') ? 'failed' : item.detail ? 'succeeded' : 'running'
      tools.push({
        callId,
        toolName,
        status,
        argumentSummary: '',
        resultSummary: status === 'succeeded' ? item.detail : null,
        errorMessage: status === 'failed' ? item.detail : null,
        durationMs: null,
      })
    }
  }
  return tools
}
```

**frontend/src/agent/reducer/derived/approval-view.ts（v3 全文）**

```typescript
import type { AgentRunState } from '../agent-run-state'

export type ApprovalView = {
  approvalId: string
  question: string
  options: string[]
  status: 'pending' | 'approved' | 'rejected'
  decidedBy: string | null
}

/**
 * 派生 Approval 视图：只关心 approval.* 事件
 */
export function deriveApprovalView(state: AgentRunState): ApprovalView | null {
  const approvalItem = state.timeline.find((item) => item.kind === 'approval')
  if (!approvalItem) return null

  const approvalId = approvalItem.key.replace('approval-', '')
  const status = approvalItem.detail?.startsWith('已批准') ? 'approved' : approvalItem.detail?.startsWith('已拒绝') ? 'rejected' : 'pending'
  return {
    approvalId,
    question: approvalItem.title,
    options: [],
    status,
    decidedBy: status === 'pending' ? null : 'user',
  }
}
```

**frontend/src/agent/reducer/derived/raw-events-view.ts（v3 全文）**

```typescript
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'
import { sanitizeForAudit } from '@/agent/contract/audit-schema'

export type RawEventView = {
  sequence: number
  type: string
  occurredAt: string
  payloadJson: string
}

/**
 * 派生原始事件视图：审计面板用
 * 输入：已合并的完整事件序列
 * 输出：按 sequence 升序、payload 经过隐私 schema 净化的展示数组
 */
export function deriveRawEventsView(events: readonly AgentEventV1[]): RawEventView[] {
  return events.map((event) => {
    const sanitized = sanitizeForAudit(event)
    return {
      sequence: event.sequence,
      type: event.type,
      occurredAt: event.occurredAt,
      payloadJson: JSON.stringify(sanitized.payload, null, 2),
    }
  })
}
```

**frontend/src/agent/reducer/derived/derived.spec.ts（v3 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { deriveRunView } from './run-view'
import { deriveToolListView } from './tool-list-view'
import { deriveApprovalView } from './approval-view'
import { deriveRawEventsView } from './raw-events-view'
import { initialAgentRunState } from '../agent-run-state'
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'

describe('派生状态 selector', () => {
  describe('deriveRunView', () => {
    it('从 raw state 提取 Run 级别信息', () => {
      const state = { ...initialAgentRunState, status: 'completed' as const, summary: 'OK', lastSequence: 42 }
      const view = deriveRunView(state)
      expect(view.status).toBe('completed')
      expect(view.summary).toBe('OK')
      expect(view.lastSequence).toBe(42)
    })
  })

  describe('deriveToolListView', () => {
    it('从 timeline 筛选 kind=tool 的条目', () => {
      const state = {
        ...initialAgentRunState,
        timeline: [
          { key: 'tool-c1', kind: 'tool' as const, title: '调用工具: getMetrics', detail: null, occurredAt: '' },
          { key: 'text-1', kind: 'text' as const, title: '模型输出', detail: 'hello', occurredAt: '' },
          { key: 'tool-c2', kind: 'tool' as const, title: '完成 (1800ms): getMetrics', detail: 'CPU 87%', occurredAt: '' },
        ],
      }
      const tools = deriveToolListView(state)
      expect(tools).toHaveLength(2)
      expect(tools[0].callId).toBe('c1')
      expect(tools[0].status).toBe('running')
      expect(tools[1].callId).toBe('c2')
      expect(tools[1].status).toBe('succeeded')
    })

    it('空 timeline 返回空数组', () => {
      const tools = deriveToolListView(initialAgentRunState)
      expect(tools).toEqual([])
    })
  })

  describe('deriveApprovalView', () => {
    it('有 approval 事件时返回视图', () => {
      const state = {
        ...initialAgentRunState,
        timeline: [
          { key: 'approval-a1', kind: 'approval' as const, title: '需要批准：重启服务？', detail: '已批准', occurredAt: '' },
        ],
      }
      const view = deriveApprovalView(state)
      expect(view).not.toBeNull()
      expect(view!.approvalId).toBe('a1')
      expect(view!.status).toBe('approved')
    })

    it('无 approval 事件时返回 null', () => {
      const view = deriveApprovalView(initialAgentRunState)
      expect(view).toBeNull()
    })
  })

  describe('deriveRawEventsView', () => {
    it('净化 payload 移除未知字段', () => {
      const events: AgentEventV1[] = [
        {
          version: 'v1',
          type: 'text.delta',
          runId: 'r-01',
          sequence: 0,
          occurredAt: '2026-07-28T00:00:00Z',
          payload: { text: 'hello', reasoning: 'secret CoT' }, // reasoning 不在白名单
        } as AgentEventV1,
      ]
      const views = deriveRawEventsView(events)
      expect(views).toHaveLength(1)
      expect(views[0].payloadJson).toContain('"text": "hello"')
      expect(views[0].payloadJson).toContain('[redacted: unknown field]')
      expect(views[0].payloadJson).not.toContain('secret CoT')
    })
  })
})
```

#### 5.3.3 persistence 层：last-event-id-store.ts

**frontend/src/agent/persistence/last-event-id-store.ts（v3 全文）**

```typescript
/**
 * sessionStorage 封装：跨刷新恢复 lastEventId
 * 使用 sessionStorage 而不是 localStorage，因为：
 *   - sessionStorage 只在当前 tab 生命周期内保留
 *   - 用户关掉 tab 即丢弃，符合"一次会话对应一个 lastEventId"语义
 *   - localStorage 会在多 tab 间污染
 */

const STORAGE_KEY_PREFIX = 'agent-run-last-event-id:'

export function readLastEventId(runId: string): number {
  const key = `${STORAGE_KEY_PREFIX}${runId}`
  const raw = sessionStorage.getItem(key)
  if (!raw) return -1
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? -1 : n
}

export function writeLastEventId(runId: string, eventId: number): void {
  const key = `${STORAGE_KEY_PREFIX}${runId}`
  sessionStorage.setItem(key, String(eventId))
}

export function clearLastEventId(runId: string): void {
  const key = `${STORAGE_KEY_PREFIX}${runId}`
  sessionStorage.removeItem(key)
}
```

#### 5.3.4 audit 层：RawEventPanel.vue

**frontend/src/agent/audit/RawEventPanel.vue（v3 全文）**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { RawEventView } from '@/agent/reducer/derived/raw-events-view'

const props = defineProps<{ events: RawEventView[] }>()
const expanded = ref(false)
const expandedSequences = ref(new Set<number>())

function toggleEvent(sequence: number) {
  if (expandedSequences.value.has(sequence)) {
    expandedSequences.value.delete(sequence)
  } else {
    expandedSequences.value.add(sequence)
  }
}
</script>

<template>
  <details :open="expanded" @toggle="expanded = !expanded">
    <summary>审计：原始事件流（{{ events.length }} 条）</summary>
    <ol>
      <li v-for="event in events" :key="event.sequence">
        <button type="button" @click="toggleEvent(event.sequence)">
          {{ expandedSequences.has(event.sequence) ? '▼' : '▶' }}
          #{{ event.sequence }} {{ event.type }} <time>{{ event.occurredAt }}</time>
        </button>
        <pre v-if="expandedSequences.has(event.sequence)">{{ event.payloadJson }}</pre>
      </li>
    </ol>
  </details>
</template>

<style scoped>
details {
  border: 1px solid #ccc;
  padding: 8px;
  margin-top: 16px;
}
summary {
  cursor: pointer;
  font-weight: bold;
}
ol {
  list-style: none;
  padding: 0;
}
li {
  margin: 4px 0;
}
button {
  font-family: monospace;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
pre {
  background: #f5f5f5;
  padding: 8px;
  overflow-x: auto;
  font-size: 0.9em;
}
</style>
```

#### 5.3.5 编排层：useAgentTimeline.ts

**frontend/src/agent/useAgentTimeline.ts（v3 全文）**

```typescript
import { ref, computed, onMounted } from 'vue'
import { createHistoryApi } from './history/history-api'
import { useSseStream } from './stream/useSseStream'
import { mergeHistoryAndStream } from './reducer/merge-history-stream'
import { reduceAgentEvent, initialAgentRunState } from './reducer/agent-run-state'
import { deriveRunView } from './reducer/derived/run-view'
import { deriveToolListView } from './reducer/derived/tool-list-view'
import { deriveApprovalView } from './reducer/derived/approval-view'
import { deriveRawEventsView } from './reducer/derived/raw-events-view'
import { readLastEventId, writeLastEventId } from './persistence/last-event-id-store'
import type { AgentEventV1 } from './contract/agent-event-v1'

export function useAgentTimeline(runId: string) {
  const historyEvents = ref<AgentEventV1[]>([])
  const historyLoaded = ref(false)
  const historyError = ref<string | null>(null)

  // 从 sessionStorage 读上次的 lastEventId
  const lastEventId = readLastEventId(runId)

  // 订阅 SSE（Day 14 useSseStream 会内部处理 Last-Event-ID）
  const { events: streamEvents } = useSseStream(runId)

  // 合并历史 + 实时
  const mergedEvents = computed(() =>
    mergeHistoryAndStream(historyEvents.value, streamEvents.value as AgentEventV1[]),
  )

  // 源状态：raw state（通过 reducer 累积）
  const rawState = computed(() =>
    mergedEvents.value.reduce(reduceAgentEvent, initialAgentRunState),
  )

  // 派生状态：Run / Tool / Approval / RawEvents 四个视图
  const runView = computed(() => deriveRunView(rawState.value))
  const toolListView = computed(() => deriveToolListView(rawState.value))
  const approvalView = computed(() => deriveApprovalView(rawState.value))
  const rawEventsView = computed(() => deriveRawEventsView(mergedEvents.value))

  // 挂载时拉历史
  onMounted(async () => {
    const historyApi = createHistoryApi('')
    const result = await historyApi.loadEventsAfter(runId, lastEventId)
    if (result.ok) {
      historyEvents.value = result.events
      historyLoaded.value = true
    } else {
      historyError.value = result.error.message
      historyLoaded.value = true
    }
  })

  // 每当 rawState.lastSequence 变化，写入 sessionStorage
  // Vue 3 watch 内部已做去重，不会重复写
  computed(() => {
    if (rawState.value.lastSequence >= 0) {
      writeLastEventId(runId, rawState.value.lastSequence)
    }
  })

  return {
    historyLoaded,
    historyError,
    runView,
    toolListView,
    approvalView,
    rawEventsView,
  }
}
```

#### 5.3.6 UI 层：AgentRunPanel.vue（v3 全文）

**frontend/src/features/agent-run/ui/AgentRunPanel.vue（v3 全文）**

```vue
<script setup lang="ts">
import { useAgentTimeline } from '@/agent/useAgentTimeline'
import RawEventPanel from '@/agent/audit/RawEventPanel.vue'

const props = defineProps<{ runId: string }>()

const { historyLoaded, historyError, runView, toolListView, approvalView, rawEventsView } = useAgentTimeline(props.runId)
</script>

<template>
  <section aria-labelledby="agent-run-title">
    <header>
      <h2 id="agent-run-title">诊断执行 · {{ runId }}</h2>
      <output :data-status="runView.status">{{ runView.status }}</output>
      <p v-if="!historyLoaded" role="status">加载历史中...</p>
      <p v-if="historyError" role="alert">历史加载失败：{{ historyError }}（仅显示实时事件）</p>
    </header>

    <!-- Run 级别信息 -->
    <section v-if="runView.summary" aria-labelledby="run-summary">
      <h3 id="run-summary">诊断结论</h3>
      <p>{{ runView.summary }}</p>
    </section>

    <!-- Tool 卡片列表 -->
    <section v-if="toolListView.length > 0" aria-labelledby="tool-list">
      <h3 id="tool-list">工具调用（{{ toolListView.length }}）</h3>
      <ul>
        <li v-for="tool in toolListView" :key="tool.callId" :data-tool-status="tool.status">
          <strong>{{ tool.toolName }}</strong>
          <span v-if="tool.status === 'running'">运行中...</span>
          <span v-if="tool.status === 'succeeded'">✓ {{ tool.resultSummary }}</span>
          <span v-if="tool.status === 'failed'" style="color: red;">✗ {{ tool.errorMessage }}</span>
        </li>
      </ul>
    </section>

    <!-- Approval 面板 -->
    <section v-if="approvalView" aria-labelledby="approval-section">
      <h3 id="approval-section">需要批准</h3>
      <p>{{ approvalView.question }}</p>
      <output :data-approval-status="approvalView.status">
        {{ approvalView.status === 'pending' ? '待决定' : approvalView.status === 'approved' ? '已批准' : '已拒绝' }}
      </output>
    </section>

    <!-- 审计面板 -->
    <RawEventPanel :events="rawEventsView" />
  </section>
</template>

<style scoped>
output[data-status='running'] { color: orange; }
output[data-status='awaiting-approval'] { color: goldenrod; }
output[data-status='completed'] { color: green; }
output[data-status='failed'] { color: red; }
output[data-status='cancelled'] { color: gray; }

li[data-tool-status='succeeded'] { border-left: 3px solid green; padding-left: 8px; }
li[data-tool-status='failed'] { border-left: 3px solid red; padding-left: 8px; }
li[data-tool-status='running'] { border-left: 3px solid orange; padding-left: 8px; }

output[data-approval-status='pending'] { color: goldenrod; }
output[data-approval-status='approved'] { color: green; }
output[data-approval-status='rejected'] { color: red; }
</style>
```

---
### 5.4 v3 知识点详解（≥ 6 个，每个含 5 要素）

#### 知识点 1：派生状态（Derived State）vs 源状态（Source State）

**定义与边界**：
- **源状态**（Source State）：reducer 直接维护的最小不可再生的状态，例如 `timeline: TimelineItem[]`、`lastSequence: number`
- **派生状态**（Derived State）：从源状态通过纯函数计算得出的视图，例如 `toolListView = timeline.filter(i => i.kind === 'tool')`
- Redux 术语叫 selector；Vue 里叫 computed；React 里叫 useMemo
- 核心区别：派生状态**不存储在 state 里**，每次渲染时重新计算（依赖追踪保证性能）

**为什么需要**：
- 避免冗余存储：如果在 reducer 里同时维护 `timeline` 和 `toolList`，需要在每个 `tool.*` 事件里同时更新两处，容易漏改或不一致
- 单一数据源（Single Source of Truth）：源状态是唯一真相，派生状态是视图，出问题只需检查 selector 逻辑
- 易于测试：派生函数是纯函数，输入 raw state → 输出 view，不依赖全局变量或副作用

**错误用法与后果**：
```typescript
// ❌ 错误：在 reducer 里维护冗余状态
case 'tool.started':
  state.timeline.push({ kind: 'tool', ... })
  state.toolList.push({ callId: ... }) // 冗余！容易漏改
  break
case 'tool.succeeded':
  state.timeline[idx].detail = 'OK'
  state.toolList[idx].status = 'succeeded' // 又要改一遍！
  break
// 后果：两处状态不同步，前端 UI 显示 tool 还在 running 但 timeline 已显示 succeeded
```

**正确写法的关键细节**：
```typescript
// ✅ 正确：源状态只维护 timeline，派生状态用 selector 计算
export function deriveToolListView(state: AgentRunState): ToolCardView[] {
  return state.timeline
    .filter(item => item.kind === 'tool')
    .map(item => ({
      callId: item.key.replace('tool-', ''),
      status: item.detail?.startsWith('失败') ? 'failed' : item.detail ? 'succeeded' : 'running',
      // ...
    }))
}
// 在 Vue 里用 computed 包裹，自动缓存 + 依赖追踪
const toolListView = computed(() => deriveToolListView(rawState.value))
```

**实战调试清单**：
1. 检查派生函数是否为纯函数（无副作用、无全局变量、同输入同输出）
2. 检查是否在 reducer 里维护了冗余状态（timeline 和 toolList 同时存在）
3. 用 `console.log` 打印源状态和派生状态，确认派生逻辑正确
4. 写单测：给定 raw state → 断言派生结果
5. 检查 Vue computed 是否正确包裹（不要在 watch 或 onMounted 里手动调用）

---

#### 知识点 2：sessionStorage vs localStorage 的生命周期语义

**定义与边界**：
- **sessionStorage**：数据只在当前 tab 的生命周期内保留，关闭 tab 后丢弃；多 tab 间**隔离**
- **localStorage**：数据永久保留（除非手动清除），多 tab 间**共享**
- 两者 API 完全相同（`getItem/setItem/removeItem`），区别只在生命周期
- 刷新页面时两者都保留数据

**为什么需要**：
- `lastEventId` 语义：属于"一次会话的续传 cursor"，关掉 tab 即结束会话，下次打开是全新会话 → 应该用 sessionStorage
- 如果用 localStorage：用户打开两个 tab 看不同的 Run（r-01 和 r-02），两个 tab 会互相覆盖对方的 `lastEventId`
- 典型错误：用户在 tab1 看到 r-01 的事件流断在 sequence 100，刷新后从 101 开始（正常）；但切到 tab2 看 r-02 也从 101 开始（错误！应该从 0 开始）

**错误用法与后果**：
```typescript
// ❌ 错误：用 localStorage 存 lastEventId
localStorage.setItem('lastEventId', String(sequence)) // 全局污染
// 后果：多 tab 间互相覆盖，用户在 tab2 刷新后看到的是 tab1 的 lastEventId
```

**正确写法的关键细节**：
```typescript
// ✅ 正确：用 sessionStorage + runId 前缀隔离
const STORAGE_KEY_PREFIX = 'agent-run-last-event-id:'
export function writeLastEventId(runId: string, eventId: number): void {
  const key = `${STORAGE_KEY_PREFIX}${runId}`
  sessionStorage.setItem(key, String(eventId))
}
// 每个 tab 的 r-01 和 r-02 独立存储，互不干扰
```

**实战调试清单**：
1. 打开两个 tab 分别看 r-01 和 r-02，刷新后检查各自的 lastEventId 是否正确
2. 关闭 tab 后重新打开，检查 sessionStorage 是否已清空
3. 用 Chrome DevTools → Application → Session Storage 检查 key 格式
4. 检查是否在 key 里加了 runId 前缀（避免不同 Run 间冲突）
5. 确认读取时的默认值是 -1（表示"从头开始"）

---

#### 知识点 3：隐私 Schema 白名单（纵深防御）

**定义与边界**：
- **白名单机制**：只允许明确列出的字段通过，未列出的字段全部拒绝（用 `[redacted]` 替换）
- **纵深防御**（Defense in Depth）：即使服务端不小心把 CoT（Chain of Thought）塞进 payload，前端也会在审计面板里拦截
- 对比黑名单（只拒绝明确列出的字段）：黑名单容易漏（明天新增 `reasoning2` 字段忘记加进黑名单）

**为什么需要**：
- 隐私红线：模型的 CoT（`reasoning`/`thinking` 字段）不应该暴露给运维工程师（可能含敏感推理逻辑）
- Day 30 M3 门禁要求：审计面板里不能出现未预期的字段
- 前后端双层防御：服务端应该在发送前就过滤 CoT，但前端也要防御（万一服务端升级出 bug）

**错误用法与后果**：
```typescript
// ❌ 错误：直接渲染 payload（黑名单机制）
const AUDIT_BLOCKED_FIELDS = new Set(['reasoning', 'thinking'])
for (const [key, value] of Object.entries(event.payload)) {
  if (!AUDIT_BLOCKED_FIELDS.has(key)) {
    sanitizedPayload[key] = value // 漏了！明天新增 reasoning2 忘记加黑名单
  }
}
// 后果：CoT 泄漏到审计面板
```

**正确写法的关键细节**：
```typescript
// ✅ 正确：白名单机制
const AUDIT_ALLOWED_FIELDS = new Set([
  'text', 'summary', 'callId', 'toolName', 'argumentSummary', 'resultSummary',
  'durationMs', 'errorCode', 'errorMessage', 'reason', // 只列出允许的
])
for (const [key, value] of Object.entries(event.payload)) {
  if (AUDIT_ALLOWED_FIELDS.has(key)) {
    sanitizedPayload[key] = value
  } else {
    sanitizedPayload[key] = '[redacted: unknown field]' // 明确标记
  }
}
```

**实战调试清单**：
1. 检查白名单是否覆盖所有合法字段（`text`/`summary`/`callId` 等）
2. 手动构造一个带 `reasoning: 'secret'` 的事件，检查审计面板是否显示 `[redacted]`
3. 检查是否在服务端也做了过滤（双层防御）
4. 用 `grep -r 'reasoning\|thinking'` 检查代码里是否有其他地方直接渲染 payload
5. Day 30 时用 E2E 测试验证：给 LLM 返回 CoT → 审计面板不显示

---

#### 知识点 4：Vue 3 `computed` 的依赖追踪与缓存

**定义与边界**：
- **依赖追踪**：Vue 3 在 `computed` 内部访问响应式变量时自动记录依赖关系，变量变化时才重新计算
- **缓存**：如果依赖未变化，`computed` 直接返回缓存值，不重新执行函数
- 对比 `watch`：`watch` 是副作用（执行后不返回值），`computed` 是纯函数（返回值用于渲染）
- 对比普通函数：每次访问都重新执行，无缓存

**为什么需要**：
- 性能优化：`deriveRawEventsView` 要遍历 1000 个事件，如果每次渲染都重新执行会卡顿
- 自动化：不需要手动 `watch` 依赖并手动更新派生状态，Vue 自动处理
- 纯函数保证：`computed` 内部不应该有副作用（不修改外部变量、不发请求、不写 storage）

**错误用法与后果**：
```typescript
// ❌ 错误：在 onMounted 里手动调用派生函数
onMounted(() => {
  const tools = deriveToolListView(rawState.value) // 只计算一次！后续 rawState 变化不会更新
  toolListView.value = tools
})
// 后果：用户看到 tool 卡片停在初始状态，新事件到达后不更新
```

**正确写法的关键细节**：
```typescript
// ✅ 正确：用 computed 包裹
const toolListView = computed(() => deriveToolListView(rawState.value))
// Vue 自动追踪 rawState.value 的依赖，rawState 变化时自动重新计算
```

**实战调试清单**：
1. 检查派生状态是否用 `computed` 包裹（不是 `ref` 或手动调用）
2. 检查 `computed` 内部是否有副作用（`console.log` 可以有，`sessionStorage.setItem` 不行）
3. 用 Vue DevTools 检查 computed 的依赖列表
4. 手动触发一个事件，检查 computed 是否自动更新（不需要手动调用）
5. 用 `console.log` 在 computed 内部打印执行次数，确认依赖未变化时不重新执行

---

#### 知识点 5：历史 + 实时事件的合并策略（去重 + 排序）

**定义与边界**：
- **历史事件**：页面挂载时从 `/api/agent/runs/:runId/history?after=N` 拉取的完整事件数组
- **实时事件**：SSE 推送的增量事件（可能与历史重叠，例如断线重连时 Last-Event-ID 回放）
- **合并策略**：按 `sequence` 去重（同 sequence 只保留一个）+ 排序（升序）
- 为什么需要去重：断线重连时 Last-Event-ID 可能回放已有的事件

**为什么需要**：
- 刷新场景：用户刷新页面后历史 API 拉到 sequence 0-100，SSE 从 Last-Event-ID=100 开始推 101+，两者**不重叠**
- 断线重连场景：前端在 sequence 508 后断线，重连时 Last-Event-ID=500，服务端重放 501-508，前端历史已有 501-508，需要**去重**
- 去重策略：同 sequence 只保留一个（历史 vs 实时都可以，内容相同）

**错误用法与后果**：
```typescript
// ❌ 错误：直接拼接不去重
const mergedEvents = [...historyEvents, ...streamEvents] // 重复！
// 后果：前端渲染重复的 tool 卡片、重复的文本段落
```

**正确写法的关键细节**：
```typescript
// ✅ 正确：用 Map 去重 + 排序
export function mergeHistoryAndStream(
  history: readonly AgentEventV1[],
  stream: readonly AgentEventV1[],
): AgentEventV1[] {
  const map = new Map<number, AgentEventV1>()
  for (const event of history) map.set(event.sequence, event)
  for (const event of stream) map.set(event.sequence, event) // 后者覆盖前者（内容相同）
  return Array.from(map.values()).sort((a, b) => a.sequence - b.sequence)
}
```

**实战调试清单**：
1. 检查是否按 sequence 去重（不是按 occurredAt 或其他字段）
2. 模拟断线重连：手动在 Chrome DevTools Network 里 offline → online，检查是否有重复事件
3. 用 `console.log` 打印合并前后的 length，确认去重生效
4. 检查排序是否正确（升序）
5. 写单测：history=[1,2,3], stream=[3,4,5] → 合并后 [1,2,3,4,5]

---

#### 知识点 6：纯函数 reducer 的不可变更新模式

**定义与边界**：
- **纯函数**：同输入同输出、无副作用、不修改输入参数
- **不可变更新**：不直接修改 `state.timeline.push()`，而是返回新对象 `{ ...state, timeline: [...state.timeline, newItem] }`
- Redux 核心约束：reducer 必须是纯函数，否则时间旅行调试、状态回放、React DevTools 都会失效
- Vue 3 里虽然允许 mutable 更新，但**保持纯函数习惯**便于测试和跨框架迁移

**为什么需要**：
- 可测试性：`reduceAgentEvent(state, event)` 输入输出清晰，不依赖全局变量
- 状态回放：Day 30 M3 门禁要求"任何一次 Run 可回放"，纯函数保证从事件流重放出完全相同的状态
- 时间旅行调试：Redux DevTools 可以回退到任意历史状态
- 避免隐蔽 bug：mutable 更新容易导致"修改了 state 但 UI 不更新"（Vue 依赖追踪未触发）

**错误用法与后果**：
```typescript
// ❌ 错误：直接修改 state（mutable 更新）
export function reduceAgentEvent(state: AgentRunState, event: AgentEventV1): AgentRunState {
  state.timeline.push({ kind: 'text', ... }) // 副作用！
  state.lastSequence = event.sequence
  return state // 返回的是同一个对象引用
}
// 后果：Vue 依赖追踪可能不触发更新（对象引用未变化）
```

**正确写法的关键细节**：
```typescript
// ✅ 正确：返回新对象（不可变更新）
export function reduceAgentEvent(state: AgentRunState, event: AgentEventV1): AgentRunState {
  if (event.sequence <= state.lastSequence) return state // 去重：返回原 state
  return {
    ...state,
    timeline: [...state.timeline, { kind: 'text', ... }], // 新数组
    lastSequence: event.sequence,
  }
}
```

**实战调试清单**：
1. 检查 reducer 是否直接修改 state（`state.timeline.push` / `state.xxx = ...`）
2. 检查是否返回新对象（用 `===` 判断引用是否变化）
3. 写单测：调用 reducer 前后检查原 state 是否被修改（`expect(originalState).toEqual(oldSnapshot)`）
4. 用 `Object.freeze(state)` 包裹，如果有 mutable 更新会直接抛错
5. 检查 Vue computed 是否正确触发更新（依赖 state 引用变化）

---

### 5.5 边写边问自己（按 §1.5 的"动手前先问 5 个问题"）

1. **这段代码放在哪一层？** 派生函数放在 `reducer/derived/`，净化函数放在 `contract/audit-schema.ts`，编排逻辑放在 `useAgentTimeline.ts`
2. **这个函数是纯函数吗？** 派生函数和 reducer 都是纯函数，`writeLastEventId` 是副作用函数（放在 persistence 层）
3. **这个状态是源状态还是派生状态？** `timeline` 是源状态，`toolListView` 是派生状态（用 computed 包裹）
4. **去重逻辑放在哪里？** 合并层（`merge-history-stream.ts`）去重 sequence，reducer 层再次去重（双重保险）
5. **隐私边界在哪里？** `sanitizeForAudit` 在审计面板渲染前过滤 CoT 字段

---
## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 前端直接消费 SSE，从挂载那一刻起渲染增量 | + 挂载时拉历史 API 回放 + 合并层去重排序 | + 派生状态三视图 + 审计面板 + sessionStorage 恢复 |
| **事件类型 / 数据模型** | `AgentEventV1[]`（内存 ref） | `AgentEventV1[]`（历史 + 流合并后的数组） | raw state + 4 个派生 view（run/tool/approval/rawEvents） |
| **状态存储** | 内存 `events.value`，刷新即丢 | 内存合并数组，刷新重新拉全量 | sessionStorage 存 lastEventId，刷新只拉增量 |
| **归约逻辑** | `events.reduce(reduceAgentEvent)` 单入口 | `mergeHistoryAndStream()` 双入口去重后再 reduce | 同 v2，reduce 后再经 selector 投影出派生视图 |
| **可测试** | 组件级手测，无单测 | history-api（3 例）+ merge（5 例）单测 | + derived（6 例）+ audit-schema（3 例），共 17 例 |
| **架构层次** | `AgentRunPanel.vue` 直连 stream | 拆出 history/ + reducer/merge | 完整分层 contract/reducer/derived/history/stream/audit/persistence |
| **换事件源代价** | 改组件内 `useSseStream` 调用 | 合并层不变，只改 history-api 的 URL | 合并层 + selector 全不变，只换 history/stream 适配器 |
| **编译期抓遗漏** | timeline 一维数组，kind 判断散在模板 | 同 v1 | 派生 selector 用判别联合 exhaustive check，新增 kind 编译报错 |
| **对齐后续 Day** | 无法分享 URL 恢复 | 可 URL 恢复但无审计 | Day 16-20 RAG 流式界面 / Day 30 M3 门禁"URL 直达完整恢复"地基 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的深挖 HTML 文档：`output/Day15深挖-前端底子补弱.html`

**深挖主题**（对应今天代码里的关键知识点，每个展开 8 子节）：

1. **深挖 1：派生状态（Derived State）—— 从今天项目里的 `tool-list-view.ts` 讲起**
   - 场景锚点：为什么 Tool 卡片更新不该触发 Run 状态徽章重渲染
   - 原理：源状态 vs 派生状态、selector 模式、Vue `computed` 的依赖收集
   - 反例：把 `filter(kind==='tool')` 写在模板里导致的 O(3N) 重复遍历
   - 面试真题三档：初级"什么是 computed 缓存" / 中级"computed vs methods 区别" / 高级"如何设计一个可复用的 selector 层"

2. **深挖 2：sessionStorage / localStorage / Cookie 的生命周期 —— 从 `last-event-id-store.ts` 讲起**
   - 场景锚点：为什么跨刷新恢复用 sessionStorage 而不是 localStorage
   - 原理：三种存储的作用域（tab / origin / 请求）、容量、同步异步、SSR 陷阱
   - 反例：用 localStorage 存 lastEventId 导致多 tab 互相污染
   - 面试真题三档：初级"三者区别" / 中级"何时用哪个" / 高级"如何做跨 tab 状态同步（BroadcastChannel）"

3. **深挖 3：UTF-8 与 TextDecoder 流式解码 —— 从 Day 14 `chunked-parser.ts` 回顾 + 今天审计 payload 讲起**
   - 场景锚点：中文断包为什么会乱码
   - 原理：UTF-8 变长编码、`TextDecoder({ stream: true })` 的内部缓冲
   - 反例：每个 chunk 独立 decode
   - 面试真题三档：初级"UTF-8 一个中文几字节" / 中级"如何处理跨包字符" / 高级"ReadableStream + TextDecoderStream 组合"

**为什么这些放深挖 HTML 而不是正文**：正文给完整可跑代码 + 简要知识点（§5.4），深挖 HTML 展开"原理 + 反例 + 面试三档答法"，是补弱专用文档。深挖 HTML 里**不放动手脚手架**（§1.5 的内容不进 HTML）。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

今天要写 4 个 spec 文件，共 17 个用例：

**1. `history-api.spec.ts`（3 例，v2 已在 §4.3 给出）**
- 成功返回解析 events 数组
- HTTP 500 返回 `ok: false` + `code=http_500`
- 网络异常返回 `ok: false` + `code=network_error`

**2. `merge-history-stream.spec.ts`（5 例，v2 已在 §4.3 给出）**
- 历史 + 空 stream
- 空历史 + stream
- 无重叠合并
- 乱序升序返回
- 相同 sequence stream 覆盖历史

**3. `derived.spec.ts`（6 例）**

```typescript
import { describe, it, expect } from 'vitest'
import { selectRunView } from './run-view'
import { selectToolListView } from './tool-list-view'
import { selectApprovalView } from './approval-view'
import { selectRawEventsView } from './raw-events-view'
import { reduceAgentEvent, initialAgentRunState } from '../agent-run-state'
import type { AgentEventV1 } from '@/agent/contract/agent-event-v1'

const ev = (sequence: number, type: string, payload: object = {}): AgentEventV1 =>
  ({ version: 'v1', type, runId: 'r-01', sequence, occurredAt: '2026-07-28T00:00:00Z', payload } as AgentEventV1)

function buildState(events: AgentEventV1[]) {
  return events.reduce(reduceAgentEvent, initialAgentRunState)
}

describe('derived selectors', () => {
  it('selectRunView 提取 status / summary / error', () => {
    const state = buildState([
      ev(0, 'run.started'),
      ev(1, 'run.finished', { summary: '诊断完成' }),
    ])
    const view = selectRunView(state)
    expect(view.status).toBe('completed')
    expect(view.summary).toBe('诊断完成')
    expect(view.error).toBeUndefined()
  })

  it('selectToolListView 只累积 tool.* 事件', () => {
    const state = buildState([
      ev(0, 'run.started'),
      ev(1, 'tool.started', { callId: 'c-1', toolName: 'getMetrics', argumentSummary: '{}' }),
      ev(2, 'text.delta', { text: '分析中' }),
      ev(3, 'tool.succeeded', { callId: 'c-1', resultSummary: 'CPU 87%', durationMs: 1800 }),
    ])
    const view = selectToolListView(state)
    expect(view).toHaveLength(1)
    expect(view[0].toolName).toBe('getMetrics')
    expect(view[0].status).toBe('succeeded')
    expect(view[0].durationMs).toBe(1800)
  })

  it('selectToolListView 标记 tool.failed', () => {
    const state = buildState([
      ev(0, 'run.started'),
      ev(1, 'tool.started', { callId: 'c-1', toolName: 'getMetrics', argumentSummary: '{}' }),
      ev(2, 'tool.failed', { callId: 'c-1', code: 'rate_limit', message: '限流' }),
    ])
    const view = selectToolListView(state)
    expect(view[0].status).toBe('failed')
    expect(view[0].errorCode).toBe('rate_limit')
  })

  it('selectApprovalView 提取 pending 审批', () => {
    const state = buildState([
      ev(0, 'run.started'),
      ev(1, 'approval.required', { approvalId: 'a-1', action: '重启服务', risk: 'high' }),
    ])
    const view = selectApprovalView(state)
    expect(view.pending).toHaveLength(1)
    expect(view.pending[0].risk).toBe('high')
  })

  it('selectRawEventsView 返回全部原始事件', () => {
    const events = [ev(0, 'run.started'), ev(1, 'text.delta', { text: 'x' })]
    const state = buildState(events)
    const view = selectRawEventsView(state)
    expect(view).toHaveLength(2)
    expect(view[0].sequence).toBe(0)
  })

  it('selectRunView 提取 run.failed 的 error', () => {
    const state = buildState([
      ev(0, 'run.started'),
      ev(1, 'run.failed', { code: 'timeout', message: '超时' }),
    ])
    const view = selectRunView(state)
    expect(view.status).toBe('failed')
    expect(view.error?.code).toBe('timeout')
  })
})
```

**4. `audit-schema.spec.ts`（3 例）**

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeForAudit } from '@/agent/contract/audit-schema'

describe('sanitizeForAudit', () => {
  it('白名单字段原样保留', () => {
    const clean = sanitizeForAudit({
      version: 'v1', type: 'tool.succeeded', runId: 'r-01',
      sequence: 3, occurredAt: '2026-07-28T00:00:00Z',
      payload: { callId: 'c-1', resultSummary: 'ok', durationMs: 100 },
    })
    expect(clean.payload.callId).toBe('c-1')
    expect(clean.payload.resultSummary).toBe('ok')
  })

  it('未知字段替换为 [redacted]', () => {
    const clean = sanitizeForAudit({
      version: 'v1', type: 'text.delta', runId: 'r-01',
      sequence: 1, occurredAt: '2026-07-28T00:00:00Z',
      payload: { text: '结论', reasoning: '模型的私有思考链' } as any,
    })
    expect(clean.payload.text).toBe('结论')
    expect((clean.payload as any).reasoning).toBe('[redacted: unknown field]')
  })

  it('顶层未知字段也被拦截', () => {
    const clean = sanitizeForAudit({
      version: 'v1', type: 'run.started', runId: 'r-01',
      sequence: 0, occurredAt: '2026-07-28T00:00:00Z',
      payload: {}, internalTrace: 'secret',
    } as any)
    expect((clean as any).internalTrace).toBeUndefined()
  })
})
```

运行：`pnpm --filter frontend test agent` 应看到 17 个用例全绿。

### 7.7 F-1：反证实验 1（5 分钟）—— 跳过合并层，直接顺序 push

**操作**：临时把 `useAgentTimeline` 里的 `mergeHistoryAndStream(history, stream)` 换成 `[...history, ...stream]`（不去重不排序），然后在测试里模拟乱序：历史返回 `[0..29]`，SSE 先推 `32`、再推迟到的 `30, 31`。

**预期观察**：
- reducer 消费到 sequence 32 时，`state.lastSequence = 32`
- 迟到的 30、31 到达时，reducer 的规则 A（`sequence <= lastSequence` 去重）把它们吞掉
- UI 缺 2 张卡片（sequence 30、31 对应的事件）

**结论记录到学习日志**：没有合并层的 sequence 排序，reducer 的单调去重规则会误杀乱序到达的合法事件。合并层的价值在于"先排序再喂给 reducer"。

### 7.8 F-2：反证实验 2（5 分钟）—— 一维 timeline 暴露给组件

**操作**：临时在 `AgentRunPanel.vue` 里绕过派生 selector，直接 `v-for="item in state.timeline"` 渲染，并在 Tool 卡片、Run 徽章、Text 块各加一个 `console.count('render-xxx')`（或用 Vue DevTools 的 render 高亮）。然后触发一个 `tool.failed` 事件。

**预期观察**：
- Tool 卡片区重渲染（预期内）
- Run 状态徽章区也重渲染（不该发生）
- Text 输出块也重渲染（不该发生）
- DevTools 显示整个 `<section>` 高亮闪烁

**结论记录到学习日志**：一维 state 导致所有区域共享同一个 computed 依赖，任意事件更新触发全量重渲染。派生 selector 把 state 投影成互相独立的 view，让 Vue 的依赖追踪能精确到"只有 tool 变化时才重渲染 ToolListView"。

### 7.9 F-3：验证 + 提交（10 分钟）

**四件套**（在 `frontend/` 目录）：

```bash
pnpm --filter frontend typecheck
pnpm --filter frontend lint
pnpm --filter frontend test agent
pnpm --filter frontend build
```

四条全绿后提交：

```bash
git add frontend/src/agent frontend/src/features/agent-run
git commit -m "feat(agent-timeline): 派生状态 + 审计 UI + 持久化恢复

- 挂载时先拉历史 API 回放，再订阅 SSE 增量
- mergeHistoryAndStream 合并层做 sequence 去重 + 排序
- 4 个派生 selector 分离 run/tool/approval/rawEvents 视图
- 审计面板 + audit-schema 白名单拦截未知字段（隐私红线）
- sessionStorage 持久化 lastEventId，刷新只拉增量
- 17 个单元测试覆盖 history/merge/derived/audit

Refs: Day15"
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day16 结束时集中 push。

---
## 8. 通过标准

今天完成算过关，必须同时满足：

1. **fixture 与真实 transport 共用同一份合同**：`sample-run.ts` 里的离线 fixture 和真实 SSE/历史 API 返回的事件，都是同一个 `AgentEventV1` 类型；reducer 和派生 selector 不区分数据来源
2. **刷新后状态一致**：页面跑到 sequence 30 时刷新，恢复后 timeline / tool 卡片 / approval 面板与刷新前完全一致，无重复卡片、无闪烁、恢复 < 300ms
3. **四类网络场景全部覆盖**：
   - 刷新：sessionStorage lastEventId + 增量历史
   - 重连：Day 14 的 Last-Event-ID resume，合并层去重
   - 乱序：合并层 sequence 排序后再喂 reducer
   - 工具失败：`tool.failed` 只重渲染 Tool 卡片区
4. **审计面板隐私红线生效**：未知字段（如 `reasoning`）被替换为 `[redacted]`，不渲染模型 Chain of Thought
5. **17 个单元测试全绿**，四件套（typecheck / lint / test / build）通过
6. **不重新发明事件合同**：没有新建一套跟 Day 01/Day 14 平行的事件类型；今天只加"合并层 + 派生层 + 审计层"，事件合同复用 `AgentEventV1`

先回答本文件 §10 的三道课末核心问题；项目初检通过后再进入 §13 教师五连问。

---

## 9. 提交物

完成今天的学习后，需要交付：

1. **commit**：含 `Refs: Day15`，遵循 Conventional Commits（见 §7.9 模板）
2. **测试输出**：`pnpm --filter frontend test agent` 的完整输出截图/文本，17 个用例全绿
3. **学习日志**：记录 §7.7 和 §7.8 两个反证实验的观察结论
4. **架构证据**：
   - 依赖方向图（§1.4）在真实代码里的落地：用 `pnpm --filter frontend exec eslint` 的 import 规则或手工检查 `reducer/` 里无 `import vue`
   - 状态归约图：从"原始事件"到"raw state"到"4 个派生 view"的流转图
5. **AI Review 记录**：如果今天用 AI 生成了组件模板或测试样板，记录接受/修改/拒绝的理由；核心的 reducer 演进、合并策略、派生 selector 设计由人负责

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（用户导航到 `/runs/:id`）到最终输出（页面渲染完整时间线），解释"Agent 时间线"的数据流：历史 API + SSE 两个数据源如何汇入合并层，合并层输出如何喂给 reducer，reducer 的 raw state 如何经 4 个派生 selector 投影成独立视图。当天知识链"Event reducer、派生状态、持久化恢复、审计 UI"分别在哪一层起作用，为什么按这个顺序学习？

2. 如果故意移除合并层的 sequence 排序（直接 `[...history, ...stream]`），线上会出现什么可观察现象？请给出最小复现（乱序到达的 sequence 序列）、定位证据（reducer 的 lastSequence 去重日志）、恢复动作（补回合并层）和一条防复发测试。

3. 请引用今天的具体代码（`merge-history-stream.ts` / `derived/*.ts` / `audit-schema.ts`）、测试（17 个用例）和架构证据（依赖方向图），证明"刷新后状态一致 + 隐私红线生效"已经达到；再说明当前实现距离企业生产标准还缺什么（例如：派生 selector 在 5 万事件的 Run 上是否需要虚拟滚动 / memo；审计面板是否需要分页；lastEventId 在多 tab 场景是否需要 BroadcastChannel 同步），下一步如何演进而不破坏 `AgentEventV1` 合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 页面刷新时 Run 正处于 `awaiting-approval`，历史 API 与新 SSE 同时回放同一 `approval.required` 事件，UI 生成两个审批卡片，运维误点了两次"批准"。请比较历史游标（`after` 参数）、实时 sequence 和 reducer 的 `lastSequence` 定位重复来源；先禁用重复批准操作止损（同一 approvalId 只允许一次决策），再统一历史/实时合同与归约入口（合并层去重），并用刷新、重连、乱序回放三个场景验证状态一致。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)

2. Tool 先失败（`tool.failed`）后 Agent 选择继续（后续还有 `tool.started`），但时间线把整个 Run 直接标红终止；客服无法判断实际终态。请用原始事件（审计面板）、派生状态（`selectRunView` vs `selectToolListView`）和审计记录定位语义错误——问题在于把"Tool 状态"和"Run 状态"耦合了；先显示"状态未知"止损，再分离 Tool 与 Run 状态（Tool 失败只影响 ToolListView，Run 终态只由 `run.*` 事件决定），回放"失败后继续"和"失败后终止"两类轨迹验证。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：Event reducer、派生状态（Tool 与 Run 状态分离）、持久化恢复和可审计时间线。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. Agent 场景如何设计可扩展的工具调用组件，处理 Calling、Success、Error、Requires Action 生命周期？
   来源：[《2026微信读书前端面试-agent方向》](<../../资源/2026微信读书前端面试-agent方向.pdf>)，第 7 页。

2. 如何实现支持多轮对话中断和重新生成的状态机？
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 6 页。

题目说明：第一题对应今天的派生 `selectToolListView`——每个 Tool 卡片的 `status: 'started' | 'succeeded' | 'failed'` 就是 Calling/Success/Error 生命周期，`approval.required` 对应 Requires Action；第二题对应真实 SSE 事件进入 reducer 后的状态归约、派生状态、历史恢复和审计展示。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

参考方向（教师现场按 diff 展开，不限于此）：
1. **局部机制**：`mergeHistoryAndStream` 用 `Map<number, event>` 去重，为什么不用 `Set`？相同 sequence 时为什么 stream 覆盖 history？
2. **边界一致性**：如果历史 API 返回的 `latestSequence` 和实际 events 数组最后一个 sequence 不一致，会发生什么？
3. **线上事故**：`selectToolListView` 遍历 `state.timeline` 是 O(N)，一条 5 万事件的 Run 会卡吗？怎么优化？
4. **工程权衡**：审计 schema 白名单为什么放前端（服务端不是已经保证合同了吗）？纵深防御的代价是什么？
5. **架构演进**：今天的派生 selector 是纯函数，如果未来要接入 p2-agent-workbench 的多 Agent（一个页面同时展示 3 个 Agent 的时间线），这套架构要怎么扩展？

---

## 14. 本 Day 在 90 天路线中的锚点

**承上**：
- Day 01 定义的 `AgentEvent` 判别联合 + `reduceAgentEvent` 纯函数，今天被真实 SSE 事件驱动，不再跑 fixture
- Day 13 的持久化（AgentRun / agent_events 表）为今天的历史 API `GET /runs/:id/events` 提供数据源
- Day 14 的 SSE 合同 v1 + resume + 取消，为今天的实时增量流提供 transport

**启下**：
- **Day 16-20（LangChain RAG）**：RAG 的流式回答界面复用今天的"历史 + 实时合并"和"派生状态"模式——检索结果作为一种事件类型进入同一条时间线
- **Day 30（M3 门禁）**：会要求"任何一次 Agent Run 都必须能从 URL 直接进入并完整恢复"——今天的 sessionStorage + 增量历史就是这个能力的地基
- **Day 61-90（p2-agent-workbench）**：多 Agent 协同工作台的时间线展示层，直接复用今天的派生 selector 架构（把单 Agent 的 view 扩展成多 Agent 的 view 数组）

**今天在 90 天里的一句话定位**：把前 14 天分散在"前端 reducer / 后端持久化 / SSE transport"三条线上的能力，第一次合并成一个**能承受真实网络问题、能审计、能恢复**的完整时间线展示层。
