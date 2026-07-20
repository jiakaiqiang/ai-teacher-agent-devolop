# Day 38 - 稳定性：分层韧性策略

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

日期与时长：2026-08-20 周四，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日目录结构（先看全局，再写代码）**
>
> ```
> apps/api/src/resilience/
> ├── resilience.module.ts              ← 样板：模块聚合
> ├── timeout/
> │   ├── timeout-budget.ts             ← 核心：你手写（超时预算分配）
> │   ├── deadline.ts                   ← 核心：你手写（deadline 传播）
> │   └── timeout.interceptor.ts        ← 核心：你手写（拦截器强制超时）
> ├── retry/
> │   ├── retry-policy.ts               ← 核心：你手写（有限重试 + 退避）
> │   ├── retry-classifier.ts           ← 核心：你手写（可重试 vs 不可重试）
> │   └── retry-budget.ts               ← 核心：你手写（重试预算，防风暴）
> ├── circuit-breaker/
> │   ├── circuit-breaker.ts            ← 核心：你手写（三态状态机）
> │   ├── circuit-state.ts              ← 样板：状态枚举
> │   └── breaker-registry.ts           ← 核心：你手写（按依赖注册）
> ├── bulkhead/
> │   ├── bulkhead.ts                   ← 核心：你手写（并发槽位隔离）
> │   └── bulkhead-config.ts            ← 样板：各依赖槽位配置
> ├── fallback/
> │   ├── fallback-registry.ts          ← 核心：你手写（降级策略注册）
> │   └── degraded-response.ts          ← 样板：降级响应结构
> └── __tests__/
>     ├── circuit-breaker.spec.ts
>     ├── retry-policy.spec.ts
>     └── resilience.e2e-spec.ts
>
> apps/web/src/components/
> ├── DegradedBanner.vue                ← 核心：你手写（降级状态提示）
> └── RetryIndicator.vue                ← 核心：你手写（重试进度）
> ```
>
> 说明：`resilience/` 是本日新增的独立模块，它横切在模型调用、Tool 执行、DB/Redis 访问之上。核心韧性算法（超时预算、重试分类、熔断状态机、舱壁隔离）是本日学习灵魂，我只给结构+原理+伪代码，代码请你手写。

## §0 今天在 90 天里的位置

**阶段二第 8 天。** 前七天你把系统从"能跑"推到"跑得快、看得见、守得住"：

- Day31-33：可持久化 HITL（审批状态机 + 租约 + 队列恢复）
- Day34：失败恢复（错误分类 + DLQ + 补偿 + 重放）
- Day35：可观测性（Trace 贯穿 + PII 脱敏 + 采样）
- Day36：API 安全（CORS/上传/注入/限流/错误脱敏）
- Day37：性能（query plan + 索引 + 连接池 + 缓存 + 背压）

**今天要解决的 5 个稳定性问题：**

1. **无限等待**：模型 Provider 卡住不返回，请求线程被永久占用，级联到整个服务不可用。
2. **重试风暴**：三层各自重试 3 次，一个用户请求放大成 27 次调用，成本翻 11 倍，把下游打死。
3. **单点拖垮全局**：Redis 故障，连健康的 Tool 也被阻塞，队列积压 4 万。
4. **不可重试错误也重试**：400 参数错误重试 3 次仍然失败，纯粹浪费资源和时间。
5. **降级不透明**：模型不可用时前端一直转圈，用户不知道发生了什么，也没有降级路径。

Day34 的失败恢复解决的是"任务失败后怎么补救"，今天解决的是"依赖抖动时怎么不被拖垮"——一个是事后，一个是事中。两者叠加才是完整的容错。

## §1 今天要做的事

### 1.1 五个真实用户场景

| # | 场景 | 没有韧性策略会怎样 | 有了之后 |
|---|------|-------------------|---------|
| 1 | 用户提问，模型 Provider 响应变慢到 30s | 请求线程一直等，并发上来后线程池耗尽，所有用户 503 | 超时预算 8s 触发，快速失败并降级 |
| 2 | Provider 连续返回 429 限流 | 三层重试放大成 27 次调用，成本炸弹 | 重试预算 + 熔断，几次失败后直接熔断，停止无谓调用 |
| 3 | Redis 宕机 12 分钟 | Tool 状态缓存拿不到，连健康 Tool 也卡住，队列积压 | 舱壁隔离 Redis 依赖，切只读降级，健康 Tool 不受影响 |
| 4 | 用户传了非法参数（400） | 系统还重试 3 次，浪费 3 倍资源 | 重试分类器识别不可重试错误，直接返回 |
| 5 | 模型完全不可用 | 前端一直转圈，用户困惑 | 降级到"暂时无法生成，已记录"，UI 明确提示 |

### 1.2 模块职责划分

