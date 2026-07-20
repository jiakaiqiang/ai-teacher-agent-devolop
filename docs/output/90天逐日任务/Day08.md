# Day 8：API/分页（Offset → Cursor → 稳定复合游标 + Query DTO + ViewModel）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-07-21 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：D:\demo\ai-techer\p1-monitor
角色视角：掌握 Day 1-7 事件流、合同、异步竞态、图表、实时可靠性、异常检测的全栈开发者，现在要给异常列表加分页

---

## 0. 今天在 90 天路线中的位置

**承上**：
- Day 1-2 建立了 DTO/Domain 分层和 zod schema 校验
- Day 3 实现了并发读取 + 竞态保护
- Day 4-5 建立了图表 + WebSocket 实时推送
- Day 6 加了心跳/重连/去重
- Day 7 实现了异常检测算法 + 领域事件

**启下**：
- Day 9 会在今天的列表基础上加详情页 + 状态流转（确认/忽略/处理中）
- Day 10 会给列表加实时更新（WebSocket 推送 + 列表合并）
- Day 15 会加历史数据恢复（分页查询大量历史异常）

**今天的核心**：
Day 7 的异常检测每分钟产生 100+ 条异常，前端需要**分页展示**。核心解决：**Offset 分页在并发插入时重复/漏项** → **Cursor 分页** → **相同时间戳时仍然重复** → **复合游标 (createdAt, id)** + **Query DTO 校验 limit** + **ViewModel 投影安全字段**。

---

## 1. 今天要交付的功能模块

### 1.1 用户能看到什么

在 p1-monitor 运维监控系统的异常列表页：

1. **默认视图**：显示最近 20 条异常，按时间倒序
2. **加载更多**：点击底部按钮或滚动到底部，追加下一页 20 条
3. **过滤**：按服务器 ID、严重程度、类型过滤
4. **无重复/漏项**：即使后端持续插入新异常，翻页也不会重复或漏项
5. **安全**：`limit=100000` 或未授权字段会被拒绝

**关键**：用户翻页 100 次，看到的是稳定、连续、无重复的列表。

### 1.2 这个模块在项目里承担什么

**在 p1-monitor 项目中的定位**：
- **架构层**：查询层，负责将 domain 层的大量数据分页交给前端
- **依赖方**：Day 9 详情页、Day 10 实时列表、Day 15 历史恢复
- **被依赖方**：Day 7 的 `Anomaly` 领域模型、Day 2 的 zod schema

**为什么是 Day 8**：
- Day 7 产生了海量异常数据，不能一次性全返回
- 分页在**并发写入**场景下有陷阱（重复、漏项）
- 今天必须建立**稳定游标 + 输入校验 + 输出投影**三道防线

### 1.3 三版演进的目标（v1 / v2 / v3）

| 版本 | 核心目标 | 用户体验 | 技术关键点 |
|---|---|---|---|
| **v1** | Offset 分页能用 | 翻页正常，但并发插入时看到重复 | `LIMIT/OFFSET` |
| **v2** | Cursor 分页解决并发 | 并发插入不重复，但相同时间戳时失败 | `WHERE createdAt < cursor` |
| **v3** | 复合游标 + Query DTO + ViewModel | 稳定分页 + 输入校验 + 字段白名单 | `(createdAt, id)` + zod + DTO 投影 |

**痛点演进**：
- v1 痛点：`OFFSET 20 LIMIT 20` 在并发插入 10 条后，第 2 页会重复看到 10 条
- v2 痛点：`createdAt < '2026-07-21T10:00:00Z'` 时如果有 3 条相同时间戳，会漏掉
- v3 终态：`(createdAt, id) < (cursor.createdAt, cursor.id)` 保证严格顺序 + 加 zod DTO 拒绝 `limit=100000` + ViewModel 隐藏内部字段

### 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架。骨架不清晰直接动手 = 返工。

**今天在 `p1-monitor/backend/` 和 `frontend/` 下要建立的完整源码树（v3 完整版）**：

```
backend/
├── src/
│   ├── anomalies/
│   │   ├── anomalies.controller.ts        ← 今天新建（GET /anomalies）
│   │   ├── anomalies.controller.spec.ts   ← 今天新建（Controller 测试）
│   │   ├── anomalies.service.ts           ← Day 7 已建立，今天加 findMany
│   │   ├── anomalies.service.spec.ts      ← 加分页测试
│   │   └── dto/
│   │       ├── list-anomalies.query.dto.ts  ← 今天新建（Query DTO）
│   │       └── anomaly.view-model.ts        ← 今天新建（ViewModel 投影）
│   └── app.module.ts
frontend/
├── src/
│   ├── domain/
│   │   └── anomalies/
│   │       ├── anomaly.types.ts             ← Day 7 已建立
│   │       └── anomaly.schema.ts            ← Day 7 已建立
│   ├── features/
│   │   └── anomalies/
│   │       ├── api/
│   │       │   └── anomalies-client.ts      ← 今天新建（分页请求封装）
│   │       ├── composables/
│   │       │   ├── useAnomalyList.ts        ← 今天新建（列表 composable）
│   │       │   └── useAnomalyList.spec.ts   ← 今天新建（测试）
│   │       └── components/
│   │           ├── AnomalyListItem.vue      ← 今天新建（单条列表项）
│   │           └── AnomalyList.vue          ← 今天新建（列表容器）
│   └── app/
│       └── pages/
│           └── AnomalyListPage.vue          ← 今天新建（页面）
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `anomalies.controller.ts` | `@Query('page') page` | `@Query('cursor') cursor` | 加 `@Query() dto: ListAnomaliesQueryDto` |
| `anomalies.service.ts` | `skip/take` | `where: { createdAt: { lt: cursor } }` | 复合 where `(createdAt, id) < (c1, c2)` |
| `list-anomalies.query.dto.ts` | 无 | 无 | zod 校验 limit ≤ 100、cursor 格式 |
| `anomaly.view-model.ts` | 无 | 无 | 投影：只暴露 id/type/severity/serverId/createdAt |
| `useAnomalyList.ts` | `page/setPage` | `cursor/loadMore` | 同 v2 + AbortController |

**依赖方向（务必单向）**：

```
前端：AnomalyListPage.vue → AnomalyList.vue → useAnomalyList.ts → anomalies-client.ts → HTTP API
后端：anomalies.controller.ts → anomalies.service.ts → PrismaService
                              ↓
                       ListAnomaliesQueryDto (zod validation)
                              ↓
                       AnomalyViewModel (output projection)
