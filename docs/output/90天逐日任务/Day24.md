# Day 24：鉴权 / 权限（v1 JWT 认证 → v2 RBAC 角色守卫 → v3 资源级 ABAC + CSRF + actor 审计）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-08-06 周四，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 21-23 后端架构深化、API 合同、数据建模，第一次给项目加登录和权限、并亲手证明"前端隐藏菜单挡不住越权"的开发者

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
   Day 11-20：Tool Registry / Agent Loop / 持久化 / SSE / 时间线 / 毕业考
   Day 21：NestJS 架构深化（模块边界 + DI scope）
   Day 22：API 合同（DTO + OpenAPI + 版本兼容）
   Day 23：数据建模（Conversation/Message/Citation/User + 索引 + 迁移）
   Day 24：鉴权 / 权限（JWT + RBAC/ABAC + 资源授权 + CSRF + 审计）  ← 今天在这里
   Day 25-30：限流 / 缓存 / 部署 / M3 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 24 在阶段一尾段**。Day 23 刚把 `User` 表建出来（有了"用户"这个概念），但目前任何人都能读任何用户的诊断——今天要补上"你是谁（认证）"和"你能不能碰这条数据（授权）"这两道关。这一天的核心不是"写个登录页"，而是**亲手制造一次 IDOR 越权、亲眼看到前端隐藏菜单挡不住改 URL**，从而理解"授权必须在服务端、必须到资源级"。

### 到 Day 23 结束时项目已具备的能力

- **后端架构**（Day 21-22）：模块边界清晰、Ports/Adapters 解耦、统一 Error DTO、OpenAPI、版本兼容
- **数据模型**（Day 23）：`Conversation` / `Message` / `Citation` / `User` 四张表，聚合边界、复合索引、游标分页、可回滚迁移
- **缺失的一块**：所有接口都是**匿名可访问**。`GET /conversations/:id` 谁调都能拿到；`User` 表里有 100 个用户但没有任何机制区分"当前请求是谁发的"；高风险的 `changeAnomalyStatus`（Day 17）审批接口没有 actor 身份，审计日志里 `actor` 字段一直是 `'unknown'`

### 今天要解决的 4 个问题

1. **问题 1：接口匿名可访问——不知道"你是谁"**
   `GET /conversations/:id` 没有任何身份校验。任何人拿到 URL 就能读。生产系统第一步是**认证（Authentication）**：请求必须带合法凭证（JWT / Session），服务端验证后知道"这个请求是 user-42 发的"。

2. **问题 2：认证 ≠ 授权——知道你是谁，但没限制你能干什么**
   加了 JWT 后，user-42 登录了。但 user-42 把 URL 里的 `conversationId` 改成 user-99 的会话 ID，照样能读到——因为接口只校验了"你登录了"，没校验"这条会话是不是你的"。这就是 **IDOR（Insecure Direct Object Reference，不安全的直接对象引用）**。**授权（Authorization）必须到资源级：不仅看角色，还要看"这条具体资源的 owner 是不是你"**。

3. **问题 3：前端隐藏菜单被误当成安全边界**
   前端把"删除会话"按钮对普通用户 `v-if="isAdmin"` 隐藏了。开发者以为这样普通用户就删不了——但普通用户打开 DevTools 直接 `fetch('/conversations/x', {method:'DELETE'})` 照样删掉。**前端的任何隐藏 / 禁用都只是 UX，不是安全**。今天要亲手做这个反证实验。

4. **问题 4：CSRF + 长连接过期 token**
   如果用 Cookie 存 token 且没设 `SameSite`，攻击者的钓鱼站点能诱导用户浏览器带着 Cookie 发起高风险请求（CSRF）。另外 Day 09 的 WebSocket 长连接一旦建立，即使 JWT 过期了还会继续接受消息 30 分钟——**长连接必须定期重鉴权**。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付一个模块 **`AuthModule` + `AuthzModule`**：`AuthModule` 负责认证（登录签发 JWT、`JwtAuthGuard` 校验 token、把 `actor` 注入请求上下文）；`AuthzModule` 负责授权（`RolesGuard` 角色级 + `ResourceOwnerGuard` 资源级 ABAC + `@Policy` 策略装饰器）；配套 CSRF 防护（SameSite + double-submit token）、WebSocket 重鉴权、以及给所有高风险操作补上 `actor` 审计。

### 1.1 用户能看到什么

**场景**：user-42（普通角色 `operator`）登录后查看自己的诊断会话，然后尝试越权访问 user-99 的会话。

```
时间轴：

09:00:00  user-42 登录
  → POST /auth/login  body: { email: "op42@corp.com", password: "***" }
  → 服务端校验密码 → 签发 JWT（payload: { sub: "user-42", role: "operator", exp }）
  → 响应：Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Strict
          body: { userId: "user-42", role: "operator" }

09:00:05  user-42 读自己的会话
  → GET /conversations/conv-42-a
  → JwtAuthGuard：解析 Cookie 里的 JWT → actor = { userId: "user-42", role: "operator" }
  → ResourceOwnerGuard：查 conv-42-a.ownerId === "user-42"？ → 是 → 放行
  → 响应：200 OK { conversation: {...} }

09:00:10  user-42 尝试越权读 user-99 的会话（改 URL）
  → GET /conversations/conv-99-x
  → JwtAuthGuard：actor = { userId: "user-42", ... } → 认证通过（他确实登录了）
  → ResourceOwnerGuard：查 conv-99-x.ownerId === "user-42"？ → 否（owner 是 user-99）
  → 响应：403 Forbidden { error: { code: "FORBIDDEN_RESOURCE", ... } }
  → 审计日志：{ actor: "user-42", action: "read", resource: "conv-99-x", decision: "deny", reason: "not_owner" }

09:00:20  user-42 尝试删除会话（前端按钮已隐藏，但他手动 fetch）
  → DELETE /conversations/conv-42-a
  → JwtAuthGuard：通过
  → RolesGuard：需要 role ∈ {admin}，actor.role = "operator" → 拒绝
  → 响应：403 Forbidden { error: { code: "FORBIDDEN_ROLE" } }
  → 审计日志：{ actor: "user-42", action: "delete", decision: "deny", reason: "role_operator_lacks_delete" }

09:05:00  攻击者钓鱼站点尝试 CSRF（诱导 user-42 浏览器发批准请求）
  → POST /approvals/apr-1/decide  (from evil.com)
  → 浏览器因 SameSite=Strict 不携带 access_token Cookie
  → JwtAuthGuard：无 token → 401 Unauthorized
  → 请求失败，攻击无效
```

**用户看到的最终结果**：
- 自己的会话正常读写
- 改 URL 访问别人的会话 → 403，且被审计记录
- 手动 fetch 删除（绕过隐藏按钮）→ 403（角色不足）
- 跨站请求因 SameSite 被浏览器拦截

### 1.2 这个模块在项目里承担什么

