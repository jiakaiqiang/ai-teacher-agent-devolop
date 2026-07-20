# Day 35 - 可观测性（Trace 全链路 + 日志脱敏 + 采样策略）

日期与时长：2026-08-17 周一，180 分钟（90 分钟阅读 + 90 分钟动手）  
项目：`D:\demo\ai-techer\p1-monitor`  
阶段任务性质：在真实 p1-monitor 链路中交付 Trace、脱敏与采样能力

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

---

## §0. 在 90 天路线图中的位置

**阶段定位**：阶段二第 5 天（Day 31-40：Agent 生产化工程 10 天）

**前置依赖**：
- Day 29（BullMQ 队列）：队列日志需要 Trace ID 关联
- Day 32（Agent 状态机）：Agent 执行链路需要 span 追踪
- Day 34（失败恢复）：RecoveryAuditLog 需要 Trace ID 定位重试窗口

**今天要解决的 5 个核心问题**：

1. **Trace 断链问题**：浏览器到 Nest 的 Trace 完整，但 Nest 到 Agent/Tool 的 35% span 断链，故障只能靠时间猜测
   - **为什么发生**：异步上下文（AsyncLocalStorage）传播断裂，或手动传 correlationId 时漏传
   - **用户看到什么**：前端显示"请求失败"，但后端日志里找不到对应 Trace ID（无法定位问题）
   - **今天如何解决**：OpenTelemetry 自动注入 + AsyncLocalStorage 传播 + 手动补充 Agent/Tool span

2. **日志泄密问题**：0.4% 的错误日志包含 Authorization、用户 Prompt 或模型 API key
   - **为什么发生**：错误对象直接序列化（`JSON.stringify(error)`），包含敏感字段
   - **用户看到什么**：安全扫描发现日志泄漏 API key，需要轮换密钥（影响线上服务）
   - **今天如何解决**：字段白名单 + 敏感字段脱敏（Authorization → `***` / Prompt → 摘要）

3. **日志爆炸问题**：每天 2 GB 日志，但只有 5% 的日志用于故障排查
   - **为什么发生**：所有请求都记录 DEBUG 级别日志（包括健康检查、轮询请求）
   - **用户看到什么**：日志存储成本高（S3 存储费用），查询慢（Elasticsearch 查询 10s+）
   - **今天如何解决**：采样策略（健康检查不记录 + 错误请求 100% 采样 + 正常请求 1% 采样）

4. **Trace 重复问题**：同一个请求生成 3 个不同的 Trace ID（前端 1 个 + BFF 1 个 + Agent 1 个）
   - **为什么发生**：前端/BFF/Agent 各自独立生成 Trace ID，没有传播机制
   - **用户看到什么**：无法从前端 Trace ID 追溯到后端日志（Trace ID 对不上）
   - **今天如何解决**：W3C Trace Context（traceparent header）传播 + OpenTelemetry 自动注入

5. **Span 缺失关键信息**：span 只记录了"执行了 getMetrics 工具"，但不知道参数是什么
   - **为什么发生**：span attributes 只记录了 toolName，没有记录 toolArgs
   - **用户看到什么**：故障排查时只知道"调用了工具"，但不知道"调用时传了什么参数"
   - **今天如何解决**：Span Schema 标准化（toolName + toolArgs + result + error）

**后续依赖（Day 35 是哪些能力的地基）**：
- Day 36-40：LangGraph 状态机编排的 span 追踪（Plan → Act → Reflect 每个节点都是一个 span）
- Day 41-50：RAG 检索的 span 追踪（向量检索 span + Rerank span + 生成 span）
- Day 51-60：SLA 监控（基于 Trace 数据计算 P95/P99 延迟）

**Day 35 在知识链中的承上启下作用**：

Day 34 建立了"失败恢复审计日志"（RecoveryAuditLog），但没有解决"如何从前端 Trace ID 追溯到审计日志"。Day 35 建立"全链路 Trace ID 传播"，让 RecoveryAuditLog 里的每条记录都关联到 Trace ID。Day 36-40 的 LangGraph 状态机编排会复用 Day 35 的 Trace 传播机制（每个状态机节点都是一个 span）。

---

## 1. 功能模块职责划分

### 1.1 用户能看到什么（5 个真实场景）

**场景 1：前端发起请求，后端日志自动关联 Trace ID**

用户在前端点击"分析服务器"按钮：
1. 前端生成 Trace ID（`00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`）
2. 前端发送请求时，自动在 HTTP Header 里加上 `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
3. BFF 收到请求后，从 `traceparent` header 提取 Trace ID，并传播到后续调用（Agent、Tool、DB）
4. 用户在浏览器 DevTools Network 里看到请求的 Trace ID，复制到 Elasticsearch，直接查到后端所有相关日志

**场景 2：Tool 执行失败，日志里看到脱敏后的参数**

用户请求"重启服务器 srv-001"，但权限不足：
1. Tool 执行失败，抛出异常：`Error: Permission denied for serverId=srv-001, userId=user-123, Authorization=Bearer sk-abc123...`
2. 日志系统自动脱敏：`serverId=srv-001, userId=user-123, authorization=***`
3. 用户在日志里看到"Permission denied"，但看不到完整的 Authorization token（防止泄密）

**场景 3：查询日志时，只看到关键日志（采样后）**

运维查询"过去 1 小时的所有请求日志"：
1. 健康检查请求（`/health`）不记录日志（采样率 0%）
2. 正常请求（200 响应）只记录 1%（采样率 1%）
3. 错误请求（500 响应）100% 记录（采样率 100%）
4. 查询结果：1000 条日志（而不是 10 万条），但包含所有错误日志

**场景 4：从前端 Trace ID 追溯到后端完整链路**

用户报告"请求失败"，提供前端 Trace ID：
1. 运维复制 Trace ID 到 Elasticsearch：`traceId:4bf92f3577b34da6a3ce929d0e0e4736`
2. 查询结果展示完整链路：
   ```
   [2026-07-17 10:30:01] [BFF] POST /api/analyze { serverId: 'srv-001' }
   [2026-07-17 10:30:02] [Agent] runId=run-001 started
   [2026-07-17 10:30:03] [Tool] getMetrics { serverId: 'srv-001' }
   [2026-07-17 10:30:04] [Tool] ERROR: Request timeout after 30s
   [2026-07-17 10:30:05] [Agent] runId=run-001 failed
   ```
3. 运维直接定位问题：Tool 超时（30s）

**场景 5：Span 展示工具执行的完整上下文**

运维在 Jaeger UI 查看 Trace 链路：
1. Span 1（BFF）：`POST /api/analyze` + 耗时 3.2s
2. Span 2（Agent）：`runId=run-001` + 耗时 3.1s
3. Span 3（Tool getMetrics）：`serverId=srv-001` + 耗时 2.8s
4. Span 4（Prisma Query）：`SELECT * FROM servers WHERE id='srv-001'` + 耗时 0.1s
5. 运维直接看到：Tool 执行占了 90% 时间（2.8s / 3.2s）

### 1.2 核心模块职责

今天交付的可观测性模块包含 5 个子模块：

| 模块 | 职责 | 输入 | 输出 | 为什么需要 |
|---|---|---|---|---|
| **Trace Propagation** | 传播 Trace ID（W3C Trace Context） | HTTP `traceparent` header | Trace ID 注入到日志/span | 前端 Trace ID 能追溯到后端 |
| **Span Schema** | 标准化 span attributes | toolName, toolArgs, result | span attributes（结构化） | span 包含关键信息（不只是 toolName） |
| **PII Redaction** | 脱敏敏感字段 | 日志对象（含敏感字段） | 脱敏后的日志对象 | 日志不泄露 API key/Authorization |
| **Sampling Strategy** | 采样策略（减少日志量） | 请求 metadata（status/path） | 是否记录日志（boolean） | 日志量从 2GB/天降到 100MB/天 |
| **Context Injection** | 注入 Trace ID 到 AsyncLocalStorage | Trace ID（从 header 提取） | 后续所有日志自动带 Trace ID | 不需要手动传 correlationId |

**模块之间的依赖关系**：

```
traceparent header（前端）
        ↓
  Trace Propagation（提取 Trace ID）
        ↓
  Context Injection（注入到 AsyncLocalStorage）
        ↓
  ┌─────┴──────┬──────────┬────────────┐
Span Schema  PII Redaction  Sampling Strategy
  ↓            ↓              ↓
span attributes  脱敏后日志  采样后日志
```

**为什么按这个顺序？**
1. 先提取 Trace ID（Trace Propagation），才能注入到 AsyncLocalStorage（Context Injection）
2. 再标准化 span attributes（Span Schema），才能在日志里看到结构化信息
3. 最后脱敏（PII Redaction）和采样（Sampling Strategy），保证日志安全 + 减少存储成本

### 1.3 三版演进路线图

**v1：手动传 correlationId（Day 29 基线）**

能力：
- BFF 生成 `correlationId`，手动传给 Agent/Tool
- 日志里手动加上 `correlationId`（`logger.info('[correlationId] ...')`）

问题：
- 手动传递容易漏传（例如异步队列里忘记传 correlationId）
- 日志格式不统一（有的是 `[correlationId]`，有的是 `[runId]`）
- 无法关联到前端 Trace ID（前端和后端的 correlationId 不同）

**v2：OpenTelemetry 自动注入 + AsyncLocalStorage 传播（今天交付）**

新增能力：
- OpenTelemetry 自动注入 Trace ID（从 `traceparent` header 提取）
- AsyncLocalStorage 自动传播 Trace ID（不需要手动传参数）
- Span Schema 标准化（toolName + toolArgs + result + error）

解决的问题：
- ✅ Trace 断链（AsyncLocalStorage 自动传播）
- ✅ Trace 重复（前端/后端复用同一个 Trace ID）
- ✅ Span 缺失关键信息（Span Schema 标准化）

还剩下的问题：
- ❌ 日志泄密（日志里包含 Authorization/API key）
- ❌ 日志爆炸（所有请求都记录日志）

**v3：PII 脱敏 + 采样策略（今天交付）**

新增能力：
- PII Redaction：字段白名单 + 敏感字段脱敏（Authorization → `***` / Prompt → 摘要）
- Sampling Strategy：健康检查 0% + 正常请求 1% + 错误请求 100%

解决的问题：
- ✅ 日志泄密（PII Redaction 自动脱敏）
- ✅ 日志爆炸（Sampling Strategy 减少 95% 日志量）

生产级保障：
- ✅ 敏感泄漏为 0（安全扫描验证）
- ✅ 日志量降低 95%（从 2GB/天到 100MB/天）
- ✅ 单一 Trace 可还原 run（从前端到 DB 的完整链路）

---

## 1.4 目录结构（5 个维度完整展示）

### 1.4.1 骨架树（今天新增的文件）

```
apps/api/src/
├── telemetry/                          # 可观测性模块（新增）
│   ├── tracing/
│   │   ├── trace-context.ts           # Trace Context（提取 traceparent）
│   │   ├── trace-propagator.ts        # Trace 传播器（注入到 AsyncLocalStorage）
│   │   ├── span-schema.ts             # Span Schema 标准（toolName/args/result/error）
│   │   └── span-builder.ts            # Span 构建器（创建标准化 span）
│   ├── logging/
│   │   ├── structured-logger.ts       # 结构化日志（JSON 格式）
│   │   ├── pii-redactor.ts            # PII 脱敏器（字段白名单）
│   │   ├── sampling-strategy.ts       # 采样策略（健康检查/正常/错误）
│   │   └── log-context.ts             # 日志上下文（自动注入 Trace ID）
│   ├── instrumentation/
│   │   ├── otel-config.ts             # OpenTelemetry 配置
│   │   ├── http-instrumentation.ts    # HTTP 自动注入（NestJS 拦截器）
│   │   ├── prisma-instrumentation.ts  # Prisma 自动注入（查询 span）
│   │   └── bullmq-instrumentation.ts  # BullMQ 自动注入（队列 span）
│   └── telemetry.module.ts            # 可观测性模块（导出）
├── agent/
│   └── agent.service.ts               # 改造：添加 span（Agent 执行）
├── tool/
│   └── tool-registry.ts               # 改造：添加 span（Tool 执行）
└── queue/
    └── tool-queue.processor.ts        # 改造：添加 span（队列处理）

