# Day 37 - 性能优化（Query Plan + 复合索引 + 连接池 + 缓存 + 流背压）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

日期与时长：2026-08-19 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

---

## §0 在 90 天路线图中的位置

**阶段定位**：阶段二第 7 天（Day 31-40：Agent 生产化工程 10 天）

**前置依赖**：
- Day 29（BullMQ 队列）：队列消费速度影响背压
- Day 32（Agent 状态机）：Agent 执行产生的数据库写入需要索引优化
- Day 34（失败恢复）：RecoveryAuditLog 表的查询性能需要复合索引
- Day 35（可观测性）：Trace 查询依赖高效的 traceId 索引

**今天要解决的 5 个核心问题**：

1. **慢查询拖垮系统**：Agent 时间线表 8000 万行，按 `tenantId + runId + createdAt` 查询的 P95 从 180ms 飙到 4.8s，DB CPU 92%。
   - **为什么发生**：没有覆盖查询条件的复合索引，PostgreSQL 做了全表扫描或低效的索引回表。
   - **用户看到什么**：Agent 执行历史加载超时，页面白屏或转圈 5 秒。
   - **今天如何解决**：`EXPLAIN ANALYZE` 分析执行计划 + 设计 `(tenantId, runId, createdAt)` 复合索引 + 验证查询计划从 Seq Scan 变 Index Scan。

2. **连接池耗尽导致级联失败**：流式消费者变慢后，连接池占用 95%，新请求拿不到连接，全部超时。
   - **为什么发生**：默认连接池配置（10 个连接）在高并发下不够；长查询占住连接不释放；没有连接超时和队列机制。
   - **用户看到什么**：所有 API 请求返回 `ETIMEDOUT` 或 `Pool exhausted`，系统完全不可用。
   - **今天如何解决**：调整连接池大小（`max: 20`）+ 设置 `connectionTimeoutMillis` + 监控 `pool.totalCount` / `pool.idleCount`。

3. **缓存命中率骤降导致穿透**：Redis 命中率从 82% 降到 24%，每次缓存 miss 都回源数据库，DB 负载雪崩。
   - **为什么发生**：缓存键设计不合理（每次查询生成新键）；TTL 设置不当（热数据过早过期）；没有缓存预热。
   - **用户看到什么**：页面加载变慢（从 200ms 到 2s+），高峰期大量 503。
   - **今天如何解决**：标准化缓存键（`cache:metric:${serverId}:${date}`）+ 合理 TTL（热数据 5min，冷数据 1h）+ 监控命中率。

4. **流式消费者背压导致内存溢出**：BullMQ 消费者处理慢，队列积压从 100 涨到 1 万，Node.js 进程 OOM。
   - **为什么发生**：消费者没有限制并发（`concurrency: 1` 默认），消息堆积在内存；没有背压机制暂停生产。
   - **用户看到什么**：队列任务延迟越来越高（从秒级到分钟级），最终进程崩溃重启，任务丢失。
   - **今天如何解决**：设置 `concurrency` + 监控 `queue.count()` + 实现背压（队列超阈值时暂停生产）。

5. **写放大导致索引维护成本高**：每次插入一条记录，PostgreSQL 要更新 5 个索引，写入 TPS 从 5000 降到 800。
   - **为什么发生**：表上建了过多冗余索引（7 个单列索引而非必要的 2 个复合索引）。
   - **用户看到什么**：Agent 执行日志写入变慢，用户感知 Agent 响应延迟增加。
   - **今天如何解决**：删除冗余索引，只保留高频查询需要的复合索引 + 用 `pg_stat_user_indexes` 验证索引使用率。

**今天的验收硬指标**：慢查询 P95 < 500ms（有基线对比）；连接池峰值占用 < 80%；缓存命中率 > 70%；无查询性能回归。

---

## 1. 功能模块职责划分

### 1.1 用户能看到什么（5 个真实场景）

**场景 1：查看 Agent 执行历史（慢查询优化）**

用户在前端点击"查看最近 100 次 Agent 执行记录"：
1. 后端查询 `agent_runs` 表：`SELECT * FROM agent_runs WHERE tenantId = ? AND createdAt > ? ORDER BY createdAt DESC LIMIT 100`
2. **优化前**：表有 8000 万行，无复合索引，PostgreSQL 做全表扫描，耗时 4.8s，DB CPU 92%
3. **优化后**：建立 `(tenantId, createdAt)` 复合索引，查询计划变 Index Scan，耗时 180ms，DB CPU 15%
4. 用户看到：列表瞬间加载（< 200ms），不再白屏等待

**场景 2：高并发下连接池不耗尽（连接池优化）**

100 个并发用户同时查询指标：
1. 每个查询占用一个 DB 连接，默认连接池 `max: 10`，第 11 个请求开始排队
2. **优化前**：第 11+ 个请求等待超时（5s），返回 `Pool exhausted`，用户看到 503
3. **优化后**：调整连接池 `max: 20`，设置 `acquireTimeoutMillis: 30000`，监控 `pool.waitingCount`
4. 用户看到：所有请求正常返回（P95 < 1s），无 503

**场景 3：缓存命中率提升（缓存优化）**

用户刷新仪表盘（查询 10 台服务器的 CPU 指标）：
1. 后端先查 Redis：`GET cache:metric:cpu:srv-001:2026-07-17`
2. **优化前**：缓存键不一致（每次查询带随机参数），命中率 24%，9/10 次回源 DB
3. **优化后**：标准化缓存键，TTL 5min，预热热数据，命中率 82%
4. 用户看到：仪表盘秒开（< 100ms），DB 负载从 80% 降到 20%

**场景 4：流式消费者背压（背压优化）**

Agent 执行产生 1 万条日志消息进入队列：
1. 消费者处理速度 100 msg/s，队列积压 9900 条
2. **优化前**：消息堆在内存，Node.js 进程 OOM 崩溃，任务丢失
3. **优化后**：设置 `concurrency: 5`，监控队列长度，超 1000 时暂停生产（背压）
4. 用户看到：日志处理延迟稳定在 10s 内，无消息丢失

**场景 5：索引写放大验证（索引优化）**

Agent 每秒写入 1000 条执行日志：
1. 表上有 7 个索引（5 个单列 + 2 个复合），每次 INSERT 要更新 7 个索引
2. **优化前**：写入 TPS 800，DB 写 IOPS 5000（7 倍写放大）
3. **优化后**：删除 5 个低使用率索引，只保留 2 个高频查询索引，写入 TPS 3000
4. 用户看到：Agent 响应延迟从 800ms 降到 300ms

### 1.2 核心模块职责

今天新增/改造的是**性能调优基础设施**，涉及数据库、缓存、队列三层：

| 模块 | 职责 | 输入 | 输出 | 为什么需要 |
|---|---|---|---|---|
| **QueryAnalyzer** | 分析慢查询，输出 EXPLAIN 计划 | SQL + 参数 | 执行计划（Seq Scan / Index Scan） | 定位瓶颈查询 |
| **IndexDesigner** | 设计复合索引，计算覆盖度 | 查询条件 | 索引 DDL + 覆盖率 | 避免全表扫描 |
| **ConnectionPoolMonitor** | 监控连接池状态 | Prisma pool 实例 | `totalCount / idleCount / waitingCount` | 预警连接池耗尽 |
| **CacheStrategy** | 标准化缓存键，设置 TTL | 查询上下文 | 缓存键 + TTL | 提高命中率 |
| **BackpressureController** | 队列背压控制 | 队列长度 | 是否暂停生产 | 防止消费者 OOM |

**模块之间的依赖关系**：

```
查询请求
  ↓
CacheStrategy（先查缓存）
  ↓ miss
ConnectionPoolMonitor（获取连接）
  ↓
QueryAnalyzer（执行查询，记录慢查询）
  ↓
IndexDesigner（离线分析，建议索引）

队列消息
  ↓
BackpressureController（检查队列长度）
  ↓
消费者（处理消息）
```

**为什么按这个顺序？**
1. 先查缓存（CacheStrategy），命中则直接返回，不占用连接
2. 再获取连接（ConnectionPoolMonitor），避免连接池耗尽
3. 执行查询时记录慢查询（QueryAnalyzer），定位瓶颈
4. 离线分析建议索引（IndexDesigner），优化后续查询
5. 队列消费前检查背压（BackpressureController），避免 OOM

### 1.3 三版演进路线图

**v1：问题暴露 + 基线测量**

能力：
- 用 `pg_stat_statements` 抓取慢查询 TOP 10
- 手动 `EXPLAIN ANALYZE` 查看执行计划
- 基线测量：记录优化前的 P95 延迟、DB CPU、缓存命中率

问题：
- 没有索引优化（全表扫描）
- 连接池默认配置（10 个连接）
- 缓存键不规范（命中率低）
- 队列无背压（消息堆积）

**v2：单点优化（索引 + 连接池 + 缓存）**

新增能力：
- 设计复合索引（`(tenantId, createdAt)`），验证查询计划从 Seq Scan 变 Index Scan
- 调整连接池配置（`max: 20, acquireTimeoutMillis: 30000`）
- 标准化缓存键（`cache:${resource}:${id}:${date}`），设置合理 TTL

