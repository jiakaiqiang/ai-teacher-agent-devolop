# Day 5：WebSocket 全栈（HTTP 轮询 → 实时推送 → 心跳重连）

任务版本：标准版
日期与时长：2026-07-18 周六，360 分钟（90 分钟阅读 + 270 分钟动手）
项目：D:\demo\ai-techer\p1-monitor（前端 + 后端）
角色视角：掌握 Day 1-4 事件流、合同、异步竞态和图表渲染的全栈开发者，现在要把 HTTP 轮询升级为 WebSocket 实时推送

---

## 0. 今天在 90 天路线中的位置

**承上**：
- Day 1 建立了 AgentEvent 事件流和 reducer 状态机
- Day 2 为事件类型加上了 zod schema 运行时校验
- Day 3 实现了并发读取指标 + AbortController 取消保护
- Day 4 用 ECharts 渲染图表 + 60 点滑窗 + 生命周期清理

**启下**：
- Day 6 会在今天的 WebSocket 层加心跳/重连/去重保护
- Day 7 会加异常检测算法，在 WebSocket 推送的数据上实时标注异常点
- Day 15 会在 WebSocket 断线重连后做历史数据恢复

**今天的核心**：
从 Day 3 的 HTTP 轮询（每 5 秒请求一次）升级为 **WebSocket 实时推送**（服务端有新数据立刻推送），处理 **握手 → 订阅房间 → 推送事件 → 连接关闭**的完整生命周期。

---

## 1. 今天要交付的功能模块

### 1.1 用户能看到什么

在 p1-monitor 运维监控系统的服务器详情页：

1. **打开页面**：立刻建立 WebSocket 连接，订阅当前服务器的指标推送
2. **实时更新**：服务端每产生一个新指标（CPU/内存/网络/磁盘），前端立刻收到推送，图表自动更新（无需等 5 秒）
3. **切换服务器**：关闭旧连接，建立新连接，订阅新服务器
4. **离开页面**：WebSocket 连接被正确关闭，服务端不再推送

**关键**：用户看到的是"秒级响应"，数据产生 < 200ms 就能在图表上看到，不是"等 5 秒刷新一次"。

### 1.2 这个模块在项目里承担什么

**在 p1-monitor 项目中的定位**：
- **架构层**：实时通信层，负责前后端的双向事件推送
- **依赖方**：Day 7 的异常检测、Day 15 的历史恢复都依赖今天的 WebSocket 连接
- **被依赖方**：今天依赖 Day 3 的 metrics API（握手鉴权）、Day 4 的图表组件（数据消费）

**为什么是 Day 5**：
- Day 3-4 建立了数据读取和可视化，但是轮询模式有延迟、浪费带宽
- 今天开始做实时推送，必须处理 **连接生命周期 + 房间广播域 + 事件合同**问题
- 这些问题在 Day 6 的心跳/重连场景会更复杂，所以先在基础场景练习

### 1.3 三版演进的目标（v1 / v2 / v3）

| 版本 | 核心目标 | 用户体验 | 技术关键点 |
|---|---|---|---|
| **v1** | HTTP 轮询能用 | 每 5 秒刷新一次数据 | Day 3 的 `setInterval` + `fetchAllMetrics` |
| **v2** | WebSocket 实时推送 | 数据产生后 < 200ms 更新 | NestJS Gateway + 前端 WebSocket 订阅 |
| **v3** | 房间隔离 + 生命周期清理 | 切换服务器时旧连接关闭，不泄漏 | room 订阅 + onUnmounted close |

**痛点演进**：
- v1 痛点：轮询浪费带宽，延迟高（平均 2.5 秒）
- v2 痛点：全局广播导致用户 A 看到用户 B 的数据，连接未清理导致内存泄漏
- v3 终态：按 serverId 分房间，只推送当前服务器的数据 + 组件卸载时关闭连接


### 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架，知道今天要建哪些文件、它们之间的依赖关系是什么、哪条依赖不能反过来。骨架不清晰直接动手 = 返工。

**今天在 `p1-monitor/` 下要建立的完整源码树（前端 + 后端，v3 完整版）**：

```
backend/
├── src/
│   ├── metrics/
│   │   ├── metrics.gateway.ts          ← 今天新建（WebSocket Gateway）
│   │   ├── metrics.gateway.spec.ts     ← 今天新建（Gateway 测试）
│   │   └── metrics.service.ts          ← Day 2 已建立，今天调用
│   └── app.module.ts                    ← 注册 Gateway
frontend/
├── src/
│   ├── features/
│   │   ├── metrics/
│   │   │   ├── api/
│   │   │   │   └── metrics-ws-client.ts  ← 今天新建（WebSocket 客户端）
│   │   │   └── composables/
│   │   │       ├── useMetrics.ts         ← Day 3 已建立
│   │   │       └── useMetricsWs.ts       ← 今天新建（WebSocket composable）
│   │   └── charts/                       ← Day 4 已建立
│   │       └── components/MetricChart.vue
│   └── app/
│       └── pages/
│           └── ServerDetailPage.vue      ← Day 3 已建立，今天升级用 WebSocket
└── test/
    └── mocks/
        └── metrics-ws-mock.ts            ← 今天新建（WebSocket Mock 服务器）
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `metrics.gateway.ts` | 无 | 基础 Gateway + 全局广播 | 加 room 订阅 |
| `metrics-ws-client.ts` | 无 | 基础 WebSocket 连接 | 加连接关闭清理 |
| `useMetricsWs.ts` | 无 | 订阅 + 状态管理 | 加 onUnmounted 清理 |
| `ServerDetailPage.vue` | 用 `useMetrics` 轮询 | 改用 `useMetricsWs` 推送 | 同 v2 |

**依赖方向（务必单向，反过来一次都不行）**：

```
前端：ServerDetailPage.vue → useMetricsWs.ts → metrics-ws-client.ts → WebSocket API
后端：metrics.gateway.ts → metrics.service.ts → PrismaService
```

**红线**：
- `metrics-ws-client.ts` 里出现 `import { ref } from 'vue'` 就是架构塌方（客户端层不依赖框架）
- `metrics.gateway.ts` 里直接写 SQL 就是架构塌方（Gateway 不绕过 Service 层）

**动手前先问自己 3 个问题**：

1. 为什么要单独一个 `metrics-ws-client.ts`，不直接在 composable 里 `new WebSocket`？—— 见 §5.4 知识点「客户端分层」
2. NestJS Gateway 的 `@SubscribeMessage` 和 `server.emit` 有什么区别？—— 见 §5.3 v2 代码
3. WebSocket 的 `close` 事件什么时候触发？如何区分主动关闭和异常断开？—— 见 §5.4 知识点「连接生命周期」


### 1.5 阶段 D：动手脚手架（30 分钟，先搭骨架再看正文）

**时间盒**：阶段 D 总共 30 分钟，不要在这一步卡太久。如果遇到问题（例如 NestJS Gateway 装饰器不对），先标记 `// TODO`，继续往下，读完 v3 代码后回来改。