- **timeout（超时预算）**：给每个请求分配总时间预算，逐层递减传播 deadline，超时立即失败。
- **retry（有限重试）**：只对可重试错误重试，指数退避 + 抖动，全局重试预算防风暴。
- **circuit-breaker（熔断器）**：某依赖连续失败到阈值就"跳闸"，一段时间内直接快速失败，探测恢复后再放行。
- **bulkhead（舱壁）**：给每个依赖分配独立的并发槽位，一个依赖打满不影响其他依赖。
- **fallback（降级）**：主路径失败时走备用路径（缓存旧值/默认值/排队稍后处理），并告知前端。

### 1.3 三版演进

**v1（最小可用）：全局固定超时 + 简单重试**
- 给所有外部调用套一个固定 10s 超时，失败就重试 3 次。
- 致命问题：所有依赖用同一个超时（DB 查询和模型调用需求完全不同）；重试不分错误类型；多层重试叠加放大；没有熔断，依赖挂了还在无谓重试。

**v2（加防护层）：分层超时 + 重试分类 + 熔断**
- 每个依赖独立超时；重试前先分类（可重试才重试）；给每个依赖加熔断器。
- 解决了盲目重试和无差别超时，但还缺：重试预算（多个熔断器仍可能各自放大）；舱壁（一个依赖慢仍会占满线程）；降级 UX。

**v3（生产级）：超时预算传播 + 重试预算 + 舱壁 + 降级**
- deadline 从入口逐层传播（下游拿到的是"剩余可用时间"）；全局重试预算（滑动窗口，超预算停止所有重试）；舱壁隔离并发；主路径失败走降级并通知前端。

### 1.4 目录结构（5 个维度完整展示）

**维度 1：模块在整个 apps/api 里的位置**

```
apps/api/src/
├── model/                    ← Day29 模型调用（今天要包上韧性）
├── tools/                    ← Day30 Tool 执行（今天要包上韧性）
├── prisma/                   ← DB 访问（今天要包上韧性）
├── redis/                    ← 缓存访问（今天要包上韧性）
├── resilience/               ← 【本日新增】横切韧性模块
│   ├── resilience.module.ts
│   ├── timeout/
│   ├── retry/
│   ├── circuit-breaker/
│   ├── bulkhead/
│   └── fallback/
└── app.module.ts
```

**维度 2：一次模型调用穿过的韧性层（从外到内）**

```
Controller
  → TimeoutInterceptor（分配总预算 8s）
    → Bulkhead.acquire('model')（占一个并发槽位）
      → CircuitBreaker.execute('model')（检查熔断器状态）
        → RetryPolicy.run（可重试才重试 + 退避 + 预算检查）
          → 实际模型调用（带剩余 deadline）
        ← 失败 → FallbackRegistry.get('model')（降级）
```

**维度 3：依赖箭头（谁依赖谁）**

```
TimeoutInterceptor ──uses──> DeadlinePropagator
RetryPolicy ──uses──> RetryClassifier + RetryBudget
CircuitBreaker ──registered in──> BreakerRegistry
Bulkhead ──configured by──> BulkheadConfig
FallbackRegistry ──notifies──> 前端 DegradedBanner（通过响应字段）
```

**维度 4：与前几天的关系（diff 视角）**

| 文件 | Day37 状态 | Day38 改动 |
|------|-----------|-----------|
| `model/model.service.ts` | 直接调 Provider | 包在 resilience 层内 |
| `tools/tool-executor.ts` | 直接执行 | 加 bulkhead + 熔断 |
| `prisma/*`、`redis/*` | 裸调用 | 加分层超时 + 舱壁 |
| `resilience/**` | 不存在 | 全新模块 |
| `web/components/DegradedBanner.vue` | 不存在 | 降级提示组件 |

**维度 5：三个灵魂问题（写代码前先答）**

1. **为什么超时预算要"传播"而不是每层各设固定值？** 如果入口给 8s，DB 层又设自己的 5s，模型层设 6s，那么当 DB 已经花了 4s，模型层还以为自己有 6s，实际总预算早就该到期了。deadline 传播让每一层拿到的是"还剩多少时间"，而不是"我最多能用多久"。
2. **熔断器为什么需要"半开"状态？** 如果只有开/关两态，熔断后怎么知道依赖恢复了？半开态允许放行少量试探请求，成功则关闭熔断恢复正常，失败则继续熔断。这是自愈的关键。
3. **舱壁和熔断有什么区别？** 熔断是"依赖已经坏了就别调了"（基于失败率）；舱壁是"就算依赖没坏，也限制它最多占多少并发槽位"（基于资源隔离）。一个防"调坏的"，一个防"拖慢的"。

### 1.5 今天动手前的脚手架检查

