# Day 3：异步与竞态（单请求 → 并发请求 → 取消保护）

任务版本：标准版
日期与时长：2026-07-16 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：D:\demo\ai-techer\p1-monitor\frontend
角色视角：掌握 Day 1 事件流和 Day 2 schema 合同的前端开发者，现在要处理真实的异步指标读取

---

## 0. 今天在 90 天路线中的位置

**承上**：
- Day 1 建立了 AgentEvent 事件流和 reducer 状态机
- Day 2 为事件类型加上了 zod schema 运行时校验和 DTO/Domain 分层

**启下**：
- Day 4 会用今天读取的指标数据渲染 ECharts 图表
- Day 5 会把今天的 REST 轮询升级为 WebSocket 实时推送
- Day 6 会在 WebSocket 层面加心跳/重连/去重保护

**今天的核心**：
在真实项目里实现**指标首屏 API Client**，处理**并发读取 → 切换服务器时取消旧请求 → 防止旧响应覆盖**三个递进问题。

---

## 1. 今天要交付的功能模块

### 1.1 用户能看到什么

在 p1-monitor 运维监控系统的服务器列表页面：

1. **首次加载**：页面显示 loading 状态，然后展示服务器列表和每台服务器的 CPU/内存/网络/磁盘 4 个指标
2. **切换服务器**：点击不同服务器时，指标区域显示 loading，然后更新为新服务器的数据
3. **快速切换**：用户在 1 秒内连续点击 3 台不同服务器，页面最终显示的是**第 3 台服务器的数据**，不会被前 2 次的旧请求覆盖
4. **请求失败**：如果某台服务器的指标接口返回 500 错误，页面显示具体的错误信息（可重试 vs 不可重试）

**关键**：用户看不到任何"数据串台"现象（例如点了 server-003，结果显示的是 server-001 的 CPU）。

### 1.2 这个模块在项目里承担什么

**在 p1-monitor 项目中的定位**：
- **架构层**：API Client 层，负责所有后端数据获取
- **依赖方**：Day 4 的图表组件、Day 15 的历史恢复功能都依赖今天的 API Client
- **被依赖方**：今天依赖 Day 2 的 schema 来校验后端返回的指标数据

**为什么是 Day 3**：
- Day 1-2 建立了类型系统和合同，但数据都是 mock 的
- 今天开始读取真实后端数据，必须处理**异步 + 并发 + 竞态**三大问题
- 这些问题在 Day 5 的 WebSocket 场景会再次出现，所以先在 REST 场景练习

### 1.3 三版演进的目标（v1 / v2 / v3）

| 版本 | 核心目标 | 用户体验 | 技术关键点 |
|---|---|---|---|
| **v1** | 单个请求能跑通 | 点击服务器后能看到指标，但快速切换时数据会串台 | `fetch` + `async/await` |
| **v2** | 并发请求 4 个指标 | 同时读取 CPU/内存/网络/磁盘，但快速切换时仍会串台 | `Promise.all` + loading 状态 |
| **v3** | 取消旧请求 + 竞态保护 | 快速切换 100 次都不会串台，旧请求被取消 | `AbortController` + requestId + 状态机 |

**痛点演进**：
- v1 痛点：只能串行读取 4 个指标，首屏需要 4 秒（每个请求 1 秒）
- v2 痛点：并发读取变成 1 秒，但快速切换服务器时，旧请求的响应会覆盖新请求
- v3 终态：旧请求被 `abort()` 取消，且即使旧响应先到达，也会被 `requestId` 拦截

### 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架，知道今天要建哪些文件、它们之间的依赖关系是什么、哪条依赖不能反过来。骨架不清晰直接动手 = 返工。

**今天在 `p1-monitor/frontend/` 下要建立的完整前端源码树（v3 完整版）**：