解决的问题：
- ✅ 慢查询优化（P95 从 4.8s 到 180ms）
- ✅ 连接池不耗尽（峰值占用 < 80%）
- ✅ 缓存命中率提升（从 24% 到 82%）

还剩下的问题：
- ❌ 队列无背压（消息堆积仍会 OOM）
- ❌ 写放大未优化（7 个索引维护成本高）

**v3：全链路优化 + 监控（今天交付）**

新增能力：
- 队列背压控制（`concurrency` + 队列长度监控 + 暂停生产）
- 索引使用率分析（`pg_stat_user_indexes`），删除低使用率索引
- 性能监控面板（P95 延迟、连接池状态、缓存命中率、队列积压）
- 性能 ADR 文档（优化前后对比数据 + 决策理由）

解决的问题：
- ✅ 队列背压（消息堆积不 OOM）
- ✅ 写放大优化（索引从 7 个降到 2 个，TPS 提升 3 倍）
- ✅ 可观测（性能回归可快速定位）

生产级保障：
- ✅ 用前后数据证明改善（P95 延迟、TPS、命中率基线对比）
- ✅ 无明显回归（所有现有查询的执行计划无劣化）
- ✅ 性能监控持续跟踪（P95 > 阈值时自动告警）

---

## 1.4 目录结构（5 个维度完整展示）

### 1.4.1 骨架树（今天新增的文件）

```
apps/api/src/
├── performance/                       # 【今天新增】性能调优模块
│   ├── query/
│   │   ├── query-analyzer.ts          # 【核心】慢查询分析（EXPLAIN ANALYZE）
│   │   ├── index-designer.ts          # 【核心】索引设计建议
│   │   └── query-baseline.ts          # 基线测量（优化前后对比）
│   ├── connection/
│   │   ├── pool-monitor.ts            # 【核心】连接池监控
│   │   └── pool-config.ts             # 连接池配置（样板）
│   ├── cache/
│   │   ├── cache-strategy.ts          # 【核心】缓存策略（键规范 + TTL）
│   │   ├── cache-hit-rate-monitor.ts  # 缓存命中率监控
│   │   └── cache-warmup.ts            # 缓存预热
│   ├── backpressure/
│   │   ├── backpressure-controller.ts # 【核心】队列背压控制
│   │   └── queue-monitor.ts           # 队列长度监控
│   └── performance.module.ts          # 性能模块聚合
├── metrics/                           # Day 前期已建
└── observability/                     # Day 35 已建

apps/api/prisma/
└── migrations/
    └── add_composite_indexes.sql      # 【今天产出】复合索引迁移脚本

docs/
└── adr/
    └── 003-performance-optimization-day37.md  # 【今天产出】性能优化 ADR
```

### 1.4.2 为什么这样分层（5 个架构问题）

**问题 1：为什么 `performance/` 是独立目录而不是塞进 `metrics/`？**

**回答**：`metrics/` 关注"采集和聚合业务指标"（CPU/内存/响应时间），`performance/` 关注"系统层面的性能调优"（查询计划/连接池/缓存）。前者是业务数据，后者是基础设施优化，关注点不同。

**问题 2：为什么索引设计（`index-designer.ts`）单独拆文件？**

**回答**：索引设计是"离线分析"任务（不在请求链路中），需要读取 `pg_stat_statements` 和查询日志，逻辑复杂且独立。单独文件便于测试和演进（未来可能接入自动索引建议工具）。

**问题 3：为什么缓存预热（`cache-warmup.ts`）和缓存策略（`cache-strategy.ts`）分开？**

**回答**：缓存策略是"请求时决定缓存键和 TTL"（同步），缓存预热是"系统启动时批量加载热数据"（异步）。一个在请求链路，一个在启动链路，分开更清晰。

**问题 4：为什么背压控制（`backpressure-controller.ts`）和队列监控（`queue-monitor.ts`）分开？**

**回答**：队列监控是"只读观测"（暴露指标），背压控制是"决策和执行"（暂停/恢复生产）。监控可以独立用于告警，控制依赖监控数据但逻辑独立。

**问题 5：为什么性能优化要写 ADR 文档？**

**回答**：性能优化涉及权衡（索引提升读但降低写、缓存 TTL 长提高命中率但数据可能陈旧），必须记录"为什么这样选"和"优化前后数据"，否则 3 个月后没人敢改。

### 1.4.3 与 Day 35/36 的 diff

| 对比维度 | Day 35（可观测性） | Day 36（API 安全） | Day 37（性能优化，今天） |
|---|---|---|---|
| **关注点** | 系统能被看见 | 入口不能被攻破 | 系统快且稳定 |
| **核心动作** | 埋 Trace、脱敏日志 | 拦攻击、脱敏错误 | 加索引、调连接池、优化缓存 |
| **新增目录** | `observability/` | `security/` | `performance/` |
| **复用前两天** | — | traceId 关联进错误响应 | traceId 关联进慢查询日志 |
| **对下游影响** | 提供排查依据 | 提供准入闸门 | 提供性能基线和监控 |

**关键变化**：Day 37 用"数据驱动"证明优化效果（优化前后 P95 对比），而不是"主观感觉快了"。

### 1.4.4 依赖箭头（从查询到响应的完整链路）

```
请求
  → CacheStrategy.getCacheKey()（生成标准缓存键）
  → Redis.get(key)（查缓存）
  → 命中 → 直接返回
  → Miss → PoolMonitor.acquire()（获取连接）
  → QueryAnalyzer.execute()（执行查询 + 记录慢查询）
  → IndexDesigner.suggestIndex()（离线分析，建议索引）
  → Redis.set(key, value, TTL)（写缓存）
  → 返回结果

队列消息
  → BackpressureController.check()（检查队列长度）
  → 超阈值 → 暂停生产
  → 未超 → 消费者处理
```

**关键依赖**：CacheStrategy 是第一道防线（命中则不占用连接），BackpressureController 是队列的安全阀（防止 OOM）。

### 1.4.5 三个灵魂拷问

**拷问 1：如果查询已经有了 `(tenantId)` 单列索引，为什么还要建 `(tenantId, createdAt)` 复合索引？**

**回答**：单列索引只能过滤 `tenantId`，PostgreSQL 仍需回表扫描所有该租户的行再按 `createdAt` 排序。复合索引覆盖了 `WHERE` 和 `ORDER BY` 两个条件，PostgreSQL 可以直接在索引上扫描并返回，避免回表和排序（执行计划从 `Index Scan + Sort` 变成 `Index Scan only`）。

**拷问 2：为什么缓存 TTL 不能设太长（如 24h）？**

**回答**：TTL 太长会导致数据陈旧（指标更新了但缓存还是旧值）。性能优化的前提是"不改变业务语义"，缓存 TTL 必须在"命中率"和"数据新鲜度"之间权衡。本项目采用"热数据 5min、冷数据 1h"的分层 TTL。

**拷问 3：为什么连接池 `max` 不能设太大（如 100）？**

**回答**：每个连接占用 PostgreSQL 服务器的内存和进程资源。`max: 100` 意味着单个应用实例可能占用 100 个 DB 连接，若有 10 个应用实例，总连接数就是 1000，会耗尽 PostgreSQL 的 `max_connections`（默认 100）。正确做法是"连接池大小 ≈ 应用实例数 × CPU 核数 × 2"。

---

## 1.5 今天动手前的脚手架检查

**为什么放在 §1 里**：Day 37 依赖 Day 29（队列）、Day 32（Agent 执行日志表）、Day 35（Trace）的代码。如果这些依赖缺失或表结构不完整，今天的性能优化无法进行。

### 1.5.1 Day 29 队列代码检查

```bash
# 检查 BullMQ 是否已安装
grep "bullmq" apps/api/package.json
# 检查队列是否已配置
ls apps/api/src/queue/
```

**如果缺失**：先完成 Day 29（BullMQ 队列），再回来做 Day 37。

### 1.5.2 Day 32 数据表检查

```bash
# 检查 agent_runs 表是否存在
psql -U postgres -d p1_monitor -c "\d agent_runs"
# 检查表行数（模拟大数据场景）
psql -U postgres -d p1_monitor -c "SELECT COUNT(*) FROM agent_runs"
```

**如果行数 < 1000**：需要生成测试数据（见 §2.2 数据准备）。

### 1.5.3 今天需要新建的表和索引

**新建监控指标表**（如果还没有）：

```sql
-- apps/api/prisma/schema.prisma
model Metric {
  id          String   @id @default(cuid())
  serverId    String
  metricName  String   // 'cpu' | 'memory' | 'disk'
  value       Float
  timestamp   DateTime
  createdAt   DateTime @default(now())

  @@index([serverId, metricName, timestamp])  // 【今天优化】复合索引
}
```

**今天要添加的复合索引**（在现有表上）：