#### 1.5.1 D-1：搭工程骨架 / 装依赖（10 分钟）

```bash
cd p1-monitor/backend
pnpm add @nestjs/websockets @nestjs/platform-socket.io
pnpm add -D @types/socket.io

cd ../frontend
pnpm add socket.io-client
```

#### 1.5.2 D-2：创建目录（2 分钟）

```bash
# 后端
cd backend/src/metrics
touch metrics.gateway.ts metrics.gateway.spec.ts

# 前端
cd ../../../frontend/src/features/metrics/api
touch metrics-ws-client.ts
cd ../composables
touch useMetricsWs.ts
```

#### 1.5.3 D-3：实现后端 Gateway（60 分钟）

按第 5.3 节的代码：

- 写 `backend/src/metrics/metrics.gateway.ts`（WebSocket Gateway，处理连接/订阅/推送）
- 在 `backend/src/app.module.ts` 里注册 Gateway

**边写边问自己**：

- `@WebSocketGateway` 装饰器的参数是什么？（端口号、命名空间、CORS）
- `@SubscribeMessage('subscribe')` 是客户端主动订阅，`server.emit` 是服务端主动推送，区别是什么？
- `socket.join(room)` 的 room 是什么？为什么要按 serverId 分房间？

#### 1.5.4 D-4：实现前端 WebSocket 客户端（60 分钟）

按第 5.3 节的代码：

- 写 `frontend/src/features/metrics/api/metrics-ws-client.ts`（WebSocket 连接封装）
- 写 `frontend/src/features/metrics/composables/useMetricsWs.ts`（WebSocket composable）

**边写边问自己**：

- `io.connect` 的第二个参数 `options` 有什么用？（transports、autoConnect）
- `socket.on('metric.created')` 和 `socket.emit('subscribe')` 的区别是什么？（订阅 vs 发送）
- `onUnmounted` 里调用 `socket.close()` 和 Day 4 的 `chart.dispose()` 有什么相似之处？

#### 1.5.5 D-5：升级页面用 WebSocket（30 分钟）

按第 5.3 节的代码：

- 升级 `frontend/src/app/pages/ServerDetailPage.vue`（从 `useMetrics` 改为 `useMetricsWs`）

**边写边问自己**：

- 轮询模式（`setInterval`）和推送模式（`socket.on`）的区别是什么？
- 切换服务器时，需要做什么清理？（关闭旧连接、建立新连接、订阅新房间）
- 如果忘记在 `onUnmounted` 里 `close` 连接，会发生什么？（连接泄漏，服务端继续推送）

---

## 2. 学习节奏（90 阅读 / 270 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| **A** | 30 分钟 | 阅读第 3 节（v1 HTTP 轮询回顾） | 阅读 |
| **B** | 30 分钟 | 阅读第 4 节（v2 WebSocket 基础推送） | 阅读 |
| **C** | 30 分钟 | 阅读第 5 节（v3 房间隔离 + 生命周期清理） | 阅读 |
| **D** | 150 分钟 | 在自己项目里实现 v3 完整功能（见 §1.5） | 动手 |
| **E** | 60 分钟 | 写核心逻辑测试 + 两个反证实验（见 §7.6-7.8） | 动手 |
| **F** | 60 分钟 | 故障注入测试 + 运行 lint/typecheck/test/build，提交 commit（见 §7.9） | 动手 |

**设计原则**：
- 前 90 分钟只读、不写（避免边读边写导致思路混乱）
- 后 270 分钟只写、不读（读完 v3 你会发现前面卡住的地方多半是"没看到全景"造成的）
- E 阶段的"反证实验"强制验证 v1/v2 的痛点（不是纸上谈兵）
- F 阶段的"故障注入"验证异常场景（断网、服务端崩溃、非法消息）

---

## 3. v1：最小闭环（HTTP 轮询回顾）

### 3.1 v1 要实现什么

**用户视角**：
- 页面每 5 秒自动刷新指标数据
- 4 个 ECharts 图表同步更新

**技术视角**：
- 复用 Day 3 的 `useMetrics` composable（`setInterval` + `fetchAllMetrics`）
- 复用 Day 4 的 `MetricChart` 组件

### 3.2 v1 完整代码

**frontend/src/app/pages/ServerDetailPage.vue**（v1 版本，Day 3 的代码）

```vue
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useMetrics } from '@/features/metrics/composables/useMetrics'
import MetricChart from '@/features/charts/components/MetricChart.vue'

const selectedServerId = ref('srv-001' as any)
const { state, loadMetrics } = useMetrics()

let intervalId: number | null = null

// 首次加载
loadMetrics(selectedServerId.value)

// 启动轮询（每 5 秒）
intervalId = window.setInterval(() => {
  loadMetrics(selectedServerId.value)
}, 5000)

// 切换服务器时重新加载
watch(selectedServerId, (newId) => {
  loadMetrics(newId)
})

// 清理定时器
onUnmounted(() => {
  if (intervalId !== null) {
    clearInterval(intervalId)
  }
})
</script>

<template>
  <div class="server-detail">
    <div v-if="state.loading">加载中...</div>
    <div v-else-if="state.error">{{ state.error }}</div>
    <div v-else-if="state.data" class="chart-grid">
      <MetricChart 
        title="CPU 使用率" 
        :data="state.data.cpu" 
        unit="%" 
        :max="100" 
      />
      <MetricChart 
        title="内存使用率" 
        :data="state.data.memory" 
        unit="%" 
        :max="100" 
      />
      <MetricChart 
        title="网络流量" 
        :data="state.data.network" 
        unit="MB/s" 
        :max="1000" 
      />
      <MetricChart 
        title="磁盘 I/O" 
        :data="state.data.disk" 
        unit="MB/s" 
        :max="500" 
      />
    </div>
  </div>
</template>
```

