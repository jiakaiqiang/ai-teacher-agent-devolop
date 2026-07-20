# Day 39 - Agent 指标：运行质量看板与问题下钻

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

日期与时长：2026-08-21 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日目录结构（先看全局，再写代码）**
>
> ```
> apps/api/src/metrics/
> ├── metrics.module.ts                 ← 样板：模块聚合
> ├── sli/
> │   ├── sli-definition.ts             ← 核心：你手写（SLI 指标字典）
> │   ├── success-criteria.ts           ← 核心：你手写（Agent 成功定义）
> │   └── termination-classifier.ts     ← 核心：你手写（终止原因分类）
> ├── aggregation/
> │   ├── metric-aggregator.ts          ← 核心：你手写（聚合计算 + 分母追踪）
> │   ├── cost-breakdown.ts             ← 核心：你手写（成本分解：provider/model/tenant）
> │   └── drilldown.service.ts          ← 核心：你手写（下钻到 run 级明细）
> ├── slo/
> │   ├── slo-config.ts                 ← 核心：你手写（SLO 目标定义）
> │   └── slo-validator.ts              ← 核心：你手写（SLO 达成检查）
> ├── collection/
> │   ├── metric-collector.ts           ← 样板：采集点埋点
> │   └── run-lifecycle-hook.ts         ← 核心：你手写（run 生命周期采集）
> └── __tests__/
>     ├── success-criteria.spec.ts
>     ├── cost-breakdown.spec.ts
>     └── metrics.e2e-spec.ts
>
> apps/web/src/pages/
> ├── MetricsDashboard.vue              ← 核心：你手写（聚合看板 + 下钻入口）
> ├── RunDrilldown.vue                  ← 核心：你手写（单 run 明细 + 证据链）
> └── CostBreakdown.vue                 ← 核心：你手写（成本分解视图）
> ```
>
> 说明：今天是阶段二最后一天，也是监控体系的收官。Day35 建立了 Trace 贯穿，Day37 建立了性能指标采集，今天把这些原始数据加工成**业务指标**：不是"请求成功率"，而是"任务完成率"；不是"平均延迟"，而是"用户等待时长"。核心是**你来定义什么是成功**，AI 只负责查询聚合。

## §0 今天在 90 天里的位置

**阶段二第 9 天，也是阶段二收官。** 前八天你把系统从"单点原型"推到"生产级基础设施"：

- Day31-33：可持久化 HITL（审批状态机 + 租约 + 队列恢复）
- Day34：失败恢复（错误分类 + DLQ + 补偿 + 重放）
- Day35：可观测性（Trace 贯穿 + PII 脱敏 + 采样）
- Day36：API 安全（CORS/上传/注入/限流/错误脱敏）
- Day37：性能（query plan + 索引 + 连接池 + 缓存 + 背压）
- Day38：稳定性（超时预算 + 有限重试 + 熔断 + 舱壁 + 降级）

**今天要解决的 5 个指标问题：**

1. **伪完成不可见**：看板显示成功率 99.9%，但 23% 用户在 Agent 宣称完成后仍手工处理——"HTTP 200 ≠ 任务成功"，需要业务级成功定义。
2. **聚合指标无法下钻**：月度 Token 成本翻倍，聚合看板只显示总数，无法追溯是哪个模型、哪个租户、哪种失败导致。
3. **缺乏分母和口径**：指标只有结果值（"平均步数 4.2"），不知道分母是什么（所有 run？成功 run？排除超时？）。
4. **终止原因不明**：run 失败了，是超时、工具错误、模型拒答、还是用户主动中断？没有分类统计，无法定向优化。
5. **SLO 没有明确目标**：指标采集了，但没有"成功率 > 95%"这样的 SLO 目标，也就没有告警，只能事后发现问题。

今天是从"采集指标"到"定义成功"的跃迁——Day37 采集的是原始数据（延迟、错误码），今天加工成业务语义（任务完成率、成本分布）。

## §1 今天要做的事

### 1.1 五个真实用户场景

| # | 场景 | 没有业务指标会怎样 | 有了之后 |
|---|------|-------------------|---------|
| 1 | PM 问"上周成功率多少" | 你给了"HTTP 200 率 99.9%"，但用户实际满意度很低 | 给"任务完成率 87%"（带证据：有 Artifact、无人工接管） |
| 2 | Token 成本翻倍 | 只知道总成本涨了，不知道是哪个模型、哪个租户 | 成本分解：gpt-4 占 60%、租户 A 占 40%、失败重试占 15% |
| 3 | 优化"平均步数" | 不知道分母是什么，改完发现数字变了但业务没改善 | 明确口径："成功 run 的平均步数（排除超时和人工接管）" |
| 4 | run 失败 | 看板只显示"失败 120 个"，不知道是工具错误还是超时 | 终止分布：超时 50 个、工具错误 40 个、模型拒答 30 个 |
| 5 | 设 SLO | 指标没有目标，事后才发现成功率掉到 80% | SLO：成功率 > 95%，成本 < $0.5/run，超标自动告警 |

### 1.2 模块职责划分

- **sli（Service Level Indicator）**：指标字典，定义"成功"、"步数"、"成本"的计算口径和分母。
- **aggregation（聚合）**：从 run 明细聚合到租户/模型/时段维度，支持下钻到原始 run。
- **slo（Service Level Objective）**：目标定义（如"成功率 > 95%"），达标检查，超标告警。
- **collection（采集）**：run 生命周期埋点，记录起止时间、终止原因、成本、工具证据。
- **drilldown（下钻）**：从聚合数字点进去，看到贡献这个数字的所有 run，再点进单个 run 看明细。