```
src/
├── domain/
│   └── metrics/
│       ├── metric.types.ts              ← 指标领域类型（MetricId, MetricValue, MetricSnapshot）
│       ├── metric.schema.ts             ← zod schema（复用 Day 2 的模式）
│       └── metric.types.spec.ts         ← 类型守卫测试
├── features/
│   └── metrics/
│       ├── api/
│       │   ├── metrics-client.ts        ← API Client（v1 单请求 → v2 并发 → v3 取消）
│       │   └── metrics-client.spec.ts   ← API Client 测试（含竞态测试）
│       └── composables/
│           ├── useMetrics.ts            ← Vue composable（loading/error/data 状态）
│           └── useMetrics.spec.ts       ← composable 测试
├── app/
│   └── pages/
│       └── ServerDetailPage.vue         ← 服务器详情页（展示 4 个指标）
└── test/
    └── mocks/
        └── metrics-mock-server.ts        ← Mock server（模拟慢响应/错误/竞态）
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `metrics-client.ts` | 单个 `fetchMetric` | 加 `fetchAllMetrics` 用 `Promise.all` | 加 `AbortController` + `requestId` |
| `useMetrics.ts` | 无 | 加 `loading/error/data` 状态 | 加请求取消逻辑 |
| `metrics-mock-server.ts` | 无 | 无 | 加延迟/错误注入 |
| `*.spec.ts` | 无 | 基础测试 | 加竞态场景测试 |

**依赖方向（务必单向，反过来一次都不行）**：

```
ServerDetailPage.vue → useMetrics.ts → metrics-client.ts → metric.schema.ts → metric.types.ts
```

**红线**：`domain/metrics/*.ts` 里出现 `import { ref } from 'vue'` 就是架构塌方。domain 层必须是纯 TypeScript，能在 Node.js 里跑测试。

**动手前先问自己 3 个问题**：

1. 为什么 `metrics-client.ts` 放在 `features/` 而不是 `domain/`？—— 见 §5.4 知识点「层与依赖方向」
2. `AbortController` 要放在哪一层？composable 层还是 API Client 层？—— 见 §5.3 v3 代码
3. 如何证明"旧请求的响应不会覆盖新请求"？—— 见 §7.7 反证实验

### 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

**时间盒**：阶段 D 总共 20 分钟，不要在这一步卡太久。如果遇到问题（例如 import 路径不对），先标记 `// TODO`，继续往下，读完 v3 代码后回来改。

#### 1.5.1 D-1：搭工程骨架 / 装依赖（5 分钟）

```bash
cd p1-monitor/frontend

# 今天需要的新依赖（如果 Day 2 已装 zod，这里只装测试工具）
pnpm add -D vitest @vitest/ui msw
```

#### 1.5.2 D-2：创建目录（2 分钟）

```bash
mkdir -p src/domain/metrics
mkdir -p src/features/metrics/api
mkdir -p src/features/metrics/composables
mkdir -p src/app/pages
mkdir -p src/test/mocks
```

#### 1.5.3 D-3：实现 domain 层（20 分钟）

按第 5.3 节的代码：

- 写 `src/domain/metrics/metric.types.ts`（定义 `MetricId`, `MetricValue`, `MetricSnapshot`）
- 写 `src/domain/metrics/metric.schema.ts`（zod schema）

**边写边问自己**：

- `MetricId` 为什么要 branded type？（防止把 `ServerId` 误传进来）
- `MetricValue` 为什么要区分 `value` 和 `unit`？（CPU 是 `85%`，内存是 `4.2 GB`）
- schema 的 `.min(0).max(100)` 是在验证什么？（CPU/内存百分比不能超 100）

#### 1.5.4 D-4：实现 features 层（40 分钟）

按第 5.3 节的代码：

- 写 `src/features/metrics/api/metrics-client.ts`（v3 完整版：`AbortController` + `requestId`）
- 写 `src/features/metrics/composables/useMetrics.ts`（`loading/error/data` 状态）

**边写边问自己**：

- `AbortController` 在哪里创建？在哪里 `abort()`？（每次切换服务器时取消旧请求）
- `requestId` 是什么？为什么要用它？（拦截旧响应，见 §5.4 知识点「竞态保护」）
- `Promise.all` 里某个请求失败了会怎样？（整个 `all` 失败，见 v2 痛点）

#### 1.5.5 D-5：接入编排层（15 分钟）

按第 5.3 节的代码：

- 写 `src/app/pages/ServerDetailPage.vue`（展示 4 个指标 + loading/error 状态）

**边写边问自己**：

- 为什么 `loading` 要单独一个状态？（避免闪烁，见 §5.4 知识点「loading 状态设计」）
- 切换服务器时 UI 会先显示什么？（先显示 loading，旧数据立刻清空）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| **A** | 30 分钟 | 阅读第 3 节（v1 单请求） | 阅读 |
| **B** | 30 分钟 | 阅读第 4 节（v2 并发请求） | 阅读 |
| **C** | 30 分钟 | 阅读第 5 节（v3 取消保护） | 阅读 |
| **D** | 60 分钟 | 在自己项目里实现 v3 完整功能（见 §1.5） | 动手 |
| **E** | 20 分钟 | 写核心逻辑测试 + 两个反证实验（见 §7.6-7.8） | 动手 |
| **F** | 10 分钟 | 运行 lint/typecheck/test/build，提交 commit（见 §7.9） | 动手 |

**设计原则**：
- 前 90 分钟只读、不写（避免边读边写导致思路混乱）
- 后 90 分钟只写、不读（读完 v3 你会发现前面卡住的地方多半是"没看到全景"造成的）
- E 阶段的"反证实验"强制验证 v1/v2 的痛点（不是纸上谈兵）

---

## 3. v1：最小闭环（单个请求能跑通）

### 3.1 v1 要实现什么

**用户视角**：
- 页面加载后，显示一台服务器的 **CPU 指标**
- 数据来自后端 API `/api/metrics?serverId=srv-001&type=cpu`

**技术视角**：
- 用 `fetch` + `async/await` 读取单个指标
- 用 zod schema 校验后端返回的数据
- 在 Vue 组件里展示

### 3.2 v1 完整代码

**src/domain/metrics/metric.types.ts**

```typescript
// MetricId 是字符串，但用 branded type 区分它和 ServerId
export type MetricId = string & { readonly __brand: 'MetricId' }

// ServerId（复用 Day 2 的定义）
export type ServerId = string & { readonly __brand: 'ServerId' }

// 指标类型
export type MetricType = 'cpu' | 'memory' | 'network' | 'disk'

// 指标值（带单位）
export type MetricValue = {
  value: number        // 数值，例如 85
  unit: string         // 单位，例如 '%' 或 'GB'
}

// 指标快照（某一时刻的指标值）
export type MetricSnapshot = {
  id: MetricId
  serverId: ServerId
  type: MetricType
  timestamp: string    // ISO 时间戳
  metric: MetricValue
}
```

**src/domain/metrics/metric.schema.ts**

```typescript
import { z } from 'zod'

export const MetricValueSchema = z.object({
  value: z.number().min(0),
  unit: z.string().min(1),
})

export const MetricSnapshotSchema = z.object({
  id: z.string().regex(/^metric-[a-z0-9]+$/),
  serverId: z.string().regex(/^srv-[a-z0-9]+$/),
  type: z.enum(['cpu', 'memory', 'network', 'disk']),
  timestamp: z.string().datetime(),
  metric: MetricValueSchema,
})
```

**src/features/metrics/api/metrics-client.ts**（v1 版本）

```typescript
import { MetricSnapshotSchema } from '@/domain/metrics/metric.schema'
import type { MetricSnapshot, ServerId, MetricType } from '@/domain/metrics/metric.types'

/**
 * 获取单个指标
 */