- **输入**：HTTP 请求（携带 JWT Cookie / Header）、WebSocket 握手、Day 23 的 `User` / `Conversation` 资源
- **输出**：认证后的 `actor` 上下文、授权决策（allow/deny）、CSRF 防护、`actor` 审计日志
- **对齐后续**：今天定义的 **`actor` 上下文合同**、**`@Policy` 策略装饰器**、**`ResourceOwnerGuard` 资源授权模式**，是 Day 25（限流按 actor 维度）、Day 30（M3 门禁"跨用户读写全部失败"硬门禁）、Day 61-90 多租户 workbench 的地基

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | JWT 登录 + `JwtAuthGuard` 全局认证 | `auth/` 单模块，只认证不授权 | JWT 签发/校验、Passport 策略、`actor` 注入、Cookie vs Header |
| **v1 痛点** | 认证通过后任何登录用户能读任何资源（IDOR）；前端隐藏菜单挡不住手动 fetch |  |  |
| **v2** | v1 + **RBAC 角色守卫**（`@Roles('admin')` + `RolesGuard`） | 拆出 `authz/` + `roles.guard.ts` | RBAC 模型、角色守卫、装饰器元数据、角色 ≠ 资源所有权 |
| **v2 痛点** | 角色对了但资源不对：operator 能读所有 operator 的会话（同角色越权）；CSRF 无防护；WS 过期 token 仍有效 |  |  |
| **v3** | v2 + **资源级 ABAC**（`ResourceOwnerGuard` + `@Policy`）+ **CSRF 防护** + **WS 重鉴权** + **actor 审计** | 完整分层（auth/authz/policy/csrf/audit） | ABAC 策略、资源 owner 校验、CSRF double-submit、长连接重鉴权、授权审计 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：鉴权 / 权限 涉及多个关注点（认证、角色授权、资源授权、策略、CSRF、审计），如果不先在脑子里立起骨架，写到一半就会把"认证"和"授权"混在同一个 Guard 里、把"资源 owner 校验"写进 Controller、把"CSRF token 校验"糊在业务 Service 上。看完这棵树，下面章节再出现 `src/authz/guards/resource-owner.guard.ts` 时，你就能立刻定位它属于"授权层"而不是"认证层"。

**今天在 `p1-monitor/apps/api/src/` 下要建立的完整目录树（v3 完整版）**：

```
apps/api/src/
├── auth/                                       ← 【新增】认证模块（你是谁）
│   ├── strategy/
│   │   ├── jwt.strategy.ts                     ← Passport JWT 策略（解析 + 校验）
│   │   └── jwt.strategy.spec.ts                ← 策略单元测试
│   ├── guards/
│   │   └── jwt-auth.guard.ts                   ← 全局认证守卫
│   ├── decorators/
│   │   ├── current-actor.decorator.ts          ← @CurrentActor() 参数装饰器
│   │   └── public.decorator.ts                 ← @Public() 跳过认证标记
│   ├── dto/
│   │   ├── login.dto.ts                        ← 登录请求 DTO
│   │   └── actor.types.ts                      ← Actor 上下文类型（纯类型）
│   ├── auth.service.ts                         ← 登录 / 签发 / 校验密码
│   ├── auth.controller.ts                      ← POST /auth/login, /auth/logout
│   └── auth.module.ts                          ← NestJS 模块
├── authz/                                      ← 【新增】授权模块（你能干什么）
│   ├── guards/
│   │   ├── roles.guard.ts                      ← RBAC 角色守卫
│   │   ├── roles.guard.spec.ts                 ← 角色守卫单元测试
│   │   ├── resource-owner.guard.ts             ← 资源级 ABAC 守卫
│   │   └── resource-owner.guard.spec.ts        ← 资源授权单元测试
│   ├── policy/
│   │   ├── policy.types.ts                     ← 策略类型（纯类型）
│   │   ├── policy-engine.ts                    ← 策略求值（纯函数）
│   │   └── policy-engine.spec.ts               ← 策略引擎单元测试
│   ├── decorators/
│   │   ├── roles.decorator.ts                  ← @Roles('admin')
│   │   └── policy.decorator.ts                 ← @Policy('conversation:read')
│   └── authz.module.ts                         ← NestJS 模块
├── csrf/                                       ← 【新增】CSRF 防护
│   ├── csrf.middleware.ts                      ← double-submit token 校验
│   └── csrf.module.ts
├── audit/                                      ← 【Day 11/17 已有，本日扩展】
│   └── authz-audit.service.ts                  ← 【新增】授权决策审计
├── realtime/                                   ← 【Day 09 已有】WebSocket
│   └── ws-reauth.interceptor.ts                ← 【新增】长连接重鉴权
├── conversations/                              ← 【Day 23 已有，本日加守卫】
│   └── conversations.controller.ts             ← 加 @UseGuards + @Policy
└── main.ts                                     ← 【已有】挂全局 JwtAuthGuard + csrf 中间件
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `auth/strategy/jwt.strategy.ts` | ✓ 解析 + 校验 JWT | ✓ 同 v1 | ✓ 同 v1 |
| `auth/guards/jwt-auth.guard.ts` | ✓ 全局认证 | ✓ 同 v1 | ✓ 同 v1 |
| `authz/guards/roles.guard.ts` | ✗ | ✓ RBAC 角色 | ✓ 同 v2 |
| `authz/guards/resource-owner.guard.ts` | ✗ | ✗ | ✓ 资源级 owner 校验 |
| `authz/policy/policy-engine.ts` | ✗ | ✗ | ✓ ABAC 策略求值 |
| `csrf/csrf.middleware.ts` | ✗ | ✗ | ✓ double-submit |
| `realtime/ws-reauth.interceptor.ts` | ✗ | ✗ | ✓ 长连接重鉴权 |
| `audit/authz-audit.service.ts` | ✗ | ✗ | ✓ 授权决策审计 |

**依赖方向（务必单向，反过来一次都不行）**：

```
conversations.controller.ts
        │ @UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnerGuard)
        ▼
authz/guards/resource-owner.guard.ts
        │
        ├─► authz/policy/policy-engine.ts       ← 纯函数策略求值
        │
        └─► conversations 的 repository（查 owner）

auth/guards/jwt-auth.guard.ts
        │
        └─► auth/strategy/jwt.strategy.ts       ← Passport 校验