### 1.3 三版演进

**v1（最小可用）：裸 SQL 聚合 + HTTP 状态码当成功**
- 直接 `SELECT COUNT(*) FROM runs WHERE status='completed'` 当成功率。
- 致命问题：HTTP 200 不等于任务成功（Agent 可能伪完成）；无下钻；无成本分解；无 SLO。

**v2（加业务语义）：定义任务成功 + 终止分类 + 成本分解**
- 成功定义：has_artifact=true AND human_takeover=false AND status='completed'。
- 终止分类：timeout / tool_error / model_refusal / user_cancel / success。
- 成本按 provider/model/tenant 三维分解。
- 解决了"伪完成"和"成本黑盒"，但还缺：下钻链路；SLO 目标。

**v3（生产级）：SLO 目标 + 全链路下钻 + 指标口径文档**
- 每个指标有明确 SLO（成功率 > 95%、P99 < 10s、成本 < $0.5/run）。
- 聚合数字可点击下钻到 run 列表，再点进单个 run 看 Trace + 工具调用 + 终止证据。
- 指标字典文档化：每个指标写清楚"分子 / 分母 / 排除条件"。

### 1.4 目录结构（5 个维度完整展示）

**维度 1：指标模块在整个 apps/api 里的位置**

```
apps/api/src/
├── agent/                    ← Day29-30 Agent 执行（今天要采集指标）
├── tools/                    ← Tool 调用（今天要统计成功率）
├── model/                    ← 模型调用（今天要分解成本）
├── trace/                    ← Day35 Trace（今天要关联下钻）
├── metrics/                  ← 【本日新增】指标采集与聚合
│   ├── metrics.module.ts
│   ├── sli/
│   ├── aggregation/
│   ├── slo/
│   └── collection/
└── app.module.ts
```

**维度 2：一条指标从采集到展示的流程**

```
run 生命周期事件
  → MetricCollector.collect（采集原始数据：开始时间/结束时间/终止原因/成本/工具列表）
    → 写入 metric_events 表
      → MetricAggregator.aggregate（按时段/租户/模型聚合）
        → 计算成功率/平均步数/成本分布
          → SloValidator.check（对比 SLO 目标）
            → 超标 → 告警
  → DashboardAPI.getMetrics（聚合数字）
    → 用户点击下钻 → DrilldownService.getRuns（run 列表）
      → 点击单个 run → RunDetail（Trace + 工具证据 + 终止原因）
```

**维度 3：依赖箭头（谁依赖谁）**

```
MetricCollector ──writes──> metric_events 表
MetricAggregator ──reads──> metric_events 表
SuccessCriteria ──defines──> 成功定义（SLI）
SloValidator ──checks──> SloConfig（目标）
DrilldownService ──reads──> runs 表 + traces 表
DashboardVue ──calls──> MetricsAPI + DrilldownAPI
```

**维度 4：与前几天的关系（diff 视角）**

| 文件 | Day37-38 状态 | Day39 改动 |
|------|--------------|-----------|
| `agent/agent.service.ts` | 执行 run | 加埋点：记录 start/end/termination |
| `tools/tool-executor.ts` | 执行 tool | 加埋点：记录 tool 成功/失败/耗时 |
| `model/model.service.ts` | 调模型 | 加埋点：记录 token 成本 |
| `trace/**` | Trace 贯穿 | 关联下钻（从指标点到 Trace） |
| `metrics/**` | 不存在 | 全新模块 |
| `web/pages/MetricsDashboard.vue` | 不存在 | 聚合看板 + 下钻入口 |

**维度 5：三个灵魂问题（写代码前先答）**

1. **为什么"HTTP 200"不能当成功？** Agent 可以返回 200 但内容是"抱歉我做不到"，或者生成了假数据但没有证据 Artifact。真正的成功需要检查：(1) 有工具调用证据 (2) 用户没有手工接管 (3) 终止原因是正常完成而非超时。
2. **为什么聚合指标必须能下钻到 run？** "平均成本 $0.8" 这个数字本身没法优化——你要看到**哪些 run 成本高**，才能定位是模型选错了、还是重试太多、还是某个租户用量异常。下钻是从聚合到原因的桥梁。
3. **SLI 和 SLO 有什么区别？** SLI 是**指标定义**（"成功"的计算公式），SLO 是**目标值**（"成功率 > 95%"）。SLI 回答"怎么算"，SLO 回答"多少算好"。一个是度量衡，一个是及格线。

### 1.5 今天动手前的脚手架检查

```bash
# 1. 确认 metrics 模块目录不存在（本日新建）
ls apps/api/src/metrics 2>/dev/null && echo "已存在，检查是否残留" || echo "OK，全新"

# 2. 确认前几天的采集点还在
ls apps/api/src/agent/agent.service.ts
ls apps/api/src/tools/tool-executor.ts
ls apps/api/src/model/model.service.ts

# 3. 需要新增 Prisma 表（metric_events + slo_targets）
```

**Prisma Schema 增量（样板，可直接用）：**

```prisma
model MetricEvent {
  id              String   @id @default(cuid())
  runId           String
  eventType       String   // 'run_start' | 'run_end' | 'tool_call' | 'model_call'
  timestamp       DateTime @default(now())
  metadata        Json     // 灵活存储各类指标原始数据
  
  @@index([runId])
  @@index([eventType, timestamp])
}

model SloTarget {
  id              String   @id @default(cuid())
  metric          String   // 'success_rate' | 'p99_latency' | 'cost_per_run'
  targetValue     Float    // 目标值（如 0.95 表示 95%）
  operator        String   // '>' | '<' | '>=' | '<='
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  
  @@unique([metric])
}
```

