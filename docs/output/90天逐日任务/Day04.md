# Day 4：Vue/ECharts 原理（静态数据 → 响应式数据 → 滑窗优化）

任务版本：标准版
日期与时长：2026-07-17 周四，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：D:\demo\ai-techer\p1-monitor\frontend
角色视角：掌握 Day 1-3 事件流、合同和异步竞态的前端开发者，现在要用真实指标渲染图表

---

## 0. 今天在 90 天路线中的位置

**承上**：
- Day 1 建立了 AgentEvent 事件流和 reducer 状态机
- Day 2 为事件类型加上了 zod schema 运行时校验
- Day 3 实现了并发读取指标 + AbortController 取消保护

**启下**：
- Day 5 会把今天的静态图表升级为 WebSocket 实时推送更新
- Day 6 会在 WebSocket 层加心跳/重连/去重，图表需要处理断线重连后的数据恢复
- Day 7 会加异常检测算法，在图表上标注异常点

**今天的核心**：
用 Day 3 读取的真实指标数据渲染 **4 个 ECharts 图表**（CPU/内存/网络/磁盘），处理 **60 点滑窗 → Vue 响应式性能 → 生命周期清理**三个递进问题。

---

## 1. 今天要交付的功能模块

### 1.1 用户能看到什么

在 p1-monitor 运维监控系统的服务器详情页：

1. **首次加载**：页面显示 4 个折线图，每个图展示对应指标的历史趋势（最近 60 个数据点）
2. **数据更新**：每 5 秒自动刷新一次，新数据点从右侧进入，旧数据点从左侧退出（滑窗效果）
3. **切换服务器**：点击不同服务器时，4 个图表清空后重新加载新服务器的数据
4. **内存稳定**：运行 10 分钟后内存不会持续增长，切换页面后 ECharts 实例被正确销毁

**关键**：用户看到的是流畅的动画效果，不是卡顿或闪烁；长时间运行不会内存泄漏。

### 1.2 这个模块在项目里承担什么

**在 p1-monitor 项目中的定位**：
- **架构层**：可视化层，负责将 domain 层的数据转换为用户可见的图表
- **依赖方**：Day 7 的异常检测、Day 15 的历史恢复都依赖今天的图表组件
- **被依赖方**：今天依赖 Day 3 的 API Client 和 useMetrics composable

**为什么是 Day 4**：
- Day 1-3 建立了数据获取和状态管理，但数据还是文本展示
- 今天开始做数据可视化，必须处理 **ECharts 生命周期 + Vue 响应式性能**问题
- 这些问题在 Day 5 的实时更新场景会更复杂，所以先在轮询场景练习

### 1.3 三版演进的目标（v1 / v2 / v3）

| 版本 | 核心目标 | 用户体验 | 技术关键点 |
|---|---|---|---|
| **v1** | 单个图表能渲染 | 显示 CPU 折线图，但数据是写死的 | ECharts 基础配置 |
| **v2** | 4 个图表 + 响应式数据 | 从 API 读取数据，但数据超过 100 个点时卡顿 | Vue watch + setOption |
| **v3** | 60 点滑窗 + 生命周期清理 | 只保留最近 60 点，切页后实例销毁 | 滑窗算法 + onUnmounted |

**痛点演进**：
- v1 痛点：数据写死，不能复用
- v2 痛点：数据量大时 Vue 会对所有点做深层响应式代理，`setOption` 每次全量重建，导致卡顿
- v3 终态：只保留 60 点 + 用 `shallowRef` 避免深层代理 + `onUnmounted` 清理实例


### 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架，知道今天要建哪些文件、它们之间的依赖关系是什么、哪条依赖不能反过来。骨架不清晰直接动手 = 返工。

**今天在 `p1-monitor/frontend/` 下要建立的完整前端源码树（v3 完整版）**：

```
src/
├── domain/
│   └── metrics/                         ← Day 3 已建立
│       ├── metric.types.ts
│       └── metric.schema.ts
├── features/
│   ├── metrics/                         ← Day 3 已建立
│   │   ├── api/
│   │   │   └── metrics-client.ts
│   │   └── composables/
│   │       └── useMetrics.ts
│   └── charts/                          ← 今天新建
│       ├── components/
│       │   ├── MetricChart.vue          ← 单个图表组件（封装 ECharts）
│       │   └── MetricChart.spec.ts      ← 图表组件测试
│       ├── composables/
│       │   ├── useMetricChart.ts        ← 图表逻辑 composable（滑窗算法）
│       │   └── useMetricChart.spec.ts   ← composable 测试
│       └── utils/
│           ├── chart-options.ts         ← ECharts 配置工厂函数
│           └── sliding-window.ts        ← 滑窗算法（保留最近 N 点）
├── app/
│   └── pages/
│       └── ServerDetailPage.vue         ← Day 3 已建立，今天升级加 4 个图表
└── test/
    └── mocks/
        └── metrics-mock-server.ts        ← Day 3 已建立
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `MetricChart.vue` | 单图表 + 写死数据 | 接收 props + watch 更新 | 同 v2 + onUnmounted 清理 |
| `useMetricChart.ts` | 无 | 无 | 加滑窗逻辑 + shallowRef |
| `chart-options.ts` | 无 | 基础配置 | 加性能优化配置 |
| `sliding-window.ts` | 无 | 无 | 滑窗算法 |
| `ServerDetailPage.vue` | 无图表 | 加 4 个图表 | 同 v2 |

**依赖方向（务必单向，反过来一次都不行）**：

```
ServerDetailPage.vue → MetricChart.vue → useMetricChart.ts → sliding-window.ts
                    ↓
                useMetrics.ts → metrics-client.ts → metric.schema.ts