```bash
# 1. 确认 resilience 模块目录不存在（本日新建）
ls apps/api/src/resilience 2>/dev/null && echo "已存在，检查是否残留" || echo "OK，全新"

# 2. 确认前几天的依赖点还在
ls apps/api/src/model/model.service.ts
ls apps/api/src/tools/tool-executor.ts

# 3. 韧性策略不需要新表，但需要指标记录（关联 Day35 可观测性）
# 熔断状态、重试次数、降级次数都要能在 Trace 里看到
```

**样板代码（可直接用）——resilience.module.ts 骨架：**

```typescript
// apps/api/src/resilience/resilience.module.ts
import { Module, Global } from '@nestjs/common'
// 这是模块聚合样板，具体 Provider 由你手写后在这里注册
@Global()
@Module({
  providers: [/* TimeoutInterceptor, RetryPolicy, BreakerRegistry, ... 你手写后填入 */],
  exports: [/* 供其他模块注入 */],
})
export class ResilienceModule {}
```

**样板代码——circuit-state.ts 枚举：**

```typescript
// apps/api/src/resilience/circuit-breaker/circuit-state.ts
export enum CircuitState {
  CLOSED = 'closed',      // 正常放行
  OPEN = 'open',          // 熔断，快速失败
  HALF_OPEN = 'half_open' // 半开，试探恢复
}
```

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

> 本日严格执行 3h 标准时间盒，前 90 分钟只读，后 90 分钟完成项目增量、测试和证据。

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理与源码 | 90 min | 读 timeout budget / 有限重试 / 熔断三态 / bulkhead / 降级机制，画 failure budget 图 |
| v2 增量 | 25 min | 分层超时 + 重试分类器 + 熔断器 |
| v3 增量 | 35 min | deadline 传播 + 重试预算 + 舱壁 + 降级提示 |
| 测试/故障注入 | 20 min | 注入 429、依赖宕机和超时，完成两个反证实验 |
| 架构证据 + 复盘 | 10 min | failure budget 图 + AI Review 记录 |

## §3 v1：全局固定超时 + 简单重试（最小可用）

v1 是你 Day29 调模型时最朴素的写法：套个超时，失败就重试几次。

```typescript
// v1 的朴素写法（apps/api/src/model/model.service.ts 早期版本）
async callModel(prompt: string): Promise<string> {
  const TIMEOUT = 10000  // 所有调用都用 10s
  const MAX_RETRY = 3
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      return await Promise.race([
        this.provider.chat(prompt),
        this.timeout(TIMEOUT),
      ])
    } catch (err) {
      if (i === MAX_RETRY - 1) throw err
      await this.sleep(1000)  // 固定间隔重试
    }
  }
}
```

**v1 的 5 个致命问题：**

1. **无差别超时**：DB 查询 50ms 就该返回，模型调用可能要 5s，用同一个 10s 超时，要么 DB 卡死没及时发现，要么模型被误杀。
2. **不分错误类型**：400 参数错误也重试 3 次，纯浪费。
3. **多层重试叠加**：如果 Controller、Service、Provider 客户端各自重试 3 次，实际放大成 3×3×3=27 次。
4. **没有熔断**：Provider 已经挂了，还在一次次重试，把自己和下游都拖死。
5. **固定间隔重试**：1000 个请求同时失败，1 秒后又同时重试，形成"惊群"，把刚恢复的依赖再次打死。

这 5 个问题正好对应今天要学的 5 个知识点。v2、v3 逐个解决。

## §4 v2：分层超时 + 重试分类器 + 熔断器（加防护层）

v2 解决 v1 的前三个问题：无差别超时、不分错误类型、没有熔断。这三块里，重试分类和熔断状态机是核心业务逻辑，我给结构、原理和伪代码，代码请你手写。

### 4.1 v2 的目录增量

```
apps/api/src/resilience/
├── timeout/
│   ├── timeout.config.ts        ← 样板：各依赖的超时表
│   └── layered-timeout.ts       ← 核心：你手写（分层超时应用）
├── retry/
│   ├── retry-classifier.ts      ← 核心：你手写（错误分类：可重试/不可重试）
│   ├── retry-policy.ts          ← 核心：你手写（退避 + 有限重试）
│   └── backoff.ts               ← 样板：指数退避 + 抖动计算
└── circuit-breaker/
    ├── circuit-state.ts         ← 样板：三态枚举（上面已给）
    ├── circuit-breaker.ts       ← 核心：你手写（三态状态机）
    └── breaker-registry.ts      ← 核心：你手写（按依赖名管理多个熔断器）
```

### 4.2 分层超时：每个依赖有自己的时间预算

**知识点 1：Timeout Budget（超时预算）**

