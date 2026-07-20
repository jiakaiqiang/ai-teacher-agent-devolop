# Day 25：后端测试（v1 高覆盖单测 → v2 分层 + Repository fake → v3 隔离集成 + E2E 门禁 + mutation 验证）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-07 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\apps\api`
角色视角：完成 Day 21-24 后端架构深化（模块边界 / API 合同 / 数据建模 / 鉴权授权）、第一次要给核心后端模块建立"能真正抓住 bug"的分层测试体系的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-20：前端 Agent UI + 后端 Nest + Agent Loop + 持久化 + 毕业考

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端深化 + 全栈（NestJS + LLM 集成 + RAG）
   Day 21：NestJS 架构深化（模块边界 + DI scope）
   Day 22：API 合同（DTO + OpenAPI + 版本兼容）
   Day 23：数据建模（聚合 + 索引 + 迁移）
   Day 24：鉴权/权限（JWT + RBAC/ABAC + 资源授权）
   Day 25：后端测试（测试金字塔 + fake + 集成 + mutation）  ← 今天在这里
   Day 26-30：缓存 / 限流 / 部署 / M3 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 25 在阶段一第 5 天**。Day 21-24 已经把后端重构成清晰的模块边界、统一合同、聚合建模、资源级授权。今天要给这些模块建立**分层测试**，并且证明一个反直觉的事实：**覆盖率高不等于测试有效**——删掉一个关键授权断言后测试仍然全绿，才是最危险的假安全。

### 到 Day 24 结束时项目已具备的能力

- **后端架构**（Day 21）：Ports/Adapters 解耦、DI scope、共享域模块，`madge --circular` 零循环
- **API 合同**（Day 22）：统一 Error DTO + Envelope、OpenAPI、版本兼容、消费者合同测试
- **数据模型**（Day 23）：Conversation/Message/Citation/User 聚合、复合索引、游标分页、可回滚迁移
- **鉴权授权**（Day 24）：JWT 认证、RBAC 角色守卫、资源级 ABAC 策略引擎、CSRF、actor 审计
- **测试现状**：只有零散的单元测试（Day 01 的 reducer spec、Day 11 的 registry spec 等），没有系统的分层测试，没有集成 DB 测试，没有 E2E 门禁，更没有验证"测试到底能不能抓住 bug"

### 今天要解决的 4 个问题

1. **问题 1：高覆盖率是假安全**
   `AnomalyService` 单元测试覆盖率 92%，看起来很安全。但当有人误删了 `authorizeResourceAccess(actor, anomaly)` 这一行授权断言，所有单测依然全绿——因为测试用例里根本没断言"未授权 actor 会被拒绝"。覆盖率统计的是"代码行被执行了"，不是"行为被验证了"。这种假安全直到线上跨租户读取事故才暴露。

2. **问题 2：Service 层测试依赖真实 DB 又慢又脆**
   如果 `AnomalyService` 的单测直接 `new PrismaService()` 连真库，每个用例都要建表、插数据、清理。100 个用例跑 3 分钟，还会因为并发跑测试互相污染。需要 **Repository fake**：用内存实现替换 Prisma，让 Service 层单测既快又确定。

3. **问题 3：集成测试共享数据库互相污染**
   集成测试必须连真实 Postgres（验证 SQL、索引、事务真的能跑），但如果 8 个 CI job 共享同一个库、又不清理，测试顺序稍微变一下就随机失败 15%。需要 **隔离 schema / 事务回滚 / 确定性 fixture** 保证每个测试跑在干净环境里。

4. **问题 4：无法证明测试有效**
   怎么证明"我的测试真的能抓 bug"？答案是 **mutation testing**：故意往源码里注入一个变异（比如把 `>` 改成 `>=`、删掉一个 `if` 分支、把 `throw` 改成 `return`），如果测试还全绿，说明这个变异"存活"了——测试有盲区。今天要至少捕获一个 mutation，证明关键行为测试真的有牙齿。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一套**分层测试体系** `test/`：给 Day 23 的 `ConversationService`（聚合根）和 Day 24 的 `AnomalyService`（资源授权）建立单元测试（Repository fake）、集成测试（隔离 schema + 事务回滚）、E2E 测试（真实 HTTP + 授权门禁），并用一次 mutation testing 证明关键授权断言的测试真的能抓住变异。

### 1.1 用户能看到什么

**场景**：这里的"用户"是**跑 CI 的开发者**和**未来接手项目的工程师**。他们看到的是测试报告和一次 mutation 演练的结果。

```
$ pnpm --filter api test:unit
 ✓ conversation.aggregate.spec.ts (12)
 ✓ anomaly.service.spec.ts (18)     ← Repository fake，无 DB，跑 800ms
   ✓ 未授权 actor 读取他人 anomaly → 抛 ForbiddenError
   ✓ owner 读取自己的 anomaly → 成功
   ...
 Test Files  2 passed (2)
      Tests  30 passed (30)
   Duration  1.2s

$ pnpm --filter api test:integration
 ✓ conversation.repository.int-spec.ts (8)   ← 隔离 schema，真实 Postgres
   ✓ 游标分页在 5 万条 message 下 P95 < 50ms
   ✓ 外键级联删除不留孤儿 Citation
 每个用例前 BEGIN，用例后 ROLLBACK ← 零污染
 Test Files  1 passed (1)
   Duration  4.8s

$ pnpm --filter api test:e2e
 ✓ auth-matrix.e2e-spec.ts (16)     ← 真实 HTTP + JWT
   ✓ 跨用户 GET /anomalies/:id → 403（授权门禁）
   ✓ 伪造 JWT → 401
 Test Files  1 passed (1)

$ pnpm --filter api test:mutation -- --mutate src/anomaly/anomaly.service.ts
 Mutation testing report:
   变异 #7: 删除 `authorizeResourceAccess(actor, anomaly)` 调用
     状态: KILLED ✔ (被 anomaly.service.spec.ts:42 "未授权 actor 读取" 捕获)
   变异 #12: `>` → `>=` in Z-Score 阈值
     状态: KILLED ✔
   变异 #19: `throw` → `return null` in 授权失败分支
     状态: KILLED ✔
 Mutation score: 84% (关键授权变异 100% 捕获)
```

关键是最后一步：如果谁误删了授权断言，mutation testing 会告诉你"这个变异存活了"，逼你补测试。

### 1.2 这个模块在项目里承担什么