```sql
-- apps/api/prisma/migrations/add_composite_indexes.sql
-- agent_runs 表优化（最高频查询）
CREATE INDEX CONCURRENTLY idx_agent_runs_tenant_created 
ON agent_runs(tenant_id, created_at DESC);

-- recovery_audit_logs 表优化（Day 34 留下的）
CREATE INDEX CONCURRENTLY idx_recovery_audit_run_event 
ON recovery_audit_logs(run_id, event, occurred_at DESC);

-- metrics 表优化
CREATE INDEX CONCURRENTLY idx_metrics_server_name_time 
ON metrics(server_id, metric_name, timestamp DESC);
```

**为什么用 `CONCURRENTLY`？**

`CREATE INDEX CONCURRENTLY` 不锁表，可以在生产环境安全执行。普通 `CREATE INDEX` 会加写锁，阻塞所有写入。

**迁移脚本**：

```bash
cd apps/api
# 生成迁移文件
npx prisma migrate dev --name add_composite_indexes_day37
# 应用迁移
npx prisma migrate deploy
```

**验证索引创建成功**：

```bash
psql -U postgres -d p1_monitor -c "\d+ agent_runs" | grep idx_agent_runs_tenant_created
# 预期输出：idx_agent_runs_tenant_created btree (tenant_id, created_at DESC)
```

### 1.5.4 连接池配置检查

```typescript
// apps/api/src/persistence/prisma.service.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // 【今天检查/新增】连接池配置
  // 若已有配置，确认参数合理；若无，按下面补充
})

// 连接池参数（今天要优化的）
// DATABASE_URL 格式：postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=30
```

**DATABASE_URL 连接池参数说明**：

```bash
# .env
DATABASE_URL="postgresql://postgres:password@localhost:5432/p1_monitor?connection_limit=20&pool_timeout=30&connect_timeout=10"
```

| 参数 | 默认值 | Day 37 优化值 | 理由 |
|---|---|---|---|
| `connection_limit` | 10 | 20 | 高并发场景需要更多连接 |
| `pool_timeout` | 10s | 30s | 允许更长等待时间，避免瞬间峰值时失败 |
| `connect_timeout` | 5s | 10s | 数据库重启时有足够时间重连 |

**验证连接池配置生效**：

```typescript
// apps/api/src/performance/connection/pool-monitor.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'

@Injectable()
export class PoolMonitor {
  constructor(private prisma: PrismaService) {}

  getPoolStatus() {
    // Prisma 内部连接池状态（需要通过 metrics 暴露）
    return {
      totalConnections: 20,  // connection_limit
      activeConnections: 0,  // 当前使用中
      idleConnections: 0,    // 当前空闲
      waitingRequests: 0,    // 当前排队等待连接
    }
  }
}
```

**如果配置缺失**：补充 DATABASE_URL 参数，重启应用，用 `pgAdmin` 或 `pg_stat_activity` 验证连接数。

---

## 2. 今天的开发节奏（3 小时：90 阅读 / 90 动手）

**总计 180 分钟**，按"理解原理 → 建立基线 → 优化索引/缓存/背压 → 验证"推进。

| 阶段 | 时长 | 任务 | 输出 | 为什么这样安排 |
|---|---|---|---|---|
| **阶段 1** | 90 min | 阅读 Query Plan、复合索引、连接池、缓存和背压的三版演进 | 机制笔记与预期瓶颈图 | 前 90 分钟只读，避免边写边猜 |
| **阶段 2** | 15 min | 建立优化前 P95、DB CPU、缓存命中率和连接池基线 | 基线数据表格 | 没有基线，无法证明优化有效 |
| **阶段 3** | 25 min | 创建复合索引并实现缓存/连接池增量 | DDL + CacheStrategy + PoolMonitor | 先处理高收益瓶颈 |
| **阶段 4** | 20 min | 实现队列背压控制 | BackpressureController | 防止积压导致 OOM |
| **阶段 5** | 20 min | 压测与两个反证实验 | 前后对比报告 | 用数据证明收益和边界 |
| **阶段 6** | 10 min | 架构证据与提交 | ADR + commit | 完成可追踪验收 |

**关键里程碑检查点**：
- 70 分钟：基线数据收集完成（优化前 P95 > 4s）
- 130 分钟：索引创建完成，查询计划变 Index Scan
- 200 分钟：缓存+连接池优化完成，命中率 > 70%
- 260 分钟：背压控制完成，队列积压 < 1000
- 360 分钟：压测完成，前后对比数据写入 ADR

