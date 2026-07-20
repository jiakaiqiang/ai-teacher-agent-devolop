# Day 40 - Node 全栈门禁：阶段二综合检验与答辩

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：Day31-39 的原始实现与故障基线视为 v1；现场止损方案视为 v2；根因修复、容量/安全/恢复回归和架构证据视为 v3。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

日期与时长：2026-08-22 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日目录结构（门禁日无新增代码，检验已有代码）**
>
> ```
> 【本日不新增目录，检验 Day31-39 已实现模块的综合能力】
> 
> 检验范围：
> apps/api/src/
> ├── approval/      ← Day33 HITL 审批（租约、恢复、幂等）
> ├── recovery/      ← Day34 失败恢复（错误分类、DLQ、补偿、重放）
> ├── trace/         ← Day35 可观测性（Trace 贯穿、PII 脱敏）
> ├── security/      ← Day36 API 安全（CORS、上传、注入、限流）
> ├── performance/   ← Day37 性能（query plan、索引、缓存）
> ├── stability/     ← Day38 稳定性（超时、重试、熔断、舱壁）
> ├── metrics/       ← Day39 指标（成功定义、下钻、SLO）
> └── queue/         ← Day29-30 队列与 Agent 执行
> 
> apps/web/src/
> └── pages/         ← 前端看板（Day35 Trace、Day39 指标下钻）
> 
> 架构证据（本日产出）：
> docs/
> ├── architecture/
> │   ├── c4-backend.md              ← Backend C4（System/Container/Component）
> │   ├── capacity-model.md          ← 容量假设与瓶颈分析
> │   └── risk-register.md           ← 风险登记表
> └── gate-checklist/
>     ├── sql-audit.md               ← SQL 审查清单
>     ├── api-contract-test.md       ← API 契约测试
>     ├── permission-matrix.md       ← 权限矩阵
>     └── tool-loop-detection.md     ← Tool 死循环检测
> ```
>
> 说明：Day40 是**阶段二收官门禁**，不写新代码，而是**故障注入 + 独立答辩**。你要在 AI 禁用的条件下，独立定位"流量 10 倍后 event-loop lag 600ms"、"审批重放 + 越权 + Trace 断链"的复合故障，给出 15 分钟止损方案、根因修复和容量模型。通过标准：总分 >=70，后端基础 >=65%，权限和恢复 >=60%。

## §0 今天在 90 天里的位置

**阶段二最后一天，综合门禁日。** Day31-39 你建立了生产级基础设施（HITL、失败恢复、可观测性、安全、性能、稳定性、指标）。今天不写新代码，而是**在 AI 禁用条件下独立答辩**：

- **门禁 1：容量与性能排障**：流量突增 10 倍，event-loop lag 600ms、队列积压 5 万、模型 P95 18s，但 CPU 仅 45%。用 C4、Trace、队列指标定位瓶颈（不是盲目扩容）。
- **门禁 2：安全与恢复综合故障**：旧 Tool 越权 + 审批重放 + Trace 断链同时出现。在 AI 禁用条件下还原数据流，封禁风险能力，修复授权/幂等/观测。

**今天解决的 5 个综合问题：**

1. **容量瓶颈误判**：CPU 低不代表容量够——可能是 event-loop 阻塞（单线程瓶颈）或 I/O 等待（队列积压）。
2. **故障止损优先级错乱**：先修复还是先止损？正确顺序：封禁风险能力（止损）→ 保护证据（Trace/日志）→ 根因修复 → 回归测试。
3. **权限漏洞难追溯**：旧 Tool 越权了，但不知道哪些 run 调用过，也不知道权限是何时被修改的——缺权限审计日志。
4. **审批重放不幂等**：队列重启后审批请求被重复处理——Day33 的幂等机制在哪失效了？
5. **Trace 断链无法下钻**：看板显示成功率下降，但 Trace 断了，无法下钻到具体 run——Day35 的 Trace 传播在哪断了？

**阶段二学习地图总结：**

```
Day31-33：可持久化 HITL（租约、队列恢复、幂等）
Day34：失败恢复（错误分类、DLQ、补偿、重放）
Day35：可观测性（Trace 贯穿、PII 脱敏、采样）
Day36：API 安全（CORS、上传、注入、限流）
Day37：性能（query plan、索引、缓存、背压）
Day38：稳定性（超时预算、重试、熔断、舱壁）
Day39：指标（成功定义、下钻、SLO）
Day40：【今天】综合门禁与答辩
```

阶段三（Day41 起）进入多 Agent 编排（LangGraph 状态机、Plan-Act-Reflect、人机协作流），但前提是通过今天的门禁——证明你对阶段二的 9 天内容不是"看懂了"而是"会用了"。

## §1 今天要做的事

### 1.1 五个真实门禁场景

| # | 场景 | 考察点 | 通过标准 |
|---|------|--------|---------|
| 1 | 流量 10 倍后 event-loop lag 600ms，但 CPU 45% | 容量瓶颈定位（不是盲目扩容） | 15 分钟给出止损方案 + 根因 + 容量模型 |
| 2 | 旧 Tool 越权访问其他租户数据 | 权限审计与追溯 | 找出所有越权 run + 封禁 Tool + 修复权限检查 |
| 3 | 审批队列重启后重复处理审批请求 | 幂等机制验证 | 定位幂等失效点 + 修复 + 回归测试 |
| 4 | Trace 断链导致无法下钻到具体 run | 观测链路完整性 | 修复 Trace 传播 + 验证端到端贯穿 |
| 5 | SQL 慢查询拖垮 API 响应 | SQL 审查与优化 | 给出 EXPLAIN 证据 + 索引优化 + 验证 P95 < 100ms |

