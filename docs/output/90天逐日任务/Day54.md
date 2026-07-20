# Day 54 - 多租户/权限（Tenant Context + ACL + 资源授权 + 审计 + 缓存隔离）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日为 6 小时扩展日：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟基础动手），剩余 180 分钟用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day55 Docker Compose，Day56 CI/CD，Day57 监控/Trace。
>
> **补强要求**：若正文使用“完整执行版”或“执行版补全要求”，领取任务时必须把省略部分展开为当天可执行的测试/反证/情境题，并记录真实项目 diff。

**日期与时长**：2026-09-05 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：建立多租户隔离和权限控制

---

## §0 Day 54 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-53 已建立的能力）

Day 01-53 建立了完整的 RAG 链路和评测体系：
- **Day 41-48**：RAG 全链路（文档摄取 → 检索 → 生成）
- **Day 49**：引用闭环（Citation）
- **Day 51**：检索评测（Precision@k、Recall@k、MRR）
- **Day 52**：生成质量评测（LLM Judge）
- **Day 53**：LangChain 适用边界（Build-vs-Buy）

**核心缺失**：没有多租户隔离和权限控制。

### 0.2 今天的核心任务

Day 54 建立**多租户隔离和权限控制**，解决"跨租户数据泄露"和"越权访问"两个核心安全问题：

1. **Tenant Context**：请求级租户上下文（AsyncLocalStorage）
2. **ACL Filter**：查询自动注入租户过滤条件
3. **资源授权**：文档/知识库/会话级权限检查
4. **审计日志**：记录所有资源访问（who、when、what、result）
5. **缓存隔离**：缓存键包含 tenantId

### 0.3 今天要解决的 5 个问题

| 问题 | 现象 | 根因 | 解决方案 |
|---|---|---|---|
| 1. 跨租户数据泄露 | 租户 A 读到租户 B 的文档 | 查询未过滤 tenantId | ACL Filter 自动注入 |
| 2. ID 枚举攻击 | 攻击者枚举 documentId 读到 23 个其他租户文档 | 只检查 documentId 存在，不检查权限 | 资源授权（检查 tenantId） |
| 3. 缓存污染 | 两租户同问题返回错误答案 | 缓存键不含 tenantId | 缓存键 = `{tenantId}:{query}` |
| 4. 越权检索 | RAG 检索返回无权文档 | 向量检索未过滤 tenantId | 检索时注入租户过滤 |
| 5. 审计缺失 | 无法追溯谁访问了什么 | 没有审计日志 | 记录所有资源访问 |

### 0.4 今天的前置依赖

- **Day 27**：Postgres 持久化（Prisma）
- **Day 48**：混合检索（需要改造支持租户过滤）

### 0.5 今天留给下一站的伏笔

- **Day 55-60**：成本优化 + 在线评测
- **Day 61-70**：生产级监控（SLA、成本、安全告警）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个场景）

#### 场景 1：跨租户读写全部失败

**操作**：租户 A 尝试读取租户 B 的文档。

```typescript
// 租户 A 的请求
const context = { tenantId: 'tenant-a', userId: 'user-1' }

// 尝试读取租户 B 的文档
const doc = await documentService.getById('doc-belonging-to-tenant-b')
// 预期：抛出 403 Forbidden
```

**输出**：
```
ForbiddenException: Access denied. Document belongs to another tenant.
```

#### 场景 2：ID 枚举攻击被阻断

**攻击者操作**：枚举 documentId 尝试读取其他租户文档。

```bash
# 攻击者枚举 ID
for id in {1..1000}; do
  curl -H "Authorization: Bearer tenant-a-token" \
       "http://api/documents/$id"
done
```

**系统响应**：
- 23 个文档属于其他租户 → 返回 403 Forbidden
- 5 个文档属于租户 A → 返回 200 OK
- 972 个 ID 不存在 → 返回 404 Not Found