- **输入**：Day 21-24 已有的 Service / Repository / Controller / Guard
- **输出**：`test/` 下三层测试（unit / integration / e2e）+ 一份 mutation 报告 + CI 三档测试脚本
- **对齐后续**：今天建立的**分层测试规范**（fake 在哪层、集成测试怎么隔离、E2E 覆盖什么、mutation 验证什么）是 Day 30（M3 门禁）"关键模块覆盖 ≥ 75% 且 mutation 有效"这条硬门禁的达标依据，也是 Day 61-90 p2 多 Agent 工作台测试策略的模板

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 只给 Service 写覆盖率高的单测 | 单个 `*.spec.ts`，直连或简单 mock | Vitest 基础、覆盖率统计、`describe/it/expect` |
| **v1 痛点** | 覆盖率 92% 但删授权断言仍全绿；假安全 |  |  |
| **v2** | v1 + **Repository fake** + **关键行为测试** | 拆出 `test/fakes/` + 按行为组织测试 | 依赖倒置在测试中的应用、fake vs mock vs stub、行为覆盖 vs 行覆盖 |
| **v2 痛点** | fake 测不到真实 SQL / 索引 / 事务；集成测试共享 DB 污染 |  |  |
| **v3** | v2 + **隔离集成测试**（事务回滚）+ **E2E 授权矩阵** + **mutation 验证** | 完整分层（`test/unit` `test/integration` `test/e2e` + `stryker.conf`） | 测试隔离（schema/事务）、确定性 fixture、E2E 门禁、mutation testing、覆盖率盲区 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：测试体系涉及多个关注点（单元测试的 fake、集成测试的 DB 隔离、E2E 的 HTTP 装配、mutation 配置），如果不先立起骨架，就会把 fake 散在各个 spec 文件里重复定义、把集成测试和单元测试混在一个目录导致 CI 无法分档跑、把 E2E 的应用装配逻辑复制粘贴。看完这棵树，下面章节再出现 `test/fakes/fake-anomaly.repository.ts` 时，你就能立刻定位它是"单元测试用的内存实现"。

**今天在 `p1-monitor/apps/api/` 下要建立的完整测试目录树（v3 完整版）**：