**迁移脚本：**

```bash
cd apps/api
npx prisma migrate dev --name add_metrics_tables
npx prisma generate
```

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

> 本日严格执行 3h 标准时间盒，前 90 分钟只读，后 90 分钟完成项目增量、测试和证据。

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理与源码 | 90 min | 读 SLI/SLO、Agent 成功定义和成本分解，画指标口径图 |
| v2 增量 | 25 min | 任务成功定义 + 终止分类器 + 成本分解 |
| v3 增量 | 35 min | SLO 配置 + 全链路下钻 + 指标口径文档 |
| 测试/验证 | 20 min | 伪造假成功 Run，完成两个反证实验和下钻检查 |
| 架构证据 + 复盘 | 10 min | 指标字典 + 决策日志 + AI Review 记录 |

## §3 v1：裸 SQL 聚合 + HTTP 状态码当成功（最小可用）

v1 是你最直觉的做法：从 DB 查 run 表，status='completed' 就算成功。

```typescript
// v1 的朴素写法（apps/api/src/metrics/naive-metrics.ts 早期版本）
async getSuccessRate(): Promise<number> {
  const total = await this.prisma.run.count()
  const completed = await this.prisma.run.count({
    where: { status: 'completed' }
  })
  return completed / total
}

async getAverageSteps(): Promise<number> {
  const runs = await this.prisma.run.findMany({
    select: { toolCalls: true }
  })
  const totalSteps = runs.reduce((sum, r) => sum + r.toolCalls.length, 0)
  return totalSteps / runs.length
}
```

**v1 的 5 个致命问题：**

1. **伪完成不可见**：status='completed' 只表示"流程走完"，不表示"任务成功"。Agent 可能返回"我做不到"也标 completed。
2. **无下钻**：只有聚合数字（"成功率 87%"），不知道是哪 13% 失败了，无法定向优化。
3. **无分母说明**：平均步数的分母是什么？所有 run？只算成功的？排除超时的？不明确。
4. **成本黑盒**：只有总成本，不知道是哪个模型、哪个租户花的钱。
5. **无 SLO 目标**：指标采了，但没有"成功率应该 > 95%"这样的目标，也就没有告警，只能事后发现问题。

这 5 个问题正好对应今天要学的 5 个知识点。v2、v3 逐个解决。

## §4 v2：任务成功定义 + 终止分类 + 成本分解（加业务语义）

v2 解决 v1 的前三个问题：伪完成、成本黑盒、分母不明。这三块里，**如何定义"任务成功"**是最核心的业务决策，我给结构、原理和判断标准，代码请你手写。

### 4.1 v2 的目录增量

```
apps/api/src/metrics/
├── sli/
│   ├── sli-definition.ts             ← 核心：你手写（SLI 指标字典）
│   ├── success-criteria.ts           ← 核心：你手写（任务成功判定）
│   └── termination-classifier.ts     ← 核心：你手写（终止原因分类）
├── aggregation/
│   ├── metric-aggregator.ts          ← 核心：你手写（聚合 + 分母追踪）
│   └── cost-breakdown.ts             ← 核心：你手写（成本三维分解）
└── collection/
    ├── metric-collector.ts           ← 样板：埋点框架
    └── run-lifecycle-hook.ts         ← 核心：你手写（run 生命周期采集）
```

### 4.2 定义任务成功：不是 HTTP 200，是业务完成

**知识点 1：Agent 成功定义（Success Criteria）**

- **解决什么问题**：HTTP 200 ≠ 任务成功。Agent 可以正常返回但内容是"我做不到"、"权限不足"、"找不到数据"，这些都是**流程成功、任务失败**。
- **运行机制**：多维判定。任务成功需要同时满足：(1) status='completed' (2) has_artifact=true（有产出证据）(3) human_takeover=false（未人工接管）(4) termination_reason='success'（正常完成而非超时）。任何一条不满足都算失败。
- **项目落点**：`success-criteria.ts` 实现判定逻辑，从 run 数据计算 isSuccess。
- **生产误区**：只看 status 字段——这是技术状态，不是业务状态。要结合工具证据、人工接管、终止原因综合判断。
- **验证方法**：构造"status=completed 但无 Artifact"的 run，确认被识别为失败。

**SuccessCriteria 你要手写的核心逻辑（伪代码）：**

```
SuccessCriteria.isSuccess(run):
  # 技术完成
  if run.status != 'completed': return false
  
  # 有产出证据（工具调用或 Artifact）
  if not run.hasArtifact and run.toolCalls.length == 0: return false
  
  # 未人工接管
  if run.humanTakeover == true: return false
  
  # 终止原因是正常完成
  if run.terminationReason not in ['success', 'goal_achieved']: return false
  
  return true
```

### 4.3 终止原因分类：为什么这个 run 结束了

**知识点 2：终止分类（Termination Classifier）**

- **解决什么问题**：run 失败了，是超时、工具错误、模型拒答、还是用户主动中断？没有分类就无法定向优化（超时说明预算不够，工具错误说明工具实现有 bug）。
- **运行机制**：枚举终止原因。success（正常完成）/ timeout（超时）/ tool_error（工具调用失败）/ model_refusal（模型拒绝回答）/ user_cancel（用户主动取消）/ rate_limit（触发限流）/ circuit_open（熔断器打开）。
- **项目落点**：`termination-classifier.ts` 从 run 的最后事件推断终止原因。
- **生产误区**：只有"成功"和"失败"两类——这太粗，无法定位问题。至少分 5-7 类。
- **验证方法**：分别构造超时 run、工具错误 run、模型拒答 run，确认分类正确。