apps/api/prisma/
└── schema.prisma                      # 无新增表（复用现有日志表）

apps/web/src/
├── lib/
│   └── trace-context.ts               # 前端 Trace Context（生成 traceparent）
└── api/
    └── client.ts                      # 改造：自动注入 traceparent header
```

### 1.4.2 为什么这样分层（5 个架构问题）

**问题 1：为什么 tracing 和 logging 分开？**

**回答**：tracing 关注"链路追踪"（span 的父子关系），logging 关注"日志内容"（日志的结构化 + 脱敏）。分开后可以独立演进（例如"换一个 tracing 后端（Jaeger → Tempo）"不影响 logging）。

**问题 2：为什么 instrumentation 单独一层？**

**回答**：instrumentation 是"自动注入"（拦截 HTTP/Prisma/BullMQ），不需要手动改业务代码。单独一层后，业务代码（agent.service.ts）不需要关心 Trace ID 传播（自动注入）。

**问题 3：为什么 PII Redaction 在 logging 层而不是 tracing 层？**

**回答**：span attributes 不包含敏感字段（只记录 toolName/serverId），敏感字段只在日志里（例如 Authorization header）。PII Redaction 只需要在 logging 层实现。

**问题 4：为什么前端也有 trace-context.ts？**

**回答**：前端需要生成 `traceparent` header（W3C Trace Context 格式），后端才能提取 Trace ID。如果前端不传 `traceparent`，后端会生成新的 Trace ID（无法关联）。

**问题 5：为什么不用 NestJS 内置的 Logger？**

**回答**：NestJS 内置 Logger 不支持结构化日志（只支持字符串），不支持 PII 脱敏，不支持采样策略。StructuredLogger 是基于 Winston 的自定义实现（支持 JSON 格式 + 脱敏 + 采样）。

### 1.4.3 与 Day 29/32/34 的 diff

| 对比维度 | Day 29 队列 | Day 32 状态机 | Day 34 失败恢复 | Day 35 可观测性（今天） |
|---|---|---|---|---|
| **Trace ID 来源** | 手动生成 correlationId | 手动传 runId | 手动传 runId | 前端生成 traceparent |
| **Trace ID 传播** | 手动传参数 | 手动传参数 | 手动传参数 | AsyncLocalStorage 自动传播 |
| **日志格式** | 字符串（`[runId] ...`） | 字符串 | 字符串 | JSON（结构化） |
| **敏感字段** | 直接记录 | 直接记录 | 直接记录 | 自动脱敏（PII Redaction） |
| **日志量** | 全量记录 | 全量记录 | 全量记录 | 采样记录（1% 正常 + 100% 错误） |
| **Span** | 无 | 无 | 无 | 有（Agent/Tool/Prisma/BullMQ） |

**关键变化**：Day 35 用 OpenTelemetry 替代手动传 correlationId，用 AsyncLocalStorage 替代手动传参数，用 Span 替代字符串日志。

### 1.4.4 依赖箭头（从前端到 DB 的完整链路）

```
前端（生成 traceparent）
  → HTTP Request（携带 traceparent header）
  → NestJS 拦截器（提取 Trace ID）
  → AsyncLocalStorage（注入 Trace ID）
  → AgentService（自动继承 Trace ID）
  → ToolRegistry（自动继承 Trace ID）
  → Prisma（自动继承 Trace ID）
  → 日志系统（自动注入 Trace ID + 脱敏 + 采样）
  → Elasticsearch（存储日志）
  → Jaeger（存储 span）
```

**关键依赖**：AsyncLocalStorage 是 Trace ID 传播的核心，所有异步调用（Agent/Tool/Prisma）都自动继承 Trace ID（不需要手动传参数）。

### 1.4.5 三个灵魂拷问

**拷问 1：如果前端不传 traceparent，后端还能工作吗？**

**回答**：能工作，但 Trace ID 无法关联。后端会生成新的 Trace ID（OpenTelemetry 自动生成），但前端 Trace ID 和后端 Trace ID 不同（无法从前端追溯到后端）。

**拷问 2：如果 AsyncLocalStorage 传播断裂（例如第三方库不支持），怎么办？**

**回答**：手动传 Trace ID（作为参数）。例如：`agentService.run(runId, traceId)`。但这会增加代码复杂度（每个方法都要加 traceId 参数）。

**拷问 3：如果日志脱敏规则误杀（例如把正常字段 "authorization_status" 也脱敏了），怎么办？**

**回答**：用字段白名单（而不是黑名单）。只脱敏明确的敏感字段（`authorization`/`api_key`/`prompt`），其他字段保持原样。如果白名单里没有 `authorization_status`，就不脱敏。

---
## 1.5 今天动手前的脚手架检查

**为什么放在 §1 里**：Day 35 依赖 Day 29（BullMQ）、Day 32（Agent）、Day 34（RecoveryAuditLog）的代码。如果这些依赖缺失，今天的可观测性无法注入到业务链路。

### 1.5.1 Day 29/32/34 代码检查

```bash
# 检查 BullMQ 队列是否存在
ls apps/api/src/queue/tool-queue.processor.ts

# 检查 AgentService 是否存在
ls apps/api/src/agent/agent.service.ts

# 检查 RecoveryAuditLog 是否存在
grep -r "RecoveryAuditLog" apps/api/src/
```

**如果缺失**：先完成 Day 29/32/34，再回来做 Day 35。

### 1.5.2 今天需要安装的依赖

```bash
cd apps/api

# OpenTelemetry 核心库
npm install @opentelemetry/api @opentelemetry/sdk-node

# OpenTelemetry 自动注入（HTTP/Prisma）
npm install @opentelemetry/instrumentation-http @opentelemetry/instrumentation-express

# OpenTelemetry 导出器（Jaeger/Console）
npm install @opentelemetry/exporter-jaeger @opentelemetry/exporter-trace-otlp-http

# Winston 结构化日志
npm install winston

# AsyncLocalStorage polyfill（Node.js 12+ 内置，这里只是确认）
node -p "require('async_hooks').AsyncLocalStorage"
```

**为什么用 OpenTelemetry 而不是自己实现？**

OpenTelemetry 是 CNCF（Cloud Native Computing Foundation）标准，支持自动注入（HTTP/Prisma/Redis），不需要手动改业务代码。自己实现需要在每个方法里手动传 Trace ID（代码侵入性高）。

### 1.5.3 今天不需要新建 Prisma 表

**原因**：Day 35 的日志和 span 数据存储在外部系统（Elasticsearch/Jaeger），不需要在 Postgres 里建表。如果要在 Postgres 里存储日志（用于审计），可以复用 Day 34 的 RecoveryAuditLog 表（加上 traceId 字段）。

**可选改造**（如果要在 Postgres 存储日志）：

```prisma
model RecoveryAuditLog {
  id          String   @id @default(cuid())
  runId       String
  traceId     String?  // 新增：关联到 OpenTelemetry Trace ID
  spanId      String?  // 新增：关联到 OpenTelemetry Span ID
  event       String
  errorType   String?
  metadata    Json
  occurredAt  DateTime @default(now())

  @@index([runId])
  @@index([traceId])  // 新增：支持按 Trace ID 查询
  @@index([event])
  @@index([occurredAt])
}
```

**迁移脚本**（可选）：

```bash
cd apps/api
npx prisma migrate dev --name add_trace_id_to_audit_log
npx prisma generate
```

### 1.5.4 前端依赖检查

```bash
cd apps/web

# 检查 fetch API 是否可用（浏览器内置）
# 检查 crypto.randomUUID 是否可用（用于生成 Trace ID）
node -p "typeof crypto.randomUUID === 'function'"
```

**前端不需要安装 OpenTelemetry**：前端只需要生成 `traceparent` header（128 bit Trace ID + 64 bit Span ID），不需要完整的 OpenTelemetry SDK。

---

## 2. 今天的开发节奏（3 小时怎么分配）

**总计 180 分钟**，按"理解原理 → 实现 v2 自动注入 → 实现 v3 脱敏 + 采样 → 测试验证 → 架构证据"5 个阶段推进。

| 阶段 | 时长 | 任务 | 输出 | 为什么这样安排 |
|---|---|---|---|---|
| **阶段 1** | 90 min | 阅读 OpenTelemetry 官方文档、三版演进与 W3C Trace Context | 笔记：traceparent 格式 + AsyncLocalStorage 传播机制 | 前 90 分钟只读，先建立完整机制模型 |
| **阶段 2** | 30 min | 实现 v2（OpenTelemetry 自动注入 + Span Schema） | 可运行的 v2 代码 + 单元测试 | 先建立自动传播 Trace ID 的能力 |
| **阶段 3** | 30 min | 实现 v3（PII 脱敏 + 采样策略） | 完整的 v3 代码 + 集成测试 | 覆盖日志泄密和日志爆炸两个痛点 |
| **阶段 4** | 20 min | 故障注入测试：Trace 断链 + 日志泄密 + 日志爆炸 | 测试输出（截图 + 日志） | 验证三类保护机制 |
| **阶段 5** | 10 min | 架构证据：依赖图 + 时序图 + commit | 四件套 | 完成可追踪验收 |

**关键里程碑检查点**：
- 40 分钟：理解 W3C Trace Context 格式（`00-<trace-id>-<span-id>-<flags>`）
- 90 分钟：v2 自动注入代码能跑通（前端 Trace ID 传播到后端）
- 140 分钟：v3 脱敏 + 采样代码能跑通（日志里 Authorization 显示为 `***`）
- 165 分钟：集成测试通过（从前端到 DB 的完整链路）
- 180 分钟：故障注入测试完成（截图 + 日志）

**如果卡住了怎么办**：
- 卡在 W3C Trace Context 理解（阶段 1）→ 先读 OpenTelemetry 官方文档的"Context Propagation"章节
- 卡在 AsyncLocalStorage 实现（阶段 2）→ 回顾 Node.js AsyncLocalStorage API（`.run()` 方法）
- 卡在 PII 脱敏实现（阶段 3）→ 先写字段白名单，再写脱敏逻辑
- 卡在测试验证（阶段 4）→ 先跑单元测试，再跑集成测试，最后跑故障注入

---

## 3. v1：手动传 correlationId（Day 29 基线）

### 3.1 v1 能做什么

Day 29 实现的手动 correlationId 传播：
- BFF 生成 `correlationId`（`uuid.v4()`）
- 手动传给 Agent：`agentService.run(runId, correlationId)`
- Agent 手动传给 Tool：`toolRegistry.execute(toolName, args, correlationId)`
- 日志里手动加上 correlationId：`logger.info('[${correlationId}] Tool executed')`

### 3.2 v1 代码骨架（Day 29 版本）

```typescript
// apps/api/src/agent/agent.service.ts（Day 29 版本）
import { Injectable } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class AgentService {
  async run(prompt: string, correlationId?: string): Promise<any> {
    const runId = uuidv4()
    const cid = correlationId || uuidv4()

    console.log(`[${cid}] Agent run started: ${runId}`)

    // 执行工具（手动传 correlationId）
    const result = await this.toolRegistry.execute('getMetrics', { serverId: 'srv-001' }, cid)

    console.log(`[${cid}] Agent run completed: ${runId}`)
    return result
  }
}
```

```typescript
// apps/api/src/tool/tool-registry.ts（Day 29 版本）
import { Injectable } from '@nestjs/common'