```

**红线**：
- Controller 直接返回 Prisma 实体 = 架构塌方（必须走 ViewModel 投影）
- Controller 不校验 `limit` = 架构塌方（必须走 Query DTO）
- Composable 里出现 `fetch` 而非 client 层 = 架构塌方

**动手前先问自己 3 个问题**：

1. 为什么 Cursor 分页要用 `(createdAt, id)` 复合键，不能只用 `createdAt`？—— 见 §5.4 知识点「稳定排序」
2. 为什么要有 Query DTO 和 ViewModel 两层，不能直接用 Prisma 类型？—— 见 §5.4 知识点「DTO/ViewModel 分层」
3. 前端 `loadMore` 时如何避免重复请求？—— 见 §5.3 v3 代码

### 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

**时间盒**：阶段 D 总共 20 分钟。遇到问题先标记 `// TODO`，读完 v3 代码后回来改。

#### 1.5.1 D-1：装依赖（3 分钟）

```bash
cd p1-monitor/backend
pnpm add zod @nestjs/config
pnpm add -D @types/node

cd ../frontend
# 已有 vue/vite/axios
```

#### 1.5.2 D-2：创建目录（2 分钟）

```bash
# 后端
cd backend/src
mkdir -p anomalies/dto
touch anomalies/anomalies.controller.ts anomalies/anomalies.controller.spec.ts
touch anomalies/dto/list-anomalies.query.dto.ts anomalies/dto/anomaly.view-model.ts

# 前端
cd ../../frontend/src
mkdir -p features/anomalies/api features/anomalies/composables features/anomalies/components
touch features/anomalies/api/anomalies-client.ts
touch features/anomalies/composables/useAnomalyList.ts features/anomalies/composables/useAnomalyList.spec.ts
touch features/anomalies/components/AnomalyListItem.vue features/anomalies/components/AnomalyList.vue
touch app/pages/AnomalyListPage.vue
```

#### 1.5.3 D-3：实现后端 DTO 层（30 分钟）

按第 5.3 节的代码：

- 写 `backend/src/anomalies/dto/list-anomalies.query.dto.ts`（zod 校验 limit/cursor/filters）
- 写 `backend/src/anomalies/dto/anomaly.view-model.ts`（ViewModel 投影 + toViewModel 函数）

**边写边问自己**：

- Query DTO 的 `limit` 为什么要用 `z.coerce.number().max(100)`？（HTTP 传来的是 string）
- Cursor 为什么要 base64 编码，而不是直接传 `createdAt`？（防止用户猜测/篡改）
- ViewModel 为什么要一个 `toViewModel` 转换函数？（隔离 Prisma 类型和响应类型）

#### 1.5.4 D-4：实现后端 Service + Controller（40 分钟）

按第 5.3 节的代码：

- 升级 `backend/src/anomalies/anomalies.service.ts`（加 `findManyWithCursor`）
- 写 `backend/src/anomalies/anomalies.controller.ts`（GET /anomalies）

**边写边问自己**：

- 为什么 `orderBy` 必须是 `[{ createdAt: 'desc' }, { id: 'desc' }]` 两个键？（相同时间戳的排序稳定性）
- 复合游标的 WHERE 子句怎么写？（`OR` 分支模拟词典序）
- `nextCursor` 什么时候返回 null？（`items.length < limit` 表示到底了）

#### 1.5.5 D-5：实现前端 composable + 组件（30 分钟）

按第 5.3 节的代码：

- 写 `frontend/src/features/anomalies/api/anomalies-client.ts`（HTTP 封装）
- 写 `frontend/src/features/anomalies/composables/useAnomalyList.ts`（状态管理）
- 写 `frontend/src/features/anomalies/components/AnomalyList.vue`（列表容器）
- 写 `frontend/src/app/pages/AnomalyListPage.vue`（页面）

**边写边问自己**：

- `loadMore` 时 `loading` 状态如何避免重复触发？（`if (loading || !hasMore) return`）
- 切换过滤器时旧请求要不要取消？（AbortController 复用 Day 3 的模式）
- 列表项的 `key` 用什么？（不能用 index，用 `anomaly.id`）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| **A** | 30 分钟 | 阅读第 3 节（v1 Offset 分页） | 阅读 |
| **B** | 30 分钟 | 阅读第 4 节（v2 单键 Cursor） | 阅读 |
| **C** | 30 分钟 | 阅读第 5 节（v3 复合游标 + DTO + ViewModel） | 阅读 |
| **D** | 60 分钟 | 在自己项目里实现 v3 完整功能（见 §1.5） | 动手 |
| **E** | 20 分钟 | 写核心逻辑测试 + 两个反证实验（见 §7.6-7.8） | 动手 |
| **F** | 10 分钟 | 运行 lint/typecheck/test/build，提交 commit（见 §7.9） | 动手 |

---

## 3. v1：最小闭环（Offset 分页）

### 3.1 v1 要实现什么

**用户视角**：
- 异常列表按页显示，每页 20 条
- 点击"下一页"按钮翻页

**技术视角**：
- 后端用 `skip/take` (Prisma) 或 `LIMIT/OFFSET` (SQL)
- 前端记录当前 `page`，请求时传参

### 3.2 v1 完整代码

**backend/src/anomalies/anomalies.controller.ts**（v1 版本）

```typescript
import { Controller, Get, Query } from '@nestjs/common'
import { AnomaliesService } from './anomalies.service'

@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.anomaliesService.findMany({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
    })
  }
}
```

**backend/src/anomalies/anomalies.service.ts**（v1 版本）

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class AnomaliesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(params: { page: number; pageSize: number }) {
    const { page, pageSize } = params
    const skip = (page - 1) * pageSize
    
    const items = await this.prisma.anomaly.findMany({
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    })
    
    const total = await this.prisma.anomaly.count()
    
    return { items, total, page, pageSize }
  }
}
```

**frontend/src/features/anomalies/composables/useAnomalyList.ts**（v1 版本）

```typescript
import { ref } from 'vue'