```
apps/api/
├── src/
│   ├── anomaly/
│   │   ├── anomaly.service.ts              ← 【Day 24 已有】被测：资源授权
│   │   ├── anomaly.repository.ts           ← 【Day 23 已有】被测：数据访问
│   │   └── ports/anomaly-repository.port.ts ← 【Day 21 已有】Repository 接口（fake 的契约）
│   └── conversation/
│       ├── conversation.service.ts         ← 【Day 23 已有】被测：聚合根
│       └── conversation.aggregate.ts       ← 【Day 23 已有】被测：业务不变量
├── test/                                   ← 【本日大改】分层测试根
│   ├── unit/                               ← 【新增】单元测试（无 DB，用 fake）
│   │   ├── anomaly.service.spec.ts         ← Service + Repository fake
│   │   └── conversation.aggregate.spec.ts  ← 纯聚合逻辑
│   ├── integration/                        ← 【新增】集成测试（真实 Postgres）
│   │   ├── conversation.repository.int-spec.ts ← SQL/索引/事务
│   │   └── setup-integration.ts            ← 隔离 schema + 事务回滚 helper
│   ├── e2e/                                ← 【新增】端到端测试（真实 HTTP）
│   │   ├── auth-matrix.e2e-spec.ts         ← 授权矩阵门禁
│   │   └── setup-e2e.ts                    ← Nest app 装配 + JWT 签发 helper
│   ├── fakes/                              ← 【新增】测试替身（跨用例复用）
│   │   ├── fake-anomaly.repository.ts      ← 内存 Repository（实现 port 接口）
│   │   └── fixtures.ts                     ← 确定性测试数据工厂
│   └── helpers/
│       └── mutation-guard.spec.ts          ← 【新增】关键行为测试（mutation 靶子）
├── stryker.conf.json                       ← 【新增】mutation testing 配置
├── vitest.config.ts                        ← 【改】拆分 unit/integration/e2e project
└── package.json                            ← 【改】test:unit / test:integration / test:e2e / test:mutation 脚本
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `test/unit/anomaly.service.spec.ts` | ✓ 简单 mock，覆盖率导向 | ✓ Repository fake + 行为导向 | ✓ 同 v2 |
| `test/fakes/fake-anomaly.repository.ts` | ✗ | ✓ 实现 port 接口 | ✓ 同 v2 |
| `test/fakes/fixtures.ts` | ✗ | ✓ 确定性工厂 | ✓ 同 v2 |
| `test/integration/*.int-spec.ts` | ✗ | ✗ | ✓ 真实 DB + 事务回滚 |
| `test/integration/setup-integration.ts` | ✗ | ✗ | ✓ 隔离 schema helper |
| `test/e2e/auth-matrix.e2e-spec.ts` | ✗ | ✗ | ✓ 授权矩阵门禁 |
| `stryker.conf.json` | ✗ | ✗ | ✓ mutation 配置 |
| `vitest.config.ts` | 单 project | 单 project | 三 project 分档 |

**依赖方向（务必单向，反过来一次都不行）**：

```
test/unit/*.spec.ts
        │
        ├─► src/*.service.ts          ← 被测单元
        └─► test/fakes/*.ts           ← 内存替身（实现 src/ports/*.port.ts 接口）

test/integration/*.int-spec.ts
        │
        ├─► src/*.repository.ts       ← 被测（真实 Prisma）
        └─► test/integration/setup-integration.ts  ← 事务回滚 helper

test/e2e/*.e2e-spec.ts
        │
        └─► test/e2e/setup-e2e.ts     ← 装配整个 Nest app + supertest

test/fakes/*.ts        ← 只 import src/ports/*.port.ts（接口），不 import 具体 Service
```

**红线**：
- `test/fakes/fake-anomaly.repository.ts` 里出现 `import { PrismaService }` 就是塌方——fake 是内存实现，绝不碰真实 DB，否则单元测试就退化成慢集成测试
- `test/unit/*.spec.ts` 里出现 `new PrismaClient()` 或连真库是塌方——单元测试必须秒级、确定、无外部依赖
- 集成测试用例之间**不清理数据**（不用事务回滚或 truncate）就是塌方——测试顺序一变就随机失败
- 用覆盖率数字作为唯一质量标准是塌方——必须有 mutation 或关键行为断言证明测试有效

**动手前先问自己 3 个问题**：

1. Repository fake 为什么实现 port 接口而不是继承真实 Repository？—— 见 §5.4 知识点 2「依赖倒置在测试中的应用」
2. 集成测试为什么用事务回滚而不是每次 truncate 表？—— 见 §5.4 知识点 4「集成测试隔离的三种策略」
3. mutation testing 为什么能证明覆盖率证明不了的东西？—— 见 §5.4 知识点 6「mutation testing 与覆盖率盲区」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：装测试依赖（3 分钟）

按第 5.3 节的代码：

- 项目已有 `vitest`（Day 01 装的）
- 集成/E2E 需要：`pnpm --filter api add -D supertest @types/supertest`
- mutation 需要：`pnpm --filter api add -D @stryker-mutator/core @stryker-mutator/vitest-runner`
- 确认本地有可连的 Postgres（集成测试用），或用 `docker run -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16`

**边写边问自己**：

- 为什么 supertest 只在 E2E 用，单元测试不用？（单元测试不启 HTTP server，直接调 Service 方法；supertest 是发真实 HTTP 请求，属于 E2E）
- Stryker 为什么慢？（它要为每个变异重跑一遍相关测试，N 个变异 = N 次测试运行；所以只对关键文件跑 mutation，不全量跑）

### 1.5.2 D-2：拆分 vitest project（2 分钟）

按第 5.3 节的目录树，在 `test/` 下建 5 个子目录：`unit/` `integration/` `e2e/` `fakes/` `helpers/`。

**边写边问自己**：

- 为什么 unit/integration/e2e 要分目录而不是靠文件名后缀？（CI 要能分档跑：PR 时只跑快的 unit，merge 时才跑慢的 integration/e2e；分目录最清晰）
- 为什么 `fakes/` 单独一层？（fake 要跨多个 spec 复用；如果每个 spec 各自定义 fake，改一次 port 接口要改 N 处）

### 1.5.3 D-3：写 fakes 层（4 分钟）

按第 5.3 节的代码：

- 写 `test/fakes/fake-anomaly.repository.ts`（实现 `AnomalyRepositoryPort` 接口的内存版）
- 写 `test/fakes/fixtures.ts`（`makeAnomaly` / `makeUser` 确定性工厂）

**边写边问自己**：

- fake 的 `findById` 为什么用 `Map` 而不是数组？（O(1) 查找；更重要的是语义清晰——按 id 存取）
- fixtures 工厂为什么要接受 `overrides` 参数？（每个用例只关心自己要改的字段，其他字段用默认值，测试意图才清晰）
- fake 要不要实现 port 的**全部**方法？（要——否则 TypeScript 编译不过；这正是"实现接口"的好处，接口变了 fake 立刻报错）

### 1.5.4 D-4：写 unit + integration + e2e setup（7 分钟）

按第 5.3 节的代码：

- 写 `test/unit/anomaly.service.spec.ts`（注入 fake，测授权行为）
- 写 `test/unit/conversation.aggregate.spec.ts`（纯聚合逻辑）
- 写 `test/integration/setup-integration.ts`（BEGIN/ROLLBACK helper）
- 写 `test/integration/conversation.repository.int-spec.ts`（真实 SQL）
- 写 `test/e2e/setup-e2e.ts`（Nest app 装配 + JWT helper）
- 写 `test/e2e/auth-matrix.e2e-spec.ts`（授权矩阵）

**边写边问自己**：

- 集成测试的 `beforeEach` 里 BEGIN 事务、`afterEach` 里 ROLLBACK，为什么这样零污染？（事务未提交，所有写入在 ROLLBACK 后消失，下一个用例看到的是干净库）
- E2E 的 JWT 为什么在测试里自己签而不走登录接口？（走登录接口会让每个 E2E 用例都依赖登录逻辑正确；直接签 token 隔离关注点，登录本身另有专门用例测）

### 1.5.5 D-5：配 mutation + CI 脚本（4 分钟）

按第 5.3 节的代码：

- 写 `stryker.conf.json`（只 mutate `anomaly.service.ts`）
- 写 `test/helpers/mutation-guard.spec.ts`（专门盯授权断言的行为测试）
- 在 `package.json` 加 `test:unit` / `test:integration` / `test:e2e` / `test:mutation` 脚本

**边写边问自己**：

- 为什么 mutation 只 mutate 一个文件而不是全项目？（Stryker 很慢，全量跑几十分钟；日常只对"最关键、最怕出错"的授权逻辑跑，其他文件靠行为测试）
- mutation score 多少算够？（没有绝对标准；关键是"授权/安全相关的变异必须 100% KILLED"，非关键逻辑允许存活）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 30 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"高覆盖单测→fake 分层→隔离集成+mutation"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `setup-integration.ts` 和 `mutation-guard.spec.ts` | 能口述"事务回滚如何隔离"、"mutation 如何证明测试有效" |
| C：读深挖 | 30 min | §6.5 前端底子补弱（`Day25深挖-前端底子补弱.html`） | 能回答"前端组件测试的 fake 和后端 Repository fake 有什么共性" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，三档测试脚本可跑 |
| E：写核心测试 | 20 min | §7.6 补齐关键行为测试 | `pnpm --filter api test:unit` 全绿 |
| F-1：反证 1 | 5 min | §7.7 删掉授权断言，看单测是否变红 | 观察"删断言后 mutation-guard 测试变红"，验证测试有牙齿 |
| F-2：反证 2 | 5 min | §7.8 打乱集成测试顺序 / 去掉事务回滚 | 观察"共享 DB 不清理导致随机失败" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day25` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（只写覆盖率高的单测）

### 3.1 v1 要实现什么

给 `AnomalyService.getById(actor, id)` 写单元测试。v1 只追求一件事：**覆盖率数字好看**。用简单的 mock 让每个方法都被执行到，覆盖率跑到 90%+。

**目标**：
- `anomaly.service.spec.ts` 覆盖 `getById` 的成功路径
- 覆盖率报告显示 `anomaly.service.ts` > 90%

**不做**：
- 不用 Repository fake（直接 mock 返回值）
- 不测授权失败路径（只测 happy path）
- 无集成测试、无 E2E、无 mutation

### 3.2 v1 目录结构

```
apps/api/test/
└── anomaly.service.spec.ts     ← 唯一测试文件，覆盖率导向
```

### 3.3 v1 完整代码

**被测代码回顾（Day 24 已有）：apps/api/src/anomaly/anomaly.service.ts（片段）**

```typescript
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { AnomalyRepositoryPort } from './ports/anomaly-repository.port'
import type { Actor } from '../auth/actor'

@Injectable()
export class AnomalyService {
  constructor(private readonly repo: AnomalyRepositoryPort) {}

  async getById(actor: Actor, id: string) {
    const anomaly = await this.repo.findById(id)
    if (!anomaly) {
      throw new NotFoundException(`anomaly ${id} not found`)
    }
    // ★ 关键授权断言：只有 owner 或 admin 能读
    this.authorizeResourceAccess(actor, anomaly)
    return anomaly
  }

  private authorizeResourceAccess(actor: Actor, anomaly: { ownerId: string }) {
    if (actor.role === 'admin') return
    if (actor.userId === anomaly.ownerId) return
    throw new ForbiddenException('not allowed to access this anomaly')
  }
}
```

**apps/api/test/anomaly.service.spec.ts（v1 全文——覆盖率导向的反面教材）**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { AnomalyService } from '../src/anomaly/anomaly.service'

describe('AnomalyService (v1 覆盖率导向)', () => {
  it('getById 返回 anomaly', async () => {
    // 简单 mock：直接返回一个对象
    const repo = {
      findById: vi.fn().mockResolvedValue({ id: 'a-1', ownerId: 'u-1' }),
    }
    const service = new AnomalyService(repo as any)

    // 用 admin 调用，一定能过授权
    const actor = { userId: 'admin-x', role: 'admin' as const }
    const result = await service.getById(actor, 'a-1')

    expect(result.id).toBe('a-1')
    expect(repo.findById).toHaveBeenCalledWith('a-1')
  })
})
```

跑覆盖率：

```
$ pnpm --filter api test -- --coverage
 ✓ anomaly.service.spec.ts (1)
 File               | % Stmts | % Branch | % Funcs |
 anomaly.service.ts |   92.3  |   75.0   |  100.0  |
```

92% 语句覆盖，看起来很安全。

### 3.4 v1 暴露的痛点

**痛点 1：删掉授权断言，测试依然全绿（假安全）**

有人重构时手滑删掉了 `this.authorizeResourceAccess(actor, anomaly)` 这一行。重新跑 v1 测试：

```
$ pnpm --filter api test
 ✓ anomaly.service.spec.ts (1)   ← 依然全绿！
```

因为 v1 唯一的用例用的是 `role: 'admin'`——admin 走的是 `if (actor.role === 'admin') return` 早返回，删不删授权断言它都能过。**测试根本没验证"未授权 actor 被拒绝"这个行为**。覆盖率 92% 是假象：授权失败分支从来没被断言过。直到线上普通用户改 URL 读到别人的 anomaly 才暴露。

**痛点 2：mock 返回值与真实 Repository 行为脱节**

`repo.findById` 被 mock 成永远返回 `{ id: 'a-1', ownerId: 'u-1' }`。但真实 Repository 的 `findById` 在找不到时返回 `null`、在 DB 报错时抛异常。v1 的 mock 掩盖了这些真实行为，`NotFoundException` 分支也没测到（虽然覆盖率把它算作"部分覆盖"）。

**痛点 3：每个用例重复写 mock 样板**

`const repo = { findById: vi.fn().mockResolvedValue(...) }` 这段样板，每加一个用例就要复制一遍，还要记得 mock 所有被调到的方法。用例一多就变成"mock 地狱"，改一次接口要改十几处。

**痛点 4：没有集成/E2E，SQL 和 HTTP 层完全没验证**

Service 的授权逻辑即使测对了，Repository 的 SQL（游标分页、外键级联）、Controller 的 Guard 装配、真实 HTTP 的 401/403，v1 一概没测。线上真正的攻击是"改 URL 发真实请求"，而 v1 连一个真实请求都没发过。

---

## 4. v2：加 Repository fake + 关键行为测试

### 4.1 v2 要实现什么

用户视角：测试不再追覆盖率数字，而是**验证行为**。引入 Repository fake（实现 port 接口的内存版）消除 mock 样板；补齐"未授权 actor 被拒绝""not found 抛 404"等关键行为用例；删掉授权断言时，至少有一个用例会变红。

**目标**：
- 建立 `FakeAnomalyRepository implements AnomalyRepositoryPort`
- 建立 `makeAnomaly` / `makeActor` 确定性 fixtures
- 补齐授权失败、not found、owner 可读、admin 可读四类行为用例

**依然不做**：
- 无真实 DB 集成测试（fake 仍是内存）
- 无 E2E（不发真实 HTTP）
- 无 mutation 验证（靠人工判断"测试有没有牙齿"）

### 4.2 v2 目录结构

```
apps/api/test/
├── fakes/
│   ├── fake-anomaly.repository.ts   ← 新增：实现 port 的内存版
│   └── fixtures.ts                  ← 新增：makeAnomaly / makeActor
└── unit/
    └── anomaly.service.spec.ts      ← 改：注入 fake，测 4 类行为
```

### 4.3 v2 完整代码

**apps/api/test/fakes/fake-anomaly.repository.ts（v2 全文）**

```typescript
import type { AnomalyRepositoryPort } from '../../src/anomaly/ports/anomaly-repository.port'

export interface FakeAnomaly {
  id: string
  ownerId: string
  status: string
}

/**
 * 实现 AnomalyRepositoryPort 的内存版。
 * 语义与真实 Repository 对齐：findById 找不到返回 null。
 * 关键：它 implements 接口，接口一变这里就编译报错——fake 不会悄悄漂移。
 */