export async function fetchMetric(
  serverId: ServerId,
  type: MetricType,
): Promise<MetricSnapshot> {
  const url = `/api/metrics?serverId=${serverId}&type=${type}`
  const response = await fetch(url)
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  
  const data = await response.json()
  const result = MetricSnapshotSchema.safeParse(data)
  
  if (!result.success) {
    console.error('Metric schema validation failed:', result.error)
    throw new Error('Invalid metric data')
  }
  
  return result.data as MetricSnapshot
}
```

**src/app/pages/ServerDetailPage.vue**（v1 版本）

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchMetric } from '@/features/metrics/api/metrics-client'
import type { MetricSnapshot } from '@/domain/metrics/metric.types'

const cpuMetric = ref<MetricSnapshot | null>(null)
const serverId = 'srv-001' as any  // 先写死

onMounted(async () => {
  cpuMetric.value = await fetchMetric(serverId, 'cpu')
})
</script>

<template>
  <div class="server-detail">
    <h2>服务器详情</h2>
    <div v-if="cpuMetric" class="metric-card">
      <div class="metric-label">CPU</div>
      <div class="metric-value">
        {{ cpuMetric.metric.value }}{{ cpuMetric.metric.unit }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.server-detail {
  padding: 20px;
}

.metric-card {
  border: 1px solid #ddd;
  padding: 16px;
  border-radius: 8px;
}

.metric-label {
  font-size: 14px;
  color: #666;
}

.metric-value {
  font-size: 32px;
  font-weight: bold;
  margin-top: 8px;
}
</style>
```

### 3.3 v1 用到的知识点

1. **`async/await`**：
   - 解决的问题：用同步的写法处理异步逻辑
   - 运行机制：`await` 让函数暂停，等 Promise resolve 后继续
   - 项目落点：`fetchMetric` 函数
   - 生产误区：没有 try-catch，错误会 unhandled rejection
   - 验证方法：在 Network 面板看请求时序

2. **zod `safeParse`**：
   - 解决的问题：运行时校验后端返回的数据
   - 运行机制：返回 `{ success: true, data }` 或 `{ success: false, error }`
   - 项目落点：`metrics-client.ts` 里的 `safeParse(data)`
   - 生产误区：用 `parse()` 会直接抛异常，难控制错误处理
   - 验证方法：故意传脏数据给 schema，看 `success` 是否为 false

### 3.4 v1 暴露的痛点

**痛点 1**：只能串行读取 4 个指标

```typescript
// 如果要读取 CPU + 内存 + 网络 + 磁盘，v1 要这么写
const cpu = await fetchMetric(serverId, 'cpu')        // 1 秒
const memory = await fetchMetric(serverId, 'memory')  // 1 秒
const network = await fetchMetric(serverId, 'network') // 1 秒
const disk = await fetchMetric(serverId, 'disk')      // 1 秒
// 总共 4 秒！
```

**痛点 2**：没有 loading 状态

用户看到的是：页面空白 1 秒 → 突然出现数据。体验很差。

**痛点 3**：错误没处理

如果后端返回 500，`onMounted` 里的 `await` 会抛异常，整个组件崩溃。

---

## 4. v2：加一个关键设计维度（并发请求 4 个指标）

### 4.1 v2 要实现什么

**用户视角**：
- 页面加载时显示 loading 状态
- 1 秒后同时显示 CPU/内存/网络/磁盘 4 个指标（不是 4 秒）

**技术视角**：
- 用 `Promise.all` 并发读取 4 个指标
- 加 `loading/error/data` 状态
- 用 Vue composable 封装状态逻辑

### 4.2 v2 完整代码

**src/features/metrics/api/metrics-client.ts**（v2 新增）

```typescript
/**
 * 并发获取所有指标
 */
export async function fetchAllMetrics(
  serverId: ServerId,
): Promise<Record<MetricType, MetricSnapshot>> {
  const types: MetricType[] = ['cpu', 'memory', 'network', 'disk']
  
  const promises = types.map(type => fetchMetric(serverId, type))
  const results = await Promise.all(promises)
  
  return {
    cpu: results[0],
    memory: results[1],
    network: results[2],
    disk: results[3],
  }
}
```

**src/features/metrics/composables/useMetrics.ts**（v2 新增）

```typescript
import { ref } from 'vue'
import { fetchAllMetrics } from '../api/metrics-client'
import type { ServerId, MetricSnapshot, MetricType } from '@/domain/metrics/metric.types'

export type MetricsState = {
  loading: boolean
  error: string | null
  data: Record<MetricType, MetricSnapshot> | null
}

export function useMetrics() {
  const state = ref<MetricsState>({
    loading: false,
    error: null,
    data: null,
  })
  
  async function loadMetrics(serverId: ServerId) {
    state.value.loading = true
    state.value.error = null
    
    try {
      const data = await fetchAllMetrics(serverId)
      state.value.data = data
    } catch (err) {
      state.value.error = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      state.value.loading = false
    }
  }
  
  return {
    state,
    loadMetrics,
  }
}
```

**src/app/pages/ServerDetailPage.vue**（v2 版本）

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useMetrics } from '@/features/metrics/composables/useMetrics'

const { state, loadMetrics } = useMetrics()
const serverId = 'srv-001' as any

onMounted(() => {
  loadMetrics(serverId)
})
</script>