policy/policy-engine.ts     ← 纯函数，不 import NestJS、不查 DB
actor.types.ts              ← 纯类型
```

**红线**：
- `authz/policy/policy-engine.ts` 里出现 `import { PrismaService }` 就是架构塌方——策略求值必须是纯函数（输入 actor + resource + action，输出 allow/deny），才能穷举所有授权组合单测
- Controller 里手写 `if (conversation.ownerId !== req.user.id) throw ...` 是塌方——资源授权必须在 Guard 层统一，散在 Controller 里必然漏一个接口
- 前端用 `v-if="isAdmin"` 隐藏按钮**当成安全边界**是最危险的塌方——那只是 UX

**动手前先问自己 3 个问题**：

1. 认证（Authentication）和授权（Authorization）为什么必须分成两个模块？—— 见 §5.4 知识点 1「认证 vs 授权的边界」
2. `policy-engine.ts` 为什么必须是纯函数？—— 见 §5.4 知识点 4「策略求值的可测试性」
3. 资源级授权为什么不能只靠 RBAC 角色？—— 见 §5.4 知识点 3「RBAC 的越权盲区」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：安装依赖（3 分钟）

按第 5.3 节的代码：

- `pnpm --filter api add @nestjs/passport passport passport-jwt @nestjs/jwt bcrypt cookie-parser`
- `pnpm --filter api add -D @types/passport-jwt @types/bcrypt @types/cookie-parser`

**边写边问自己**：

- 为什么用 `bcrypt` 而不是 `sha256` 存密码？（bcrypt 有加盐 + 慢哈希，抗彩虹表和暴力破解；sha256 太快，GPU 每秒能算几十亿次）
- `@nestjs/jwt` 和 `passport-jwt` 的分工？（`@nestjs/jwt` 负责签发 token，`passport-jwt` 负责在请求里提取并校验 token）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `apps/api/src/` 下建 4 个模块目录：

```
auth/      ← 认证（strategy/guards/decorators/dto）
authz/     ← 授权（guards/policy/decorators）
csrf/      ← CSRF 防护
```

**边写边问自己**：

- 为什么 `auth/` 和 `authz/` 分开（名字只差一个字母）？（认证回答"你是谁"、授权回答"你能干什么"；两者生命周期、测试策略、变更频率都不同）
- `policy/` 为什么在 `authz/` 下而不是独立顶层？（策略是授权的实现细节，从属于授权模块）

### 1.5.3 D-3：写 auth 认证层（5 分钟）

按第 5.3 节的代码：

- 写 `auth/dto/actor.types.ts`（`Actor` 上下文类型）
- 写 `auth/strategy/jwt.strategy.ts`（Passport JWT 策略）
- 写 `auth/guards/jwt-auth.guard.ts`（全局守卫 + `@Public()` 豁免）
- 写 `auth/decorators/current-actor.decorator.ts` / `public.decorator.ts`
- 写 `auth/auth.service.ts` / `auth.controller.ts` / `auth.module.ts`

**边写边问自己**：

- `JwtAuthGuard` 设成全局守卫后，登录接口自己怎么办？（用 `@Public()` 装饰器 + 守卫里读 metadata 豁免，否则登录接口自己也要 token 就死锁了）
- `actor` 为什么注入到 `request.user`？（Passport 约定；`@CurrentActor()` 从这里取，业务代码不碰 `request`）

### 1.5.4 D-4：写 authz 授权层（7 分钟）

按第 5.3 节的代码：

- 写 `authz/policy/policy.types.ts` + `policy-engine.ts`（纯函数策略求值）
- 写 `authz/policy/policy-engine.spec.ts`（穷举 allow/deny）
- 写 `authz/guards/roles.guard.ts`（RBAC）
- 写 `authz/guards/resource-owner.guard.ts`（资源级 ABAC）
- 写 `authz/decorators/roles.decorator.ts` / `policy.decorator.ts`
- 写 `authz/authz.module.ts`

**边写边问自己**：

- `RolesGuard` 和 `ResourceOwnerGuard` 的执行顺序谁先？（先 Roles（快速、不查 DB），后 ResourceOwner（要查资源 owner）——快速失败原则）
- `policy-engine` 拿不到 `request`，它怎么知道资源 owner？（Guard 负责查 DB 拿到 resource，再把 `{ actor, resource, action }` 传给纯函数 engine 求值）

### 1.5.5 D-5：写 csrf + 审计 + WS 重鉴权 + 接入 Controller（3 分钟）

按第 5.3 节的代码：

- 写 `csrf/csrf.middleware.ts`（double-submit token）
- 写 `audit/authz-audit.service.ts`（授权决策审计）
- 写 `realtime/ws-reauth.interceptor.ts`（长连接重鉴权）
- 改 `conversations/conversations.controller.ts`（加 `@UseGuards` + `@Policy`）
- 改 `main.ts`（挂全局 `JwtAuthGuard` + `cookie-parser` + csrf 中间件）

**边写边问自己**：

- CSRF 的 double-submit 为什么能防？（攻击站点能让浏览器带 Cookie，但读不到 Cookie 值写进 header——同源策略挡住了读，所以伪造不出匹配的 header token）
- WS 重鉴权多久一次？（v3 用每 5 分钟检查一次 token exp；也可在每条高风险消息前校验）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 30 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"认证→角色授权→资源授权"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `resource-owner.guard.ts` 和 `policy-engine.ts` | 能口述"IDOR 在哪一层被挡"、"策略引擎为什么是纯函数" |
| C：读深挖 | 30 min | §6.5 前端底子补弱（`Day24深挖-前端底子补弱.html`） | 能回答"为什么前端隐藏菜单不是安全边界" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter api build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个 spec 文件 | `pnpm --filter api test authz` 全绿 |
| F-1：反证 1 | 5 min | §7.7 手动改 URL 越权访问他人会话 | 观察"没有 ResourceOwnerGuard 时能读到别人数据" |
| F-2：反证 2 | 5 min | §7.8 前端隐藏删除按钮，手动 fetch 删除 | 观察"前端隐藏挡不住 API 调用" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + 授权矩阵测试 + commit | commit 含 `Refs: Day24` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（JWT 认证，只认证不授权）

### 3.1 v1 要实现什么

给项目加登录：`POST /auth/login` 校验密码、签发 JWT；全局 `JwtAuthGuard` 校验每个请求的 token，把 `actor` 注入 `request.user`。让接口从"匿名可访问"变成"必须登录"。

**目标**：
- 登录签发 JWT（存 HttpOnly Cookie）
- 全局守卫拦截无 token 请求 → 401
- 业务接口能通过 `@CurrentActor()` 拿到"当前是谁"

**不做**：
- 不做授权（任何登录用户能读任何资源）
- 不做 CSRF 防护
- 不做 WS 重鉴权

### 3.2 v1 目录结构

```
apps/api/src/auth/
├── strategy/jwt.strategy.ts
├── guards/jwt-auth.guard.ts
├── decorators/current-actor.decorator.ts
├── decorators/public.decorator.ts
├── dto/login.dto.ts
├── dto/actor.types.ts
├── auth.service.ts
├── auth.controller.ts
└── auth.module.ts
```

### 3.3 v1 完整代码

**apps/api/src/auth/dto/actor.types.ts**

```typescript
// 认证后注入到 request.user 的上下文
export type UserRole = 'admin' | 'operator' | 'viewer'

export interface Actor {
  userId: string
  role: UserRole
  email: string
}

// JWT payload 结构（签发时写入，校验时解析）
export interface JwtPayload {
  sub: string        // subject = userId
  role: UserRole
  email: string
  iat?: number       // 签发时间（jwt 自动填）
  exp?: number       // 过期时间（jwt 自动填）
}
```

**apps/api/src/auth/dto/login.dto.ts**

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator'

export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  password!: string
}
```

**apps/api/src/auth/strategy/jwt.strategy.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-jwt'
import type { Request } from 'express'
import type { JwtPayload, Actor } from '../dto/actor.types'