### 1.2 门禁不是"做题"，是"答辩"

**关键区别**：

- **做题**：给你一个已知问题（如"优化这个慢查询"），你按步骤解决。
- **答辩**：给你一个现象（如"event-loop lag 600ms"），你要自己找问题在哪、为什么、怎么证明、怎么修。

**答辩四要素**：

1. **现象描述**：系统表现出什么症状（lag 600ms、队列积压 5 万）。
2. **假设与验证**：提出 3 个可能原因，逐个验证排除。
3. **根因证据**：不是"我觉得是 X"，而是"Trace 显示 Y，日志显示 Z，所以根因是 X"。
4. **修复与防复发**：不只是修 Bug，还要加监控、加测试、更新容量模型。

### 1.3 今天的时间分配（6 小时）

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理复习 | 60 min | 复习 Day31-39 的核心机制（租约、补偿、Trace、熔断、SLO），准备答辩 |
| 门禁 1：容量 | 90 min | 定位 event-loop 瓶颈 + 15 分钟止损方案 + 容量模型 |
| 门禁 2：安全与恢复 | 120 min | 越权追溯 + 审批重放修复 + Trace 断链修复（AI 禁用） |
| 架构证据产出 | 60 min | Backend C4、容量假设、风险登记、权限矩阵 |
| 自检与复盘 | 30 min | 对照评分标准自检（总分 >=70、后端 >=65%、权限恢复 >=60%） |

### 1.4 评分标准（总分 100）

| 维度 | 分值 | 考察点 |
|------|------|--------|
| 后端基础 | 35 | SQL 审查、API 契约、容量分析、Node event-loop 理解 |
| 权限与恢复 | 30 | 越权追溯、幂等验证、Trace 修复 |
| 故障止损 | 20 | 15 分钟给出可执行止损方案（不是"重启试试"） |
| 架构证据 | 15 | C4、容量模型、风险登记完整性 |

**通过标准**：
- 总分 >= 70
- 后端基础 >= 65%（35 分中至少 23 分）
- 权限与恢复 >= 60%（30 分中至少 18 分）

### 1.5 今天动手前的准备清单

```bash
# 1. 确认 Day31-39 的核心模块都已实现
ls apps/api/src/approval apps/api/src/recovery apps/api/src/trace apps/api/src/security

# 2. 确认数据库里有测试数据（至少 100 个 run）
psql -U postgres -d p1_monitor -c "SELECT COUNT(*) FROM runs;"

# 3. 确认监控指标可查询
curl http://localhost:3000/api/metrics/summary

# 4. 准备压测工具（用于容量门禁）
npm install -g autocannon  # HTTP 压测
```

**门禁前自检**：Day31-39 任一天的核心功能缺失，今天无法通过（例如 Day33 租约没实现，门禁 2 的审批重放无法排查）。先自检，缺哪天补哪天。

## §2 今天的开发节奏（6 小时门禁版）

今天不是"学新知识"，而是"检验已学知识"。节奏不是"看文档 → 写代码"，而是"看现象 → 提假设 → 验证 → 修复 → 证明"。

**关键心态转变**：前 39 天你有文档、有示例、有 AI 辅助；今天只有故障现象和你自己。这是从"辅助学习"到"独立工作"的跃迁。

| 阶段 | 时长 | 心态 | 产出 |
|------|------|------|------|
| 复习核心机制 | 60 min | "租约怎么防重、补偿怎么回滚、Trace 怎么传播" | 知识清单 |
| 门禁 1 | 90 min | "现象是 X，可能原因是 A/B/C，我先验证 A" | 止损方案 + 根因 + 容量模型 |
| 门禁 2 | 120 min | "越权了，先封禁 Tool，再查审计日志，再修权限" | 修复 PR + 回归测试 |
| 架构证据 | 60 min | "画出系统分层，标出瓶颈点，列出风险项" | C4 + 容量模型 + 风险登记 |
| 自检 | 30 min | "对照评分标准，我哪些做到了，哪些还差" | 自评表 |

## §3 门禁 1：容量瓶颈定位（event-loop lag 但 CPU 低）

### 3.1 故障现象

```
[监控面板]
- QPS: 1000 → 10000（流量突增 10 倍）
- Event-loop lag: 50ms → 600ms
- 队列积压: 200 → 50000
- 模型调用 P95: 2s → 18s
- Node 进程 CPU: 45%
- Node 进程内存: 1.2GB / 2GB
```

**直觉误判**："CPU 才 45%，说明容量够，问题在下游（模型 API）"。

**正确思路**：CPU 低 ≠ 容量够。Node 是单线程 event-loop，可能是：
1. **event-loop 阻塞**：某个同步操作（如大 JSON 解析、正则匹配）占用 event-loop，导致其他请求排队。
2. **I/O 等待**：大量请求在等模型 API 响应，event-loop 空转但没 CPU 消耗。
3. **队列积压反压**：队列满了，新请求进不去，event-loop 在等队列空位。

### 3.2 答辩思路：提假设 → 验证 → 排除

**假设 1：event-loop 阻塞（同步操作）**