```

**红线**：`features/charts/utils/*.ts` 里出现 `import { ref } from 'vue'` 就是架构塌方。工具函数必须是纯函数，能在 Node.js 里跑测试。

**动手前先问自己 3 个问题**：

1. 为什么图表组件要单独一个 `features/charts/` 目录，不放在 `features/metrics/` 里？—— 见 §5.4 知识点「功能分层」
2. 滑窗算法要放在哪一层？utils 层还是 composable 层？—— 见 §5.3 v3 代码
3. Vue 的 `ref` 和 `shallowRef` 有什么区别？什么时候用 `shallowRef`？—— 见 §5.4 知识点「Vue 响应式深度」


### 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

**时间盒**：阶段 D 总共 20 分钟，不要在这一步卡太久。如果遇到问题（例如 ECharts 类型不对），先标记 `// TODO`，继续往下，读完 v3 代码后回来改。

#### 1.5.1 D-1：搭工程骨架 / 装依赖（5 分钟）

```bash
cd p1-monitor/frontend

# 今天需要的新依赖
pnpm add echarts
pnpm add -D @types/node  # 用于 sliding-window 的类型
```

#### 1.5.2 D-2：创建目录（2 分钟）

```bash
mkdir -p src/features/charts/components
mkdir -p src/features/charts/composables
mkdir -p src/features/charts/utils
```

#### 1.5.3 D-3：实现 utils 层（20 分钟）

按第 5.3 节的代码：

- 写 `src/features/charts/utils/sliding-window.ts`（滑窗算法，纯函数）
- 写 `src/features/charts/utils/chart-options.ts`（ECharts 配置工厂函数）

**边写边问自己**：

- 滑窗算法为什么要返回新数组，不能直接修改原数组？（Vue 响应式触发规则）
- `chart-options.ts` 为什么要写成工厂函数，不是直接 export 一个对象？（每个图表配置不同）
- ECharts 的 `animation: false` 是干什么的？（性能优化，见 v3 痛点）

#### 1.5.4 D-4：实现 composable 层（30 分钟）

按第 5.3 节的代码：

- 写 `src/features/charts/composables/useMetricChart.ts`（图表逻辑，滑窗 + shallowRef）

**边写边问自己**：

- `shallowRef` 和 `ref` 有什么区别？（深层代理 vs 浅层代理）
- 为什么数据点数组要用 `shallowRef`？（避免对 60 个对象做深层代理）
- 什么时候调用滑窗算法？（每次新增数据点时）

#### 1.5.5 D-5：实现组件层（30 分钟）

按第 5.3 节的代码：

- 写 `src/features/charts/components/MetricChart.vue`（单个图表组件）
- 升级 `src/app/pages/ServerDetailPage.vue`（加 4 个图表）

**边写边问自己**：

- ECharts 实例要在哪里创建？在哪里销毁？（onMounted / onUnmounted）
- 为什么要在 `onUnmounted` 里调用 `chart.dispose()`？（释放内存，见反证实验）
- 数据更新时调用 `chart.setOption` 的第二个参数是什么？（notMerge/replaceMerge）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| **A** | 30 分钟 | 阅读第 3 节（v1 单图表 + 静态数据） | 阅读 |
| **B** | 30 分钟 | 阅读第 4 节（v2 响应式数据 + 4 个图表） | 阅读 |
| **C** | 30 分钟 | 阅读第 5 节（v3 滑窗优化 + 生命周期清理） | 阅读 |
| **D** | 60 分钟 | 在自己项目里实现 v3 完整功能（见 §1.5） | 动手 |
| **E** | 20 分钟 | 写核心逻辑测试 + 两个反证实验（见 §7.6-7.8） | 动手 |
| **F** | 10 分钟 | 运行 lint/typecheck/test/build，提交 commit（见 §7.9） | 动手 |

**设计原则**：
- 前 90 分钟只读、不写（避免边读边写导致思路混乱）
- 后 90 分钟只写、不读（读完 v3 你会发现前面卡住的地方多半是"没看到全景"造成的）
- E 阶段的"反证实验"强制验证 v1/v2 的痛点（不是纸上谈兵）

---

## 3. v1：最小闭环（单个图表能渲染）

### 3.1 v1 要实现什么

**用户视角**：
- 页面显示一个 CPU 折线图
- 数据是写死的 10 个点

**技术视角**：
- 用 ECharts 渲染折线图
- 在 Vue 组件里初始化 ECharts 实例

### 3.2 v1 完整代码

**src/features/charts/components/MetricChart.vue**（v1 版本）

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as echarts from 'echarts'

const chartContainer = ref<HTMLDivElement | null>(null)

onMounted(() => {
  if (!chartContainer.value) return
  
  const chart = echarts.init(chartContainer.value)
  
  // 写死的数据
  const data = [
    { timestamp: '10:00', value: 45 },
    { timestamp: '10:05', value: 52 },
    { timestamp: '10:10', value: 48 },
    { timestamp: '10:15', value: 61 },
    { timestamp: '10:20', value: 55 },
    { timestamp: '10:25', value: 72 },
    { timestamp: '10:30', value: 68 },
    { timestamp: '10:35', value: 75 },
    { timestamp: '10:40', value: 82 },
    { timestamp: '10:45', value: 78 },
  ]
  
  chart.setOption({
    title: {
      text: 'CPU 使用率',
    },
    xAxis: {
      type: 'category',
      data: data.map(d => d.timestamp),
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
    },
    series: [
      {
        type: 'line',
        data: data.map(d => d.value),
        smooth: true,
      },
    ],
  })
})
</script>

<template>
  <div ref="chartContainer" class="metric-chart"></div>
</template>

<style scoped>
.metric-chart {
  width: 100%;
  height: 300px;
}
</style>
```

### 3.3 v1 用到的知识点

1. **ECharts 初始化**：
   - 解决的问题：在 DOM 元素上渲染图表
   - 运行机制：`echarts.init(dom)` 创建实例，`setOption` 设置配置
   - 项目落点：`MetricChart.vue` 的 `onMounted`
   - 生产误区：忘记等 DOM 挂载就初始化，会报错
   - 验证方法：检查 `chartContainer.value` 是否为 null

2. **ECharts option 配置**：
   - 解决的问题：定义图表的样式和数据
   - 运行机制：`xAxis/yAxis/series` 三个核心配置
   - 项目落点：`setOption` 的参数对象
   - 生产误区：`xAxis.data` 和 `series.data` 长度不一致会导致图表错误
   - 验证方法：console.log 两个数组的长度

### 3.4 v1 暴露的痛点

**痛点 1**：数据写死，不能复用

```vue
<!-- v1 的数据是硬编码的 -->
const data = [
  { timestamp: '10:00', value: 45 },
  // ...
]
```

如果要显示 4 个图表（CPU/内存/网络/磁盘），需要复制 4 份组件，维护成本高。

**痛点 2**：没有响应式更新

数据变化时，图表不会自动更新。需要手动调用 `setOption`。

**痛点 3**：没有清理实例

切换页面后，ECharts 实例没有被销毁，会导致内存泄漏。

---

## 4. v2：加一层（响应式数据 + 4 个图表）

### 4.1 v2 要实现什么

**用户视角**：
- 页面显示 4 个折线图（CPU/内存/网络/磁盘）
- 数据来自 Day 3 的 `useMetrics` composable
- 每 5 秒轮询一次，图表自动更新

**技术视角**：
- `MetricChart.vue` 接收 `props`（title, data）
- 用 Vue 的 `watch` 监听 props 变化，调用 `setOption` 更新图表
- `ServerDetailPage.vue` 里放 4 个 `MetricChart` 实例

### 4.2 v2 完整代码

**src/features/charts/components/MetricChart.vue**（v2 版本）

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

interface DataPoint {
  timestamp: string
  value: number
}

const props = defineProps<{
  title: string
  data: DataPoint[]
  unit: string
  max: number
}>()

const chartContainer = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function updateChart() {
  if (!chart) return
  chart.setOption({
    title: { text: props.title },
    xAxis: {
      type: 'category',
      data: props.data.map(d => d.timestamp),
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: props.max,
      axisLabel: {
        formatter: `{value} ${props.unit}`,
      },
    },
    series: [
      {
        type: 'line',
        data: props.data.map(d => d.value),
        smooth: true,
      },
    ],
  })
}

onMounted(() => {
  if (!chartContainer.value) return
  chart = echarts.init(chartContainer.value)
  updateChart()
})

watch(() => props.data, () => {
  updateChart()
}, { deep: true })
</script>

<template>
  <div ref="chartContainer" class="metric-chart"></div>
</template>

<style scoped>
.metric-chart {
  width: 100%;
  height: 300px;
}
</style>
```

**src/app/pages/ServerDetailPage.vue**（v2 版本，节选）

```vue
<script setup lang="ts">
import { useMetrics } from '@/features/metrics/composables/useMetrics'
import MetricChart from '@/features/charts/components/MetricChart.vue'

const { cpu, memory, network, disk, loading, error } = useMetrics()
</script>

<template>
  <div v-if="loading">加载中...</div>
  <div v-else-if="error">{{ error.message }}</div>
  <div v-else class="chart-grid">
    <MetricChart title="CPU 使用率" :data="cpu" unit="%" :max="100" />
    <MetricChart title="内存使用率" :data="memory" unit="%" :max="100" />
    <MetricChart title="网络流量" :data="network" unit="MB/s" :max="1000" />
    <MetricChart title="磁盘 I/O" :data="disk" unit="MB/s" :max="500" />
  </div>
</template>

<style scoped>
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
</style>
```

### 4.3 v2 相比 v1 加了什么

| 维度 | v1 | v2 |
|---|---|---|
| 数据源 | 硬编码 | props 传入 |
| 图表数量 | 1 个 | 4 个 |
| 响应式 | 无 | watch + setOption |
| 可复用性 | 不可复用 | 一个组件复用 4 次 |

### 4.4 v2 用到的知识点

1. **Vue defineProps 类型约束**：
   - 解决的问题：让父组件传入的数据类型可预测
   - 运行机制：TypeScript 泛型 + 编译时校验
   - 项目落点：`MetricChart.vue` 顶部 `defineProps<{...}>()`
   - 生产误区：`props` 是只读的，不能在子组件里修改
   - 验证方法：尝试给 `props.data` 赋值，TS 会报错

2. **Vue watch 深度监听**：
   - 解决的问题：监听对象/数组内部变化
   - 运行机制：`{ deep: true }` 递归代理每个属性
   - 项目落点：`watch(() => props.data, ..., { deep: true })`
   - 生产误区：deep watch 对大数组性能极差（v3 会解决）
   - 验证方法：Chrome DevTools Performance 录制，看 watcher 触发次数

3. **ECharts setOption 增量更新**:
   - 解决的问题：数据变化时更新图表
   - 运行机制：默认是 merge 模式，只更新变化部分
   - 项目落点：`updateChart()` 函数
   - 生产误区：`notMerge: true` 会完全替换，导致动画丢失
   - 验证方法：修改一个数据点，看图表是否只更新那一个点

### 4.5 v2 暴露的新痛点

**痛点 1**：数据量大时 Vue 深度响应式代理成本高

场景：模拟接口每次返回 1000 个数据点，Vue 会给每个点做 `Proxy` 包装。

```ts
// props.data 是 { timestamp, value }[] 类型
// deep watch 会递归创建代理：
// data → Proxy → data[0] → Proxy → data[0].timestamp → Proxy
```

**症状**：
- 页面初次加载耗时 800ms（本来 200ms 就够）
- Chrome DevTools 显示 `Object.defineProperty` 占用大量时间

**痛点 2**：ECharts 每次 setOption 全量重建

`setOption` 在 merge 模式下，虽然做了 diff，但 xAxis.data 每次都传新数组，ECharts 认为 x 轴变化了，会重绘整个坐标系。

**痛点 3**：切换服务器后旧图表实例没销毁

场景：用户点击服务器 A 看图表 → 点击服务器 B → 再回到 A。

**症状**：
- 组件被 `v-if` 隐藏时，`onMounted` 里的 `chart` 变量仍在闭包中
- ECharts 内部还持有 DOM 引用和事件监听器
- Chrome DevTools Memory 面板：Detached DOM Nodes 持续增长

**痛点 4**：无限制累积数据点

轮询 30 分钟后，`cpu` 数组会有 360 个数据点（5 秒一次）。10 小时后就是 7200 个点。

**症状**：图表越用越卡，最终浏览器崩溃。

---

## 5. v3：生产就绪（60 点滑窗 + shallowRef + 生命周期清理）

### 5.1 v3 要实现什么

**用户视角**：
- 4 个图表按 CPU / 内存 / 网络 / 磁盘展示，每图只保留最近 60 个数据点
- 长时间运行不卡顿（相比 v2 大数组深度响应式代理）
- 切换页面后 ECharts 实例被正确销毁，无内存泄漏

**技术视角**：
- 抽出 utils 层：`sliding-window.ts`（滑窗算法）+ `chart-options.ts`（ECharts 配置工厂）
- 抽出 composable 层：`useMetricChart.ts` 用 `shallowRef` 避免深层代理 + 内置滑窗
- 组件层瘦身：`MetricChart.vue` 只做 DOM 挂载 + `onMounted` init + `onUnmounted` dispose
- 性能配置：`animation: false`、`symbol: 'none'`、`smooth: false`

**关键解决的问题**：
- 数据无限累积 → 滑窗算法保留最近 60 点
- 深度响应式代理成本 → `shallowRef` 只跟踪数组引用变化
- 实例内存泄漏 → `onUnmounted` 里 `chart.dispose()`
- setOption 全量重建性能 → 纯函数配置工厂 + `notMerge` 精确控制

### 5.2 v3 目录结构

与 §1.4 中给出的完整目录树完全一致，此处不重复。核心是新增的 `src/features/charts/` 三层：

```
src/features/charts/
├── components/MetricChart.vue          ← 组件层：DOM 挂载 + 生命周期
├── composables/useMetricChart.ts       ← composable 层：shallowRef + 滑窗
└── utils/
    ├── sliding-window.ts               ← utils 层：纯函数算法
    └── chart-options.ts                ← utils 层：ECharts 配置工厂
```

**依赖方向（务必单向）**：`MetricChart.vue → useMetricChart.ts → sliding-window.ts / chart-options.ts`

**红线**：`utils/*.ts` 不允许 `import { ref } from 'vue'`，必须能在 Node.js 里跑 vitest。

### 5.3 v3 完整代码

**src/features/charts/utils/sliding-window.ts**

```ts
export interface DataPoint {
  timestamp: string
  value: number
}

/**
 * 滑动窗口：保留数组最近 N 个元素
 * 纯函数：不修改原数组，返回新数组
 * @param arr 原数组
 * @param newItem 新增元素
 * @param maxSize 窗口大小
 */
