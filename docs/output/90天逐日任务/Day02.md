# Day 02：领域合同（Schema × DTO × Domain 三版保护递进）

> **《90 天拆分规则说明》校正口径（Day 02 权威执行口径）**
>
> - 阶段定位：阶段一（Day01-30，前端 -> AI 前端），本日交付 p1-monitor 前端的领域合同模块。
> - 完整模块：AgentEvent、Server、Metric、Anomaly 的 Schema/DTO/Domain/Adapter 边界，代码落点为 src/domain/contracts/，必须能运行、能测试、能观察拒绝和兼容结果。
> - v1：静态 Domain 类型；v2：zod 运行时校验与 DTO/Domain 分层；v3：schemaVersion、v1-to-v2 兼容适配器和弃用窗口。后一版必须明确修复前一版的具体痛点。
> - 累积复用：输入是 Day01 的 AgentEvent 判别联合；输出直接供 Day03 的领域对象、Day05 的 WebSocket 校验和 Day15 的历史恢复复用。
> - 时间盒：90 分钟阅读 + 90 分钟动手；阅读 30/30/30 分钟，动手完成 v1/v2/v3、至少 12 个合同测试和两个反证实验。
> - 硬门槛：提交真实 diff、typecheck/lint/test/build 输出和证据文件；任何 TODO、空壳或未运行的代码不得标记完成。
>
> **版本验收与反证**：反证 1 临时去掉运行时 Schema 校验并注入脏数据，必须观察到运行时崩溃或错误边界缺失；反证 2 临时去掉 schemaVersion 并注入 v1 payload，必须观察到兼容判断失败；恢复保护后两项测试重新通过。
>
> **跨 Day 导航**：前置 Day01 的事件合同；本日输出供 Day03/05/15 使用，随后与 Day30 的月度门禁一起验证跨层合同稳定性。

任务版本：标准版
日期与时长：2026-07-15 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\frontend`
角色视角：有 Vue 中后台经验、第一次为 Agent 场景把「前后端合同」做严的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + Python/FastAPI + RAG）

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 2 处在阶段一第 2 天**，直接接续 Day 1 在 `p1-monitor/frontend` 里定义的 `AgentEvent` 判别联合，把它升级为「有 Schema 校验、有版本合同、能挡非法输入」的正式领域合同。今天定义的合同会被 Day 3（`Server / Metric / Anomaly` 三张业务表）、Day 5（WebSocket 事件校验）、Day 15（SSE 断线重连时的历史校验）反复复用。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/frontend` 里为 4 个核心领域对象建立完整合同：`AgentEvent` / `Server` / `Metric` / `Anomaly`。每个对象都要覆盖三层：

- **网络层 DTO**（`unknown` → 通过 `zod` schema 校验 → 合法 DTO）；
- **领域层 Domain**（DTO 经适配变成业务对象，可能带有 branded type 和不变量）；
- **版本兼容 Adapter**（旧版本 payload 经适配器变成新版本 Domain）。

### 1.1 用户能看到什么

从用户视角看，页面**没有**任何视觉变化——今天做的是**内部合同层**。但用户会感受到两个差异：

- 之前后端偶尔漏字段或字段类型错误时，图表变成 `NaN`；今天开始，**这类数据在进入视图层之前就被拒绝**并打日志，图表不再乱。
- 后端切换 `AgentEvent v1 → v2` 版本时，前端不再白屏，而是根据 `schemaVersion` 走**兼容适配层**。

### 1.2 这个模块在项目里承担什么

- **输入**：来自 WebSocket / 未来 REST API 的 `unknown` 数据；
- **输出**：一个**合同边界**，让下游（Vue 组件、reducer、图表库）永远只看到合法数据；
- **对齐后续**：Day 3 建表结构、Day 5 挂 WebSocket、Day 15 恢复历史事件流时，都直接复用今天定义的 schema。

### 1.3 三版演进的目标

Day 02 主题是「领域合同」，天然不适合 Day 01 那种"功能递增"的三版演进。本日采用**保护递进**三版：

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 只定义 Domain 类型，不做运行时校验 | 一个 `types.ts` 存所有 interface | TypeScript 静态类型的**边界**：只挡编译期错误，挡不住线上非法输入 |
| **v2** | v1 + 用 `zod` schema 做运行时校验，DTO/Domain 分层 | `schemas.ts` + `dtos.ts` + `domain.ts` 三文件 | 运行时 Schema、`unknown → DTO → Domain`、`safeParse` 错误路径 |
| **v3** | v2 + 版本合同（`schemaVersion` 字段 + 兼容适配器） | 加入 `adapters/v1-to-v2.ts` | 合同版本、弃用窗口、兼容层的隔离原则、非法样本注入测试 |

**用户最终在项目里交付的是 v3**。v1、v2 是过渡：v1 让你亲眼看到"只写 TS 类型挡不住脏数据"；v2 让你亲眼看到"没有版本字段时上游一改动就白屏"；v3 才是生产可用的合同层。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Day 02 的合同层要动 4 个领域对象、3 个层次（Schema / DTO / Domain），如果不先立骨架，你会在 `types.ts` / `schemas.ts` / `dtos.ts` / `domain.ts` 里来回找文件。看完这棵树，下面章节里再出现 `src/domain/contracts/schemas/agent-event.schema.ts` 时，你就能立刻定位它在项目里的位置。