// 从 HttpOnly Cookie 里提取 token（不用 Authorization header，避免 XSS 读取）
function cookieExtractor(req: Request): string | null {
  return req?.cookies?.access_token ?? null
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,                    // 过期 token 直接拒绝
      secretOrKey: process.env.JWT_SECRET ?? 'dev-only-change-me',
    })
  }

  // Passport 校验签名 + 过期后调用；返回值注入 request.user
  validate(payload: JwtPayload): Actor {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('invalid token payload')
    }
    return {
      userId: payload.sub,
      role: payload.role,
      email: payload.email,
    }
  }
}
```

> ⚠️ 隐私 / 密钥提醒：`JWT_SECRET` 是签发和校验 JWT 的密钥，泄漏后攻击者能伪造任意用户身份。**必须放 `.env`（已在 `.gitignore`），禁止硬编码进源码、禁止提交到 git**。代码里的 `'dev-only-change-me'` 只是本地兜底，生产环境如果 `process.env.JWT_SECRET` 为空应该直接启动失败，而不是用默认值。

**apps/api/src/auth/decorators/public.decorator.ts**

```typescript
import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'
// 标记某个接口跳过认证（如登录接口自己）
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
```

**apps/api/src/auth/decorators/current-actor.decorator.ts**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Actor } from '../dto/actor.types'

// 业务代码用 @CurrentActor() actor: Actor 拿当前用户，不碰 request
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => {
    const request = ctx.switchToHttp().getRequest()
    return request.user as Actor
  },
)
```

**apps/api/src/auth/guards/jwt-auth.guard.ts**

```typescript
import { Injectable, ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext) {
    // @Public() 标记的接口跳过认证
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true
    return super.canActivate(context)
  }
}
```

**apps/api/src/auth/auth.service.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import type { JwtPayload, UserRole } from './dto/actor.types'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateAndSign(email: string, password: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } })
    // 注意：用户不存在和密码错误返回同样的错误，不泄漏"这个邮箱是否注册过"
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials')
    }
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role as UserRole,
      email: user.email,
    }
    // 签发 15 分钟短 token（生产配合 refresh token；本日先只做 access token）
    return this.jwt.signAsync(payload, { expiresIn: '15m' })
  }
}
```

**apps/api/src/auth/auth.controller.ts**

```typescript
import { Body, Controller, Post, Res, HttpCode } from '@nestjs/common'
import type { Response } from 'express'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { Public } from './decorators/public.decorator'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const token = await this.authService.validateAndSign(dto.email, dto.password)
    // HttpOnly：JS 读不到，防 XSS 窃取；Secure：只走 HTTPS；SameSite=Strict：防 CSRF
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    })
    return { ok: true }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token')
    return { ok: true }
  }
}
```

**apps/api/src/auth/auth.module.ts**

```typescript
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './strategy/jwt.strategy'

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-only-change-me',
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
```

**apps/api/src/main.ts（v1 增量）**

```typescript
// ... 已有 bootstrap ...
import * as cookieParser from 'cookie-parser'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import { Reflector } from '@nestjs/core'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(cookieParser())
  // 全局认证：所有接口默认需要登录，除非 @Public()
  app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)))
  await app.listen(3000)
}
```

### 3.4 v1 暴露的痛点

**痛点 1：认证通过 = 能读一切（IDOR）**

user-42 登录后，`GET /conversations/conv-99-x`（user-99 的会话）照样返回 200。因为 `JwtAuthGuard` 只校验"你是不是登录了"，不校验"这条会话是不是你的"。这是 **IDOR 越权**——生产环境最高频的安全漏洞之一。

**痛点 2：没有角色概念，删除接口谁都能调**

`DELETE /conversations/:id` 只要登录就能调。viewer（只读角色）也能删。需要 **RBAC**：不同角色有不同操作权限。

**痛点 3：前端隐藏按钮 ≠ 安全**

前端给 viewer 隐藏了删除按钮，但 viewer 打开 DevTools `fetch('/conversations/x',{method:'DELETE'})` 照样删。**授权必须在服务端**。

**痛点 4：无审计**

谁在什么时候读了/删了什么，没有任何记录。出了数据泄漏事故无法追溯 actor。

---

## 4. v2：加 RBAC 角色守卫

### 4.1 v2 要实现什么

用户视角：不同角色（admin / operator / viewer）能做的操作不同。admin 能删会话、operator 能读写自己的会话、viewer 只能读。用 `@Roles('admin')` 装饰器 + `RolesGuard` 声明式地控制接口的角色门槛。

**目标**：
- `@Roles('admin', 'operator')` 装饰器声明接口允许的角色
- `RolesGuard` 读 `actor.role`，不在允许列表就 403
- 删除接口只允许 admin

**依然不做**：
- 不做资源级授权（operator-A 还是能读 operator-B 的会话——角色相同但资源不同，RBAC 挡不住）
- 不做 CSRF
- 不做 WS 重鉴权

### 4.2 v2 目录结构

```
apps/api/src/authz/
├── guards/roles.guard.ts              ← 新增：RBAC
├── decorators/roles.decorator.ts      ← 新增：@Roles()
└── authz.module.ts                    ← 新增
```

### 4.3 v2 完整代码

**apps/api/src/authz/decorators/roles.decorator.ts**

```typescript
import { SetMetadata } from '@nestjs/common'
import type { UserRole } from '../../auth/dto/actor.types'

export const ROLES_KEY = 'roles'
// @Roles('admin', 'operator') 声明允许的角色
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles)
```

**apps/api/src/authz/guards/roles.guard.ts**

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'
import type { Actor, UserRole } from '../../auth/dto/actor.types'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    // 没标 @Roles 的接口：任何登录用户都能过（认证已由 JwtAuthGuard 保证）
    if (!requiredRoles || requiredRoles.length === 0) return true

    const actor = context.switchToHttp().getRequest().user as Actor
    if (!actor || !requiredRoles.includes(actor.role)) {
      throw new ForbiddenException(
        `requires one of roles: ${requiredRoles.join(', ')}`,
      )
    }
    return true
  }
}
```

**apps/api/src/authz/authz.module.ts（v2）**

```typescript
import { Module } from '@nestjs/common'
import { RolesGuard } from './guards/roles.guard'

@Module({
  providers: [RolesGuard],
  exports: [RolesGuard],
})
export class AuthzModule {}
```

**apps/api/src/conversations/conversations.controller.ts（v2 增量）**

```typescript
import { Controller, Get, Delete, Param, UseGuards } from '@nestjs/common'
import { RolesGuard } from '../authz/guards/roles.guard'
import { Roles } from '../authz/decorators/roles.decorator'
import { CurrentActor } from '../auth/decorators/current-actor.decorator'
import type { Actor } from '../auth/dto/actor.types'

@Controller('conversations')
@UseGuards(RolesGuard)            // 挂在 controller 上，全部方法生效
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  // viewer/operator/admin 都能读（没标 @Roles）
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.service.findOne(id)
  }

  // 只有 admin 能删
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
```

### 4.4 v2 暴露的痛点

**痛点 1：同角色跨资源越权仍然存在**

operator-A 和 operator-B 都是 `operator` 角色。`RolesGuard` 只看角色，`GET /conversations/conv-B`（属于 operator-B）对 operator-A 返回 200——因为两人角色相同。**RBAC 是"横向"的角色门槛，挡不住"同角色不同资源"的越权**。真正的 IDOR 修复需要资源级授权（ABAC）：检查 `resource.ownerId === actor.userId`。

**痛点 2：授权逻辑散在 Guard 里，无法穷举测试**

