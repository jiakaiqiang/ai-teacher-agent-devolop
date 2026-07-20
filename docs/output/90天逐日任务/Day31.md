# Day 31：Tool Registry v2（租户隔离 + 版本治理 + 风险分级 + 调用审计）

任务版本：标准版
日期与时长：2026-08-13 周四，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 11 Tool Registry v1（单租户/无版本/无权限）后，第一次面对"多租户环境下工具注册混乱、旧客户端调用失败、越权调用无法追踪"生产问题的全栈开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-30：全栈基础 + M3 月度门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 全栈深化 + LangGraph 多 Agent
   Day 31：Tool Registry v2（租户隔离 + 版本治理）  ← 今天在这里
   Day 32-40：LangGraph 状态机编排 + 多 Agent 协同
   Day 41-50：RAG 深化 + Hybrid Search
   Day 51-60：可观测性 + M6 门禁

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 31 在阶段二第 1 天**。Day 11 实现了单租户 Tool Registry v1（能注册工具、执行工具、记录超时），但没有租户隔离、没有版本治理、没有权限控制、没有调用审计。今天要升级为 **Tool Registry v2**，支持多租户隔离、工具版本演进、风险分级授权、不可抵赖调用日志。

### 到 Day 30 结束时项目已具备的能力

- **Tool Registry v1**（Day 11）：单租户工具注册 + Schema 校验 + 超时裁剪 + 执行审计
- **Agent Loop**（Day 12）：循环调工具 + step/time/token 预算 + Provider 抽象
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除
- **鉴权**（Day 24）：JWT + RBAC/ABAC + 资源级授权
- **队列**（Day 29）：BullMQ jobId 幂等 + 重试退避 + 死信

### 今天要解决的 4 个问题

1. **问题 1：多租户混用工具（租户隔离）**
   Day 11 的 Registry 全局共享——租户 A 注册的 `deleteDisk` 工具能被租户 B 调用，导致租户 B 误删租户 A 的磁盘。**如何隔离？**

2. **问题 2：旧客户端调用新工具失败（版本治理）**
   工具从 v1 升级到 v2（Schema 增加必填字段），旧客户端还在发 v1 Schema 的调用请求，服务端拒绝执行返回 400。**如何兼容？**

3. **问题 3：只读租户调用删除类工具（风险分级）**
   租户 C 是"只读租户"（业务合同约定只能查询，不能写），但 Registry 里没有"风险分级"概念，租户 C 成功调用了 `deleteServer` 工具。**如何防护？**

4. **问题 4：调用无法追踪（审计不完整）**
   审计日志只记录"工具被调用"，但没记录"谁调用的（userId/tenantId）"、"调用参数"、"执行结果"、"是否成功"。运营无法判断某次调用是否真正执行、是否有副作用。**如何补全？**

---
## 1. 今天要交付的功能模块

在 `p1-monitor/apps/api` 里交付 **Tool Registry v2**：把 Day 11 的单租户 Registry 升级为支持"租户隔离 + 版本协商 + 风险分级 + 不可抵赖调用日志"的可治理 Capability 层。

### 1.1 用户能看到什么

**场景 1：多租户隔离（租户 A 无法调用租户 B 的工具）**

```
租户 A 注册工具：
POST /tools/register
{
  "tenantId": "tenant-A",
  "name": "deleteDisk",
  "version": "v1",
  "schema": {...},
  "risk": "high"
}

租户 B 尝试调用租户 A 的工具：
POST /tools/execute
{
  "tenantId": "tenant-B",
  "toolName": "deleteDisk",
  "version": "v1",
  "arguments": {...}
}

返回 403 Forbidden：
{
  "code": "TOOL_NOT_AUTHORIZED",
  "message": "Tool deleteDisk@v1 not available for tenant-B"
}
```

**场景 2：版本协商（旧客户端自动降级到 v1）**

```
工具演进：deleteDisk v1 → v2（Schema 增加必填字段 dryRun）

旧客户端调用（发送 v1 Schema）：
POST /tools/execute
{
  "tenantId": "tenant-A",
  "toolName": "deleteDisk",
  "version": "v1",              ← 明确请求 v1
  "arguments": {"diskId": "d-001"}
}

Registry 版本协商：
1. 检查 tenant-A 是否有 deleteDisk@v1（有，但已标记 deprecated）
2. 检查 tenant-A 是否有 deleteDisk@v2（有，但客户端请求的是 v1）
3. 决策：允许降级到 v1（向后兼容窗口 30 天）
4. 执行 v1 实现（不需要 dryRun 参数）

返回 200 OK + 版本警告：
{
  "result": {...},
  "executedVersion": "v1",
  "deprecationWarning": "v1 will be removed on 2026-09-12, please upgrade to v2"
}
```

**场景 3：风险分级（只读租户被拒绝调用高风险工具）**

```
租户 C 是只读租户（capability: ["read"]）

租户 C 尝试调用高风险工具：
POST /tools/execute
{
  "tenantId": "tenant-C",
  "toolName": "deleteServer",
  "version": "v1",
  "arguments": {...}
}

Registry 风险检查：
1. 查询 tenant-C 的 capability: ["read"]
2. 查询 deleteServer@v1 的 risk: "high"
3. 决策：high 风险工具需要 "write" capability，租户 C 只有 "read"

返回 403 Forbidden：
{
  "code": "CAPABILITY_MISMATCH",
  "message": "Tool deleteServer requires [write], but tenant-C only has [read]",
  "requiredCapabilities": ["write"],
  "actualCapabilities": ["read"]
}
```

**场景 4：不可抵赖调用日志（每次调用有唯一终态）**

```
调用工具：
POST /tools/execute {...}

Registry 记录完整生命周期：
1. 调用开始：{callId, tenantId, userId, toolName, version, arguments, startedAt}
2. 执行中：{callId, status: "running", progress: 50%}
3. 调用结束：{callId, status: "succeeded", result, endedAt, durationMs}

审计日志（Postgres tools_audit 表）：
call_id | tenant_id | user_id | tool_name | version | arguments_hash | status | result_hash | started_at | ended_at | duration_ms | decision_reason
c-001   | tenant-A  | u-001   | deleteDisk| v1      | sha256(...)    | succeeded | sha256(...) | 2026-08-13 10:00:00 | 10:00:05 | 5000 | capability_matched

运营查询：
SELECT * FROM tools_audit WHERE call_id = 'c-001'
→ 能看到完整证据链：谁调的、调什么、传什么参数、执行结果、是否成功、耗时多久
```

### 1.2 这个模块在项目里承担什么

- **输入**：租户注册工具（tenantId + toolName + version + schema + risk）、租户调用工具（tenantId + userId + toolName + version + arguments）
- **输出**：隔离后的工具执行结果 + 版本协商决策 + 风险拒绝理由 + 不可抵赖审计日志
- **对齐后续**：Day 32-40 LangGraph 多 Agent 协同时，每个 Agent 有独立的工具权限范围；Day 51-60 可观测性时，调用链路需要 tools_audit 表做追踪

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 单租户全局 Registry，无版本/无权限/无审计 | Day 11 原版：`ToolRegistry` 单例 + `execute(toolName, args)` | Schema 校验、超时裁剪、执行审计 |
| **v1 痛点** | 租户 A 能调租户 B 的工具；旧客户端调新工具失败；只读租户能调删除工具；调用无法追踪 |  |  |
| **v2** | v1 + **租户隔离** + **版本协商** | 拆出 `tenant-tools` 表 + `ToolVersionResolver` | 租户维度注册、版本降级窗口 |
| **v2 痛点** | 无风险分级（只读租户仍能调高风险工具）；审计日志不完整（只记开始不记结果） |  |  |
| **v3** | v2 + **风险分级授权** + **不可抵赖调用日志** | 完整分层（capability/version/risk/audit） | Capability 策略矩阵、调用生命周期终态、审计不可抵赖 |