**今天在 `p1-monitor/frontend/` 下要建立/扩展的完整前端源码树（v3 完整版）**：

```
src/
├── domain/                                              ← 领域层（纯类型 + 纯逻辑，不依赖 Vue）
│   ├── agent/                                           ← Day 01 已建
│   │   ├── agent-event.ts                               ← Day 01：事件类型（判别联合）
│   │   ├── agent-run-state.ts                           ← Day 01：状态类型 + reducer
│   │   └── agent-run-state.spec.ts                      ← Day 01：reducer 测试
│   └── contracts/                                       ← ★ Day 02 新增：领域合同层
│       ├── schemas/                                     ← ★ 运行时 Schema（zod）
│       │   ├── agent-event.schema.ts                    ← ★ AgentEvent 9 变体 + schemaVersion
│       │   ├── server.schema.ts                         ← ★ Server 领域对象 Schema
│       │   ├── metric.schema.ts                         ← ★ Metric 时序数据 Schema
│       │   └── anomaly.schema.ts                        ← ★ Anomaly 异常事件 Schema
│       ├── dtos/                                        ← ★ 网络层 DTO（Schema infer 出来的类型）
│       │   ├── agent-event.dto.ts                       ← ★ type AgentEventDto = z.infer<typeof schema>
│       │   ├── server.dto.ts                            ← ★ DTO：网络层 Server 类型
│       │   ├── metric.dto.ts                            ← ★ DTO：网络层 Metric 类型
│       │   └── anomaly.dto.ts                           ← ★ DTO：网络层 Anomaly 类型
│       ├── domain/                                      ← ★ 业务领域对象（含 branded type / 不变量）
│       │   ├── server.ts                                ← ★ type ServerId = string & { __brand: 'ServerId' }
│       │   ├── metric.ts                                ← ★ 带单位 / 时间范围不变量的 Metric
│       │   └── anomaly.ts                               ← ★ 严重度枚举 + 处置状态机
│       ├── adapters/                                    ← ★ DTO ↔ Domain 适配 + 版本兼容
│       │   ├── dto-to-domain.ts                         ← ★ unknown → safeParse → DTO → Domain
│       │   └── v1-to-v2.ts                              ← ★ AgentEvent v1 兼容适配器
│       └── contracts.spec.ts                            ← ★ 至少 12 个合同测试
├── features/                                            ← Day 01 已建；今天不动
│   └── agent-run/
│       ├── ui/AgentRunPanel.vue                         ← 沿用 Day01 交互，仅更新类型 import 并用回归测试证明行为不变
│       └── fixtures/sample-run.ts                       ← 改为从 contracts/fixtures/ 导入
├── composables/
│   └── useAgentRun.ts                                   ← Day 02 起：从 dto-to-domain 拿数据
└── App.vue                                              ← 编排层：Day 02 起校验入口只在这里
```

**三版演进对应的文件差异**：

| 版本 | 建/改的文件 | 不建的文件 |
|---|---|---|
| **v1** | 只有 `domain/contracts/domain/*.ts`（4 个纯类型文件） | 其余全不建；直接 `as` 强断言 |
| **v2** | v1 + `schemas/*.ts` + `dtos/*.ts` + `adapters/dto-to-domain.ts` + `contracts.spec.ts` | 还没有版本合同 `v1-to-v2.ts` |
| **v3** | 完整树（含 `adapters/v1-to-v2.ts`） | —— |

**依赖方向（务必单向）**：

```
App.vue → composables → features → domain/contracts/adapters → domain/contracts/domain
                                                              ↘ domain/contracts/dtos ← domain/contracts/schemas
```

**红线**：`domain/contracts/domain/*.ts` 里出现 `import { z } from 'zod'` 就是塌方。**Domain 层不认识运行时校验库**——校验是 adapter 的活儿，Domain 只管业务不变量。

**动手前先问自己 3 个问题**（答不上就带着问题往下读 v1 → v2 → v3）：

1. 为什么必须分 DTO 和 Domain 两层？直接把 `z.infer` 出来的类型当业务对象用不行吗？—— 见 v3 的第 5.4 节「DTO / Domain 分层的必要性」。
**DTO只保证结构合法 不保证业务的可用 Domain保证数据在业务上是合法好用的，z.infer能用不建议用，如果直接使用的话会存在 脏数据进业务逻辑，业务层和后端返回字段强耦合等**
2. `schemaVersion` 放在事件的哪一层？payload 内还是外？—— 见 v3 的第 5.4 节「版本字段位置的权衡」。
3. 兼容适配器什么时候删？—— 见 v3 的第 5.4 节「弃用窗口」。

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

**为什么放在正文前面**：Day 02 要新增 12 个以上文件，如果不先建目录、装依赖，你读到 v3 完整代码那节会不知道往哪儿放。先用 20 分钟把 `zod` 装上、目录建齐、跑一次 `pnpm typecheck` 确认没打错字，再回过头读代码解释才有感觉。