**TerminationClassifier 你要手写的核心逻辑（伪代码）：**

```
TerminationClassifier.classify(run):
  lastEvent = run.events[-1]
  
  # 按优先级判断（越具体的越靠前）
  if lastEvent.type == 'user_cancel': return 'user_cancel'
  if lastEvent.error and 'timeout' in lastEvent.error: return 'timeout'
  if lastEvent.error and lastEvent.source == 'tool': return 'tool_error'
  if lastEvent.error and 'rate_limit' in lastEvent.error: return 'rate_limit'
  if lastEvent.error and 'circuit_open' in lastEvent.error: return 'circuit_open'
  if run.modelRefused: return 'model_refusal'
  if run.status == 'completed': return 'success'
  
  return 'unknown'  # 兜底
```

### 4.4 成本分解：钱花在哪了

**知识点 3：成本三维分解（Cost Breakdown）**

- **解决什么问题**：月度成本翻倍，只有总数无法定位原因。需要按 **provider（OpenAI/Claude/本地）** × **model（gpt-4/gpt-3.5）** × **tenant（租户）** 三维分解。
- **运行机制**：每次模型调用记录 `{provider, model, tenant, tokenUsed, cost}`，聚合时按这三个维度 GROUP BY。
- **项目落点**：`cost-breakdown.ts` 从 metric_events 表聚合成本，支持任意维度组合查询。
- **生产误区**：只按时间聚合（"本月花了 $1000"），不按维度分解——无法回答"哪个租户花的多"、"gpt-4 占比多少"。
- **验证方法**：构造不同 provider/model/tenant 的调用，确认成本能按这三维分解且加总正确。

**CostBreakdown 你要手写的核心逻辑（伪代码）：**

```
CostBreakdown.getByDimensions(startDate, endDate, dimensions):
  # dimensions = ['provider', 'model', 'tenant'] 任意组合
  
  events = query MetricEvent where eventType='model_call' and timestamp in [startDate, endDate]
  
  groupBy = dimensions  # 例如 ['provider', 'model']
  aggregated = {}
  
  for event in events:
    key = tuple([event.metadata[dim] for dim in groupBy])
    aggregated[key] = aggregated.get(key, 0) + event.metadata.cost
  
  return aggregated
```

### 4.5 聚合指标的分母追踪

**知识点 4：指标口径（分子 / 分母 / 排除条件）**

- **解决什么问题**：平均步数 4.2，这个 4.2 的分母是什么？所有 run？只算成功的？排除人工接管的？不明确就无法解释变化。
- **运行机制**：每个指标明确写出计算公式。例如：`avg_steps = sum(toolCalls of successful runs) / count(successful runs, excluding timeout and human_takeover)`。
- **项目落点**：`sli-definition.ts` 文档化每个指标的计算口径，聚合时严格按口径过滤。
- **生产误区**：指标定义只在代码里，没有文档——新人不知道"成功"怎么算，改代码容易改错口径。
- **验证方法**：用指标口径手算一个小数据集，对比代码输出，确认一致。

**SLI 定义示例（你要文档化的内容）：**

```typescript
// apps/api/src/metrics/sli/sli-definition.ts（样板结构，内容你填）
export const SLI_DEFINITIONS = {
  success_rate: {
    name: '任务成功率',
    numerator: 'COUNT(runs WHERE isSuccess=true)',
    denominator: 'COUNT(runs WHERE status != "cancelled")',  // 排除用户主动取消
    excludes: ['user_cancel'],  // 排除条件
    unit: '%',
  },
  avg_steps: {
    name: '平均步数',
    numerator: 'SUM(toolCalls.length WHERE isSuccess=true)',
    denominator: 'COUNT(runs WHERE isSuccess=true)',  // 只算成功的
    excludes: ['timeout', 'human_takeover'],
    unit: 'steps',
  },
  cost_per_run: {
    name: '单次成本',
    numerator: 'SUM(cost)',
    denominator: 'COUNT(runs)',  // 所有 run（包括失败，因为失败也花钱）
    excludes: [],
    unit: 'USD',
  },
} as const
```

### 4.6 v2 阶段验证

```bash
# 任务成功定义：构造伪完成 run
# 插入 run: status='completed' 但 hasArtifact=false
# 确认 SuccessCriteria.isSuccess() 返回 false

# 终止分类：构造不同失败场景
# 超时 run、工具错误 run、模型拒答 run
# 确认 TerminationClassifier 分类正确

# 成本分解：查询成本
curl /api/metrics/cost?groupBy=provider,model
# 期望：{ "openai_gpt-4": 600, "anthropic_claude-3": 400 }
```

## §5 v3：SLO 目标 + 全链路下钻 + 指标口径文档（生产级）

v3 是今天的灵魂，解决 v1/v2 都没碰的两块：**没有明确目标（SLO）就没有告警**，以及**聚合数字无法追溯到原始 run**。SLO 配置和下钻链路是核心业务决策，我给结构、原理和验收标准，代码请你手写。

### 5.1 v3 的目录增量