<template>
  <div class="server-detail">
    <h2>服务器详情</h2>
    
    <div v-if="state.loading" class="loading">
      加载中...
    </div>
    
    <div v-else-if="state.error" class="error">
      错误：{{ state.error }}
    </div>
    
    <div v-else-if="state.data" class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">CPU</div>
        <div class="metric-value">
          {{ state.data.cpu.metric.value }}{{ state.data.cpu.metric.unit }}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">内存</div>
        <div class="metric-value">
          {{ state.data.memory.metric.value }}{{ state.data.memory.metric.unit }}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">网络</div>
        <div class="metric-value">
          {{ state.data.network.metric.value }}{{ state.data.network.metric.unit }}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">磁盘</div>
        <div class="metric-value">
          {{ state.data.disk.metric.value }}{{ state.data.disk.metric.unit }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading, .error {
  padding: 20px;
  text-align: center;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  padding: 20px;
}

.metric-card {
  border: 1px solid #ddd;
  padding: 16px;
  border-radius: 8px;
}
</style>
```

### 4.3 v2 用到的知识点

3. **`Promise.all`**：
   - 解决的问题：并发执行多个 Promise，等全部完成
   - 运行机制：如果任意一个 reject，整个 `all` 就 reject
   - 项目落点：`fetchAllMetrics` 里同时请求 4 个指标
   - 生产误区：一个失败全失败，应该用 `Promise.allSettled`（Day 7 会讲）
   - 验证方法：Network 面板看 4 个请求是否同时发出

4. **loading 状态设计**：
   - 解决的问题：让用户知道"数据正在加载"
   - 运行机制：请求前设 `true`，请求后（无论成功失败）设 `false`
   - 项目落点：`useMetrics` 的 `state.loading`
   - 生产误区：忘记在 `finally` 里设 `false`，loading 永远不消失
   - 验证方法：故意让请求延迟 3 秒，看 loading 是否正确显示/消失

### 4.4 v2 暴露的痛点

**痛点 1**：快速切换服务器时，旧响应会覆盖新响应

```typescript
// 用户操作时序：
// t=0ms:  点击 srv-001，发出请求 A
// t=500ms: 点击 srv-002，发出请求 B
// t=800ms: 请求 B 返回（后端快），页面显示 srv-002 的数据 ✓
// t=1200ms: 请求 A 返回（后端慢），页面显示 srv-001 的数据 ✗
// 
// 结果：用户点的是 srv-002，但页面显示的是 srv-001！
```

**痛点 2**：旧请求没有取消，浪费带宽

即使用户已经切换到 srv-002，请求 A 仍然在网络上传输，浪费带宽。

**痛点 3**：`Promise.all` 里某个请求失败，整个 state.data 都是 null

假设 CPU 指标返回了，但内存指标返回 500，那么整个页面空白（因为 `Promise.all` reject 了）。

---

## 5. v3：终态（取消旧请求 + 竞态保护）

### 5.1 v3 要实现什么

**用户视角**：
- 快速切换服务器 100 次，页面显示的永远是最后点击的那台服务器的数据
- 旧请求在 Network 面板里显示为 `cancelled`

**技术视角**：
- 用 `AbortController` 取消旧请求
- 用 `requestId` 拦截旧响应（即使旧请求没被取消，响应也不会覆盖）
- 每次切换服务器时，先 `abort()` 旧请求，再发新请求

### 5.2 v3 目录结构

与 §1.4 完全一致，这里不再重复。

### 5.3 v3 完整代码

**src/features/metrics/api/metrics-client.ts**（v3 完整版）

```typescript
import { MetricSnapshotSchema } from '@/domain/metrics/metric.schema'
import type { MetricSnapshot, ServerId, MetricType } from '@/domain/metrics/metric.types'

/**
 * 获取单个指标（支持取消）
 */
export async function fetchMetric(
  serverId: ServerId,
  type: MetricType,
  signal?: AbortSignal,
): Promise<MetricSnapshot> {
  const url = `/api/metrics?serverId=${serverId}&type=${type}`
  const response = await fetch(url, { signal })
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  
  const data = await response.json()
  const result = MetricSnapshotSchema.safeParse(data)
  
  if (!result.success) {
    console.error('Metric schema validation failed:', result.error)
    throw new Error('Invalid metric data')
  }
  
  return result.data as MetricSnapshot
}

/**
 * 并发获取所有指标（支持取消）
 */
export async function fetchAllMetrics(
  serverId: ServerId,
  signal?: AbortSignal,
): Promise<Record<MetricType, MetricSnapshot>> {
  const types: MetricType[] = ['cpu', 'memory', 'network', 'disk']
  
  const promises = types.map(type => fetchMetric(serverId, type, signal))
  const results = await Promise.all(promises)
  
  return {
    cpu: results[0],
    memory: results[1],
    network: results[2],
    disk: results[3],
  }
}
```

**src/features/metrics/composables/useMetrics.ts**（v3 完整版）

```typescript
import { ref } from 'vue'
import { fetchAllMetrics } from '../api/metrics-client'
import type { ServerId, MetricSnapshot, MetricType } from '@/domain/metrics/metric.types'

export type MetricsState = {
  loading: boolean
  error: string | null
  data: Record<MetricType, MetricSnapshot> | null
}

export function useMetrics() {
  const state = ref<MetricsState>({
    loading: false,
    error: null,
    data: null,
  })
  
  // 当前请求的 AbortController
  let currentController: AbortController | null = null
  
  // 当前请求的 ID（用于拦截旧响应）
  let currentRequestId = 0
  
  async function loadMetrics(serverId: ServerId) {
    // 取消旧请求
    if (currentController) {
      currentController.abort()
    }
    
    // 创建新请求的 AbortController
    currentController = new AbortController()
    const signal = currentController.signal
    
    // 生成新请求的 ID
    currentRequestId += 1
    const requestId = currentRequestId
    
    state.value.loading = true
    state.value.error = null
    
    try {
      const data = await fetchAllMetrics(serverId, signal)
      
      // 竞态保护：只有最新的请求才能更新 state
      if (requestId === currentRequestId) {
        state.value.data = data
      }
    } catch (err) {
      // 如果是 abort 错误，不更新 error 状态（用户主动取消）
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      
      // 竞态保护：只有最新的请求才能更新 error
      if (requestId === currentRequestId) {
        state.value.error = err instanceof Error ? err.message : 'Unknown error'
      }
    } finally {
      // 竞态保护：只有最新的请求才能更新 loading
      if (requestId === currentRequestId) {
        state.value.loading = false
      }
    }
  }
  
  return {
    state,
    loadMetrics,
  }
}
```

**src/app/pages/ServerDetailPage.vue**（v3 版本，支持切换服务器）

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMetrics } from '@/features/metrics/composables/useMetrics'

const { state, loadMetrics } = useMetrics()

// 模拟服务器列表
const servers = [
  { id: 'srv-001' as any, name: '服务器 001' },
  { id: 'srv-002' as any, name: '服务器 002' },
  { id: 'srv-003' as any, name: '服务器 003' },
]

const selectedServerId = ref(servers[0].id)

// 监听服务器切换
watch(selectedServerId, (newId) => {
  loadMetrics(newId)
}, { immediate: true })
</script>

<template>
  <div class="server-detail">
    <h2>服务器详情</h2>
    
    <!-- 服务器选择器 -->
    <div class="server-selector">
      <button
        v-for="server in servers"
        :key="server.id"
        :class="{ active: selectedServerId === server.id }"
        @click="selectedServerId = server.id"
      >
        {{ server.name }}
      </button>
    </div>
    
    <div v-if="state.loading" class="loading">
      加载中...
    </div>
    
    <div v-else-if="state.error" class="error">
      错误：{{ state.error }}
    </div>
    
    <div v-else-if="state.data" class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">CPU</div>
        <div class="metric-value">
          {{ state.data.cpu.metric.value }}{{ state.data.cpu.metric.unit }}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">内存</div>
        <div class="metric-value">
          {{ state.data.memory.metric.value }}{{ state.data.memory.metric.unit }}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">网络</div>
        <div class="metric-value">
          {{ state.data.network.metric.value }}{{ state.data.network.metric.unit }}
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-label">磁盘</div>
        <div class="metric-value">
          {{ state.data.disk.metric.value }}{{ state.data.disk.metric.unit }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.server-selector {
  display: flex;
  gap: 8px;
  margin: 20px;
}

.server-selector button {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.server-selector button.active {
  background: #1890ff;
  color: white;
  border-color: #1890ff;
}

.loading, .error {
  padding: 20px;
  text-align: center;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  padding: 20px;
}

.metric-card {
  border: 1px solid #ddd;
  padding: 16px;
  border-radius: 8px;
}

.metric-label {
  font-size: 14px;
  color: #666;
}

.metric-value {
  font-size: 32px;
  font-weight: bold;
  margin-top: 8px;
}
</style>
```

**src/test/mocks/metrics-mock-server.ts**（用于测试）

```typescript
import type { MetricSnapshot } from '@/domain/metrics/metric.types'

/**
 * Mock 指标数据
 */
export function mockMetric(
  serverId: string,
  type: 'cpu' | 'memory' | 'network' | 'disk',
  delay = 0,
): Promise<MetricSnapshot> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const value = Math.random() * 100
      resolve({
        id: `metric-${Date.now()}` as any,
        serverId: serverId as any,
        type,
        timestamp: new Date().toISOString(),
        metric: {
          value: Math.round(value),
          unit: type === 'cpu' || type === 'memory' ? '%' : 'MB/s',
        },
      })
    }, delay)
  })
}

/**
 * Mock 服务器：模拟慢响应
 */
export function setupMockServer() {
  // 拦截 /api/metrics 请求
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlString = url.toString()
    
    if (urlString.includes('/api/metrics')) {
      const params = new URLSearchParams(urlString.split('?')[1])
      const serverId = params.get('serverId') || 'srv-001'
      const type = params.get('type') as any || 'cpu'
      
      // 模拟网络延迟（srv-001 慢，srv-002 快）
      const delay = serverId === 'srv-001' ? 1000 : 300
      
      // 检查是否被取消
      if (init?.signal) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, delay)
          init.signal.addEventListener('abort', () => {
            clearTimeout(timeout)
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      } else {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      
      const data = await mockMetric(serverId, type)
      
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    
    // 其他请求走原生 fetch
    return fetch(url, init)
  }
}
```

### 5.4 v3 用到的知识点

5. **`AbortController`**：
   - 解决的问题：取消正在进行的 fetch 请求
   - 运行机制：创建 `controller`，传 `signal` 给 `fetch`，调用 `controller.abort()` 取消
   - 项目落点：`useMetrics` 里每次切换服务器时取消旧请求
   - 生产误区：忘记捕获 `AbortError`，导致用户切换时报错
   - 验证方法：Network 面板看旧请求是否显示 `cancelled`

6. **requestId 竞态保护**：
   - 解决的问题：即使旧请求没被取消，旧响应也不会覆盖新响应
   - 运行机制：每次请求生成递增的 `requestId`，响应时检查 `requestId === currentRequestId`
   - 项目落点：`useMetrics` 里的 `currentRequestId`
   - 生产误区：只用 `AbortController` 不用 `requestId`，在某些浏览器里 abort 不及时
   - 验证方法：见 §7.7 反证实验

7. **Event Loop 与微任务**：
   - 解决的问题：理解 `await` 何时让出控制权
   - 运行机制：`await` 后的代码进入微任务队列，当前宏任务结束后执行
   - 项目落点：`loadMetrics` 里多个 `await` 的执行顺序
   - 生产误区：以为 `await` 是"等待 1 秒"，实际是"让出控制权"
   - 验证方法：用 `console.log` 打印时序

8. **错误分类**：
   - 解决的问题：区分"用户主动取消"和"网络错误"
   - 运行机制：捕获 `AbortError` 时不更新 `state.error`
   - 项目落点：`useMetrics` 的 `catch` 块
   - 生产误区：所有错误都显示给用户，导致切换时闪现"请求失败"
   - 验证方法：快速切换 10 次，看是否有错误提示

9. **层与依赖方向**：
   - 解决的问题：domain 层不能依赖 Vue
   - 运行机制：domain 定义类型，features 调用 API，app 调用 composable
   - 项目落点：`metric.types.ts` 没有 `import { ref }`
   - 生产误区：在 domain 层用 `ref`，导致 Node.js 测试跑不起来
   - 验证方法：在 domain 层跑 `vitest`，不应该报 `ref is not defined`

10. **loading 状态的终态保护**：
    - 解决的问题：切换服务器时，旧请求的 `finally` 不能把 `loading` 设为 `false`
    - 运行机制：`finally` 里也检查 `requestId === currentRequestId`
    - 项目落点：`useMetrics` 的 `finally` 块
    - 生产误区：`finally` 里无条件设 `loading = false`，导致新请求还在进行时 loading 消失
    - 验证方法：见 §7.8 反证实验

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 展示单个指标 | 展示 4 个指标 | 支持切换服务器 + 竞态保护 |
| **并发策略** | 串行（4 秒） | 并行 `Promise.all`（1 秒） | 并行 + 取消旧请求 |
| **状态管理** | 无 | `loading/error/data` | 同 v2 + 竞态保护 |
| **取消机制** | 无 | 无 | `AbortController` + `requestId` |
| **错误处理** | 直接抛异常 | `try-catch` | 同 v2 + 区分 `AbortError` |
| **竞态问题** | 存在（但单请求不明显） | 存在（快速切换时数据串台） | 已解决 |
| **架构层次** | 单层（组件直接调 API） | 三层（domain / features / app） | 同 v2 |
| **可测试性** | 无测试 | 基础测试 | 竞态场景测试 |
| **对齐后续 Day** | 不对齐 | 对齐（Day 4 直接用） | 对齐（Day 5 WebSocket 复用逻辑） |

### 6.5 前端底子补弱（独立深挖 HTML 入口）

完整的深挖内容见 `Day03深挖-异步与竞态.html`，包含以下 8 个深挖主题：

1. **深挖 1**：Event Loop —— 从今天项目里的 `await fetchAllMetrics` 讲起
2. **深挖 2**：Promise 并发 —— 从今天项目里的 `Promise.all` 讲起
3. **深挖 3**：AbortController —— 从今天项目里的 `signal` 传递讲起
4. **深挖 4**：竞态保护 —— 从今天项目里的 `requestId` 讲起
5. **深挖 5**：错误分类 —— 从今天项目里的 `AbortError` 讲起
6. **深挖 6**：层与依赖方向 —— 从今天项目里的 domain/features/app 讲起
7. **深挖 7**：loading 状态设计 —— 从今天项目里的 `state.loading` 讲起
8. **深挖 8**：微任务与宏任务 —— 从今天项目里的多个 `await` 讲起

---

## 7. 项目验收清单（阶段 E-F，约 30 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

**src/features/metrics/composables/useMetrics.spec.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useMetrics } from './useMetrics'
import { setupMockServer } from '@/test/mocks/metrics-mock-server'