**审计日志**：
```
[Audit] tenantId=tenant-a, userId=user-1, action=READ, resource=document:123, result=DENIED (cross-tenant)
[Audit] tenantId=tenant-a, userId=user-1, action=READ, resource=document:124, result=DENIED (cross-tenant)
...
```

#### 场景 3：RAG 检索自动过滤租户

**操作**：租户 A 执行 RAG 检索。

```typescript
const context = { tenantId: 'tenant-a', userId: 'user-1' }
const results = await ragService.search('Nginx 502 error')

// 查询自动注入租户过滤：
// SELECT * FROM chunks WHERE tenantId = 'tenant-a' AND ...
```

**验证**：检索结果只包含租户 A 的文档，不包含其他租户文档。

#### 场景 4：缓存隔离（缓存键包含 tenantId）

**错误做法**：缓存键只包含 query。

```typescript
// ❌ 错误：缓存键不含 tenantId
const cacheKey = `rag:${query}`
```

**问题**：租户 A 和租户 B 同问"Nginx 502 error"，缓存命中返回租户 A 的答案给租户 B（缓存污染）。

**正确做法**：缓存键包含 tenantId。

```typescript
// ✅ 正确：缓存键包含 tenantId
const cacheKey = `rag:${tenantId}:${query}`
```

#### 场景 5：审计日志完整记录

**操作**：查询审计日志。

```sql
SELECT * FROM audit_logs
WHERE tenantId = 'tenant-a'
  AND action = 'READ'
  AND result = 'DENIED'
ORDER BY createdAt DESC
LIMIT 10;
```

**输出**：
```
| tenantId  | userId | action | resource       | result | reason           | createdAt           |
|-----------|--------|--------|----------------|--------|------------------|---------------------|
| tenant-a  | user-1 | READ   | document:123   | DENIED | cross-tenant     | 2026-09-05 10:00:01 |
| tenant-a  | user-1 | READ   | document:124   | DENIED | cross-tenant     | 2026-09-05 10:00:02 |
```

### §1.2 各模块职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                         请求入口（NestJS Guard）                   │
│  - 解析 JWT → 提取 tenantId + userId                              │
│  - 注入 Tenant Context（AsyncLocalStorage）                       │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         ACL Filter（Prisma Middleware）           │
│  - 查询自动注入 tenantId 过滤条件                                   │
│  - SELECT * FROM documents WHERE tenantId = 'tenant-a' AND ...   │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         资源授权（Authorization Service）          │
│  - 文档/知识库/会话级权限检查                                       │
│  - canRead(userId, documentId) → true/false                      │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         审计日志（Audit Service）                  │
│  - 记录所有资源访问（who、when、what、result）                      │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进

#### v1：无租户隔离（Day 01-53）

- 所有租户共享数据
- 查询不过滤 tenantId
- 问题：跨租户数据泄露

#### v2：Tenant Context + ACL Filter（今天）

- 请求级租户上下文（AsyncLocalStorage）
- 查询自动注入租户过滤条件
- 资源授权（文档/知识库/会话）
- 审计日志
- 缓存隔离

#### v3：细粒度权限（Day 55-60）

- RBAC（角色权限）
- 资源级 ACL（读/写/删除/分享）
- 权限继承（知识库 → 文档 → chunk）

### §1.4 今天的完整目录结构