export function slideWindow<T>(
  arr: readonly T[],
  newItem: T,
  maxSize: number,
): T[] {
  const next = arr.length >= maxSize
    ? arr.slice(arr.length - maxSize + 1)
    : arr.slice()
  next.push(newItem)
  return next
}

/**
 * 批量替换：用新数组覆盖，同时应用滑窗
 */
export function slideWindowBatch<T>(
  newArr: readonly T[],
  maxSize: number,
): T[] {
  if (newArr.length <= maxSize) return newArr.slice()
  return newArr.slice(newArr.length - maxSize)
}
```

**src/features/charts/utils/chart-options.ts**

```ts
import type { EChartsOption } from 'echarts'
import type { DataPoint } from './sliding-window'

export interface ChartConfig {
  title: string
  unit: string
  max: number
}

/**
 * ECharts 配置工厂函数
 * 纯函数：相同输入永远返回相同输出
 */
export function buildChartOption(
  config: ChartConfig,
  data: readonly DataPoint[],
): EChartsOption {
  return {
    animation: false, // 关闭动画，减少 CPU 占用
    title: {
      text: config.title,
      textStyle: { fontSize: 14 },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: data.map(d => d.timestamp),
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: config.max,
      axisLabel: {
        formatter: `{value} ${config.unit}`,
        fontSize: 10,
      },
    },
    series: [
      {
        type: 'line',
        data: data.map(d => d.value),
        smooth: false, // 关闭 smooth，减少计算
        symbol: 'none', // 不显示数据点标记
        lineStyle: { width: 2 },
      },
    ],
  }
}
```

**src/features/charts/composables/useMetricChart.ts**

```ts
import { shallowRef, watch, type Ref } from 'vue'
import type { EChartsType } from 'echarts'
import { slideWindowBatch, type DataPoint } from '../utils/sliding-window'
import { buildChartOption, type ChartConfig } from '../utils/chart-options'