export function useAnomalyList() {
  const items = ref<any[]>([])
  const page = ref(1)
  const pageSize = 20
  const total = ref(0)
  const loading = ref(false)

  async function loadPage(newPage: number) {
    loading.value = true
    try {
      const res = await fetch(`/api/anomalies?page=${newPage}&pageSize=${pageSize}`)
      const data = await res.json()
      items.value = data.items
      total.value = data.total
      page.value = newPage
    } finally {
      loading.value = false
    }
  }

  return { items, page, total, loading, loadPage }
}
```

### 3.3 v1 用到的知识点

1. **Prisma skip/take**：
   - 解决的问题：从数据库取指定范围的记录
   - 运行机制：编译为 SQL `LIMIT ? OFFSET ?`
   - 项目落点：`findMany({ skip, take })`
   - 生产误区：`OFFSET` 大值时性能极差（要扫描前 N 条丢弃）
   - 验证方法：`EXPLAIN` 查看是否用了索引

2. **总数查询**：
   - 解决的问题：告诉前端总共有多少条
   - 运行机制：`SELECT COUNT(*)`
   - 项目落点：`prisma.anomaly.count()`
   - 生产误区：大表 count 极慢，且和 findMany 不在同一事务里数据可能变
   - 验证方法：并发插入时观察 total 是否稳定

### 3.4 v1 暴露的痛点

**痛点 1**：并发插入导致翻页重复

```
时序：
T0: 用户看到第 1 页 (skip=0, take=20)，得到 anomaly[100..81]
T1: 后端插入 10 条新异常（anomaly[110..101]）
T2: 用户点"下一页" (skip=20, take=20)，得到 anomaly[90..71]
问题：anomaly[90..81] 在第 1 页和第 2 页各出现一次
```

**痛点 2**：大 OFFSET 性能极差

`OFFSET 10000 LIMIT 20` 数据库仍要扫描前 10020 条丢弃前 10000。

**痛点 3**：无输入校验

用户传 `pageSize=100000` 直接把数据库拖垮。

**痛点 4**：直接返回 Prisma 实体

Prisma 类型包含 `internalNotes`、`sourceIp` 等敏感字段，直接暴露给前端。

---

## 4. v2：加游标（单键 Cursor 分页）

### 4.1 v2 要实现什么

**用户视角**：
- 不再显示"第 N 页"，改为"加载更多"按钮
- 并发插入不会导致重复

**技术视角**：
- 用 `WHERE createdAt < cursor` 代替 `OFFSET`
- 前端持有 `nextCursor`，下次请求带上

### 4.2 v2 完整代码

**backend/src/anomalies/anomalies.controller.ts**（v2）

```typescript
import { Controller, Get, Query } from '@nestjs/common'
import { AnomaliesService } from './anomalies.service'

@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    return this.anomaliesService.findManyWithCursor({
      cursor: cursor ? new Date(cursor) : undefined,
      limit: parseInt(limit, 10),
    })
  }
}
```

**backend/src/anomalies/anomalies.service.ts**（v2 加 findManyWithCursor）

```typescript
async findManyWithCursor(params: { cursor?: Date; limit: number }) {
  const { cursor, limit } = params
  
  const items = await this.prisma.anomaly.findMany({
    where: cursor ? { createdAt: { lt: cursor } } : undefined,
    take: limit + 1, // 多取 1 条判断是否还有更多
    orderBy: { createdAt: 'desc' },
  })
  
  const hasMore = items.length > limit
  const returned = hasMore ? items.slice(0, limit) : items
  const nextCursor = hasMore ? returned[returned.length - 1].createdAt : null
  
  return { items: returned, nextCursor }
}
```

**frontend/src/features/anomalies/composables/useAnomalyList.ts**（v2）

```typescript
import { ref } from 'vue'

export function useAnomalyList() {
  const items = ref<any[]>([])
  const cursor = ref<string | null>(null)
  const hasMore = ref(true)
  const loading = ref(false)

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    loading.value = true
    
    try {
      const url = cursor.value
        ? `/api/anomalies?cursor=${cursor.value}&limit=20`
        : `/api/anomalies?limit=20`
      const res = await fetch(url)
      const data = await res.json()
      
      items.value = [...items.value, ...data.items]
      cursor.value = data.nextCursor
      hasMore.value = data.nextCursor !== null
    } finally {
      loading.value = false
    }
  }

  return { items, hasMore, loading, loadMore }
}
```

### 4.3 v2 用到的知识点

1. **Cursor 分页**：
   - 解决的问题：并发插入时保持稳定分页
   - 运行机制：`WHERE createdAt < cursor` 从游标位置继续
   - 项目落点：`findManyWithCursor`
   - 生产误区：cursor 直接传 `Date` 客户端可能篡改
   - 验证方法：并发插入 100 条时对比 offset 分页

2. **take + 1 判断 hasMore**：
   - 解决的问题：知道是否还有下一页
   - 运行机制：多取 1 条，如果实际返回 = limit + 1 说明有更多
   - 项目落点：`take: limit + 1`
   - 生产误区：忘记 `slice(0, limit)` 会多返回 1 条
   - 验证方法：last page 时验证 hasMore = false

### 4.4 v2 暴露的痛点

**痛点 1**：相同时间戳时会漏项

```
数据：
anomaly-100 createdAt = 2026-07-21T10:00:00.000Z
anomaly-101 createdAt = 2026-07-21T10:00:00.000Z  ← 同一时刻
anomaly-102 createdAt = 2026-07-21T10:00:00.000Z  ← 同一时刻
第 1 页 limit=1 取到 anomaly-100，nextCursor = 2026-07-21T10:00:00.000Z
第 2 页 WHERE createdAt < 2026-07-21T10:00:00.000Z 直接跳过 anomaly-101 和 102
```

**痛点 2**：仍然没有输入校验

`limit=100000` 一样可以打死数据库。

**痛点 3**：仍然返回 Prisma 全字段

**痛点 4**：cursor 明文，用户可篡改任意时间

**痛点 5**：切换过滤器时旧请求不取消（复用 Day 3 的竞态问题）

---

## 5. v3：生产就绪（复合游标 + Query DTO + ViewModel）

### 5.1 v3 要实现什么

**用户视角**：
- 翻页无论并发插入或相同时间戳都稳定
- 非法参数会被拒绝并返回清晰错误
- 响应字段固定，不会突然多出敏感字段

**技术视角**：
- 复合游标 `(createdAt, id)` 保证严格顺序
- zod Query DTO 校验 limit/filters
- ViewModel 投影，只暴露白名单字段
- Base64 编码 cursor 防篡改

### 5.2 v3 目录结构

与 §1.4 完全一致，此处不再重复。核心新增文件：

```
backend/src/anomalies/dto/
├── list-anomalies.query.dto.ts    ← zod schema + Nest pipe
└── anomaly.view-model.ts          ← 投影函数 + 响应类型
```

### 5.3 v3 完整代码

**backend/src/anomalies/dto/list-anomalies.query.dto.ts**

```typescript
import { z } from 'zod'
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'

// Cursor 结构：base64 编码 { createdAt, id }
export const CursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string(),
})
export type Cursor = z.infer<typeof CursorSchema>

export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical'])
export const AnomalyTypeEnum = z.enum(['spike', 'drop', 'flatline'])

export const ListAnomaliesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  serverId: z.string().optional(),
  severity: SeverityEnum.optional(),
  type: AnomalyTypeEnum.optional(),
})

export type ListAnomaliesQuery = z.infer<typeof ListAnomaliesQuerySchema>

export function decodeCursor(encoded: string): Cursor {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    return CursorSchema.parse(parsed)
  } catch (err) {
    throw new BadRequestException('Invalid cursor')
  }
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64')
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: z.ZodSchema) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value)
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        })
      }
      throw err
    }
  }
}
```

**backend/src/anomalies/dto/anomaly.view-model.ts**

```typescript
import type { Anomaly } from '@prisma/client'