### 3.3 v1 用到的知识点

1. **HTTP 轮询（Polling）**：
   - 解决的问题：定时获取服务端最新数据
   - 运行机制：客户端每隔 N 秒发一次 HTTP 请求
   - 项目落点：`setInterval(() => loadMetrics(), 5000)`
   - 生产误区：轮询间隔太短浪费带宽，太长延迟高
   - 验证方法：Network 面板看请求频率

### 3.4 v1 暴露的痛点

**痛点 1**：浪费带宽

场景：100 个用户同时打开页面，每 5 秒发 4 个请求（CPU/内存/网络/磁盘），服务端每秒处理 80 个请求。

**症状**：
- 即使数据没变化，客户端也要请求
- 服务端 CPU 占用 20%+，大部分请求返回"数据未变化"

**痛点 2**：延迟高

平均延迟 = 轮询间隔 / 2 = 5秒 / 2 = 2.5 秒。用户看到的数据总是比实际晚 2.5 秒。

**痛点 3**：无法推送

服务端无法主动通知客户端"有新数据了"，只能被动等客户端来拉取。

---

## 4. v2：加一层（WebSocket 基础推送）

### 4.1 v2 要实现什么

**用户视角**：
- 打开页面后，数据产生 < 200ms 就能在图表上看到
- 不再是"每 5 秒刷新一次"，而是"有数据就推送"

**技术视角**：
- 后端用 NestJS `@WebSocketGateway` 监听连接
- 前端用 `socket.io-client` 连接并订阅 `metric.created` 事件
- 服务端每产生一个指标，调用 `server.emit('metric.created', data)` 推送

### 4.2 v2 完整代码

**backend/src/metrics/metrics.gateway.ts**（v2 版本，基础推送）

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { MetricsService } from './metrics.service'

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:5173', // 前端开发服务器地址
    credentials: true,
  },
})
export class MetricsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  constructor(private readonly metricsService: MetricsService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`)
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { serverId: string }) {
    console.log(`Client ${client.id} subscribed to server ${payload.serverId}`)
    // v2：全局广播，不分房间（有安全隐患）
    return { status: 'subscribed', serverId: payload.serverId }
  }

  /**
   * 服务端调用此方法推送新指标
   * 注意：v2 是全局广播，所有连接的客户端都会收到
   */
  async broadcastMetric(metric: any) {
    this.server.emit('metric.created', metric)
  }
}
```

**backend/src/app.module.ts**（注册 Gateway）

```typescript
import { Module } from '@nestjs/common'
import { MetricsModule } from './metrics/metrics.module'
import { MetricsGateway } from './metrics/metrics.gateway'

@Module({
  imports: [MetricsModule],
  providers: [MetricsGateway], // 注册 Gateway
})
export class AppModule {}
```

**frontend/src/features/metrics/api/metrics-ws-client.ts**（v2 版本）

```typescript
import { io, Socket } from 'socket.io-client'

export interface MetricSnapshot {
  id: string
  serverId: string
  type: 'cpu' | 'memory' | 'network' | 'disk'
  timestamp: string
  metric: {
    value: number
    unit: string
  }
}

export class MetricsWsClient {
  private socket: Socket | null = null

  connect(url: string): Socket {
    if (this.socket?.connected) {
      return this.socket
    }

    this.socket = io(url, {
      transports: ['websocket'], // 只用 WebSocket，不降级到轮询
      autoConnect: true,
    })

    return this.socket
  }

  subscribe(serverId: string) {
    if (!this.socket) throw new Error('Socket not connected')
    this.socket.emit('subscribe', { serverId })
  }

  onMetricCreated(callback: (metric: MetricSnapshot) => void) {
    if (!this.socket) throw new Error('Socket not connected')
    this.socket.on('metric.created', callback)
  }

  close() {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }
}
```

**frontend/src/features/metrics/composables/useMetricsWs.ts**（v2 版本）

```typescript
import { ref, onUnmounted, shallowRef } from 'vue'
import { MetricsWsClient, type MetricSnapshot } from '../api/metrics-ws-client'

interface MetricsState {
  cpu: MetricSnapshot[]
  memory: MetricSnapshot[]
  network: MetricSnapshot[]
  disk: MetricSnapshot[]
}

export function useMetricsWs(serverId: string) {
  const client = new MetricsWsClient()
  const state = shallowRef<MetricsState>({
    cpu: [],
    memory: [],
    network: [],
    disk: [],
  })
  const connected = ref(false)
  const error = ref<string | null>(null)

  // 连接 WebSocket
  const socket = client.connect('http://localhost:3000')

  socket.on('connect', () => {
    connected.value = true
    client.subscribe(serverId)
  })

  socket.on('disconnect', () => {
    connected.value = false
  })

  socket.on('connect_error', (err) => {
    error.value = err.message
  })

  // 监听 metric.created 事件
  client.onMetricCreated((metric) => {
    // v2 问题：收到所有服务器的指标，需要自己过滤
    if (metric.serverId !== serverId) {
      return // 忽略不属于当前服务器的指标
    }

    const newState = { ...state.value }
    newState[metric.type] = [...newState[metric.type], metric]
    state.value = newState
  })

  // 清理连接
  onUnmounted(() => {
    client.close()
  })

  return {
    state,
    connected,
    error,
  }
}
```

**frontend/src/app/pages/ServerDetailPage.vue**（v2 版本）

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMetricsWs } from '@/features/metrics/composables/useMetricsWs'
import MetricChart from '@/features/charts/components/MetricChart.vue'

const selectedServerId = ref('srv-001')
const { state, connected, error } = useMetricsWs(selectedServerId.value)