角色判断逻辑写死在 `RolesGuard.canActivate` 里，混着 `request` 上下文。想单测"viewer 对 delete 操作应该拒绝"，得 mock 整个 `ExecutionContext`。**策略求值应该抽成纯函数**（输入 `{actor, resource, action}`，输出 `allow/deny`），才能穷举所有组合。

**痛点 3：CSRF 敞口**

登录 Cookie 是 `SameSite=strict`（v1 设了），但如果哪天为了嵌入第三方放宽成 `SameSite=lax` 或 `none`，攻击站点就能诱导浏览器带 Cookie 发起高风险批准请求。需要 **double-submit CSRF token** 作为纵深防御。

**痛点 4：WS 长连接不重鉴权**

用户登录后建立 WS 连接，30 分钟后 JWT 过期，但 WS 连接还开着，服务端继续接受这条连接上的所有消息（包括高风险批准）。需要 **连接级重鉴权**：定期检查 token exp。

**痛点 5：无 actor 审计**

删除、批准这些高风险操作没有记录"谁、什么时候、对什么资源、做了什么、结果如何"。事故复盘无法追溯。

---

## 5. v3：资源级 ABAC + CSRF 防护 + WS 重鉴权 + actor 审计（终态）

### 5.1 v3 要实现什么

用户视角：
1. 跨用户读写全部失败——operator-A 改 URL 读 operator-B 的会话返回 403（IDOR 修复）
2. 授权策略是纯函数，`{actor, resource, action}` → `allow/deny`，可穷举测试
3. CSRF double-submit token 防跨站请求
4. WS 连接每 60 秒重鉴权，过期 token 立即断连
5. 所有高风险操作（delete / approve）写 actor 审计（谁、何时、对何资源、结果）

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/
├── auth/                              ← v1 已有
│   ├── jwt.strategy.ts
│   ├── jwt-auth.guard.ts
│   ├── auth.service.ts
│   ├── auth.controller.ts
│   ├── decorators/current-actor.decorator.ts
│   └── dto/actor.types.ts
├── authz/
│   ├── decorators/roles.decorator.ts       ← v2 已有
│   ├── guards/roles.guard.ts               ← v2 已有
│   ├── policy/
│   │   ├── policy.types.ts                 ← 新增：策略入参/出参类型
│   │   ├── resource-policy.ts              ← 新增：纯函数策略引擎
│   │   ├── resource-policy.spec.ts         ← 新增：策略穷举测试
│   │   └── resource-authz.guard.ts         ← 新增：资源级 Guard
│   ├── csrf/
│   │   ├── csrf.middleware.ts               ← 新增：double-submit 校验
│   │   └── csrf-token.util.ts               ← 新增：token 生成（纯函数）
│   ├── audit/
│   │   └── authz-audit.service.ts           ← 新增：actor 审计
│   └── authz.module.ts
├── ws/
│   └── ws-reauth.guard.ts                   ← 新增：WS 连接级重鉴权
└── main.ts                                  ← 挂 csrf middleware
```

### 5.3 v3 完整代码

#### 5.3.1 policy 层：policy.types.ts

```typescript
import type { Actor, UserRole } from '../../auth/dto/actor.types'

// 被保护资源的最小抽象：谁拥有它、什么类型
export interface ProtectedResource {
  kind: 'conversation' | 'anomaly' | 'diagnosis'
  ownerId: string        // 资源属主的 userId
  id: string
}

export type PolicyAction = 'read' | 'write' | 'delete' | 'approve'

export interface PolicyInput {
  actor: Actor
  resource: ProtectedResource
  action: PolicyAction
}

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string }
```

#### 5.3.2 policy 层：resource-policy.ts（纯函数策略引擎）

```typescript
import type { PolicyInput, PolicyDecision, PolicyAction } from './policy.types'
import type { UserRole } from '../../auth/dto/actor.types'

// 角色能执行的动作上限（RBAC 部分）
const ROLE_ACTIONS: Record<UserRole, ReadonlySet<PolicyAction>> = {
  admin: new Set(['read', 'write', 'delete', 'approve']),
  operator: new Set(['read', 'write', 'approve']),
  viewer: new Set(['read']),
}