验证方法：
```bash
# 查看 event-loop lag 分布（按路由分组）
curl /api/metrics/event-loop-lag?groupBy=route
# 期望：某个路由的 lag 特别高（如 /api/agent/execute）
```

排除方法：如果所有路由 lag 均匀，说明不是某个同步操作，而是整体 I/O 等待。

**假设 2：I/O 等待（模型 API 慢）**

验证方法：
```bash
# 查看模型调用的并发数
curl /api/metrics/model-calls?metric=concurrency
# 期望：并发数接近连接池上限（如 100）

# 查看模型 P95 延迟
curl /api/metrics/model-calls?metric=p95_latency
# 期望：18s（已知）
```

证据：并发数打满 + P95 高 = I/O 等待。但这不是根因，而是症状——**为什么模型 API 变慢了？**

**假设 3：模型 API 被限流**

验证方法：
```bash
# 查看模型调用错误分布
curl /api/metrics/model-calls?groupBy=error
# 期望：rate_limit 错误占比高

# 查看模型 provider 的 429 响应
grep "429" logs/model-api.log | wc -l
```

**根因定位**：流量 10 倍 → 模型调用 10 倍 → 触发 OpenAI rate limit → 重试 → 队列积压 → event-loop 等待队列空位 → lag 600ms。

### 3.3 15 分钟止损方案

**止损目标**：让系统恢复部分服务能力（不是完全恢复，而是"不全挂"）。

**止损动作（按优先级）**：

1. **降级非关键请求**（2 分钟）：
   ```typescript
   // apps/api/src/stability/circuit-breaker.ts（Day38 已实现）
   // 手动打开非关键路由的熔断器
   CircuitBreaker.forceOpen('/api/agent/batch-execute')  // 批量任务降级
   ```

2. **启用重试预算限制**（3 分钟）：
   ```typescript
   // apps/api/src/recovery/retry-budget.ts（Day34 已实现）
   // 限制模型调用重试次数：1 小时内最多 100 次
   RetryBudget.setLimit('model_call', { max: 100, window: 3600 })
   ```

3. **启用请求队列限流**（5 分钟）：
   ```typescript
   // apps/api/src/queue/queue-limiter.ts（Day29 已实现）
   // 队列超过 1 万拒绝新请求
   QueueLimiter.setMax(10000)
   ```

4. **通知用户降级**（5 分钟）：
   ```typescript
   // 前端显示降级提示
   showDegradationBanner({
     message: '当前流量过高，部分功能暂时不可用',
     degradedFeatures: ['批量任务', '历史记录查询'],
   })
   ```

**止损验证**：5 分钟后检查 event-loop lag 是否降到 < 200ms、队列积压是否稳定（不再增长）。

### 3.4 根因修复（长期方案）

**修复 1：增加模型 API 配额**

- 联系 OpenAI 提升 rate limit（或切换到企业账号）
- 预计生效时间：24 小时

**修复 2：启用模型响应缓存**

```typescript
// apps/api/src/model/model-cache.ts（Day37 已实现）
// 相同 prompt 缓存 5 分钟
ModelCache.enable({ ttl: 300, keyBy: 'prompt' })
```

- 预计缓存命中率 20%（减少 20% 模型调用）
- 生效时间：立即

**修复 3：队列分级处理**

```typescript
// apps/api/src/queue/priority-queue.ts（新增）
// 关键任务高优先级，批量任务低优先级
PriorityQueue.setPriority({
  'agent-execute': 10,        // 高优先级
  'agent-batch-execute': 1,   // 低优先级
})
```

- 保证关键任务不被批量任务拖垮
- 生效时间：代码部署后立即

### 3.5 容量模型（预防下次）

**容量假设（Capacity Assumptions）**：

| 资源 | 当前容量 | 瓶颈点 | 10 倍流量下的瓶颈 |
|------|---------|--------|------------------|
| Node event-loop | 单线程，1000 req/s | event-loop lag | 10000 req/s → lag 600ms |
| 模型 API | 100 req/s（rate limit） | 模型调用并发 | 1000 req/s → 触发限流 |
| 队列 | 10 万容量 | 队列积压 | 50000 积压 → 接近上限 |
| DB 连接池 | 50 连接 | DB 查询并发 | 未触及（还有余量） |

**扩容建议**：

1. **水平扩展 Node 实例**：1 个 → 4 个（每个 2500 req/s）
2. **提升模型 API 配额**：100 req/s → 500 req/s
3. **启用缓存**：减少 20% 模型调用

**容量验证（压测）**：

```bash
# 用 autocannon 压测
autocannon -c 100 -d 60 http://localhost:3000/api/agent/execute

# 期望结果：
# - event-loop lag < 200ms
# - 队列积压稳定（不增长）
# - 模型调用无 rate_limit 错误
```

### 3.6 容量门禁自检清单

- [ ] 能从现象（lag 600ms + CPU 45%）推导出根因（模型 rate limit）
- [ ] 15 分钟内给出可执行止损方案（降级 + 限流 + 通知）
- [ ] 给出容量模型（标出瓶颈点 + 扩容建议）
- [ ] 用压测验证扩容有效（不是盲目加机器）

## §4 门禁 2：安全与恢复综合故障（越权 + 审批重放 + Trace 断链）

### 4.1 故障现象（三个问题同时出现）