- **解决什么问题**：不同依赖的正常响应时间差几个数量级。DB 50ms、Redis 5ms、模型 3s、Tool 1s。用统一超时要么误杀快依赖，要么放纵慢依赖。
- **运行机制**：为每类依赖配置独立超时。DB 查询超过 500ms 就该警觉，模型调用给到 8s。超时值来自对该依赖 P99 延迟的观测（关联 Day35 数据）。
- **项目落点**：`timeout.config.ts` 定义超时表，`layered-timeout.ts` 在调用各依赖时套用对应超时。
- **生产误区**：超时值拍脑袋定。应该基于真实 P99 + 缓冲，太紧会误杀正常慢请求，太松则故障发现延迟。
- **验证方法**：注入一个人为延迟的依赖，确认它在配置的超时点被中断，且不影响其他依赖。

```typescript
// 样板：apps/api/src/resilience/timeout/timeout.config.ts
export const TIMEOUT_BUDGET = {
  db: 500,       // DB 查询
  redis: 200,    // Redis 访问
  model: 8000,   // 模型调用
  tool: 5000,    // Tool 执行
  total: 10000,  // 一次请求的总预算
} as const
```

### 4.3 重试分类器：不是所有错误都该重试

**知识点 2：错误分类（可重试 vs 不可重试）**

- **解决什么问题**：400 参数错误、401 鉴权失败重试多少次都没用，只会浪费预算。而 429/503/网络抖动是暂时的，重试有意义。
- **运行机制**：按错误码/类型分类。5xx（除 501）、429、超时、连接重置 → 可重试；4xx（除 429）、业务校验失败 → 不可重试。
- **项目落点**：`retry-classifier.ts`，输入 error，输出是否可重试。
- **生产误区**：把所有异常都当可重试，或把所有异常都当不可重试。要按语义精确分类。
- **验证方法**：分别注入 400 和 503，确认 400 不重试、503 重试。

**你要手写的核心逻辑（伪代码）：**

```
RetryClassifier.isRetryable(error):
  code = extractStatusCode(error)
  # 明确不可重试
  if code in [400, 401, 403, 404, 422]: return false
  # 明确可重试
  if code in [429, 500, 502, 503, 504]: return true
  if error is TimeoutError or ConnectionResetError: return true
  # 未知错误：保守不重试（避免放大未知问题）
  return false
```

### 4.4 有限重试 + 指数退避

**知识点 3：有限重试 + 退避 + 抖动**

- **解决什么问题**：v1 的固定间隔重试会造成惊群。指数退避（1s→2s→4s）+ 随机抖动能把重试请求分散开。
- **运行机制**：第 n 次重试等待 `base * 2^n + random(0, jitter)`。抖动打散同时失败的请求，避免它们同步重试。
- **项目落点**：`retry-policy.ts` 编排重试，`backoff.ts` 计算等待时间。
- **生产误区**：只做指数退避不加抖动——1000 个请求还是会在同一时刻重试。抖动是关键。
- **验证方法**：模拟 100 个并发失败，确认重试时刻被抖动分散，不是同时打出去。

```typescript
// 样板：apps/api/src/resilience/retry/backoff.ts
export function computeBackoff(attempt: number, base = 500, cap = 8000): number {
  const exp = Math.min(base * 2 ** attempt, cap)
  const jitter = Math.random() * exp * 0.3  // 30% 抖动
  return exp + jitter
}
```

**RetryPolicy 你要手写的核心逻辑（伪代码）：**

```
RetryPolicy.run(fn, maxRetries):
  for attempt in 0..maxRetries:
    try:
      return await fn()
    catch error:
      if not RetryClassifier.isRetryable(error): throw error  # 不可重试直接抛
      if attempt == maxRetries: throw error  # 用完次数
      wait = computeBackoff(attempt)
      await sleep(wait)
```

### 4.5 熔断器：依赖挂了就别再调了

**知识点 4：熔断器三态状态机**

- **解决什么问题**：Provider 已经挂了，继续重试只会雪上加霜，还占满连接池。熔断器在失败率超阈值时"跳闸"，快速失败，给依赖喘息时间。
- **运行机制**：三态。CLOSED（正常）统计失败率，超阈值 → OPEN（熔断，直接快速失败）；OPEN 持续一段冷却时间后 → HALF_OPEN（半开，放行少量试探）；试探成功 → CLOSED，失败 → 回到 OPEN。
- **项目落点**：`circuit-breaker.ts` 实现状态机，`breaker-registry.ts` 为每个依赖（model/tool/db/redis）维护独立熔断器。
- **生产误区**：所有依赖共用一个熔断器——模型挂了不该把 DB 也熔断。每个依赖独立。
- **验证方法**：连续注入失败，确认熔断器跳到 OPEN 后请求快速失败（不再真正调用），冷却后进入 HALF_OPEN 试探。

**CircuitBreaker 你要手写的核心逻辑（伪代码）：**