describe('useMetrics', () => {
  beforeEach(() => {
    setupMockServer()
  })
  
  it('should load metrics successfully', async () => {
    const { state, loadMetrics } = useMetrics()
    
    await loadMetrics('srv-001' as any)
    
    expect(state.value.loading).toBe(false)
    expect(state.value.error).toBe(null)
    expect(state.value.data).not.toBe(null)
    expect(state.value.data?.cpu.type).toBe('cpu')
  })
  
  it('should cancel old request when switching servers', async () => {
    const { state, loadMetrics } = useMetrics()
    
    // 先请求 srv-001（慢，1000ms）
    const promise1 = loadMetrics('srv-001' as any)
    
    // 100ms 后请求 srv-002（快，300ms）
    await new Promise(resolve => setTimeout(resolve, 100))
    const promise2 = loadMetrics('srv-002' as any)
    
    // 等待两个请求都完成
    await Promise.allSettled([promise1, promise2])
    
    // 最终数据应该是 srv-002，不是 srv-001
    expect(state.value.data?.cpu.serverId).toBe('srv-002')
  })
  
  it('should not show AbortError to user', async () => {
    const { state, loadMetrics } = useMetrics()
    
    // 先请求 srv-001
    const promise1 = loadMetrics('srv-001' as any)
    
    // 立刻请求 srv-002（取消 srv-001）
    await loadMetrics('srv-002' as any)
    
    // 等待 srv-001 的请求被取消
    await promise1.catch(() => {})
    
    // state.error 应该是 null（不显示 AbortError）
    expect(state.value.error).toBe(null)
  })
})
```

**运行测试**：

```bash
pnpm vitest run src/features/metrics/composables/useMetrics.spec.ts
```

### 7.7 F-1：反证实验 1（5 分钟）

**目标**：证明 v2 的竞态问题（没有 `requestId` 保护时，旧响应会覆盖）

**步骤**：

1. 注释掉 `useMetrics.ts` 里的 `requestId` 检查：

```typescript
// if (requestId === currentRequestId) {  // 注释这行
  state.value.data = data