**现象 1：旧 Tool 越权**
```
[告警日志]
2026-07-16 14:23:11 [Security] Tool "getMetrics" accessed tenant B's data, but run belongs to tenant A
RunId: run-abc123
ToolName: getMetrics
RequestedTenant: tenant-b
ActualTenant: tenant-a
```

**现象 2：审批重放**
```
[审批日志]
2026-07-16 14:25:33 [Approval] Duplicate approval request detected
ApprovalId: approval-xyz789
Status: approved (already processed)
DuplicateCount: 3
```

**现象 3：Trace 断链**
```
[指标看板]
成功率从 95% 降到 87%，但点击下钻无法看到失败 run 的 Trace
TraceId: missing in 15% of runs
```

### 4.2 故障止损顺序（先止血，再找原因）

**错误顺序**：先调查根因 → 问题继续扩大 → 更多数据泄露。

**正确顺序**：
1. **封禁风险能力**（5 分钟）：停止越权 Tool，防止继续泄露。
2. **保护证据**（10 分钟）：备份审计日志、Trace、run 数据，防止被覆盖。
3. **还原影响范围**（30 分钟）：找出所有越权 run、所有重放审批、所有断链 Trace。
4. **根因修复**（60 分钟）：修权限检查、修幂等、修 Trace 传播。
5. **回归测试**（30 分钟）：验证修复有效，不会复发。

### 4.3 问题 1：旧 Tool 越权（权限漏洞追溯）

**根因假设**：Tool 权限配置被修改，或者权限检查逻辑有漏洞。

**调查步骤（AI 禁用，你独立完成）**：

**Step 1：封禁越权 Tool（5 分钟）**

```typescript
// apps/api/src/tools/tool-registry.ts
// 临时禁用 getMetrics
ToolRegistry.disable('getMetrics', { reason: 'security_incident' })
```

验证：调用 getMetrics 应返回 403 Forbidden。

**Step 2：查审计日志，找出所有越权 run（10 分钟）**

```sql
-- apps/api/prisma/queries/find-unauthorized-runs.sql
SELECT 
  r.id AS runId,
  r.tenantId AS actualTenant,
  tc.toolName,
  tc.args->>'serverId' AS requestedResource,
  s.tenantId AS resourceTenant,
  tc.createdAt
FROM runs r
JOIN tool_calls tc ON r.id = tc.runId
JOIN servers s ON tc.args->>'serverId' = s.id
WHERE tc.toolName = 'getMetrics'
  AND r.tenantId != s.tenantId  -- 越权：run 的租户 != 资源的租户
  AND tc.createdAt >= '2026-07-16 00:00:00'
ORDER BY tc.createdAt DESC;
```

预期结果：找出所有越权 run（如 15 个）。

**Step 3：定位权限检查漏洞（20 分钟）**

```typescript
// apps/api/src/tools/implementations/get-metrics.tool.ts
// Day36 应该有这个检查，现在验证是否生效
async execute(args: { serverId: string }, context: ToolContext) {
  const server = await this.prisma.server.findUnique({
    where: { id: args.serverId },
  })
  
  // 【检查点 1】这行代码在吗？
  if (server.tenantId !== context.tenantId) {
    throw new PermissionDeniedError('Cannot access other tenant data')
  }
  
  // ...
}
```

**可能的漏洞**：
1. 权限检查代码被误删（代码 review 漏了）
2. `context.tenantId` 没有正确传入（上游 bug）
3. 老版本 Tool 没有权限检查（Day36 之前的代码）

**验证方法**：
```bash
# 检查 Git 历史，权限检查是何时被删的
git log --all --oneline --grep="PermissionDeniedError" -- apps/api/src/tools/implementations/get-metrics.tool.ts

# 检查 context.tenantId 是否正确传入
# 在 tool-executor.ts 加日志
console.log('[ToolExecutor] context.tenantId:', context.tenantId)
```

**Step 4：修复权限检查（10 分钟）**

```typescript
// 如果权限检查代码缺失，补上
if (!server || server.tenantId !== context.tenantId) {
  await this.auditLogger.log({
    event: 'permission_denied',
    toolName: 'getMetrics',
    runId: context.runId,
    requestedTenant: server?.tenantId,
    actualTenant: context.tenantId,
  })
  throw new PermissionDeniedError('Cannot access other tenant data')
}
```

**Step 5：通知受影响租户（15 分钟）**

```typescript
// 给所有被越权访问的租户发通知
const affectedTenants = ['tenant-b', 'tenant-c']
for (const tenantId of affectedTenants) {
  await NotificationService.send({
    to: tenantId,
    subject: '安全事件通知',
    body: '您的数据在 2026-07-16 14:00-15:00 期间被误访问，我们已修复漏洞并封禁相关功能。',
  })
}
```

### 4.4 问题 2：审批重放（幂等机制失效）

**根因假设**：Day33 的幂等机制（租约或 idempotency key）在某个环节失效了。

**调查步骤（AI 禁用）**：

**Step 1：查审批重放记录（5 分钟）**

```sql
-- 找出所有重复处理的审批
SELECT 
  approvalId,
  COUNT(*) AS processCount,
  MAX(processedAt) - MIN(processedAt) AS timeSpan
FROM approval_audit_logs
WHERE event = 'approval_processed'
  AND createdAt >= '2026-07-16 00:00:00'
GROUP BY approvalId
HAVING COUNT(*) > 1
ORDER BY processCount DESC;
```