```
apps/api/src/metrics/
├── slo/
│   ├── slo-config.ts                 ← 核心：你手写（SLO 目标定义）
│   ├── slo-validator.ts              ← 核心：你手写（达标检查 + 告警）
│   └── alert.service.ts              ← 样板：告警发送（可接入已有告警系统）
├── aggregation/
│   └── drilldown.service.ts          ← 核心：你手写（聚合 → run 列表 → 单 run 明细）
└── docs/
    └── metric-dictionary.md          ← 核心：你手写（指标字典文档）
```

### 5.2 SLO 目标：从"采集指标"到"定义成功"

**知识点 1：SLO（Service Level Objective）**

- **解决什么问题**：指标采集了，但没有"成功率应该 > 95%"这样的目标，也就没有告警，只能事后发现问题。SLO 是从度量到管理的跃迁。
- **运行机制**：为每个关键指标设目标值和运算符。例如 `success_rate >= 0.95`、`p99_latency <= 10000`、`cost_per_run <= 0.5`。定时（如每小时）检查指标是否达标，不达标触发告警。
- **项目落点**：`slo-config.ts` 定义目标，`slo-validator.ts` 定时检查并告警。
- **生产误区**：所有指标都设 SLO——应该只对**影响用户体验**的核心指标设 SLO（成功率、P99、成本），内部调试指标（如 Trace 数量）不需要。
- **验证方法**：手动让某指标不达标（如连续失败 10 次让成功率掉到 90%），确认告警触发。

**SloConfig 你要手写的核心逻辑（伪代码）：**

```
SloConfig = [
  {
    metric: 'success_rate',
    target: 0.95,
    operator: '>=',
    window: '1h',  // 滚动窗口 1 小时
    alertChannel: 'slack',
  },
  {
    metric: 'p99_latency',
    target: 10000,
    operator: '<=',
    window: '1h',
    alertChannel: 'slack',
  },
  {
    metric: 'cost_per_run',
    target: 0.5,
    operator: '<=',
    window: '1d',  // 成本按天看
    alertChannel: 'email',
  },
]

SloValidator.check():
  for slo in SloConfig:
    currentValue = MetricAggregator.get(slo.metric, window=slo.window)
    if not evaluate(currentValue, slo.operator, slo.target):
      AlertService.send(
        channel=slo.alertChannel,
        message=f"{slo.metric} SLO breach: {currentValue} {slo.operator} {slo.target}"
      )
```

### 5.3 全链路下钻：从聚合数字到单个 run

**知识点 2：指标下钻（Metric Drilldown）**

- **解决什么问题**：看板显示"成功率 87%"，那剩下 13% 是哪些 run 失败了？是超时还是工具错误？不能下钻就无法定位问题。
- **运行机制**：三级下钻。Level 1: 聚合数字（成功率 87%）→ Level 2: 贡献这个数字的 run 列表（失败的 13% 共 120 个 run）→ Level 3: 单个 run 明细（Trace + 工具调用 + 终止证据）。
- **项目落点**：`drilldown.service.ts` 提供 API，前端看板点击数字调用下钻接口。
- **生产误区**：聚合和明细用两套数据源——导致"聚合显示 120 个失败，但下钻只查到 118 个"。必须用同一查询逻辑（WHERE 条件一致）。
- **验证方法**：手算聚合数字（如失败 run 数），与下钻 run 列表数量对比，确认一致。

**DrilldownService 你要手写的核心逻辑（伪代码）：**

```
DrilldownService.getFailedRuns(startDate, endDate, terminationReason=null):
  # Level 2: run 列表
  whereClause = {
    timestamp: [startDate, endDate],
    isSuccess: false,
  }
  if terminationReason:
    whereClause.terminationReason = terminationReason
  
  runs = query Run where whereClause order by timestamp desc
  
  return runs.map(run => {
    id: run.id,
    startedAt: run.startedAt,
    terminationReason: run.terminationReason,
    cost: run.cost,
    toolCallCount: run.toolCalls.length,
  })

DrilldownService.getRunDetail(runId):
  # Level 3: 单 run 明细
  run = query Run where id=runId include { toolCalls, trace, events }
  
  return {
    basicInfo: { id, startedAt, endedAt, status, terminationReason },
    toolCalls: run.toolCalls.map(t => { name, args, result, error }),
    trace: run.trace,  // 关联 Day35 的 Trace
    timeline: run.events.sort(e => e.timestamp),  // 时间线事件
    evidence: {
      hasArtifact: run.hasArtifact,
      humanTakeover: run.humanTakeover,
      artifacts: run.artifacts,
    },
  }
```

### 5.4 指标字典文档化

**知识点 3：指标字典（Metric Dictionary）**

- **解决什么问题**：指标定义只在代码里，新人不知道"成功"怎么算，PM 也无法理解指标含义，沟通成本高。
- **运行机制**：每个指标写成文档，说明：(1) 名称 (2) 计算公式（分子/分母）(3) 排除条件 (4) 业务含义 (5) SLO 目标。
- **项目落点**：`docs/metric-dictionary.md` 文档化所有指标，与代码同步维护。
- **生产误区**：指标定义散落在代码、Wiki、Slack 消息里——改代码时容易漏改文档，导致不一致。文档应该在代码仓库里，与代码一起 review。
- **验证方法**：让不懂代码的 PM 读指标字典，能否理解每个指标的含义和计算方式。

**指标字典示例（你要手写的文档）：**