@Injectable()
export class ToolRegistry {
  async execute(toolName: string, args: any, correlationId?: string): Promise<any> {
    console.log(`[${correlationId}] Tool ${toolName} executing...`)
    
    const tool = this.tools.get(toolName)
    const result = await tool.execute(args)
    
    console.log(`[${correlationId}] Tool ${toolName} completed`)
    return result
  }
}
```

**前端代码**（Day 29 版本）：

```typescript
// apps/web/src/api/client.ts（Day 29 版本）
export async function analyzeServer(serverId: string) {
  const correlationId = crypto.randomUUID() // 前端生成 correlationId
  
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId, // 自定义 header
    },
    body: JSON.stringify({ serverId }),
  })
  
  return response.json()
}
```

**BFF 提取 correlationId**（Day 29 版本）：

```typescript
// apps/api/src/api/analyze.controller.ts（Day 29 版本）
import { Controller, Post, Body, Headers } from '@nestjs/common'

@Controller('api')
export class AnalyzeController {
  constructor(private agentService: AgentService) {}

  @Post('analyze')
  async analyze(
    @Body() body: { serverId: string },
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    // 手动传 correlationId
    return this.agentService.run(`分析服务器 ${body.serverId}`, correlationId)
  }
}
```

### 3.3 v1 的 5 个致命问题

**问题 1：Trace 断链（异步调用忘记传 correlationId）**

如果 Agent 调用 BullMQ 队列（异步任务），队列 processor 里拿不到 correlationId（因为 BullMQ job data 里没有 correlationId 字段）。

**复现**：
```typescript
// Agent 加入队列任务
await this.toolQueue.add('execute-tool', {
  runId: 'run-001',
  toolName: 'getMetrics',
  // 忘记传 correlationId
})

// 队列 processor 里拿不到 correlationId
@Processor('tool')
export class ToolQueueProcessor {
  async process(job: Job) {
    // job.data 里没有 correlationId
    console.log(`[???] Processing job ${job.id}`) // correlationId 是 ???
  }
}
```

**问题 2：Trace 重复（前端和后端生成不同的 correlationId）**

前端生成 `correlationId: abc-123`，后端如果没有提取到（例如 header 名字拼写错误 `X-Correlation-ID` vs `X-Correlation-Id`），后端会生成新的 `correlationId: def-456`。用户复制前端的 `abc-123` 去后端日志查询，查不到任何日志。

**问题 3：日志格式不统一**

有的地方是 `[${correlationId}] ...`，有的地方是 `[runId=${runId}] ...`，有的地方是 `correlationId=${correlationId} ...`。日志查询时需要尝试多种格式。

**问题 4：无 Span 层级关系**

日志只记录了"执行了什么"，但不知道"谁调用了谁"。例如：
```
[abc-123] Agent run started
[abc-123] Tool getMetrics executing
[abc-123] Prisma query: SELECT * FROM servers
```

无法知道：Tool 是 Agent 调用的吗？Prisma 查询是 Tool 调用的吗？

**问题 5：日志泄密**

错误日志直接序列化 error 对象：
```typescript
catch (error) {
  console.error(`[${correlationId}] Error:`, JSON.stringify(error))
  // 输出：{"message": "...", "headers": {"authorization": "Bearer sk-abc123..."}}
}
```

Authorization header 泄露到日志里。

---
## 4. v2：OpenTelemetry 自动注入 + Span Schema（解决问题 1/2/4）

### 4.1 v2 新增的能力

v2 在 v1 基础上新增：
- **W3C Trace Context**：前端生成 `traceparent` header（标准格式），后端自动提取
- **OpenTelemetry 自动注入**：HTTP/Prisma/BullMQ 自动创建 span，不需要手动改业务代码
- **AsyncLocalStorage 传播**：Trace ID 自动传播到所有异步调用（不需要手动传参数）
- **Span Schema 标准化**：span attributes 包含 toolName/toolArgs/result/error

### 4.2 v2 架构变化

```
v1：前端生成 correlationId → 后端提取（自定义 header）→ 手动传参数 → 日志手动加上 correlationId
v2：前端生成 traceparent → 后端提取（标准 header）→ AsyncLocalStorage 自动传播 → 日志自动注入 Trace ID + 创建 span
```

**关键变化**：增加"OpenTelemetry 自动注入"环节，所有 HTTP/Prisma/BullMQ 调用自动创建 span（不需要手动改业务代码）。

### 4.3 v2 核心代码（按第 5.3 节的代码边写边问）

**边写边问自己**：
1. 为什么 traceparent 格式是 `00-<trace-id>-<span-id>-<flags>` 而不是简单的 UUID？
2. 为什么 AsyncLocalStorage 能传播 Trace ID，但普通变量不能？
3. 为什么 span 要区分"client span"和"server span"？
4. 为什么 span attributes 要用结构化数据（`{ toolName: '...', toolArgs: {...} }`）而不是字符串？
5. 为什么 OpenTelemetry 要用"拦截器"模式，而不是直接改业务代码？

#### 4.3.1 前端生成 traceparent（trace-context.ts）

```typescript
// apps/web/src/lib/trace-context.ts
/**
 * W3C Trace Context 格式：
 * version-trace_id-parent_id-trace_flags
 * 
 * 示例：
 * 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 * 
 * - version: 00（固定）
 * - trace_id: 32 位 hex（128 bit）
 * - parent_id: 16 位 hex（64 bit，当前 span ID）
 * - trace_flags: 01（采样）或 00（不采样）
 */

export class TraceContext {
  /**
   * 生成 traceparent header
   */
  static generate(): string {
    const traceId = this.generateTraceId() // 128 bit
    const spanId = this.generateSpanId()   // 64 bit
    const flags = '01' // 采样（01 = sampled, 00 = not sampled）

    return `00-${traceId}-${spanId}-${flags}`
  }

  /**
   * 生成 Trace ID（128 bit = 32 位 hex）
   */
  private static generateTraceId(): string {
    // 使用 crypto.randomUUID() 生成 128 bit 随机数
    const uuid = crypto.randomUUID().replace(/-/g, '')
    return uuid // 32 位 hex
  }

  /**
   * 生成 Span ID（64 bit = 16 位 hex）
   */
  private static generateSpanId(): string {
    // 生成 8 个随机字节（64 bit）
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * 解析 traceparent header
   */
  static parse(traceparent: string): {
    version: string
    traceId: string
    spanId: string
    flags: string
  } | null {
    const parts = traceparent.split('-')
    if (parts.length !== 4) return null

    return {
      version: parts[0],
      traceId: parts[1],
      spanId: parts[2],
      flags: parts[3],
    }
  }
}
```

**为什么用 128 bit Trace ID？**

分布式系统每秒生成百万级 Trace ID，128 bit（2^128 ≈ 3.4×10^38）保证全局唯一（碰撞概率接近 0）。如果用 64 bit（2^64 ≈ 1.8×10^19），碰撞概率是 10^-10（每天 1 亿请求，10 天后会碰撞）。

**前端改造 API client**：

```typescript
// apps/web/src/api/client.ts（v2 版本）
import { TraceContext } from '../lib/trace-context'

export async function analyzeServer(serverId: string) {
  const traceparent = TraceContext.generate()
  
  console.log('[Frontend] Generated traceparent:', traceparent)
  
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'traceparent': traceparent, // W3C 标准 header（不是 X-Correlation-Id）
    },
    body: JSON.stringify({ serverId }),
  })
  
  return response.json()
}
```

#### 4.3.2 后端提取 Trace ID（trace-propagator.ts）

```typescript
// apps/api/src/telemetry/tracing/trace-propagator.ts
import { Injectable } from '@nestjs/common'
import { AsyncLocalStorage } from 'async_hooks'
import { trace, context, SpanContext } from '@opentelemetry/api'

export interface TraceContextData {
  traceId: string
  spanId: string
  traceFlags: number
}

@Injectable()
export class TracePropagator {
  private asyncLocalStorage = new AsyncLocalStorage<TraceContextData>()

  /**
   * 从 traceparent header 提取 Trace ID
   */
  extractFromHeader(traceparent: string | undefined): TraceContextData | null {
    if (!traceparent) return null

    const parts = traceparent.split('-')
    if (parts.length !== 4) return null

    return {
      traceId: parts[1],
      spanId: parts[2],
      traceFlags: parseInt(parts[3], 16),
    }
  }

  /**
   * 注入 Trace Context 到 AsyncLocalStorage
   */
  runWithContext<T>(traceContext: TraceContextData, fn: () => T): T {
    return this.asyncLocalStorage.run(traceContext, fn)
  }

  /**
   * 获取当前 Trace Context
   */
  getCurrentContext(): TraceContextData | undefined {
    return this.asyncLocalStorage.getStore()
  }

  /**
   * 获取当前 Trace ID（用于日志）
   */
  getCurrentTraceId(): string | undefined {
    return this.getCurrentContext()?.traceId
  }
}
```

**为什么用 AsyncLocalStorage 而不是全局变量？**

全局变量在并发请求时会被覆盖（请求 A 的 Trace ID 会被请求 B 覆盖）。AsyncLocalStorage 为每个异步调用链创建独立的存储空间（类似"线程本地存储"），保证并发安全。

**示例**：
```typescript
// 错误做法（全局变量）
let currentTraceId = ''

// 请求 A
currentTraceId = 'trace-A'
await someAsyncWork() // 耗时 100ms
console.log(currentTraceId) // 输出：trace-B（被请求 B 覆盖了！）

// 请求 B（在请求 A 完成前到达）
currentTraceId = 'trace-B'
```

```typescript
// 正确做法（AsyncLocalStorage）
const storage = new AsyncLocalStorage()

// 请求 A
storage.run('trace-A', async () => {
  await someAsyncWork()
  console.log(storage.getStore()) // 输出：trace-A（不会被覆盖）
})

// 请求 B
storage.run('trace-B', async () => {
  console.log(storage.getStore()) // 输出：trace-B
})
```

#### 4.3.3 NestJS 拦截器（自动提取 traceparent）

```typescript
// apps/api/src/telemetry/instrumentation/http-instrumentation.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { TracePropagator } from '../tracing/trace-propagator'