const WINDOW_SIZE = 60

/**
 * 图表逻辑 composable
 * 输入：source data（源数据数组）
 * 输出：windowedData（滑窗后的数据）+ apply（应用到 ECharts 实例）
 */
export function useMetricChart(
  source: Ref<readonly DataPoint[]>,
  config: ChartConfig,
) {
  // 用 shallowRef：只跟踪数组引用变化，不深度代理每个元素
  const windowedData = shallowRef<DataPoint[]>([])

  // 监听源数据变化，应用滑窗
  watch(source, (newData) => {
    windowedData.value = slideWindowBatch(newData, WINDOW_SIZE)
  }, { immediate: true })

  /**
   * 把当前数据应用到 ECharts 实例
   */
  function apply(chart: EChartsType) {
    const option = buildChartOption(config, windowedData.value)
    chart.setOption(option, {
      notMerge: false, // 使用 merge，保留动画
      lazyUpdate: true, // 延迟渲染，合并多次调用
    })
  }

  return {
    windowedData,
    apply,
  }
}
```

**src/features/charts/components/MetricChart.vue**（v3 版本）

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, shallowRef } from 'vue'
import * as echarts from 'echarts'
import type { EChartsType } from 'echarts'
import { useMetricChart } from '../composables/useMetricChart'
import type { DataPoint } from '../utils/sliding-window'

const props = defineProps<{
  title: string
  data: readonly DataPoint[]
  unit: string
  max: number
}>()

const chartContainer = ref<HTMLDivElement | null>(null)
const chartInstance = shallowRef<EChartsType | null>(null)

// 把 props.data 包成 ref，喂给 composable
const sourceData = shallowRef<readonly DataPoint[]>(props.data)
watch(() => props.data, (newData) => {
  sourceData.value = newData
})

const { apply } = useMetricChart(sourceData, {
  title: props.title,
  unit: props.unit,
  max: props.max,
})

// 数据变化时应用到图表
watch(sourceData, () => {
  if (chartInstance.value) apply(chartInstance.value)
})

onMounted(() => {
  if (!chartContainer.value) return
  const chart = echarts.init(chartContainer.value)
  chartInstance.value = chart
  apply(chart)

  // 监听窗口 resize，图表自适应
  const handleResize = () => chart.resize()
  window.addEventListener('resize', handleResize)

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    chart.dispose() // 关键：释放 ECharts 内部资源
    chartInstance.value = null
  })
})
</script>

<template>
  <div ref="chartContainer" class="metric-chart"></div>
</template>

<style scoped>
.metric-chart {
  width: 100%;
  height: 300px;
}
</style>
```