// v2 问题：切换服务器时，旧连接没有关闭，新连接建立
// 会导致两个连接同时存在
watch(selectedServerId, (newId) => {
  // TODO: 应该先关闭旧连接，再建立新连接
  location.reload() // 临时方案：刷新页面
})
</script>

<template>
  <div class="server-detail">
    <div v-if="!connected">连接中...</div>
    <div v-else-if="error">错误：{{ error }}</div>
    <div v-else class="chart-grid">
      <MetricChart 
        title="CPU 使用率" 
        :data="state.cpu" 
        unit="%" 
        :max="100" 
      />
      <MetricChart 
        title="内存使用率" 
        :data="state.memory" 
        unit="%" 
        :max="100" 
      />
      <MetricChart 
        title="网络流量" 
        :data="state.network" 
        unit="MB/s" 
        :max="1000" 
      />
      <MetricChart 
        title="磁盘 I/O" 
        :data="state.disk" 
        unit="MB/s" 
        :max="500" 
      />
    </div>
  </div>
</template>
```

### 4.3 v2 相比 v1 加了什么

| 维度 | v1 | v2 |
|---|---|---|
| 数据获取方式 | HTTP 轮询（`setInterval`） | WebSocket 推送 |
| 平均延迟 | 2.5 秒 | < 200ms |
| 带宽消耗 | 高（无论数据是否变化都请求） | 低（只推送变化的数据） |
| 服务端压力 | 高（每秒 80 个请求） | 低（维持连接 + 按需推送） |
| 推送能力 | 无（客户端主动拉） | 有（服务端主动推） |

### 4.4 v2 用到的知识点

1. **WebSocket 握手**：
   - 解决的问题：从 HTTP 升级到 WebSocket 全双工连接
   - 运行机制：客户端发 `Upgrade: websocket` 请求，服务端返回 `101 Switching Protocols`
   - 项目落点：`io(url)` 自动完成握手
   - 生产误区：握手失败会降级到长轮询，导致性能下降
   - 验证方法：Network 面板看 `101 Switching Protocols` 响应

2. **NestJS @WebSocketGateway**：
   - 解决的问题：快速搭建 WebSocket 服务端
   - 运行机制：装饰器自动注册路由、处理连接生命周期
   - 项目落点：`@WebSocketGateway({ cors: {...} })`
   - 生产误区：忘记配置 CORS 会导致跨域连接失败
   - 验证方法：浏览器 Console 看 CORS 错误

3. **Socket.IO 事件模型**：
   - 解决的问题：封装原生 WebSocket，提供事件订阅/发布 API
   - 运行机制：`socket.emit(event, data)` 发送，`socket.on(event, callback)` 接收
   - 项目落点：`socket.emit('subscribe')` / `socket.on('metric.created')`
   - 生产误区：事件名拼写错误会导致消息丢失，且无错误提示
   - 验证方法：`console.log` 打印收到的事件

### 4.5 v2 暴露的新痛点

**痛点 1**：全局广播导致数据泄漏

场景：用户 A 订阅 srv-001，用户 B 订阅 srv-002。服务端 `server.emit('metric.created')` 会推送给所有客户端。

**症状**：
- 用户 A 的页面偶尔闪现 srv-002 的数据
- 前端需要自己过滤 `metric.serverId !== serverId`
- 如果前端忘记过滤，会出现数据串台

**痛点 2**：切换服务器时连接泄漏

场景：用户点击 srv-001 → srv-002 → srv-003，每次切换都建立新连接，但旧连接没关闭。

**症状**：
- 3 个 WebSocket 连接同时存在
- 服务端继续给旧连接推送数据（浪费资源）
- Chrome DevTools Network 面板显示 3 个 ws 连接

**痛点 3**：没有房间（room）隔离

WebSocket 连接是全局的，服务端不知道每个连接订阅了哪个 serverId。

**症状**：
- 服务端只能全局广播，无法"只推送给订阅 srv-001 的客户端"
- 前端收到大量无关消息，CPU 占用增加（过滤逻辑）

---

## 5. v3：生产就绪（房间隔离 + 生命周期清理）

### 5.1 v3 要实现什么

**用户视角**：
- 只收到当前服务器的指标推送，不会看到其他服务器的数据
- 切换服务器时，旧连接自动关闭，新连接建立
- 离开页面时，连接被正确清理

**技术视角**：
- 后端用 `socket.join(room)` 把连接加入房间
- 服务端用 `server.to(room).emit()` 只推送给指定房间
- 前端在 `watch(serverId)` 时先 `client.close()` 再重新连接
- 组件卸载时在 `onUnmounted` 里 `client.close()`

**关键解决的问题**：
- 全局广播 → 房间广播（按 serverId 分房间）
- 连接泄漏 → 生命周期管理（切换时关闭旧连接）
- 无清理 → onUnmounted 清理（离开页面时关闭）

### 5.2 v3 目录结构

与 §1.4 中给出的完整目录树完全一致，此处不重复。核心是前后端的协作：

```
后端：metrics.gateway.ts 加 socket.join(room) 逻辑
前端：useMetricsWs.ts 加连接关闭 + 重连逻辑
```

**红线**：`metrics.gateway.ts` 不允许直接写 SQL，必须通过 `metricsService` 调用。

### 5.3 v3 完整代码

**backend/src/metrics/metrics.gateway.ts**（v3 版本，加房间）

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { MetricsService } from './metrics.service'

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:5173',
    credentials: true,
  },
})
export class MetricsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  constructor(private readonly metricsService: MetricsService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`)
    // 客户端断开时，Socket.IO 会自动从所有房间移除
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { serverId: string }) {
    const room = `server:${payload.serverId}`
    
    // 加入房间（一个客户端可以加入多个房间）
    client.join(room)
    
    console.log(`Client ${client.id} joined room ${room}`)
    
    return { status: 'subscribed', serverId: payload.serverId, room }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, payload: { serverId: string }) {
    const room = `server:${payload.serverId}`
    client.leave(room)
    console.log(`Client ${client.id} left room ${room}`)
    return { status: 'unsubscribed', serverId: payload.serverId }
  }

  /**
   * 服务端调用此方法推送新指标
   * v3：只推送给订阅了该 serverId 的客户端
   */
  async broadcastMetric(metric: any) {
    const room = `server:${metric.serverId}`
    this.server.to(room).emit('metric.created', metric)
  }
}
```

**frontend/src/features/metrics/api/metrics-ws-client.ts**（v3 版本，加清理）

```typescript
import { io, Socket } from 'socket.io-client'