```markdown
# 指标字典

## 任务成功率（success_rate）

**业务含义**：Agent 完成任务的比例。不是"HTTP 200 率"，而是"有产出证据 + 未人工接管 + 正常完成"的比例。

**计算公式**：
- 分子：满足以下条件的 run 数量
  - status = 'completed'
  - hasArtifact = true 或 toolCalls.length > 0
  - humanTakeover = false
  - terminationReason in ['success', 'goal_achieved']
- 分母：所有 run（排除 user_cancel）

**排除条件**：用户主动取消的 run 不计入分母（用户取消不应该算失败）。

**SLO 目标**：>= 95%（滚动 1 小时窗口）

**下钻路径**：点击数字 → 失败 run 列表（按 terminationReason 分组）→ 单 run 明细

---

## 平均步数（avg_steps）

**业务含义**：成功完成任务的 run 平均调用了多少次工具。反映任务复杂度和效率。

**计算公式**：
- 分子：所有成功 run 的 toolCalls.length 之和
- 分母：成功 run 数量（isSuccess=true）

**排除条件**：失败 run、超时 run、人工接管 run 不计入（它们的步数没有参考价值）。

**SLO 目标**：无（这是效率指标，不是质量指标）

**下钻路径**：点击数字 → 成功 run 列表（按 toolCalls.length 倒序）→ 单 run 工具调用链

---

## 单次成本（cost_per_run）

**业务含义**：每个 run 的平均 token 成本（USD）。包括成功和失败的 run（失败也花钱）。

**计算公式**：
- 分子：所有 run 的 token 成本之和
- 分母：所有 run 数量

**排除条件**：无（失败也计入成本）

**SLO 目标**：<= $0.5（滚动 1 天窗口）

**下钻路径**：点击数字 → 按 provider/model/tenant 三维分解 → 高成本 run 列表

---
```

### 5.5 前端看板的下钻交互

```vue
<!-- apps/web/src/pages/MetricsDashboard.vue（结构示意，你手写） -->
<template>
  <div class="metrics-dashboard">
    <!-- 聚合卡片 -->
    <MetricCard
      title="任务成功率"
      :value="metrics.successRate"
      :slo="0.95"
      @click="drilldown('success_rate')"
    />
    
    <!-- 下钻面板（点击后展开） -->
    <DrilldownPanel v-if="drilldownActive">
      <!-- Level 2: run 列表 -->
      <RunList
        :runs="failedRuns"
        :groupBy="'terminationReason'"
        @selectRun="showRunDetail"
      />
      
      <!-- Level 3: 单 run 明细 -->
      <RunDetailModal
        v-if="selectedRun"
        :run="selectedRun"
      />
    </DrilldownPanel>
  </div>
</template>
```

### 5.6 v3 阶段验证

```bash
# SLO 告警：让成功率不达标
# 连续失败 10 次，让成功率掉到 90%
# 确认告警触发（Slack/Email）

# 下钻链路：从聚合到 run
curl /api/metrics/summary  # 获取聚合数字
# { successRate: 0.87, failedCount: 120 }
curl /api/metrics/drilldown/failed?reason=timeout
# 返回 120 个失败 run 的列表
curl /api/metrics/run/:runId
# 返回单 run 明细（Trace + 工具 + 证据）

# 指标口径一致性：手算 vs 代码输出
# 手算失败 run 数（WHERE isSuccess=false）
# 对比 /api/metrics/drilldown/failed 返回的数量
# 确认一致
```

## §6 前端底子深挖：数据可视化与交互下钻

今天不是加个图表库就行。前端要回答一个真问题：怎么让非技术的 PM 从聚合数字**快速定位到问题根因**？面试官问"怎么展示 Agent 指标、怎么下钻"，答不到交互层次和视觉信息密度就是背组件。

### 6.1 聚合卡片的信息密度

**深挖点 1：一个指标卡片要显示什么？**

- 不只是一个数字"87%"。完整的指标卡片包含：(1) 当前值 (2) SLO 目标（带视觉对比）(3) 趋势（过去 24h 变化）(4) 分母（"87% (120/138)"）(5) 下钻入口。
- **运行机制**：卡片用颜色编码达标状态（绿色达标 / 黄色接近 / 红色不达标）；趋势用迷你折线图（sparkline）而非数字。
- **项目落点**：MetricCard 组件显示值 + 目标 + 趋势 + 分母，点击进入下钻。
- **生产误区**：只显示数字不显示分母——"成功率 87%" 不知道是 120/138 还是 8700/10000，规模感完全不同。
- **验证方法**：让 PM 看卡片，能否在 3 秒内判断指标是否健康、问题规模多大。

**深挖点 2：为什么用 Sparkline 而不是数字显示趋势？**

- 数字"昨天 89%，今天 87%"需要大脑计算差异。折线图一眼看出上升/下降/波动。
- **运行机制**：Sparkline 是迷你折线图（无坐标轴、无标签），只显示形状。24 小时趋势用 24 个数据点，宽度 60px。
- **项目落点**：每个卡片右上角嵌入 Sparkline。
- **生产误区**：用完整折线图（带坐标轴、标签）占太多空间——卡片只需要趋势形状，不需要精确读数。
- **验证方法**：对比数字和 Sparkline，哪个更快发现"昨晚 2 点有个异常尖峰"。

### 6.2 下钻面板的层次导航

**深挖点 3：三级下钻的导航面包屑**

- Level 1（聚合）→ Level 2（run 列表）→ Level 3（单 run）需要导航线索，否则用户不知道自己在哪。
- **运行机制**：面包屑显示当前路径。例如："任务成功率 → 失败 run (120) → timeout (50) → run-abc123"。
- **项目落点**：DrilldownPanel 顶部显示面包屑，点击任一级返回。
- **生产误区**：弹窗套弹窗——用户点进 3 层后不知道怎么回到聚合视图。面包屑 + URL 路由才是正解。
- **验证方法**：从 Level 3 点面包屑任一级，能否直接跳回对应层级。