### 5.4 v3 用到的知识点（≥ 6 个）

1. **Vue shallowRef vs ref**：
   - 解决的问题：避免对大数组内部元素做深层响应式代理
   - 运行机制：`ref` 用 `reactive` 递归代理，`shallowRef` 只代理 `.value` 引用变化
   - 项目落点：`useMetricChart.ts` 里的 `windowedData`、`sourceData`
   - 生产误区：`shallowRef` 修改内部属性不会触发更新，必须整体替换引用
   - 验证方法：`shallowRef([]).value.push(x)` 不触发 watch；`shallowRef([]).value = [...]` 才触发

2. **Vue 响应式深度**：
   - 解决的问题：理解 Vue 何时会重新渲染
   - 运行机制：Proxy 拦截 get/set，收集依赖，触发副作用
   - 项目落点：`shallowRef` 只在 `.value = xxx` 时触发；`ref` 深层任何变化都触发
   - 生产误区：对不需要深层监听的数据用 `ref`，浪费性能
   - 验证方法：Vue DevTools 观察组件重渲染次数

3. **滑动窗口算法**：
   - 解决的问题：限制数据点数量，防止内存无限增长
   - 运行机制：`slice(arr.length - maxSize + 1)` 保留末尾 N 个元素
   - 项目落点：`sliding-window.ts` 的 `slideWindow` 函数
   - 生产误区：直接 `arr.splice()` 会修改原数组，Vue 响应式可能失效
   - 验证方法：单元测试 `slideWindow([1,2,3,4,5], 6, 3) === [4,5,6]`

4. **ECharts dispose 生命周期**：
   - 解决的问题：组件卸载时释放 ECharts 实例内存
   - 运行机制：`chart.dispose()` 移除所有事件监听、销毁 canvas
   - 项目落点：`MetricChart.vue` 的 `onUnmounted`
   - 生产误区：忘记 `dispose`，Chrome DevTools Memory 面板出现 Detached DOM
   - 验证方法：切换页面 10 次，看 Memory 快照对比

5. **ECharts 性能优化配置**：
   - 解决的问题：高频更新时避免动画/标记等 CPU 消耗
   - 运行机制：`animation: false`、`symbol: 'none'`、`smooth: false`
   - 项目落点：`chart-options.ts` 的 `buildChartOption`
   - 生产误区：默认配置在 5 秒轮询下 CPU 占用 20%+
   - 验证方法：Chrome DevTools Performance 录制 30 秒，看 Scripting 耗时

6. **纯函数与分层测试**：
   - 解决的问题：让核心算法可以脱离 Vue/DOM 单元测试
   - 运行机制：utils 层不 import vue/echarts，只处理数据
   - 项目落点：`sliding-window.ts` 和 `chart-options.ts` 都是纯函数
   - 生产误区：composable 里混入纯逻辑，测试必须挂载组件
   - 验证方法：`sliding-window.spec.ts` 不需要 `@vue/test-utils`

7. **composable 复用模式**：
   - 解决的问题：把可复用逻辑从组件抽出
   - 运行机制：函数返回 ref/reactive/function，组件调用后自动订阅
   - 项目落点：`useMetricChart(sourceData, config)`
   - 生产误区：在 composable 里访问 DOM（应该在组件的 onMounted）
   - 验证方法：composable 可以在 setup 之外调用报错

8. **lazyUpdate 合并渲染**：
   - 解决的问题：连续多次 setOption 只渲染一次
   - 运行机制：`lazyUpdate: true` 在下一帧统一提交
   - 项目落点：`useMetricChart.ts` 的 `apply` 函数
   - 生产误区：不用 lazyUpdate 时，5 个图表同时更新会触发 5 次重绘
   - 验证方法：Performance 面板看 Paint 事件数量

---

## 6. 三版对比

| 维度 | v1 单图 + 静态 | v2 4 图 + 响应式 | v3 滑窗 + 清理 |
|---|---|---|---|
| **代码行数** | ~40 行 | ~120 行 | ~280 行（分层） |
| **文件数** | 1 个 vue | 1 vue + 1 页面 | 3 utils + 1 composable + 1 vue |
| **数据来源** | 硬编码 | props | props → shallowRef |
| **响应式策略** | 无 | deep watch | shallowRef + immediate |
| **数据点上限** | 无 | 无限累积 | 60 点滑窗 |
| **实例清理** | 无 | 无 | onUnmounted + dispose |
| **动画** | 默认开 | 默认开 | 关闭（animation: false） |
| **可测性** | 只能 e2e | 组件测试 | utils 纯函数直接测 |
| **适用场景** | Demo | 演示项目 | 生产环境 |

**演进逻辑**：v1 证明 ECharts 能用 → v2 抽象出复用组件 → v3 处理性能和内存。

---

### 6.5 前端底子补弱（独立深挖 HTML 入口）

完整的深挖内容见 `Day04深挖-Vue响应式与ECharts生命周期.html`，包含以下 8 个深挖主题：