// 前端可见的字段白名单
export interface AnomalyViewModel {
  id: string
  type: 'spike' | 'drop' | 'flatline'
  severity: 'low' | 'medium' | 'high' | 'critical'
  serverId: string
  metricType: 'cpu' | 'memory' | 'network' | 'disk'
  value: number
  threshold: number
  createdAt: string  // ISO string
}

/**
 * 从 Prisma 实体投影到 ViewModel
 * 不暴露：internalNotes、sourceIp、rawPayload 等内部字段
 */
export function toAnomalyViewModel(anomaly: Anomaly): AnomalyViewModel {
  return {
    id: anomaly.id,
    type: anomaly.type as AnomalyViewModel['type'],
    severity: anomaly.severity as AnomalyViewModel['severity'],
    serverId: anomaly.serverId,
    metricType: anomaly.metricType as AnomalyViewModel['metricType'],
    value: anomaly.value,
    threshold: anomaly.threshold,
    createdAt: anomaly.createdAt.toISOString(),
  }
}

export interface AnomalyListResponse {
  items: AnomalyViewModel[]
  nextCursor: string | null
}
```

**backend/src/anomalies/anomalies.service.ts**（v3 加 findManyWithCompositeCursor）

```typescript
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { Cursor } from './dto/list-anomalies.query.dto'
import type { ListAnomaliesQuery } from './dto/list-anomalies.query.dto'
import { encodeCursor, decodeCursor } from './dto/list-anomalies.query.dto'
import { toAnomalyViewModel, AnomalyListResponse } from './dto/anomaly.view-model'

@Injectable()
export class AnomaliesService {
  constructor(private readonly prisma: PrismaService) {}

  async findManyWithCompositeCursor(
    query: ListAnomaliesQuery,
  ): Promise<AnomalyListResponse> {
    const { limit, cursor, serverId, severity, type } = query
    
    const decoded: Cursor | undefined = cursor ? decodeCursor(cursor) : undefined
    
    // 复合游标 WHERE：(createdAt, id) < (cursor.createdAt, cursor.id)
    // 用 OR 模拟词典序比较
    const cursorFilter = decoded
      ? {
          OR: [
            { createdAt: { lt: new Date(decoded.createdAt) } },
            {
              AND: [
                { createdAt: new Date(decoded.createdAt) },
                { id: { lt: decoded.id } },
              ],
            },
          ],
        }
      : {}
    
    const filters = {
      ...(serverId && { serverId }),
      ...(severity && { severity }),
      ...(type && { type }),
    }
    
    const items = await this.prisma.anomaly.findMany({
      where: { ...cursorFilter, ...filters },
      take: limit + 1,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    })
    
    const hasMore = items.length > limit
    const returned = hasMore ? items.slice(0, limit) : items
    
    const nextCursor = hasMore
      ? encodeCursor({
          createdAt: returned[returned.length - 1].createdAt.toISOString(),
          id: returned[returned.length - 1].id,
        })
      : null
    
    return {
      items: returned.map(toAnomalyViewModel),
      nextCursor,
    }
  }
}
```

**backend/src/anomalies/anomalies.controller.ts**（v3）

```typescript
import { Controller, Get, Query, UsePipes } from '@nestjs/common'
import { AnomaliesService } from './anomalies.service'
import {
  ListAnomaliesQuerySchema,
  ListAnomaliesQuery,
  ZodValidationPipe,
} from './dto/list-anomalies.query.dto'
import type { AnomalyListResponse } from './dto/anomaly.view-model'

@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(ListAnomaliesQuerySchema))
  async list(@Query() query: ListAnomaliesQuery): Promise<AnomalyListResponse> {
    return this.anomaliesService.findManyWithCompositeCursor(query)
  }
}
```

**frontend/src/features/anomalies/api/anomalies-client.ts**

```typescript
import type { AnomalyListResponse } from '@/domain/anomalies/anomaly.types'

export interface ListAnomaliesParams {
  cursor?: string
  limit?: number
  serverId?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  type?: 'spike' | 'drop' | 'flatline'
}

export async function fetchAnomalies(
  params: ListAnomaliesParams,
  signal?: AbortSignal,
): Promise<AnomalyListResponse> {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set('cursor', params.cursor)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.serverId) qs.set('serverId', params.serverId)
  if (params.severity) qs.set('severity', params.severity)
  if (params.type) qs.set('type', params.type)

  const res = await fetch(`/api/anomalies?${qs.toString()}`, { signal })
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }
  
  return res.json()
}
```

**frontend/src/features/anomalies/composables/useAnomalyList.ts**

```typescript
import { ref, watch } from 'vue'
import { fetchAnomalies, ListAnomaliesParams } from '../api/anomalies-client'
import type { AnomalyViewModel } from '@/domain/anomalies/anomaly.types'

export function useAnomalyList(filters: () => Omit<ListAnomaliesParams, 'cursor' | 'limit'>) {
  const items = ref<AnomalyViewModel[]>([])
  const cursor = ref<string | null>(null)
  const hasMore = ref(true)
  const loading = ref(false)
  const error = ref<string | null>(null)
  
  let currentController: AbortController | null = null

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    
    // 取消旧请求（切换过滤器场景）
    if (currentController) currentController.abort()
    currentController = new AbortController()
    const signal = currentController.signal
    
    loading.value = true
    error.value = null
    
    try {
      const data = await fetchAnomalies(
        {
          cursor: cursor.value ?? undefined,
          limit: 20,
          ...filters(),
        },
        signal,
      )
      
      if (signal.aborted) return
      
      items.value = [...items.value, ...data.items]
      cursor.value = data.nextCursor
      hasMore.value = data.nextCursor !== null
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      if (!signal.aborted) loading.value = false
    }
  }

  function reset() {
    if (currentController) currentController.abort()
    items.value = []
    cursor.value = null
    hasMore.value = true
    error.value = null
  }

  // 过滤器变化时重置
  watch(filters, () => {
    reset()
    loadMore()
  }, { deep: true })

  return { items, hasMore, loading, error, loadMore, reset }
}
```

**frontend/src/features/anomalies/components/AnomalyList.vue**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAnomalyList } from '../composables/useAnomalyList'
import AnomalyListItem from './AnomalyListItem.vue'

const props = defineProps<{
  serverId?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
}>()

const filters = computed(() => ({
  serverId: props.serverId,
  severity: props.severity,
}))

const { items, hasMore, loading, error, loadMore } = useAnomalyList(() => filters.value)

// 首次加载
loadMore()
</script>

<template>
  <div class="anomaly-list">
    <div v-if="error" class="error">{{ error }}</div>
    
    <AnomalyListItem
      v-for="item in items"
      :key="item.id"
      :anomaly="item"
    />
    
    <div v-if="loading" class="loading">加载中...</div>
    
    <button
      v-if="hasMore && !loading"
      class="load-more"
      @click="loadMore"
    >
      加载更多
    </button>
    
    <div v-if="!hasMore && items.length > 0" class="end">已加载全部</div>
    <div v-if="!loading && items.length === 0 && !error" class="empty">暂无异常</div>
  </div>
</template>

<style scoped>
.anomaly-list { padding: 16px; }
.load-more { padding: 12px 24px; border: 1px solid #ddd; background: white; cursor: pointer; }
.loading, .error, .end, .empty { padding: 12px; text-align: center; color: #666; }
.error { color: #f5222d; }
</style>
```