**如果卡住了怎么办**：
- 卡在理解 EXPLAIN 输出（阶段 1）→ 读 [PostgreSQL EXPLAIN 官方文档](https://www.postgresql.org/docs/current/sql-explain.html)
- 卡在索引设计（阶段 3）→ 先看 `pg_stat_statements` 找最慢的 3 条 SQL
- 卡在压测（阶段 6）→ 用 `k6` 或 `ab` 工具，先跑 10 QPS 简单场景

---

## 3. v1：问题暴露 + 基线测量

### 3.1 v1 能做什么

Day 32 完成后的状态：
- `agent_runs` 表有数据（模拟 8000 万行，实际测试可能只有 1 万行）
- 查询能跑通，但很慢（P95 > 4s）
- 没有复合索引（只有主键）
- 连接池用默认配置（10 个连接）
- 没有缓存（每次查询都回源 DB）

### 3.2 v1 代码骨架（Day 32 版本）

```typescript
// apps/api/src/agent/agent.service.ts（Day 32 版本）
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'

@Injectable()
export class AgentService {
  constructor(private prisma: PrismaService) {}

  // 查询最近 100 次执行记录（无缓存、无索引优化）
  async getRecentRuns(tenantId: string, limit = 100) {
    return this.prisma.agentRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
```

**查询 SQL（Prisma 生成）**：

```sql
SELECT * FROM agent_runs
WHERE tenant_id = 'tenant-001'
ORDER BY created_at DESC
LIMIT 100;
```

### 3.3 v1 的 5 个性能问题

**问题 1：无复合索引，全表扫描**

```bash
# 查看执行计划
EXPLAIN ANALYZE 
SELECT * FROM agent_runs
WHERE tenant_id = 'tenant-001'
ORDER BY created_at DESC
LIMIT 100;
```

**v1 输出**（无索引）：

```
Limit  (cost=185420.12..185420.37 rows=100 width=128) (actual time=4823.456..4823.482 rows=100 loops=1)
  ->  Sort  (cost=185420.12..185920.12 rows=200000 width=128) (actual time=4823.454..4823.467 rows=100 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 50kB
        ->  Seq Scan on agent_runs  (cost=0.00..180000.00 rows=200000 width=128) (actual time=0.013..4720.234 rows=200000 loops=1)
              Filter: (tenant_id = 'tenant-001')
              Rows Removed by Filter: 79800000
Planning Time: 0.145 ms
Execution Time: 4823.512 ms
```

**关键指标**：
- `Seq Scan`：全表扫描 8000 万行
- `Rows Removed by Filter: 79800000`：过滤掉 7980 万行（浪费）
- `Execution Time: 4823.512 ms`：4.8 秒

**问题 2：连接池默认配置（10 个连接）**

```typescript
// 模拟 20 个并发查询
async function testConcurrency() {
  const promises = Array.from({ length: 20 }, () =>
    agentService.getRecentRuns('tenant-001')
  )
  await Promise.all(promises)
}
```

**v1 输出**：

```
[Prisma] Query 1-10: OK (4823ms each)
[Prisma] Query 11-20: Error: Timed out fetching a new connection from the connection pool. (More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 10))
```

**问题 3：无缓存，命中率 0%**

每次查询都回源 DB，无缓存层。

**问题 4：队列无背压，消息堆积**

```typescript
// 模拟 1 万条消息入队
for (let i = 0; i < 10000; i++) {
  await toolQueue.add('execute-tool', { runId: `run-${i}` })
}
```

**v1 输出**：

```
[Queue] 队列长度: 9900（消费速度 100 msg/s）
[Node.js] Heap usage: 1.8 GB / 2 GB
[Node.js] Process killed: OOM
```

**问题 5：写放大（7 个索引）**

```sql
-- 假设 v1 有 7 个索引（过度索引）
\d+ agent_runs

Indexes:
    "agent_runs_pkey" PRIMARY KEY, btree (id)
    "idx_tenant" btree (tenant_id)
    "idx_created" btree (created_at)
    "idx_run_id" btree (run_id)
    "idx_status" btree (status)
    "idx_user_id" btree (user_id)
    "idx_tool_name" btree (tool_name)
```

**写入测试**：

```bash
# 插入 1000 条记录
INSERT INTO agent_runs (...) VALUES (...);  -- 重复 1000 次
```

**v1 输出**：

```
TPS: 800
DB Write IOPS: 5600  # 每次写入要更新 7 个索引
```

### 3.4 v1 基线测量

建立性能基线，记录到 ADR：

| 指标 | v1 基线（优化前） | 目标（优化后） |
|---|---|---|
| 查询 P95 延迟 | 4823ms | < 500ms |
| DB CPU | 92% | < 50% |
| 连接池峰值占用 | 10/10 (100%) | < 16/20 (80%) |
| 缓存命中率 | 0% | > 70% |
| 队列峰值积压 | 9900 (OOM) | < 1000 |
| 写入 TPS | 800 | > 2000 |

**测量方法**：

```bash
# P95 延迟：用 k6 压测
k6 run --vus 10 --duration 30s test-query.js

# DB CPU：查询 pg_stat_database
SELECT datname, xact_commit, blks_read, blks_hit FROM pg_stat_database;

# 连接池占用：查询 pg_stat_activity
SELECT count(*) FROM pg_stat_activity WHERE datname = 'p1_monitor';

# 缓存命中率：Redis INFO stats
redis-cli INFO stats | grep keyspace_hits

# 队列积压：BullMQ API
const count = await toolQueue.count()
```

---

## 4. v2：索引 + 连接池 + 缓存（单点优化）

### 4.1 v2 新增的能力

v2 在 v1 基础上新增：
- **复合索引**：设计 `(tenantId, createdAt)` 复合索引，覆盖 WHERE 和 ORDER BY
- **连接池优化**：调整 `max: 20`，设置 `acquireTimeoutMillis: 30000`
- **缓存策略**：标准化缓存键（`cache:runs:${tenantId}:recent`），TTL 5min

### 4.2 v2 架构变化

```
v1：请求 → DB 查询（Seq Scan 4.8s）→ 返回
v2：请求 → 查缓存 → 命中返回（< 10ms）
              ↓ Miss
         获取连接（从 20 个连接池）→ DB 查询（Index Scan 180ms）→ 写缓存 → 返回
```

**关键变化**：增加"缓存层"和"索引优化"，查询性能从 4.8s 降到 180ms（命中缓存时 < 10ms）。

### 4.3 v2 核心代码

#### 4.3.1 复合索引设计（你需要理解原理，DDL 可 AI 生成）

**原理讲解（5 要素）**：

**它解决什么问题**：v1 的 `WHERE tenant_id = ? ORDER BY created_at DESC` 查询，PostgreSQL 先用 `idx_tenant` 过滤，再回表扫描所有该租户的行并排序（Seq Scan + Sort），耗时 4.8s。

**运行机制**：复合索引 `(tenant_id, created_at DESC)` 把"过滤"和"排序"两个操作都放在索引上完成。PostgreSQL 可以直接在索引上找到 `tenant_id = ?` 的行，这些行已经按 `created_at DESC` 排好序，取前 100 行即可，无需回表排序。

**项目落点**：`agent_runs` 表建立 `idx_agent_runs_tenant_created`，验证查询计划从 `Seq Scan + Sort` 变成 `Index Scan`。

**生产误区**：
1. 只建单列索引（`idx_tenant` + `idx_created`）而不是复合索引 → PostgreSQL 只会用其中一个，另一个条件仍需回表过滤
2. 复合索引顺序错误（`(created_at, tenant_id)`）→ 无法利用索引过滤 `tenant_id`
3. 不验证查询计划 → 索引建了但没生效（可能因为统计信息未更新）

**验证方法**：`EXPLAIN ANALYZE` 对比优化前后，确认从 `Seq Scan` 变成 `Index Scan`，执行时间从 4.8s 降到 < 500ms。

**索引 DDL**（样板代码，可 AI 生成）：

```sql
-- apps/api/prisma/migrations/add_composite_indexes.sql
-- agent_runs 表优化
CREATE INDEX CONCURRENTLY idx_agent_runs_tenant_created 
ON agent_runs(tenant_id, created_at DESC);

-- 验证索引大小（确保不会占用过多磁盘）
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE tablename = 'agent_runs';
```

**v2 查询计划（优化后）**：

```
Limit  (cost=0.42..12.56 rows=100 width=128) (actual time=0.021..0.156 rows=100 loops=1)
  ->  Index Scan using idx_agent_runs_tenant_created on agent_runs  (cost=0.42..24312.42 rows=200000 width=128) (actual time=0.019..0.142 rows=100 loops=1)
        Index Cond: (tenant_id = 'tenant-001')
Planning Time: 0.087 ms
Execution Time: 0.178 ms
```

**关键指标变化**：
- `Seq Scan` → `Index Scan`
- `Execution Time: 4823.512 ms` → `0.178 ms`（提升 27000 倍）

#### 4.3.2 连接池配置（样板代码，可 AI 生成）

```typescript
// apps/api/src/performance/connection/pool-config.ts
export const POOL_CONFIG = {
  connectionLimit: 20,          // 从 10 提升到 20
  poolTimeout: 30,              // 等待连接超时 30s（从 10s 提升）
  connectTimeout: 10,           // 连接数据库超时 10s
}

// .env
DATABASE_URL="postgresql://postgres:password@localhost:5432/p1_monitor?connection_limit=20&pool_timeout=30&connect_timeout=10"
```

**连接池监控**（核心代码，你手写）：

```typescript
// apps/api/src/performance/connection/pool-monitor.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'

@Injectable()
export class PoolMonitor {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取连接池状态
   * 你需要实现的核心逻辑：
   * 1. 通过 Prisma 内部 API 或数据库查询获取当前连接数
   * 2. 计算连接池占用率（activeConnections / connectionLimit）
   * 3. 当占用率 > 80% 时触发告警
   */
  async getPoolStatus() {
    // 提示：Prisma 没有直接暴露连接池状态，需要查询 pg_stat_activity
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) as count 
      FROM pg_stat_activity 
      WHERE datname = current_database()
    `
    
    const activeConnections = Number(result[0].count)
    const connectionLimit = 20  // 从配置读取

    return {
      activeConnections,
      connectionLimit,
      usagePercent: (activeConnections / connectionLimit) * 100,
      shouldAlert: activeConnections / connectionLimit > 0.8,
    }
  }

  /**
   * 定期监控（每 10 秒检查一次）
   */
  @Cron('*/10 * * * * *')  // 需要引入 @nestjs/schedule
  async monitorPool() {
    const status = await this.getPoolStatus()
    
    if (status.shouldAlert) {
      console.warn(`[PoolMonitor] 连接池占用高: ${status.usagePercent.toFixed(1)}%`)
      // 发送告警（关联 Day 35 的告警系统）
    }
  }
}
```

**为什么要监控连接池？**

连接池耗尽是"静默失败"——不会抛异常，只会让新请求排队等待直到超时。监控可以提前预警，避免用户感知到 503。

#### 4.3.3 缓存策略（核心代码，你手写）

**缓存键规范（5 要素）**：

**它解决什么问题**：v1 每次查询都生成不同的缓存键（例如带时间戳 `cache:runs:${Date.now()}`），命中率 0%。

**运行机制**：标准化缓存键格式 `cache:${resource}:${id}:${variant}`，确保相同查询条件生成相同的键。例如"查询租户 A 的最近 100 次执行"的键始终是 `cache:runs:tenant-001:recent`。

**项目落点**：`CacheStrategy` 类封装缓存键生成逻辑，所有查询统一调用。

**生产误区**：
1. 缓存键包含随机参数（如请求 ID）→ 永远 miss
2. TTL 设太长（24h）→ 数据陈旧
3. TTL 设太短（10s）→ 命中率低

**验证方法**：压测 100 次相同查询，缓存命中率应 > 99%（第一次 miss，后续 99 次 hit）。

**代码实现**（你手写核心逻辑）：

```typescript
// apps/api/src/performance/cache/cache-strategy.ts
import { Injectable } from '@nestjs/common'
import { Redis } from 'ioredis'

export interface CacheKeyContext {
  resource: string   // 'runs' | 'metrics' | 'traces'
  id: string         // tenantId / serverId
  variant?: string   // 'recent' | 'summary' | 'detail'
}

@Injectable()
export class CacheStrategy {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    })
  }

  /**
   * 生成标准化缓存键
   * 你需要实现的核心逻辑：
   * 1. 拼接 resource、id、variant 生成唯一键
   * 2. 确保相同参数生成相同的键（幂等性）
   * 3. 键格式：cache:{resource}:{id}:{variant}
   */
  getCacheKey(ctx: CacheKeyContext): string {
    const parts = ['cache', ctx.resource, ctx.id]
    if (ctx.variant) parts.push(ctx.variant)
    return parts.join(':')
  }

  /**
   * 获取缓存（带 TTL）
   */
  async get<T>(ctx: CacheKeyContext): Promise<T | null> {
    const key = this.getCacheKey(ctx)
    const value = await this.redis.get(key)
    return value ? JSON.parse(value) : null
  }

  /**
   * 写入缓存（带分层 TTL）
   * 你需要实现的核心逻辑：
   * 1. 热数据（最近查询）TTL 5min
   * 2. 冷数据（历史数据）TTL 1h
   * 3. 统计数据（聚合结果）TTL 10min
   */
  async set<T>(ctx: CacheKeyContext, value: T, ttlSeconds?: number): Promise<void> {
    const key = this.getCacheKey(ctx)
    
    // 默认 TTL 策略
    if (!ttlSeconds) {
      if (ctx.variant === 'recent') ttlSeconds = 300     // 5min
      else if (ctx.variant === 'summary') ttlSeconds = 600  // 10min
      else ttlSeconds = 3600  // 1h
    }

    await this.redis.setex(key, ttlSeconds, JSON.stringify(value))
  }

  /**
   * 监控缓存命中率
   */
  async getHitRate(): Promise<number> {
    const info = await this.redis.info('stats')
    const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] || '0')
    const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] || '0')
    
    if (hits + misses === 0) return 0
    return (hits / (hits + misses)) * 100
  }
}
```

**使用示例**（改造 AgentService）：

```typescript
// apps/api/src/agent/agent.service.ts（v2 版本）
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'
import { CacheStrategy } from '../performance/cache/cache-strategy'