预期结果：找出所有重复处理的审批（如 approval-xyz789 被处理 3 次）。

**Step 2：检查租约机制（10 分钟）**

```typescript
// apps/api/src/approval/lease/lease-manager.ts（Day33 已实现）
// 租约应该防止重复处理，现在验证是否生效
async acquireLease(approvalId: string): Promise<boolean> {
  const result = await this.prisma.approvalRequest.updateMany({
    where: {
      id: approvalId,
      OR: [
        { leaseOwner: null },
        { leaseExpiresAt: { lt: new Date() } },
      ],
    },
    data: {
      leaseOwner: this.workerId,
      leaseExpiresAt: new Date(Date.now() + this.config.durationMs),
    },
  })
  return result.count > 0
}
```

**可能的失效点**：
1. `leaseExpiresAt` 设置太短（如 1 秒），队列重启后租约已过期。
2. `workerId` 重复（多个 worker 用同一个 ID）。
3. 乐观锁失效（Prisma `updateMany` 没有版本检查）。

**验证方法**：
```sql
-- 查审批的租约历史
SELECT 
  id,
  leaseOwner,
  leaseExpiresAt,
  updatedAt
FROM approval_requests
WHERE id = 'approval-xyz789'
ORDER BY updatedAt DESC;
```

预期发现：同一个审批被多个 worker 获取了租约（租约机制失效）。

**Step 3：修复租约配置（10 分钟）**

```typescript
// apps/api/src/approval/lease/lease-config.ts
// 租约时长从 1 秒改为 10 分钟
export const LEASE_CONFIG = {
  durationMs: 10 * 60 * 1000,  // 10 分钟（之前是 1000ms）
  renewIntervalMs: 5 * 60 * 1000,  // 5 分钟续约一次
}
```

**Step 4：加乐观锁（15 分钟）**

```prisma
// apps/api/prisma/schema.prisma
model ApprovalRequest {
  // ...
  version Int @default(0)  // 乐观锁版本号
}
```

```typescript
// 租约获取改用 version 检查
const approval = await this.prisma.approvalRequest.findUnique({
  where: { id: approvalId },
})

if (!approval) return false

const result = await this.prisma.approvalRequest.updateMany({
  where: {
    id: approvalId,
    version: approval.version,  // 乐观锁检查
    OR: [
      { leaseOwner: null },
      { leaseExpiresAt: { lt: new Date() } },
    ],
  },
  data: {
    leaseOwner: this.workerId,
    leaseExpiresAt: new Date(Date.now() + this.config.durationMs),
    version: approval.version + 1,  // 版本号 +1
  },
})

return result.count > 0
```

### 4.5 问题 3：Trace 断链（观测链路断裂）

**根因假设**：Day35 的 Trace 传播在某个中间件或队列传递时丢失了。

**调查步骤（AI 禁用）**：

**Step 1：统计断链比例（5 分钟）**

```sql
-- 找出没有 Trace 的 run
SELECT 
  COUNT(*) AS totalRuns,
  SUM(CASE WHEN traceId IS NULL THEN 1 ELSE 0 END) AS missingTrace,
  ROUND(100.0 * SUM(CASE WHEN traceId IS NULL THEN 1 ELSE 0 END) / COUNT(*), 2) AS missingPercent
FROM runs
WHERE createdAt >= '2026-07-16 00:00:00';
```

预期结果：15% 的 run 缺少 traceId。

**Step 2：定位断链点（15 分钟）**

```typescript
// 检查 Trace 传播链路
// 1. HTTP 请求 → API Gateway（应该注入 traceId）
// 2. API Gateway → Agent Service（应该传递 traceId）
// 3. Agent Service → Queue（应该写入 job.data.traceId）
// 4. Queue → Worker（应该从 job.data.traceId 恢复）

// 检查点 1：API Gateway
// apps/api/src/trace/trace-middleware.ts（Day35 已实现）
app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || generateTraceId()
  AsyncLocalStorage.run({ traceId }, next)  // 【检查：这行代码在吗？】
})

// 检查点 2：Queue 传递
// apps/api/src/queue/tool-queue.ts
await toolQueue.add('execute-tool', {
  runId: 'run-001',
  traceId: getTraceId(),  // 【检查：这行代码在吗？】
})

// 检查点 3：Worker 恢复
// apps/api/src/queue/tool-queue.processor.ts
async process(job: Job) {
  const { traceId } = job.data
  await AsyncLocalStorage.run({ traceId }, async () => {  // 【检查：这行代码在吗？】
    // 执行任务
  })
}
```

**可能的断链点**：
1. Queue 传递时忘记写 `traceId` 到 job.data。
2. Worker 恢复时没有从 job.data 读 `traceId`。
3. 某个中间件清空了 AsyncLocalStorage。

**Step 3：修复 Trace 传播（20 分钟）**

```typescript
// 如果 Queue 传递缺失，补上
await toolQueue.add('execute-tool', {
  runId,
  traceId: getTraceId(),  // 补上这行
  ...otherData,
})

// 如果 Worker 恢复缺失，补上
async process(job: Job) {
  const { traceId } = job.data
  if (!traceId) {
    console.warn('[Worker] Missing traceId in job, generating new one')
    job.data.traceId = generateTraceId()
  }
  
  await AsyncLocalStorage.run({ traceId: job.data.traceId }, async () => {
    // 执行任务
  })
}
```

**Step 4：端到端验证（10 分钟）**