1. **深挖 1**：Vue 响应式原理 —— 从今天项目里的 `ref` vs `shallowRef` 讲起
2. **深挖 2**：Proxy 深度代理 —— 从今天项目里的 5000 点性能实验讲起
3. **深挖 3**：ECharts 实例生命周期 —— 从今天项目里的 `echarts.init` 和 `dispose` 讲起
4. **深挖 4**：滑动窗口算法 —— 从今天项目里的 `slideWindow` 讲起
5. **深挖 5**：composable 分层 —— 从今天项目里的 `useMetricChart` 讲起
6. **深挖 6**：纯函数 utils 与可测性 —— 从今天项目里的 `sliding-window.ts` 讲起
7. **深挖 7**：Canvas 渲染性能 —— 从今天项目里的 `animation: false` 讲起
8. **深挖 8**：内存泄漏定位方法 —— 从今天项目里的 `Detached DOM` 实验讲起

---

## 7. 动手环节

### 7.6 编写测试（必写，20 分钟）

**src/features/charts/utils/sliding-window.spec.ts**

```ts
import { describe, it, expect } from 'vitest'
import { slideWindow, slideWindowBatch } from './sliding-window'

describe('slideWindow', () => {
  it('数组未满时追加新元素', () => {
    expect(slideWindow([1, 2], 3, 5)).toEqual([1, 2, 3])
  })

  it('数组已满时移除最旧元素', () => {
    expect(slideWindow([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
  })

  it('不修改原数组', () => {
    const arr = [1, 2, 3]
    slideWindow(arr, 4, 3)
    expect(arr).toEqual([1, 2, 3])
  })
})

describe('slideWindowBatch', () => {
  it('数组超过窗口时截取末尾 N 个', () => {
    expect(slideWindowBatch([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })

  it('数组未满时返回副本', () => {
    const input = [1, 2]
    const result = slideWindowBatch(input, 5)
    expect(result).toEqual([1, 2])
    expect(result).not.toBe(input) // 不同引用
  })
})
```

**src/features/charts/utils/chart-options.spec.ts**

```ts
import { describe, it, expect } from 'vitest'
import { buildChartOption } from './chart-options'

describe('buildChartOption', () => {
  it('返回的 option 包含 title/xAxis/yAxis/series', () => {
    const option = buildChartOption(
      { title: 'CPU', unit: '%', max: 100 },
      [{ timestamp: '10:00', value: 50 }],
    )
    expect(option.title).toBeDefined()
    expect(option.xAxis).toBeDefined()
    expect(option.yAxis).toBeDefined()
    expect(option.series).toHaveLength(1)
  })

  it('animation 关闭', () => {
    const option = buildChartOption(
      { title: 't', unit: '%', max: 100 },
      [],
    )
    expect(option.animation).toBe(false)
  })

  it('xAxis 和 series 长度匹配', () => {
    const data = [
      { timestamp: '10:00', value: 1 },
      { timestamp: '10:05', value: 2 },
    ]
    const option = buildChartOption({ title: 't', unit: '%', max: 100 }, data)
    const xData = (option.xAxis as any).data
    const seriesData = (option.series as any[])[0].data
    expect(xData.length).toBe(seriesData.length)
  })
})
```

### 7.7 F-1：反证实验 1（5 分钟）

**目标**：证明 v2 的深度响应式代理开销（大数组 + ref 会导致性能骤降）

**步骤**：

1. 在 v2 的 `MetricChart.vue` 里，把 `props.data` 手动扩展到 5000 个点：

```typescript
const mockData = Array.from({ length: 5000 }, (_, i) => ({
  timestamp: `10:${String(i % 60).padStart(2, '0')}`,
  value: Math.random() * 100,
}))
```

2. 打开 Chrome DevTools Performance 面板，点击 Record，等待 5 秒，点击 Stop

3. 观察 `Scripting` 耗时占比和 top 函数

**预期结果**：
- Scripting 占比 > 60%
- `_traverse`（Vue 深度追踪）出现在 top 函数
- 页面卡顿明显

**修正**：把 `ref(props.data)` 改为 `shallowRef(props.data)`，再录制一次

**预期修正后**：Scripting 占比降到 20% 以下，页面流畅

**恢复代码**：把测试数据改回真实 API 数据。

### 7.8 F-2：反证实验 2（5 分钟）

**目标**：证明 `onUnmounted` 里不 `dispose` 会导致内存泄漏

**步骤**：

1. 注释掉 `MetricChart.vue` 的 `onUnmounted` 里的 `chart.dispose()`

2. 在 `ServerDetailPage.vue` 里加一个"隐藏图表"按钮（用 `v-if` 控制）

3. 打开 Chrome DevTools Memory 面板，拍第一次 Heap Snapshot

4. 点击"隐藏图表"和"显示图表"各 10 次（共切换 20 次）

5. 点击垃圾桶图标强制 GC（Collect garbage）

6. 拍第二次 Heap Snapshot，对比两次

**预期结果（不 dispose）**：
- Comparison 视图里 `Detached HTMLDivElement` 增加 20+ 个
- 说明 DOM 节点已从文档移除，但仍在内存中

**修正**：取消注释 `chart.dispose()`，再重复实验

**预期修正后**：Detached DOM 增量 = 0

**恢复代码**：把测试按钮删除，恢复 `onUnmounted` 代码。

### 7.9 F-3：验证 + 提交（10 分钟）

**运行四件套**：

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

**自检清单**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 通过（至少 5 个测试用例）
- [ ] `pnpm build` 通过
- [ ] 页面显示 4 个图表，数据来自 API
- [ ] 切换服务器后旧数据被替换，不叠加
- [ ] 运行 5 分钟后数据点不超过 60 个
- [ ] Chrome Memory 面板：切页 20 次后 Detached DOM 不增长

**提交 commit**：

```bash
git add src/features/charts/ src/app/pages/ServerDetailPage.vue
git commit -m "feat(charts): add MetricChart with sliding window and lifecycle cleanup

Refs: Day4"
```

**注意**：不要执行 `git push`，等 Day 5 前手动推。

---

## 8. 通过标准（v3 自检清单）