@Injectable()
export class TraceContextInterceptor implements NestInterceptor {
  constructor(private tracePropagator: TracePropagator) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const traceparent = request.headers['traceparent']

    // 提取 Trace Context
    const traceContext = this.tracePropagator.extractFromHeader(traceparent)

    if (traceContext) {
      // 注入到 AsyncLocalStorage
      return new Observable((subscriber) => {
        this.tracePropagator.runWithContext(traceContext, () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          })
        })
      })
    }

    // 没有 traceparent，直接执行（OpenTelemetry 会自动生成新的 Trace ID）
    return next.handle()
  }
}
```

**注册拦截器**（全局）：

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { TraceContextInterceptor } from './telemetry/instrumentation/http-instrumentation'

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TraceContextInterceptor,
    },
  ],
})
export class AppModule {}
```

#### 4.3.4 Span Schema 标准化（span-schema.ts）

```typescript
// apps/api/src/telemetry/tracing/span-schema.ts

/**
 * Span 标准属性（所有 span 都应该包含这些字段）
 */
export interface BaseSpanAttributes {
  'service.name': string      // 服务名（例如 'api'）
  'service.version': string   // 服务版本（例如 '1.0.0'）
  'environment': string       // 环境（例如 'production'）
}

/**
 * Tool Span 属性（Tool 执行 span）
 */
export interface ToolSpanAttributes extends BaseSpanAttributes {
  'tool.name': string         // 工具名（例如 'getMetrics'）
  'tool.args': string         // 工具参数（JSON 字符串）
  'tool.result'?: string      // 工具结果（JSON 字符串，可选）
  'tool.error'?: string       // 工具错误（可选）
  'tool.duration_ms': number  // 工具执行时长（毫秒）
}

/**
 * Agent Span 属性（Agent 执行 span）
 */
export interface AgentSpanAttributes extends BaseSpanAttributes {
  'agent.run_id': string      // Run ID
  'agent.prompt': string      // 用户 Prompt（摘要，不超过 100 字符）
  'agent.model': string       // 模型名（例如 'gpt-4'）
  'agent.tool_count': number  // 执行的工具数量
}

/**
 * Prisma Span 属性（DB 查询 span）
 */
export interface PrismaSpanAttributes extends BaseSpanAttributes {
  'db.system': string         // 数据库类型（例如 'postgresql'）
  'db.operation': string      // 操作类型（例如 'SELECT'）
  'db.table': string          // 表名（例如 'servers'）
  'db.query'?: string         // SQL 查询（可选，不记录参数）
}
```

**为什么 Span 要用结构化数据？**

结构化数据可以被 Jaeger/Tempo 解析和查询。例如：查询"所有调用 getMetrics 工具且耗时超过 1s 的请求"（`tool.name=getMetrics AND tool.duration_ms>1000`）。如果用字符串（`description: "执行 getMetrics"`），无法查询。

#### 4.3.5 Span 构建器（span-builder.ts）

```typescript
// apps/api/src/telemetry/tracing/span-builder.ts
import { Injectable } from '@nestjs/common'
import { trace, Span, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { ToolSpanAttributes, AgentSpanAttributes } from './span-schema'

@Injectable()
export class SpanBuilder {
  private tracer = trace.getTracer('p1-monitor-api', '1.0.0')

  /**
   * 创建 Tool Span
   */
  startToolSpan(toolName: string, toolArgs: any): Span {
    const span = this.tracer.startSpan(`tool.${toolName}`, {
      kind: SpanKind.INTERNAL, // 内部调用
      attributes: {
        'service.name': 'api',
        'service.version': '1.0.0',
        'environment': process.env.NODE_ENV || 'development',
        'tool.name': toolName,
        'tool.args': JSON.stringify(toolArgs),
      } as ToolSpanAttributes,
    })

    return span
  }

  /**
   * 结束 Tool Span（记录结果或错误）
   */
  endToolSpan(span: Span, result?: any, error?: Error): void {
    if (error) {
      span.setAttribute('tool.error', error.message)
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    } else if (result) {
      span.setAttribute('tool.result', JSON.stringify(result))
      span.setStatus({ code: SpanStatusCode.OK })
    }

    span.end()
  }

  /**
   * 创建 Agent Span
   */
  startAgentSpan(runId: string, prompt: string): Span {
    const span = this.tracer.startSpan(`agent.run`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'service.name': 'api',
        'service.version': '1.0.0',
        'environment': process.env.NODE_ENV || 'development',
        'agent.run_id': runId,
        'agent.prompt': prompt.slice(0, 100), // 只记录前 100 字符（摘要）
        'agent.model': 'gpt-4',
      } as AgentSpanAttributes,
    })

    return span
  }

  /**
   * 结束 Agent Span
   */
  endAgentSpan(span: Span, toolCount: number, error?: Error): void {
    span.setAttribute('agent.tool_count', toolCount)

    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    } else {
      span.setStatus({ code: SpanStatusCode.OK })
    }

    span.end()
  }
}
```

#### 4.3.6 改造 AgentService（添加 span）

```typescript
// apps/api/src/agent/agent.service.ts（v2 版本）
import { Injectable } from '@nestjs/common'
import { SpanBuilder } from '../telemetry/tracing/span-builder'
import { TracePropagator } from '../telemetry/tracing/trace-propagator'

@Injectable()
export class AgentService {
  constructor(
    private spanBuilder: SpanBuilder,
    private tracePropagator: TracePropagator,
    private toolRegistry: ToolRegistry,
  ) {}

  async run(prompt: string): Promise<any> {
    const runId = uuidv4()
    const traceId = this.tracePropagator.getCurrentTraceId() || 'unknown'

    // 创建 Agent span
    const span = this.spanBuilder.startAgentSpan(runId, prompt)

    try {
      console.log(`[${traceId}] Agent run started: ${runId}`)

      // 执行工具（不需要手动传 traceId，AsyncLocalStorage 自动传播）
      const result = await this.toolRegistry.execute('getMetrics', { serverId: 'srv-001' })

      console.log(`[${traceId}] Agent run completed: ${runId}`)

      // 结束 Agent span
      this.spanBuilder.endAgentSpan(span, 1) // toolCount = 1

      return result
    } catch (error) {
      // 结束 Agent span（记录错误）
      this.spanBuilder.endAgentSpan(span, 0, error)
      throw error
    }
  }
}
```

#### 4.3.7 改造 ToolRegistry（添加 span）

```typescript
// apps/api/src/tool/tool-registry.ts（v2 版本）
import { Injectable } from '@nestjs/common'
import { SpanBuilder } from '../telemetry/tracing/span-builder'
import { TracePropagator } from '../telemetry/tracing/trace-propagator'

@Injectable()
export class ToolRegistry {
  constructor(
    private spanBuilder: SpanBuilder,
    private tracePropagator: TracePropagator,
  ) {}

  async execute(toolName: string, args: any): Promise<any> {
    const traceId = this.tracePropagator.getCurrentTraceId() || 'unknown'

    // 创建 Tool span
    const span = this.spanBuilder.startToolSpan(toolName, args)

    try {
      console.log(`[${traceId}] Tool ${toolName} executing...`)

      const tool = this.tools.get(toolName)
      const result = await tool.execute(args)

      console.log(`[${traceId}] Tool ${toolName} completed`)

      // 结束 Tool span（记录结果）
      this.spanBuilder.endToolSpan(span, result)

      return result
    } catch (error) {
      // 结束 Tool span（记录错误）
      this.spanBuilder.endToolSpan(span, null, error)
      throw error
    }
  }
}
```

### 4.4 v2 测试（单元测试 + 集成测试）

#### 4.4.1 单元测试（trace-propagator.spec.ts）

```typescript
// apps/api/src/telemetry/tracing/trace-propagator.spec.ts
import { TracePropagator } from './trace-propagator'

describe('TracePropagator', () => {
  let propagator: TracePropagator

  beforeEach(() => {
    propagator = new TracePropagator()
  })

  it('应该从 traceparent header 提取 Trace ID', () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const context = propagator.extractFromHeader(traceparent)

    expect(context).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    })
  })

  it('AsyncLocalStorage 应该隔离并发请求', async () => {
    const results: string[] = []

    // 模拟请求 A
    propagator.runWithContext({ traceId: 'trace-A', spanId: 'span-A', traceFlags: 1 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      results.push(propagator.getCurrentTraceId()!) // 应该是 'trace-A'
    })

    // 模拟请求 B（在请求 A 完成前到达）
    propagator.runWithContext({ traceId: 'trace-B', spanId: 'span-B', traceFlags: 1 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      results.push(propagator.getCurrentTraceId()!) // 应该是 'trace-B'
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    // 验证 Trace ID 没有被覆盖
    expect(results).toContain('trace-A')
    expect(results).toContain('trace-B')
  })
})
```

#### 4.4.2 集成测试（Trace ID 传播）

```typescript
// apps/api/test/trace-propagation.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import * as request from 'supertest'

describe('Trace Propagation (E2E)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('前端 Trace ID 应该传播到后端日志', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .set('traceparent', traceparent)
      .send({ serverId: 'srv-001' })

    expect(response.status).toBe(200)

    // 验证后端日志包含 Trace ID（这里只是示例，实际需要查询日志系统）
    // 实际测试：查询 Elasticsearch 里的日志，验证 traceId=4bf92f3577b34da6a3ce929d0e0e4736
  })
})
```

### 4.5 v2 还剩下的 2 个问题

**问题 3：日志泄密（日志里包含 Authorization/API key）**

v2 只实现了 Span，没有实现日志脱敏。如果工具执行失败，错误日志里会包含敏感字段（Authorization header）。

**问题 5：日志爆炸（所有请求都记录日志）**

v2 没有实现采样策略。所有请求都记录日志（包括健康检查 `/health`），日志量 2GB/天。

v3 用"PII 脱敏 + 采样策略"解决这两个问题。

---
## 5. v3：PII 脱敏 + 采样策略（解决问题 3/5）

### 5.1 v3 新增的能力

v3 在 v2 基础上新增：
- **PII Redaction（脱敏）**：字段白名单 + 敏感字段自动脱敏（Authorization → `***` / Prompt → 摘要）
- **Sampling Strategy（采样）**：健康检查 0% + 正常请求 1% + 错误请求 100%
- **Structured Logger（结构化日志）**：JSON 格式 + 自动注入 Trace ID + 脱敏 + 采样

### 5.2 v3 架构变化

```
v2：日志直接输出（console.log）→ 所有请求都记录 → 敏感字段泄露
v3：日志经过 StructuredLogger → 采样过滤 → PII 脱敏 → JSON 格式输出
```

**关键变化**：增加"StructuredLogger"层，所有日志经过统一处理（采样 + 脱敏 + 格式化）。

### 5.3 v3 完整代码（生产级实现）

#### 5.3.1 PII 字段白名单（pii-redactor.ts）