@Injectable()
export class AgentService {
  constructor(
    private prisma: PrismaService,
    private cacheStrategy: CacheStrategy,
  ) {}

  async getRecentRuns(tenantId: string, limit = 100) {
    // 1. 尝试从缓存获取
    const cached = await this.cacheStrategy.get({
      resource: 'runs',
      id: tenantId,
      variant: 'recent',
    })

    if (cached) {
      console.log('[Cache] Hit')
      return cached
    }

    // 2. 缓存 miss，查询数据库（此时会用到复合索引）
    console.log('[Cache] Miss')
    const runs = await this.prisma.agentRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // 3. 写入缓存
    await this.cacheStrategy.set(
      { resource: 'runs', id: tenantId, variant: 'recent' },
      runs,
    )

    return runs
  }
}
```

### 4.4 v2 测试（单元测试 + 集成测试）

#### 4.4.1 单元测试（CacheStrategy）

```typescript
// apps/api/src/performance/cache/cache-strategy.spec.ts
describe('CacheStrategy', () => {
  let strategy: CacheStrategy

  beforeEach(() => {
    strategy = new CacheStrategy()
  })

  it('相同参数生成相同的缓存键', () => {
    const key1 = strategy.getCacheKey({ resource: 'runs', id: 'tenant-001', variant: 'recent' })
    const key2 = strategy.getCacheKey({ resource: 'runs', id: 'tenant-001', variant: 'recent' })
    expect(key1).toBe(key2)
    expect(key1).toBe('cache:runs:tenant-001:recent')
  })

  it('第二次查询命中缓存', async () => {
    const ctx = { resource: 'runs', id: 'tenant-001', variant: 'recent' }
    
    // 第一次：写入缓存
    await strategy.set(ctx, [{ id: 'run-001' }])
    
    // 第二次：读取缓存
    const cached = await strategy.get(ctx)
    expect(cached).toEqual([{ id: 'run-001' }])
  })

  it('TTL 过期后缓存失效', async () => {
    const ctx = { resource: 'runs', id: 'tenant-001', variant: 'recent' }
    
    // 写入缓存（TTL 1s）
    await strategy.set(ctx, [{ id: 'run-001' }], 1)
    
    // 等待 2s
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // 缓存应该失效
    const cached = await strategy.get(ctx)
    expect(cached).toBeNull()
  })
})
```

#### 4.4.2 集成测试（查询性能）

```typescript
// apps/api/test/performance.e2e-spec.ts
describe('查询性能 (e2e)', () => {
  let app: INestApplication
  let agentService: AgentService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication()
    await app.init()
    agentService = app.get(AgentService)
  })

  it('查询 P95 < 500ms', async () => {
    const latencies: number[] = []

    // 执行 100 次查询
    for (let i = 0; i < 100; i++) {
      const start = Date.now()
      await agentService.getRecentRuns('tenant-001')
      const latency = Date.now() - start
      latencies.push(latency)
    }

    // 计算 P95
    latencies.sort((a, b) => a - b)
    const p95 = latencies[Math.floor(latencies.length * 0.95)]

    console.log(`P95 延迟: ${p95}ms`)
    expect(p95).toBeLessThan(500)
  })

  it('缓存命中率 > 70%', async () => {
    const cacheStrategy = app.get(CacheStrategy)

    // 重置 Redis 统计
    await cacheStrategy['redis'].config('RESETSTAT')

    // 执行 100 次相同查询（第一次 miss，后续 99 次应 hit）
    for (let i = 0; i < 100; i++) {
      await agentService.getRecentRuns('tenant-001')
    }

    const hitRate = await cacheStrategy.getHitRate()
    console.log(`缓存命中率: ${hitRate.toFixed(1)}%`)
    expect(hitRate).toBeGreaterThan(70)
  })
})
```

### 4.5 v2 还剩下的 2 个问题

**问题 4：队列无背压（消息堆积仍会 OOM）**

v2 只优化了查询性能，没有处理队列消费者慢的问题。如果 1 万条消息入队，消费者处理不过来，仍会 OOM。

**问题 5：写放大未优化（7 个索引维护成本高）**

v2 只加了复合索引，没有删除低使用率的单列索引。每次 INSERT 仍要更新 7 个索引，写入 TPS 仍然低。

v3 用"背压控制 + 索引使用率分析"解决这两个问题。

---

## 5. v3：背压控制 + 索引优化 + 性能监控（生产级）

### 5.1 v3 新增的能力

v3 在 v2 基础上新增：
- **队列背压控制**：监控队列长度，超阈值时暂停生产，防止 OOM
- **索引使用率分析**：用 `pg_stat_user_indexes` 找出低使用率索引并删除，降低写放大
- **性能监控面板**：持续跟踪 P95 延迟、连接池占用、缓存命中率、队列积压

### 5.2 v3 架构变化

```
v2：查询优化（索引 + 缓存 + 连接池）
v3：v2 + 队列背压（防 OOM）+ 索引瘦身（降低写成本）+ 监控（预警）
```

**关键变化**：从"单点优化"到"全链路性能治理"。

### 5.3 v3 核心代码（核心逻辑你手写）

#### 5.3.1 队列背压控制（核心代码，你手写）

**知识点 1：背压（Backpressure）**

**它解决什么问题**：消费者处理速度 100 msg/s，生产者产生速度 1000 msg/s，队列积压 9000 条消息堆在内存，Node.js OOM 崩溃。

**运行机制**：监控队列长度，超过阈值（如 1000）时暂停生产（或降级非关键任务），等队列消化到安全水位（如 500）再恢复。

**项目落点**：`BackpressureController` 每 5 秒检查队列长度，超阈值时发送"暂停生产"信号。

**生产误区**：
1. 只限制消费者并发（`concurrency: 5`）而不限制生产 → 队列仍会无限积压
2. 阈值设太低（如 10）→ 频繁触发背压，降低吞吐量
3. 没有"恢复"机制 → 一旦暂停就永久暂停

**验证方法**：模拟 1 万条消息入队，确认队列长度稳定在 1000 以下，无 OOM。

**代码实现**（你手写核心逻辑）：

```typescript
// apps/api/src/performance/backpressure/backpressure-controller.ts
import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'

export interface BackpressureConfig {
  highWaterMark: number   // 高水位（暂停生产）
  lowWaterMark: number    // 低水位（恢复生产）
}

@Injectable()
export class BackpressureController {
  private isPaused = false

  constructor(
    @InjectQueue('tool') private toolQueue: Queue,
  ) {}

  /**
   * 检查队列长度并决策是否背压
   * 你需要实现的核心逻辑：
   * 1. 获取队列当前长度（waiting + active）
   * 2. 超过 highWaterMark 时暂停生产
   * 3. 降到 lowWaterMark 时恢复生产
   */
  async check(config: BackpressureConfig): Promise<{ shouldPause: boolean; queueLength: number }> {
    const waitingCount = await this.toolQueue.getWaitingCount()
    const activeCount = await this.toolQueue.getActiveCount()
    const queueLength = waitingCount + activeCount

    // 高水位：暂停
    if (queueLength > config.highWaterMark && !this.isPaused) {
      this.isPaused = true
      console.warn(`[Backpressure] 队列超高水位 (${queueLength}/${config.highWaterMark})，暂停生产`)
    }

    // 低水位：恢复
    if (queueLength < config.lowWaterMark && this.isPaused) {
      this.isPaused = false
      console.log(`[Backpressure] 队列降至低水位 (${queueLength}/${config.lowWaterMark})，恢复生产`)
    }

    return {
      shouldPause: this.isPaused,
      queueLength,
    }
  }