```
CircuitBreaker.execute(fn):
  if state == OPEN:
    if now - openedAt > cooldownMs:
      state = HALF_OPEN  # 冷却结束，试探
    else:
      throw CircuitOpenError  # 快速失败，不调用
  try:
    result = await fn()
    onSuccess()  # HALF_OPEN 成功 → CLOSED；CLOSED 重置计数
    return result
  catch error:
    onFailure()  # 累计失败；超阈值或 HALF_OPEN 失败 → OPEN
    throw error

CircuitBreaker.onFailure():
  failureCount++
  if state == HALF_OPEN: trip()  # 半开试探失败，立即回到 OPEN
  else if failureCount / total >= threshold: trip()

CircuitBreaker.trip():
  state = OPEN
  openedAt = now
```

### 4.6 v2 阶段验证

```bash
# 分层超时：注入慢 DB
# 确认 DB 在 500ms 被中断，模型调用不受影响

# 重试分类：注入 400 vs 503
curl -X POST /run -d '{"trigger":"400"}'  # 期望：不重试，立即返回
curl -X POST /run -d '{"trigger":"503"}'  # 期望：重试 3 次带退避

# 熔断：连续失败
# 连续打 10 次失败请求，确认第 N 次后熔断器 OPEN，后续请求快速失败
```

## §5 v3：舱壁隔离 + 分级降级 + 失败预算（生产级）

v3 是今天的灵魂，解决 v1/v2 都没碰的两块：**一个依赖故障拖垮整个服务**（缺舱壁）和**故障时用户看到的是转圈还是明确降级**（缺降级 UX）。舱壁分配和降级策略是核心业务决策，我给结构、原理和验收标准，代码请你手写。

### 5.1 v3 的目录增量

```
apps/api/src/resilience/
├── bulkhead/
│   ├── bulkhead.ts              ← 核心：你手写（信号量隔离并发槽位）
│   └── bulkhead-registry.ts     ← 核心：你手写（按依赖分配槽位）
├── fallback/
│   ├── fallback-strategy.ts     ← 核心：你手写（分级降级策略）
│   └── degraded-response.ts     ← 样板：降级响应结构
└── budget/
    ├── timeout-budget.ts        ← 核心：你手写（请求级总预算追踪）
    └── failure-budget.ts        ← 核心：你手写（失败预算 / 错误率闸门）
```

### 5.2 舱壁隔离：给每个依赖固定的并发槽位

**知识点 1：Bulkhead（舱壁隔离）**

- **解决什么问题**：船舱进水，舱壁把进水限制在一个隔间，不让整船沉。系统里，Redis 慢了不该把调模型的线程也全占住。舱壁给每个依赖分配独立的并发槽位上限。
- **运行机制**：用信号量为每个依赖限制最大并发。模型 20 个槽、Redis 50 个槽。某依赖槽位占满时，新请求快速失败或排队，但不会挤占其他依赖的槽位。
- **项目落点**：`bulkhead.ts` 用信号量实现槽位控制，`bulkhead-registry.ts` 为各依赖配置槽位数。
- **生产误区**：不设舱壁，所有依赖共享全局线程池——一个慢依赖耗尽全部线程，健康依赖也被饿死（这正是情境题 2 的场景）。
- **验证方法**：让 Redis 依赖变慢占满其槽位，确认模型调用仍能正常获取自己的槽位执行。

**Bulkhead 你要手写的核心逻辑（伪代码）：**

```
Bulkhead(maxConcurrent):
  semaphore = maxConcurrent

  async execute(fn):
    if semaphore <= 0:
      throw BulkheadFullError  # 槽位满，快速失败
    semaphore--
    try:
      return await fn()
    finally:
      semaphore++  # 无论成败都要归还槽位
```

### 5.3 分级降级：故障时给用户明确的次优结果

**知识点 2：Fallback（分级降级）**

- **解决什么问题**：依赖挂了，与其让用户无限转圈，不如给一个明确的降级结果："模型暂时不可用，这是缓存的上次结果"或"服务繁忙，请稍后重试"。
- **运行机制**：主调用失败后按优先级尝试降级：缓存结果 → 简化模型 → 静态兜底 → 明确错误提示。每一级都比"转圈"好。
- **项目落点**：`fallback-strategy.ts` 编排降级链，`degraded-response.ts` 标记响应为降级态（前端据此显示降级 UI）。
- **生产误区**：降级时假装成功，返回空数据让用户以为正常——这比明确报错更糟。降级必须**明确告知用户**当前是降级态。
- **验证方法**：让主依赖失败，确认返回降级结果且响应中带 `degraded: true` 标记。

**FallbackStrategy 你要手写的核心逻辑（伪代码）：**