export class FakeAnomalyRepository implements AnomalyRepositoryPort {
  private store = new Map<string, FakeAnomaly>()

  seed(anomalies: FakeAnomaly[]): void {
    for (const a of anomalies) {
      this.store.set(a.id, a)
    }
  }

  async findById(id: string): Promise<FakeAnomaly | null> {
    return this.store.get(id) ?? null
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`fake: anomaly ${id} not found for update`)
    this.store.set(id, { ...existing, status })
  }
}
```

**apps/api/test/fakes/fixtures.ts（v2 全文）**

```typescript
import type { FakeAnomaly } from './fake-anomaly.repository'
import type { Actor } from '../../src/auth/actor'

// 确定性工厂：默认值固定，只覆盖调用者关心的字段
export function makeAnomaly(overrides: Partial<FakeAnomaly> = {}): FakeAnomaly {
  return {
    id: 'a-default',
    ownerId: 'u-owner',
    status: 'open',
    ...overrides,
  }
}

export function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u-owner',
    role: 'user',
    ...overrides,
  }
}
```

**apps/api/test/unit/anomaly.service.spec.ts（v2 全文——行为导向）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { AnomalyService } from '../../src/anomaly/anomaly.service'
import { FakeAnomalyRepository } from '../fakes/fake-anomaly.repository'
import { makeAnomaly, makeActor } from '../fakes/fixtures'

describe('AnomalyService.getById（行为导向）', () => {
  let repo: FakeAnomalyRepository
  let service: AnomalyService

  beforeEach(() => {
    repo = new FakeAnomalyRepository()
    service = new AnomalyService(repo)
  })

  it('owner 能读自己的 anomaly', async () => {
    repo.seed([makeAnomaly({ id: 'a-1', ownerId: 'u-owner' })])
    const actor = makeActor({ userId: 'u-owner', role: 'user' })

    const result = await service.getById(actor, 'a-1')
    expect(result.id).toBe('a-1')
  })

  it('admin 能读任意 anomaly', async () => {
    repo.seed([makeAnomaly({ id: 'a-1', ownerId: 'u-other' })])
    const actor = makeActor({ userId: 'admin-x', role: 'admin' })

    const result = await service.getById(actor, 'a-1')
    expect(result.id).toBe('a-1')
  })

  // ★ 这个用例是删授权断言时会变红的"牙齿"
  it('非 owner 的普通用户被拒绝（ForbiddenException）', async () => {
    repo.seed([makeAnomaly({ id: 'a-1', ownerId: 'u-owner' })])
    const actor = makeActor({ userId: 'u-attacker', role: 'user' })

    await expect(service.getById(actor, 'a-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('anomaly 不存在时抛 NotFoundException', async () => {
    const actor = makeActor()
    await expect(service.getById(actor, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
```