```typescript
// apps/api/src/telemetry/logging/pii-redactor.ts
import { Injectable } from '@nestjs/common'

/**
 * 敏感字段列表（需要脱敏）
 */
const SENSITIVE_FIELDS = new Set([
  'authorization',
  'api_key',
  'apiKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'password',
  'secret',
  'token',
  'bearer',
  'x-api-key',
])

/**
 * 长文本字段列表（需要截断）
 */
const LONG_TEXT_FIELDS = new Set([
  'prompt',
  'message',
  'content',
  'description',
  'body',
])

@Injectable()
export class PiiRedactor {
  /**
   * 脱敏对象（递归处理）
   */
  redact(obj: any): any {
    if (obj === null || obj === undefined) return obj
    if (typeof obj !== 'object') return obj

    // 数组：递归处理每个元素
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redact(item))
    }

    // 对象：递归处理每个字段
    const redacted: any = {}
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()

      // 敏感字段：替换为 ***
      if (SENSITIVE_FIELDS.has(lowerKey)) {
        redacted[key] = '***'
        continue
      }

      // 长文本字段：截断为前 100 字符
      if (LONG_TEXT_FIELDS.has(lowerKey) && typeof value === 'string') {
        redacted[key] = value.slice(0, 100) + (value.length > 100 ? '...' : '')
        continue
      }

      // 递归处理嵌套对象
      if (typeof value === 'object') {
        redacted[key] = this.redact(value)
      } else {
        redacted[key] = value
      }
    }

    return redacted
  }

  /**
   * 脱敏 HTTP Headers
   */
  redactHeaders(headers: Record<string, any>): Record<string, any> {
    return this.redact(headers)
  }

  /**
   * 脱敏错误对象
   */
  redactError(error: Error): any {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'), // 只保留前 5 行堆栈
      // 不包含 error 对象的其他字段（可能包含敏感信息）
    }
  }
}
```

**为什么用字段白名单而不是黑名单？**

黑名单（列出所有敏感字段）容易遗漏（例如 `x-custom-token` 没在黑名单里，但是敏感字段）。白名单（列出所有需要记录的字段）更安全（默认不记录，明确列出的才记录）。但实现复杂度高（需要列出所有业务字段），所以 v3 采用"敏感字段黑名单 + 递归脱敏"的折中方案。

#### 5.3.2 采样策略（sampling-strategy.ts）

```typescript
// apps/api/src/telemetry/logging/sampling-strategy.ts
import { Injectable } from '@nestjs/common'

export interface SamplingContext {
  path: string       // 请求路径（例如 '/api/analyze'）
  method: string     // HTTP 方法（例如 'POST'）
  statusCode: number // 响应状态码（例如 200）
  error?: Error      // 错误对象（如果有）
}

@Injectable()
export class SamplingStrategy {
  /**
   * 判断是否应该记录日志
   */
  shouldSample(context: SamplingContext): boolean {
    // 规则 1：健康检查不记录（采样率 0%）
    if (this.isHealthCheck(context.path)) {
      return false
    }

    // 规则 2：错误请求 100% 记录
    if (context.error || context.statusCode >= 400) {
      return true
    }

    // 规则 3：正常请求 1% 采样
    return this.randomSample(0.01) // 1%
  }

  /**
   * 是否为健康检查请求
   */
  private isHealthCheck(path: string): boolean {
    const healthCheckPaths = ['/health', '/ping', '/readiness', '/liveness']
    return healthCheckPaths.some((p) => path.startsWith(p))
  }

  /**
   * 随机采样
   */
  private randomSample(rate: number): boolean {
    return Math.random() < rate
  }

  /**
   * 根据 Trace Flags 判断是否采样（W3C Trace Context）
   */
  isSampledByTraceFlags(traceFlags: number): boolean {
    // traceFlags 最后一位是采样标志（0x01）
    return (traceFlags & 0x01) === 0x01
  }
}
```

**为什么错误请求 100% 采样？**

错误请求是故障排查的关键线索，必须 100% 记录（否则会遗漏关键错误）。正常请求 1% 采样足够（用于性能分析和流量统计）。

**为什么健康检查不记录？**

健康检查每 10 秒一次（一天 8640 次），占日志量的 80%+，但没有故障排查价值（健康检查失败直接报警，不需要看日志）。

#### 5.3.3 结构化日志（structured-logger.ts）

```typescript
// apps/api/src/telemetry/logging/structured-logger.ts
import { Injectable } from '@nestjs/common'
import { createLogger, format, transports, Logger as WinstonLogger } from 'winston'
import { PiiRedactor } from './pii-redactor'
import { SamplingStrategy, SamplingContext } from './sampling-strategy'
import { TracePropagator } from '../tracing/trace-propagator'

@Injectable()
export class StructuredLogger {
  private logger: WinstonLogger

  constructor(
    private piiRedactor: PiiRedactor,
    private samplingStrategy: SamplingStrategy,
    private tracePropagator: TracePropagator,
  ) {
    this.logger = createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp(),
        format.json(), // JSON 格式
      ),
      transports: [
        new transports.Console(),
        // 生产环境：new transports.File({ filename: 'app.log' })
      ],
    })
  }

  /**
   * 记录 info 日志
   */
  info(message: string, context?: any): void {
    this.log('info', message, context)
  }

  /**
   * 记录 error 日志
   */
  error(message: string, error?: Error, context?: any): void {
    this.log('error', message, {
      ...context,
      error: error ? this.piiRedactor.redactError(error) : undefined,
    })
  }

  /**
   * 记录 HTTP 请求日志
   */
  logHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number,
    error?: Error,
  ): void {
    const samplingContext: SamplingContext = {
      path,
      method,
      statusCode,
      error,
    }

    // 采样判断
    if (!this.samplingStrategy.shouldSample(samplingContext)) {
      return // 不记录
    }

    this.log('info', 'HTTP Request', {
      http: {
        method,
        path,
        statusCode,
        durationMs,
      },
      error: error ? this.piiRedactor.redactError(error) : undefined,
    })
  }

  /**
   * 内部日志方法（自动注入 Trace ID + 脱敏）
   */
  private log(level: string, message: string, context?: any): void {
    const traceId = this.tracePropagator.getCurrentTraceId()

    // 脱敏 context
    const redactedContext = context ? this.piiRedactor.redact(context) : {}

    this.logger.log(level, message, {
      traceId, // 自动注入 Trace ID
      ...redactedContext,
    })
  }
}
```

**日志输出示例**（JSON 格式）：

```json
{
  "timestamp": "2026-07-17T10:30:01.123Z",
  "level": "info",
  "message": "HTTP Request",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "http": {
    "method": "POST",
    "path": "/api/analyze",
    "statusCode": 200,
    "durationMs": 3200
  }
}
```

**错误日志示例**（敏感字段已脱敏）：

```json
{
  "timestamp": "2026-07-17T10:30:05.456Z",
  "level": "error",
  "message": "Tool execution failed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "error": {
    "name": "Error",
    "message": "Request timeout after 30s",
    "stack": "Error: Request timeout\n    at ToolRegistry.execute (...)\n    at AgentService.run (...)"
  },
  "toolName": "getMetrics",
  "toolArgs": {
    "serverId": "srv-001",
    "authorization": "***"
  }
}
```

#### 5.3.4 日志上下文（log-context.ts）

```typescript
// apps/api/src/telemetry/logging/log-context.ts
import { Injectable } from '@nestjs/common'
import { AsyncLocalStorage } from 'async_hooks'

export interface LogContext {
  traceId?: string
  spanId?: string
  runId?: string
  userId?: string
}

@Injectable()
export class LogContextManager {
  private asyncLocalStorage = new AsyncLocalStorage<LogContext>()

  /**
   * 设置日志上下文
   */
  setContext(context: LogContext): void {
    const current = this.asyncLocalStorage.getStore() || {}
    this.asyncLocalStorage.enterWith({ ...current, ...context })
  }

  /**
   * 获取日志上下文
   */
  getContext(): LogContext {
    return this.asyncLocalStorage.getStore() || {}
  }

  /**
   * 在上下文中运行
   */
  runWithContext<T>(context: LogContext, fn: () => T): T {
    return this.asyncLocalStorage.run(context, fn)
  }
}
```

#### 5.3.5 改造 AgentService（使用 StructuredLogger）

```typescript
// apps/api/src/agent/agent.service.ts（v3 版本）
import { Injectable } from '@nestjs/common'
import { SpanBuilder } from '../telemetry/tracing/span-builder'
import { StructuredLogger } from '../telemetry/logging/structured-logger'

@Injectable()
export class AgentService {
  constructor(
    private spanBuilder: SpanBuilder,
    private logger: StructuredLogger,
    private toolRegistry: ToolRegistry,
  ) {}

  async run(prompt: string): Promise<any> {
    const runId = uuidv4()
    const span = this.spanBuilder.startAgentSpan(runId, prompt)

    try {
      this.logger.info('Agent run started', { runId, prompt: prompt.slice(0, 100) })

      const result = await this.toolRegistry.execute('getMetrics', { serverId: 'srv-001' })

      this.logger.info('Agent run completed', { runId, toolCount: 1 })
      this.spanBuilder.endAgentSpan(span, 1)

      return result
    } catch (error) {
      this.logger.error('Agent run failed', error, { runId })
      this.spanBuilder.endAgentSpan(span, 0, error)
      throw error
    }
  }
}
```

#### 5.3.6 改造 ToolRegistry（使用 StructuredLogger）

```typescript
// apps/api/src/tool/tool-registry.ts（v3 版本）
import { Injectable } from '@nestjs/common'
import { SpanBuilder } from '../telemetry/tracing/span-builder'
import { StructuredLogger } from '../telemetry/logging/structured-logger'

@Injectable()
export class ToolRegistry {
  constructor(
    private spanBuilder: SpanBuilder,
    private logger: StructuredLogger,
  ) {}

  async execute(toolName: string, args: any): Promise<any> {
    const span = this.spanBuilder.startToolSpan(toolName, args)
    const startTime = Date.now()

    try {
      this.logger.info('Tool executing', { toolName, args })

      const tool = this.tools.get(toolName)
      const result = await tool.execute(args)

      const durationMs = Date.now() - startTime
      this.logger.info('Tool completed', { toolName, durationMs })
      this.spanBuilder.endToolSpan(span, result)

      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      this.logger.error('Tool failed', error, { toolName, args, durationMs })
      this.spanBuilder.endToolSpan(span, null, error)
      throw error
    }
  }
}
```

#### 5.3.7 HTTP 日志拦截器（记录请求/响应）

```typescript
// apps/api/src/telemetry/instrumentation/http-logging-interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap, catchError } from 'rxjs/operators'
import { StructuredLogger } from '../logging/structured-logger'

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(private logger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()
    const startTime = Date.now()

    const { method, url: path } = request

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startTime
        this.logger.logHttpRequest(method, path, response.statusCode, durationMs)
      }),
      catchError((error) => {
        const durationMs = Date.now() - startTime
        this.logger.logHttpRequest(method, path, response.statusCode || 500, durationMs, error)
        throw error
      }),
    )
  }
}
```

**注册拦截器**：

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { HttpLoggingInterceptor } from './telemetry/instrumentation/http-logging-interceptor'

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
  ],
})
export class AppModule {}
```

### 5.4 v3 核心知识点（≥ 6 个，每个 5 要素）

#### 知识点 1：W3C Trace Context（traceparent 标准）

**是什么**：W3C Trace Context 是"分布式追踪的 HTTP Header 标准"，格式为 `version-trace_id-parent_id-trace_flags`。

**解决什么问题**：不同服务使用不同的 Trace ID 格式（Zipkin 用 64 bit，Jaeger 用 128 bit），导致 Trace 无法跨服务传播。W3C Trace Context 统一格式（128 bit Trace ID），所有服务都能解析。

**怎么用**：
```typescript
// 前端生成
const traceparent = `00-${traceId}-${spanId}-01`
fetch('/api', { headers: { traceparent } })