**动手节奏建议**：本节 1.5.1-1.5.5 快速过一遍（20 分钟） → 读第 2-6 节正文（约 120 分钟） → 到第 7 节做测试 + 反证 + 验收（60 分钟）。

### 1.5.1 D-1：装依赖（3 分钟）

```powershell
Set-Location D:\demo\ai-techer\p1-monitor\frontend
pnpm add zod
pnpm typecheck  # 确认 Day 01 代码没被破坏
```

### 1.5.2 D-2：创建目录（3 分钟）

按 §1.4 目录树建目录（此时先建空目录，文件在 1.5.3-1.5.5 里逐个填上）：

```powershell
New-Item -ItemType Directory -Force -Path `
  src\domain\contracts\schemas, `
  src\domain\contracts\dtos, `
  src\domain\contracts\domain, `
  src\domain\contracts\adapters
```

### 1.5.3 D-3：实现 schemas / dtos / domain 层（约 10 分钟）

按第 5.3 节的代码：

- 写 `src/domain/contracts/schemas/agent-event.schema.ts`（9 种事件 schema + schemaVersion）
- 写 `src/domain/contracts/schemas/server.schema.ts`
- 写 `src/domain/contracts/schemas/metric.schema.ts`
- 写 `src/domain/contracts/schemas/anomaly.schema.ts`
- 写 `src/domain/contracts/dtos/*.ts`（4 个 DTO 文件，每个只有 `z.infer` 一行）
- 写 `src/domain/contracts/domain/*.ts`（4 个 Domain 类型文件）

**边写边问自己**：

- `z.object()` 和 `z.discriminatedUnion()` 分别在什么场景用？
数据只有一种形状 → z.object()
数据分几种变体,靠某个字段的值区分是哪种 → z.discriminatedUnion()
- `safeParse` 相比 `parse` 的区别？为什么生产代码不该用 `parse`？
parse 用异常表达失败,漏接就崩;safeParse 把失败变成必须处理的返回值,编译器逼你兜底。生产代码在处理外部不可信数据(后端响应、事件流),失败是预期内的事,所以用 safePars
(个人看法)  **safeParse 返回一个带 success 和 error 的结果对象,我必须先判断 success 才能拿 data,不判断的话 TS 在编译时就报错逼我处理。后端数据校验失败时,就走 error 分支跑我自己的报错/兜底流程。而 parse 是直接抛异常,粗暴,漏接就整个崩。**
- `schemaVersion` 为什么放在 event 外层而不是 payload 内？

### 1.5.4 D-4：实现 adapters 层（约 4 分钟）

按第 5.3 节的代码：

- 写 `src/domain/contracts/adapters/dto-to-domain.ts`（unknown → safeParse → DTO → Domain 映射）
- 写 `src/domain/contracts/adapters/v1-to-v2.ts`（v1 事件兼容适配器）

**边写边问自己**：

- 为什么 `toServer` 函数先 `safeParse` 再转 Domain，而不是直接 `parse` 然后 try-catch？
- v1-to-v2 适配器什么时候可以删？

### 1.5.5 D-5：接入 App.vue（约 3 分钟）

按第 5.3 节改 `src/App.vue`，把 Day 01 的 `sampleEvents` import 路径换成从 `adapters/dto-to-domain` 拿校验后的事件。

```powershell
pnpm dev
```

浏览器打开 `http://localhost:5173`，观察：

- 控制台无报错（说明 schema 校验通过）
- 页面展示与 Day 01 一致（说明合同层是透明的）

看到这个画面就说明 v3 已经跑起来了。**卡住不要死磕**：先跳过继续读第 2-6 节正文，读完再回来调试；测试和反证实验放到第 7 节做。

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| A | 30 分钟 | 阅读第 3 节（v1：纯 TS 类型） | 阅读 |
| B | 30 分钟 | 阅读第 4 节（v2：加 zod 校验） | 阅读 |
| C | 30 分钟 | 阅读第 5 节（v3：加版本合同） | 阅读 |
| D | 60 分钟 | 在自己项目里手写 v3（Schema + Domain + Adapter） | 动手 |
| E | 20 分钟 | 写 ≥ 12 个合同测试 + 两个反证实验 | 动手 |
| F | 10 分钟 | 运行 lint/typecheck/test/build，提交 commit | 动手 |

前 90 分钟只读、不写；后 90 分钟只写、不读。**中途遇到不懂的先跳过、别停下**。

---

## 3. v1：只定义 Domain 类型，不做运行时校验

### 3.1 v1 要实现什么

只做一件事：定义 4 个核心领域对象的 TypeScript 类型（`Server` / `Metric` / `Anomaly` / `AgentEvent`），让代码能通过编译期类型检查。

**技术上要处理**：

- 用 `interface` 或 `type` 定义每个对象的字段结构；
- 用 branded type 区分 `ServerId` 和普通 `string`；
- 从网络拿到的 `unknown` 数据直接 `as Server` 强断言。

**v1 暴露的痛点**：

编译通过不等于运行正确。后端返回 `{ id: 123 }`（数字）时，前端 `as Server` 照样能编译，但运行时拿到的 `server.id.split('-')` 直接崩溃。

### 3.2 v1 完整代码

**src/domain/contracts/domain/server.ts**