### 4.4 v2 暴露的痛点

**痛点 1：fake 是内存的，真实 SQL 从未被执行**

`FakeAnomalyRepository` 用 `Map` 模拟存取。它验证了 Service 的授权逻辑，但真实 Repository 的 SQL——复合索引是否命中、游标分页边界、外键级联删除、事务隔离——一行都没跑过。fake 说"findById 返回 null"，但真实 SQL 可能因为 `WHERE tenant_id = ?` 条件漏写而返回了别人的数据。**授权逻辑对，不代表数据查询对**。

**痛点 2：没有真实 HTTP，Guard 装配与 401/403 未验证**

Day 24 的 `ResourceGuard`、`JwtAuthGuard` 是通过装饰器挂在 Controller 上的。v2 直接 `new AnomalyService()` 调方法，完全绕过了 Nest 的 DI 容器和 Guard 管线。真实请求里 Guard 有没有正确拦截过期 token、伪造 Origin、跨用户 URL，v2 测不到。

**痛点 3："测试有没有牙齿"靠人工判断，不可靠**

v2 靠人肉 review "这个用例删断言会不会变红"。但项目大了、测试多了，没人能保证每个关键断言都有对应的"牙齿用例"。需要一个机器化手段：**故意改坏代码（mutation），看测试能不能抓住**。

**痛点 4：集成测试一旦引入，共享 DB 会污染**

一旦要写真实 DB 集成测试，多个用例、CI 并发 job 共享同一个 Postgres，前一个用例写的数据没清理，后一个用例就会读到脏数据，导致随机失败。v2 还没碰这个问题，但 v3 引入集成测试后必须先解决隔离。

---

## 5. v3：隔离集成测试 + E2E 门禁 + mutation 验证（终态）

### 5.1 v3 要实现什么

用户视角：
1. 真实 DB 集成测试跑真实 SQL，每个用例在独立事务里执行、结束回滚，100 轮并发无抖动
2. E2E 测试发真实 HTTP，验证 Guard 管线（过期 token → 401、跨用户 URL → 403）
3. mutation 测试证明"关键断言有牙齿"：删授权断言、改比较符，至少一个 mutation 被测试捕获
4. 覆盖率不再是目标而是副产品；行为覆盖 ≥ 75% 且关键路径 mutation score 达标

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/test/
├── fakes/
│   ├── fake-anomaly.repository.ts       ← v2 已有
│   └── fixtures.ts                      ← v2 已有
├── unit/
│   └── anomaly.service.spec.ts          ← v2 已有
├── integration/
│   ├── db-test-context.ts               ← 新增：隔离事务上下文
│   ├── anomaly.repository.int-spec.ts   ← 新增：真实 SQL 集成测试
│   └── setup-integration.ts             ← 新增：集成测试全局钩子
├── e2e/
│   ├── anomaly-authz.e2e-spec.ts        ← 新增：授权矩阵 E2E
│   └── setup-e2e.ts                     ← 新增：Nest app 启动/销毁
└── mutation/
    └── mutation-plan.md                 ← 新增：手工 mutation 清单
```

### 5.3 v3 完整代码

#### 5.3.1 集成层：db-test-context.ts

```typescript
import { PrismaClient } from '@prisma/client'

/**
 * 隔离集成测试的核心：每个测试在一个"会被回滚的事务"里跑。
 *
 * Prisma 的 $transaction 回调结束会自动 commit，
 * 所以这里用"抛一个哨兵错误强制回滚"的技巧：
 *   - 测试逻辑在事务内执行
 *   - 结束时抛 ROLLBACK_SENTINEL
 *   - 外层捕获哨兵，静默吞掉 → 事务回滚 → DB 恢复原状
 *
 * 效果：用例之间零污染，不需要手动 TRUNCATE，CI 并发也安全
 * （每个 job 连自己的 schema，见 setup-integration.ts）
 */
const ROLLBACK_SENTINEL = Symbol('rollback')

export async function withRolledBackTx<T>(
  prisma: PrismaClient,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  let captured: T
  try {
    await prisma.$transaction(async (tx) => {
      captured = await fn(tx as unknown as PrismaClient)
      // 强制回滚：抛哨兵
      throw { sentinel: ROLLBACK_SENTINEL, value: captured }
    })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'sentinel' in err &&
      (err as { sentinel: symbol }).sentinel === ROLLBACK_SENTINEL
    ) {
      return (err as { value: T }).value
    }
    // 真实错误：向上抛
    throw err
  }
  // 理论不可达
  return captured!
}
```

**apps/api/test/integration/setup-integration.ts**

```typescript
import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'