**用户最终在项目里交付的是 v3**。v1 是 Day 11 原版，v2 和 v3 是今天增量。

---
## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：Tool Registry v2 涉及租户隔离、版本协商、风险分级、调用审计 4 个关注点，如果不先立骨架，最容易犯的错就是把"租户查询"、"版本判断"、"风险检查"、"日志记录"糊在一个 service 里。看完这棵树，下面章节再出现 `apps/api/src/tools/capability/capability-matrix.ts` 时，你就能立刻定位它属于"风险分级授权层"。

**今天在 `p1-monitor/` 下要建立的完整目录树（v3 完整版）**：

```
p1-monitor/
├── apps/api/src/
│   ├── tools/                                   ← 【Day 11 已有，今天升级】
│   │   ├── registry/
│   │   │   ├── tool-registry.types.ts           ← Day 11 已有
│   │   │   ├── tool-registry.service.ts         ← Day 11 已有，今天改：接入租户/版本
│   │   │   └── tool-registry.errors.ts          ← Day 11 已有
│   │   ├── tenant/                              ← 【新增】租户隔离层
│   │   │   ├── tenant-tools.repository.ts       ← 租户工具表（按 tenantId 隔离）
│   │   │   ├── tenant-tools.repository.spec.ts  ← 租户隔离单测
│   │   │   └── tenant.types.ts                  ← TenantTool 类型
│   │   ├── version/                             ← 【新增】版本治理层
│   │   │   ├── version-resolver.service.ts      ← 版本协商策略（降级窗口）
│   │   │   ├── version-resolver.spec.ts         ← 版本协商单测
│   │   │   └── version.types.ts                 ← VersionPolicy 类型
│   │   ├── capability/                          ← 【新增】风险分级授权层
│   │   │   ├── capability-matrix.ts             ← 风险等级 → capability 映射
│   │   │   ├── capability-guard.service.ts      ← 权限检查（租户 capability vs 工具 risk）
│   │   │   ├── capability-guard.spec.ts         ← 风险分级单测
│   │   │   └── capability.types.ts              ← RiskLevel / Capability 类型
│   │   ├── audit/                               ← 【新增】不可抵赖调用审计层
│   │   │   ├── tools-audit.repository.ts        ← tools_audit 表 CRUD
│   │   │   ├── audit-lifecycle.service.ts       ← 调用生命周期（started/running/succeeded/failed/cancelled）
│   │   │   ├── audit-lifecycle.spec.ts          ← 生命周期单测
│   │   │   └── audit.types.ts                   ← ToolCallAudit 类型
│   │   ├── tools.controller.ts                  ← 【改】接入租户/版本/风险/审计
│   │   ├── tools.service.ts                     ← 【改】编排层（调用 tenant/version/capability/audit）
│   │   ├── tools.module.ts                      ← 【改】注册新 Provider
│   │   └── index.ts                             ← 桶文件
│   ├── migrations/                              ← 【Prisma 迁移】
│   │   └── 20260813_tools_v2.sql                ← 新增 tenant_tools / tools_audit 表
│   └── prisma/
│       └── schema.prisma                        ← 【改】新增 TenantTool / ToolCallAudit 模型
├── frontend/src/                                ← 【今天不改前端，Day 32 再接入】
└── tests/e2e/
    └── tools-v2.e2e-spec.ts                     ← 【新增】端到端测试（租户隔离/版本协商/风险拒绝/审计完整）
```

### 1.4.1 为什么这样分层

**分层理由**：

- **tenant 层**：管"谁拥有这个工具"（租户隔离）
- **version 层**：管"调哪个版本"（版本协商）
- **capability 层**：管"有没有权限调"（风险分级）
- **audit 层**：管"调用记录"（不可抵赖）

这 4 层是**正交关注点**——租户隔离失败不影响版本协商、版本协商失败不影响风险检查。分层后每层可以独立单测、独立演进。

### 1.4.2 与 Day 11 v1 的 diff（增量对比表）

| 层级 | Day 11 v1 | Day 31 v3 | 变化原因 |
|---|---|---|---|
| **注册层** | 全局单例 `ToolRegistry` | `TenantToolsRepository` 按 tenantId 存储 | 多租户隔离 |
| **版本层** | 无版本概念 | `VersionResolverService` 协商版本 | 向后兼容 |
| **权限层** | 无权限检查 | `CapabilityGuardService` 风险分级 | 只读租户防护 |
| **审计层** | 只记开始日志 | `AuditLifecycleService` 记完整生命周期 | 不可抵赖 |
| **DB 表** | 无持久化（内存） | `tenant_tools` + `tools_audit` 表 | 可追踪、可恢复 |

### 1.4.3 新增的 3 个依赖箭头

```
调用流程（v3）：

ToolsController.execute(tenantId, userId, toolName, version, args)
  │
  ├─ 1. TenantToolsRepository.findByTenantAndName(tenantId, toolName)
  │     → 租户隔离检查：tenant-A 不能调 tenant-B 的工具
  │
  ├─ 2. VersionResolverService.resolve(requestedVersion, availableVersions)
  │     → 版本协商：旧客户端降级到 v1（30 天窗口）
  │
  ├─ 3. CapabilityGuardService.check(tenantCapabilities, toolRisk)
  │     → 风险检查：只读租户不能调高风险工具
  │
  ├─ 4. AuditLifecycleService.recordStart(callId, tenantId, userId, toolName, version, args)
  │     → 审计：记录调用开始
  │
  ├─ 5. ToolRegistry.execute(toolName, args)  ← Day 11 原有逻辑
  │     → 真正执行工具
  │
  └─ 6. AuditLifecycleService.recordEnd(callId, status, result, durationMs)
        → 审计：记录调用结束（唯一终态）
```

### 1.4.4 边写边问自己的 3 个问题

1. **租户隔离为什么不能只在 Controller 层检查？**
   （因为 Agent Loop 直接调 ToolRegistry.execute，绕过 Controller；必须在 Repository 层兜底）

2. **版本协商的"降级窗口 30 天"为什么是必要的？**
   （旧客户端不可能在工具升级当天全部更新；30 天给足迁移时间，过期后强制升级）

3. **为什么审计日志要记 `arguments_hash` 而不是明文参数？**
   （参数可能含敏感信息，GDPR 合规要求不能明文存；hash 用于"调用唯一性"判定即可）

---
## 1.5 今天的脚手架（动手前先搭骨架）

**为什么需要脚手架**：Day 31 要新增 4 个子模块（tenant/version/capability/audit），如果一上来就写完整代码，很容易"写到一半发现类型定义缺了、表结构没建、测试框架没配"。先搭 10 分钟脚手架，后面 80 分钟写代码才顺。

### 1.5.1 Prisma Schema（新增 2 张表）