**frontend/src/features/anomalies/components/AnomalyListItem.vue**

```vue
<script setup lang="ts">
import type { AnomalyViewModel } from '@/domain/anomalies/anomaly.types'

defineProps<{ anomaly: AnomalyViewModel }>()

const severityColorMap = {
  low: '#52c41a',
  medium: '#faad14',
  high: '#fa8c16',
  critical: '#f5222d',
}
</script>

<template>
  <div class="anomaly-item">
    <div
      class="severity-tag"
      :style="{ background: severityColorMap[anomaly.severity] }"
    >
      {{ anomaly.severity }}
    </div>
    <div class="content">
      <div class="title">{{ anomaly.type }} - {{ anomaly.metricType }}</div>
      <div class="meta">
        Server {{ anomaly.serverId }} | 值 {{ anomaly.value }} / 阈值 {{ anomaly.threshold }}
      </div>
      <div class="time">{{ new Date(anomaly.createdAt).toLocaleString() }}</div>
    </div>
  </div>
</template>

<style scoped>
.anomaly-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid #eee;
}
.severity-tag {
  padding: 4px 8px;
  color: white;
  border-radius: 4px;
  font-size: 12px;
  height: fit-content;
}
.content { flex: 1; }
.title { font-weight: bold; }
.meta { color: #666; font-size: 13px; margin-top: 4px; }
.time { color: #999; font-size: 12px; margin-top: 4px; }
</style>
```

### 5.4 v3 用到的知识点

1. **稳定复合排序**：
   - 解决的问题：相同时间戳时排序稳定
   - 运行机制：`ORDER BY createdAt DESC, id DESC` 主键作为 tie-breaker
   - 项目落点：`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`
   - 生产误区：只用 `createdAt` 会漏项
   - 验证方法：造 3 条相同时间戳的数据，翻页看是否都出现

2. **复合游标 WHERE**：
   - 解决的问题：从复合键位置继续查询
   - 运行机制：`WHERE (createdAt, id) < (c1, c2)` 用 OR 分支模拟
   - 项目落点：`cursorFilter` 的 OR 结构
   - 生产误区：写成 `AND` 会漏项（第一条件严格不等）
   - 验证方法：SQL EXPLAIN 看是否走 (createdAt, id) 复合索引

3. **Base64 Cursor 编码**：
   - 解决的问题：cursor 不可读、可携带复合结构
   - 运行机制：`Buffer.from(JSON.stringify(cursor)).toString('base64')`
   - 项目落点：`encodeCursor / decodeCursor`
   - 生产误区：直接暴露 timestamp 让用户可以查任意时间的数据
   - 验证方法：篡改 cursor 后应返回 400，不是 500

4. **Query DTO + Zod Pipe**：
   - 解决的问题：拒绝非法输入（超大 limit、未授权字段）
   - 运行机制：Nest Pipe 拦截 request，用 zod schema 校验和 coerce
   - 项目落点：`ZodValidationPipe` + `ListAnomaliesQuerySchema`
   - 生产误区：只做类型检查不做上限（`z.number()` 而非 `z.number().max(100)`）
   - 验证方法：`?limit=100000` 返回 400 而非 200

5. **ViewModel 投影**：
   - 解决的问题：控制响应字段，不暴露内部字段
   - 运行机制：显式 `toViewModel` 转换函数
   - 项目落点：`toAnomalyViewModel`
   - 生产误区：直接返回 Prisma 实体（会暴露 `internalNotes`、`rawPayload`）
   - 验证方法：`grep -r 'sourceIp' response` 应为空

6. **hasMore 用 take + 1**：
   - 解决的问题：告诉前端是否还有下一页，不依赖 total count
   - 运行机制：多取 1 条，`hasMore = items.length > limit`
   - 项目落点：`take: limit + 1`
   - 生产误区：忘记 slice(0, limit) 导致响应多返回 1 条
   - 验证方法：last page 时 nextCursor 应为 null

7. **AbortController 取消旧请求**：
   - 解决的问题：切换过滤器时旧请求不覆盖新数据
   - 运行机制：每次 loadMore 前 abort 上一次 controller
   - 项目落点：`currentController.abort()`
   - 生产误区：忘记检查 `signal.aborted` 就更新 state
   - 验证方法：快速切换过滤器 10 次，最终 items 是最后一次的过滤结果

8. **filters 变化触发 reset**：
   - 解决的问题：切换过滤器时应清空旧数据从头开始
   - 运行机制：`watch(filters, () => { reset(); loadMore() })`
   - 项目落点：composable 内部 `watch`
   - 生产误区：只清空 items 忘记重置 cursor 和 hasMore
   - 验证方法：切换 severity 后 items 应从 0 开始，不叠加

---

## 6. 三版对比表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **分页策略** | Offset (skip/take) | Cursor (createdAt) | 复合 Cursor (createdAt, id) |
| **并发插入稳定性** | 会重复/漏项 | 部分稳定（相同时间戳漏） | 严格稳定 |
| **输入校验** | 无 | 无 | Zod DTO + Pipe |
| **输出投影** | Prisma 实体直返 | Prisma 实体直返 | ViewModel |
| **Cursor 安全性** | N/A | 明文时间戳 | Base64 编码 |
| **前端取消** | 无 | 无 | AbortController |
| **过滤器切换** | 手动 reset | 手动 reset | watch + 自动 reset |
| **性能（大 skip）** | 慢（OFFSET 10000） | 稳定 | 稳定 |
| **可测性** | 弱 | 中 | 强（DTO/ViewModel 都可独立测试） |

### 6.5 前端底子补弱（独立深挖 HTML 入口）

完整的深挖内容见 `Day08深挖-API分页.html`，包含以下 8 个深挖主题：