/**
 * 资源级授权决策 —— 纯函数。
 * 规则组合（先 RBAC 后 ABAC）：
 *   1. 动作必须在角色能力范围内（RBAC）
 *   2. admin 可跨资源；其余角色只能操作自己拥有的资源（ABAC）
 * 相同输入永远相同输出，不查 DB、不读全局状态。
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { actor, resource, action } = input

  // 规则 1：RBAC —— 角色是否有该动作能力
  const allowedActions = ROLE_ACTIONS[actor.role]
  if (!allowedActions.has(action)) {
    return { allow: false, reason: `role ${actor.role} cannot ${action}` }
  }

  // 规则 2：ABAC —— admin 放行跨资源
  if (actor.role === 'admin') {
    return { allow: true }
  }

  // 规则 3：ABAC —— 非 admin 必须是资源属主
  if (resource.ownerId !== actor.userId) {
    return {
      allow: false,
      reason: `actor ${actor.userId} is not owner of ${resource.kind}:${resource.id}`,
    }
  }

  return { allow: true }
}
```

#### 5.3.3 policy 层：resource-policy.spec.ts（穷举测试）

```typescript
import { describe, it, expect } from 'vitest'
import { evaluatePolicy } from './resource-policy'
import type { Actor } from '../../auth/dto/actor.types'
import type { ProtectedResource, PolicyAction } from './policy.types'

const actor = (role: Actor['role'], userId: string): Actor =>
  ({ userId, role, tenantId: 't-1' } as Actor)

const resource = (ownerId: string): ProtectedResource =>
  ({ kind: 'conversation', ownerId, id: 'c-1' })

describe('evaluatePolicy', () => {
  it('admin 可跨资源删除', () => {
    const d = evaluatePolicy({ actor: actor('admin', 'u-admin'), resource: resource('u-other'), action: 'delete' })
    expect(d.allow).toBe(true)
  })

  it('operator 不能删除（RBAC 拦截）', () => {
    const d = evaluatePolicy({ actor: actor('operator', 'u-1'), resource: resource('u-1'), action: 'delete' })
    expect(d.allow).toBe(false)
    if (!d.allow) expect(d.reason).toContain('cannot delete')
  })

  it('operator 读自己的会话放行', () => {
    const d = evaluatePolicy({ actor: actor('operator', 'u-1'), resource: resource('u-1'), action: 'read' })
    expect(d.allow).toBe(true)
  })

  it('operator 读他人会话拒绝（IDOR 修复核心）', () => {
    const d = evaluatePolicy({ actor: actor('operator', 'u-1'), resource: resource('u-2'), action: 'read' })
    expect(d.allow).toBe(false)
    if (!d.allow) expect(d.reason).toContain('not owner')
  })

  it('viewer 只能读，写被 RBAC 拦截', () => {
    const d = evaluatePolicy({ actor: actor('viewer', 'u-1'), resource: resource('u-1'), action: 'write' })
    expect(d.allow).toBe(false)
  })

  // 穷举 3 角色 × 4 动作 × {自己/他人} = 24 组合的快照
  it('24 组合决策矩阵稳定', () => {
    const roles: Actor['role'][] = ['admin', 'operator', 'viewer']
    const actions: PolicyAction[] = ['read', 'write', 'delete', 'approve']
    const matrix: Record<string, boolean> = {}
    for (const role of roles) {
      for (const action of actions) {
        for (const own of [true, false]) {
          const ownerId = own ? 'u-self' : 'u-other'
          const d = evaluatePolicy({ actor: actor(role, 'u-self'), resource: resource(ownerId), action })
          matrix[`${role}:${action}:${own ? 'self' : 'other'}`] = d.allow
        }
      }
    }
    // admin 全放行
    expect(matrix['admin:delete:other']).toBe(true)
    // operator 自己可写，他人不可
    expect(matrix['operator:write:self']).toBe(true)
    expect(matrix['operator:write:other']).toBe(false)
    // viewer 自己也不能写
    expect(matrix['viewer:write:self']).toBe(false)
  })
})
```

#### 5.3.4 policy 层：resource-authz.guard.ts

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common'
import { evaluatePolicy } from './resource-policy'
import type { PolicyAction, ProtectedResource } from './policy.types'
import type { Actor } from '../../auth/dto/actor.types'
import { ResourceLoaderRegistry } from './resource-loader.registry'
import { AuthzAuditService } from '../audit/authz-audit.service'
import { Reflector } from '@nestjs/core'

// 接口用 @RequirePolicy('conversation', 'read') 声明
export const POLICY_KEY = 'policy'

@Injectable()
export class ResourceAuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly loaders: ResourceLoaderRegistry,
    private readonly audit: AuthzAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<{ kind: ProtectedResource['kind']; action: PolicyAction }>(
      POLICY_KEY,
      context.getHandler(),
    )
    if (!meta) return true   // 未声明策略的接口不做资源级检查

    const req = context.switchToHttp().getRequest()
    const actor = req.user as Actor
    const resourceId = req.params.id

    // 加载资源属主（唯一一次 DB 访问，Guard 之外全是纯函数）
    const loader = this.loaders.get(meta.kind)
    const resource = await loader.load(resourceId)
    if (!resource) {
      // 注意：对无权访问的资源，也可以返回 404 避免资源存在性泄漏
      throw new NotFoundException(`${meta.kind} not found`)
    }

    const decision = evaluatePolicy({ actor, resource, action: meta.action })

    // 高风险动作无论允许/拒绝都审计
    if (meta.action === 'delete' || meta.action === 'approve') {
      await this.audit.record({
        actorId: actor.userId,
        action: meta.action,
        resourceKind: meta.kind,
        resourceId,
        allowed: decision.allow,
        reason: decision.allow ? 'ok' : decision.reason,
      })
    }

    if (!decision.allow) {
      throw new ForbiddenException(decision.reason)
    }
    return true
  }
}
```

#### 5.3.5 csrf 层：csrf-token.util.ts（纯函数）

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * double-submit CSRF token：
 *   - 生成：HMAC(sessionId, secret) 作为 token，随 Set-Cookie 下发（非 httpOnly，前端可读）
 *   - 校验：前端把 cookie 里的 token 复制到 X-CSRF-Token 头；服务端比对两者一致
 * 攻击站点能诱导浏览器带 Cookie，但读不到 Cookie 值（跨站），也就无法伪造头。
 */
export function generateCsrfToken(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('hex')
}

export function verifyCsrfToken(cookieToken: string, headerToken: string): boolean {
  if (!cookieToken || !headerToken) return false
  const a = Buffer.from(cookieToken)
  const b = Buffer.from(headerToken)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)    // 常量时间比较，防时序侧信道
}
```

#### 5.3.6 csrf 层：csrf.middleware.ts

```typescript
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import { verifyCsrfToken } from './csrf-token.util'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 只读方法不改状态，跳过 CSRF 校验
    if (SAFE_METHODS.has(req.method)) return next()

    const cookieToken = req.cookies?.['csrf_token'] ?? ''
    const headerToken = (req.headers['x-csrf-token'] as string) ?? ''

    if (!verifyCsrfToken(cookieToken, headerToken)) {
      throw new ForbiddenException('csrf token mismatch')
    }
    next()
  }
}
```

#### 5.3.7 ws 层：ws-reauth.guard.ts（连接级重鉴权）

```typescript
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

/**
 * WS 连接级重鉴权：
 *   握手时验一次 token；之后每 60 秒 tick 检查 exp。
 *   过期立即断连——避免"登录后长连接绕过 token 过期"。
 */
@Injectable()
export class WsReauthGuard {
  constructor(private readonly jwt: JwtService) {}

  // 网关在 handleConnection 时调用，返回 payload 或抛错断连
  verifyHandshake(token: string): { userId: string; exp: number } {
    const payload = this.jwt.verify<{ sub: string; exp: number }>(token)
    return { userId: payload.sub, exp: payload.exp }
  }

  // 定时器每 60s 调用；exp 是秒级时间戳
  isStillValid(exp: number, nowMs = Date.now()): boolean {
    return exp * 1000 > nowMs
  }
}
```

#### 5.3.8 audit 层：authz-audit.service.ts

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface AuthzAuditEntry {
  actorId: string
  action: string
  resourceKind: string
  resourceId: string
  allowed: boolean
  reason: string
}

@Injectable()
export class AuthzAuditService {
  private readonly logger = new Logger(AuthzAuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuthzAuditEntry): Promise<void> {
    // 结构化审计日志 + 落库（authz_audit 表）
    this.logger.log(
      `authz actor=${entry.actorId} action=${entry.action} ` +
      `resource=${entry.resourceKind}:${entry.resourceId} allowed=${entry.allowed}`,
    )
    await this.prisma.authzAudit.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        resourceKind: entry.resourceKind,
        resourceId: entry.resourceId,
        allowed: entry.allowed,
        reason: entry.reason,
      },
    })
  }
}
```

#### 5.3.9 controller 接入（v3 关键改动）