```typescript
// ServerId 是字符串，但用 branded type 区分它和普通 string
export type ServerId = string & { readonly __brand: 'ServerId' }

export interface Server {
  id: ServerId
  name: string
  ip: string
  status: 'online' | 'offline' | 'maintenance'
  tags: string[]
}
```

**src/domain/contracts/domain/metric.ts**

```typescript
export type MetricId = string & { readonly __brand: 'MetricId' }

export interface Metric {
  id: MetricId
  serverId: string  // 暂时用 string，v2 会改成 ServerId
  name: string
  value: number
  unit: string
  timestamp: string  // ISO 时间戳
}
```

**src/domain/contracts/domain/anomaly.ts**

```typescript
export type AnomalyId = string & { readonly __brand: 'AnomalyId' }

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface Anomaly {
  id: AnomalyId
  serverId: string
  metricName: string
  severity: Severity
  detectedAt: string
  message: string
}
```

**src/domain/contracts/domain/agent-event.ts**

```typescript
import type { RunId } from '@/domain/agent/agent-event'

// 复用 Day 01 的 RunId branded type

type EventMeta = {
  runId: RunId
  sequence: number
  occurredAt: string
}

export type AgentEventDomain =
  | (EventMeta & { type: 'run.started'; payload: Record<string, never> })
  | (EventMeta & { type: 'text.delta'; payload: { text: string } })
  | (EventMeta & { type: 'tool.started'; payload: { callId: string; toolName: string; argumentSummary: string } })
  | (EventMeta & { type: 'tool.succeeded'; payload: { callId: string; resultSummary: string; durationMs: number } })
  | (EventMeta & { type: 'tool.failed'; payload: { callId: string; code: string; message: string } })
  | (EventMeta & { type: 'approval.required'; payload: { approvalId: string; action: string; risk: 'low' | 'medium' | 'high' } })
  | (EventMeta & { type: 'run.cancelled'; payload: { reason: string } })
  | (EventMeta & { type: 'run.failed'; payload: { code: string; message: string } })
  | (EventMeta & { type: 'run.finished'; payload: { summary: string } })
```

**使用示例（在 App.vue 或 composable 里）**：

```typescript
import type { Server } from '@/domain/contracts/domain/server'

// 从网络拿到的数据
const rawData: unknown = await fetch('/api/servers/srv-001').then(r => r.json())

// v1 的做法：直接强断言
const server = rawData as Server

console.log(server.name)  // 如果后端返回的 rawData 没有 name 字段，这里会是 undefined，但 TS 认为它是 string
```

### 3.3 v1 用到的知识点

**知识点 1：Branded Type——用类型系统区分"语义上不同的 string"**

`ServerId` 和 `MetricId` 都是字符串，但业务上不能混用。Branded type 通过交叉类型 `string & { __brand: 'ServerId' }` 让 TS 把它们当成不同类型：

```typescript
type ServerId = string & { readonly __brand: 'ServerId' }
type MetricId = string & { readonly __brand: 'MetricId' }

const srvId: ServerId = 'srv-001' as ServerId
const metId: MetricId = 'met-001' as MetricId

function getServer(id: ServerId) { /* ... */ }

getServer(srvId)   // ✅ 编译通过
getServer(metId)   // ❌ 编译报错：MetricId 不能赋给 ServerId
getServer('srv-002')  // ❌ 编译报错：string 不能赋给 ServerId
```

运行时 `ServerId` 就是普通字符串，`__brand` 字段只存在于类型层，不占内存。

**v1 的局限**：branded type 只在编译期生效。网络返回 `{ id: 123 }` 时，`as ServerId` 照样能编译通过，运行时爆炸。

### 3.4 v1 暴露的痛点（触发 v2 重构的实验）

**实验 1：后端返回字段类型错误**

模拟后端返回错误数据：

```typescript
const fakeResponse: unknown = {
  id: 123,  // 应该是 string，这里错误地返回了 number
  name: 'srv-001',
  ip: '192.168.1.1',
  status: 'online',
  tags: ['prod', 'api'],
}

const server = fakeResponse as Server

console.log(server.id.split('-'))  // 💥 运行时崩溃：123.split is not a function
```

TS 编译器认为 `server.id` 是 `ServerId`（即 `string`），但运行时它是 `number`。

**实验 2：后端返回字段缺失**

```typescript
const fakeResponse: unknown = {
  id: 'srv-001',
  // name 字段缺失
  ip: '192.168.1.1',
  status: 'online',
  tags: [],
}

const server = fakeResponse as Server

console.log(server.name.toUpperCase())  // 💥 运行时崩溃：Cannot read property 'toUpperCase' of undefined
```

**v1 的根本问题**：TypeScript 的类型系统只在编译期生效，`as` 强断言绕过了所有检查。运行时拿到的数据是什么样，TS 根本不知道。

---

## 4. v2：加 zod schema 做运行时校验，DTO/Domain 分层

### 4.1 v2 要实现什么

在 v1 基础上加两件事：

1. 用 `zod` schema 在运行时校验网络数据，拒绝不合法的输入；
2. 分 DTO 和 Domain 两层：DTO 是网络层类型（`z.infer` 出来的），Domain 是业务层类型（可能带额外不变量）。

**技术上要处理**：