// }
```

2. 在浏览器里快速切换 srv-001 → srv-002 → srv-001

3. 打开 Network 面板，看最后显示的数据是哪台服务器的

**预期结果**：
- 页面最终显示的可能是 srv-001 的数据（因为 srv-001 慢，最后返回）
- 但用户最后点击的是 srv-002

**结论**：没有 `requestId` 保护时，旧响应会覆盖新响应。

**恢复代码**：把注释取消。

### 7.8 F-2：反证实验 2（5 分钟）

**目标**：证明 `finally` 里也需要 `requestId` 保护（否则旧请求会把 loading 设为 false）

**步骤**：

1. 注释掉 `useMetrics.ts` 里 `finally` 的 `requestId` 检查：

```typescript
// if (requestId === currentRequestId) {  // 注释这行
  state.value.loading = false
// }
```

2. 在浏览器里点击 srv-001（慢，1000ms）

3. 100ms 后点击 srv-002（快，300ms）

4. 观察 loading 状态的变化

**预期结果**：
- t=0ms: 点击 srv-001，loading = true
- t=100ms: 点击 srv-002，loading = true
- t=400ms: srv-002 返回，loading = false，页面显示 srv-002 数据
- t=1000ms: srv-001 返回，loading = false（这一步有问题！）
- 但此时新请求（srv-002）可能还在进行（如果 srv-002 也很慢），loading 不应该是 false

**结论**：`finally` 里也需要 `requestId` 保护。

**恢复代码**：把注释取消。

### 7.9 F-3：验证 + 提交（10 分钟）

**运行四件套**：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

**提交 commit**：

```bash
git add .
git commit -m "$(cat <<'EOF'
feat(metrics): add concurrent metrics fetching with race condition protection