1. **深挖 1**：Cursor 分页 vs Offset —— 从今天项目里的 `findManyWithCompositeCursor` 讲起
2. **深挖 2**：复合索引与词典序 —— 从今天项目里的 `(createdAt, id)` 讲起
3. **深挖 3**：Zod schema + Nest Pipe —— 从今天项目里的 `ZodValidationPipe` 讲起
4. **深挖 4**：DTO 与 ViewModel 分层 —— 从今天项目里的 `toAnomalyViewModel` 讲起
5. **深挖 5**：Base64 编码原理 —— 从今天项目里的 `encodeCursor` 讲起
6. **深挖 6**：HTTP 状态码语义 —— 从今天项目里的 400 vs 500 讲起
7. **深挖 7**：Vue watch + computed —— 从今天项目里的 filters watch 讲起
8. **深挖 8**：AbortController 传递 —— 从今天项目里的 `signal` 参数讲起

---

## 7. 项目验收清单（阶段 E-F，约 40 分钟）

### 7.6 E：写核心逻辑单元测试（25 分钟）

**backend/src/anomalies/anomalies.service.spec.ts**

```typescript
import { Test } from '@nestjs/testing'
import { AnomaliesService } from './anomalies.service'
import { PrismaService } from '@/prisma/prisma.service'
import { encodeCursor } from './dto/list-anomalies.query.dto'

describe('AnomaliesService.findManyWithCompositeCursor', () => {
  let service: AnomaliesService
  let prisma: PrismaService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnomaliesService,
        {
          provide: PrismaService,
          useValue: {
            anomaly: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile()
    
    service = module.get(AnomaliesService)
    prisma = module.get(PrismaService)
  })

  it('首次查询无 cursor 时返回前 N 条', async () => {
    const mock = Array.from({ length: 21 }, (_, i) => ({
      id: `a-${i}`,
      createdAt: new Date(`2026-07-21T10:${String(i).padStart(2, '0')}:00Z`),
      type: 'spike',
      severity: 'high',
      serverId: 'srv-1',
      metricType: 'cpu',
      value: 90,
      threshold: 80,
    }))
    ;(prisma.anomaly.findMany as jest.Mock).mockResolvedValue(mock)
    
    const result = await service.findManyWithCompositeCursor({
      limit: 20,
    } as any)
    
    expect(result.items).toHaveLength(20)
    expect(result.nextCursor).toBeTruthy()
  })

  it('cursor 到底时 nextCursor 应为 null', async () => {
    const mock = Array.from({ length: 5 }, (_, i) => ({
      id: `a-${i}`,
      createdAt: new Date(),
      type: 'spike',
      severity: 'high',
      serverId: 'srv-1',
      metricType: 'cpu',
      value: 90,
      threshold: 80,
    }))
    ;(prisma.anomaly.findMany as jest.Mock).mockResolvedValue(mock)
    
    const result = await service.findManyWithCompositeCursor({
      limit: 20,
    } as any)
    
    expect(result.items).toHaveLength(5)
    expect(result.nextCursor).toBeNull()
  })

  it('相同时间戳时用 id 作为 tie-breaker', async () => {
    const sameTime = new Date('2026-07-21T10:00:00Z')
    const mock = [
      { id: 'a-3', createdAt: sameTime, type: 'spike', severity: 'high', serverId: 'srv-1', metricType: 'cpu', value: 90, threshold: 80 },
      { id: 'a-2', createdAt: sameTime, type: 'spike', severity: 'high', serverId: 'srv-1', metricType: 'cpu', value: 90, threshold: 80 },
      { id: 'a-1', createdAt: sameTime, type: 'spike', severity: 'high', serverId: 'srv-1', metricType: 'cpu', value: 90, threshold: 80 },
    ]
    ;(prisma.anomaly.findMany as jest.Mock).mockResolvedValue(mock)
    
    const result = await service.findManyWithCompositeCursor({ limit: 20 } as any)
    
    expect(prisma.anomaly.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    )
    expect(result.items.map((i) => i.id)).toEqual(['a-3', 'a-2', 'a-1'])
  })

  it('cursor 篡改后应抛 BadRequest', async () => {
    await expect(
      service.findManyWithCompositeCursor({
        limit: 20,
        cursor: 'not-a-valid-cursor',
      } as any),
    ).rejects.toThrow('Invalid cursor')
  })
})
```

**backend/src/anomalies/dto/list-anomalies.query.dto.spec.ts**

```typescript
import { ListAnomaliesQuerySchema, ZodValidationPipe } from './list-anomalies.query.dto'
import { BadRequestException } from '@nestjs/common'

describe('ListAnomaliesQuerySchema', () => {
  it('limit 超过 100 应报错', () => {
    const pipe = new ZodValidationPipe(ListAnomaliesQuerySchema)
    expect(() => pipe.transform({ limit: '10000' })).toThrow(BadRequestException)
  })

  it('limit 为 string 会 coerce 为 number', () => {
    const pipe = new ZodValidationPipe(ListAnomaliesQuerySchema)
    const result = pipe.transform({ limit: '50' })
    expect(result.limit).toBe(50)
  })

  it('severity 不在枚举里应报错', () => {
    const pipe = new ZodValidationPipe(ListAnomaliesQuerySchema)
    expect(() => pipe.transform({ severity: 'super-critical' })).toThrow(BadRequestException)
  })

  it('缺省 limit 时默认 20', () => {
    const pipe = new ZodValidationPipe(ListAnomaliesQuerySchema)
    const result = pipe.transform({})
    expect(result.limit).toBe(20)
  })
})
```

**frontend/src/features/anomalies/composables/useAnomalyList.spec.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAnomalyList } from './useAnomalyList'
import * as client from '../api/anomalies-client'