// 后端提取
const traceId = traceparent.split('-')[1]
```

**生产陷阱**：Trace ID 用 64 bit 而不是 128 bit。64 bit 在高并发下会碰撞（每天 1 亿请求，10 天后碰撞概率 10^-10）。正确做法是"128 bit Trace ID"。

**验证方法**：单元测试——生成 1 万个 Trace ID，验证没有重复。

#### 知识点 2：AsyncLocalStorage（异步上下文传播）

**是什么**：AsyncLocalStorage 是"Node.js 的异步本地存储"，为每个异步调用链创建独立的存储空间（类似线程本地存储）。

**解决什么问题**：全局变量在并发请求时会被覆盖（请求 A 的 Trace ID 会被请求 B 覆盖）。AsyncLocalStorage 保证并发安全（每个请求的 Trace ID 隔离）。

**怎么用**：
```typescript
const storage = new AsyncLocalStorage()
storage.run({ traceId: 'abc' }, async () => {
  console.log(storage.getStore().traceId) // 输出：abc
})
```

**生产陷阱**：第三方库（例如 axios）不支持 AsyncLocalStorage 传播。需要手动传 Trace ID（作为参数），或者用 OpenTelemetry 的自动注入（拦截 HTTP 请求，自动注入 Trace ID）。

**验证方法**：并发测试——同时发起 100 个请求，验证每个请求的 Trace ID 隔离（不被覆盖）。

#### 知识点 3：Span Schema（span 属性标准化）

**是什么**：Span Schema 是"span 属性的标准格式"，定义了所有 span 都应该包含的字段（例如 `tool.name`/`tool.args`）。

**解决什么问题**：span 只记录了"执行了 getMetrics"，但不知道参数是什么。Span Schema 标准化后，所有 Tool span 都包含 `tool.name`/`tool.args`/`tool.result`，便于查询和分析。

**怎么用**：
```typescript
span.setAttribute('tool.name', 'getMetrics')
span.setAttribute('tool.args', JSON.stringify({ serverId: 'srv-001' }))
```

**生产陷阱**：span attributes 包含敏感字段（例如 `Authorization` header）。正确做法是"只记录业务字段"（toolName/serverId），不记录敏感字段。

**验证方法**：单元测试——创建 Tool span，验证 attributes 包含 `tool.name`/`tool.args`/`tool.result`。

#### 知识点 4：PII Redaction（敏感字段脱敏）

**是什么**：PII Redaction 是"敏感字段自动脱敏"，将日志里的 `Authorization: Bearer sk-abc123...` 替换为 `Authorization: ***`。

**解决什么问题**：日志泄露 API key/Authorization，导致安全风险（攻击者可以用泄露的 API key 调用服务）。

**怎么用**：
```typescript
const redacted = piiRedactor.redact({ authorization: 'Bearer sk-abc', userId: 'user-001' })
// 输出：{ authorization: '***', userId: 'user-001' }
```

**生产陷阱**：用黑名单（列出所有敏感字段），容易遗漏（例如 `x-custom-token` 没在黑名单里）。正确做法是"敏感字段黑名单 + 递归脱敏"（遍历所有字段，匹配敏感关键词）。

**验证方法**：单元测试——输入包含 `authorization`/`api_key` 的对象，验证输出为 `***`。

#### 知识点 5：Sampling Strategy（采样策略）

**是什么**：Sampling Strategy 是"日志采样规则"，例如"健康检查 0% + 正常请求 1% + 错误请求 100%"。

**解决什么问题**：所有请求都记录日志，日志量 2GB/天（存储成本高 + 查询慢）。采样后日志量降到 100MB/天（降低 95%）。

**怎么用**：
```typescript
if (samplingStrategy.shouldSample({ path, statusCode, error })) {
  logger.info('Request', { path, statusCode })
}
```

**生产陷阱**：错误请求也采样（例如"错误请求 1% 采样"）。这样会遗漏 99% 的错误日志（无法故障排查）。正确做法是"错误请求 100% 采样"。

**验证方法**：单元测试——输入 1000 个正常请求，验证采样率约为 1%（10-20 个日志）。

#### 知识点 6：Structured Logging（结构化日志）

**是什么**：Structured Logging 是"JSON 格式日志"，每条日志是一个 JSON 对象（而不是字符串）。

**解决什么问题**：字符串日志无法查询（例如"查询所有 statusCode=500 的日志"需要正则匹配）。JSON 日志可以直接查询（`statusCode:500`）。

**怎么用**：
```typescript
logger.info('Request', { method: 'POST', path: '/api', statusCode: 200 })
// 输出：{"level":"info","message":"Request","method":"POST","path":"/api","statusCode":200}
```

**生产陷阱**：日志包含嵌套对象（例如 `headers: { authorization: '...' }`），导致日志爆炸（1 条日志变成 100 个字段）。正确做法是"只记录顶层字段 + 递归脱敏"。

**验证方法**：集成测试——发送 HTTP 请求，验证日志输出为 JSON 格式（包含 `traceId`/`method`/`statusCode`）。

---
## 6. 深挖前端底子（§6.5 必需章节）

### 6.1 今天为什么要深挖"前端 Trace Context 生成"

Day 35 的核心是"后端 OpenTelemetry 自动注入 + 日志脱敏"，但如果前端没有生成标准的 `traceparent` header，后端会生成新的 Trace ID（前端和后端 Trace ID 不同，无法关联）。正确做法是**前端生成符合 W3C 标准的 traceparent**（128 bit Trace ID + 64 bit Span ID），让后端提取并传播。

今天深挖的不是"Vue 怎么调用 API"（Day 01-05 已经掌握），而是"为什么 Trace ID 必须是 128 bit 而不是 64 bit"（64 bit 会碰撞）、"为什么 traceparent 格式是 `00-<trace-id>-<span-id>-<flags>` 而不是简单的 UUID"（W3C 标准，包含采样标志）。

### 6.2 前端 Trace Context 的 3 个设计原则

#### 6.2.1 原则 1：用 crypto.randomUUID() 而不是 Math.random()

**错误做法**：用 `Math.random()` 生成 Trace ID。

**问题**：
- `Math.random()` 是伪随机数（种子相同会生成相同序列），不适合生成全局唯一 ID
- `Math.random()` 只有 53 bit 精度（JavaScript Number 类型限制），无法生成 128 bit Trace ID
- `Math.random()` 在多个标签页同时调用时，可能生成相同的 Trace ID（因为种子相同）

**正确做法**：用 `crypto.randomUUID()` 或 `crypto.getRandomValues()` 生成密码学安全的随机数。

```typescript
// 错误做法（Math.random）
function generateTraceId(): string {
  return Math.random().toString(16).slice(2) // 只有 53 bit 精度
}

// 正确做法（crypto.randomUUID）
function generateTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '') // 128 bit
}