```
apps/api/
├── src/
│   ├── auth/
│   │   ├── guards/
│   │   │   └── tenant.guard.ts                     # 提取租户上下文
│   │   └── decorators/
│   │       └── tenant-context.decorator.ts         # @TenantContext() 装饰器
│   ├── tenant/
│   │   ├── tenant-context.service.ts               # AsyncLocalStorage 管理
│   │   ├── tenant-storage.ts                       # 租户上下文存储
│   │   └── tenant.types.ts                         # TenantContext 类型
│   ├── authorization/
│   │   ├── authorization.service.ts                # 资源授权检查
│   │   ├── policies/
│   │   │   ├── document-policy.ts                  # 文档权限策略
│   │   │   ├── knowledge-base-policy.ts            # 知识库权限策略
│   │   │   └── conversation-policy.ts              # 会话权限策略
│   │   └── acl/
│   │       └── acl-filter.middleware.ts            # Prisma Middleware（ACL 过滤）
│   ├── audit/
│   │   ├── audit.service.ts                        # 审计日志服务
│   │   └── audit-log.entity.ts                     # 审计日志实体
│   └── cache/
│       └── tenant-cache.service.ts                 # 租户隔离缓存
├── prisma/
│   └── schema.prisma                               # 多租户 Schema（tenantId 字段）
└── test/
    └── e2e/
        ├── cross-tenant-access.e2e-spec.ts         # 跨租户访问测试
        └── cache-isolation.e2e-spec.ts             # 缓存隔离测试
```

**为什么这样分层？**