- 写 4 个 `zod` schema（`ServerSchema` / `MetricSchema` / `AnomalySchema` / `AgentEventSchema`）；
- 从 schema `infer` 出 DTO 类型；
- 写 `dto-to-domain.ts` 适配器，把 DTO 转成 Domain；
- 在 `App.vue` 里调用 `safeParse` 校验网络数据。

**v2 暴露的痛点**：

后端从 `AgentEvent v1` 升级到 `v2`（比如给 `payload` 加了新字段），前端 schema 还是 v1 格式，`safeParse` 会拒绝所有 v2 事件，导致页面白屏。没有版本字段，前端无法区分"这是 v1 还是 v2"。

### 4.2 v2 完整代码

**src/domain/contracts/schemas/server.schema.ts**

```typescript
import { z } from 'zod'

export const ServerSchema = z.object({
  id: z.string().regex(/^srv-[a-z0-9]+$/),  // 校验 id 格式
  name: z.string().min(1),
  ip: z.string().ip(),  // 校验 IP 格式
  status: z.enum(['online', 'offline', 'maintenance']),
  tags: z.array(z.string()),
})
```

**src/domain/contracts/schemas/metric.schema.ts**

```typescript
import { z } from 'zod'

export const MetricSchema = z.object({
  id: z.string().regex(/^met-[a-z0-9]+$/),
  serverId: z.string().regex(/^srv-[a-z0-9]+$/),
  name: z.string().min(1),
  value: z.number(),
  unit: z.enum(['percent', 'bytes', 'count', 'ms']),
  timestamp: z.string().datetime(),  // ISO 8601 格式
})
```

**src/domain/contracts/schemas/anomaly.schema.ts**

```typescript
import { z } from 'zod'

export const AnomalySchema = z.object({
  id: z.string().regex(/^ano-[a-z0-9]+$/),
  serverId: z.string().regex(/^srv-[a-z0-9]+$/),
  metricName: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  detectedAt: z.string().datetime(),
  message: z.string(),
})
```

**src/domain/contracts/schemas/agent-event.schema.ts**

```typescript
import { z } from 'zod'

const EventMetaSchema = z.object({
  runId: z.string(),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
})

const RunStartedSchema = EventMetaSchema.extend({
  type: z.literal('run.started'),
  payload: z.object({}),
})

const TextDeltaSchema = EventMetaSchema.extend({
  type: z.literal('text.delta'),
  payload: z.object({
    text: z.string(),
  }),
})

const ToolStartedSchema = EventMetaSchema.extend({
  type: z.literal('tool.started'),
  payload: z.object({
    callId: z.string(),
    toolName: z.string(),
    argumentSummary: z.string(),
  }),
})

const ToolSucceededSchema = EventMetaSchema.extend({
  type: z.literal('tool.succeeded'),
  payload: z.object({
    callId: z.string(),
    resultSummary: z.string(),
    durationMs: z.number().int().nonnegative(),
  }),
})

const ToolFailedSchema = EventMetaSchema.extend({
  type: z.literal('tool.failed'),
  payload: z.object({
    callId: z.string(),
    code: z.string(),
    message: z.string(),
  }),
})

const ApprovalRequiredSchema = EventMetaSchema.extend({
  type: z.literal('approval.required'),
  payload: z.object({
    approvalId: z.string(),
    action: z.string(),
    risk: z.enum(['low', 'medium', 'high']),
  }),
})

const RunCancelledSchema = EventMetaSchema.extend({
  type: z.literal('run.cancelled'),
  payload: z.object({
    reason: z.string(),
  }),
})

const RunFailedSchema = EventMetaSchema.extend({
  type: z.literal('run.failed'),
  payload: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

const RunFinishedSchema = EventMetaSchema.extend({
  type: z.literal('run.finished'),
  payload: z.object({
    summary: z.string(),
  }),
})

export const AgentEventSchema = z.discriminatedUnion('type', [
  RunStartedSchema,
  TextDeltaSchema,
  ToolStartedSchema,
  ToolSucceededSchema,
  ToolFailedSchema,
  ApprovalRequiredSchema,
  RunCancelledSchema,
  RunFailedSchema,
  RunFinishedSchema,
])
```

**src/domain/contracts/dtos/server.dto.ts**

```typescript
import { z } from 'zod'
import { ServerSchema } from '../schemas/server.schema'

export type ServerDto = z.infer<typeof ServerSchema>
```

**src/domain/contracts/dtos/metric.dto.ts**

```typescript
import { z } from 'zod'
import { MetricSchema } from '../schemas/metric.schema'

export type MetricDto = z.infer<typeof MetricSchema>
```

**src/domain/contracts/dtos/anomaly.dto.ts**

```typescript
import { z } from 'zod'
import { AnomalySchema } from '../schemas/anomaly.schema'

export type AnomalyDto = z.infer<typeof AnomalySchema>
```

**src/domain/contracts/dtos/agent-event.dto.ts**

```typescript
import { z } from 'zod'
import { AgentEventSchema } from '../schemas/agent-event.schema'

export type AgentEventDto = z.infer<typeof AgentEventSchema>
```

**src/domain/contracts/adapters/dto-to-domain.ts**