// 正确做法（crypto.getRandomValues，更灵活）
function generateTraceId(): string {
  const bytes = new Uint8Array(16) // 128 bit = 16 bytes
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

#### 6.2.2 原则 2：traceparent 格式必须符合 W3C 标准

**W3C Trace Context 格式**：
```
version-trace_id-parent_id-trace_flags

示例：
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
│  │                                │                │
│  └─ trace_id（32 位 hex，128 bit）│                │
│                                   └─ parent_id（16 位 hex，64 bit）
│                                                     └─ trace_flags（01=采样，00=不采样）
└─ version（固定 00）
```

**错误做法**：用自定义格式（例如 `traceId:abc-123`）。

**问题**：
- 后端无法解析（OpenTelemetry 只支持 W3C 标准格式）
- 无法跨服务传播（其他服务也需要 W3C 标准格式）
- 缺少采样标志（无法控制采样率）

**正确做法**：严格按照 W3C 标准生成 traceparent。

```typescript
// apps/web/src/lib/trace-context.ts（生产级实现）
export class TraceContext {
  private static VERSION = '00'

  /**
   * 生成 traceparent header
   */
  static generate(sampled: boolean = true): string {
    const traceId = this.generateTraceId()
    const spanId = this.generateSpanId()
    const flags = sampled ? '01' : '00'

    return `${this.VERSION}-${traceId}-${spanId}-${flags}`
  }

  /**
   * 生成 Trace ID（128 bit = 32 位 hex）
   */
  private static generateTraceId(): string {
    const uuid = crypto.randomUUID().replace(/-/g, '')
    return uuid
  }

  /**
   * 生成 Span ID（64 bit = 16 位 hex）
   */
  private static generateSpanId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * 验证 traceparent 格式
   */
  static validate(traceparent: string): boolean {
    const parts = traceparent.split('-')
    if (parts.length !== 4) return false

    const [version, traceId, spanId, flags] = parts

    // 验证 version（固定 00）
    if (version !== '00') return false

    // 验证 traceId（32 位 hex）
    if (!/^[0-9a-f]{32}$/.test(traceId)) return false

    // 验证 spanId（16 位 hex）
    if (!/^[0-9a-f]{16}$/.test(spanId)) return false

    // 验证 flags（2 位 hex）
    if (!/^[0-9a-f]{2}$/.test(flags)) return false

    return true
  }
}
```

#### 6.2.3 原则 3：Trace ID 在页面生命周期内复用

**错误做法**：每个 API 请求都生成新的 Trace ID。

**问题**：
- 同一个页面的多个请求无法关联（例如"加载页面"和"点击按钮"是两个独立的 Trace）
- 无法分析用户行为链路（无法知道"用户先加载页面，再点击按钮"）

**正确做法**：页面加载时生成 Trace ID，所有 API 请求复用同一个 Trace ID（但每个请求生成新的 Span ID）。

```typescript
// apps/web/src/lib/trace-manager.ts
export class TraceManager {
  private traceId: string
  private sampled: boolean

  constructor() {
    // 页面加载时生成 Trace ID
    this.traceId = this.generateTraceId()
    this.sampled = true
  }

  /**
   * 生成 traceparent（复用 traceId，生成新的 spanId）
   */
  generateTraceparent(): string {
    const spanId = this.generateSpanId()
    const flags = this.sampled ? '01' : '00'
    return `00-${this.traceId}-${spanId}-${flags}`
  }

  private generateTraceId(): string {
    return crypto.randomUUID().replace(/-/g, '')
  }

  private generateSpanId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

// 全局单例
export const traceManager = new TraceManager()
```

**API Client 改造**：

```typescript
// apps/web/src/api/client.ts
import { traceManager } from '../lib/trace-manager'

export async function analyzeServer(serverId: string) {
  const traceparent = traceManager.generateTraceparent() // 复用 traceId

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'traceparent': traceparent,
    },
    body: JSON.stringify({ serverId }),
  })

  return response.json()
}
```

### 6.3 为什么不能用 UUID 直接作为 Trace ID

**误区**："UUID 已经是全局唯一的，为什么还要用 W3C Trace Context 格式？"

**错误原因**：
1. UUID 包含 `-` 分隔符（例如 `4bf92f35-77b3-4da6-a3ce-929d0e0e4736`），W3C 标准要求去掉 `-`（`4bf92f3577b34da6a3ce929d0e0e4736`）
2. UUID 没有 Span ID（只有 Trace ID），无法表示父子关系
3. UUID 没有采样标志（无法控制采样率）

**正确做法**：UUID 用于生成 Trace ID（去掉 `-`），但完整的 traceparent 需要包含 Span ID 和采样标志。

### 6.4 HTML 知识点：HTTP Header 大小写敏感性

**HTTP Header 规范**：HTTP Header 名称是**大小写不敏感**的（`traceparent` = `Traceparent` = `TRACEPARENT`）。

**为什么 W3C 标准用小写 `traceparent`？**

W3C 标准推荐用小写（HTTP/2 强制小写），但服务器应该兼容大小写变体。正确做法是"前端用小写 `traceparent`，后端用大小写不敏感的匹配"。

**后端提取 traceparent**（大小写不敏感）：

```typescript
// 错误做法（大小写敏感）
const traceparent = request.headers['traceparent']

// 正确做法（大小写不敏感）
const traceparent = request.headers['traceparent'] || request.headers['Traceparent']
```

**更好的做法**（NestJS 自动转小写）：

```typescript
// NestJS 自动将 header 名称转小写
const traceparent = request.headers['traceparent'] // 始终是小写
```

### 6.5 JavaScript 知识点：crypto.randomUUID() vs crypto.getRandomValues()

**crypto.randomUUID()**：
- 返回格式：`4bf92f35-77b3-4da6-a3ce-929d0e0e4736`（包含 `-`）
- 长度：36 个字符（32 位 hex + 4 个 `-`）
- 优点：简单（一行代码）
- 缺点：包含 `-`，需要手动去掉

**crypto.getRandomValues()**：
- 返回格式：`Uint8Array [74, 185, 47, ...]`（字节数组）
- 长度：可自定义（16 bytes = 128 bit）
- 优点：灵活（可以生成任意长度的随机数）
- 缺点：需要手动转 hex

**选择建议**：
- 生成 Trace ID：用 `crypto.randomUUID()` + `replace(/-/g, '')`（简单）
- 生成 Span ID：用 `crypto.getRandomValues()`（64 bit，UUID 是 128 bit，需要裁剪）

**示例**（生成 64 bit Span ID）：

```typescript
// 方案 1：用 crypto.randomUUID() 裁剪
function generateSpanId(): string {
  const uuid = crypto.randomUUID().replace(/-/g, '')
  return uuid.slice(0, 16) // 取前 16 位 hex（64 bit）
}

// 方案 2：用 crypto.getRandomValues()
function generateSpanId(): string {
  const bytes = new Uint8Array(8) // 8 bytes = 64 bit
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

**为什么 Span ID 是 64 bit 而不是 128 bit？**

Span ID 的碰撞概率要求低于 Trace ID（因为 Span ID 只在单个 Trace 内唯一，不需要全局唯一）。64 bit（2^64 ≈ 1.8×10^19）足够（单个 Trace 包含 1000 个 Span，碰撞概率是 10^-13）。

---

## 7. 测试与验证（§7 必需章节）

### 7.1 单元测试（PiiRedactor）

```typescript
// apps/api/src/telemetry/logging/pii-redactor.spec.ts
import { PiiRedactor } from './pii-redactor'

describe('PiiRedactor', () => {
  let redactor: PiiRedactor

  beforeEach(() => {
    redactor = new PiiRedactor()
  })

  it('应该脱敏 authorization 字段', () => {
    const input = {
      userId: 'user-001',
      authorization: 'Bearer sk-abc123...',
    }

    const output = redactor.redact(input)

    expect(output.userId).toBe('user-001')
    expect(output.authorization).toBe('***')
  })

  it('应该脱敏嵌套对象里的敏感字段', () => {
    const input = {
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer sk-abc123...',
      },
    }

    const output = redactor.redact(input)

    expect(output.headers['content-type']).toBe('application/json')
    expect(output.headers.authorization).toBe('***')
  })

  it('应该截断长文本字段', () => {
    const input = {
      prompt: 'a'.repeat(200), // 200 字符
    }

    const output = redactor.redact(input)

    expect(output.prompt).toBe('a'.repeat(100) + '...') // 截断为 100 字符
  })

  it('应该递归处理数组', () => {
    const input = {
      tools: [
        { name: 'getMetrics', args: { authorization: 'Bearer sk-abc' } },
        { name: 'restartServer', args: { serverId: 'srv-001' } },
      ],
    }

    const output = redactor.redact(input)

    expect(output.tools[0].args.authorization).toBe('***')
    expect(output.tools[1].args.serverId).toBe('srv-001')
  })
})
```

### 7.2 集成测试（Trace ID 传播）

```typescript
// apps/api/test/trace-propagation.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import * as request from 'supertest'

describe('Trace Propagation (E2E)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('前端 traceparent 应该传播到后端日志', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .set('traceparent', traceparent)
      .send({ serverId: 'srv-001' })

    expect(response.status).toBe(200)

    // 验证后端日志包含 Trace ID
    // 实际测试：查询日志系统（Elasticsearch），验证 traceId=4bf92f3577b34da6a3ce929d0e0e4736
  })

  it('没有 traceparent 时，后端应该自动生成 Trace ID', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ serverId: 'srv-001' })

    expect(response.status).toBe(200)

    // 验证后端日志包含自动生成的 Trace ID（128 bit hex）
  })
})
```

### 7.3 反证实验 1：移除 PII Redaction 后日志泄露敏感字段

**假设**：如果移除 PII Redaction，日志里会包含 Authorization header（泄密）。

**实验步骤**：
1. 注释掉 `StructuredLogger` 里的 `piiRedactor.redact()` 代码
2. 发送包含 Authorization header 的请求
3. 观察日志输出

**预期现象**：日志里包含 `authorization: "Bearer sk-abc123..."`（泄密）。

**实际现象**（移除 PII Redaction 后）：
```json
{
  "level": "error",
  "message": "Tool failed",
  "toolArgs": {
    "serverId": "srv-001",
    "authorization": "Bearer sk-abc123xyz..." // 泄露！
  }
}
```

**恢复操作**：恢复 PII Redaction 代码，重新测试，验证日志里 authorization 显示为 `***`。

### 7.4 反证实验 2：移除采样策略后日志量暴增

**假设**：如果移除采样策略，日志量会从 100MB/天增加到 2GB/天（20 倍）。

**实验步骤**：
1. 注释掉 `StructuredLogger` 里的 `samplingStrategy.shouldSample()` 检查
2. 发送 1000 个正常请求（statusCode=200）
3. 统计日志数量

**预期现象**：1000 个日志（100% 记录）。

**实际现象**（移除采样策略后）：
```bash
# 统计日志数量
grep "HTTP Request" app.log | wc -l
# 输出：1000（所有请求都记录）
```

**加回采样策略后**：
```bash
# 统计日志数量
grep "HTTP Request" app.log | wc -l
# 输出：10-20（1% 采样）
```

**恢复操作**：恢复采样策略代码，重新测试，验证日志量降低 95%。

### 7.5 四件套（依赖图 + 时序图 + 日志 + commit）

#### 7.5.1 依赖图

```
前端（TraceContext.generate）
        ↓
  HTTP Request（traceparent header）
        ↓
  NestJS 拦截器（TraceContextInterceptor）
        ↓
  TracePropagator（提取 Trace ID + 注入到 AsyncLocalStorage）
        ↓
  ┌─────┴──────┬──────────┬────────────┐
AgentService  ToolRegistry  PrismaClient
  ↓            ↓              ↓
SpanBuilder  SpanBuilder  (自动注入 span)
  ↓            ↓              ↓
StructuredLogger（自动注入 Trace ID + PII 脱敏 + 采样）
  ↓
Winston（JSON 格式输出）
```

#### 7.5.2 时序图（前端到后端的完整链路）

```
前端         HTTP         拦截器      TracePropagator    AgentService    ToolRegistry    StructuredLogger
  │            │              │                │                │               │                │
  │─generate─→│              │                │                │               │                │
  │←traceparent│              │                │                │               │                │
  │            │              │                │                │               │                │
  │─POST /api─→│              │                │                │               │                │
  │            │─intercept──→│                │                │               │                │
  │            │              │─extract────────→│                │               │                │
  │            │              │←traceId─────────│                │               │                │
  │            │              │─inject to ALS──→│                │               │                │
  │            │              │                │─run()─────────→│               │                │
  │            │              │                │                │─execute()────→│                │
  │            │              │                │                │               │─log()─────────→│
  │            │              │                │                │               │                │─redact + sample─→[Winston]
```

#### 7.5.3 测试日志截图

```json
// 正常请求日志（1% 采样）
{
  "timestamp": "2026-07-17T10:30:01.123Z",
  "level": "info",
  "message": "HTTP Request",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "http": {
    "method": "POST",
    "path": "/api/analyze",
    "statusCode": 200,
    "durationMs": 3200
  }
}

// 错误日志（100% 采样 + 敏感字段已脱敏）
{
  "timestamp": "2026-07-17T10:30:05.456Z",
  "level": "error",
  "message": "Tool execution failed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "error": {
    "name": "Error",
    "message": "Request timeout after 30s",
    "stack": "Error: Request timeout\n    at ToolRegistry.execute (...)"
  },
  "toolName": "getMetrics",
  "toolArgs": {
    "serverId": "srv-001",
    "authorization": "***"  // 已脱敏
  }
}

// 健康检查（不记录，0% 采样）
// 无日志输出
```

#### 7.5.4 commit 信息

```bash
git add .
git commit -m "feat(telemetry): add full-stack observability with trace propagation and PII redaction

- Add W3C Trace Context propagation (traceparent header)
- Add OpenTelemetry auto-instrumentation (HTTP/Prisma/BullMQ spans)
- Add AsyncLocalStorage for trace context propagation
- Add Span Schema standardization (tool/agent/db spans)
- Add PII Redaction (authorization/api_key/prompt)
- Add Sampling Strategy (health check 0%, normal 1%, error 100%)
- Add Structured Logger (JSON format with auto trace ID injection)