1. **tenant/**：租户上下文管理（AsyncLocalStorage）
2. **authorization/**：资源授权（策略模式）
3. **audit/**：审计日志（独立服务）
4. **cache/**：租户隔离缓存（缓存键包含 tenantId）

---

## §2 今天的开发节奏（6 小时：90 阅读 / 270 动手深化）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 60 min | 理解多租户模型（Tenant Context、ACL、RLS） | 笔记：多租户架构 |
| **阶段 2** | 210 min | 实现 Tenant Context + ACL Filter + 资源授权 + 审计 + 缓存隔离 | 完整代码 |
| **阶段 3** | 60 min | 跨租户 E2E 测试 + ID 枚举测试 + 缓存污染测试 | 测试通过 |
| **阶段 4** | 30 min | 架构证据 + 复盘 | 依赖图 + commit |

---

## §3 v1：无租户隔离（Day 01-53 基线）

### 3.1 v1 的问题

Day 01-53 没有租户隔离：
- 所有租户共享数据
- 查询不过滤 tenantId
- 租户 A 能读到租户 B 的文档

**核心缺失**：
1. 没有 Tenant Context
2. 查询不过滤 tenantId
3. 没有资源授权
4. 没有审计日志
5. 缓存不隔离

---

## §4 v2：Tenant Context + ACL Filter（今天）

### 4.1 v2 新增的能力

- Tenant Context（AsyncLocalStorage）
- ACL Filter（Prisma Middleware）
- 资源授权（文档/知识库/会话）
- 审计日志
- 缓存隔离

### 4.2 核心代码

#### 4.2.1 Tenant Context（AsyncLocalStorage）

```typescript
// apps/api/src/tenant/tenant-storage.ts
import { AsyncLocalStorage } from 'async_hooks'

export interface TenantContext {
  tenantId: string
  userId: string
  organizationId: string
  role: string
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>()
```

**为什么用 AsyncLocalStorage？**

AsyncLocalStorage 是 Node.js 内置的请求级上下文存储，支持异步调用链（Promise、async/await）。每个请求的 tenantId 独立存储，不会互相污染。

#### 4.2.2 Tenant Guard（提取租户上下文）

```typescript
// apps/api/src/auth/guards/tenant.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { tenantStorage } from '../../tenant/tenant-storage'

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    
    // 从 JWT 提取租户信息
    const user = request.user  // JWT payload: { tenantId, userId, organizationId, role }
    
    if (!user || !user.tenantId) {
      throw new UnauthorizedException('Tenant context missing')
    }
    
    // 注入 Tenant Context（AsyncLocalStorage）
    const tenantContext: TenantContext = {
      tenantId: user.tenantId,
      userId: user.userId,
      organizationId: user.organizationId,
      role: user.role,
    }
    
    return tenantStorage.run(tenantContext, () => true)
  }
}
```

**为什么在 Guard 里注入 Tenant Context？**

Guard 是请求入口的第一层（在 Controller 之前执行），保证后续所有代码都能访问 Tenant Context。

#### 4.2.3 Tenant Context Service（获取当前租户）

```typescript
// apps/api/src/tenant/tenant-context.service.ts
import { Injectable } from '@nestjs/common'
import { tenantStorage, TenantContext } from './tenant-storage'

@Injectable()
export class TenantContextService {
  getCurrentTenant(): TenantContext {
    const context = tenantStorage.getStore()
    
    if (!context) {
      throw new Error('Tenant context not found. Did you forget @UseGuards(TenantGuard)?')
    }
    
    return context
  }
  
  getTenantId(): string {
    return this.getCurrentTenant().tenantId
  }
  
  getUserId(): string {
    return this.getCurrentTenant().userId
  }
}
```

#### 4.2.4 ACL Filter（Prisma Middleware）

```typescript
// apps/api/src/authorization/acl/acl-filter.middleware.ts
import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'
import { TenantContextService } from '../../tenant/tenant-context.service'

@Injectable()
export class AclFilterMiddleware implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private tenantContext: TenantContextService,
  ) {}
  
  onModuleInit() {
    // 注册 Prisma Middleware（查询自动注入租户过滤）
    this.prisma.$use(async (params, next) => {
      // 多租户表列表
      const TENANT_TABLES = ['Document', 'KnowledgeBase', 'Conversation', 'Chunk']
      
      if (TENANT_TABLES.includes(params.model)) {
        const tenantId = this.tenantContext.getTenantId()
        
        // 查询自动注入 tenantId 过滤
        if (params.action === 'findMany' || params.action === 'findFirst') {
          params.args.where = {
            ...params.args.where,
            tenantId,
          }
        }
        
        // 创建自动注入 tenantId
        if (params.action === 'create') {
          params.args.data = {
            ...params.args.data,
            tenantId,
          }
        }
        
        // 更新/删除检查 tenantId
        if (params.action === 'update' || params.action === 'delete') {
          params.args.where = {
            ...params.args.where,
            tenantId,
          }
        }
      }
      
      return next(params)
    })
  }
}
```

**为什么用 Prisma Middleware 而不是手动过滤？**

Prisma Middleware 自动注入过滤条件，开发者不需要在每个查询里手动写 `WHERE tenantId = 'xxx'`。防止遗漏导致数据泄露。

**生产陷阱**：Prisma Middleware 只能过滤 Prisma 查询，不能过滤原生 SQL。如果用 `prisma.$executeRaw()`，需要手动注入租户过滤。

#### 4.2.5 资源授权（文档权限策略）

```typescript
// apps/api/src/authorization/policies/document-policy.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../persistence/prisma.service'
import { TenantContextService } from '../../tenant/tenant-context.service'

@Injectable()
export class DocumentPolicy {
  constructor(
    private prisma: PrismaService,
    private tenantContext: TenantContextService,
  ) {}
  
  async canRead(userId: string, documentId: string): Promise<boolean> {
    const tenantId = this.tenantContext.getTenantId()
    
    // 1. 检查文档是否属于当前租户
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { tenantId: true, knowledgeBaseId: true },
    })
    
    if (!document) {
      return false  // 文档不存在
    }
    
    if (document.tenantId !== tenantId) {
      return false  // 跨租户访问（禁止）
    }
    
    // 2. 检查用户是否有知识库访问权限
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: document.knowledgeBaseId },
      include: {
        members: {
          where: { userId },
        },
      },
    })
    
    if (!knowledgeBase) {
      return false  // 知识库不存在
    }
    
    if (knowledgeBase.members.length === 0) {
      return false  // 用户不是知识库成员
    }
    
    return true
  }
}
```

**为什么需要资源授权？**

ACL Filter 只能过滤租户级别（tenantId），不能过滤用户级别（例如"知识库成员"）。资源授权实现细粒度权限控制。

#### 4.2.6 审计日志（Audit Service）

```typescript
// apps/api/src/audit/audit.service.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'
import { TenantContextService } from '../tenant/tenant-context.service'

export enum AuditAction {
  READ = 'READ',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  SEARCH = 'SEARCH',
}

export enum AuditResult {
  ALLOWED = 'ALLOWED',
  DENIED = 'DENIED',
}

@Injectable()
export class AuditService {
  constructor(
    private prisma: PrismaService,
    private tenantContext: TenantContextService,
  ) {}
  
  async log(params: {
    action: AuditAction
    resource: string  // 例如：'document:123', 'knowledge-base:456'
    result: AuditResult
    reason?: string
    metadata?: any
  }): Promise<void> {
    const { tenantId, userId } = this.tenantContext.getCurrentTenant()
    
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: params.action,
        resource: params.resource,
        result: params.result,
        reason: params.reason,
        metadata: params.metadata,
      },
    })
  }
}
```

**Prisma Schema（审计日志表）**：

```prisma
// apps/api/prisma/schema.prisma
model AuditLog {
  id          String   @id @default(cuid())
  tenantId    String
  userId      String
  action      String   // 'READ', 'CREATE', 'UPDATE', 'DELETE', 'SEARCH'
  resource    String   // 'document:123', 'knowledge-base:456'
  result      String   // 'ALLOWED', 'DENIED'
  reason      String?  // 'cross-tenant', 'permission-denied'
  metadata    Json?
  createdAt   DateTime @default(now())
  
  @@index([tenantId])
  @@index([userId])
  @@index([action])
  @@index([result])
  @@index([createdAt])
}
```

**为什么审计日志需要 5 个索引？**

审计日志查询场景多样：
- 按租户查询：`WHERE tenantId = 'xxx'`
- 按用户查询：`WHERE userId = 'xxx'`
- 按操作类型查询：`WHERE action = 'READ'`
- 按结果查询：`WHERE result = 'DENIED'`（查询被拒绝的访问）
- 按时间范围查询：`WHERE createdAt BETWEEN '...' AND '...'`

#### 4.2.7 缓存隔离（Tenant Cache Service）

```typescript
// apps/api/src/cache/tenant-cache.service.ts
import { Injectable } from '@nestjs/common'
import { RedisService } from '../redis/redis.service'
import { TenantContextService } from '../tenant/tenant-context.service'

@Injectable()
export class TenantCacheService {
  constructor(
    private redis: RedisService,
    private tenantContext: TenantContextService,
  ) {}
  
  /**
   * 生成租户隔离的缓存键
   */
  private buildKey(key: string): string {
    const tenantId = this.tenantContext.getTenantId()
    return `${tenantId}:${key}`
  }
  
  async get<T>(key: string): Promise<T | null> {
    const tenantKey = this.buildKey(key)
    const value = await this.redis.get(tenantKey)
    return value ? JSON.parse(value) : null
  }
  
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const tenantKey = this.buildKey(key)
    await this.redis.set(tenantKey, JSON.stringify(value), ttl)
  }
  
  async del(key: string): Promise<void> {
    const tenantKey = this.buildKey(key)
    await this.redis.del(tenantKey)
  }
  
  /**
   * 租户级失效（删除租户所有缓存）
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const keys = await this.redis.keys(`${tenantId}:*`)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }
}
```

**为什么缓存键需要包含 tenantId？**

防止缓存污染：租户 A 和租户 B 同问"Nginx 502 error"，如果缓存键只有 `rag:query`，会返回错误答案。

#### 4.2.8 改造 Document Service（资源授权 + 审计）

```typescript
// apps/api/src/document/document.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'
import { DocumentPolicy } from '../authorization/policies/document-policy'
import { AuditService, AuditAction, AuditResult } from '../audit/audit.service'
import { TenantContextService } from '../tenant/tenant-context.service'

@Injectable()
export class DocumentService {
  constructor(
    private prisma: PrismaService,
    private documentPolicy: DocumentPolicy,
    private auditService: AuditService,
    private tenantContext: TenantContextService,
  ) {}
  
  async getById(documentId: string): Promise<Document> {
    const { tenantId, userId } = this.tenantContext.getCurrentTenant()
    
    // 1. 资源授权检查
    const canRead = await this.documentPolicy.canRead(userId, documentId)
    
    if (!canRead) {
      // 2. 记录审计日志（拒绝）
      await this.auditService.log({
        action: AuditAction.READ,
        resource: `document:${documentId}`,
        result: AuditResult.DENIED,
        reason: 'cross-tenant or permission-denied',
      })
      
      throw new ForbiddenException('Access denied')
    }
    
    // 3. 查询文档（ACL Filter 自动注入 tenantId 过滤）
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    })
    
    // 4. 记录审计日志（允许）
    await this.auditService.log({
      action: AuditAction.READ,
      resource: `document:${documentId}`,
      result: AuditResult.ALLOWED,
    })
    
    return document
  }
}
```

**为什么先检查权限，再查询数据库？**

防止信息泄露：如果先查询再检查权限，查询本身就已经访问了数据库（即使最后拒绝访问）。先检查权限能防止未授权查询。

#### 4.2.9 改造 RAG Service（检索自动过滤租户）

```typescript
// services/ai/src/ai_service/rag/rag_service.py
from tenant.tenant_context import get_current_tenant

class RagService:
    async def search(self, query: str, top_k: int = 5) -> List[Document]:
        tenant_id = get_current_tenant()['tenant_id']
        
        # 1. 向量检索（自动注入租户过滤）
        vector_results = await self.vector_search(
            query=query,
            top_k=top_k * 2,
            filter={'tenant_id': tenant_id}  # 租户过滤
        )
        
        # 2. BM25 检索（自动注入租户过滤）
        bm25_results = await self.bm25_search(
            query=query,
            top_k=top_k * 2,
            filter={'tenant_id': tenant_id}  # 租户过滤
        )
        
        # 3. RRF 融合
        merged = self.rrf_merge(vector_results, bm25_results, top_k)
        
        return merged
```

**为什么向量检索也需要租户过滤？**

向量检索查询 pgvector 表（`SELECT * FROM embeddings ORDER BY embedding <-> query_embedding LIMIT 10`），如果不过滤 tenantId，会返回所有租户的文档。

---

## §5 v2 完整实现（Prisma Schema + 跨租户测试）

### 5.1 Prisma Schema（多租户字段）

```prisma
// apps/api/prisma/schema.prisma
model Organization {
  id          String   @id @default(cuid())
  name        String
  createdAt   DateTime @default(now())
  
  tenants     Tenant[]
}

model Tenant {
  id              String   @id @default(cuid())
  organizationId  String
  name            String
  createdAt       DateTime @default(now())
  
  organization    Organization @relation(fields: [organizationId], references: [id])
  
  knowledgeBases  KnowledgeBase[]
  documents       Document[]
  conversations   Conversation[]
  
  @@index([organizationId])
}

model KnowledgeBase {
  id          String   @id @default(cuid())
  tenantId    String   // 多租户字段
  name        String
  createdAt   DateTime @default(now())
  
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  documents   Document[]
  members     KnowledgeBaseMember[]
  
  @@index([tenantId])
}

model Document {
  id               String   @id @default(cuid())
  tenantId         String   // 多租户字段
  knowledgeBaseId  String
  title            String
  content          String
  createdAt        DateTime @default(now())
  
  tenant           Tenant         @relation(fields: [tenantId], references: [id])
  knowledgeBase    KnowledgeBase  @relation(fields: [knowledgeBaseId], references: [id])
  chunks           Chunk[]
  
  @@index([tenantId])
  @@index([knowledgeBaseId])
}

model Chunk {
  id          String   @id @default(cuid())
  tenantId    String   // 多租户字段
  documentId  String
  content     String
  embedding   Unsupported("vector(1536)")
  createdAt   DateTime @default(now())
  
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  document    Document @relation(fields: [documentId], references: [id])
  
  @@index([tenantId])
  @@index([documentId])
}

model KnowledgeBaseMember {
  id               String   @id @default(cuid())
  knowledgeBaseId  String
  userId           String
  role             String   // 'owner', 'editor', 'viewer'
  createdAt        DateTime @default(now())
  
  knowledgeBase    KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id])
  
  @@unique([knowledgeBaseId, userId])
  @@index([userId])
}
```

**为什么所有表都需要 tenantId 字段？**

保证数据物理隔离：每个表都有 tenantId，查询时自动过滤，防止跨租户数据泄露。

### 5.2 跨租户访问 E2E 测试

```typescript
// apps/api/test/e2e/cross-tenant-access.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import * as request from 'supertest'

describe('Cross-Tenant Access (E2E)', () => {
  let app: INestApplication
  let tenantAToken: string
  let tenantBToken: string
  let tenantBDocumentId: string
  
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    
    app = module.createNestApplication()
    await app.init()
    
    // 创建租户 A 和租户 B
    tenantAToken = await createTenantAndGetToken('tenant-a')
    tenantBToken = await createTenantAndGetToken('tenant-b')
    
    // 租户 B 创建一个文档
    const response = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .send({ title: 'Tenant B Document', content: 'Secret content' })
    
    tenantBDocumentId = response.body.id
  })
  
  afterAll(async () => {
    await app.close()
  })
  
  it('租户 A 读取租户 B 的文档应返回 403', async () => {
    const response = await request(app.getHttpServer())
      .get(`/documents/${tenantBDocumentId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(403)
    
    expect(response.body.message).toContain('Access denied')
  })
  
  it('租户 A RAG 检索不应返回租户 B 的文档', async () => {
    const response = await request(app.getHttpServer())
      .post('/rag/search')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ query: 'Secret content' })
      .expect(200)
    
    // 验证：检索结果不包含租户 B 的文档
    const documentIds = response.body.results.map(r => r.documentId)
    expect(documentIds).not.toContain(tenantBDocumentId)
  })
  
  it('审计日志应记录跨租户访问被拒绝', async () => {
    // 查询审计日志
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        tenantId: 'tenant-a',
        action: 'READ',
        resource: `document:${tenantBDocumentId}`,
        result: 'DENIED',
      },
    })
    
    expect(auditLogs.length).toBeGreaterThan(0)
    expect(auditLogs[0].reason).toContain('cross-tenant')
  })
})
```

### 5.3 缓存污染测试

```typescript
// apps/api/test/e2e/cache-isolation.e2e-spec.ts
describe('Cache Isolation (E2E)', () => {
  it('租户 A 和租户 B 同问题应返回不同答案', async () => {
    // 租户 A 查询
    const responseA = await request(app.getHttpServer())
      .post('/rag/search')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ query: 'Nginx 502 error' })
      .expect(200)
    
    // 租户 B 查询（同问题）
    const responseB = await request(app.getHttpServer())
      .post('/rag/search')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .send({ query: 'Nginx 502 error' })
      .expect(200)
    
    // 验证：返回的文档不同（租户 A 的文档 vs 租户 B 的文档）
    const documentIdsA = responseA.body.results.map(r => r.documentId)
    const documentIdsB = responseB.body.results.map(r => r.documentId)
    
    expect(documentIdsA).not.toEqual(documentIdsB)
  })
})
```

---

## §6 深挖前端底子（完整执行版）

### 6.1 为什么用 AsyncLocalStorage 而不是全局变量？

全局变量在并发请求时会互相污染：
```typescript
// ❌ 错误：全局变量
let currentTenantId = 'tenant-a'

// 请求 A：设置 tenant-a
currentTenantId = 'tenant-a'

// 请求 B：设置 tenant-b（覆盖了请求 A）
currentTenantId = 'tenant-b'

// 请求 A 继续执行：读到 tenant-b（错误）
```

AsyncLocalStorage 支持请求级隔离：
```typescript
// ✅ 正确：AsyncLocalStorage
tenantStorage.run({ tenantId: 'tenant-a' }, () => {
  // 请求 A 的上下文
  console.log(tenantStorage.getStore().tenantId)  // 'tenant-a'
})

tenantStorage.run({ tenantId: 'tenant-b' }, () => {
  // 请求 B 的上下文
  console.log(tenantStorage.getStore().tenantId)  // 'tenant-b'
})
```

### 6.2 为什么审计日志需要异步写入？

审计日志是"记录"而非"阻断"，不应该阻塞主流程。异步写入提高性能：

```typescript
// ❌ 错误：同步写入（阻塞主流程）
await auditService.log(...)
return document

// ✅ 正确：异步写入（不阻塞主流程）
auditService.log(...).catch(err => console.error('Audit failed', err))
return document
```

---

## §7 测试与验证（完整执行版）

### 7.1 跨租户访问测试

```bash
# 测试跨租户访问
npm run test:e2e -- cross-tenant-access.e2e-spec.ts
# 预期：所有跨租户访问返回 403
```

### 7.2 ID 枚举测试

```bash
# 模拟 ID 枚举攻击
for i in {1..100}; do
  curl -H "Authorization: Bearer tenant-a-token" \
       "http://localhost:3000/documents/$i"
done
# 预期：跨租户文档返回 403，审计日志记录所有拒绝
```

### 7.3 缓存污染测试

```bash
# 测试缓存隔离
npm run test:e2e -- cache-isolation.e2e-spec.ts
# 预期：租户 A 和租户 B 同问题返回不同答案
```

---

## 8. 必做测试与两个反证

1. **反证 1：移除 ACL tenant 过滤**。在隔离测试中临时删除 Prisma 查询的 tenantId 条件，用租户 A token 读取租户 B 文档；预期 E2E 发现越权结果并阻止发布。恢复过滤后应返回 403 且审计记录 actor、resource、decision 和 traceId。
2. **反证 2：移除缓存键 tenantId**。让两个租户提交相同 query，先写入租户 A 结果再由租户 B 命中；预期缓存隔离测试捕获污染。恢复 tenantId + knowledgeBaseId + queryHash 复合键后，两租户结果和审计必须独立。

执行跨租户、ID 枚举、缓存污染和并发上下文测试，把命令、失败信号、恢复动作和恢复后结果写入 `docs/evidence/day54/`。

## 9. 课后三道核心问题

1. tenantId 从 JWT/Session 进入 AsyncLocalStorage、Prisma ACL、缓存键和审计日志的完整传播链是什么？哪一层可以拒绝，哪一层只能记录？
2. 为什么仅在 Controller 校验 tenantId 仍可能被后台任务、缓存或内部 Service 绕过？最小复现和防复发合同测试如何设计？
3. 引用本日真实 diff、E2E、缓存测试和审计记录证明隔离有效；当前方案距离生产级密钥、数据保留和合规边界还缺什么？

## 10. 真实项目情境题

1. 两个租户同时查询“502 排查”，租户 B 偶发看到租户 A 的引用。请从请求上下文、Prisma 查询、向量过滤、缓存键和 Trace 定位，先禁用共享缓存止损，再修复并做并发回归。
2. worker 消费异步 RAG 任务时没有 HTTP AsyncLocalStorage，上下文默认成公共租户。请定义显式 TaskContract、签名和审计字段，迁移历史任务并证明重放不会跨租户写入。

## 11. PDF 面试题映射

- 数据权限题必须覆盖身份、资源、策略、查询过滤、缓存隔离、审计和异步任务边界。
- PDF 题仅作为口述训练；本日验收以跨租户 E2E、并发测试和审计证据为准。

## 12. 完成后教师五连问

提交真实 diff、测试、反证和架构证据后，教师按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。回答必须现场指出代码路径、拒绝日志和恢复测试。

## 13. 跨 Day 导航

- 前置复用：Day24 的 actor/Policy/资源授权合同和 Day53 的 RAG/Eval 证据。
- 本日交付：Tenant Context、ACL、资源授权、缓存隔离和审计闭环。
- 后续消费：Day55-60 的成本优化、在线评测和观测必须继续携带 tenantId 和隔离证据。