  /**
   * 定期检查（每 5 秒）
   */
  @Cron('*/5 * * * * *')  // 需要引入 @nestjs/schedule
  async monitor() {
    const result = await this.check({
      highWaterMark: 1000,
      lowWaterMark: 500,
    })

    if (result.shouldPause) {
      // 发送告警（关联 Day 35 的告警系统）
      console.error(`[Backpressure] 队列积压: ${result.queueLength}`)
    }
  }
}
```

**使用示例**（在生产者里检查背压）：

```typescript
// apps/api/src/agent/agent.service.ts（v3 版本）
async executeAgent(input: string) {
  // 1. 检查背压
  const backpressureStatus = await this.backpressureController.check({
    highWaterMark: 1000,
    lowWaterMark: 500,
  })

  if (backpressureStatus.shouldPause) {
    throw new Error('队列积压，暂时无法接受新任务')
  }

  // 2. 正常入队
  await this.toolQueue.add('execute-tool', { input })
}
```

#### 5.3.2 索引使用率分析（核心代码，你手写）

**知识点 2：索引写放大**

**它解决什么问题**：表上有 7 个索引，每次 INSERT 要更新 7 个索引，写入 TPS 从 5000 降到 800。

**运行机制**：用 `pg_stat_user_indexes` 查询每个索引的扫描次数（`idx_scan`），扫描次数 = 0 的索引是"僵尸索引"（从未被用过），可以删除。

**项目落点**：定期运行索引使用率报告，删除 `idx_scan = 0` 的索引。

**生产误区**：
1. 只看索引大小不看使用率 → 大索引不一定是坏索引
2. 一次性删除所有低使用率索引 → 可能有季节性查询（如月末报表）才用的索引
3. 删除主键或外键索引 → 破坏数据完整性

**验证方法**：删除索引后，重跑所有查询，确认执行计划无劣化（无 Seq Scan）。

**代码实现**（你手写核心逻辑）：

```typescript
// apps/api/src/performance/query/index-analyzer.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'

export interface IndexUsage {
  schemaname: string
  tablename: string
  indexname: string
  idx_scan: bigint      // 索引被扫描的次数
  idx_tup_read: bigint  // 索引返回的行数
  idx_tup_fetch: bigint // 索引实际取回的行数
  index_size: string    // 索引大小
}

@Injectable()
export class IndexAnalyzer {
  constructor(private prisma: PrismaService) {}

  /**
   * 查询索引使用率
   * 你需要实现的核心逻辑：
   * 1. 查询 pg_stat_user_indexes 获取扫描次数
   * 2. 找出 idx_scan = 0 的索引（从未使用）
   * 3. 排除主键和外键索引（不能删）
   */
  async getIndexUsage(tableName: string): Promise<IndexUsage[]> {
    const result = await this.prisma.$queryRaw<IndexUsage[]>`
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch,
        pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
      FROM pg_stat_user_indexes
      WHERE tablename = ${tableName}
      ORDER BY idx_scan ASC
    `

    return result
  }

  /**
   * 生成索引优化建议
   */
  async suggestIndexOptimization(tableName: string): Promise<{
    toDelete: string[]    // 建议删除的索引
    toKeep: string[]      // 必须保留的索引
    reason: string
  }> {
    const usage = await this.getIndexUsage(tableName)

    const toDelete: string[] = []
    const toKeep: string[] = []

    for (const idx of usage) {
      // 跳过主键和外键索引
      if (idx.indexname.includes('_pkey') || idx.indexname.includes('_fkey')) {
        toKeep.push(idx.indexname)
        continue
      }

      // 从未使用的索引建议删除
      if (idx.idx_scan === 0n) {
        toDelete.push(idx.indexname)
      } else {
        toKeep.push(idx.indexname)
      }
    }

    return {
      toDelete,
      toKeep,
      reason: `${toDelete.length} 个索引从未使用，建议删除以降低写放大`,
    }
  }
}
```

**使用示例**（生成索引优化报告）：

```typescript
// 运行索引分析
const report = await indexAnalyzer.suggestIndexOptimization('agent_runs')

console.log('建议删除的索引:', report.toDelete)
// 输出: ['idx_status', 'idx_user_id', 'idx_tool_name']

console.log('必须保留的索引:', report.toKeep)
// 输出: ['agent_runs_pkey', 'idx_agent_runs_tenant_created', 'idx_run_id']

// 生成删除 SQL
for (const indexName of report.toDelete) {
  console.log(`DROP INDEX CONCURRENTLY ${indexName};`)
}
```

#### 5.3.3 性能监控面板（核心代码，你手写）

**知识点 3：性能回归检测**

**它解决什么问题**：优化后 P95 从 4.8s 降到 180ms，但 2 周后又升到 2s（性能回归），无人发现。

**运行机制**：持续跟踪关键指标（P95 延迟、缓存命中率、连接池占用），超过阈值时自动告警。

**项目落点**：`PerformanceMonitor` 暴露 `/metrics/performance` 接口，前端实时展示。

**生产误区**：
1. 只在优化时测量，优化后不持续监控 → 性能回归无感知
2. 监控指标太多（50+ 个）→ 告警疲劳
3. 阈值设太紧（P95 < 100ms）→ 误报

**验证方法**：故意触发慢查询（如删除索引），确认告警触发。

**代码实现**（你手写核心逻辑）：

```typescript
// apps/api/src/performance/performance-monitor.ts
import { Injectable } from '@nestjs/common'
import { CacheStrategy } from './cache/cache-strategy'
import { PoolMonitor } from './connection/pool-monitor'
import { BackpressureController } from './backpressure/backpressure-controller'

export interface PerformanceMetrics {
  queryP95Ms: number          // 查询 P95 延迟
  cacheHitRate: number        // 缓存命中率 %
  poolUsagePercent: number    // 连接池占用 %
  queueBacklog: number        // 队列积压
  timestamp: string
}

@Injectable()
export class PerformanceMonitor {
  private latencies: number[] = []  // 滑动窗口（最近 1000 次查询）

  constructor(
    private cacheStrategy: CacheStrategy,
    private poolMonitor: PoolMonitor,
    private backpressureController: BackpressureController,
  ) {}

  /**
   * 记录查询延迟
   */
  recordLatency(latencyMs: number) {
    this.latencies.push(latencyMs)
    
    // 保持滑动窗口大小
    if (this.latencies.length > 1000) {
      this.latencies.shift()
    }
  }

  /**
   * 计算 P95 延迟
   */
  getP95Latency(): number {
    if (this.latencies.length === 0) return 0
    
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const index = Math.floor(sorted.length * 0.95)
    return sorted[index]
  }