/**
 * CI 并发隔离：每个 worker 用独立 schema。
 * VITEST_WORKER_ID 由 vitest 注入，保证同一机器上并发 worker 不撞库。
 */
export function makeWorkerScopedPrisma(): PrismaClient {
  const workerId = process.env.VITEST_WORKER_ID ?? '0'
  const schema = `test_w${workerId}`
  const baseUrl = process.env.DATABASE_URL!
  const url = `${baseUrl}?schema=${schema}`

  // 把 migration 应用到这个 worker 专属 schema
  execSync(`pnpm prisma migrate deploy`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  })

  return new PrismaClient({ datasources: { db: { url } } })
}
```

**apps/api/test/integration/anomaly.repository.int-spec.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { makeWorkerScopedPrisma } from './setup-integration'
import { withRolledBackTx } from './db-test-context'
import { PrismaAnomalyRepository } from '../../src/anomaly/adapters/prisma-anomaly.repository'

describe('PrismaAnomalyRepository（真实 SQL 集成）', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = makeWorkerScopedPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('findById 命中真实复合索引且只返回本租户数据', async () => {
    await withRolledBackTx(prisma, async (tx) => {
      // 造两个租户的同名 anomaly
      await tx.anomaly.create({
        data: { id: 'a-1', ownerId: 'u-owner', tenantId: 't-1', status: 'open' },
      })
      await tx.anomaly.create({
        data: { id: 'a-2', ownerId: 'u-other', tenantId: 't-2', status: 'open' },
      })

      const repo = new PrismaAnomalyRepository(tx)
      const found = await repo.findByIdForTenant('a-1', 't-1')
      const crossTenant = await repo.findByIdForTenant('a-2', 't-1') // 跨租户

      expect(found?.id).toBe('a-1')
      // ★ 真实 SQL 的 WHERE tenant_id 条件生效：跨租户查不到
      expect(crossTenant).toBeNull()
    })
    // 事务已回滚：DB 里没有 a-1 / a-2 残留
  })

  it('updateStatus 后 findById 能读到新状态（同事务内可见）', async () => {
    await withRolledBackTx(prisma, async (tx) => {
      await tx.anomaly.create({
        data: { id: 'a-9', ownerId: 'u-owner', tenantId: 't-1', status: 'open' },
      })
      const repo = new PrismaAnomalyRepository(tx)
      await repo.updateStatus('a-9', 't-1', 'resolved')
      const after = await repo.findByIdForTenant('a-9', 't-1')
      expect(after?.status).toBe('resolved')
    })
  })
})
```

#### 5.3.2 E2E 层：setup-e2e.ts

```typescript
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../../src/app.module'

export async function bootstrapE2E(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}
```

**apps/api/test/e2e/anomaly-authz.e2e-spec.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { bootstrapE2E } from './setup-e2e'
import { signTestJwt } from './jwt-helper'