Implement AbortController and requestId to prevent old responses from
overwriting new ones when switching servers rapidly.

- Add domain/metrics types and schemas
- Add features/metrics API client with abort support
- Add useMetrics composable with race condition protection
- Add ServerDetailPage with server switcher
- Add comprehensive tests including race condition scenarios

Refs: Day03
EOF
)"
```

⚠️ **不要 `git push`** —— 本地验收通过后再由教师决定是否推送。

---

## 8. 通过标准

1. **功能**：切换服务器 20 次，页面显示的永远是最后点击的服务器数据
2. **测试**：`useMetrics.spec.ts` 三个测试全绿
3. **反证实验**：两个反证实验都能复现问题，且恢复代码后问题消失
4. **代码质量**：`typecheck/lint/test/build` 四件套全通过
5. **架构**：domain 层没有 `import { ref }`，依赖方向正确

---

## 9. 提交物

1. **代码**：`git diff HEAD~1` 输出（约 400 行）
2. **测试截图**：`pnpm test` 的终端输出
3. **反证实验记录**：两个反证实验的操作步骤 + 观察现象
4. **学习日志**：回答 §10 的 3 个核心问题
5. **架构证据**：用 `madge` 或手绘依赖图，证明 domain 不依赖 Vue

---

## 10. 课末 3 个核心问题

1. **请从今天项目的真实入口到最终输出，解释"异步与竞态"的数据流或控制流；当天知识链"Event Loop、Promise 并发、AbortController、竞态、错误分类"分别在哪一层起作用，为什么按这个顺序学习？**

   参考答案框架：
   - 入口：`ServerDetailPage.vue` 的 `watch(selectedServerId)`
   - 流向：`loadMetrics` → `fetchAllMetrics` → 4 个 `fetchMetric` → 后端 API
   - Event Loop：控制 `await` 何时让出控制权
   - Promise 并发：`Promise.all` 同时发 4 个请求
   - AbortController：切换服务器时取消旧请求
   - 竞态保护：`requestId` 拦截旧响应
   - 错误分类：区分 `AbortError` 和网络错误

2. **如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。**

   参考答案框架：
   - 移除机制：删除 `requestId` 检查
   - 可观察现象：用户点击 srv-002，页面显示 srv-001 的数据
   - 最小复现：点击 srv-001（慢）→ 立刻点击 srv-002（快）→ 等待 1 秒
   - 定位证据：Network 面板 + `console.log(requestId, currentRequestId)`
   - 恢复动作：加回 `requestId` 检查
   - 防复发测试：`useMetrics.spec.ts` 的 `should cancel old request` 测试

3. **请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。**

   参考答案框架：
   - 代码证据：`useMetrics.ts` 第 18-20 行的 `AbortController`，第 34-36 行的 `requestId` 检查
   - 测试证据：`useMetrics.spec.ts` 第 23-35 行的竞态测试
   - 架构证据：`metric.types.ts` 没有 `import { ref }`
   - 缺少功能：`Promise.allSettled`（部分指标失败时仍展示成功的）
   - 下一步演进：Day 7 会用 `allSettled` 替换 `all`，合同不变（仍然是 `Record<MetricType, MetricSnapshot>`）

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

### 情境题 1：快速切换服务器导致数据串台

**背景**：
用户在 800ms 内连续切换 6 台服务器，最慢的旧请求最后返回并覆盖当前页面。

**任务**：
请用 `requestId`、Performance 时间线和状态转换记录证明竞态；先忽略非当前请求止损，再用 `AbortController` 与显式 `loading/empty/error/ready` 状态修复，并连续切换 100 次验证无旧响应覆盖。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - 在 `useMetrics.ts` 的 `loadMetrics` 里加 `console.log('Request', requestId, 'started')`
   - 在 `try` 块成功分支加 `console.log('Request', requestId, 'returned, current:', currentRequestId)`
   - 观察日志：`Request 1 started → Request 2 started → Request 2 returned → Request 1 returned`
   - 如果没有 `requestId` 检查，Request 1 的数据会覆盖 Request 2

2. **临时止损**：
   - 在 UI 层禁用快速点击：加 `debounce(loadMetrics, 300)`
   - 缺点：用户体验差，点击无响应

3. **根因修复**：
   - 加 `AbortController`：取消旧请求
   - 加 `requestId` 检查：拦截旧响应
   - 见 §5.3 v3 代码

4. **回归验证**：
   - 写测试：`useMetrics.spec.ts` 的 `should cancel old request` 测试
   - 手动验证：连续切换 100 次，用 Performance 面板录制，检查最终显示的 `serverId`

**依据**：[MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

### 情境题 2：并发请求部分失败导致白屏

**背景**：
首屏同时请求 8 个指标接口，其中 1 个超时、2 个 500；当前 `Promise.all` 让整页白屏且未区分可重试错误。

**任务**：
请提供 Event Loop 时序、未处理拒绝和请求耗时证据；先按独立模块降级，再设计并发上限、超时、错误分类和取消传播，并用故障矩阵验证部分成功仍可用。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - Performance 面板：8 个请求同时发出，其中 3 个失败
   - Console：`Unhandled Promise rejection`
   - Network 面板：某个请求耗时 30 秒（超时）

2. **临时止损**：
   - 在 UI 层：如果 `state.error` 不为空，只显示"部分指标加载失败"，不要整页白屏
   - 在 API 层：给 `fetch` 加 `timeout: 10000`（10 秒超时）

3. **根因修复**：
   - 用 `Promise.allSettled` 替换 `Promise.all`（Day 7 会讲）
   - 区分可重试错误（网络错误、超时）和不可重试错误（404、403）
   - 加并发上限：用 `p-limit` 限制同时最多 4 个请求

4. **回归验证**：
   - 写故障矩阵测试：8 个请求，随机让 0-3 个失败，验证页面仍可用
   - 见 Day 7 的 `allSettled` 测试

**依据**：[阿里 AI 前端岗位](https://campus-talent.alibaba.com/campus/position/199904460001)

**知识映射**：Event Loop、Promise 并发、取消、竞态和错误分类。

---

## 12. PDF 面试题

> **说明**：以下题目来自 PDF 资源文件，文件名用于教学分类，不等于官方题库或真实面试题来源。题目构造用于教学练习。

### 题目 1：浏览器事件循环如何工作？微任务在 AI 流式输出场景下会产生什么影响？

**来源**：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 1 页。

**初级答法（能说出基本概念）**：
- 事件循环分为宏任务和微任务
- 宏任务：`setTimeout`、`setInterval`、I/O
- 微任务：`Promise.then`、`queueMicrotask`
- 每个宏任务后清空所有微任务

**中级答法（能关联到 AI 流式输出）**：
- AI 流式输出用 SSE 或 WebSocket，每次收到 chunk 是一个宏任务
- 如果在宏任务里创建大量微任务（例如 1000 个 `Promise.then`），会阻塞渲染
- 解决方案：用 `requestAnimationFrame` 或 `setTimeout(fn, 0)` 让出控制权

**高级答法（能说出今天项目里的具体应用）**：
- 今天项目里的 `await fetchAllMetrics` 会创建 4 个微任务（4 个 `Promise.then`）
- 如果改成并发 100 个请求，会创建 100 个微任务，可能阻塞 UI
- 解决方案：用并发上限（`p-limit`）控制同时最多 N 个请求

### 题目 2：`Promise.all` 和 `Promise.allSettled` 有什么区别，各自适合什么场景？

**来源**：[《2026高德 AI agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 3 页。

**初级答法（能说出 API 区别）**：
- `Promise.all`：任意一个 reject 就整个 reject
- `Promise.allSettled`：等全部 settle（无论 resolve 还是 reject）

**中级答法（能说出适用场景）**：
- `Promise.all`：适合"全部成功才有意义"的场景（例如下单：扣库存 + 扣余额，必须全部成功）
- `Promise.allSettled`：适合"部分成功也有意义"的场景（例如批量上传图片，部分失败可以重试）

**高级答法（能说出今天项目里的权衡）**：
- 今天项目用 `Promise.all`，因为 v3 只是演示，Day 7 会升级为 `allSettled`
- 升级后的行为：4 个指标请求，即使 CPU 失败了，内存/网络/磁盘仍然展示
- 需要调整 UI：`state.data` 从 `Record<MetricType, MetricSnapshot>` 改为 `Partial<Record<MetricType, MetricSnapshot>>`

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。

五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

**示例问题方向**（实际问题会根据学生的 diff 调整）：

1. **演示验收**：请演示你的 `useMetrics.spec.ts` 测试全部通过的截图，并在浏览器里连续切换 10 次服务器。
2. **核心挑战**：Day03 最难的部分是什么？你卡在哪里最久？
3. **对比思考**：v1/v2/v3 三版你觉得哪一版最关键？为什么？
4. **项目对手戏**：假设 Day 5 挂 WebSocket 时也要处理竞态（例如重连后收到旧连接的消息），你会复用今天的哪部分逻辑？
5. **知识盲区**：`fetch` 的 `signal` 参数还能干什么？除了取消请求，还有什么用途？

---

## 14. 本 Day 在 90 天路线中的锚点

**向前承接**：
- Day 1：建立了事件流和 reducer 状态机
- Day 2：为事件类型加上了 zod schema 和 DTO/Domain 分层

**向后传递**：
- Day 4：用今天读取的指标数据渲染 ECharts 图表
- Day 5：把今天的 REST 轮询升级为 WebSocket 实时推送
- Day 6：在 WebSocket 层面加心跳/重连/去重保护
- Day 7：用 `Promise.allSettled` 处理部分指标失败的场景

**复用点**：
- `AbortController` 的取消逻辑会在 Day 5 的 WebSocket 重连场景复用
- `requestId` 的竞态保护会在 Day 15 的历史恢复场景复用
- `loading/error/data` 状态设计会在 Day 4-30 的所有数据加载场景复用

**螺旋上升**：
- Day 3 在 REST 场景练习竞态保护
- Day 5 在 WebSocket 场景应用竞态保护
- Day 15 在历史恢复场景扩展竞态保护（多个历史记录并发加载）

---

**完成 Day 3 后，你已经掌握**：
- ✅ 异步请求的并发控制（`Promise.all`）
- ✅ 竞态问题的两层防护（`AbortController` + `requestId`）
- ✅ 错误分类与用户体验优化
- ✅ loading 状态的终态保护
- ✅ domain/features/app 三层架构的依赖方向

**下一步 Day 4**：用今天读取的指标数据渲染 ECharts 图表，处理 60 点滑窗和生命周期清理问题。