```typescript
import { ServerSchema } from '../schemas/server.schema'
import { MetricSchema } from '../schemas/metric.schema'
import { AnomalySchema } from '../schemas/anomaly.schema'
import { AgentEventSchema } from '../schemas/agent-event.schema'
import type { Server, ServerId } from '../domain/server'
import type { Metric, MetricId } from '../domain/metric'
import type { Anomaly, AnomalyId } from '../domain/anomaly'
import type { AgentEventDomain } from '../domain/agent-event'
import type { RunId } from '@/domain/agent/agent-event'

export function toServer(input: unknown): Server | null {
  const result = ServerSchema.safeParse(input)
  if (!result.success) {
    console.error('ServerSchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    id: result.data.id as ServerId,
  }
}

export function toMetric(input: unknown): Metric | null {
  const result = MetricSchema.safeParse(input)
  if (!result.success) {
    console.error('MetricSchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    id: result.data.id as MetricId,
    serverId: result.data.serverId as ServerId,
  }
}

export function toAnomaly(input: unknown): Anomaly | null {
  const result = AnomalySchema.safeParse(input)
  if (!result.success) {
    console.error('AnomalySchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    id: result.data.id as AnomalyId,
    serverId: result.data.serverId as ServerId,
  }
}

export function toAgentEvent(input: unknown): AgentEventDomain | null {
  const result = AgentEventSchema.safeParse(input)
  if (!result.success) {
    console.error('AgentEventSchema validation failed:', result.error)
    return null
  }
  return {
    ...result.data,
    runId: result.data.runId as RunId,
  } as AgentEventDomain
}
```

**使用示例（在 App.vue 里）**：

```typescript
import { toServer } from '@/domain/contracts/adapters/dto-to-domain'

const rawData: unknown = await fetch('/api/servers/srv-001').then(r => r.json())

const server = toServer(rawData)

if (server === null) {
  // 校验失败，rawData 不符合 ServerSchema
  console.error('Invalid server data')
  return
}

// 校验通过，server 是合法的 Server 对象
console.log(server.name)
```

### 4.3 v2 用到的知识点

**知识点 2：zod 运行时 Schema——在代码里描述数据"长什么样"**

```typescript
const ServerSchema = z.object({
  id: z.string().regex(/^srv-[a-z0-9]+$/),
  status: z.enum(['online', 'offline', 'maintenance']),
})
```

这段代码做了两件事：

1. 定义了一个**运行时可执行的校验器**；
2. TS 能从它 `infer` 出类型 `{ id: string; status: 'online' | 'offline' | 'maintenance' }`。

`safeParse` 返回 `{ success: true, data: T } | { success: false, error: ZodError }`，不会抛异常。生产代码应该用 `safeParse` 而不是 `parse`（后者失败会抛异常，容易导致未捕获错误）。

**知识点 3：DTO / Domain 分层——网络层和业务层的类型不一定相同**

- **DTO**（Data Transfer Object）：网络传输的格式，直接从 schema `infer` 出来，字段是 `string` / `number` / `boolean` 这类基础类型。
- **Domain**：业务层对象，可能带有 branded type（`ServerId`）、不变量（"Metric 的 timestamp 必须在过去 24 小时内"）、业务方法（"Anomaly 是否需要立即处理"）。

Adapter 的职责就是把 DTO 转成 Domain，可能包括：

- 把 `string` 转成 `ServerId` branded type；
- 检查业务不变量；
- 计算衍生字段（比如 `isRecent` 字段根据 `timestamp` 计算）。

### 4.4 v2 暴露的痛点（触发 v3 重构的实验）

**实验：后端升级事件格式，前端 schema 未同步**

假设后端把 `AgentEvent` 从 v1 升级到 v2，给 `tool.succeeded` 的 payload 加了新字段 `cost`（调用工具的花费）：

```typescript
// 后端返回的 v2 事件
const v2Event: unknown = {
  runId: 'run-001',
  sequence: 3,
  occurredAt: '2026-07-15T10:00:04Z',
  type: 'tool.succeeded',
  payload: {
    callId: 'c1',
    resultSummary: 'CPU 平均 87%',
    durationMs: 1800,
    cost: 0.05,  // v2 新增字段
  },
}

// 前端 schema 还是 v1（没有 cost 字段）
const result = AgentEventSchema.safeParse(v2Event)

console.log(result.success)  // false
console.log(result.error)    // ZodError: Unrecognized key 'cost' in object
```

zod 默认是 `.strict()` 模式，多余字段会导致校验失败。即使改成 `.passthrough()`（允许多余字段），前端也无法区分"这是 v1 还是 v2"，无法做兼容处理。

**v2 的根本问题**：合同没有版本字段，前端无法根据版本号做适配。后端一升级，前端要么白屏（strict 模式拒绝），要么静默丢数据（passthrough 模式忽略新字段）。

---

## 5. v3：加版本合同（schemaVersion 字段 + 兼容适配器）

### 5.1 v3 要实现什么

在 v2 基础上加两件事：

1. 给每个事件加 `schemaVersion` 字段（放在事件外层，不是 payload 内）；
2. 写版本兼容适配器（`v1-to-v2.ts`），让前端能同时处理 v1 和 v2 格式的事件。

**技术上要处理**：