```bash
# 发起一个新请求，验证 Trace 贯穿
curl -H "X-Trace-Id: test-trace-001" http://localhost:3000/api/agent/execute

# 查 DB，确认 run 有 traceId
psql -c "SELECT id, traceId FROM runs WHERE traceId = 'test-trace-001';"

# 查 Trace 看板，确认能下钻
curl /api/trace/test-trace-001
```

### 4.6 门禁 2 自检清单

- [ ] 故障止损顺序正确（先封禁 Tool，再查日志，再修复）
- [ ] 能从审计日志追溯所有越权 run
- [ ] 能定位幂等失效点（租约时长 / 乐观锁）
- [ ] 能定位 Trace 断链点（Queue 传递 / Worker 恢复）
- [ ] 三组回归测试（安全、恢复、观测）都通过

## §5 架构证据产出（门禁必需的四件套）

门禁不只是"修好 Bug"，还要产出架构证据——证明你理解系统全貌、知道风险在哪、有容量规划。

### 5.1 Backend C4 模型

**C4 四层**：Context（系统上下文）→ Container（容器）→ Component（组件）→ Code（代码）。门禁要求到 Component 层。

**System Context（系统上下文）**：

```
┌─────────────┐
│   用户      │
└──────┬──────┘
       │ HTTPS
       ↓
┌─────────────────────────────┐
│  p1-monitor（本系统）       │
│  Agent 执行 + 监控 + 审批   │
└──────┬──────────────┬───────┘
       │              │
       ↓              ↓
┌──────────┐   ┌──────────┐
│ OpenAI   │   │ Postgres │
│ API      │   │ DB       │
└──────────┘   └──────────┘
```

**Container（容器层）**：

```
┌───────────────────────────────────────────┐
│ p1-monitor System                         │
│                                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ Web App │  │ API      │  │ Worker  │  │
│  │ (Vue3)  │  │ (NestJS) │  │ (BullMQ)│  │
│  └────┬────┘  └────┬─────┘  └────┬────┘  │
│       │            │             │        │
│       └────────────┼─────────────┘        │
│                    │                      │
└────────────────────┼──────────────────────┘
                     ↓
              ┌────────────┐
              │ Postgres   │
              │ + Redis    │
              └────────────┘
```

**Component（组件层 — 本日重点）**：

```
API Container 内部组件：
┌─────────────────────────────────────────┐
│ API (NestJS)                            │
│                                         │
│  HTTP Layer                             │
│  ├─ TraceMiddleware ← Day35            │
│  ├─ CorsMiddleware ← Day36             │
│  └─ RateLimitGuard ← Day36             │
│                                         │
│  Application Layer                      │
│  ├─ AgentService ← Day29-30            │
│  ├─ ApprovalService ← Day33            │
│  ├─ RecoveryService ← Day34            │
│  └─ MetricsService ← Day39             │
│                                         │
│  Domain Layer                           │
│  ├─ ToolRegistry ← Day29               │
│  ├─ SuccessCriteria ← Day39            │
│  └─ PermissionChecker ← Day36          │
│                                         │
│  Infrastructure Layer                   │
│  ├─ PrismaService ← Day27              │
│  ├─ QueueService ← Day29               │
│  └─ CacheService ← Day37               │
└─────────────────────────────────────────┘
```

**依赖箭头（关键调用链）**：

```
HTTP 请求
  → TraceMiddleware（注入 traceId）
    → RateLimitGuard（限流检查）
      → AgentService.execute（核心逻辑）
        → QueueService.add（加入队列）
          → [Worker] ToolRegistry.execute（执行工具）
            → PermissionChecker.verify（权限检查）
              → PrismaService.query（DB 查询）
```

### 5.2 容量模型文档

**docs/architecture/capacity-model.md（你要手写的文档）**：

```markdown
# 容量模型

## 当前容量假设（2026-07-16）

| 资源 | 当前配置 | 理论容量 | 实测容量 | 瓶颈点 |
|------|---------|---------|---------|--------|
| Node 实例 | 1 个（2 核 4GB） | 2000 req/s | 1000 req/s | Event-loop 单线程 |
| 模型 API | OpenAI Standard | 100 req/s | 100 req/s | Rate limit |
| 队列 | Redis 1 个 | 100 万 jobs | 5 万 jobs | 内存 2GB |
| DB 连接池 | 50 连接 | 500 qps | 300 qps | 连接数 |

## 流量 10 倍后的瓶颈

- **瓶颈 1**：模型 API rate limit（100 → 1000 req/s）→ 触发限流 → 重试 → 队列积压
- **瓶颈 2**：Event-loop lag（50ms → 600ms）→ 请求排队 → 用户等待
- **瓶颈 3**：队列积压（200 → 50000）→ 接近上限 → 新请求拒绝

## 扩容方案

1. **提升模型 API 配额**：100 → 500 req/s（联系 OpenAI 升级企业账号）
2. **水平扩展 Node**：1 → 4 个实例（负载均衡）
3. **启用缓存**：相同 prompt 缓存 5 分钟（减少 20% 模型调用）
4. **队列分级**：关键任务高优先级，批量任务低优先级

## 验证方法

压测验证（autocannon）：
- 并发 100，持续 60 秒
- 期望：event-loop lag < 200ms，队列积压稳定
```

### 5.3 风险登记表

**docs/architecture/risk-register.md（你要手写的文档）**：