export interface MetricSnapshot {
  id: string
  serverId: string
  type: 'cpu' | 'memory' | 'network' | 'disk'
  timestamp: string
  metric: {
    value: number
    unit: string
  }
}

export class MetricsWsClient {
  private socket: Socket | null = null
  private currentServerId: string | null = null

  connect(url: string): Socket {
    // 如果已连接，先关闭旧连接
    if (this.socket?.connected) {
      this.close()
    }

    this.socket = io(url, {
      transports: ['websocket'],
      autoConnect: true,
    })

    return this.socket
  }

  subscribe(serverId: string) {
    if (!this.socket) throw new Error('Socket not connected')
    
    // 如果之前订阅了其他服务器，先取消订阅
    if (this.currentServerId && this.currentServerId !== serverId) {
      this.socket.emit('unsubscribe', { serverId: this.currentServerId })
    }
    
    this.socket.emit('subscribe', { serverId })
    this.currentServerId = serverId
  }

  onMetricCreated(callback: (metric: MetricSnapshot) => void) {
    if (!this.socket) throw new Error('Socket not connected')
    this.socket.on('metric.created', callback)
  }

  onConnect(callback: () => void) {
    if (!this.socket) throw new Error('Socket not connected')
    this.socket.on('connect', callback)
  }

  onDisconnect(callback: () => void) {
    if (!this.socket) throw new Error('Socket not connected')
    this.socket.on('disconnect', callback)
  }

  onError(callback: (err: Error) => void) {
    if (!this.socket) throw new Error('Socket not connected')
    this.socket.on('connect_error', callback)
  }

  close() {
    if (this.socket) {
      // 取消订阅当前房间
      if (this.currentServerId) {
        this.socket.emit('unsubscribe', { serverId: this.currentServerId })
      }
      
      this.socket.close()
      this.socket = null
      this.currentServerId = null
    }
  }
}
```

**frontend/src/features/metrics/composables/useMetricsWs.ts**（v3 版本，完整生命周期）

```typescript
import { ref, onUnmounted, shallowRef, watch } from 'vue'
import { MetricsWsClient, type MetricSnapshot } from '../api/metrics-ws-client'
import { slideWindow } from '@/features/charts/utils/sliding-window'

interface MetricsState {
  cpu: MetricSnapshot[]
  memory: MetricSnapshot[]
  network: MetricSnapshot[]
  disk: MetricSnapshot[]
}

const WINDOW_SIZE = 60

export function useMetricsWs(serverIdRef: Ref<string>) {
  const client = new MetricsWsClient()
  const state = shallowRef<MetricsState>({
    cpu: [],
    memory: [],
    network: [],
    disk: [],
  })
  const connected = ref(false)
  const error = ref<string | null>(null)

  function connectAndSubscribe(serverId: string) {
    const socket = client.connect('http://localhost:3000')

    client.onConnect(() => {
      connected.value = true
      error.value = null
      client.subscribe(serverId)
    })

    client.onDisconnect(() => {
      connected.value = false
    })

    client.onError((err) => {
      error.value = err.message
    })

    client.onMetricCreated((metric) => {
      // v3：服务端已按房间过滤，这里无需再判断 serverId
      const newState = { ...state.value }
      
      // 应用滑窗算法（复用 Day 4 的逻辑）
      newState[metric.type] = slideWindow(
        newState[metric.type],
        metric,
        WINDOW_SIZE
      )
      
      state.value = newState
    })
  }

  // 首次连接
  connectAndSubscribe(serverIdRef.value)

  // 监听 serverId 变化，重新连接
  watch(serverIdRef, (newId) => {
    client.close() // 关闭旧连接
    state.value = { cpu: [], memory: [], network: [], disk: [] } // 清空旧数据
    connectAndSubscribe(newId) // 建立新连接
  })

  // 清理连接
  onUnmounted(() => {
    client.close()
  })

  return {
    state,
    connected,
    error,
  }
}
```

**frontend/src/app/pages/ServerDetailPage.vue**（v3 版本）

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useMetricsWs } from '@/features/metrics/composables/useMetricsWs'
import MetricChart from '@/features/charts/components/MetricChart.vue'

const servers = [
  { id: 'srv-001', name: '服务器 001' },
  { id: 'srv-002', name: '服务器 002' },
  { id: 'srv-003', name: '服务器 003' },
]

const selectedServerId = ref('srv-001')
const { state, connected, error } = useMetricsWs(selectedServerId)
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
    
    <div v-if="!connected" class="loading">连接中...</div>
    <div v-else-if="error" class="error">错误：{{ error }}</div>
    <div v-else class="chart-grid">
      <MetricChart 
        title="CPU 使用率" 
        :data="state.cpu" 
        unit="%" 
        :max="100" 
      />
      <MetricChart 
        title="内存使用率" 
        :data="state.memory" 
        unit="%" 
        :max="100" 
      />
      <MetricChart 
        title="网络流量" 
        :data="state.network" 
        unit="MB/s" 
        :max="1000" 
      />
      <MetricChart 
        title="磁盘 I/O" 
        :data="state.disk" 
        unit="MB/s" 
        :max="500" 
      />
    </div>
  </div>
</template>

<style scoped>
.server-selector {
  display: flex;
  gap: 8px;
  margin: 20px 0;
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

.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
</style>
```

### 5.4 v3 用到的知识点（≥ 6 个）

1. **Socket.IO 房间（Room）机制**：
   - 解决的问题：按业务维度隔离广播域，避免全局广播
   - 运行机制：`socket.join(room)` 加入房间，`server.to(room).emit()` 只推送给房间内客户端
   - 项目落点：`client.join(\`server:${serverId}\`)`
   - 生产误区：忘记 `leave` 会导致客户端收到多个房间的消息
   - 验证方法：打印 `server.sockets.adapter.rooms` 看房间成员