| 编号 | 检查项 | 通过标准 |
|---|---|---|
| 1 | 目录结构 | `features/charts/` 下有 components/composables/utils 三层 |
| 2 | utils 层纯函数 | `sliding-window.ts` 和 `chart-options.ts` 不 import vue |
| 3 | 滑窗算法 | 数据超过 60 点时自动裁剪 |
| 4 | shallowRef 使用 | `useMetricChart.ts` 用 `shallowRef` 而非 `ref` |
| 5 | 生命周期清理 | `onUnmounted` 里调用 `chart.dispose()` |
| 6 | 性能配置 | `animation: false`、`symbol: 'none'` |
| 7 | 单元测试 | utils 层测试覆盖率 > 80% |
| 8 | 反证实验记录 | README 里有性能对比数据 |
| 9 | 类型检查 | `pnpm typecheck` 无 error |
| 10 | 构建通过 | `pnpm build` 无 error |

---

## 9. 提交物

1. **代码**：`git diff HEAD~1` 输出（约 600 行）
2. **测试截图**：`pnpm test` 的终端输出（至少 5 个测试用例全绿）
3. **反证实验记录**：两个反证实验的操作步骤 + Chrome DevTools 截图（Performance 和 Memory 面板）
4. **学习日志**：回答 §10 的 3 个核心问题
5. **架构证据**：用 `madge` 或手绘依赖图，证明 `features/charts/utils/*.ts` 不依赖 Vue

---

## 10. 课末 3 个核心问题

1. **请从今天项目的真实入口到最终输出，解释"Vue 响应式与 ECharts 生命周期"的数据流或控制流；当天知识链"shallowRef、滑窗算法、dispose、性能配置、composable 分层"分别在哪一层起作用，为什么按这个顺序学习？**

   参考答案框架：
   - 入口：`ServerDetailPage.vue` 的 4 个 `<MetricChart>` 实例
   - 流向：props.data → `useMetricChart` → `slideWindowBatch` → `buildChartOption` → `chart.setOption`
   - shallowRef：在 composable 层避免深层代理
   - 滑窗算法：在 utils 层限制数据点数量
   - dispose：在组件层 `onUnmounted` 释放实例
   - 性能配置：在 utils 层 `buildChartOption` 关闭动画
   - composable 分层：把可复用逻辑从组件抽出

2. **如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。**

   参考答案框架：
   - 移除机制：删除 `onUnmounted` 里的 `chart.dispose()`
   - 可观察现象：切换页面 20 次后，Chrome Memory 面板显示 Detached DOM 持续增长，最终浏览器崩溃
   - 最小复现：用 `v-if` 切换图表组件 20 次，拍 Heap Snapshot 对比
   - 定位证据：Memory 面板 Comparison 视图里 `Detached HTMLDivElement` 数量
   - 恢复动作：加回 `chart.dispose()` + 强制 GC
   - 防复发测试：`MetricChart.spec.ts` 的 `should dispose chart on unmount` 测试（检查 `dispose` 被调用）

3. **请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。**

   参考答案框架：
   - 代码证据：`useMetricChart.ts` 第 12 行的 `shallowRef`，`sliding-window.ts` 第 17 行的 `slice` 返回新数组，`MetricChart.vue` 第 42 行的 `chart.dispose()`
   - 测试证据：`sliding-window.spec.ts` 第 10-15 行的滑窗测试，`chart-options.spec.ts` 第 8-12 行的配置测试
   - 架构证据：`sliding-window.ts` 和 `chart-options.ts` 没有 `import { ref }`
   - 缺少功能：实时更新（目前是静态数据，Day 5 会加 WebSocket）、图表交互（缩放、框选、tooltip）
   - 下一步演进：Day 5 把数据源从 props 改为 WebSocket 订阅，`useMetricChart` 的 `apply` 函数不变

---

## 11. 真实项目情境题（联网更新 2026-07-16）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

### 情境题 1：大数组响应式代理导致页面卡顿

**背景**：
监控系统显示 8 小时历史数据（每 5 秒一个点，共 5760 点），用户反馈页面卡顿严重。

**任务**：
请用 Performance 时间线、Vue DevTools 响应式追踪和内存快照证明深度代理开销；先按降低数据密度止损，再用 `shallowRef` 与滑窗算法修复，并连续运行 24 小时验证无卡顿。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - Chrome DevTools Performance 面板录制 10 秒，观察 `Scripting` 占比
   - 在 top 函数里看到 `_traverse`（Vue 深度追踪）耗时高
   - Vue DevTools 显示 `props.data` 是 5760 个 Proxy 对象

2. **临时止损**：
   - 降低数据密度：每 30 秒一个点，减少到 960 个点
   - 缺点：用户看不到详细趋势

3. **根因修复**：
   - 用 `shallowRef` 替换 `ref`：只代理数组引用，不深度代理元素
   - 加滑窗算法：只保留最近 60 点，旧数据丢弃
   - 见 §5.3 v3 代码

4. **回归验证**：
   - Performance 面板：Scripting 占比从 60% 降到 20%
   - 连续运行 24 小时，内存稳定在 200MB 以下
   - 写测试：`sliding-window.spec.ts` 验证滑窗逻辑