```markdown
# 风险登记表

| 风险 ID | 风险描述 | 影响 | 概率 | 缓解措施 | 负责人 | 状态 |
|---------|---------|------|------|---------|--------|------|
| R1 | 模型 API rate limit | 高 | 高 | 启用缓存 + 提升配额 | DevOps | 进行中 |
| R2 | 旧 Tool 越权访问 | 高 | 中 | 权限检查 + 审计日志 | Security | 已修复 |
| R3 | 审批重放（幂等失效） | 中 | 低 | 租约 + 乐观锁 | Backend | 已修复 |
| R4 | Trace 断链 | 中 | 中 | Queue 传递 traceId | Observability | 已修复 |
| R5 | DB 连接池耗尽 | 高 | 低 | 连接池监控 + 熔断 | Backend | 监控中 |
```

### 5.4 权限矩阵

**docs/gate-checklist/permission-matrix.md（你要手写的文档）**：

```markdown
# 权限矩阵

| Tool | 权限要求 | 检查点 | 审计日志 |
|------|---------|--------|---------|
| getMetrics | serverId.tenantId == context.tenantId | ✅ | ✅ |
| restartServer | serverId.tenantId == context.tenantId + admin role | ✅ | ✅ |
| clearCache | admin role | ✅ | ✅ |
| approveRequest | approvalId.requestedBy != context.userId | ✅ | ✅ |

检查方法：
1. 每个 Tool 执行前调用 PermissionChecker.verify()
2. 验证失败抛 PermissionDeniedError
3. 记录审计日志（event='permission_denied'）
```

## §6 前端底子深挖：门禁面板与故障可视化

门禁不只是后端排障，前端要展示"故障发生时用户看到什么、如何快速定位问题"。

### 6.1 故障可视化的三个层次

**层次 1：聚合指标（用户视角）**

用户看到的是"服务慢了"，不是"event-loop lag 600ms"。前端要把技术指标翻译成业务语义：
- Event-loop lag 600ms → "请求排队中，预计等待 10 秒"
- 队列积压 50000 → "当前任务繁忙，您的请求已进入队列（位置 12345）"
- 模型 rate limit → "AI 服务暂时不可用，已自动降级"

**层次 2：下钻到具体 run（排障视角）**

运维点击"成功率 87%"，下钻到失败 run 列表，按 terminationReason 分组：
- timeout: 50 个
- tool_error: 40 个
- model_refusal: 30 个

再点进单个 run，看 Trace 时间线、工具调用、终止证据。

**层次 3：实时监控（预警视角）**

WebSocket 推送实时指标（每 5 秒更新），超过 SLO 阈值时前端自动高亮：
- Event-loop lag > 500ms → 红色闪烁
- 队列积压 > 10000 → 橙色警告
- 成功率 < 95% → 红色告警

### 6.2 门禁面板的信息密度

**错误做法**：只显示一个数字"event-loop lag: 600ms"。

**正确做法**：一个卡片包含：
- 当前值（600ms）
- SLO 目标（< 200ms，用红色对比）
- 趋势（过去 1 小时的 Sparkline，看到尖峰）
- 影响范围（"影响 15000 个请求"）
- 快速止损按钮（"一键降级非关键功能"）

### 6.3 前端门禁自检清单

- [ ] 故障时用户能看到降级提示（不是白屏或无限 loading）
- [ ] 运维能从聚合指标下钻到具体 run
- [ ] 实时监控能在 SLO 超标时自动告警
- [ ] 快速止损按钮可用（不是"联系管理员"）

## §7 测试与验证：门禁回归测试

门禁通过的标志不是"修好了"，而是"有测试证明修好了 + 不会再坏"。

### 7.1 容量回归测试

```bash
# 压测验证扩容有效
autocannon -c 100 -d 60 -m POST \
  -H "Content-Type: application/json" \
  -b '{"prompt": "test"}' \
  http://localhost:3000/api/agent/execute

# 期望结果：
# - Requests: 6000 in 60s (100 req/s)
# - Event-loop lag < 200ms
# - 队列积压稳定（不增长）
# - 无 rate_limit 错误
```

### 7.2 安全回归测试

```typescript
// 验证越权防护
it('跨租户访问应被拒绝', async () => {
  const response = await request(app)
    .post('/api/tools/execute')
    .set('X-Tenant-Id', 'tenant-a')
    .send({
      toolName: 'getMetrics',
      args: { serverId: 'server-belongs-to-tenant-b' },
    })
  
  expect(response.status).toBe(403)
  expect(response.body.error).toContain('PermissionDenied')
})
```

### 7.3 恢复回归测试

```typescript
// 验证审批幂等
it('重复处理审批应被拒绝', async () => {
  const approvalId = 'approval-test-001'
  
  // 第一次处理
  await approvalService.process(approvalId)
  
  // 第二次处理（应该被租约阻止）
  const secondAttempt = await approvalService.process(approvalId)
  expect(secondAttempt.success).toBe(false)
  expect(secondAttempt.reason).toContain('already_processed')
})
```

### 7.4 观测回归测试

```typescript
// 验证 Trace 贯穿
it('Queue 传递应保留 traceId', async () => {
  const traceId = 'test-trace-001'
  
  // 加入队列
  await toolQueue.add('execute-tool', {
    runId: 'run-001',
    traceId,
  })
  
  // Worker 处理
  const job = await toolQueue.getNextJob()
  expect(job.data.traceId).toBe(traceId)
  
  // DB 查询
  const run = await prisma.run.findUnique({ where: { id: 'run-001' } })
  expect(run.traceId).toBe(traceId)
})
```