2. **WebSocket 连接生命周期**：
   - 解决的问题：管理连接的建立、保持、关闭
   - 运行机制：`connect` → `disconnect` / `close` 事件循环
   - 项目落点：`onConnect` / `onDisconnect` / `close()` 钩子
   - 生产误区：忘记在组件卸载时 `close` 会导致连接泄漏
   - 验证方法：Chrome DevTools Network 面板看 ws 连接数量

3. **客户端分层（client / composable / component）**：
   - 解决的问题：把底层连接逻辑和业务逻辑分离
   - 运行机制：client 封装 Socket.IO，composable 封装状态管理，component 只做渲染
   - 项目落点：`MetricsWsClient` → `useMetricsWs` → `ServerDetailPage`
   - 生产误区：在 composable 里直接 `new io()` 会导致难以测试
   - 验证方法：`MetricsWsClient` 可以在 Node.js 环境单元测试

4. **滑窗算法复用（跨 Day）**：
   - 解决的问题：WebSocket 推送频率高，需要限制数据点数量
   - 运行机制：复用 Day 4 的 `slideWindow` 函数
   - 项目落点：`useMetricsWs.ts` 的 `onMetricCreated` 回调
   - 生产误区：不用滑窗会导致数组无限增长，最终内存溢出
   - 验证方法：运行 10 分钟，看 `state.cpu.length` 是否稳定在 60

5. **watch 清理模式**：
   - 解决的问题：响应式变量变化时，清理旧副作用、建立新副作用
   - 运行机制：`watch(ref, (newVal) => { cleanup(); setup(newVal) })`
   - 项目落点：`watch(serverIdRef, (newId) => { client.close(); connect(newId) })`
   - 生产误区：忘记先 `close` 会导致旧连接和新连接并存
   - 验证方法：切换服务器 10 次，看 Network 面板是否只有 1 个 ws 连接

6. **事件合同（Event Contract）**：
   - 解决的问题：前后端约定事件名、payload 格式
   - 运行机制：TypeScript 接口 + zod schema 运行时校验
   - 项目落点：`MetricSnapshot` 接口 + Day 2 的 `metricSchema`
   - 生产误区：前后端事件名不一致（如前端 `metric.created`，后端 `metricCreated`）会导致消息丢失
   - 验证方法：写集成测试，mock 后端推送非法消息

7. **CORS 跨域配置**：
   - 解决的问题：前后端分离时，WebSocket 跨域握手
   - 运行机制：`@WebSocketGateway({ cors: { origin, credentials } })`
   - 项目落点：`cors: { origin: 'http://localhost:5173', credentials: true }`
   - 生产误区：生产环境写死 `localhost` 会导致部署后无法连接
   - 验证方法：浏览器 Console 看 `Cross-Origin Request Blocked` 错误

8. **Socket.IO 传输策略（transports）**：
   - 解决的问题：WebSocket 不可用时降级到长轮询
   - 运行机制：默认先尝试轮询握手，再升级到 WebSocket；可强制只用 WebSocket
   - 项目落点：`io(url, { transports: ['websocket'] })`
   - 生产误区：不指定 `transports` 会导致先建立轮询连接（浪费一次 HTTP 请求）
   - 验证方法：Network 面板看是否有 `?transport=polling` 请求

---

## 6. 三版对比

| 维度 | v1 HTTP 轮询 | v2 WebSocket 基础推送 | v3 房间隔离 + 清理 |
|---|---|---|---|
| **代码行数** | ~60 行 | ~200 行 | ~350 行（前后端） |
| **文件数** | 1 个页面 | 3 个前端 + 1 个后端 | 同 v2 |
| **数据获取** | 客户端主动拉（轮询） | 服务端主动推 | 同 v2 |
| **平均延迟** | 2.5 秒 | < 200ms | < 200ms |
| **带宽消耗** | 高（无论变化都请求） | 低（只推送变化） | 同 v2 |
| **广播域** | 无（每个客户端独立请求） | 全局广播（所有客户端收到） | 房间广播（按 serverId 隔离） |
| **连接管理** | 无连接（短连接） | 无管理（连接泄漏） | 完整管理（切换时关闭旧连接） |
| **清理机制** | `clearInterval` | 无 | `onUnmounted` + `client.close()` |
| **数据过滤** | 无需过滤（每次请求指定 serverId） | 前端过滤（收到所有数据） | 后端过滤（只推送订阅的数据） |
| **适用场景** | Demo / 轮询可接受场景 | 演示 WebSocket 概念 | 生产环境 |

**演进逻辑**：v1 证明功能可用 → v2 引入 WebSocket 降低延迟 → v3 处理房间隔离和连接泄漏。

---

### 6.5 前端底子补弱（独立深挖 HTML 入口）

完整的深挖内容见 `Day05深挖-WebSocket全栈.html`，包含以下 8 个深挖主题：

1. **深挖 1**：WebSocket 握手协议 —— 从今天项目里的 `io(url)` 讲起
2. **深挖 2**：长连接 vs 短连接 —— 从今天项目里的 HTTP 轮询 vs WebSocket 讲起
3. **深挖 3**：Socket.IO 传输层 —— 从今天项目里的 `transports: ['websocket']` 讲起
4. **深挖 4**：房间与命名空间 —— 从今天项目里的 `socket.join(room)` 讲起
5. **深挖 5**：事件驱动架构 —— 从今天项目里的 `socket.emit` / `socket.on` 讲起
6. **深挖 6**：连接生命周期管理 —— 从今天项目里的 `onConnect` / `onDisconnect` 讲起
7. **深挖 7**：背压与流控 —— 从今天项目里的高频推送场景讲起
8. **深挖 8**：CORS 跨域机制 —— 从今天项目里的 `cors: { origin }` 讲起

---

## 7. 项目验收清单（阶段 E-F，约 120 分钟）

### 7.6 E：写核心逻辑单元测试（30 分钟）

**backend/src/metrics/metrics.gateway.spec.ts**

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { MetricsGateway } from './metrics.gateway'
import { MetricsService } from './metrics.service'
import { Socket } from 'socket.io'