**深挖点 4：run 列表的分组与排序**

- 120 个失败 run 平铺看不出规律。按 terminationReason 分组后发现"超时 50 个、工具错误 40 个"，立刻知道问题集中在哪。
- **运行机制**：默认按 terminationReason 分组，组内按时间倒序。支持切换排序（按成本、按步数）。
- **项目落点**：RunList 组件支持 groupBy 和 sortBy 参数。
- **生产误区**：只有一个大列表——用户要手动找规律。分组把规律直接呈现。
- **验证方法**：120 个 run 分组后，能否在 5 秒内看出"超时占了 40%"。

### 6.3 成本分解的可视化

**深挖点 5：成本三维分解的树状图**

- 成本分解有三维（provider / model / tenant），平铺表格看不出占比关系。树状图（treemap）用面积表示占比，一眼看出"gpt-4 占 60%"。
- **运行机制**：树状图的矩形面积 = 成本占比。颜色编码 provider，矩形内标注 model + tenant。
- **项目落点**：CostBreakdown 组件用 treemap 可视化成本分解。
- **生产误区**：用饼图——饼图只能显示一个维度（如 provider），看不出 model × tenant 的交叉。树状图可以显示层级结构。
- **验证方法**：让 PM 看树状图，能否在 10 秒内找出"成本最高的 provider + model 组合"。

### 6.4 前端指标看板清单（今日必做）

| 机制 | 前端动作 | 验证 |
|------|---------|------|
| 信息密度 | 卡片显示值 + 目标 + 趋势 + 分母 | PM 3 秒判断健康 |
| 下钻导航 | 面包屑 + URL 路由 | 任意层级可返回 |
| 分组规律 | run 列表按原因分组 | 5 秒看出主要问题 |
| 成本可视化 | 树状图显示三维分解 | 10 秒找出最贵组合 |

## §7 测试与验证：指标测试四件套

指标功能的验证核心是**数据一致性**：聚合数字、下钻列表、手算结果三者必须一致。任何不一致说明口径错了。

### 7.1 单元测试：任务成功判定与终止分类

```typescript
// success-criteria.spec.ts
describe('SuccessCriteria', () => {
  it('completed + hasArtifact + 未接管 = 成功', () => {
    const run = {
      status: 'completed',
      hasArtifact: true,
      humanTakeover: false,
      terminationReason: 'success',
    }
    expect(SuccessCriteria.isSuccess(run)).toBe(true)
  })

  it('completed 但无 Artifact = 失败', () => {
    const run = {
      status: 'completed',
      hasArtifact: false,
      toolCalls: [],
      humanTakeover: false,
      terminationReason: 'success',
    }
    expect(SuccessCriteria.isSuccess(run)).toBe(false)
  })

  it('completed 但人工接管 = 失败', () => {
    const run = {
      status: 'completed',
      hasArtifact: true,
      humanTakeover: true,
      terminationReason: 'success',
    }
    expect(SuccessCriteria.isSuccess(run)).toBe(false)
  })
})

// termination-classifier.spec.ts
describe('TerminationClassifier', () => {
  it('最后事件是超时错误 = timeout', () => {
    const run = {
      events: [{ type: 'error', error: 'Request timeout' }],
    }
    expect(TerminationClassifier.classify(run)).toBe('timeout')
  })

  it('最后事件是工具错误 = tool_error', () => {
    const run = {
      events: [{ type: 'error', source: 'tool', error: 'Tool execution failed' }],
    }
    expect(TerminationClassifier.classify(run)).toBe('tool_error')
  })
})
```

### 7.2 集成测试：聚合与下钻一致性

```typescript
// metrics.e2e-spec.ts
describe('指标聚合与下钻一致性', () => {
  it('聚合失败数 = 下钻 run 列表数', async () => {
    // 插入 10 个成功 run + 5 个失败 run
    await seedRuns({ success: 10, failed: 5 })
    
    // 获取聚合数字
    const summary = await request(app.getHttpServer())
      .get('/api/metrics/summary')
    expect(summary.body.failedCount).toBe(5)
    
    // 下钻获取失败 run 列表
    const drilldown = await request(app.getHttpServer())
      .get('/api/metrics/drilldown/failed')
    expect(drilldown.body.runs.length).toBe(5)
  })

  it('成本分解加总 = 总成本', async () => {
    await seedModelCalls([
      { provider: 'openai', model: 'gpt-4', cost: 0.6 },
      { provider: 'openai', model: 'gpt-3.5', cost: 0.1 },
      { provider: 'anthropic', model: 'claude-3', cost: 0.4 },
    ])
    
    const breakdown = await request(app.getHttpServer())
      .get('/api/metrics/cost?groupBy=provider')
    
    const totalFromBreakdown = Object.values(breakdown.body).reduce((a, b) => a + b, 0)
    expect(totalFromBreakdown).toBeCloseTo(1.1, 2)
  })
})
```

### 7.3 反证实验（两个）

**反证 1：移除成功定义的工具证据检查会怎样？**

- 操作：修改 SuccessCriteria，只检查 status='completed'，不检查 hasArtifact。
- 现象：伪完成 run 被算作成功，成功率虚高（复现情境题 1）。
- 证据：构造 status='completed' 但无 Artifact 的 run，确认被算作成功。看板显示成功率 99%，但实际用户满意度低。
- 结论：工具证据检查是识别伪完成的关键。