describe('useAnomalyList', () => {
  beforeEach(() => {
    vi.spyOn(client, 'fetchAnomalies').mockReset()
  })

  it('首次 loadMore 加载数据', async () => {
    vi.spyOn(client, 'fetchAnomalies').mockResolvedValue({
      items: [{ id: 'a-1' } as any],
      nextCursor: 'cur-1',
    })
    
    const { items, hasMore, loadMore } = useAnomalyList(() => ({}))
    await loadMore()
    
    expect(items.value).toHaveLength(1)
    expect(hasMore.value).toBe(true)
  })

  it('loadMore 重复调用（loading 时）不会重复请求', async () => {
    const spy = vi.spyOn(client, 'fetchAnomalies').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ items: [], nextCursor: null }), 50)),
    )
    
    const { loadMore } = useAnomalyList(() => ({}))
    loadMore()
    loadMore()
    loadMore()
    
    await new Promise((r) => setTimeout(r, 100))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('nextCursor 为 null 时 hasMore 应为 false', async () => {
    vi.spyOn(client, 'fetchAnomalies').mockResolvedValue({
      items: [],
      nextCursor: null,
    })
    
    const { hasMore, loadMore } = useAnomalyList(() => ({}))
    await loadMore()
    
    expect(hasMore.value).toBe(false)
  })
})
```

### 7.7 F-1：反证实验 1（5 分钟）

**目标**：证明 Offset 分页在并发插入时会重复

**步骤**：

1. 数据库先造 100 条异常，创建时间递减
2. 前端用 v1 版本请求第 1 页 (page=1, size=20)，记录返回的 20 条 ID
3. 在数据库插入 10 条新异常
4. 前端请求第 2 页 (page=2, size=20)，记录返回的 20 条 ID
5. 对比两页 ID 有多少重复

**预期结果**：
- v1 版本：两页重复 10 条 ID
- v3 版本：两页 ID 完全不重复

**结论**：Offset 分页在并发写入下不稳定。

### 7.8 F-2：反证实验 2（5 分钟）

**目标**：证明单键 Cursor 在相同时间戳时会漏项

**步骤**：

1. 数据库造 3 条 `createdAt = '2026-07-21T10:00:00.000Z'` 的异常，id 分别为 `a-1/a-2/a-3`
2. 用 v2 版本请求 `?limit=1`，得到 `a-3`，`nextCursor = 2026-07-21T10:00:00Z`
3. 请求下一页 `?cursor=2026-07-21T10:00:00Z&limit=1`
4. 观察是否能拿到 `a-2` 和 `a-1`

**预期结果**：
- v2 版本：`WHERE createdAt < 2026-07-21T10:00:00Z` 会跳过 `a-2` 和 `a-1`（漏项）
- v3 版本：复合游标 `(2026-07-21T10:00:00Z, a-3)` 能正确取到 `a-2`

**结论**：单键 Cursor 在相同时间戳时不稳定，必须用复合键。

### 7.9 F-3：验证 + 提交（5 分钟）

```bash
cd backend
pnpm typecheck && pnpm lint && pnpm test && pnpm build

cd ../frontend
pnpm typecheck && pnpm lint && pnpm test && pnpm build

git add backend/src/anomalies/
git add frontend/src/features/anomalies/ frontend/src/app/pages/AnomalyListPage.vue
git commit -m "feat(anomalies): add paginated list with composite cursor + Query DTO + ViewModel