describe('MetricsGateway', () => {
  let gateway: MetricsGateway
  let mockSocket: Partial<Socket>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsGateway,
        { provide: MetricsService, useValue: {} },
      ],
    }).compile()

    gateway = module.get<MetricsGateway>(MetricsGateway)
    mockSocket = { id: 'test-socket-id', join: jest.fn(), leave: jest.fn() }
  })

  it('should join room on subscribe', () => {
    gateway.handleSubscribe(mockSocket as Socket, { serverId: 'srv-001' })
    expect(mockSocket.join).toHaveBeenCalledWith('server:srv-001')
  })

  it('should leave room on unsubscribe', () => {
    gateway.handleUnsubscribe(mockSocket as Socket, { serverId: 'srv-001' })
    expect(mockSocket.leave).toHaveBeenCalledWith('server:srv-001')
  })

  it('should broadcast to specific room', () => {
    const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() }
    gateway.server = mockServer as any
    const metric = { serverId: 'srv-001', type: 'cpu', value: 50 }
    gateway.broadcastMetric(metric)
    expect(mockServer.to).toHaveBeenCalledWith('server:srv-001')
    expect(mockServer.emit).toHaveBeenCalledWith('metric.created', metric)
  })
})
```

### 7.7 F-1：反证实验 1（5 分钟）

**目标**：证明 v2 的全局广播问题（不用房间会导致数据串台）

**步骤**：

1. 注释掉 `metrics.gateway.ts` 里的房间逻辑：

```typescript
// client.join(room)
this.server.emit('metric.created', metric)  // 改为全局广播
```

2. 打开两个浏览器标签页，分别选择 srv-001 和 srv-002

3. 观察 srv-001 的页面是否会闪现 srv-002 的数据

**预期结果**：srv-001 页面偶尔显示 srv-002 的数据，Console 显示收到 `serverId: 'srv-002'` 的消息。

**结论**：没有房间隔离时，所有客户端收到所有消息。

**恢复代码**：取消注释。

### 7.8 F-2：反证实验 2（5 分钟）

**目标**：证明不在 `onUnmounted` 里 `close` 会导致连接泄漏

**步骤**：

1. 注释掉 `useMetricsWs.ts` 的 `onUnmounted`：

```typescript
// onUnmounted(() => { client.close() })
```

2. 打开页面，关闭标签页，重复 5 次

3. Chrome DevTools Network 面板筛选 `WS` 类型

**预期结果**：显示 5 个 ws 连接，后端 console 显示 5 个 `Client connected`，无 `disconnected`。

**结论**：组件卸载时不 `close` 会导致连接泄漏。

**恢复代码**：取消注释。

### 7.9 F-3：验证 + 提交（50 分钟）

**运行四件套**：

```bash
# 后端
cd backend
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 前端
cd ../frontend
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

**提交 commit**：

```bash
cd backend
git add src/metrics/
git commit -m "feat(metrics): add WebSocket Gateway with room isolation

Refs: Day5"

cd ../frontend
git add src/features/metrics/
git commit -m "feat(metrics): add WebSocket client with lifecycle management

Refs: Day5"
```

**注意**：不要执行 `git push`，等手动推。

---

## 8. 通过标准（v3 自检清单）

| 编号 | 检查项 | 通过标准 |
|---|---|---|
| 1 | 后端 Gateway | 实现 `handleSubscribe` / `broadcastMetric` |
| 2 | 房间隔离 | `socket.join(room)` + `server.to(room).emit()` |
| 3 | 前端客户端 | `MetricsWsClient` 封装 Socket.IO 连接 |
| 4 | 连接清理 | `client.close()` 在 `onUnmounted` 里调用 |
| 5 | 切换服务器 | `watch(serverId)` 时先 `close` 再重连 |
| 6 | 滑窗算法复用 | `useMetricsWs` 里调用 Day 4 的 `slideWindow` |
| 7 | 单元测试 | Gateway 测试 + client 测试共 8+ 用例 |
| 8 | 反证实验记录 | 两个反证实验的操作步骤 |
| 9 | 类型检查 | 前后端 `pnpm typecheck` 无 error |
| 10 | 构建通过 | 前后端 `pnpm build` 无 error |

---

## 9. 提交物

1. **代码**：前后端 `git diff HEAD~1` 输出（约 800 行）
2. **测试截图**：前后端 `pnpm test` 终端输出（至少 8 个测试全绿）
3. **反证实验记录**：两个反证实验的操作步骤 + Chrome DevTools 截图
4. **学习日志**：回答 §10 的 3 个核心问题
5. **架构证据**：用 `madge` 证明 `metrics-ws-client.ts` 不依赖 Vue
---

## 10. 课末 3 个核心问题

1. **请从今天项目的真实入口到最终输出，解释"WebSocket 全栈"的数据流或控制流；当天知识链"握手、房间、事件合同、连接生命周期、CORS"分别在哪一层起作用，为什么按这个顺序学习？**

   参考答案框架：
   - 入口：`ServerDetailPage.vue` 的 `useMetricsWs(serverId)`
   - 流向：前端 `io.connect` → 握手 → `socket.emit('subscribe')` → 后端 `handleSubscribe` → `socket.join(room)` → 服务端 `broadcastMetric` → `server.to(room).emit` → 前端 `socket.on('metric.created')` → 图表更新
   - 握手：在连接建立时完成（HTTP Upgrade → WebSocket）
   - 房间：在 `handleSubscribe` 时 `socket.join`
   - 事件合同：前后端约定 `metric.created` 事件名和 payload 格式
   - 连接生命周期：`onConnect` / `onDisconnect` / `onUnmounted` 管理
   - CORS：在 Gateway 装饰器里配置

2. **如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。**

   参考答案框架：
   - 移除机制：删除 `socket.join(room)`，改为全局广播
   - 可观察现象：用户 A 看到用户 B 的服务器数据
   - 最小复现：打开两个标签页，分别选择不同服务器，观察是否串台
   - 定位证据：Console 显示收到 `serverId` 不匹配的消息
   - 恢复动作：加回 `socket.join` + `server.to(room).emit`
   - 防复发测试：集成测试模拟两个客户端，验证只收到自己订阅的消息