**依据**：[Vue 3 shallowRef 文档](https://vuejs.org/api/reactivity-advanced.html#shallowref)

### 情境题 2：切换页面后内存持续增长

**背景**：
用户在服务器列表和详情页之间频繁切换，运行 2 小时后浏览器崩溃；Memory 面板显示 Detached DOM 节点持续增长。

**任务**：
请提供 Heap Snapshot 对比、Detached DOM 数量和 ECharts 实例引用证据；先按降低切换频率止损，再设计生命周期清理和实例池复用，并用内存快照验证无泄漏。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - Memory 面板拍两次 Heap Snapshot（切换前后）
   - Comparison 视图显示 `Detached HTMLDivElement` 增加 20+ 个
   - 搜索 `ECharts`，发现实例仍在内存中但 DOM 已移除

2. **临时止损**：
   - 禁用频繁切换：加 `debounce(navigate, 500)`
   - 缺点：用户体验差，点击无响应

3. **根因修复**：
   - 在 `onUnmounted` 里调用 `chart.dispose()`
   - 见 §5.3 v3 代码的 `MetricChart.vue` 第 42 行

4. **回归验证**：
   - 切换 100 次，拍 Heap Snapshot 对比，Detached DOM 增量 = 0
   - 写测试：用 `vitest` mock `echarts.init`，验证 `dispose` 被调用

**依据**：[阿里 AI 前端岗位](https://campus-talent.alibaba.com/campus/position/199904460001)

### 情境题 3：图表动画导致 CPU 占用过高

**背景**：
4 个图表每 5 秒更新一次，用户反馈 CPU 占用 30%+，笔记本风扇狂转。

**任务**：
请提供 Performance Profiler、Rendering 面板帧率和 Canvas 重绘次数证据；先按延长轮询间隔止损，再设计性能配置与增量更新，并用 CPU 占用率验证优化效果。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - Performance 面板录制 30 秒，看 `Rendering` 和 `Scripting` 占比
   - Rendering 面板勾选"Paint flashing"，看 Canvas 每次全部重绘
   - ECharts 默认开了动画 + 曲线平滑 + 数据点标记

2. **临时止损**：
   - 延长轮询间隔：从 5 秒改为 30 秒
   - 缺点：数据不够实时

3. **根因修复**：
   - 关闭动画：`animation: false`
   - 关闭数据点标记：`symbol: 'none'`
   - 关闭曲线平滑：`smooth: false`
   - 见 §5.3 v3 代码的 `chart-options.ts`

4. **回归验证**：
   - Performance 面板：Rendering 占比从 40% 降到 10%
   - 任务管理器：CPU 占用从 30% 降到 5%
   - 用户反馈：风扇不转了

**依据**：[ECharts 性能优化文档](https://echarts.apache.org/handbook/zh/best-practices/canvas-vs-svg/)

**知识映射**：Vue 响应式深度、滑窗算法、ECharts dispose 生命周期、Canvas 渲染性能、composable 分层。

---

## 12. PDF 面试题精选

> **说明**：以下题目来自 PDF 资源文件，文件名用于教学分类，不等于官方题库或真实面试题来源。题目构造用于教学练习。

**题 1（vue.pdf）**：Vue 2 和 Vue 3 的响应式原理有什么区别？shallowRef 是 Vue 3 特有的吗？

**思路**：
- Vue 2 用 `Object.defineProperty` 递归定义 getter/setter，缺点是不能监听数组下标变化、新增属性
- Vue 3 用 `Proxy` 拦截 get/set，能监听所有属性变化
- `shallowRef` 是 Vue 3 特有 API，Vue 2 里可以用 `Object.freeze` 达到类似效果

**题 2（vue.pdf）**：长列表渲染性能优化有哪些手段？

**思路**：
- 使用 `v-memo` 缓存不变的部分
- 使用 `shallowRef` 避免深层代理
- 使用虚拟滚动（vue-virtual-scroller）
- 使用 `Object.freeze` 冻结不变数据
- 分页加载

**题 3（frontend-performance.pdf）**：ECharts 或类似图表库在高频更新场景下有哪些性能陷阱？

**思路**：
- 动画开销：`animation: false`
- 数据标记：`symbol: 'none'`
- 曲线平滑：`smooth: false`
- 全量重建 vs 增量更新
- Canvas 尺寸变化的 resize 开销

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。

五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

**示例问题方向**（实际问题会根据学生的 diff 调整）：

1. **演示验收**：请演示你的 `sliding-window.spec.ts` 和 `chart-options.spec.ts` 测试全部通过的截图，并在浏览器里运行 5 分钟，看数据点数量是否稳定在 60 以内。
2. **核心挑战**：Day04 最难的部分是什么？你卡在哪里最久？
3. **对比思考**：v1/v2/v3 三版你觉得哪一版最关键？为什么？
4. **项目对手戏**：假设 Day 5 挂 WebSocket 实时推送时也要用滑窗（每秒收到 10 个数据点），你会复用今天的哪部分逻辑？
5. **知识盲区**：`shallowRef` 修改内部属性不会触发更新，那如何正确触发更新？能举个代码例子吗？

---

## 14. 本 Day 在 90 天路线中的锚点

**向前承接**：
- Day 1：建立了 AgentEvent 事件流和 reducer 状态机
- Day 2：为事件类型加上了 zod schema 和 DTO/Domain 分层
- Day 3：实现了并发读取指标 + AbortController 取消保护

**向后传递**：
- Day 5：把今天的静态图表升级为 WebSocket 实时推送更新（`slideWindow` 函数会被复用）
- Day 6：在 WebSocket 层加心跳/重连/去重，图表需要处理断线重连后的数据恢复
- Day 7：加异常检测算法，在图表上标注异常点（用 ECharts 的 `markPoint` API）
- Day 15：历史数据恢复场景，需要一次性加载 1000+ 点然后滑窗到 60 点

**复用点**：
- `slideWindow` 函数会在 Day 5 的 WebSocket 场景复用（每收到一个新数据点，调用 `slideWindow(current, newPoint, 60)`）
- `useMetricChart` composable 的 `apply` 函数会在 Day 5-30 的所有图表场景复用
- `chart.dispose()` 的生命周期清理模式会在 Day 6 的 WebSocket `close` 场景复用
- `shallowRef` 的性能优化模式会在 Day 15 的历史恢复场景复用（1000+ 点数据）

**螺旋上升**：
- Day 4 在静态数据场景练习 Vue 响应式性能优化
- Day 5 在实时推送场景应用滑窗算法
- Day 15 在历史恢复场景扩展滑窗算法（多个时间段并发加载 + 分段滑窗）

---

**完成 Day 4 后，你已经掌握**：
- ✅ Vue 3 响应式性能优化（`shallowRef` vs `ref`）
- ✅ 滑动窗口算法（保留最近 N 点）
- ✅ ECharts 生命周期管理（`init` / `setOption` / `dispose`）
- ✅ Canvas 渲染性能配置（`animation: false` 等）
- ✅ composable 分层与纯函数 utils 可测性
- ✅ Chrome DevTools Performance 和 Memory 面板定位性能问题

**下一步 Day 5**：把今天的 5 秒轮询升级为 WebSocket 实时推送，处理断线重连和消息去重问题。