```prisma
// prisma/schema.prisma

// 【新增】租户工具表（按 tenantId 隔离）
model TenantTool {
  id            String   @id @default(cuid())
  tenantId      String   @map("tenant_id")
  toolName      String   @map("tool_name")
  version       String
  schema        Json
  risk          String   // "low" | "medium" | "high"
  deprecated    Boolean  @default(false)
  deprecatedAt  DateTime? @map("deprecated_at")
  createdAt     DateTime @default(now()) @map("created_at")

  @@unique([tenantId, toolName, version])
  @@index([tenantId, toolName])
  @@map("tenant_tools")
}

// 【新增】工具调用审计表（不可抵赖日志）
model ToolCallAudit {
  id              String   @id @default(cuid())
  callId          String   @unique @map("call_id")
  tenantId        String   @map("tenant_id")
  userId          String   @map("user_id")
  toolName        String   @map("tool_name")
  version         String
  argumentsHash   String   @map("arguments_hash")
  status          String   // "started" | "running" | "succeeded" | "failed" | "cancelled"
  resultHash      String?  @map("result_hash")
  decisionReason  String?  @map("decision_reason")
  startedAt       DateTime @default(now()) @map("started_at")
  endedAt         DateTime? @map("ended_at")
  durationMs      Int?     @map("duration_ms")

  @@index([tenantId, toolName])
  @@index([callId])
  @@map("tools_audit")
}
```

### 1.5.2 类型定义（5 个新类型）

```typescript
// tools/tenant/tenant.types.ts
export interface TenantTool {
  id: string
  tenantId: string
  toolName: string
  version: string
  schema: object
  risk: RiskLevel
  deprecated: boolean
  deprecatedAt: Date | null
  createdAt: Date
}

// tools/version/version.types.ts
export type VersionPolicy = 'strict' | 'compatible' | 'latest'
export interface VersionResolution {
  requestedVersion: string
  resolvedVersion: string
  deprecated: boolean
  deprecationWarning?: string
}

// tools/capability/capability.types.ts
export type RiskLevel = 'low' | 'medium' | 'high'
export type Capability = 'read' | 'write' | 'admin'
export interface CapabilityDecision {
  allowed: boolean
  reason: string
  required: Capability[]
  actual: Capability[]
}

// tools/audit/audit.types.ts
export type CallStatus = 'started' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface ToolCallAudit {
  callId: string
  tenantId: string
  userId: string
  toolName: string
  version: string
  argumentsHash: string
  status: CallStatus
  resultHash: string | null
  decisionReason: string | null
  startedAt: Date
  endedAt: Date | null
  durationMs: number | null
}
```

### 1.5.3 测试骨架（4 个单测文件）

```typescript
// tools/tenant/tenant-tools.repository.spec.ts
describe('TenantToolsRepository', () => {
  it('租户 A 不能查到租户 B 的工具', () => {})
  it('同一工具的多个版本可以共存', () => {})
})

// tools/version/version-resolver.spec.ts
describe('VersionResolverService', () => {
  it('请求 v1，存在 v1 v2，返回 v1', () => {})
  it('请求 v1，只存在 v2，30 天内允许降级', () => {})
  it('请求 v1，只存在 v2，30 天后拒绝', () => {})
})

// tools/capability/capability-guard.spec.ts
describe('CapabilityGuardService', () => {
  it('只读租户调低风险工具，通过', () => {})
  it('只读租户调高风险工具，拒绝', () => {})
})

// tools/audit/audit-lifecycle.spec.ts
describe('AuditLifecycleService', () => {
  it('记录开始和结束后，status 是 succeeded', () => {})
  it('只记录开始未记录结束，status 是 started（异常）', () => {})
})
```

---

## 2. 今天的学习节奏（180 分钟）

| 阶段 | 时长 | 章节 | 交付物 |
|---|---|---|---|
| 读原理 | 30 min | §3 v1 回顾 + §4 v2 租户隔离/版本协商 | 能口述 4 个问题的"为什么" |
| 读代码 | 60 min | §5 v3 完整代码（capability + audit） | 理解 4 层分工 |
| 写代码 | 60 min | 按 §5.3 节的代码动手实现 | 4 层代码 + 单测全绿 |
| 验收 | 30 min | §7 四件套 + E2E | commit 含 `Refs: Day31` |

**总计**：30 读原理 + 60 读代码 + 60 写代码 + 30 验收 = 180 min

---

## 3. v1 回顾（Day 11 原版）

### 3.1 v1 实现了什么

Day 11 的 Tool Registry v1：

- **工具注册**：`registry.register(name, schema, execute)`
- **Schema 校验**：调用前用 Zod 校验参数
- **超时裁剪**：5 秒超时自动 abort
- **执行审计**：记录工具被调用的时间戳

### 3.2 v1 的 4 个痛点

1. **痛点 1**：全局单例（所有租户共享），租户 A 能调租户 B 的工具
2. **痛点 2**：无版本概念，工具升级后旧客户端调用失败
3. **痛点 3**：无风险分级，只读租户能调删除类工具
4. **痛点 4**：审计日志不完整（只记开始不记结果）

---

## 4. v2：租户隔离 + 版本协商

### 4.1 v2 要实现什么

用户视角：
1. 租户 A 注册的工具，租户 B 调用时返回 403（租户隔离）
2. 工具从 v1 升级到 v2，旧客户端请求 v1 时自动降级（30 天窗口）

### 4.2 v2 核心代码片段

#### 4.2.1 租户隔离：TenantToolsRepository

```typescript
@Injectable()
export class TenantToolsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantAndName(
    tenantId: string,
    toolName: string,
  ): Promise<TenantTool[]> {
    return this.prisma.tenantTool.findMany({
      where: { tenantId, toolName },
      orderBy: { version: 'desc' },
    })
  }

  async register(input: {
    tenantId: string
    toolName: string
    version: string
    schema: object
    risk: RiskLevel
  }): Promise<TenantTool> {
    return this.prisma.tenantTool.create({ data: input })
  }
}
```

#### 4.2.2 版本协商：VersionResolverService

```typescript
@Injectable()
export class VersionResolverService {
  resolve(
    requestedVersion: string,
    availableVersions: TenantTool[],
  ): VersionResolution {
    // 1. 精确匹配
    const exact = availableVersions.find(t => t.version === requestedVersion)
    if (exact) {
      return {
        requestedVersion,
        resolvedVersion: exact.version,
        deprecated: exact.deprecated,
        deprecationWarning: exact.deprecated
          ? `v${exact.version} will be removed on ${exact.deprecatedAt}`
          : undefined,
      }
    }

    // 2. 降级窗口（30 天）
    const latest = availableVersions[0] // 已按 version desc 排序
    const now = new Date()
    const gracePeriod = 30 * 24 * 60 * 60 * 1000 // 30 天
    const canFallback =
      latest.deprecatedAt &&
      now.getTime() - latest.deprecatedAt.getTime() < gracePeriod

    if (canFallback) {
      return {
        requestedVersion,
        resolvedVersion: latest.version,
        deprecated: false,
        deprecationWarning: `Requested v${requestedVersion} not found, using v${latest.version}`,
      }
    }

    throw new VersionNotFoundError(requestedVersion)
  }
}
```

---
## 5. v3：风险分级 + 不可抵赖调用日志（终态）

### 5.1 v3 要实现什么

用户视角：
1. 继承 v2 的租户隔离 + 版本协商
2. 只读租户调高风险工具时返回 403（风险分级）
3. 每次调用有完整生命周期日志（started → succeeded/failed/cancelled，不可抵赖）

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
apps/api/src/tools/
├── tenant/               ← v2 已有
├── version/              ← v2 已有
├── capability/           ← 新增：风险分级
└── audit/                ← 新增：不可抵赖日志
```

### 5.3 v3 完整代码

#### 5.3.1 capability 层：capability-matrix.ts（风险等级映射）

```typescript
import { RiskLevel, Capability } from './capability.types'

/**
 * 风险等级 → 所需 Capability 映射矩阵。
 * 关键原则：高风险工具需要更高权限。
 */