3. **请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。**

   参考答案框架：
   - 代码证据：`metrics.gateway.ts` 第 34 行 `socket.join(room)`，`useMetricsWs.ts` 第 52 行 `client.close()`
   - 测试证据：`metrics.gateway.spec.ts` 第 23-27 行的房间测试
   - 架构证据：`MetricsWsClient` 不 import Vue
   - 缺少功能：心跳/重连（Day 6）、消息去重、鉴权、限流
   - 下一步演进：Day 6 加心跳检测，合同不变（仍用 `metric.created` 事件）

---

## 11. 真实项目情境题（联网更新 2026-07-16）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。

### 情境题 1：WebSocket 广播域泄漏

**背景**：
监控系统未按 serverId 分房间，100 个租户偶发看到其他服务器指标。

**任务**：
请用连接握手、room membership、事件 payload 与审计日志证明广播域错误；先关闭全局广播止损，再实现房间授权和事件 Schema 校验，并用跨租户集成测试验证泄漏为 0。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - 审计日志显示 `server.emit('metric.created')` 全局广播
   - `server.sockets.adapter.rooms` 为空，无房间隔离
   - 前端 Console 显示收到 `serverId` 不匹配的消息

2. **临时止损**：
   - 关闭 WebSocket Gateway，回退到 HTTP 轮询

3. **根因修复**：
   - 加 `socket.join(\`server:${serverId}\`)`
   - 改 `server.emit` 为 `server.to(room).emit`
   - 见 §5.3 v3 代码

4. **回归验证**：
   - 写集成测试：模拟两个客户端订阅不同 serverId
   - 验证客户端 A 只收到 srv-001 的消息，不收到 srv-002 的

**依据**：[NestJS WebSocket gateways](https://docs.nestjs.com/websockets/gateways)

### 情境题 2：高频推送导致前端堆积

**背景**：
峰值 2000 event/s 时浏览器 Store 堆积，图表延迟 40 秒且内存持续上涨。

**任务**：
请采集生产速率、消费速率、队列长度和丢帧证据；先采样并暂停非关键图表止损，再设计批量合并、背压/限频和快照校准，压测验证延迟有界且最终状态与 DB 一致。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - Console 显示 `state.cpu.length = 5000+`（未用滑窗）
   - Performance 面板显示 `setOption` 占用 80% CPU
   - 生产速率 2000/s，消费速率 50/s（渲染瓶颈）

2. **临时止损**：
   - 采样：每 10 个消息只处理 1 个
   - 暂停非关键图表（只保留 CPU）

3. **根因修复**：
   - 加滑窗算法（复用 Day 4 的 `slideWindow`，限制 60 点）
   - 批量合并：100ms 内的消息合并一次 `setOption`
   - 见 §5.3 v3 代码

4. **回归验证**：
   - 压测：模拟 2000 event/s，运行 10 分钟
   - 验证 `state.cpu.length` 稳定在 60
   - 验证图表延迟 < 500ms

**依据**：[MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

**知识映射**：WebSocket 握手、房间、事件合同、连接生命周期、背压。

---

## 12. PDF 面试题精选

> **说明**：以下题目来自 PDF 资源文件，文件名用于教学分类，不等于官方题库或真实面试题来源。

**题 1**：AI 聊天场景中的流式输出通常怎样实现？

**来源**：[《2026高德 AI agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 3 页。

**思路**：
- SSE（Server-Sent Events）：单向推送，适合 AI 流式输出
- WebSocket：双向通信，适合聊天对话
- 今天项目用 WebSocket 是因为需要双向（前端订阅 + 后端推送）

**题 2**：SSE 与 WebSocket 有何区别，为什么 AI 聊天通常采用 SSE？

**来源**：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 3 页。

**思路**：
- SSE：HTTP 长连接，只能服务端→客户端
- WebSocket：全双工，双向通信
- AI 聊天用 SSE 因为：简单、自动重连、无需额外协议

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。

**示例问题方向**：

1. **演示验收**：请演示你的 Gateway 测试全部通过，并在浏览器里切换服务器，看 Network 面板是否只有 1 个 ws 连接。
2. **核心挑战**：Day05 最难的部分是什么？你卡在哪里最久？
3. **对比思考**：v1/v2/v3 三版你觉得哪一版最关键？为什么？
4. **项目对手戏**：假设 Day 6 要加心跳检测（每 30 秒 ping-pong），你会在哪一层实现？client 层还是 composable 层？
5. **知识盲区**：Socket.IO 的 `transports` 参数为什么要显式指定 `['websocket']`？不指定会怎样？

---

## 14. 本 Day 在 90 天路线中的锚点

**向前承接**：
- Day 1：建立了 AgentEvent 事件流和 reducer 状态机
- Day 2：为事件类型加上了 zod schema 和 DTO/Domain 分层
- Day 3：实现了并发读取指标 + AbortController 取消保护
- Day 4：用 ECharts 渲染图表 + 60 点滑窗 + 生命周期清理

**向后传递**：
- Day 6：在今天的 WebSocket 层加心跳/重连/去重保护
- Day 7：在 WebSocket 推送的数据上实时标注异常点
- Day 15：WebSocket 断线重连后做历史数据恢复

**复用点**：
- `socket.join(room)` 的房间模式会在 Day 6-30 的所有 WebSocket 场景复用
- `client.close()` 的生命周期清理模式会在 Day 6 的重连场景复用
- Day 4 的 `slideWindow` 函数在今天被复用（限制 WebSocket 推送的数据点）
- 今天的事件合同 `metric.created` 会在 Day 7-15 继续使用

**螺旋上升**：
- Day 5 在基础场景练习 WebSocket 连接管理
- Day 6 在断线重连场景扩展连接管理（心跳检测 + 指数退避）
- Day 15 在历史恢复场景扩展连接管理（断线后恢复缺失数据）

---

**完成 Day 5 后，你已经掌握**：
- ✅ WebSocket 握手与连接建立
- ✅ Socket.IO 房间（Room）机制按业务隔离广播域
- ✅ 连接生命周期管理（connect / disconnect / close）
- ✅ 事件合同与前后端协作
- ✅ 客户端分层（client / composable / component）
- ✅ watch 清理模式（响应式变量变化时清理旧副作用）

**下一步 Day 6**：在今天的 WebSocket 基础上加心跳检测、断线重连、消息去重。