- 修改 `AgentEventSchema`，加 `schemaVersion: z.literal('v2')`；
- 写 v1 schema（不带 cost 字段）；
- 写 `adaptV1ToV2` 函数，把 v1 事件转成 v2 格式；
- 在 `dto-to-domain.ts` 里先判断版本，走对应适配器。

**v3 是生产可用的终态**。后端从 v1 升级到 v2 时，前端能根据 `schemaVersion` 字段识别并适配，不会白屏。

### 5.2 v3 目录结构

与 §1.4 完全一致，v3 就是完整树。

### 5.3 v3 完整代码

完整代码与 12 个合同测试分散在本文件第 3-5 节和第 7 节；执行时必须逐文件实现并运行命令，不能以摘要代替代码。

**边写边问自己**：

- 为什么 `schemaVersion` 放在事件外层而不是 payload 内？
- v1-to-v2 适配器什么时候可以删？
- DTO 和 Domain 分两层的必要性是什么？

### 5.4 v3 用到的知识点

**知识点 4：schemaVersion 放在事件外层而不是 payload 内**

版本是整个事件的属性，不是 payload 的属性。放外层可以在不解析 payload 的情况下判断版本，避免鸡生蛋问题。

**知识点 5：兼容适配器的隔离原则**

`v1-to-v2.ts` 是临时代码，有明确的生命周期：写入 → 弃用窗口 → 删除。隔离在单独文件，删除时不污染核心逻辑。

**知识点 6：DTO / Domain 分层的必要性**

DTO 关注"数据结构合法"，Domain 关注"业务不变量"。Adapter 在两者之间做业务规则检查。

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 只定义类型 | 加运行时校验 | 加版本合同 + 兼容适配器 |
| **数据模型** | interface / type | zod schema | zod schema + schemaVersion |
| **状态存储** | 无（纯类型） | DTO（infer 出来的） | DTO + Domain 分层 |
| **归约逻辑** | 强断言 as | safeParse | safeParse + 版本判断 + 适配器 |
| **可测试** | 无（纯类型不可测） | 可测 schema.safeParse | 可测 schema + 适配器 + 业务不变量 |
| **架构层次** | 单文件 types.ts | schemas + dtos + adapters | schemas + dtos + domain + adapters + 版本兼容层 |
| **换数据源代价** | 高（每处都要改 as） | 中（改 adapter 入口） | 低（只改版本判断逻辑） |
| **编译期抓遗漏** | 无 | 无 | 有（schemaVersion 字面量类型 exhaustive check） |
| **对齐后续 Day** | Day 3 建表时重构 | Day 5 挂 WebSocket 时重构 | Day 15 历史恢复直接复用 |

## 6.5 前端底子补弱（独立深挖 HTML 入口）

完整深挖文档：[Day02深挖-领域合同底子补弱.html](../Day02深挖-领域合同底子补弱.html)

**今天深挖的 8 个知识点**（每个都有 8 子节：场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法）：

1. **深挖 1**：zod discriminated union —— 从 `AgentEventSchema` 的 9 种事件变体讲起
2. **深挖 2**：safeParse vs parse —— 从 `dto-to-domain.ts` 的错误处理讲起
3. **深挖 3**：Branded Type —— 从 `ServerId` 和 `MetricId` 不能混用讲起
4. **深挖 4**：DTO / Domain 分层 —— 从"网络层类型 ≠ 业务层类型"讲起
5. **深挖 5**：版本合同 —— 从 `schemaVersion` 字段位置权衡讲起
6. **深挖 6**：弃用窗口 —— 从 `v1-to-v2.ts` 的生命周期讲起
7. **深挖 7**：TypeScript 的类型守卫 —— 从 `typeof input === 'object'` 讲起
8. **深挖 8**：exhaustive check —— 从 `switch(version)` 的 `default: never` 讲起

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑测试（20 分钟）

在 `src/domain/contracts/contracts.spec.ts` 里补齐至少 12 个测试：

- `toServer` 3 个测试（合法 / id 格式错误 / 缺字段）
- `toMetric` 3 个测试（合法 / timestamp 格式错误 / 负数 value）
- `toAnomaly` 3 个测试（合法 / severity 枚举错误 / 缺字段）
- `toAgentEvent` 3 个测试（v2 合法 / v1 经适配器 / 缺 schemaVersion）

```powershell
pnpm test
```

看到 12 个测试全部通过。

### 7.7 F-1：反证实验 1（5 分钟）

**验证 v1 的痛点**：强断言挡不住脏数据。

在 `src/App.vue` 或新建 `src/experiments/v1-pain.ts`：

```typescript
const fakeServer: unknown = { id: 123, name: 'srv-001' }
const server = fakeServer as Server
console.log(server.id.split('-'))  // 运行时崩溃
```

跑 `pnpm dev`，打开控制台，看到报错 `123.split is not a function`。

**恢复代码**：删除实验代码，确认 `pnpm dev` 能正常运行。

### 7.8 F-2：反证实验 2（5 分钟）

**验证 v2 的痛点**：没有版本字段时无法兼容旧格式。

在 `contracts.spec.ts` 加一个测试：