describe('Anomaly 授权矩阵（E2E，真实 Guard 管线）', () => {
  let app: INestApplication
  let httpServer: unknown

  beforeAll(async () => {
    app = await bootstrapE2E()
    httpServer = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  it('无 token → 401', async () => {
    await request(httpServer).get('/anomalies/a-1').expect(401)
  })

  it('过期 token → 401', async () => {
    const expired = signTestJwt({ userId: 'u-owner', exp: 1 }) // 1970 年过期
    await request(httpServer)
      .get('/anomalies/a-1')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401)
  })

  it('合法 token 但访问他人资源 → 403（IDOR 防护）', async () => {
    const token = signTestJwt({ userId: 'u-attacker', role: 'user' })
    await request(httpServer)
      .get('/anomalies/a-owned-by-someone-else')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
  })

  it('owner 访问自己资源 → 200', async () => {
    const token = signTestJwt({ userId: 'u-owner', role: 'user' })
    await request(httpServer)
      .get('/anomalies/a-owned-by-u-owner')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  })
})
```

#### 5.3.3 mutation 层：mutation-plan.md

```markdown
# Mutation 测试清单（手工版，验证测试"有牙齿"）

mutation 测试的核心命题：**故意把代码改坏，如果测试还全绿，说明测试没覆盖这个行为**。
存活的 mutation（survived）= 覆盖盲区；被杀死的 mutation（killed）= 测试有效。

## 关键路径 mutation 清单

| # | 变异位置 | 变异操作 | 预期：被哪个测试杀死 |
|---|---|---|---|
| M1 | `AnomalyService.getById` 授权分支 | 删掉 `if (!canRead) throw Forbidden` | unit: 非 owner 被拒绝用例 → 变红 |
| M2 | `AnomalyService.getById` 授权比较 | `actor.userId === anomaly.ownerId` 改 `!==` | unit: owner 能读 + admin 能读 → 变红 |
| M3 | `PrismaAnomalyRepository.findByIdForTenant` | 删掉 `WHERE tenant_id` 条件 | integration: 跨租户查不到 → 变红 |
| M4 | `ResourceGuard` | `return canActivate` 改 `return true` | e2e: 访问他人资源 403 → 变红 |
| M5 | `JwtAuthGuard` exp 校验 | 删掉过期检查 | e2e: 过期 token 401 → 变红 |

## 手工执行步骤

1. 逐条应用 mutation（git stash 保存原状）
2. 跑对应测试层：`pnpm test:unit` / `pnpm test:int` / `pnpm test:e2e`
3. 记录 killed / survived
4. survived 的 mutation → 补测试用例
5. `git checkout .` 还原代码

## 通过标准

- M1-M5 全部 killed（关键路径 mutation score = 100%）
- 至少证明"删授权断言测试会红"（否则高覆盖率是假象）

> 后续可接入 StrykerJS 自动化；今天先用手工清单建立"mutation 思维"。
```

### 5.4 v3 用到的知识点

**知识点 1：测试金字塔（Test Pyramid）—— 数量与成本的平衡**
- 解决的问题：全写 E2E 慢且脆（一个 UI 改动挂一片）；全写单测又测不到集成缝隙
- 运行机制：底层大量快速单测（纯逻辑）、中层适量集成测试（真实 DB/依赖）、顶层少量 E2E（真实 HTTP 全链路）；越往上越慢越贵越少
- 项目落点：`unit/`（Service 授权逻辑）、`integration/`（真实 SQL）、`e2e/`（Guard 管线）三层目录
- 生产误区：金字塔倒挂（E2E 比单测还多，CI 跑 40 分钟）；只有单测没有集成（SQL 缝隙裸奔）
- 验证方法：统计三层用例数量比例，应大致呈金字塔（单测 : 集成 : E2E ≈ 70 : 20 : 10）

**知识点 2：Repository Fake vs Mock —— fake 有真实语义**
- 解决的问题：mock 每次都要 `mockResolvedValue`，接口一变 mock 不报错继续返回旧结构（silent drift）
- 运行机制：fake `implements` port 接口，用内存 Map 提供真实语义（findById 找不到返回 null）；接口变更 fake 编译报错，逼着同步
- 项目落点：`FakeAnomalyRepository implements AnomalyRepositoryPort`
- 生产误区：fake 语义和真实实现不一致（fake 的 findById 找不到抛错，真实的返回 null，测试全绿但线上炸）；用 jest.mock 整个模块（类型丢失）
- 验证方法：fake 和真实 Repository 都实现同一个 port，接口方法签名改动时 fake 必须编译报错

**知识点 3：集成测试的事务回滚隔离**
- 解决的问题：多个集成用例共享 DB，前一个写的数据污染后一个；手动 TRUNCATE 慢且易漏
- 运行机制：每个用例在 `$transaction` 里跑，结束抛哨兵错误强制回滚，DB 自动恢复原状；用例间零污染
- 项目落点：`withRolledBackTx` helper
- 生产误区：忘记回滚导致数据累积；在事务里测"事务提交后才可见"的行为（回滚事务测不了跨事务可见性，这类要单独处理）
- 验证方法：连续跑同一个"造 a-1"的用例 100 次都通过（不会因为 a-1 已存在而唯一约束冲突）

**知识点 4：CI 并发的 schema 隔离**
- 解决的问题：CI 8 个 job 并发，共享一个 DB 的默认 schema，事务回滚也挡不住"两个 job 同时建同 id"
- 运行机制：每个 vitest worker 用 `VITEST_WORKER_ID` 拼出独立 schema（`test_w0` / `test_w1`），各自 migrate deploy
- 项目落点：`makeWorkerScopedPrisma`
- 生产误区：所有 worker 连默认 schema（并发抖动）；schema 不清理累积上百个测试 schema
- 验证方法：本地 `--threads` 开 8 个 worker 跑集成测试，连续 100 轮无抖动

**知识点 5：E2E 走真实 Guard 管线**
- 解决的问题：单测直接 new Service 绕过 Nest DI 和 Guard，认证/授权中间件从未被执行
- 运行机制：`Test.createTestingModule({ imports: [AppModule] })` 启动完整应用，`supertest` 发真实 HTTP，Guard/Filter/Pipe 全部经过
- 项目落点：`bootstrapE2E` + `anomaly-authz.e2e-spec.ts`
- 生产误区：E2E 里 mock 掉 Guard（等于没测 Guard）；E2E 连生产库（危险）
- 验证方法：过期 token → 401、跨用户 URL → 403 两个用例必须真实经过 Guard 才能通过

**知识点 6：Mutation 测试 —— 覆盖率的照妖镜**
- 解决的问题：92% 覆盖率删掉授权断言仍全绿——覆盖率只统计"行有没有被执行"，不统计"断言有没有验证行为"
- 运行机制：故意把代码改坏（删断言、翻比较符、return true），跑测试；测试变红 = mutation killed（有效），测试仍绿 = survived（盲区）
- 项目落点：`mutation-plan.md` 的 M1-M5 手工清单
- 生产误区：只看覆盖率数字不看有效性；mutation 全靠工具不理解原理（StrykerJS 报 survived 却不知道补什么用例）
- 验证方法：手工应用 M1（删授权断言），跑 unit 测试必须变红；如果仍绿，说明缺"非 owner 被拒绝"用例

### 5.5 边写边问自己

- `withRolledBackTx` 为什么用抛哨兵错误来回滚，而不是 `tx.$rollback()`？（Prisma 的 interactive transaction 没有显式 rollback API，回调抛错是唯一触发回滚的方式）
- 集成测试和单测能共用同一个 fixtures 吗？（可以共用 `makeAnomaly` 的字段默认值，但集成测试要写真实 DB，需要额外的 tenantId 等字段）
- mutation 清单为什么先手工而不是直接上 StrykerJS？（先理解"哪些 mutation 该被杀死"的思维，再用工具放大；直接上工具会淹没在几百个 survived 里不知所措）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 高覆盖率单测 | 分层单测 + Repository fake | 隔离集成 + E2E 门禁 + mutation |
| **测试类型 / 数据模型** | 只有 unit，mock 一切 | unit + fake（内存 Map 真实语义） | unit + integration（真实 SQL）+ e2e（真实 HTTP） |
| **依赖隔离** | jest.mock 整模块 | fake implements port | 真实 DB + 事务回滚 + worker schema |
| **验证逻辑** | 覆盖行是否执行 | 验证关键行为断言 | mutation 证明断言有牙齿 |
| **可测试** | 覆盖率 92% 但删断言仍绿 | 授权行为被断言 | M1-M5 mutation 全 killed |
| **架构层次** | 无分层，测试贴着实现 | fake 层 + unit 层 | fakes/unit/integration/e2e/mutation |
| **换实现代价** | mock 全部重写 | fake 不变，换 adapter 集成测试兜底 | 集成测试锁真实 SQL 行为 |
| **CI 稳定性** | 单测快但测不到集成 | 同 v1 | worker schema 隔离，100 轮无抖动 |
| **对齐后续 Day** | — | Day 26 前端测试同款分层 | Day 30 M3 门禁要求覆盖 + mutation |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

后端测试日的深挖 HTML 聚焦"测试相关的 JS/TS 底层机制"，这些概念前端后端通用，是补弱重点。

**入口**：`output/Day25深挖-前端底子补弱.html`

**本日深挖主题**（对着 §5.3 的测试代码展开）：

1. **深挖 1：`Symbol` 作为哨兵值 —— 从 `withRolledBackTx` 的 ROLLBACK_SENTINEL 讲起**
   - 为什么用 Symbol 而不是字符串 `'rollback'`？（Symbol 全局唯一，不可能和业务错误的字符串撞）
2. **深挖 2：`async/await` 里的错误传播 —— 从事务回滚的 try/catch 讲起**
   - 抛出的对象如何穿透 `$transaction` 的 Promise 链？
3. **深挖 3：类型守卫（Type Guard）—— 从 `'sentinel' in err` 讲起**
   - `typeof err === 'object' && err !== null && 'sentinel' in err` 三段式为什么缺一不可？
4. **深挖 4：`implements` 与结构类型 —— 从 fake implements port 讲起**
   - TypeScript 的结构类型系统下，`implements` 到底约束了什么？
5. **深挖 5：测试替身谱系（Dummy/Stub/Spy/Mock/Fake）—— 从 Repository fake 讲起**
   - 五种测试替身的精确定义与适用场景。

每个深挖含 8 子节：场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

对着 §5.3，在 `apps/api/test/` 下补齐三层测试：

**目标测试清单**：
- `unit/anomaly.service.spec.ts`：owner 能读 / 非 owner 被拒 / admin 能读（3 个授权行为）
- `integration/anomaly.repository.int-spec.ts`：跨租户查不到 / 更新后可见（2 个真实 SQL 行为）
- `e2e/anomaly-authz.e2e-spec.ts`：401 / 401 过期 / 403 IDOR / 200 owner（4 个 Guard 管线行为）

**运行**：
```bash
pnpm --filter api test:unit
pnpm --filter api test:int
pnpm --filter api test:e2e
```

三层全绿，共 9 个用例。

### 7.7 F-1：反证实验 1（5 分钟）—— 应用 M1 mutation

手动删掉 `AnomalyService.getById` 里的授权断言：

```typescript
async getById(id: string, actor: Actor) {
  const anomaly = await this.repo.findByIdForTenant(id, actor.tenantId)
  if (!anomaly) throw new NotFoundException()
  // ★ 反证：注释掉下面这行授权检查
  // if (!this.canRead(actor, anomaly)) throw new ForbiddenException()
  return anomaly
}
```

跑 `pnpm test:unit`：
- **预期**：`非 owner 被拒绝` 用例变红（mutation killed）
- **如果全绿**：说明测试没覆盖"非 owner"路径，是覆盖盲区——立刻补用例

恢复代码：`git checkout src/anomaly/anomaly.service.ts`

### 7.8 F-2：反证实验 2（5 分钟）—— 去掉集成测试的事务回滚

把 `withRolledBackTx` 换成直接执行（不回滚）：

```typescript
// 反证：不用回滚包裹，直接写库
it('findById...', async () => {
  await prisma.anomaly.create({ data: { id: 'a-1', ... } })
  // ... 测试逻辑
})
```

连续跑两次 `pnpm test:int`：
- **预期**：第二次跑 `a-1` 已存在，唯一约束冲突，测试变红
- **说明**：这就是"没有隔离"的样子——用例间互相污染，跑第二次就挂

恢复代码。

### 7.9 F-3：验证 + 提交（10 分钟）

**四件套**：
```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter api test        # unit + int + e2e 全绿
pnpm --filter api build
```

**覆盖率检查**：
```bash
pnpm --filter api test:cov
# 关键模块（anomaly/agent/auth）行为覆盖 ≥ 75%
```

**提交**（Conventional Commits）：
```
test(api): add layered tests + mutation plan for core modules

- unit: anomaly authz behavior (owner/non-owner/admin)
- integration: real SQL with tx-rollback isolation + worker schema
- e2e: authz matrix through real Guard pipeline (401/403/200)
- mutation: manual M1-M5 checklist, all killed

Refs: Day25
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day26 结束时集中 push。

---

## 8. 通过标准

- [ ] 三层测试全绿：unit（3）+ integration（2）+ e2e（4）= 9 个用例
- [ ] 关键模块（anomaly / agent / auth）行为覆盖 ≥ 75%
- [ ] mutation 清单 M1-M5 至少验证 M1 被捕获（删授权断言测试变红）
- [ ] 集成测试事务回滚隔离生效：连续跑 100 轮无抖动
- [ ] CI worker schema 隔离：8 并发无唯一约束冲突
- [ ] 四件套全绿，commit 含 `Refs: Day25`，未执行 `git push`

---

## 9. 提交物

1. commit（含 `Refs: Day25`，未执行 `git push`）
2. 四件套输出截图 + 覆盖率报告（`coverage/` 关键模块 ≥ 75%）
3. mutation 执行记录（M1-M5 的 killed/survived 表格）
4. 学习日志（三层测试各自解决什么问题、mutation 暴露了哪个盲区）
5. 架构证据：测试金字塔图 + "高覆盖无效"的反证记录

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"后端测试"的数据流或控制流；当天知识链"Test pyramid、Repository fake、集成 DB、E2E、覆盖盲区"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（比如集成测试的事务回滚、或授权断言），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么（例如自动化 mutation、契约测试、性能测试基线），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. Service 单测覆盖 92%，但删除一个关键授权断言后仍全绿，跨租户读取线上才暴露。请用 mutation、覆盖报告和测试行为映射证明"高覆盖无效"；先补 E2E 授权门禁止损，再重写关键行为测试与 Repository fake，验证 mutation 被捕获。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S27 NestJS testing](https://docs.nestjs.com/fundamentals/testing)
2. 集成测试共享同一数据库且未清理，CI 并发 8 个 job 时随机失败 15%。请用测试顺序、事务和数据快照定位污染；先串行关键套件止损，再实现隔离 schema/事务回滚和确定性 fixture，连续运行 100 轮验证无抖动。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：Test pyramid、fake/真实 DB、E2E、mutation 与覆盖率盲区。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 什么是单元测试？通常使用哪些工具进行前端测试？
   来源：[《2024字节前端面试题（45题）》](<../../资源/2024字节前端面试题（45题）.pdf>)，第 2 页。
2. 如何保证大型全栈项目的代码质量和稳定性？
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 2 页。

题目说明：对应测试金字塔、单元/集成/E2E、CI 门禁；答题不能只报覆盖率，需说明测试有效性（mutation）。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承前**：Day 21-24 建立了模块边界、API 合同、数据模型、鉴权授权，今天为这些核心模块建立测试防护网
- **启后**：Day 26 前端测试复用今天的测试金字塔思维；Day 30 M3 门禁会把"覆盖 ≥ 75% + mutation 有效"作为发布硬门禁
- **阶段坐标**：阶段二（Day 31-60，AI 全栈）第 5 天——测试是全栈工程师的地基，没有可信测试就没有可信重构