```
FallbackStrategy.execute(primary, fallbacks[]):
  try:
    return { data: await primary(), degraded: false }
  catch primaryError:
    for fallback in fallbacks:  # 按优先级尝试
      try:
        return { data: await fallback(), degraded: true, reason: fallback.name }
      catch: continue
    # 所有降级都失败，返回明确错误（不伪装成功）
    return { error: '服务暂时不可用', degraded: true, retryable: true }
```

### 5.4 失败预算：整个请求的总时间闸门

**知识点 3：Timeout Budget（请求级总预算）**

- **解决什么问题**：单个依赖超时 8s，但一个请求可能串行调多个依赖。若每个都用满超时，用户等 30s。需要一个请求级总预算，用完就整体放弃。
- **运行机制**：请求入口设总预算（如 10s）。每次调依赖前检查剩余预算，把 `min(依赖超时, 剩余预算)` 作为本次调用超时。预算耗尽立即降级。
- **项目落点**：`timeout-budget.ts` 追踪请求剩余时间，各依赖调用从中扣减。
- **生产误区**：只有依赖级超时没有请求级预算——多个依赖串行累加，总时间失控。
- **验证方法**：构造串行调用链，确认总耗时不超过预算，超预算时提前降级。

**知识点 4：Failure Budget（失败预算 / 错误率闸门）**

- **解决什么问题**：情境题 1 的重试风暴——三层各重试 3 次，放大 27 倍。需要全局的失败预算：单位时间内失败/重试次数超阈值就停止重试。
- **运行机制**：滑动窗口统计失败率。失败预算耗尽时，暂停所有非关键重试，只保留快速失败。这与熔断器配合：熔断器管单依赖，失败预算管全局重试放大。
- **项目落点**：`failure-budget.ts` 维护全局失败计数，重试前检查预算。
- **生产误区**：只在单点限重试次数，忽略多层叠加。3 层 × 3 次 = 27 次，必须有跨层的全局预算。
- **验证方法**：模拟连续 429，确认总调用次数被全局预算限制，不出现 27 倍放大。

### 5.5 分层韧性策略全景

```
请求入口
  → TimeoutBudget 分配总预算（10s）
  → Bulkhead 获取依赖槽位（满则快速失败）
  → CircuitBreaker 检查依赖状态（OPEN 则快速失败）
  → RetryPolicy 执行（受 FailureBudget 全局约束）
      → LayeredTimeout 套用依赖超时（取 min(依赖超时, 剩余预算)）
      → 实际调用
  → 失败 → FallbackStrategy 分级降级
  → 返回（正常 or degraded=true）
```

### 5.6 v3 阶段验证

```bash
# 舱壁：让 Redis 占满槽位
# 确认模型调用仍能获取自己的槽位，不被 Redis 拖累

# 降级：主依赖全部失败
curl /run -d '{"failAll":true}'
# 期望：返回 {degraded:true, reason:...}，UI 显示降级提示

# 失败预算：连续 429
# 确认全局调用次数被限制，无 27 倍放大，UI 明确显示降级
```

## §6 前端底子深挖：降级 UX 与请求生命周期

今天不是加个重试库就行。前端要回答一个真问题：后端降级了，用户怎么知道？超时了，前端该等多久、怎么取消？面试官问"流式请求怎么限流、怎么取消"，答不到 AbortController 和请求生命周期就是背 API。

### 6.1 AbortController：前端的超时与取消

**深挖点 1：为什么 fetch 需要 AbortController？**

- `fetch` 默认没有超时——请求可以挂起到浏览器默认超时（可能几分钟）。用户早就走了，连接还占着。
- `AbortController` 提供 `signal`，配合 `setTimeout` 实现前端超时；用户主动取消（点"停止生成"）也用它。
- **运行机制**：`controller.abort()` 触发 `signal` 的 abort 事件，fetch 立即 reject（AbortError），底层 TCP 连接释放。
- **项目落点**：所有调 Agent 的请求都带 `signal`，设前端超时（如 30s，略大于后端总预算），并给用户"停止"按钮。
- **生产误区**：只设后端超时不设前端超时——后端还在跑，前端已经没人看了，浪费资源。前后端超时要协同。
- **验证方法**：发起请求后 `abort()`，确认请求立即中断，Network 面板显示 canceled。

```typescript
// apps/web/src/lib/abortable-fetch.ts（样板，可用）
export function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}
```

### 6.2 降级态的视觉表达

**深挖点 2：降级不是错误，要区别对待**

- 后端返回 `degraded: true` 时，前端不能当成错误弹红框，也不能假装正常。要用**明确但不惊悚**的提示："当前使用缓存结果，可能不是最新"。
- **运行机制**：响应体带 `degraded` 标记和 `reason`，前端据此渲染降级横幅（黄色而非红色），并提供"重试"按钮。
- **项目落点**：对话气泡、指标面板在降级态显示角标或横幅，区别于正常态和错误态三种视觉状态。
- **生产误区**：降级和错误用同一个红色弹窗——用户以为坏了就走了，其实还有可用的降级结果。
- **验证方法**：模拟后端降级，确认前端显示黄色降级提示而非红色错误。