Refs: Day8"
```

**注意**：不要执行 `git push`，等手动推。

---

## 8. 通过标准（v3 自检清单）

| 编号 | 检查项 | 通过标准 |
|---|---|---|
| 1 | 复合游标 | `orderBy: [{createdAt:'desc'},{id:'desc'}]` |
| 2 | Query DTO | zod schema 校验 limit ≤ 100 |
| 3 | ViewModel | 响应字段固定，不含 sourceIp/internalNotes |
| 4 | Base64 Cursor | cursor 篡改返回 400 |
| 5 | AbortController | 切换过滤器时旧请求被取消 |
| 6 | 反证实验 | 两个实验都能复现 v1/v2 痛点 |
| 7 | 单元测试 | 后端 4+ / 前端 3+ 用例全绿 |
| 8 | typecheck | 前后端都通过 |
| 9 | lint | 前后端都通过 |
| 10 | build | 前后端都通过 |

---

## 9. 提交物

1. **代码**：`git diff HEAD~1` 输出（约 700 行）
2. **测试截图**：前后端 `pnpm test` 输出（至少 7 个测试全绿）
3. **反证实验记录**：两个反证实验的操作步骤 + 数据库截图
4. **学习日志**：回答 §10 的 3 个核心问题
5. **架构证据**：`grep -r 'Prisma' backend/src/anomalies/*.controller.ts` 应为空（Controller 不直接依赖 Prisma 类型，走 ViewModel）

---

## 10. 课末 3 个核心问题

1. **请从今天项目的真实入口到最终输出，解释"API/分页"的数据流或控制流；当天知识链"Cursor 分页、稳定排序、过滤、Query DTO、ViewModel"分别在哪一层起作用，为什么按这个顺序学习？**

   参考答案框架：
   - 入口：`AnomalyListPage.vue` 调用 `AnomalyList.vue`
   - 流向：`useAnomalyList → anomalies-client → GET /anomalies → Controller → Pipe (Query DTO 校验) → Service → Prisma → toViewModel → 响应`
   - Cursor 分页：解决并发写入的重复/漏项
   - 稳定排序：`(createdAt, id)` 保证相同时间戳仍有序
   - 过滤：Query DTO 的可选字段
   - Query DTO：拒绝非法输入
   - ViewModel：控制输出字段
   - 学习顺序：先分页策略 → 再稳定性 → 再输入校验 → 最后输出投影（每一层解决前一层暴露的漏洞）

2. **如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。**

   参考答案框架：
   - 移除机制：`orderBy` 只保留 `createdAt` 一个键
   - 可观察现象：用户翻页时看到相同的异常被跳过（漏项）
   - 最小复现：造 3 条相同 createdAt 的异常，`?limit=1` 翻页
   - 定位证据：SQL EXPLAIN + 抓包响应 items
   - 恢复动作：加回 `{ id: 'desc' }`
   - 防复发测试：`anomalies.service.spec.ts` 的"相同时间戳"测试

3. **请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。**

   参考答案框架：
   - 代码证据：`anomalies.service.ts` 的 `findManyWithCompositeCursor`，`list-anomalies.query.dto.ts` 的 Zod schema，`anomaly.view-model.ts` 的 `toViewModel`
   - 测试证据：4 个后端 + 3 个前端测试用例
   - 架构证据：`Controller` 不直接返回 Prisma 类型（走 ViewModel），`Service` 不直接接受 HTTP 参数（走 DTO）
   - 缺少功能：全文搜索、多字段排序、导出、总数统计（大表 count 极慢，需要 pg_class 估算）
   - 下一步演进：Day 9 加详情页 + 状态流转，Day 10 加实时更新（列表 + WebSocket 新事件合并）

---

## 11. 真实项目情境题（联网更新 2026-07-16）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

### 情境题 1：Cursor 分页在相同时间戳时漏项

**背景**：
异常列表按 `createdAt` 做 Cursor 分页，两个记录时间相同；翻页同时插入新异常后出现重复和漏项。

**任务**：
请保存 SQL、cursor、排序键和两次响应定位；先冻结自动刷新止损，再改为稳定复合排序与不透明游标，并在并发插入 1,000 次时验证集合无重漏。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - 在 `AnomaliesService.findManyWithCursor` 里加 `console.log` 输出实际 SQL
   - 观察两次响应的 items，用 `Array.from(new Set(ids)).length` 对比 `ids.length`
   - 如果不等，说明有重复；比较相邻两页第一条和上一页最后一条的 `createdAt`，如果相同就是漏项

2. **临时止损**：
   - 在前端加 debounce 500ms 到 loadMore，减少并发请求
   - 在 UI 层显示"数据可能有更新，请刷新"提示

3. **根因修复**：
   - 改为复合游标：`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`
   - WHERE 用 OR 分支模拟词典序
   - Cursor 结构改为 `{ createdAt, id }` 双字段
   - 见 §5.3 v3 代码

4. **回归验证**：
   - 写测试：`anomalies.service.spec.ts` 的"相同时间戳"用例
   - 手动验证：并发插入 1000 条，翻页 50 次，`Array.from(new Set(allIds)).length === allIds.length`

**依据**：[PostgreSQL Cursor Pagination Best Practices](https://use-the-index-luke.com/no-offset)

### 情境题 2：非法输入导致连接池打满

**背景**：
攻击者传入 `limit=100000` 和未授权过滤字段，单次查询占满连接池并暴露内部列。

**任务**：
请提供 Query DTO 校验、SQL explain、响应字段和连接池证据；先限制 limit 与关闭字段透传，再实现白名单过滤、ViewModel 投影和索引，验证非法输入拒绝且 P95 达标。

**回答框架**：

1. **定位证据**：
   - Nginx 日志显示 `?limit=100000`
   - Prisma 慢查询日志显示单次查询 30 秒
   - PostgreSQL `pg_stat_activity` 显示连接池占满
   - 响应 JSON 包含 `sourceIp` 字段（不该暴露）

2. **临时止损**：
   - Nginx 层加 `limit_req` 限制单 IP 请求速率
   - 应用层临时硬编码 `limit = Math.min(limit, 100)`
   - 关闭响应字段透传（临时用 `pick(['id', 'type', 'severity'])`）

3. **根因修复**：
   - Zod DTO：`z.coerce.number().int().min(1).max(100).default(20)`
   - ViewModel：显式 `toAnomalyViewModel` 白名单投影
   - Nest Pipe：`ZodValidationPipe` 统一拦截
   - 加复合索引：`CREATE INDEX ON anomaly (createdAt DESC, id DESC)`

4. **回归验证**：
   - 写测试：`list-anomalies.query.dto.spec.ts` 的"limit 超过 100 应报错"
   - 压测：`k6 run --vus 100 --duration 30s`，验证 P95 < 200ms
   - Security scan：`grep -r 'sourceIp' response.json` 应为空

**依据**：[OWASP API Security Top 10](https://owasp.org/API-Security/)

**知识映射**：Cursor 分页、稳定排序、Query DTO、索引草图和 ViewModel。

---

## 12. PDF 面试题

> **说明**：以下题目来自 PDF 资源文件，文件名用于教学分类，不等于官方题库或真实面试题来源。题目构造用于教学练习。

### 题目 1：如何实现支持 10 万条数据的虚拟列表？

**来源**：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 10 页。

**初级答法**：
- 只渲染可视区内的元素（例如屏幕能容纳 20 条就只挂载 20 条）
- 用 `overflow: scroll` + 绝对定位模拟长列表

**中级答法**：
- 用 `IntersectionObserver` 监听滚动位置
- 用固定行高 × 索引计算 offset
- 使用现成库 `vue-virtual-scroller` / `@tanstack/vue-virtual`

**高级答法（结合今天项目）**：
- 结合 Cursor 分页：滚动到底部触发 `loadMore`（无限滚动）
- 数据源和视图分离：`items` 是完整数据源，`renderedItems` 是当前窗口内的
- 高度差异处理：`ResizeObserver` 测量实际行高，用二分查找定位

### 题目 2：GraphQL 是什么？它与 RESTful API 相比有什么差异？

**来源**：[《2024字节前端面试题（45题）》](<../../资源/2024字节前端面试题（45题）.pdf>)，第 20 页。

**初级答法**：
- GraphQL 是 Facebook 出的查询语言，前端可以指定要哪些字段
- REST 每个 endpoint 返回固定字段
- GraphQL 只有一个 endpoint（通常是 `/graphql`）

**中级答法（区分场景）**：
- REST：适合资源明确的 CRUD，缓存友好（HTTP GET 可以直接 CDN 缓存）
- GraphQL：适合聚合多个数据源、前端字段需求多变
- REST：Over-fetching（返回太多）/ Under-fetching（要多次请求）
- GraphQL：单次请求可以拿到所有需要的字段

**高级答法（结合今天项目）**：
- 今天的 `AnomalyListResponse` 是 REST 风格，字段固定
- 如果改成 GraphQL：前端可以只查 `{ id, severity }`，节省带宽
- 但 GraphQL 破坏 Cursor 分页的语义：前端如果查嵌套字段（例如 `anomaly.server.metrics`）会 N+1
- 折中方案：REST 分页 + 每个资源支持 `?fields=id,severity` 选择字段（类似 GitHub API）

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

**示例问题方向**（实际问题会根据学生的 diff 调整）：

1. **演示验收**：请在浏览器里演示切换 severity 过滤器 10 次，展示 Network 面板显示旧请求被 abort。
2. **核心挑战**：Day 8 最难的部分是复合游标的 WHERE 子句写法，你卡在哪里最久？为什么 OR 分支不能改成 AND？
3. **对比思考**：为什么 Query DTO 用 Nest Pipe 而不是 middleware？两者的执行顺序有什么区别？
4. **项目对手戏**：假设 Day 10 加实时新异常推送，你的分页列表如何合并新事件？会不会破坏 Cursor 的稳定性？
5. **知识盲区**：如果异常数据规模到 1 亿条，`take: limit + 1` 判断 hasMore 还能用吗？有什么替代方案？（deep pagination 的 keyset scan 优化）

---

## 14. 本 Day 在 90 天路线中的锚点

**向前承接**：
- Day 1-2：DTO/Domain 分层和 zod schema
- Day 3：AbortController 竞态保护
- Day 7：Anomaly 领域模型和事件

**向后传递**：
- Day 9：异常详情页 + 状态流转
- Day 10：列表实时更新（WebSocket 推送 + 合并）
- Day 15：历史数据恢复（大量分页查询）

**复用点**：
- Query DTO 模式会在 Day 15/20 的所有查询接口复用
- ViewModel 投影会在 Day 12 的权限控制场景扩展（不同角色看到不同字段）
- AbortController 模式已在 Day 3-8 反复复用，形成稳定习惯

**螺旋上升**：
- Day 3 在单个请求场景练竞态
- Day 8 在分页场景练竞态（过滤器切换 + 分页请求）
- Day 15 在历史恢复场景练竞态（多个分页并发加载）

---

**完成 Day 8 后，你已经掌握**：
- Cursor 分页（复合键 + Base64 编码）
- Query DTO + Zod Pipe 输入校验
- ViewModel 投影输出白名单
- 前端 loadMore + reset + AbortController
- 反证实验证明 Offset/单键 Cursor 的漏洞

**下一步 Day 9**：给异常列表加详情页和状态流转（确认/忽略/处理中），学习状态机 + 乐观更新。