**反证 2：移除下钻的 WHERE 条件过滤会怎样？**

- 操作：聚合用 WHERE isSuccess=false，下钻用 WHERE status='failed'（条件不一致）。
- 现象：聚合显示 120 个失败，下钻只查到 80 个（因为有些是 completed 但无证据，status 不是 failed）。
- 证据：对比聚合数字和下钻列表数量，发现不一致。
- 结论：聚合和下钻必须用同一套 WHERE 逻辑。

### 7.4 架构证据四件套

1. **指标字典**：`docs/metric-dictionary.md`，每个指标的计算公式、分母、排除条件、SLO 目标。
2. **决策日志**：为什么这样定义"成功"（有工具证据 + 未接管 + 正常完成）？记录业务讨论和权衡。
3. **下钻链路图**：Level 1（聚合）→ Level 2（run 列表）→ Level 3（单 run 明细）的数据流和 API。
4. **一致性验证报告**：聚合数字、下钻列表、手算结果的对比表格（证明三者一致）。

## §8 通关检查清单（v3 规范 11 项）

- [ ] §0 本日在 90 天路线图的坐标已说明（阶段二第 9 天收官，承接 Day35-38，启阶段三）
- [ ] §1 用户场景 5 个 + 模块职责 + 三版演进 + 完整目录结构 + 脚手架检查齐全
- [ ] §2 6 小时开发节奏已列出（原理 40 / 增量 100 / 测试 25 / 复盘 15，本日 3h 基线按比例折算）
- [ ] §3 v1（裸 SQL + HTTP 状态码当成功）完整代码 + 5 个致命问题
- [ ] §4 v2（任务成功定义 + 终止分类 + 成本分解）完整代码
- [ ] §5 v3（SLO 目标 + 全链路下钻 + 指标口径文档）完整代码 + 6 个知识点五要素
- [ ] §6 前端底子深挖（信息密度 + 下钻导航 + 分组规律 + 成本树状图）
- [ ] §7 测试四件套（单元 + 集成 + 2 个反证实验 + 架构证据）
- [ ] §8 本清单
- [ ] §9 增量到下一站的伏笔
- [ ] §10-14 收尾章节 + 原文情境题/PDF 映射/五连问原样保留

## §9 从今天的增量到下一站

今天你把系统从"采集指标"推到"定义成功"——不再用 HTTP 200 当成功，而是用工具证据 + 人工接管 + 终止原因综合判定。但你会发现一个新问题：**成功的定义是静态的**，实际上不同类型任务的成功标准应该不同（问答任务有 Artifact 就算成功，监控任务需要连续 7 天无告警才算成功）。

阶段三（Day41 起）进入多 Agent 编排，你会遇到**编排级指标**：不是单个 Agent 的成功率，而是整个编排图的完成率、节点间传递延迟、分支覆盖率。今天手写的成功判定、下钻链路、SLO 检查，都是理解"分布式指标聚合"的具体锚点。而动态化成功定义的需求，也会在后续的 Eval 标签体系里收敛。

**阶段二收官总结**：Day31-39 你建立了完整的生产级基础设施——HITL 审批、失败恢复、可观测性、安全、性能、稳定性、指标。这 9 天是从"能跑的原型"到"可上线的系统"的跃迁。阶段三将在这个地基上建多 Agent 编排，而不是从零开始。

## §10 本日小结

**标题党 30 字**：定义什么是"任务成功"，从 HTTP 200 跃迁到工具证据+人工接管+终止原因，让聚合数字可下钻到单 run 明细。

**三句话**：
1. Agent 指标不是技术指标（HTTP 200、P99），而是业务指标（任务完成率、人工接管率）——"完成"需要有工具证据、未人工接管、正常终止三个条件同时满足。
2. 聚合数字必须能下钻到原始 run，否则"成功率 87%"只是个数字，不知道剩下 13% 是超时、工具错误还是模型拒答，也就无法优化。
3. 每个指标必须明确分子、分母、排除条件，并文档化成指标字典——口径不明确，指标就会被误读，改代码时也容易改错。

## §11 课后三道核心问题（必答，先于教师五连问）

1. 请从今天项目的真实入口到最终输出，解释"Agent 指标"的数据流或控制流；当天知识链"SLI/SLO、Agent 成功定义、成本、人工接管率、终止分布"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## §12 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：看板显示请求成功率 99.9%，但 23% 用户在 Agent 宣称完成后仍手工处理，且 9% run 没有证据 Artifact。请从 run 终态、工具证据、人工接管和用户行为下钻，先停止把"HTTP 200"等同成功，再定义任务成功 SLI/SLO，回放样本验证指标能识别伪完成。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)
2. 模拟情境：月度 Token 成本翻倍，聚合看板无法解释是模型、租户还是失败重试导致。请按 provider、model、tenant、terminationReason 和 humanTakeover 分解成本，先限制异常租户预算，再修复指标口径和 run 级下钻，验证每个聚合数字可追溯到原始调用。
   依据：[S6 Agent Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
知识映射：对应 Agent 成功定义、SLO、成本、接管率和终止分布。

## §13 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## §14 PDF 面试题映射

1. 如何衡量 AI 前端产品体验？TTFT、TPS、成功率和反馈闭环如何定义？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 10 页。
2. 如何评估 AI 前端项目成功，技术、业务、成本和用户反馈指标各看什么？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 10 页。
题目说明：直接匹配 SLI 指标字典与业务成功口径；回答必须说明分母、终止分布和下钻 run。