```typescript
it('v2 schema 拒绝 v1 格式的 tool.succeeded', () => {
  const v1Event = {
    schemaVersion: 'v1',
    runId: 'run-001',
    sequence: 3,
    occurredAt: '2026-07-15T10:00:04Z',
    type: 'tool.succeeded',
    payload: { callId: 'c1', resultSummary: 'ok', durationMs: 1800 },
  }
  const result = AgentEventSchemaV2.safeParse(v1Event)
  expect(result.success).toBe(false)  // v2 schema 拒绝 v1
})
```

跑 `pnpm test`，看到测试通过（证明 v2 schema 确实会拒绝 v1 格式）。

**恢复代码**：删除实验测试，确认 `pnpm test` 其他测试全部通过。

### 7.9 F-3：验证 + 提交（10 分钟）

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

四件套全部通过后提交：

```powershell
git add src/domain/contracts/
git commit -m "feat(contracts): add runtime schema validation with version support

- Add zod schemas for Server/Metric/Anomaly/AgentEvent
- Implement DTO/Domain layer separation
- Add v1-to-v2 adapter for backward compatibility
- Add 12 contract tests

Refs: Day02"
```

**⚠️ 不要 `git push`**（Day 30 前所有 commit 留在本地）。

---

## 8. 通过标准

- [ ] `contracts.spec.ts` 至少 12 个测试全部通过
- [ ] `pnpm typecheck` 无错误
- [ ] `pnpm build` 成功
- [ ] 两个反证实验都跑过且能复现 v1/v2 的痛点
- [ ] `git log` 能看到 Day02 的 commit（含 `Refs: Day02`）

---

## 9. 提交物

- `src/domain/contracts/` 完整目录（schemas / dtos / domain / adapters + contracts.spec.ts）
- `contracts.spec.ts` 至少 12 个测试
- 两个反证实验的截图或日志（证明你跑过）
- 课末三问的答案（见 §10）

---

## 10. 课末 3 个核心问题

1. **为什么必须分 DTO 和 Domain 两层？** 直接把 `z.infer` 出来的类型当业务对象用不行吗？
   
   你的答案：

2. **`schemaVersion` 放在事件的哪一层？** payload 内还是外？为什么？
   
   你的答案：

3. **兼容适配器什么时候删？** 如何判断"弃用窗口"结束？
   
   你的答案：

---

## 11. 真实项目情境题（联网更新 2026-07-15）

1. 你在做一个 Agent 监控前端，后端突然说"我们给 `tool.succeeded` 加了 `tokens` 字段（消耗的 token 数），你前端要不要改？" 你怎么回答？你会检查哪几个文件？
   
   来源：[真实 Agent 项目踩坑记录](https://example.com/agent-contract-breaks)（模拟链接）

2. 你的同事说"zod schema 太啰嗦了，我直接用 TypeScript interface 不行吗？" 你会怎么解释"运行时校验"的必要性？
   
   来源：[Code Review 常见争议点](https://example.com/zod-vs-interface)（模拟链接）

---

## 12. PDF 面试题

> ⚠️ **边界说明**：以下题目来自用户提供的 PDF 文件，文件名不等于官方题库。题目用于教学演示，不代表任何公司的真实面试题库。

1. TypeScript 的 `interface` 和 `type` 有什么区别？定义 AI 插件协议时选哪个？
   来源：[《2026已发交个朋友全栈AI工程师》](../../资源/2026已发交个朋友全栈AI工程师.pdf)，第 2 页。
2. 什么是 TypeScript 类型守卫？处理大模型返回 JSON 时怎样使用？
   来源：[《2026已发交个朋友全栈AI工程师》](../../资源/2026已发交个朋友全栈AI工程师.pdf)，第 2 页。

题目说明：对应判别联合、运行时 `unknown` 校验及 DTO/Domain 合同边界；第二题是原文追问。

---

## 13. 完成后教师五连问

Day02 完成后，用户会执行 `/ai-teacher-qa Day02`，AI 教师会按《AI教师五连问验收协议.md》逐题提问。预习这 5 个问题：

1. **演示验收**：请演示你的 `contracts.spec.ts` 测试全部通过的截图。
2. **核心挑战**：Day02 最难的部分是什么？你卡在哪里最久？
3. **对比思考**：v1/v2/v3 三版你觉得哪一版最关键？为什么？
4. **项目对手戏**：假设 Day 5 挂 WebSocket 时后端推来一个 v3 事件（`schemaVersion: 'v3'`），你的代码会怎么处理？会崩溃吗？
5. **知识盲区**：zod 的 `.passthrough()` 和 `.strip()` 和 `.strict()` 有什么区别？哪个适合生产环境？

---

## 14. 本 Day 在 90 天路线中的锚点

- **前置**：Day 01（定义了 `AgentEvent` 判别联合，今天升级为有 schema 的合同）
- **后续**：
  - Day 03：建 `Server / Metric / Anomaly` 三张表，复用今天的 schema
  - Day 05：挂 WebSocket，每条消息都过 `toAgentEvent` 校验
  - Day 15：SSE 断线重连时，历史事件流经 `toAgentEvent` 批量校验

**今天的合同层是整个 p1-monitor 前端的数据入口守门员**——Day 3-30 的所有网络数据都要先过这一层。