**深挖点 3：三种状态的视觉分层**

| 状态 | 后端标记 | 前端视觉 | 用户动作 |
|------|---------|---------|---------|
| 正常 | `degraded: false` | 正常渲染 | 无 |
| 降级 | `degraded: true` | 黄色横幅 + 结果 | 可选重试 |
| 错误 | `error` 且无 data | 红色提示 + 重试按钮 | 重试 |

### 6.3 流式请求的背压在前端的体现

**深挖点 4：前端消费慢也会造成背压**

- 后端流式推送，若前端渲染慢（大量 DOM 更新），浏览器缓冲区堆积，最终反压到后端。
- **运行机制**：前端用 `requestAnimationFrame` 批量渲染流式 token，而非每个 token 一次 DOM 更新，避免渲染跟不上推送。
- **项目落点**：流式对话渲染做节流，累积一定 token 或一帧时间再统一更新。
- **生产误区**：每个 SSE 消息都直接 `innerHTML +=`，token 快时页面卡死。
- **验证方法**：高频推送下观察页面帧率，确认不掉帧。

### 6.4 前端韧性清单（今日必做）

| 机制 | 前端动作 | 验证 |
|------|---------|------|
| 超时 | fetch 带 AbortController + setTimeout | 超时自动中断 |
| 取消 | "停止生成"按钮触发 abort | 请求 canceled |
| 降级 UX | degraded 态黄色横幅 | 区别于错误红框 |
| 背压 | rAF 批量渲染流式 token | 高频推送不掉帧 |

## §7 测试与验证：稳定性测试四件套

稳定性功能的验证核心是**故障注入**：主动让依赖失败/变慢，观察系统是否按设计降级，而非崩溃或雪崩。

### 7.1 单元测试：熔断器与舱壁

```typescript
// circuit-breaker.spec.ts
describe('CircuitBreaker', () => {
  it('连续失败达阈值后打开', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 })
    const failing = () => Promise.reject(new Error('fail'))
    for (let i = 0; i < 3; i++) {
      await cb.execute(failing).catch(() => {})
    }
    expect(cb.state).toBe('OPEN')
    // OPEN 态直接快速失败，不再调用底层
    await expect(cb.execute(failing)).rejects.toThrow('Circuit is OPEN')
  })

  it('resetTimeout 后进入 HALF_OPEN 试探', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 })
    await cb.execute(() => Promise.reject(new Error())).catch(() => {})
    expect(cb.state).toBe('OPEN')
    await sleep(60)
    // 下一次调用进入 HALF_OPEN 试探
    await cb.execute(() => Promise.resolve('ok'))
    expect(cb.state).toBe('CLOSED')  // 试探成功，恢复
  })
})

// bulkhead.spec.ts
describe('Bulkhead', () => {
  it('槽位满时快速失败', async () => {
    const bh = new Bulkhead(2)
    const slow = () => sleep(1000)
    bh.execute(slow); bh.execute(slow)  // 占满 2 个槽
    await expect(bh.execute(slow)).rejects.toThrow('BulkheadFull')
  })
})
```

### 7.2 集成测试：重试放大防护

```typescript
// retry-amplification.e2e-spec.ts
describe('重试风暴防护', () => {
  it('多层重试不放大成 27 倍', async () => {
    const providerCalls = mockProvider429()  // Provider 持续返回 429
    await runAgent('测试').catch(() => {})
    // 全局失败预算限制总调用次数，不是 3×3×3=27
    expect(providerCalls.count).toBeLessThan(5)
  })

  it('UI 收到明确降级标记', async () => {
    mockProviderDown()
    const result = await runAgent('测试')
    expect(result.degraded).toBe(true)
    expect(result.reason).toBeDefined()
  })
})
```

### 7.3 反证实验（两个）

**反证 1：移除舱壁会怎样？**

- 操作：让所有依赖共享全局并发池，注释掉 Bulkhead。
- 现象：Redis 变慢占满全部线程，健康的模型调用也被饿死，队列积压（复现情境题 2）。
- 证据：Redis 慢期间，模型调用的等待时间同步飙升。
- 结论：舱壁把单依赖故障隔离在自己的槽位内。

**反证 2：移除失败预算会怎样？**

- 操作：注释掉全局 FailureBudget，只保留各层独立重试。
- 现象：Provider 持续 429 时，三层各重试 3 次，单请求放大 27 次调用，成本飙升（复现情境题 1）。
- 证据：Trace 显示单个用户请求触发 27 次 Provider 调用。
- 结论：失败预算是跨层重试放大的全局闸门。