  /**
   * 获取性能指标汇总
   */
  async getMetrics(): Promise<PerformanceMetrics> {
    const poolStatus = await this.poolMonitor.getPoolStatus()
    const cacheHitRate = await this.cacheStrategy.getHitRate()
    const backpressureStatus = await this.backpressureController.check({
      highWaterMark: 1000,
      lowWaterMark: 500,
    })

    return {
      queryP95Ms: this.getP95Latency(),
      cacheHitRate,
      poolUsagePercent: poolStatus.usagePercent,
      queueBacklog: backpressureStatus.queueLength,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * 检查是否触发告警
   */
  async checkAlerts(): Promise<{ hasAlert: boolean; alerts: string[] }> {
    const metrics = await this.getMetrics()
    const alerts: string[] = []

    if (metrics.queryP95Ms > 500) {
      alerts.push(`查询 P95 超阈值: ${metrics.queryP95Ms}ms > 500ms`)
    }

    if (metrics.cacheHitRate < 70) {
      alerts.push(`缓存命中率过低: ${metrics.cacheHitRate.toFixed(1)}% < 70%`)
    }

    if (metrics.poolUsagePercent > 80) {
      alerts.push(`连接池占用过高: ${metrics.poolUsagePercent.toFixed(1)}% > 80%`)
    }

    if (metrics.queueBacklog > 1000) {
      alerts.push(`队列积压过多: ${metrics.queueBacklog} > 1000`)
    }

    return {
      hasAlert: alerts.length > 0,
      alerts,
    }
  }
}
```

---

## 6. 前端底子深挖：浏览器缓存与请求优化

Day 37 的性能优化不只是后端——前端如何高效请求、如何利用浏览器缓存、如何避免重复请求，直接影响用户感知的"快"。

### 6.1 浏览器缓存策略（HTTP 缓存）

**深挖点 1：为什么 API 响应要设置 `Cache-Control`？**

后端已经有 Redis 缓存了，为什么还要设置 HTTP 缓存头？

**答案**：Redis 缓存是"服务端缓存"（节省 DB 查询），HTTP 缓存是"客户端缓存"（节省 HTTP 请求）。用户刷新页面时，浏览器直接用本地缓存，连 HTTP 请求都不发，比 Redis 缓存更快（0ms vs 50ms）。

**运行机制**：
- `Cache-Control: max-age=300`：告诉浏览器"这个响应可以缓存 5 分钟"
- `ETag: "abc123"`：响应指纹，浏览器下次请求时带 `If-None-Match: "abc123"`，服务器比对，若未变化返回 `304 Not Modified`（无 body，节省带宽）

**项目落点**：指标查询 API 设置 `Cache-Control: max-age=60`（1 分钟），Agent 执行历史设置 `max-age=300`（5 分钟）。

**生产误区**：
1. 所有 API 都设 `Cache-Control: no-cache` → 浪费 HTTP 请求
2. 动态数据也设长缓存（`max-age=86400`）→ 用户看到陈旧数据
3. 不设 `ETag` → 无法利用 304 协商缓存

**验证方法**：DevTools Network 里看到 `304 Not Modified` 或 `from disk cache`，说明浏览器缓存生效。

### 6.2 前端请求去重（防止重复请求）

**深挖点 2：为什么需要请求去重？**

用户快速点击"刷新"按钮 3 次，前端发了 3 个相同的 API 请求，后端执行 3 次相同查询，浪费资源。

**运行机制**：前端维护一个"请求池"（Map），相同请求（URL + 参数相同）复用同一个 Promise，等第一个请求返回后，其他请求直接用缓存结果。

**项目落点**：封装 `fetchWithDedup` 工具函数，所有 API 请求统一走这个函数。

**代码示例**（前端核心逻辑）：

```typescript
// apps/web/src/lib/fetch-with-dedup.ts
const requestPool = new Map<string, Promise<any>>()

export async function fetchWithDedup<T>(url: string, options?: RequestInit): Promise<T> {
  const key = `${url}:${JSON.stringify(options)}`

  // 如果池里已有相同请求，复用
  if (requestPool.has(key)) {
    console.log('[Dedup] 复用请求:', key)
    return requestPool.get(key)!
  }

  // 发起新请求
  const promise = fetch(url, options).then(res => res.json())

  // 加入池
  requestPool.set(key, promise)

  // 请求完成后从池里移除（避免内存泄漏）
  promise.finally(() => {
    requestPool.delete(key)
  })

  return promise
}
```

**使用示例**：

```typescript
// 用户快速点击 3 次"刷新"
for (let i = 0; i < 3; i++) {
  fetchWithDedup('/api/metrics/cpu')  // 只发 1 个 HTTP 请求
}
```

### 6.3 分页与虚拟滚动（避免一次加载 8000 万行）

**深挖点 3：为什么后端已经 `LIMIT 100` 了，前端还要做优化？**

后端返回 100 条记录（5KB），前端一次性渲染 100 个 DOM 节点，浏览器卡顿（尤其是移动端）。

**运行机制**：虚拟滚动（Virtual Scroll）只渲染可见区域的 DOM（如 10 条），用户滚动时动态替换。100 条记录只渲染 10 个 DOM，性能提升 10 倍。

**项目落点**：Agent 执行历史列表用虚拟滚动（`vue-virtual-scroller`），指标图表用分页（每页 20 条）。

**代码示例**（Vue3 虚拟滚动）：

```vue
<template>
  <RecycleScroller
    :items="runs"
    :item-size="60"
    key-field="id"
    v-slot="{ item }"
  >
    <div class="run-item">
      {{ item.id }} - {{ item.createdAt }}
    </div>
  </RecycleScroller>
</template>

<script setup lang="ts">
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

const runs = ref([])  // 100 条记录
</script>
```

**验证方法**：DevTools Performance 里录制滚动操作，确认 FPS > 55。

### 6.4 前端性能清单（今日必做）

| 优化 | 前端动作 | 验证 |
|------|---------|------|
| HTTP 缓存 | API 设置 `Cache-Control` + `ETag` | DevTools 看到 304 |
| 请求去重 | 用 `fetchWithDedup` 复用 Promise | 3 次点击只发 1 个请求 |
| 虚拟滚动 | 长列表用 `vue-virtual-scroller` | FPS > 55 |
| 分页加载 | 图表数据分页（每页 20 条） | 首屏加载 < 1s |

---

## 7. 测试与验证：性能测试四件套

性能优化必须用"数据"证明，不能靠"感觉"。四件套：基线对比、压测、反证实验、架构证据。

### 7.1 基线对比（优化前 vs 优化后）

| 指标 | v1 基线 | v2 优化 | v3 优化 | 目标 |
|---|---|---|---|---|
| 查询 P95 延迟 | 4823ms | 178ms | 178ms | < 500ms ✅ |
| DB CPU | 92% | 18% | 15% | < 50% ✅ |
| 连接池峰值占用 | 10/10 (100%) | 15/20 (75%) | 14/20 (70%) | < 80% ✅ |
| 缓存命中率 | 0% | 85% | 87% | > 70% ✅ |
| 队列峰值积压 | 9900 (OOM) | 9900 (OOM) | 850 | < 1000 ✅ |
| 写入 TPS | 800 | 800 | 3200 | > 2000 ✅ |

**测量方法**：

```bash
# 查询 P95：用 k6 压测
k6 run --vus 50 --duration 60s test-query.js

# 缓存命中率：Redis INFO
redis-cli INFO stats | grep keyspace_hits

# 队列积压：BullMQ API
await toolQueue.getWaitingCount()

# 写入 TPS：pgbench
pgbench -c 10 -t 1000 -f insert-test.sql p1_monitor
```

### 7.2 压测（模拟高并发）

```typescript
// apps/api/test/load-test.spec.ts
import { AgentService } from '../src/agent/agent.service'

describe('压测：50 并发查询', () => {
  it('P95 < 500ms', async () => {
    const latencies: number[] = []

    // 50 并发，每个发 20 次请求
    const promises = Array.from({ length: 50 }, async () => {
      for (let i = 0; i < 20; i++) {
        const start = Date.now()
        await agentService.getRecentRuns('tenant-001')
        latencies.push(Date.now() - start)
      }
    })

    await Promise.all(promises)

    // 计算 P95
    latencies.sort((a, b) => a - b)
    const p95 = latencies[Math.floor(latencies.length * 0.95)]

    console.log(`P95: ${p95}ms (${latencies.length} 个请求)`)
    expect(p95).toBeLessThan(500)
  })
})
```

### 7.3 反证实验 1：移除索引后查询劣化

**假设**：复合索引是可选的优化，移除后只是"慢一点"。

**实验**：

```sql
DROP INDEX idx_agent_runs_tenant_created;
```

**现象**：

```bash
EXPLAIN ANALYZE SELECT * FROM agent_runs WHERE tenant_id = 'tenant-001' ORDER BY created_at DESC LIMIT 100;

# 执行计划变回 Seq Scan
Seq Scan on agent_runs  (cost=0.00..180000.00 rows=200000 width=128) (actual time=4720.234 rows=100 loops=1)
Execution Time: 4823.512 ms
```

**结论**：索引不是"可选"，是"必需"——移除后性能从 178ms 劣化到 4823ms（27 倍）。

### 7.4 反证实验 2：无背压时队列 OOM

**假设**：背压只是"降低风险"，不是"防止 OOM"。

**实验**：

```typescript
// 注释掉 BackpressureController
// 模拟 1 万条消息入队
for (let i = 0; i < 10000; i++) {
  await toolQueue.add('execute-tool', { runId: `run-${i}` })
}
```

**现象**：

```
[Queue] 队列长度: 9900
[Node.js] Heap usage: 1.8 GB / 2 GB
[Node.js] Process killed: OOM
```

**结论**：背压是"必需"防护——无背压时队列积压直接导致 OOM。

### 7.5 架构证据四件套

1. **性能 ADR**：记录优化前后数据、决策理由、权衡（见 `docs/adr/003-performance-optimization-day37.md`）
2. **执行计划对比**：v1 的 Seq Scan 截图 vs v3 的 Index Scan 截图
3. **压测报告**：k6 输出的 P95/P99/TPS 数据
4. **监控面板截图**：Grafana 或自建面板展示 P95 趋势、缓存命中率趋势

---

## 8. 通关检查清单（v3 规范 11 项）

- [x] §0 本日在 90 天路线图的坐标已说明（阶段二第 7 天，承 Day 32/34/35，启 Day 38）
- [x] §1.1 用户场景 5 个（慢查询、连接池耗尽、缓存命中率低、队列背压、写放大）
- [x] §1.2 模块职责（QueryAnalyzer、IndexDesigner、PoolMonitor、CacheStrategy、BackpressureController）
- [x] §1.3 三版演进（v1 基线 → v2 索引+缓存+连接池 → v3 背压+索引瘦身+监控）
- [x] §1.4 完整目录结构（performance/ 模块，5 个架构问题，依赖箭头，3 个灵魂拷问）
- [x] §1.5 脚手架检查（Day 29/32/35 依赖，Prisma 迁移脚本，连接池配置）
- [x] §2 开发节奏 6 小时（40min 原理 → 30min 基线 → 60min 索引 → 70min 缓存/连接池 → 60min 背压 → 100min 压测）
- [x] §3 v1 基线测量（5 个性能问题，基线数据表格）
- [x] §4 v2 单点优化（复合索引、连接池、缓存策略，单元测试 + 集成测试）
- [x] §5 v3 生产级（背压控制、索引瘦身、性能监控，3 个知识点五要素）
- [x] §6 前端底子（HTTP 缓存、请求去重、虚拟滚动）
- [x] §7 测试四件套（基线对比、压测、2 个反证实验、架构证据）

---

## 9. 从今天的增量到下一站

今天你把系统性能从"裸奔"（4.8s 查询、连接池耗尽、无缓存）优化到"生产级"（< 200ms 查询、缓存命中率 > 80%、队列背压防 OOM）。但你会发现一个新问题：**性能优化是"一次性动作"还是"持续过程"？**

生产环境的性能不是"优化一次就永远快"——数据量增长（8000 万 → 1 亿）、查询模式变化（新增按 `userId` 查询）、流量峰值（双 11）都会让性能回归。Day 38 起你会建立"性能回归自动检测 + 自动优化建议"系统，让性能优化从"人工介入"变成"自动巡检"。

今天手写的每一个性能指标（P95、命中率、连接池占用），都是明天自动化监控的数据源。

---

## 10. 本日小结

**标题党 30 字**：从慢查询全表扫描 4.8s 到复合索引 + 缓存 + 背压的 180ms，用数据证明每一步优化的价值。

**三句话**：
1. 性能优化不是"感觉快了"，而是用基线对比（优化前 4.8s vs 优化后 178ms）+ 压测数据（P95 < 500ms）+ 反证实验（移除索引劣化 27 倍）证明。
2. 索引、缓存、连接池、背压是四个独立的优化点,但它们组合起来才是"全链路性能治理"——索引降低查询时间、缓存减少 DB 请求、连接池防止耗尽、背压防止 OOM。
3. 性能优化的终极目标不是"快"，而是"快且稳定"——P95 < 500ms 是"快"，持续监控 + 告警 + 自动巡检是"稳定"。

---

## 11. 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"性能优化"的数据流或控制流；当天知识链"Query plan、复合索引、连接池、缓存命中、流背压"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**（查询链路）：
```
用户请求 /api/runs/recent
  → CacheStrategy.get()（查缓存，L1 防线）
  → 命中 → 直接返回（< 10ms）
  → Miss → PoolMonitor.acquire()（获取连接，L2 防线）
  → QueryAnalyzer.execute()（执行查询，用复合索引）
  → PostgreSQL Index Scan（< 200ms）
  → CacheStrategy.set()（写缓存）
  → 返回结果
  → PerformanceMonitor.recordLatency()（记录延迟）
```

**控制流**（队列链路）：
```
Agent 执行产生消息
  → BackpressureController.check()（检查队列长度，L1 防线）
  → 超阈值 → 暂停生产（返回 503）
  → 未超 → 入队
  → 消费者处理（concurrency: 5）
  → 写入 DB（索引优化降低写成本）
```

**知识链分层**：
- **Query plan**：QueryAnalyzer 分析层（定位瓶颈）
- **复合索引**：数据库存储层（加速查询）
- **连接池**：连接管理层（防止耗尽）
- **缓存命中**：缓存层（减少 DB 请求）
- **流背压**：队列控制层（防止 OOM）

**为什么按这个顺序学习**：
1. 先学 Query plan（分析工具），才能定位"哪个查询慢"
2. 再学复合索引（根本解决），才能优化查询本身
3. 再学连接池（资源管理），才能支撑高并发
4. 再学缓存（减少请求），才能进一步降低 DB 负载
5. 最后学背压（防御机制），才能保证系统不崩溃

这个顺序是"从诊断到优化到防护"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：复合索引（`idx_agent_runs_tenant_created`）。

**可观察现象**：查询 P95 从 178ms 飙到 4823ms，DB CPU 从 15% 飙到 92%，用户看到页面加载超时。

**最小复现**：
```sql
-- 1. 删除索引
DROP INDEX idx_agent_runs_tenant_created;

-- 2. 执行查询
EXPLAIN ANALYZE 
SELECT * FROM agent_runs 
WHERE tenant_id = 'tenant-001' 
ORDER BY created_at DESC 
LIMIT 100;

-- 3. 观察执行计划
-- 预期：Seq Scan + Sort，耗时 > 4s
```

**定位证据**：
```
-- 查询执行计划
Seq Scan on agent_runs  (cost=0.00..180000.00 rows=200000 width=128) (actual time=4720.234 rows=100 loops=1)
Filter: (tenant_id = 'tenant-001')
Rows Removed by Filter: 79800000
Execution Time: 4823.512 ms

-- 查询慢查询日志
SELECT query, calls, mean_exec_time 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
-- 预期：该查询 mean_exec_time > 4000ms
```

**恢复动作**：
```sql
-- 1. 重建索引
CREATE INDEX CONCURRENTLY idx_agent_runs_tenant_created 
ON agent_runs(tenant_id, created_at DESC);

-- 2. 验证执行计划
EXPLAIN ANALYZE 
SELECT * FROM agent_runs 
WHERE tenant_id = 'tenant-001' 
ORDER BY created_at DESC 
LIMIT 100;
-- 预期：Index Scan，耗时 < 200ms

-- 3. 重启服务（更新 Prisma 连接池）
pm2 restart api
```

**防复发测试**（E2E）：
```typescript
// apps/api/test/performance-regression.e2e-spec.ts
describe('性能回归检测', () => {
  it('查询 P95 < 500ms（防止索引丢失）', async () => {
    const latencies: number[] = []

    for (let i = 0; i < 100; i++) {
      const start = Date.now()
      await agentService.getRecentRuns('tenant-001')
      latencies.push(Date.now() - start)
    }

    latencies.sort((a, b) => a - b)
    const p95 = latencies[Math.floor(latencies.length * 0.95)]

    expect(p95).toBeLessThan(500)  // 若索引丢失，P95 会 > 4000ms，测试失败
  })

  it('验证索引存在', async () => {
    const indexes = await prisma.$queryRaw`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'agent_runs'
    `
    
    const indexNames = indexes.map((row: any) => row.indexname)
    expect(indexNames).toContain('idx_agent_runs_tenant_created')
  })
})
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `apps/api/src/performance/cache/cache-strategy.ts` 第 23 行：`getCacheKey()` 方法实现标准化缓存键（相同查询生成相同键）
- `apps/api/src/performance/backpressure/backpressure-controller.ts` 第 28 行：`check()` 方法实现背压检查（超 highWaterMark 暂停生产）
- `apps/api/prisma/migrations/add_composite_indexes.sql` 第 3 行：`CREATE INDEX idx_agent_runs_tenant_created` 复合索引 DDL

**测试证据**：
- `apps/api/test/performance.e2e-spec.ts` 第 15 行：查询 P95 < 500ms 测试（100 次查询，P95 = 178ms）
- `apps/api/test/performance.e2e-spec.ts` 第 35 行：缓存命中率 > 70% 测试（100 次查询，命中率 = 87%）

**架构证据**：
- 基线对比表（§7.1）：展示优化前后 6 个指标变化（P95 从 4823ms 到 178ms，缓存命中率从 0% 到 87%）
- 执行计划对比（§3.3 vs §4.3.1）：展示 Seq Scan → Index Scan 的变化
- 性能 ADR 文档（`docs/adr/003-performance-optimization-day37.md`）：记录优化决策和权衡

**项目目标达成**：
- ✅ 查询 P95 < 500ms（实际 178ms）
- ✅ 连接池峰值占用 < 80%（实际 70%）
- ✅ 缓存命中率 > 70%（实际 87%）
- ✅ 队列积压 < 1000（实际 850）
- ✅ 写入 TPS > 2000（实际 3200）

**距离企业生产标准还缺**：
1. **自动索引建议**：当前索引是人工分析 `pg_stat_statements` 后手动创建，生产环境需要"自动扫描慢查询 + 自动建议索引"（类似 AWS RDS Performance Insights）
2. **动态缓存 TTL**：当前 TTL 写死（热数据 5min、冷数据 1h），生产环境需要"根据访问频率动态调整 TTL"
3. **分布式缓存一致性**：当前只有单机 Redis，生产环境需要"多级缓存（L1 内存 + L2 Redis）+ 缓存失效广播"
4. **查询超时熔断**：当前慢查询会一直执行到完成，生产环境需要"查询超时自动 kill（statement_timeout）+ 熔断机制"

**下一步演进（不破坏合同）**：
- 在 `QueryAnalyzer` 里新增 `suggestIndex()` 方法（自动分析慢查询并建议索引），不改变现有查询逻辑
- 在 `CacheStrategy` 里新增 `dynamicTTL()` 方法（根据访问频率调整 TTL），不改变现有缓存键格式
- 新增 `L1Cache`（内存缓存）+ `CacheInvalidationBus`（失效广播），不改变现有 Redis 缓存接口
- 在 Prisma 连接池配置里新增 `statement_timeout`（查询超时），不改变现有连接池大小

---

## 12. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：Agent 时间线表有 8000 万行，按 tenantId、runId、createdAt 查询的 P95 从 180 ms 升到 4.8 s，DB CPU 达 92%。请提交 EXPLAIN ANALYZE、慢查询和连接池指标，先限制大范围查询，再设计复合索引或分区并修正 SQL，使用同数据集对比延迟、写放大和回归。
   依据：[PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

2. 模拟情境：流式消费者变慢后连接池占用 95%，Redis 命中率由 82% 降至 24%，请求开始级联超时。请关联 event-loop lag、DB wait、缓存 miss 和流背压指标，先限并发与降级非关键查询，再修复连接生命周期、缓存键和背压，验证峰值流量下池不耗尽且数据不陈旧。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)

知识映射：对应 query plan、索引、连接池、缓存与流背压。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. PDF 面试题映射

1. 全栈开发中如何设计数据库表结构以应对高频读写？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 9 页。

2. Redis 在项目中主要承担什么作用，如何面对穿透、击穿和雪崩？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 9 页。

题目说明：直接匹配索引、读写、缓存和数据一致性；必须用真实 query plan 与压测数据作答。

---
