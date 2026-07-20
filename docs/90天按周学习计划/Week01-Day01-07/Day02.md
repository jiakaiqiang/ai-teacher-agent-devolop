# Day 02：领域合同（Schema × DTO × Domain × ViewModel 三版演进）

任务版本：标准版
日期与时长：2026-07-15 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\frontend`
角色视角：有 Vue 中后台经验、第一次为 Agent 场景把「前后端合同」做严的开发者
配套文档：[Day01.md](./Day01.md) · [Day02深挖-领域合同与非法输入.html](../Day02深挖-领域合同与非法输入.html)（**待生成，选题需先与用户确认**）
本文件规范来源：[教学文档规范-Day风格与深挖HTML规范.md](../教学文档规范-Day风格与深挖HTML规范.md)

> ⚠️ **本文件目前是「结构骨架 + TODO 占位」，正文尚未展开。** 展开顺序遵循规范 §9 阶段 2：一次一天、用户先给核心概念与三版拆法、AI 出骨架 / 30% 样板 / 学习指导，70% 核心由用户手写。

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
- **视图层 ViewModel**（Domain 经组件级映射变成 UI 需要的形状）。

### 1.1 用户能看到什么

从用户视角看，页面**没有**任何视觉变化——今天做的是**内部合同层**。但用户会感受到两个差异：

- 之前后端偶尔漏字段或字段类型错误时，图表变成 `NaN`；今天开始，**这类数据在进入视图层之前就被拒绝**并打日志，图表不再乱。
- 后端切换 `AgentEvent v1 → v2` 版本时，前端不再白屏，而是根据 `schemaVersion` 走**兼容适配层**。

> TODO（展开时补图）：一张「非法输入被拒绝并打日志」的截图 + 一张「v1 客户端连接 v2 服务时被兼容适配」的时序图。

### 1.2 这个模块在项目里承担什么

- **输入**：来自 WebSocket / 未来 REST API 的 `unknown` 数据；
- **输出**：一个**合同边界**，让下游（Vue 组件、reducer、图表库）永远只看到合法数据；
- **对齐后续**：Day 3 建表结构、Day 5 挂 WebSocket、Day 15 恢复历史事件流时，都直接复用今天定义的 schema。

### 1.3 三版演进的目标

Day 02 主题是「领域合同」，天然不适合 Day 01 那种"功能递增"的三版演进（规范 §3.2 允许的替代结构）。本日采用**保护递进**三版：

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 只定义 Domain 类型，不做运行时校验 | 一个 `types.ts` 存所有 interface | TypeScript 静态类型的**边界**：只挡编译期错误，挡不住线上非法输入 |
| **v2** | v1 + 用 `zod` schema 做运行时校验，DTO/Domain 分层 | `schemas.ts` + `dtos.ts` + `domain.ts` 三文件 | 运行时 Schema、`unknown → DTO → Domain`、`safeParse` 错误路径 |
| **v3** | v2 + 版本合同（`schemaVersion` 字段 + 兼容适配器） | 加入 `adapters/v1-to-v2.ts` | 合同版本、弃用窗口、兼容层的隔离原则、非法样本注入测试 |

**用户最终在项目里交付的是 v3**。v1、v2 是过渡：v1 让你亲眼看到"只写 TS 类型挡不住脏数据"；v2 让你亲眼看到"没有版本字段时上游一改动就白屏"；v3 才是生产可用的合同层。

> TODO（展开正文时补）：v1 → v2 → v3 每一版的**具体痛点触发实验**（例如 v1 里用 `as unknown as Server` 强断言，跑到 UI 就崩；v2 里后端加一个新枚举值，前端 `safeParse` 直接拒掉合法请求）。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Day 02 的合同层要动 4 个领域对象、3 个层次，如果不先立骨架，你会在 `types.ts` / `schemas.ts` / `dtos.ts` / `domain.ts` 里来回找文件。看完这棵树，下面章节里再出现 `src/domain/contracts/schemas/agent-event.schema.ts` 时，你就能立刻定位它在项目里的位置。

**今天在 `p1-monitor/frontend/` 下要建立/扩展的完整前端源码树（v3 完整版）**：

```
src/
├── domain/                                              ← 领域层（纯类型 + 纯逻辑，不依赖 Vue）
│   ├── agent/                                           ← Day 01 已建
│   │   ├── agent-event.ts                               ← Day 01：事件类型（判别联合）
│   │   ├── agent-run-state.ts                           ← Day 01：状态类型 + reducer
│   │   └── agent-run-state.spec.ts                      ← Day 01：reducer 测试
│   └── contracts/                                       ← ★ Day 02 新增：领域合同层
│       ├── schemas/                                     ← 运行时 Schema（zod）
│       │   ├── agent-event.schema.ts                    ← ★ AgentEvent 9 变体 + schemaVersion
│       │   ├── server.schema.ts                         ← ★ Server 领域对象 Schema
│       │   ├── metric.schema.ts                         ← ★ Metric 时序数据 Schema
│       │   └── anomaly.schema.ts                        ← ★ Anomaly 异常事件 Schema
│       ├── dtos/                                        ← 网络层 DTO（Schema infer 出来的类型）
│       │   ├── agent-event.dto.ts                       ← ★ type AgentEventDto = z.infer<typeof schema>
│       │   ├── server.dto.ts                            ← ★
│       │   ├── metric.dto.ts                            ← ★
│       │   └── anomaly.dto.ts                           ← ★
│       ├── domain/                                      ← 业务领域对象（含 branded type / 不变量）
│       │   ├── server.ts                                ← ★ type ServerId = string & { __brand }
│       │   ├── metric.ts                                ← ★ 带单位 / 时间范围不变量
│       │   └── anomaly.ts                               ← ★ 严重度枚举 + 处置状态机
│       ├── adapters/                                    ← DTO ↔ Domain 适配 + 版本兼容
│       │   ├── dto-to-domain.ts                         ← ★ unknown → safeParse → DTO → Domain
│       │   └── v1-to-v2.ts                              ← ★ AgentEvent v1 兼容适配器
│       └── contracts.spec.ts                            ← ★ 至少 12 个合同测试
├── features/                                            ← Day 01 已建；今天不动
│   └── agent-run/…                                      ← 保持原样，只把类型 import 换成 dtos/*
├── composables/
│   └── useAgentRun.ts                                   ← Day 02 起：从 dto-to-domain 拿数据，不再直接接 fixture
└── App.vue                                              ← 编排层：Day 02 起校验入口只在这里
```

> TODO（展开正文时补）：在每个 `★` 标记的新文件后展开 3-5 行说明它的职责与 Day 01 相关文件的关系。

**三版演进对应的文件差异**：

| 版本 | 建/改的文件 | 不建的文件 |
|---|---|---|
| **v1** | 只有 `domain/contracts/domain/*.ts`（4 个纯类型文件） | 其余全不建；直接 `as` 强断言 |
| **v2** | v1 + `schemas/*.ts` + `dtos/*.ts` + `adapters/dto-to-domain.ts` + `contracts.spec.ts` | 还没有版本合同 |
| **v3** | 完整树（含 `adapters/v1-to-v2.ts`） | —— |

**依赖方向（务必单向）**：

```
App.vue → composables → features → domain/contracts/adapters → domain/contracts/domain
                                                              ↘ domain/contracts/dtos ← schemas
```

**红线**：`domain/contracts/domain/*.ts` 里出现 `import { z } from 'zod'` 就是塌方。**Domain 层不认识运行时校验库**——校验是 adapter 的活儿。

**动手前先问自己 3 个问题**（答不上就带着问题往下读 v1 → v2 → v3）：

1. 为什么必须分 DTO 和 Domain 两层？直接把 `z.infer` 出来的类型当业务对象用不行吗？—— 见 v3 的第 5.4 节「DTO / Domain 分层的必要性」。
2. `schemaVersion` 放在事件的哪一层？payload 内还是外？—— 见 v3 的第 5.4 节「版本字段位置的权衡」。
3. 兼容适配器什么时候删？—— 见 v3 的第 5.4 节「弃用窗口」。

> TODO：展开正文时把 5.4 节里三个问题的完整答案补上。

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

**为什么放在正文前面**：Day 02 要新增 12 个以上文件，如果不先建目录、装依赖，你读到 v3 完整代码那节会不知道往哪儿放。先用 20 分钟把 `zod` 装上、目录建齐、跑一次 `pnpm typecheck` 确认没打错字，再回过头读代码解释才有感觉。

**动手节奏建议**：本节 1.5.1-1.5.5 快速过一遍（20 分钟） → 读第 2-6 节正文 + 深挖 HTML（约 120 分钟） → 到第 7 节做测试 + 反证 + 验收（60 分钟）。

### 1.5.1 D-1：装依赖（3 分钟）

```powershell
Set-Location D:\demo\ai-techer\p1-monitor\frontend
pnpm add zod
pnpm typecheck  # 确认 Day 01 代码没被破坏
```

> ✅ 这是样板代码，可以直接使用。建议：快速浏览确认格式即可。

### 1.5.2 D-2：创建目录（3 分钟）

按 §1.4 目录树建目录（此时先建空目录，文件在 1.5.3-1.5.5 里逐个填上）：

```powershell
New-Item -ItemType Directory -Force -Path `
  src\domain\contracts\schemas, `
  src\domain\contracts\dtos, `
  src\domain\contracts\domain, `
  src\domain\contracts\adapters
```

> ✅ 这是样板代码，可以直接使用。

### 1.5.3 D-3：写 Schema 层（约 7 分钟，只写文件外壳）

> ❌ **AI 不生成 Schema 完整字段**——这是核心业务逻辑（属规范 §0 硬红线的「Prompt / 业务算法 / 领域建模」）。你必须**手写** Schema 字段。

学习指导（按此顺序自己动手）：

1. 阅读 [zod 官方文档 · Basic Usage](https://zod.dev/?id=basic-usage) 和 [Discriminated Unions](https://zod.dev/?id=discriminated-unions)（15 分钟一次读透）。
2. 核心概念自测：
   - `z.object()` 和 `z.discriminatedUnion()` 分别在什么场景用？
   - `safeParse` 相比 `parse` 的区别？为什么生产代码不该用 `parse`？
   - `z.infer<typeof schema>` 生成的类型和你手写的 `interface` 有什么细微差别？
3. **手写**四个 schema 文件的**字段结构**（可以先从 Day 01 的 `agent-event.ts` 判别联合"抄结构"，把 `type` 字段作为 discriminator）。
4. 每个 schema 至少覆盖：必填 / 可选 / 枚举 / 日期 / 嵌套对象。

### 1.5.4 D-4：写 DTO 层（约 3 分钟，只写 infer）

> ✅ 这是样板代码——DTO 只是 `type XxxDto = z.infer<typeof XxxSchema>`，每个文件 2 行。可以直接生成。

### 1.5.5 D-5：写 Domain 层与 Adapter 空壳（约 4 分钟）

> ❌ **AI 不生成 Adapter 里的映射逻辑**——这属于业务规则，必须你自己写。

只搭空壳：

```typescript
// src/domain/contracts/adapters/dto-to-domain.ts
// TODO: 展开正文时补 unknown -> safeParse -> DTO -> Domain 映射
export function toServer(input: unknown) {
  throw new Error('TODO: 手写实现')
}
```

> ✅ 空壳（throw TODO）是样板；里面的实现是你的活。

跑一次 `pnpm dev`，确认 Day 01 的 `AgentRunPanel` 还能正常显示（你今天新增的合同层还没接入，UI 不该有任何变化）。**卡住不要死磕**：先跳过继续读正文，测试和反证实验放到第 7 节做。

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

> TODO（阶段 2 展开）：本节由用户先给出「v1 的核心概念聚焦点」——建议聚焦"静态类型的边界感"：为什么 TypeScript 编译通过 ≠ 生产没脏数据。AI 只写章节骨架与 30% 样板（`interface Server { ... }` 类型声明），关键的**反例代码（用 `as unknown as` 强断言绕过类型）与线上崩溃复现步骤**必须由你手写。

### 3.1 v1 要实现什么

TODO

### 3.2 v1 完整代码

TODO（AI 只出 `interface` 骨架，业务字段由用户手写）

### 3.3 v1 用到的知识点

TODO：至少 2 个知识点，每个含"解决的问题 / 运行机制 / 项目落点 / 生产误区 / 验证方法"。

### 3.4 v1 暴露的痛点（引出 v2）

TODO：至少 2 条痛点，每条要给"最小复现代码 + 线上会怎样"。

---

## 4. v2：加 zod 运行时校验 + DTO/Domain 分层

> TODO（阶段 2 展开）：v2 的关键设计是把「网络层类型」和「业务层类型」分开。AI 只出 30% 样板（`z.infer` 声明、`safeParse` 调用模板），关键的**Schema 字段定义与 DTO → Domain 映射函数**必须由你手写。

### 4.1 v2 要实现什么

TODO

### 4.2 v2 完整代码

TODO

### 4.3 v2 用到的知识点

TODO：至少 3 个知识点。

### 4.4 v2 暴露的痛点（引出 v3）

TODO：至少 2 条痛点——重点在"上游改字段命名 / 加枚举值时前端合法请求被拒"。

---

## 5. v3：加版本合同 + 兼容适配器

> TODO（阶段 2 展开）：v3 的关键设计是「合同版本化」——`schemaVersion` 字段 + 版本兼容 adapter + 弃用窗口。AI 只出 30% 样板（版本字段声明、adapter 函数签名），关键的**兼容映射逻辑与弃用策略**必须由你手写。

### 5.1 v3 要实现什么

TODO

### 5.2 v3 目录结构

见 §1.4（保持完全一致）。

### 5.3 v3 完整代码

TODO：逐文件展示。至少覆盖 `agent-event.schema.ts` / `server.schema.ts` / `dto-to-domain.ts` / `v1-to-v2.ts` 四份，无省略。

### 5.4 v3 用到的知识点

TODO：至少 6 个知识点，每个含 5 要素（解决的问题 / 运行机制 / 项目落点 / 生产误区 / 验证方法）。建议锚点：

1. `z.discriminatedUnion` vs 手写 `z.union`：为什么前者能保住判别联合的窄化。
2. `safeParse` 的错误路径：`error.issues[]` 里 `path` 与前端字段定位。
3. DTO / Domain 分层的必要性：什么时候可以合并、什么时候必须拆。
4. Branded type：`type ServerId = string & { __brand: 'ServerId' }` 如何挡住"把 userId 传成 serverId"的手滑。
5. 版本字段位置的权衡：放在 payload 内、payload 外、HTTP header 三种方案的取舍。
6. 弃用窗口：兼容 adapter 什么时候删？依据是什么？

---

## 6. 三版对比一览表

> TODO（阶段 2 展开）：按规范 §7 的 9 列字段填写。

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 只定义类型 | 加运行时校验 | 加版本兼容 |
| **数据模型** | interface（编译期） | z.object + z.infer | Schema + schemaVersion + adapter |
| **状态存储** | TODO | TODO | TODO |
| **归约逻辑** | TODO | TODO | TODO |
| **可测试** | 只能靠 tsc | schema 单测 | schema + adapter 双测 |
| **架构层次** | 单层 | DTO / Domain 两层 | DTO / Domain / Adapter 三层 |
| **换事件源代价** | 全 UI 重写 | 只换 adapter | 只加新版本适配器 |
| **编译期抓遗漏** | 部分 | 部分 | 完整（discriminatedUnion + exhaustive） |
| **对齐后续 Day** | ✗ | 部分 | ✓（Day 3-15 直接复用） |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

> ⚠️ **深挖 HTML 未生成**。按规范 §6.5，深挖 HTML **必须先与用户确认选题**：本日暴露的哪几个弱点值得挖？锚点在 v3 里的哪段代码？

候选深挖主题（**用户确认前不生成 HTML**）：

1. TypeScript 静态类型的边界 —— 挖"编译通过不代表运行时安全"。
2. 判别联合 vs `z.discriminatedUnion` —— 挖"编译期和运行时都要保住 discriminator"。
3. Branded Type —— 挖"nominal typing 在 structural typing 系统里的实现"。
4. 合同版本化 —— 挖"schemaVersion 是治理问题不是技术问题"。
5. 非法输入注入测试 —— 挖"如何用 fuzz + 边界样本证明合同的强度"。
6. `unknown → DTO → Domain` 三层管道 —— 挖"为什么大厂都这么写"。

**→ 生成后打开 [Day02深挖-领域合同与非法输入.html](../Day02深挖-领域合同与非法输入.html)**（待生成）

自检依据：[12 号学生严格训练报告](../12号学生严格训练报告.md) · [当前能力画像](../当前用户能力画像与评级.md) · [简历用词红线自检清单](../简历用词红线自检清单.md)

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

阶段 D（搭骨架 / §1.5.1-1.5.5）已在前面完成。这一节是**收尾验收**——测试、反证、lint/typecheck/build、提交。

### 7.6 E：写合同测试（20 分钟）

> ❌ **AI 不生成测试用例的完整实现**——测试是学习验收的关键，必须你自己写。

学习指导：

1. 至少 12 个测试用例，覆盖：
   - 合法 payload 通过校验（happy path × 4）
   - 缺字段被拒（missing field × 2）
   - 错枚举被拒（enum out of range × 2）
   - 非法时间格式被拒（invalid ISO date × 1）
   - 超大 payload 被拒（size limit × 1）
   - v1 payload 经 adapter 变成合法 v2 Domain（compat × 1）
   - v3 payload 通过 discriminatedUnion 精准报错到具体变体（× 1）
2. 测试文件 `src/domain/contracts/contracts.spec.ts`，跑 `pnpm test`。
3. 断言用 `expect(result.success).toBe(false)`，读 `result.error.issues[0].path`。

> ✅ 样板（AI 可以生成）：`describe / it / expect` 三件套的**外壳**、`vitest` 的 import。**断言体和 payload 内容必须你自己写。**

### 7.7 F-1：反证实验 1——去掉 schema 校验会怎样（5 分钟）

临时把 `dto-to-domain.ts` 里的 `safeParse` 换成 `as unknown as Server` 强断言：

```typescript
// export function toServer(input: unknown): Server {
//   const parsed = ServerSchema.safeParse(input)
//   if (!parsed.success) throw new ContractError(parsed.error)
//   return { ...parsed.data, id: parsed.data.id as ServerId }
// }
export function toServer(input: unknown): Server {
  return input as unknown as Server  // ❌ 反证：直接强断言
}
```

给测试灌一个缺字段的 payload，观察：
- 测试是否还能捕获？
- UI 里图表会变成 `NaN` 还是崩溃？

把失败输出（或错误 UI 截图）保存到 `docs/evidence/day-02/skip-schema.md`，然后**恢复代码**。

### 7.8 F-2：反证实验 2——去掉 schemaVersion 会怎样（5 分钟）

临时把 `agent-event.schema.ts` 里的 `schemaVersion` 字段删掉，然后灌一个 v1 payload：

- v1-to-v2 adapter 会怎样识别版本？
- 有没有可能把 v1 payload 误当作 v2 通过？

保存证据到 `docs/evidence/day-02/no-version.md`，然后**恢复代码**。

### 7.9 F-3：验证 + 提交（10 分钟）

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

四件套全绿后提交（**不 push**）：

```powershell
git add src/domain/contracts docs/evidence/day-02
git commit -m "feat(day02): 引入领域合同层（Schema × DTO × Domain × Adapter）

- 新增 4 个领域对象的 zod schema
- 引入 DTO / Domain 分层与 branded type
- 加入 schemaVersion 与 v1→v2 兼容适配器
- 12 个合同测试全部通过
- 反证实验证明校验层与版本层的必要性

Refs: Day02"
```

> ⚠️ 不要 `git push`——由你自己决定何时推。

---

## 8. 通过标准

- [ ] `any` 计数为 0（`pnpm typecheck` 输出）
- [ ] 至少 12 个合同测试全部通过
- [ ] 非法样本（缺字段 / 错枚举 / 非法时间 / 超大 payload）全部被拒
- [ ] v1 payload 通过兼容 adapter 变成合法 v2 Domain
- [ ] 两个反证实验的失败证据保存在 `docs/evidence/day-02/`
- [ ] Domain 层不 import zod（架构红线）
- [ ] commit 已提交（未 push）

---

## 9. 提交物

- `src/domain/contracts/**` 全部新增文件
- `src/domain/contracts/contracts.spec.ts` 测试文件
- `docs/evidence/day-02/skip-schema.md`（反证 1 证据）
- `docs/evidence/day-02/no-version.md`（反证 2 证据）
- 学习日志 `docs/journal/day-02.md`（TODO 模板由用户手写）
- AI Review 记录（对 AI 生成过的 30% 样板逐条记录：接受 / 修改 / 拒绝的理由）
- **本文件的三道课末核心问题答案**（先自答再提交）

---

## 10. 课末 3 个核心问题（提交前先自己写下答案）

> 从原 Day02.md 保留，作为不看资料的自测题。

1. 请从今天项目的真实入口到最终输出，解释「领域合同」的数据流或控制流；当天知识链「静态类型、运行时 Schema、DTO/Domain/ViewModel、合同版本」分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. Prisma 中 `timestamp` 是日期，API 却返回非法字符串；TypeScript 编译通过，但 1% 的 Metric 进入图表后变成 `NaN`。请抓取原始响应、Schema 错误路径和适配前后对象定位边界；先隔离坏数据并告警，再实现 `unknown -> DTO -> Domain -> ViewModel` 校验，使用缺字段、错枚举和非法时间样本验证全部拒绝。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S3 阿里 AI 前端](https://campus-talent.alibaba.com/campus/position/199904460001)
2. 某客户端仍发送 `AgentEvent v1`，新服务已切到 `v2`，在 300 RPS 下出现字段漂移和旧客户端白屏。请依据版本分布、合同测试和失败 payload 定位；先保留兼容适配器止损，再制定向后兼容、弃用窗口和超大 payload 上限，并用新旧消费者回归与灰度错误率验证。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：静态类型、运行时 Schema、DTO/Domain/ViewModel、合同版本。

---

## 12. PDF 面试题

1. TypeScript 的 `interface` 和 `type` 有什么区别？定义 AI 插件协议时选哪个？
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 2 页。
2. 什么是 TypeScript 类型守卫？处理大模型返回 JSON 时怎样使用？
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 2 页。

题目说明：对应判别联合、运行时 `unknown` 校验及 DTO/Domain 合同边界；第二题是原文追问。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按「局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进」现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **上游依赖**：Day 01 定义的 `AgentEvent` 判别联合（今天升级为带 `schemaVersion` 的 Schema）。
- **下游被谁依赖**：
  - Day 03（`Server / Metric / Anomaly` 建表）直接复用今天的 Schema；
  - Day 05（WebSocket 挂接）在事件入口做 `dto-to-domain` 校验；
  - Day 14（SSE 升级）在断线重连时用 `v1-to-v2` adapter 处理历史事件；
  - Day 15（历史恢复）依赖今天的合同版本机制。
- **红线**：今天定义的所有 Schema 是**前后端合同的一部分**。改任何字段都要走"加 `schemaVersion` bump + 保留 adapter 一个弃用窗口"流程，不能直接改。