```typescript
import { Controller, Get, Delete, Param, UseGuards, SetMetadata } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ResourceAuthzGuard, POLICY_KEY } from '../authz/policy/resource-authz.guard'

// 便捷装饰器
const RequirePolicy = (kind: string, action: string) =>
  SetMetadata(POLICY_KEY, { kind, action })

@Controller('conversations')
@UseGuards(JwtAuthGuard, ResourceAuthzGuard)   // 先认证，再资源级授权
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @RequirePolicy('conversation', 'read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @RequirePolicy('conversation', 'delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：认证（Authentication）vs 授权（Authorization）**
- 解决的问题：把"你是谁"和"你能做什么"分开——混在一起时，验证通过的用户被默认放行所有操作，IDOR 由此而来
- 运行机制：`JwtAuthGuard` 只解析 token → 得到 `actor`（认证）；`ResourceAuthzGuard` 用 `actor` + 资源 + 动作决策（授权）；两个 Guard 顺序执行
- 项目落点：`jwt-auth.guard.ts`（认证）与 `resource-authz.guard.ts`（授权）物理分离
- 生产误区：认证通过就默认授权；把角色塞进 JWT 后不再校验资源属主（token 里的 role 是登录那一刻的，资源归属是运行时的）
- 验证方法：跨用户读写矩阵——operator-A 带合法 token 读 operator-B 的资源，认证通过但授权必须 403

**知识点 2：RBAC vs ABAC —— 横向门槛 vs 资源属性**
- 解决的问题：RBAC 只按角色划分（admin/operator/viewer），挡不住"同角色不同资源"；ABAC 按资源属性（ownerId、tenantId）决策
- 运行机制：`evaluatePolicy` 先做 RBAC（`ROLE_ACTIONS` 查角色能力），再做 ABAC（`resource.ownerId === actor.userId`）；两层叠加
- 项目落点：`resource-policy.ts` 的规则 1（RBAC）+ 规则 2/3（ABAC）
- 生产误区：只做 RBAC 就以为防住了越权（IDOR 的典型成因）；ABAC 规则散在各 service 里无法统一测试
- 验证方法：`resource-policy.spec.ts` 的 24 组合矩阵，特别是 `operator:read:other` 必须 deny

**知识点 3：IDOR（不安全的直接对象引用）与 404 vs 403 的选择**
- 解决的问题：用户改 URL 里的资源 id 访问他人资源；返回 403 会泄漏"该资源存在"，返回 404 则连存在性都不暴露
- 运行机制：`ResourceAuthzGuard` 先 `loader.load(id)` 拿属主，再 `evaluatePolicy`；无权时可选择返回 404
- 项目落点：`resource-authz.guard.ts` 的 `NotFoundException` vs `ForbiddenException` 分支
- 生产误区：前端隐藏菜单当成防护（前端只是 UX，API 才是边界）；对无权资源返回 403 泄漏存在性
- 验证方法：改 URL 里的 anomalyId/conversationId 访问他人资源，断言 403/404 且响应体不含资源内容

**知识点 4：CSRF 与 double-submit token**
- 解决的问题：攻击站点诱导浏览器自动带 Cookie 发起状态变更请求；SameSite 是第一道防线，double-submit 是纵深防御
- 运行机制：token = HMAC(sessionId, secret) 写入非 httpOnly Cookie；前端 JS 读 Cookie 复制到 `X-CSRF-Token` 头；服务端比对——跨站脚本读不到 Cookie 值就伪造不出头
- 项目落点：`csrf-token.util.ts`（生成/校验，`timingSafeEqual` 常量时间比较）+ `csrf.middleware.ts`（只拦非安全方法）
- 生产误区：把 CSRF token 存 httpOnly Cookie（前端读不到就没法回传）；用 `===` 比较 token（时序侧信道）；GET 也校验 CSRF（只读不改状态，没必要）
- 验证方法：构造无 `X-CSRF-Token` 头的 POST 请求，断言 403；头与 Cookie 不一致也 403

**知识点 5：JWT 过期与 WS 连接级重鉴权**
- 解决的问题：HTTP 每次请求都带 token 天然重鉴权，但 WS 是长连接，握手后不再验 token——过期 token 可继续用几十分钟
- 运行机制：握手 `verifyHandshake` 验一次；连接期间每 60s tick `isStillValid(exp)`，过期立即 `disconnect`
- 项目落点：`ws-reauth.guard.ts` 的 `verifyHandshake` + `isStillValid`
- 生产误区：WS 只在握手验 token 之后永不复查；用客户端上报的时间判断过期（客户端可篡改，必须服务端 `Date.now()`）
- 验证方法：建立 WS 连接后把系统时间推进到 token exp 之后，断言下一个 tick 触发断连

**知识点 6：actor 审计（谁/何时/对何资源/结果）**
- 解决的问题：高风险操作（delete/approve）出事后需要追溯"谁做的、当时是否被允许、为什么"
- 运行机制：`ResourceAuthzGuard` 在 delete/approve 分支无论 allow/deny 都调 `audit.record`；结构化日志 + 落库
- 项目落点：`authz-audit.service.ts`，只审计高风险动作（read 太频繁不审计）
- 生产误区：只审计成功操作（被拒绝的越权尝试才是攻击信号）；审计日志里记明文 token/密码（脱敏红线，见 Day18）
- 验证方法：执行一次被拒绝的 delete，断言 `authz_audit` 表新增一条 `allowed=false` 记录

### 5.5 边写边问自己

- 为什么 `evaluatePolicy` 不查 DB？（纯函数才能穷举 24 组合；DB 访问留在 Guard 一处）
- CSRF 校验为什么放 middleware 而不是 Guard？（middleware 在路由匹配前跑，对所有状态变更请求统一生效；Guard 是接口级的，容易漏挂）
- 为什么对无权资源返回 404 而不是 403？（避免资源存在性泄漏——攻击者遍历 id 时连"哪些 id 存在"都探测不到）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | JWT 登录 + 认证 | v1 + RBAC 角色守卫 | v2 + 资源级 ABAC + CSRF + WS 重鉴权 + 审计 |
| **认证/授权模型** | 只认证（谁是你） | 认证 + 角色授权（RBAC） | 认证 + RBAC + ABAC（资源属主） |
| **越权防护** | 无（IDOR 敞开） | 挡跨角色，挡不住同角色跨资源 | 跨用户读写全 403/404 |
| **授权逻辑位置** | 无 | `roles.guard.ts` 角色比对 | `resource-policy.ts` 纯函数策略引擎 |
| **可测试** | 登录 e2e | 角色 Guard 单测 | 24 组合决策矩阵穷举 |
| **CSRF 防护** | 无 | 无 | double-submit token + SameSite |
| **WS 鉴权** | 握手一次，永不复查 | 握手一次 | 每 60s 重鉴权，过期断连 |
| **审计** | 无 | 无 | delete/approve 全 actor 审计（含被拒） |
| **对齐后续 Day** | — | — | Day 30 M3 门禁要求跨用户隔离 e2e 全绿 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的深挖 HTML 是 `Day24深挖-前端底子补弱.html`，围绕鉴权在**前端侧**的边界与误区展开。

深挖主题：

1. **深挖 1：为什么前端隐藏菜单不能防越权** —— 从 `v-if="user.role === 'admin'"` 讲起，展示 DevTools 改 `role`、直接 `fetch` API、改 URL 三种绕过，证明前端只是 UX、API 才是安全边界
2. **深挖 2：Token 存哪里** —— localStorage（防 CSRF 但怕 XSS）vs httpOnly Cookie（防 XSS 但需防 CSRF）的权衡矩阵，以及 double-submit 如何补 Cookie 方案的短板
3. **深挖 3：SameSite Cookie 三档取值** —— `Strict/Lax/None` 对跨站请求携带 Cookie 的影响，配合 CSRF token 的纵深防御

深挖 HTML 遵循 §6.1 的 8 子节结构（场景锚点/项目代码/设计点拆解/原理/反例/分层提问/项目对手戏/面试真题三档答法）。

**动手前先问自己**（深挖里会回答）：

- 如果 token 存 localStorage，XSS 打进来能做什么？（读走 token 冒充用户，比 CSRF 更致命）
- SameSite=Lax 时，攻击站点的表单 POST 还能带上我的 Cookie 吗？（不能，Lax 已挡跨站 POST；但 GET 导航仍带，所以状态变更绝不能用 GET）

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

按第 5.3 节写完策略引擎后，补齐三组测试：

1. **`resource-policy.spec.ts`**（策略引擎，§5.3.3）——重点是 24 组合矩阵 + `operator:read:other` 必须 deny
2. **`csrf-token.util.spec.ts`**——生成的 token 可被 `verifyCsrfToken` 校验通过；篡改一个字符即失败；长度不等直接 false
3. **`ws-reauth.guard.spec.ts`**——`isStillValid` 在 exp 之前返回 true、之后返回 false（用固定 `nowMs` 参数，不依赖真实时钟）

```bash
pnpm --filter api test authz
```

预期：15 个用例全绿（策略 6 + csrf 4 + ws 5）。

### 7.7 F-1：反证实验 1（5 分钟）—— 关掉资源级 Guard 看 IDOR

临时把 `ConversationsController` 上的 `ResourceAuthzGuard` 注释掉，只留 `JwtAuthGuard`：

```typescript
@UseGuards(JwtAuthGuard)   // 故意删掉 ResourceAuthzGuard
```

用 operator-A 的 token 请求 operator-B 的会话 `GET /conversations/<B的会话id>`：

- **现象**：返回 200 + operator-B 的会话内容——这就是 IDOR，认证通过但没做资源授权
- **结论**：认证 ≠ 授权；前端隐藏入口挡不住直接调 API
- 记录到学习日志，然后**改回来**

### 7.8 F-2：反证实验 2（5 分钟）—— 去掉 CSRF 校验

临时在 `csrf.middleware.ts` 里直接 `return next()` 跳过校验，构造一个不带 `X-CSRF-Token` 头的 POST：

```bash
curl -X POST http://localhost:3000/conversations/c-1/archive \
  -H "Cookie: access_token=<合法token>" \
  # 故意不带 X-CSRF-Token