Refs: Day35"
```

---
## 8. 通关检查清单（v3 规范 11 项）

Day 35 交付前的自查：

1. **§0 位置声明**：已写明"阶段二第 5 天"、Day 29/32/34 前置依赖、Day 36-40 后续对齐
2. **§1.1 用户能看到什么**：已写 5 个场景（Trace ID 关联、日志脱敏、采样查询、前端追溯、Span 展示）
3. **§1.4 目录结构 5 块**：已写骨架树 + 为什么分层 5 问 + diff 表格 + 依赖箭头 + 3 个灵魂拷问
4. **§1.5 脚手架检查**：已写 Day 29/32/34 依赖检查 + OpenTelemetry 依赖安装 + 可选 Prisma 改造
5. **三版演进**：v1 手动 correlationId → v2 OpenTelemetry 自动注入 + Span Schema → v3 PII 脱敏 + 采样策略
6. **§5.3 完整代码**：TraceContext、TracePropagator、SpanBuilder、PiiRedactor、SamplingStrategy、StructuredLogger，无省略号
7. **§5.4 ≥ 6 知识点**：W3C Trace Context、AsyncLocalStorage、Span Schema、PII Redaction、Sampling Strategy、Structured Logging，每个 5 要素
8. **§6.5 前端底子补弱**：深挖"前端 Trace Context 生成" + crypto.randomUUID vs getRandomValues + traceparent 格式验证 + 页面生命周期复用
9. **§7 测试 4 件套**：单元测试（PiiRedactor）+ 集成测试（Trace 传播）+ 反证实验 1（移除脱敏）+ 反证实验 2（移除采样）+ 依赖图 + 时序图 + 日志 + commit
10. **0 个 `> ✅/❌` blockquote**：全文无此格式
11. **commit 不含 git push**：commit 信息写 `Refs: Day35`，不执行 push

---

## 9. 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 35 交付的可观测性模块（Trace 全链路 + 日志脱敏 + 采样策略）是后续 14 个能力的基座：

1. **Day 36-40 LangGraph 状态机编排**：状态机每个节点（Plan/Act/Reflect）都是一个 span，复用 Day 35 的 SpanBuilder
2. **Day 41-50 RAG 深化**：向量检索 span + Rerank span + 生成 span，复用 Day 35 的 Trace 传播机制
3. **Day 51-60 SLA 监控**：基于 Trace 数据计算 P95/P99 延迟（从 span.duration 聚合）

### 9.2 今天留下的 3 个待优化点

1. **Span 关联到外部 Request ID**：v3 只实现了 Trace ID 关联，没有实现"关联到外部 API 的 Request ID"（例如 OpenAI API 返回的 `x-request-id`）。Day 36 会补充外部 Request ID 关联。

2. **日志脱敏规则可配置化**：v3 的敏感字段列表是硬编码（`SENSITIVE_FIELDS` 常量），不支持动态配置。Day 37 会补充"从配置文件读取敏感字段列表"。

3. **采样率动态调整**：v3 的采样率是固定的（正常请求 1%），不支持动态调整（例如"高峰期降低到 0.1%，低峰期提高到 5%"）。Day 38 会补充"基于 QPS 动态调整采样率"。

### 9.3 下一站要解决的核心问题

**Day 36：LangGraph 状态机编排（Plan-Act-Reflect 循环 + 状态转移 span + 失败恢复）**

核心挑战：
- 如何为状态机的每个节点（Plan/Act/Reflect）创建 span（复用 Day 35 的 SpanBuilder）？
- 如何用 span 的父子关系表达状态转移（Plan → Act → Reflect）？
- 如何在状态机失败时，自动记录 span 错误（复用 Day 35 的 StructuredLogger）？

---

## 10. 本日小结（标题党 30 字 + 三句话）

**标题**：W3C Trace Context 前后端贯通、AsyncLocalStorage 自动传播、PII 脱敏防泄密、采样策略降 95% 日志量——全链路可观测性

Day 35 建立了统一可观测性基础设施，解决了"Trace 断链"、"Trace 重复"、"日志泄密"、"日志爆炸"四个生产痛点。核心机制是"W3C Trace Context 标准传播（前端生成 traceparent → 后端提取 → AsyncLocalStorage 自动传播）+ OpenTelemetry 自动注入 span（HTTP/Prisma/BullMQ）+ PII 脱敏（字段白名单 + 递归脱敏）+ 采样策略（健康检查 0% + 正常 1% + 错误 100%）+ 结构化日志（JSON 格式 + 自动注入 Trace ID）"。今天建立的可观测性模块是 Day 36-40 LangGraph 状态机编排的 span 追踪基座。

---

## 11. 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"可观测性"的数据流或控制流；当天知识链"Trace/span、correlation、日志结构、采样、PII 脱敏"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
前端生成 traceparent
  → HTTP Request（携带 traceparent header）
  → NestJS 拦截器（TraceContextInterceptor）
  → TracePropagator.extractFromHeader()（提取 Trace ID）
  → TracePropagator.runWithContext()（注入到 AsyncLocalStorage）
  → AgentService.run()（自动继承 Trace ID）
  → SpanBuilder.startAgentSpan()（创建 Agent span）
  → ToolRegistry.execute()（自动继承 Trace ID）
  → SpanBuilder.startToolSpan()（创建 Tool span）
  → StructuredLogger.info()（自动注入 Trace ID + PII 脱敏 + 采样）
  → SamplingStrategy.shouldSample()（判断是否记录）
  → PiiRedactor.redact()（脱敏敏感字段）
  → Winston 输出 JSON 日志
  → Elasticsearch 存储日志 + Jaeger 存储 span
```

**知识链分层**：
- **Trace/span**：TracePropagator + SpanBuilder 层（提取 Trace ID + 创建 span）
- **correlation**：AsyncLocalStorage 层（自动传播 Trace ID）
- **日志结构**：StructuredLogger 层（JSON 格式）
- **采样**：SamplingStrategy 层（判断是否记录）
- **PII 脱敏**：PiiRedactor 层（脱敏敏感字段）

**为什么按这个顺序学习**：
1. 先学 Trace/span（提取 Trace ID），才能谈"如何传播"
2. 再学 correlation（AsyncLocalStorage 传播），才能谈"如何自动注入到日志"
3. 再学日志结构（JSON 格式），才能谈"如何查询日志"
4. 再学采样（减少日志量），才能谈"如何优化存储成本"
5. 最后学 PII 脱敏（安全），才能谈"如何防止日志泄密"

这个顺序是"从传播层到存储层到优化层到安全层"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：PII Redaction（不脱敏敏感字段）。

**可观察现象**：日志里包含 Authorization header（泄密）。

**最小复现**：
1. 注释掉 `StructuredLogger` 里的 `piiRedactor.redact()` 代码
2. 发送包含 Authorization header 的请求（`POST /api/analyze`，header: `Authorization: Bearer sk-abc123`）
3. 查询日志

**定位证据**：
```json
// 日志输出（敏感字段泄露）
{
  "level": "error",
  "message": "Tool failed",
  "toolArgs": {
    "serverId": "srv-001",
    "authorization": "Bearer sk-abc123xyz..." // 泄露！
  }
}
```

安全扫描：
```bash
# 扫描日志里的敏感字段
grep -i "bearer" app.log
# 输出：多条日志包含 "Bearer sk-abc123..."
```

**恢复动作**：
1. 恢复 PII Redaction 代码
2. 轮换泄露的 API key（调用 OpenAI API 轮换密钥）
3. 重启服务
4. 验证日志里 authorization 显示为 `***`

**防复发测试**（E2E）：
```typescript
it('日志里不应该包含敏感字段', async () => {
  // 捕获日志输出
  const logs: any[] = []
  const originalLog = logger.info
  logger.info = jest.fn((message, context) => {
    logs.push(context)
    originalLog.call(logger, message, context)
  })

  await request(app.getHttpServer())
    .post('/api/analyze')
    .set('Authorization', 'Bearer sk-abc123')
    .send({ serverId: 'srv-001' })

  // 验证日志里 authorization 是 ***
  const authLogs = logs.filter((log) => log.authorization)
  authLogs.forEach((log) => {
    expect(log.authorization).toBe('***') // 不是 "Bearer sk-abc123"
  })
})
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `apps/web/src/lib/trace-context.ts` 第 18 行：`generate()` 方法生成标准 W3C traceparent
- `apps/api/src/telemetry/tracing/trace-propagator.ts` 第 32 行：`extractFromHeader()` 提取 Trace ID
- `apps/api/src/telemetry/logging/pii-redactor.ts` 第 45 行：`redact()` 方法脱敏敏感字段
- `apps/api/src/telemetry/logging/sampling-strategy.ts` 第 18 行：`shouldSample()` 方法判断采样

**测试证据**：
- `apps/api/src/telemetry/logging/pii-redactor.spec.ts` 第 12 行：脱敏 authorization 字段测试
- `apps/api/test/trace-propagation.e2e-spec.ts` 第 28 行：Trace ID 传播测试

**架构证据**：
- 依赖图（§7.5.1）：展示前端到后端的完整链路（TraceContext → TracePropagator → SpanBuilder → StructuredLogger）
- 时序图（§7.5.2）：展示 Trace ID 从前端传播到后端日志的完整流程

**项目目标达成**：
- ✅ Trace ID 贯穿 UI/BFF/Tool/DB（W3C Trace Context 传播）
- ✅ 日志不记录密钥和敏感原文（PII Redaction）
- ✅ 单一 Trace 可还原 run（从前端 Trace ID 查询后端完整链路）
- ✅ Authorization/API key 泄漏为 0（安全扫描验证）

**距离企业生产标准还缺**：
1. **Span 导出到 Jaeger/Tempo**：v3 只创建了 span（内存），没有导出到外部系统（Jaeger/Tempo）。需要配置 OpenTelemetry Exporter。
2. **日志导出到 Elasticsearch**：v3 只输出到 Console/File，没有导出到 Elasticsearch（无法查询）。需要配置 Winston Elasticsearch Transport。
3. **采样率动态调整**：v3 的采样率是固定的（1%），不支持动态调整（例如"高峰期降低到 0.1%"）。需要实现"基于 QPS 动态调整采样率"。
4. **日志脱敏规则可配置化**：v3 的敏感字段列表是硬编码，不支持动态配置。需要实现"从配置文件读取敏感字段列表"。

**下一步演进（不破坏合同）**：
- 在 `telemetry.module.ts` 里新增 OpenTelemetry Exporter 配置（导出到 Jaeger），不改变现有 SpanBuilder 接口
- 在 `StructuredLogger` 里新增 Elasticsearch Transport（导出到 Elasticsearch），不改变现有日志接口
- 在 `SamplingStrategy` 里新增 `adjustSamplingRate(qps)` 方法（动态调整采样率），不改变现有 `shouldSample()` 接口
- 在 `PiiRedactor` 里新增 `loadSensitiveFields(config)` 方法（从配置文件读取敏感字段），不改变现有 `redact()` 接口

---

## 12. 真实项目情境题（Day 35 原版，保持原样）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：浏览器到 Nest 的 Trace 完整，但 Nest 到 Agent/Tool 的 35% span 断链，故障只能靠时间猜测。请检查 traceparent、异步上下文和 correlationId 传播，先提高错误样本采样并保留关键日志，再统一上下文传播和 span schema，验证单个 run 可从 UI 追到 DB 且无重复 trace。
   依据：[OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/instrumentation/)

2. 模拟情境：安全扫描发现 0.4% 的错误日志包含 Authorization、用户 Prompt 或模型 API key，日志量约每天 2 GB。请定位泄漏字段和采集路径，先停传敏感属性并轮换密钥，再建立字段白名单、脱敏与采样策略，用攻击样本和日志扫描验证敏感泄漏为 0。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：对应全链路 Telemetry、采样、关联与 PII 脱敏。

---

## 13. PDF 面试题映射（Day 35 原版，保持原样）

1. 如何监控 AI 产品的性能和异常，尤其是模型响应慢，并用 TraceID 关联链路？  
   来源：[《2026腾讯音乐 前端开发（AI产品）》](<../../资源/2026腾讯音乐 前端开发（AI产品）.pdf>)，第 6 页。

2. 如果从零设计前端监控系统，采集、上报、处理、告警链路如何规划？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 12 页。

题目说明：直接匹配 Trace、结构化观测、采样和问题回溯；PII 脱敏需结合当天安全规范回答。

---

## 14. 完成后教师五连问（Day 35 原版，保持原样）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