export const CAPABILITY_MATRIX: Record<RiskLevel, Capability[]> = {
  low: ['read'],        // 低风险：只读权限即可
  medium: ['write'],    // 中风险：需要写权限
  high: ['admin'],      // 高风险：需要管理员权限
}

/**
 * 检查租户 capabilities 是否满足工具 risk 要求。
 * 纯函数——不碰 DB，只做"集合包含"判定，可穷举单测。
 */
export function checkCapability(
  tenantCapabilities: Capability[],
  toolRisk: RiskLevel,
): { allowed: boolean; required: Capability[]; actual: Capability[] } {
  const required = CAPABILITY_MATRIX[toolRisk]
  const allowed = required.every(cap => tenantCapabilities.includes(cap))
  return { allowed, required, actual: tenantCapabilities }
}
```

#### 5.3.2 capability 层：capability-guard.service.ts

```typescript
import { Injectable } from '@nestjs/common'
import { checkCapability } from './capability-matrix'
import { CapabilityMismatchError } from './capability.errors'
import { RiskLevel, Capability } from './capability.types'

@Injectable()
export class CapabilityGuardService {
  /**
   * 检查租户是否有权限调用指定风险等级的工具。
   * 抛 CapabilityMismatchError → 映射到 HTTP 403。
   */
  assertCanExecute(
    tenantCapabilities: Capability[],
    toolRisk: RiskLevel,
    toolName: string,
  ): void {
    const { allowed, required, actual } = checkCapability(
      tenantCapabilities,
      toolRisk,
    )

    if (!allowed) {
      throw new CapabilityMismatchError(toolName, required, actual)
    }
  }
}
```

#### 5.3.3 capability 层：capability.errors.ts

```typescript
import { ForbiddenException } from '@nestjs/common'
import { Capability } from './capability.types'

export class CapabilityMismatchError extends ForbiddenException {
  constructor(
    public readonly toolName: string,
    public readonly required: Capability[],
    public readonly actual: Capability[],
  ) {
    super({
      code: 'CAPABILITY_MISMATCH',
      message: `Tool ${toolName} requires [${required.join(',')}], but tenant only has [${actual.join(',')}]`,
      required,
      actual,
    })
  }
}
```

#### 5.3.4 audit 层：audit-lifecycle.service.ts（完整生命周期）

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { ToolsAuditRepository } from './tools-audit.repository'
import { CallStatus } from './audit.types'
import { createHash } from 'crypto'

@Injectable()
export class AuditLifecycleService {
  private readonly logger = new Logger(AuditLifecycleService.name)

  constructor(private readonly auditRepo: ToolsAuditRepository) {}

  /**
   * 记录调用开始（生命周期起点）。
   * 返回 callId，调用方需要在结束时传回来。
   */
  async recordStart(input: {
    callId: string
    tenantId: string
    userId: string
    toolName: string
    version: string
    arguments: object
  }): Promise<void> {
    const argumentsHash = this.hash(JSON.stringify(input.arguments))

    await this.auditRepo.create({
      callId: input.callId,
      tenantId: input.tenantId,
      userId: input.userId,
      toolName: input.toolName,
      version: input.version,
      argumentsHash,
      status: 'started',
      resultHash: null,
      decisionReason: null,
      startedAt: new Date(),
      endedAt: null,
      durationMs: null,
    })

    this.logger.log(`call started: ${input.callId}`)
  }

  /**
   * 记录调用结束（生命周期终点）。
   * 唯一终态：succeeded / failed / cancelled。
   */
  async recordEnd(input: {
    callId: string
    status: Extract<CallStatus, 'succeeded' | 'failed' | 'cancelled'>
    result?: object
    error?: Error
  }): Promise<void> {
    const startRecord = await this.auditRepo.findByCallId(input.callId)
    if (!startRecord) {
      this.logger.warn(`call ${input.callId} has no start record`)
      return
    }

    const endedAt = new Date()
    const durationMs = endedAt.getTime() - startRecord.startedAt.getTime()
    const resultHash = input.result ? this.hash(JSON.stringify(input.result)) : null
    const decisionReason = input.error ? input.error.message : null

    await this.auditRepo.updateEnd({
      callId: input.callId,
      status: input.status,
      resultHash,
      decisionReason,
      endedAt,
      durationMs,
    })

    this.logger.log(`call ended: ${input.callId}, status: ${input.status}, duration: ${durationMs}ms`)
  }

  /**
   * SHA-256 hash（GDPR 合规：不存明文敏感参数）。
   */
  private hash(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }
}
```

#### 5.3.5 audit 层：tools-audit.repository.ts

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ToolCallAudit, CallStatus } from './audit.types'

@Injectable()
export class ToolsAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: Omit<ToolCallAudit, 'id'>): Promise<ToolCallAudit> {
    return this.prisma.toolCallAudit.create({ data: input })
  }

  async findByCallId(callId: string): Promise<ToolCallAudit | null> {
    return this.prisma.toolCallAudit.findUnique({ where: { callId } })
  }

  async updateEnd(input: {
    callId: string
    status: CallStatus
    resultHash: string | null
    decisionReason: string | null
    endedAt: Date
    durationMs: number
  }): Promise<void> {
    await this.prisma.toolCallAudit.update({
      where: { callId: input.callId },
      data: {
        status: input.status,
        resultHash: input.resultHash,
        decisionReason: input.decisionReason,
        endedAt: input.endedAt,
        durationMs: input.durationMs,
      },
    })
  }

  /**
   * 运营查询：找出"有 started 无终态"的异常调用。
   */
  async findOrphanedCalls(): Promise<ToolCallAudit[]> {
    return this.prisma.toolCallAudit.findMany({
      where: {
        status: 'started',
        startedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }, // 5 分钟前开始的
      },
    })
  }
}
```

#### 5.3.6 tools.service.ts（编排层，串联 4 层）

```typescript
import { Injectable } from '@nestjs/common'
import { TenantToolsRepository } from './tenant/tenant-tools.repository'
import { VersionResolverService } from './version/version-resolver.service'
import { CapabilityGuardService } from './capability/capability-guard.service'
import { AuditLifecycleService } from './audit/audit-lifecycle.service'
import { ToolRegistry } from './registry/tool-registry.service' // Day 11 原有
import { Capability } from './capability/capability.types'
import { randomUUID } from 'crypto'

@Injectable()
export class ToolsService {
  constructor(
    private readonly tenantTools: TenantToolsRepository,
    private readonly versionResolver: VersionResolverService,
    private readonly capabilityGuard: CapabilityGuardService,
    private readonly audit: AuditLifecycleService,
    private readonly registry: ToolRegistry,
  ) {}