```

- **现象**：跳过校验时请求成功——模拟攻击站点用受害者 Cookie 发起的跨站状态变更
- **结论**：SameSite 是第一道线，double-submit token 是第二道；两者都要有
- 记录后**改回来**

### 7.9 F-3：验证 + 提交（10 分钟）

四件套：

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test && pnpm --filter api build
```

Conventional Commits 提交模板：

```
feat(authz): 资源级 ABAC + CSRF 防护 + WS 重鉴权 + actor 审计

- 新增 resource-policy 纯函数策略引擎（RBAC + ABAC 两层）
- 新增 ResourceAuthzGuard 修复 IDOR，跨用户读写全 403/404
- 新增 CSRF double-submit middleware
- 新增 WS 连接级 60s 重鉴权
- 高风险操作 actor 审计落库
- 24 组合决策矩阵测试 + CSRF/WS 单测全绿

Refs: Day24
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day25 结束时集中 push。

**⚠️ 密钥红线**：`JWT_SECRET`、CSRF `secret` 必须走 `@nestjs/config` 从环境变量读取，**绝不硬编码进代码或提交进仓库**。检查 `.env` 是否已在 `.gitignore` 里；如果这次动到了任何密钥/token，务必提醒自己 review diff 不含明文密钥。

---

## 8. 通过标准

- [ ] 跨用户读写矩阵全部失败：operator-A 读/写/删 operator-B 的资源全 403 或 404
- [ ] `resource-policy.spec.ts` 24 组合矩阵全绿，`operator:read:other` = deny
- [ ] CSRF：缺 `X-CSRF-Token` 头或与 Cookie 不一致的状态变更请求返回 403
- [ ] WS：token 过期后下一个 60s tick 断连
- [ ] 敏感操作（delete/approve）有 actor 审计，含被拒绝的尝试
- [ ] 四件套全绿，commit 含 `Refs: Day24`，未执行 `git push`
- [ ] diff 中无硬编码密钥/token

---

## 9. 提交物

1. commit（含 `Refs: Day24`，未执行 `git push`）
2. 测试输出：`pnpm --filter api test authz` 15 个用例全绿截图/文本
3. 学习日志：两个反证实验（IDOR、CSRF）的现象记录
4. 架构证据：授权矩阵表（3 角色 × 4 动作 × {自己/他人}）+ 认证/授权 Threat Model
5. AI Review 记录：Guard/策略引擎哪些是 AI 生成、哪些人工修改，接受/拒绝理由

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（HTTP 请求带 token）到最终输出（403/200），解释鉴权/权限的控制流；知识链"Session/JWT → RBAC/ABAC → 资源授权 → CSRF → 审计"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除 `ResourceAuthzGuard`（只留认证），线上会出现什么可观察现象？请给出最小复现（改 URL 里的 id）、定位证据（actor vs resource owner）、恢复动作和一条防复发测试。
3. 请引用今天的 `resource-policy.ts`、24 组合矩阵测试和授权矩阵，证明跨用户隔离已达成；再说明距离企业生产标准还缺什么（如租户级隔离、字段级权限、审批链），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 用户 A 修改 URL 中的 anomalyId 后读到用户 B 的诊断；菜单已隐藏但 API 未做资源授权。请用 actor、resource owner、Guard 决策和 SQL 条件定位 IDOR；先关闭详情接口止损，再实现资源级 RBAC/ABAC 和审计，跨用户读写矩阵验证全部拒绝。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S26 NestJS authentication](https://docs.nestjs.com/security/authentication)
2. 登录 Cookie 未设 SameSite，攻击站点可触发高风险批准；过期 JWT 又被 WS 长连接继续接受 30 分钟。请用 Origin、token exp、握手和审批日志定位；先撤销会话并关闭写操作止损，再修复 CSRF 与连接重鉴权，验证伪造、过期、重放均失败。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S30 OWASP GenAI](https://genai.owasp.org/)

知识映射：Session/JWT、RBAC/ABAC、资源授权、CSRF 和 actor 审计。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 如何防范 XSS 和 CSRF？Token 存在 LocalStorage 能防 CSRF 吗？
   来源：《2026美团前端全栈开发》，第 8 页。
2. 为什么 JWT 相对 Session 更有优势？
   来源：《2026美团前端架构师面试-数据权限方向》，第 10 页。

题目说明：覆盖 Session/JWT、CSRF 与认证基础；回答必须进一步区分认证、RBAC/ABAC 和资源级授权——第一题 LocalStorage 存 token 确实防 CSRF（不自动携带），但怕 XSS；第二题要补充 JWT 无状态的代价（无法即时吊销，需短 exp + refresh）。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 17（HITL 服务端权威审批）——今天把"服务端权威"扩展成完整的认证 + 授权体系；Day 23（数据建模的 ownerId/tenantId 字段）是 ABAC 的数据基础
- **本日产出**：资源级 ABAC 策略引擎 + CSRF + WS 重鉴权 + actor 审计，是 p1-monitor 的安全边界地基
- **指向**：Day 30（M3 门禁）会要求"跨用户隔离 e2e 全绿、越权尝试全审计"；阶段三 p2-agent-workbench 多 Agent 协同时，多租户隔离直接复用今天的策略引擎模式
- **对齐**：与 Day 18（脱敏）、Day 22（统一错误 DTO，403 的错误合同）、Day 16（前端 XSS）共同构成安全纵深