## §8 通关检查清单（v3 规范 11 项）

- [ ] §0 本日在 90 天路线图的坐标已说明（阶段二第 10 天门禁，承接 Day31-39，启阶段三）
- [ ] §1 五个门禁场景 + 答辩四要素 + 时间分配 + 评分标准 + 准备清单齐全
- [ ] §2 6 小时门禁节奏已列出（复习 60 / 门禁 1 90 / 门禁 2 120 / 架构证据 60 / 自检 30）
- [ ] §3 门禁 1（容量瓶颈）完整答辩流程：假设 → 验证 → 15 分钟止损 → 根因 → 容量模型
- [ ] §4 门禁 2（安全与恢复）完整答辩流程：封禁 → 追溯 → 修复权限/幂等/Trace
- [ ] §5 架构证据四件套（Backend C4、容量模型、风险登记、权限矩阵）
- [ ] §6 前端底子深挖（故障可视化三层次 + 门禁面板信息密度）
- [ ] §7 测试四件套（容量压测 + 安全/恢复/观测回归测试）
- [ ] §8 本清单
- [ ] §9 增量到下一站的伏笔
- [ ] §10-14 收尾章节 + 原文情境题/PDF 映射/五连问原样保留

## §9 从今天的增量到下一站

今天你通过了阶段二门禁——证明你对 Day31-39 的 9 天内容不是"看懂了"而是"会用了"。但你会发现一个新问题：**单 Agent 的能力边界**。

门禁 1 暴露的容量问题，本质是"单个 Agent 处理复杂任务效率低"——如果能拆成多个 Agent 并行（规划 Agent + 执行 Agent + 审查 Agent），流量 10 倍时不会所有请求都挤在一个队列。

门禁 2 暴露的越权问题，本质是"Tool 权限粒度太粗"——如果能按 Agent 角色分配权限（读 Agent 只读、写 Agent 只写、审批 Agent 只审批），不会出现"监控 Agent 误删数据"。

**阶段三（Day41 起）进入多 Agent 编排**：
- Day41-45：LangGraph 状态机（Plan → Act → Reflect 循环）
- Day46-50：多 Agent 协作（Supervisor 模式、工作流编排）
- Day51-55：RAG 深化（向量检索、Reranker、Hybrid Search）
- Day56-60：人机协作流（HITL 分级、意图澄清、渐进式交付）

今天手写的 C4、容量模型、风险登记，都是理解"分布式 Agent 系统"的具体锚点。单 Agent 的容量瓶颈，也会在多 Agent 并行编排里收敛。

**阶段二收官总结**：Day31-40 你建立了完整的生产级基础设施（HITL、失败恢复、可观测性、安全、性能、稳定性、指标、门禁）。这 10 天是从"能跑的原型"到"可上线的系统"的跃迁。阶段三将在这个地基上建多 Agent 编排，而不是从零开始。

## §10 本日小结

**标题党 30 字**：门禁不是做题而是答辩，AI 禁用条件下独立定位容量瓶颈、越权追溯、审批重放、Trace 断链，用压测和回归测试证明修复有效。

**三句话**：
1. 容量瓶颈不能只看 CPU——event-loop lag 600ms 但 CPU 45% 说明是单线程瓶颈或 I/O 等待，根因是模型 API rate limit 触发重试导致队列积压，止损方案是降级 + 限流 + 缓存。
2. 故障止损顺序是先封禁风险能力、再保护证据、再根因修复——越权 Tool 先禁用防止继续泄露，然后查审计日志找所有越权 run，最后补权限检查和审计。
3. 门禁通过的标志是有测试证明修好了——容量压测、安全回归、恢复回归、观测回归四组测试全过，加上 Backend C4、容量模型、风险登记、权限矩阵四件架构证据。

## §11 课后三道核心问题（必答，先于教师五连问）

1. 请从今天项目的真实入口到最终输出，解释"Node 全栈门禁"的数据流或控制流；当天知识链"架构演进、全栈排障、容量、安全、Agent 治理"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到;再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## §12 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟门禁：流量突增 10 倍后 Node event-loop lag 达 600 ms、队列积压 5 万、模型 P95 18 s，但 CPU 仅 45%。请独立使用 C4、Trace、队列和容量指标定位瓶颈，给出 15 分钟止损、根因修复和容量模型，并用压测证明不是盲目扩容。
   依据：[S5 AI 全栈](https://jobs.bytedance.com/experienced/position/7647767015784335669/detail)
2. 模拟门禁：一次恢复演练同时出现旧 Tool 越权、审批重放和 Trace 断链。请在 AI 禁用条件下还原数据流，先封禁风险能力并保护证据，再依次修复授权、幂等和观测，提交安全、恢复、回归三组可复现实验。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)
知识映射：Day 40 综合检验 Node 全栈排障、容量、安全和 Agent 治理。

## §13 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## §14 PDF 面试题映射

1. 从零设计企业级 AI 聊天助手前端架构时，应包含哪些模块？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 12 页。
2. 过去一年最难的 AI 技术问题是什么，你如何排查并解决？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 10 页。
题目说明：适合作为 Node 全栈门禁答辩：一题考架构，一题考真实排障与量化证据。