  /**
   * v3 完整流程：租户隔离 → 版本协商 → 风险检查 → 审计开始 → 执行 → 审计结束。
   */
  async execute(input: {
    tenantId: string
    userId: string
    tenantCapabilities: Capability[]
    toolName: string
    version: string
    arguments: object
  }): Promise<{ result: any; executedVersion: string; deprecationWarning?: string }> {
    const callId = randomUUID()

    try {
      // 1. 租户隔离
      const availableTools = await this.tenantTools.findByTenantAndName(
        input.tenantId,
        input.toolName,
      )
      if (availableTools.length === 0) {
        throw new Error(`Tool ${input.toolName} not available for tenant ${input.tenantId}`)
      }

      // 2. 版本协商
      const resolution = this.versionResolver.resolve(input.version, availableTools)
      const selectedTool = availableTools.find(t => t.version === resolution.resolvedVersion)!

      // 3. 风险检查
      this.capabilityGuard.assertCanExecute(
        input.tenantCapabilities,
        selectedTool.risk,
        input.toolName,
      )

      // 4. 审计开始
      await this.audit.recordStart({
        callId,
        tenantId: input.tenantId,
        userId: input.userId,
        toolName: input.toolName,
        version: resolution.resolvedVersion,
        arguments: input.arguments,
      })

      // 5. 执行（Day 11 原有逻辑）
      const result = await this.registry.execute(input.toolName, input.arguments)

      // 6. 审计结束（成功）
      await this.audit.recordEnd({ callId, status: 'succeeded', result })

      return {
        result,
        executedVersion: resolution.resolvedVersion,
        deprecationWarning: resolution.deprecationWarning,
      }
    } catch (error) {
      // 6. 审计结束（失败）
      await this.audit.recordEnd({ callId, status: 'failed', error: error as Error })
      throw error
    }
  }
}
```

### 5.4 v3 用到的知识点

**知识点 1：租户隔离（Tenant Isolation）**
- 解决的问题：多租户 SaaS 环境下，租户 A 不能看到/调用租户 B 的资源
- 运行机制：所有表加 `tenant_id` 列，查询时强制 `WHERE tenant_id = ?`
- 项目落点：`tenant_tools` 表按 tenantId 分区，Repository 查询自动注入 tenantId
- 生产误区：只在 Controller 层检查（Agent Loop 绕过）；忘记在 DB 层加唯一约束（两个租户注册同名工具冲突）
- 验证方法：租户 A 注册工具，租户 B 调用返回 403

**知识点 2：版本治理（Version Governance）**
- 解决的问题：工具升级后旧客户端调用失败；强制所有客户端同步升级不现实
- 运行机制：工具带 version 字段，支持"精确匹配 + 降级窗口"策略
- 项目落点：`VersionResolverService` 30 天降级窗口
- 生产误区：无降级窗口（旧客户端立刻挂）；降级窗口无限长（技术债累积）
- 验证方法：旧客户端请求 v1，v1 已 deprecated 30 天内返回 v1 + warning，30 天后返回 404

**知识点 3：风险分级授权（Risk-based Authorization）**
- 解决的问题：RBAC 粒度太粗（admin 能干所有事），需要按"操作风险"分级
- 运行机制：工具标 risk（low/medium/high），租户标 capabilities（read/write/admin），矩阵匹配
- 项目落点：`CAPABILITY_MATRIX` 映射 + `CapabilityGuardService.assertCanExecute`
- 生产误区：把风险等级写死在代码里（新工具要改代码）；用"黑名单"而非"白名单"（默认允许很危险）
- 验证方法：只读租户调低风险工具通过，调高风险工具返回 403

**知识点 4：不可抵赖审计（Non-repudiation Audit）**
- 解决的问题：调用方事后否认"我没调过这个工具"；运营无法定位责任
- 运行机制：每次调用记 started + ended 两条日志，带 callId/userId/argumentsHash/resultHash/durationMs
- 项目落点：`AuditLifecycleService` 记完整生命周期（started → succeeded/failed/cancelled）
- 生产误区：只记开始不记结束（无法判断是否真正执行）；明文存敏感参数（GDPR 违规）
- 验证方法：调用工具后查 `tools_audit` 表，断言有 started + succeeded 两条记录

**知识点 5：调用生命周期终态（Call Lifecycle Terminal State）**
- 解决的问题：分布式系统下调用可能"开始了但不知道结束了没"（网络超时/进程崩溃）
- 运行机制：5 种状态（started/running/succeeded/failed/cancelled），后 3 种是唯一终态
- 项目落点：`findOrphanedCalls` 找出 5 分钟前 started 但无终态的调用
- 生产误区：用"进行中"做默认状态（崩溃后永远"进行中"）；没有"取消"状态（用户点取消后日志说成功）
- 验证方法：调用中 kill 进程，重启后查 `tools_audit`，断言 status 是 started（孤儿调用）

**知识点 6：参数 Hash 与 GDPR 合规**
- 解决的问题：调用参数可能含用户手机号/身份证，明文存违反 GDPR
- 运行机制：存 SHA-256(JSON.stringify(arguments))，用于"调用唯一性"判定，无法反推原文
- 项目落点：`AuditLifecycleService.hash` 方法
- 生产误区：用 MD5（已被碰撞攻击）；用可逆加密（密钥泄露=明文泄露）
- 验证方法：两次传相同参数，argumentsHash 一致；改一个字符，hash 完全不同

### 5.5 边写边问自己

- 租户隔离为什么不能只在 Controller 层检查？（Agent Loop 直接调 ToolRegistry.execute，绕过 Controller）
- 版本协商的"降级窗口 30 天"为什么是必要的？（旧客户端不可能在工具升级当天全部更新）
- 为什么审计日志要记 `arguments_hash` 而不是明文参数？（GDPR 合规，参数可能含敏感信息）
- 为什么需要 `findOrphanedCalls` 查孤儿调用？（网络超时/进程崩溃会导致"有开始无结束"，需要人工介入）

---
## 6. 三版对比（v1 vs v2 vs v3）

| 维度 | v1（Day 11） | v2（租户+版本） | v3（风险+审计，终态） |
|---|---|---|---|
| **租户隔离** | 无（全局共享） | ✅ 按 tenantId 隔离 | ✅ 继承 v2 |
| **版本治理** | 无版本概念 | ✅ 版本协商 + 30 天降级窗口 | ✅ 继承 v2 |
| **风险分级** | 无权限检查 | ❌ 只读租户仍能调高风险工具 | ✅ Capability 矩阵授权 |
| **审计完整性** | 只记开始日志 | ❌ 仍不记结束 | ✅ 完整生命周期（started → terminal） |
| **数据库表** | 无持久化 | `tenant_tools` | `tenant_tools` + `tools_audit` |
| **调用流程** | `execute(name, args)` | `execute(tenantId, name, version, args)` | `execute(tenantId, userId, capabilities, name, version, args)` |
| **安全保障** | 无 | 租户隔离 + 版本兼容 | 租户隔离 + 版本兼容 + 风险控制 + 不可抵赖 |

---

## 6.5 前端底子补弱：多租户 SaaS 架构的 4 个关键概念

**为什么前端需要懂多租户**：Day 32-40 要做 LangGraph 多 Agent 协同，每个 Agent 有独立的工具权限范围。如果不理解"租户隔离 vs 用户隔离"、"版本协商 vs 强制升级"、"风险分级 vs RBAC"，前端会把"403 Capability Mismatch"当成 bug、把"deprecation warning"忽略掉。

### 6.5.1 租户隔离 vs 用户隔离

**场景对比**：

| 隔离级别 | 数据分区 | 适用场景 | 前端表现 |
|---|---|---|---|
| **用户隔离** | 同一张表，WHERE user_id=? | B2C 应用（微信/淘宝） | 用户 A 看不到用户 B 的订单 |
| **租户隔离** | 按 tenant_id 分区（逻辑/物理） | B2B SaaS（钉钉/飞书） | 公司 A 看不到公司 B 的员工 |

**前端判定**：登录后拿到 `tenantId`（公司 ID）和 `userId`（员工 ID）两个字段。所有 API 请求都要带 `tenantId`，服务端自动过滤数据。

**HTML 演示**（租户选择器）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>租户隔离演示</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .tenant-selector { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; }
    .tool-list { padding: 10px; background: #f5f5f5; }
    .tool-item { padding: 8px; margin: 5px 0; background: white; border-left: 3px solid #4CAF50; }
    .forbidden { border-left-color: #f44336; opacity: 0.5; }
  </style>
</head>
<body>
  <h2>Tool Registry v2 - 租户隔离演示</h2>
  
  <div class="tenant-selector">
    <label>当前租户：</label>
    <select id="tenantSelect">
      <option value="tenant-A">租户 A（拥有 deleteDisk）</option>
      <option value="tenant-B">租户 B（拥有 queryMetrics）</option>
    </select>
  </div>

  <div class="tool-list">
    <h3>可用工具列表</h3>
    <div id="toolsContainer"></div>
  </div>

  <script>
    const tools = {
      'tenant-A': [
        { name: 'deleteDisk', version: 'v1', risk: 'high' },
        { name: 'queryMetrics', version: 'v1', risk: 'low' },
      ],
      'tenant-B': [
        { name: 'queryMetrics', version: 'v1', risk: 'low' },
        { name: 'exportReport', version: 'v2', risk: 'medium' },
      ],
    }

    const tenantSelect = document.getElementById('tenantSelect')
    const toolsContainer = document.getElementById('toolsContainer')

    tenantSelect.addEventListener('change', renderTools)
    renderTools()

    function renderTools() {
      const tenantId = tenantSelect.value
      const availableTools = tools[tenantId]
      
      toolsContainer.innerHTML = availableTools.map(tool => `
        <div class="tool-item">
          <strong>${tool.name}@${tool.version}</strong> 
          <span style="color: ${tool.risk === 'high' ? 'red' : tool.risk === 'medium' ? 'orange' : 'green'}">
            [${tool.risk} risk]
          </span>
        </div>
      `).join('')
      
      // 模拟跨租户调用被拒绝
      const otherTenantId = tenantId === 'tenant-A' ? 'tenant-B' : 'tenant-A'
      const forbiddenTools = tools[otherTenantId]
      toolsContainer.innerHTML += `<h4>其他租户的工具（不可见）</h4>`
      toolsContainer.innerHTML += forbiddenTools.map(tool => `
        <div class="tool-item forbidden">
          <strong>${tool.name}@${tool.version}</strong> 
          <span>[403 Forbidden]</span>
        </div>
      `).join('')
    }
  </script>
</body>
</html>
```