### 7.4 架构证据四件套

1. **依赖图**：`ResilienceModule` → TimeoutBudget / Bulkhead / CircuitBreaker / RetryPolicy / FallbackStrategy / FailureBudget 的组合关系。
2. **时序图**：一个请求从入口经"预算分配 → 舱壁 → 熔断检查 → 重试 → 降级"的完整韧性链路。
3. **Failure Budget 图**：错误率随时间变化，标注熔断打开、失败预算耗尽、降级触发的时间点。
4. **故障注入回归**：429 风暴、依赖宕机、超时风暴三个场景的注入脚本 + 系统响应对比（前后）。

## §8 通关检查清单（v3 规范 11 项）

- [ ] §0 本日在 90 天路线图的坐标已说明（阶段二第 8 天，承 Day37 性能，启 Day39）
- [ ] §1 用户场景 5 个 + 模块职责 + 三版演进 + 完整目录结构 + 脚手架检查齐全
- [ ] §2 6 小时开发节奏已列出（原理 40 / 增量 100 / 测试 25 / 复盘 15，本日 3h 基线按比例折算）
- [ ] §3 v1（裸调用 + 无限等待）完整代码 + 5 个致命问题
- [ ] §4 v2（分层超时 + 重试分类器 + 熔断器）完整代码
- [ ] §5 v3（舱壁隔离 + 分级降级 + 失败预算）完整代码 + 6 个知识点五要素
- [ ] §6 前端底子深挖（AbortController + 降级 UX + 流式背压）
- [ ] §7 测试四件套（单元 + 集成 + 2 个反证实验 + 架构证据）
- [ ] §8 本清单
- [ ] §9 增量到下一站的伏笔
- [ ] §10-14 收尾章节 + 原文情境题/PDF 映射/五连问原样保留

## §9 从今天的增量到下一站

今天你把系统从「依赖一挂就雪崩」加固到「分层韧性 + 全局失败预算」。但你会发现一个新问题：**韧性策略的参数（超时值、重试次数、熔断阈值、舱壁槽位）都是拍脑袋定的**。生产环境需要用真实流量数据来校准这些参数，还要能在不重启的情况下动态调整。

到阶段三（Day41 起）进入多 Agent 编排时，你会遇到更复杂的失败传播：一个 Agent 失败如何不拖垮整个编排图。今天手写的熔断器、舱壁、失败预算，都是明天理解「分布式韧性」的具体锚点。而参数动态化的需求，也会在后续的配置中心主题里收敛。

## §10 本日小结

**标题党 30 字**：给模型/Tool/DB/Redis 建分层韧性，让任何单点故障都撞在超时、熔断、舱壁的闸门上，而不是雪崩。

**三句话**：
1. 稳定性不是加个重试库，而是识别每一条依赖边界，给每条边界配超时预算、有限重试、熔断和舱壁，任何一层都不能无限等待或无限重试。
2. 重试在多层叠加时会指数放大（3 层 3 次 = 27 倍），必须用全局失败预算作为跨层闸门，而不是各层各自重试。
3. 降级是一等公民而非错误——后端要明确标记 degraded，前端要用区别于错误的视觉表达，让用户知道"还能用，只是不是最新"。

## §11 课后三道核心问题（必答，先于教师五连问）

1. 请从今天项目的真实入口到最终输出，解释"稳定性"的数据流或控制流；当天知识链"Timeout budget、有限重试、熔断、降级、bulkhead"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## §12 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：模型 Provider 连续返回 429，三层各自重试 3 次，把每个用户请求放大为 27 次调用，5 分钟成本增加 11 倍。请用 retryCount、deadline、Provider 状态码和 Trace 定位放大链，先关闭下层重试并限流，再建立统一 timeout budget、退避和熔断，验证无重试风暴且 UI 明确显示降级。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)
2. 模拟情境：Redis 故障 12 分钟导致 Tool 状态缓存不可用，健康 Tool 也被阻塞，队列积压 4 万。请查看依赖延迟、bulkhead 槽位和终止分布，先隔离 Redis 依赖并切只读降级，再修复分层超时、舱壁与恢复探测，验证单一依赖故障不会耗尽整个服务。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)
知识映射：对应 timeout budget、有限重试、熔断、降级和 bulkhead。

## §13 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## §14 PDF 面试题映射

1. AI 接口的超时和重试机制应如何处理？  
   来源：[《2026京东前端面试-AI Coding方向》](<../../资源/2026京东前端面试-AI Coding方向.pdf>)，第 4 页。
2. Node.js 中如何对不同用户的流式请求做限流？  
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 6 页。
题目说明：直接匹配 timeout、有限重试和限流；熔断、bulkhead 与降级 UX 在资料中覆盖不足，需项目反证。