**深挖原理**：为什么租户隔离不能只在前端过滤？

- **前端过滤**：用户改 JS 代码就能绕过（F12 控制台）
- **后端过滤**：所有 DB 查询强制 `WHERE tenant_id = ?`，在 Prisma Client 扩展里注入（类似 Day 27 的软删除 scope）

### 6.5.2 版本协商 vs 强制升级

**场景对比**：

| 策略 | 旧客户端行为 | 适用场景 | 用户体验 |
|---|---|---|---|
| **强制升级** | 立刻返回 426 Upgrade Required | 安全漏洞修复 | 弹窗"请更新 App" |
| **版本协商** | 30 天内降级到旧版本 | 功能迭代 | 静默兼容 + 警告 |

**前端判定**：API 响应带 `executedVersion` 和 `deprecationWarning`，前端显示"您正在使用旧版本工具，将于 X 月 X 日下线"。

**HTML 演示**（版本协商警告）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>版本协商演示</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .warning { padding: 10px; margin: 10px 0; background: #fff3cd; border-left: 4px solid #ffc107; }
    .error { background: #f8d7da; border-left-color: #dc3545; }
    button { padding: 8px 16px; margin: 5px; cursor: pointer; }
  </style>
</head>
<body>
  <h2>Tool Registry v2 - 版本协商演示</h2>
  
  <button onclick="callTool('v1')">调用 v1（已 deprecated）</button>
  <button onclick="callTool('v2')">调用 v2（最新）</button>
  <button onclick="callTool('v3')">调用 v3（不存在）</button>
  
  <div id="result"></div>

  <script>
    const toolVersions = {
      v1: { deprecated: true, deprecatedAt: '2026-09-12', available: true },
      v2: { deprecated: false, available: true },
    }

    function callTool(requestedVersion) {
      const resultDiv = document.getElementById('result')
      
      if (toolVersions[requestedVersion]?.available) {
        const tool = toolVersions[requestedVersion]
        if (tool.deprecated) {
          resultDiv.innerHTML = `
            <div class="warning">
              ⚠️ 执行成功，但您使用的 ${requestedVersion} 将于 ${tool.deprecatedAt} 下线，请升级到 v2
            </div>
          `
        } else {
          resultDiv.innerHTML = `<div style="color: green;">✅ 执行成功（${requestedVersion}）</div>`
        }
      } else {
        resultDiv.innerHTML = `
          <div class="error">
            ❌ 版本 ${requestedVersion} 不存在，且已过降级窗口期
          </div>
        `
      }
    }
  </script>
</body>
</html>
```

**深挖原理**：降级窗口为什么是 30 天？

- **技术原因**：客户端发版周期通常 2-4 周，30 天覆盖 1-2 个发版周期
- **业务原因**：给客户时间测试新版本（避免"升级即炸"）
- **成本原因**：维护多版本有成本，不能无限兼容（技术债累积）

### 6.5.3 风险分级 vs RBAC

**场景对比**：

| 授权模型 | 粒度 | 判定逻辑 | 适用场景 |
|---|---|---|---|
| **RBAC** | 角色（admin/editor/viewer） | 角色 → 权限列表 | 后台管理系统 |
| **风险分级** | 操作风险（low/medium/high） | 租户 capabilities × 工具 risk | Agent 工具调用 |

**前端判定**：调用工具前先调 `/tools/:name/check`，返回 `{ allowed: true/false, reason }` 再决定是否显示按钮。

**HTML 演示**（风险分级按钮状态）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>风险分级演示</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .tenant-info { padding: 10px; margin-bottom: 20px; background: #e3f2fd; }
    .tool-card { padding: 15px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
    .tool-card.disabled { opacity: 0.5; background: #f5f5f5; }
    button:disabled { cursor: not-allowed; }
    .risk-badge { padding: 2px 8px; border-radius: 3px; font-size: 12px; }
    .risk-low { background: #4CAF50; color: white; }
    .risk-medium { background: #FF9800; color: white; }
    .risk-high { background: #f44336; color: white; }
  </style>
</head>
<body>
  <h2>Tool Registry v2 - 风险分级演示</h2>
  
  <div class="tenant-info">
    <strong>当前租户 capabilities:</strong>
    <select id="capabilitySelect">
      <option value="read">read（只读租户）</option>
      <option value="write">write（普通租户）</option>
      <option value="admin">admin（管理员租户）</option>
    </select>
  </div>

  <div id="toolsContainer"></div>

  <script>
    const tools = [
      { name: 'queryMetrics', risk: 'low', requiredCap: 'read' },
      { name: 'updateConfig', risk: 'medium', requiredCap: 'write' },
      { name: 'deleteDisk', risk: 'high', requiredCap: 'admin' },
    ]

    const capabilityLevels = { read: 1, write: 2, admin: 3 }
    const capabilitySelect = document.getElementById('capabilitySelect')
    const toolsContainer = document.getElementById('toolsContainer')

    capabilitySelect.addEventListener('change', renderTools)
    renderTools()

    function renderTools() {
      const currentCap = capabilitySelect.value
      const currentLevel = capabilityLevels[currentCap]
      
      toolsContainer.innerHTML = tools.map(tool => {
        const requiredLevel = capabilityLevels[tool.requiredCap]
        const allowed = currentLevel >= requiredLevel
        
        return `
          <div class="tool-card ${allowed ? '' : 'disabled'}">
            <div>
              <strong>${tool.name}</strong>
              <span class="risk-badge risk-${tool.risk}">${tool.risk} risk</span>
            </div>
            <div style="margin-top: 8px; font-size: 14px; color: #666;">
              需要：${tool.requiredCap} capability
            </div>
            <button ${allowed ? '' : 'disabled'} onclick="alert('执行 ${tool.name}')">
              ${allowed ? '执行' : `需要 ${tool.requiredCap} 权限`}
            </button>
          </div>
        `
      }).join('')
    }
  </script>
</body>
</html>
```

**深挖原理**：为什么不直接用 RBAC？

- **RBAC 问题**：角色爆炸（需要 admin-delete / admin-write / editor-delete ...）
- **风险分级优势**：按"操作危险程度"分级，租户只需声明 capabilities，新工具自动匹配

### 6.5.4 不可抵赖审计 vs 普通日志

**场景对比**：

| 审计级别 | 记录内容 | 法律效力 | 适用场景 |
|---|---|---|---|
| **普通日志** | 操作发生了 | 无（可篡改） | 开发调试 |
| **不可抵赖审计** | 谁/何时/做什么/结果如何 | 有（带签名/哈希） | 金融/医疗/政务 |

**前端判定**：调用工具后返回 `callId`，用户可在"审计日志"页面查到完整证据链（类似银行转账凭证）。

**HTML 演示**（审计日志查询）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>审计日志演示</title>
  <style>
    body { font-family: 'Courier New', monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    .log-entry { padding: 10px; margin: 5px 0; background: #2d2d30; border-left: 3px solid #007acc; }
    .log-entry.failed { border-left-color: #f44336; }
    .log-header { color: #4ec9b0; }
    .log-data { margin-left: 20px; color: #ce9178; }
    button { padding: 8px 16px; background: #007acc; color: white; border: none; cursor: pointer; }
  </style>
</head>
<body>
  <h2>Tool Call Audit Log</h2>
  <button onclick="simulateCall()">模拟工具调用</button>
  <div id="auditLog"></div>

  <script>
    let callCount = 0

    function simulateCall() {
      callCount++
      const callId = `call-${Date.now()}`
      const status = Math.random() > 0.3 ? 'succeeded' : 'failed'
      
      const logDiv = document.getElementById('auditLog')
      const timestamp = new Date().toISOString()
      
      logDiv.innerHTML = `
        <div class="log-entry ${status === 'failed' ? 'failed' : ''}">
          <div class="log-header">▶ ${timestamp} [${callId}]</div>
          <div class="log-data">tenant_id: tenant-A</div>
          <div class="log-data">user_id: user-001</div>
          <div class="log-data">tool_name: deleteDisk@v1</div>
          <div class="log-data">arguments_hash: sha256(e4d909c...)</div>
          <div class="log-data">status: ${status}</div>
          <div class="log-data">duration_ms: ${Math.floor(Math.random() * 5000)}</div>
          ${status === 'failed' ? '<div class="log-data" style="color: #f44336;">decision_reason: CAPABILITY_MISMATCH</div>' : ''}
        </div>
      ` + logDiv.innerHTML
    }
  </script>
</body>
</html>
```

**深挖原理**：如何保证审计日志不被篡改？

- **技术手段**：每条日志计算哈希，串成 Merkle Tree（区块链原理）
- **组织手段**：审计日志写入只读数据库（WORM，Write Once Read Many）
- **法律手段**：审计日志带时间戳签名（CA 认证）

---
## 7. 验收：端到端 4 件套 + commit

### 7.1 单元测试（4 层独立验证）

```bash
# 租户隔离层
pnpm test tenant-tools.repository.spec.ts
# 预期：租户 A 查不到租户 B 的工具

# 版本协商层
pnpm test version-resolver.spec.ts
# 预期：请求 v1，30 天内降级通过，30 天后拒绝

# 风险分级层
pnpm test capability-guard.spec.ts
# 预期：只读租户调高风险工具返回 403

# 审计层
pnpm test audit-lifecycle.spec.ts
# 预期：每次调用有 started + terminal 两条记录
```

### 7.2 反证实验 1：移除租户隔离（观察越权调用）

**假设**：如果把 `TenantToolsRepository.findByTenantAndName` 里的 `WHERE tenant_id=?` 删掉，会发生什么？

**操作**：

```typescript
// tenant-tools.repository.ts（故意制造漏洞）
async findByTenantAndName(tenantId: string, toolName: string) {
  return this.prisma.tenantTool.findMany({
    // where: { tenantId, toolName },  ← 注释掉租户过滤
    where: { toolName },  ← 只按工具名查询
    orderBy: { version: 'desc' },
  })
}
```

**观察**：

```bash
# 租户 A 注册工具
curl -X POST /tools/register -d '{"tenantId":"tenant-A","toolName":"deleteDisk","version":"v1",...}'

# 租户 B 尝试调用租户 A 的工具
curl -X POST /tools/execute -d '{"tenantId":"tenant-B","toolName":"deleteDisk","version":"v1",...}'

# 预期（漏洞版本）：返回 200 OK，租户 B 成功调用了租户 A 的工具
# 实际（修复后）：返回 403 Forbidden
```

**定位**：查 `tools_audit` 表，发现 `tenant_id=tenant-B` 成功执行了 `deleteDisk`（本该被拒绝）。

**恢复**：还原 `WHERE tenant_id=?` 条件。

**防复发测试**：

```typescript
it('租户 B 不能调用租户 A 的工具', async () => {
  await tenantTools.register({ tenantId: 'tenant-A', toolName: 'deleteDisk', ... })
  await expect(
    toolsService.execute({ tenantId: 'tenant-B', toolName: 'deleteDisk', ... })
  ).rejects.toThrow('not available for tenant-B')
})
```

### 7.3 反证实验 2：移除审计结束（观察孤儿调用）

**假设**：如果调用成功后不记 `recordEnd`，会发生什么？

**操作**：

```typescript
// tools.service.ts（故意不记结束）
async execute(input) {
  const callId = randomUUID()
  await this.audit.recordStart({ callId, ... })
  const result = await this.registry.execute(input.toolName, input.arguments)
  // await this.audit.recordEnd({ callId, status: 'succeeded', result })  ← 注释掉
  return { result }
}
```

**观察**：

```bash
# 调用工具
curl -X POST /tools/execute -d '{"tenantId":"tenant-A","toolName":"queryMetrics",...}'

# 查询审计日志
SELECT * FROM tools_audit WHERE call_id = '...'

# 预期（漏洞版本）：只有 started 记录，没有 terminal 状态
# 实际（修复后）：有 started + succeeded 两条记录
```

**定位**：运营查询 `findOrphanedCalls()`，发现大量 5 分钟前 started 但无终态的调用。

**恢复**：还原 `recordEnd` 调用（放在 try-finally 里保证一定执行）。

**防复发测试**：

```typescript
it('调用结束后必须有 terminal 状态', async () => {
  await toolsService.execute({ tenantId: 'tenant-A', toolName: 'queryMetrics', ... })
  const audit = await auditRepo.findByCallId(callId)
  expect(['succeeded', 'failed', 'cancelled']).toContain(audit.status)
})
```

### 7.4 端到端测试（4 个场景全覆盖）

```typescript
// tests/e2e/tools-v2.e2e-spec.ts
describe('Tool Registry v2 E2E', () => {
  it('场景 1：租户隔离', async () => {
    // 租户 A 注册工具
    await request(app.getHttpServer())
      .post('/tools/register')
      .send({ tenantId: 'tenant-A', toolName: 'deleteDisk', version: 'v1', ... })
      .expect(201)
    
    // 租户 B 调用失败
    await request(app.getHttpServer())
      .post('/tools/execute')
      .send({ tenantId: 'tenant-B', toolName: 'deleteDisk', version: 'v1', ... })
      .expect(403)
  })

  it('场景 2：版本协商', async () => {
    // 注册 v1（已 deprecated）和 v2
    await registerTool({ tenantId: 'tenant-A', toolName: 'tool1', version: 'v1', deprecated: true })
    await registerTool({ tenantId: 'tenant-A', toolName: 'tool1', version: 'v2' })
    
    // 旧客户端请求 v1
    const res = await request(app.getHttpServer())
      .post('/tools/execute')
      .send({ tenantId: 'tenant-A', toolName: 'tool1', version: 'v1', ... })
      .expect(200)
    
    expect(res.body.executedVersion).toBe('v1')
    expect(res.body.deprecationWarning).toContain('will be removed')
  })

  it('场景 3：风险分级', async () => {
    // 注册高风险工具
    await registerTool({ tenantId: 'tenant-A', toolName: 'deleteDisk', risk: 'high' })
    
    // 只读租户调用失败
    await request(app.getHttpServer())
      .post('/tools/execute')
      .send({ 
        tenantId: 'tenant-A', 
        capabilities: ['read'],  // 只读租户
        toolName: 'deleteDisk', 
        ... 
      })
      .expect(403)
      .expect(res => {
        expect(res.body.code).toBe('CAPABILITY_MISMATCH')
        expect(res.body.required).toContain('admin')
      })
  })

  it('场景 4：不可抵赖审计', async () => {
    // 调用工具
    const res = await request(app.getHttpServer())
      .post('/tools/execute')
      .send({ tenantId: 'tenant-A', userId: 'user-001', toolName: 'queryMetrics', ... })
      .expect(200)
    
    // 查询审计日志
    const audit = await prisma.toolCallAudit.findMany({
      where: { tenantId: 'tenant-A', toolName: 'queryMetrics' },
      orderBy: { startedAt: 'desc' },
      take: 1,
    })
    
    expect(audit[0].status).toBe('succeeded')
    expect(audit[0].userId).toBe('user-001')
    expect(audit[0].durationMs).toBeGreaterThan(0)
  })
})
```

### 7.5 四件套验收清单

- [ ] 单元测试全绿（4 层独立验证）
- [ ] 反证实验 1：移除租户隔离 → 观察到越权调用 → 恢复后通过防复发测试
- [ ] 反证实验 2：移除审计结束 → 观察到孤儿调用 → 恢复后通过防复发测试
- [ ] E2E 测试全绿（4 个场景：租户隔离/版本协商/风险分级/审计完整）

### 7.6 git commit 格式

```bash
git add apps/api/src/tools/tenant apps/api/src/tools/version apps/api/src/tools/capability apps/api/src/tools/audit
git add prisma/schema.prisma
git add tests/e2e/tools-v2.e2e-spec.ts
git commit -m "feat(tools): upgrade to Registry v2 (tenant isolation + version governance + risk-based auth + non-repudiation audit)

- tenant layer: isolate tools by tenantId
- version layer: 30-day fallback window for deprecated versions
- capability layer: risk-based authorization (low/medium/high → read/write/admin)
- audit layer: complete lifecycle (started → succeeded/failed/cancelled)

Refs: Day31"
```

**硬红线**：commit 后**不执行** `git push`（Day 30 M3 门禁要求本地验收通过后再推）。

---

## 8. 提交物清单

Day 31 完成后需要提交：

1. **代码 commit**：包含 tenant/version/capability/audit 四层 + Prisma Schema + E2E 测试
2. **测试输出**：`pnpm test` 截图（单元测试全绿）+ E2E 测试日志
3. **学习日志**：按 §5.4 六个知识点，每个知识点写"解决的问题/运行机制/项目落点/生产误区/验证方法"
4. **反证记录**：反证实验 1 和 2 的操作步骤、观察现象、恢复动作、防复发测试
5. **架构证据**：`tools_audit` 表查询截图（证明审计日志完整）

---

## 9. 课末 3 个核心问题

1. **数据流/控制流**：请从今天项目的真实入口到最终输出，解释"Tool Registry v2"的数据流或控制流；当天知识链"租户隔离、版本治理、风险分级、调用审计"分别在哪一层起作用，为什么按这个顺序学习？

2. **故障注入**：如果故意移除今天最关键的保护机制（租户隔离的 WHERE tenant_id=? 条件），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

3. **架构证据**：请引用今天的具体代码、测试和架构证据，证明项目目标（租户隔离/版本协商/风险分级/审计完整）已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## 10. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **模拟情境**：8 个租户共注册 120 个 Tool，Registry v2 上线后旧客户端仍发送 v1 Schema，工具失败率从 0.8% 升至 18%，且一个只读租户看到了删除类 Tool。请用 tenantId、toolVersion、schemaHash、decisionReason 和 Trace 定位，给出冻结高风险 Tool 的止损动作、版本协商与能力策略修复，并设计灰度、越权和 Schema 漂移回归。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

2. **模拟情境**：系统每天执行 5 万次 Tool Call，审计发现 37 次调用只有开始日志、没有结果或终态，运营无法判断是否真正执行。请还原一次调用的完整证据链，先阻断无法审计的写操作，再修复 Registry 生命周期和不可抵赖调用日志，并用故障注入证明成功、拒绝、超时、取消均有唯一终态。
   依据：[S6 Agent Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)

知识映射：对应 Tool Registry v2、版本治理、风险分级、授权与调用追踪。

---

## 11. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 什么是 Function Calling？前端处理 Agent 工具调用时要注意什么？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 7 页。

2. TypeScript 装饰器在 AI 框架中可怎样标记 Tool、提取 Schema、记录日志与控制权限？  
   来源：[《2026京东前端面试-大模型方向》](<../../资源/2026京东前端面试-大模型方向.pdf>)，第 9 页。

题目说明：直接匹配 Tool Registry、Schema、权限与调用日志；版本生命周期仍需当天项目补足。

---

## 12. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 13. 本 Day 在 90 天路线中的锚点

Day 31 是阶段二（Day 31-60）第 1 天，完成 Tool Registry 从 v1（单租户/无版本/无权限）到 v2（多租户隔离 + 版本治理 + 风险分级 + 不可抵赖审计）的升级。

**前置依赖**：Day 11（Tool Registry v1）、Day 24（JWT + RBAC）、Day 27（Prisma 持久化）

**后续衔接**：
- Day 32-40：LangGraph 多 Agent 协同（每个 Agent 有独立的工具权限范围）
- Day 51-60：可观测性（调用链路追踪需要 tools_audit 表）

**核心交付**：`tenant_tools` 表 + `tools_audit` 表 + 4 层分工（tenant/version/capability/audit）+ E2E 四件套

---

## 14. 下一步（Day 32）

Day 32 将进入 **LangGraph 状态机编排**，学习如何用 StateGraph 定义多 Agent 协同工作流（Task Planner → Code Writer → Code Reviewer）。今天的 Tool Registry v2 是 Agent 的"工具箱"，Day 32 会让多个 Agent **共享这个工具箱、但有不同的权限范围**（Code Writer 能调 `writeFile`，Code Reviewer 只能调 `readFile`）。

**预习建议**：
1. 阅读 LangGraph 官方文档 [State Management](https://langchain-ai.github.io/langgraphjs/concepts/low_level/#state-management)
2. 理解 StateGraph 的 3 个核心概念：Node（Agent 行为）、Edge（路由条件）、State（共享上下文）
3. 思考"多 Agent 如何避免互相干扰"（隔离 vs 共享的权衡）
