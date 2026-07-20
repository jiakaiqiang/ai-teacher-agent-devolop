# Day 6：实时可靠性（基础连接 → 心跳检测 → 重连+去重+快照补偿）

任务版本：标准版
日期与时长：2026-07-19 周日，360 分钟（90 分钟阅读 + 270 分钟动手）
项目：D:\demo\ai-techer\p1-monitor（前端 + 后端）
角色视角：掌握 Day 1-5 事件流、合同、异步竞态、图表和 WebSocket 基础推送的全栈开发者，现在要处理网络异常场景

---

## 0. 今天在 90 天路线中的位置

**承上**：
- Day 1 建立了 AgentEvent 事件流和 reducer 状态机
- Day 2 为事件类型加上了 zod schema 运行时校验
- Day 3 实现了并发读取指标 + AbortController 取消保护
- Day 4 用 ECharts 渲染图表 + 60 点滑窗 + 生命周期清理
- Day 5 用 WebSocket 实时推送 + 房间隔离

**启下**：
- Day 7 会加异常检测算法（Z-Score），今天保证的数据完整性是异常检测的前提
- Day 15 会做历史数据恢复，会复用今天的 REST 快照补偿逻辑
- Day 30 的生产部署会验证今天的重连策略在真实网络抖动下的表现

**今天的核心**：
从 Day 5 的"能推送就推送"升级为"网络异常也能自动恢复"，处理 **心跳保活 → 断线检测 → 指数退避重连 → sequence 去重 → REST 快照补缺**的完整可靠性链。

---

## 1. 今天要交付的功能模块

### 1.1 用户能看到什么

在 p1-monitor 运维监控系统的服务器详情页：

1. **网络正常**：图表实时更新，右上角连接状态显示"已连接"（绿色）
2. **网络抖动**：断开 3 秒内自动重连，状态从"重连中"（黄色）恢复到"已连接"
3. **服务器重启**：客户端 30 秒内自动恢复连接，通过 REST 拉取缺失的历史数据补齐图表
4. **后台标签页**：切回前台时，如果数据缺口 > 60 秒，触发快照重建，图表显示"数据已同步"

**关键**：用户看到的是"自愈系统"，即使网络不稳定，数据最终一致；不会出现"表面正常但数据早已陈旧"的情况。

### 1.2 这个模块在项目里承担什么

**在 p1-monitor 项目中的定位**：
- **架构层**：可靠性层，负责在不稳定网络下保证数据完整性
- **依赖方**：Day 7 的异常检测算法依赖今天的数据完整性保证
- **被依赖方**：今天依赖 Day 5 的 WebSocket 基础推送、Day 3 的 REST API（快照补偿）

**为什么是 Day 6**：
- Day 5 建立了 WebSocket 推送，但网络异常时数据会丢失
- 今天必须处理 **心跳 + 重连 + 去重 + 快照补偿**，形成完整的可靠性闭环
- 这些问题在 Day 7 的异常检测场景至关重要（数据缺口会产生假异常）

### 1.3 三版演进的目标（v1 / v2 / v3）

| 版本 | 核心目标 | 用户体验 | 技术关键点 |
|---|---|---|---|
| **v1** | 基础推送能用 | 网络正常时图表实时更新 | Day 5 的 WebSocket Gateway |
| **v2** | 心跳检测断线 | 断网后 15 秒能感知，状态变红 | ping-pong + 客户端 timeout |
| **v3** | 自动重连+去重+快照 | 30 秒内自愈，数据无缺口 | 指数退避 + sequence + REST 快照 |

**痛点演进**：
- v1 痛点：断网后客户端不知道，一直显示"已连接"，数据早已陈旧
- v2 痛点：能检测到断线，但需要手动刷新页面才能重连；重连后数据有缺口
- v3 终态：心跳感知断线 → 指数退避重连 → 通过 sequence 检测缺口 → REST 快照补齐


### 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架，知道今天要建哪些文件、它们之间的依赖关系是什么、哪条依赖不能反过来。骨架不清晰直接动手 = 返工。

**今天在 `p1-monitor/` 下要建立的完整源码树（前端 + 后端，v3 完整版）**：

```
backend/
├── src/
│   ├── metrics/
│   │   ├── metrics.gateway.ts          ← Day 5 已建立，今天加心跳和 sequence
│   │   ├── metrics.controller.ts       ← Day 3 已建立，今天加 /snapshot 端点
│   │   └── metrics.service.ts          ← Day 2 已建立
│   └── app.module.ts
frontend/
├── src/
│   ├── features/
│   │   ├── metrics/
│   │   │   ├── api/
│   │   │   │   ├── metrics-client.ts       ← Day 3 已建立
│   │   │   │   ├── metrics-ws-client.ts    ← Day 5 已建立
│   │   │   │   └── metrics-snapshot.ts     ← 今天新建（REST 快照补偿）
│   │   │   ├── composables/
│   │   │   │   ├── useMetricsWs.ts         ← Day 5 已建立，今天升级
│   │   │   │   └── useConnectionState.ts   ← 今天新建（连接状态机）
│   │   │   └── utils/
│   │   │       ├── backoff.ts              ← 今天新建（指数退避算法）
│   │   │       └── sequence-tracker.ts     ← 今天新建（sequence 去重）
│   │   └── charts/                         ← Day 4 已建立
│   └── app/
│       └── pages/
│           └── ServerDetailPage.vue        ← Day 5 已建立
└── test/
    └── mocks/
        └── network-fault-injector.ts       ← 今天新建（网络故障注入器）
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `metrics.gateway.ts` | Day 5 版本 | 加 ping-pong | 加 sequence + 广播 |
| `metrics-ws-client.ts` | Day 5 版本 | 加 heartbeat timeout | 加 reconnect + sequence 检测 |
| `useMetricsWs.ts` | Day 5 版本 | 显示 disconnect 状态 | 触发快照补偿 |
| `useConnectionState.ts` | 无 | 无 | 连接状态机 (idle/connecting/connected/reconnecting/failed) |
| `backoff.ts` | 无 | 无 | 指数退避 + jitter |
| `sequence-tracker.ts` | 无 | 无 | sequence 去重 + 缺口检测 |
| `metrics-snapshot.ts` | 无 | 无 | REST 拉取历史数据 |

**依赖方向（务必单向，反过来一次都不行）**：

```
前端：ServerDetailPage.vue → useMetricsWs.ts → useConnectionState.ts
                                            → metrics-ws-client.ts → backoff.ts
                                                                   → sequence-tracker.ts
                                            → metrics-snapshot.ts → metrics-client.ts
后端：metrics.gateway.ts → metrics.service.ts → PrismaService
```

**红线**：
- `utils/backoff.ts` 和 `utils/sequence-tracker.ts` 必须是纯函数，不能 `import { ref } from 'vue'`
- `metrics-ws-client.ts` 不能直接 `import { useConnectionState }`（客户端层不依赖状态层）

**动手前先问自己 3 个问题**：

1. 为什么心跳机制要放在客户端，服务端也能检测断线？—— 见 §5.4 知识点「心跳双向机制」
2. 指数退避的 jitter 是干什么的？为什么不能用固定间隔重连？—— 见 §5.4 知识点「重连风暴」
3. sequence 去重能覆盖所有场景吗？什么时候必须用 REST 快照？—— 见 §5.4 知识点「缺口检测」


### 1.5 阶段 D：动手脚手架（30 分钟，先搭骨架再看正文）

**时间盒**：阶段 D 总共 30 分钟，不要在这一步卡太久。如果遇到问题（例如状态机跳转逻辑不对），先标记 `// TODO`，继续往下，读完 v3 代码后回来改。

#### 1.5.1 D-1：搭工程骨架 / 装依赖（5 分钟）

```bash
cd p1-monitor/frontend
# 今天不需要新的运行时依赖，只需类型
pnpm add -D vitest-fetch-mock
```

#### 1.5.2 D-2：创建目录和空文件（5 分钟）

```bash
cd frontend/src/features/metrics
touch api/metrics-snapshot.ts
touch composables/useConnectionState.ts
mkdir -p utils
touch utils/backoff.ts utils/sequence-tracker.ts
touch utils/backoff.spec.ts utils/sequence-tracker.spec.ts

cd ../../test/mocks
touch network-fault-injector.ts
```

#### 1.5.3 D-3：实现 utils 层（30 分钟）

按第 5.3 节的代码：

- 写 `src/features/metrics/utils/backoff.ts`（指数退避 + jitter，纯函数）
- 写 `src/features/metrics/utils/sequence-tracker.ts`（sequence 去重 + 缺口检测，纯函数）

**边写边问自己**：

- 指数退避为什么要加 jitter？如果 100 个客户端同时断开，会发生什么？（重连风暴）
- sequence 去重用 Set 还是 Map？为什么要限制 Set 大小？（内存泄漏）
- 缺口检测的边界条件：sequence 从 0 开始还是 1 开始？（避免首次连接误判）

#### 1.5.4 D-4：实现状态机 composable（40 分钟）

按第 5.3 节的代码：

- 写 `src/features/metrics/composables/useConnectionState.ts`（连接状态机）

**边写边问自己**：

- 状态机有几个状态？状态之间的转换条件是什么？（idle/connecting/connected/reconnecting/failed）
- 为什么要用状态机而不是布尔标志？（防止非法转换、可测试）
- 状态转换时要不要清理旧状态的资源？（timer、listener）

#### 1.5.5 D-5：升级 WebSocket 客户端（60 分钟）

按第 5.3 节的代码：

- 升级 `src/features/metrics/api/metrics-ws-client.ts`（加心跳、重连、sequence）
- 写 `src/features/metrics/api/metrics-snapshot.ts`（REST 快照补偿）
- 升级 `src/features/metrics/composables/useMetricsWs.ts`（组合状态机 + 快照）

**边写边问自己**：

- 心跳发送频率是多少？超时时长是多少？（15秒发一次，30秒无响应认为断线）
- 重连时旧的 listener 要不要清理？（否则会重复处理消息）
- 触发快照补偿的条件是什么？（sequence 缺口 > N 或断线时间 > M）

---

## 2. 学习节奏（90 阅读 / 270 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| **A** | 30 分钟 | 阅读第 3 节（v1 基础连接回顾） | 阅读 |
| **B** | 30 分钟 | 阅读第 4 节（v2 心跳检测） | 阅读 |
| **C** | 30 分钟 | 阅读第 5 节（v3 重连+去重+快照） | 阅读 |
| **D** | 150 分钟 | 在自己项目里实现 v3 完整功能（见 §1.5） | 动手 |
| **E** | 60 分钟 | 写核心逻辑测试 + 两个反证实验（见 §7.6-7.8） | 动手 |
| **F** | 60 分钟 | 5 类故障注入测试 + 提交 commit（见 §7.9） | 动手 |

**设计原则**：
- 前 90 分钟只读、不写（避免边读边写导致思路混乱）
- 后 270 分钟只写、不读（读完 v3 你会发现前面卡住的地方多半是"没看到全景"造成的）
- E 阶段的"反证实验"强制验证 v1/v2 的痛点
- F 阶段的"故障注入"是今天的核心：断网、服务重启、后台标签页、重复 listener、消息乱序

---

## 3. v1：最小闭环（基础连接回顾）

### 3.1 v1 要实现什么

**用户视角**：
- 网络正常时，图表实时更新
- 但网络断开后，客户端不知道，UI 一直显示"已连接"

**技术视角**：
- 直接复用 Day 5 的 WebSocket 客户端
- 没有心跳、没有重连、没有 sequence

### 3.2 v1 完整代码（Day 5 已完成，此处仅回顾关键片段）

**frontend/src/features/metrics/api/metrics-ws-client.ts**（v1 版本，Day 5 版本）

```typescript
import { io, Socket } from 'socket.io-client'
import type { MetricSnapshot } from '@/domain/metrics/metric.types'

export class MetricsWsClient {
  private socket: Socket | null = null
  
  connect(serverId: string, onMessage: (m: MetricSnapshot) => void) {
    this.socket = io('http://localhost:3000/metrics')
    this.socket.emit('subscribe', { serverId })
    this.socket.on('metric.created', onMessage)
  }
  
  close() {
    this.socket?.close()
    this.socket = null
  }
}
```

### 3.3 v1 用到的知识点

1. **Socket.IO 基础连接**：
   - 解决的问题：建立 WebSocket 长连接
   - 运行机制：HTTP Upgrade + Socket.IO 协议握手
   - 项目落点：`io('http://...')` 创建连接
   - 生产误区：不指定 transports 会先尝试 polling 再升级 WS
   - 验证方法：Network 面板看 `101 Switching Protocols`

2. **事件订阅**：
   - 解决的问题：接收服务端推送
   - 运行机制：`socket.on(event, handler)` 注册回调
   - 项目落点：`this.socket.on('metric.created', onMessage)`
   - 生产误区：多次 `on` 同一事件会注册多个 handler
   - 验证方法：`console.log(socket.listeners('metric.created').length)`

### 3.4 v1 暴露的痛点

**痛点 1**：断网后客户端不知道

拔网线或关闭 Wi-Fi 后，`socket.connected` 仍然是 `true`，直到操作系统告诉浏览器 TCP 连接超时（可能是 2-15 分钟）。用户看到的是"表面正常，但数据早已停滞"。

**痛点 2**：没有重连机制

即使 Socket.IO 内置了 `reconnection: true`，也需要客户端在重连后重新 `emit('subscribe')` 才能收到消息。默认行为是"连接建立即结束"，业务层需要感知重连事件。

**痛点 3**：没有 sequence

服务端连续推送 100 个消息，中间因网络抖动丢了 3 个，客户端完全无感知。图表会跳变，异常检测（Day 7）会产生假异常。

---

## 4. v2：加中间层（心跳检测）

### 4.1 v2 要解决的问题

**新增功能**：
- 客户端每 15 秒发一次 ping
- 服务端每次收到 ping 立刻回 pong
- 客户端如果 30 秒没收到 pong，主动断开并显示"连接已断开"

**技术关键点**：
- `setInterval` 定时发送 ping
- 服务端 `@SubscribeMessage('ping')` 处理器
- 客户端 timeout 定时器

### 4.2 v2 完整代码

**backend/src/metrics/metrics.gateway.ts**（v2 版本）

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

@WebSocketGateway({ namespace: 'metrics', cors: { origin: '*' } })
export class MetricsGateway {
  @WebSocketServer()
  server!: Server
  
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { serverId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    socket.join(`server:${data.serverId}`)
    return { ok: true }
  }
  
  // v2 新增：处理 ping
  @SubscribeMessage('ping')
  handlePing() {
    return { pong: Date.now() }
  }
  
  broadcastMetric(serverId: string, metric: any) {
    this.server.to(`server:${serverId}`).emit('metric.created', metric)
  }
}
```

**frontend/src/features/metrics/api/metrics-ws-client.ts**（v2 版本）

```typescript
import { io, Socket } from 'socket.io-client'
import type { MetricSnapshot } from '@/domain/metrics/metric.types'

const PING_INTERVAL = 15000  // 15 秒发一次
const PONG_TIMEOUT = 30000   // 30 秒无 pong 认为断线

export class MetricsWsClient {
  private socket: Socket | null = null
  private pingTimer: number | null = null
  private pongTimer: number | null = null
  
  connect(
    serverId: string,
    onMessage: (m: MetricSnapshot) => void,
    onDisconnect: () => void,
  ) {
    this.socket = io('http://localhost:3000/metrics')
    this.socket.emit('subscribe', { serverId })
    this.socket.on('metric.created', onMessage)
    
    // v2 新增：启动心跳
    this.startHeartbeat(onDisconnect)
  }
  
  private startHeartbeat(onDisconnect: () => void) {
    this.pingTimer = window.setInterval(() => {
      if (!this.socket) return
      
      // 发 ping，设置超时定时器
      this.pongTimer = window.setTimeout(() => {
        console.warn('Pong timeout, disconnecting...')
        this.close()
        onDisconnect()
      }, PONG_TIMEOUT)
      
      this.socket.emit('ping', {}, () => {
        // 收到 pong，清除超时定时器
        if (this.pongTimer !== null) {
          clearTimeout(this.pongTimer)
          this.pongTimer = null
        }
      })
    }, PING_INTERVAL)
  }
  
  close() {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    if (this.pongTimer !== null) clearTimeout(this.pongTimer)
    this.socket?.close()
    this.socket = null
  }
}
```

### 4.3 v2 用到的知识点

1. **心跳保活**：
   - 解决的问题：检测底层 TCP 断开
   - 运行机制：应用层定时发消息，收不到响应就认为断线
   - 项目落点：`ping` 事件 + `pong` 回调
   - 生产误区：只依赖 TCP keepalive（默认 2 小时才检测）
   - 验证方法：拔网线，看是否 30 秒内触发 `onDisconnect`

2. **acknowledgment 回调**：
   - 解决的问题：让客户端知道消息被服务端处理
   - 运行机制：`socket.emit(event, data, callback)`
   - 项目落点：`this.socket.emit('ping', {}, () => {...})`
   - 生产误区：ack 回调有 timeout，超过时长不会执行
   - 验证方法：`console.log` ack 回调执行时间

### 4.4 v2 暴露的痛点

**痛点 1**：断线后不会重连

`onDisconnect` 只是通知业务层，客户端并不会自动重连。用户需要刷新页面。

**痛点 2**：即使 Socket.IO 内置重连，数据也有缺口

Socket.IO 的 `reconnection: true` 会自动重连，但重连期间服务端推送的消息全部丢失。

**痛点 3**：重连后 listener 重复注册

如果业务层在 `reconnect` 事件里再次 `socket.on('metric.created')`，会导致同一消息被处理多次。

---

## 5. v3：生产就绪（重连+去重+快照补偿）

### 5.1 v3 要实现什么

- **问题 1**：断线后不自动重连 → **状态机 + 指数退避**
- **问题 2**：重连期间数据丢失 → **REST 快照补偿**
- **问题 3**：消息重复 → **sequence 去重**
- **问题 4**：重连风暴 → **jitter 抖动**

### 5.2 v3 目录结构

与 §1.4 完全一致。核心新增三层：
- utils 层：`backoff.ts` + `sequence-tracker.ts`（纯函数）
- composable 层：`useConnectionState.ts`（状态机）
- API 层：`metrics-snapshot.ts`（REST 补偿）

### 5.3 v3 完整代码

**src/features/metrics/utils/backoff.ts**

```typescript
/**
 * 指数退避 + jitter
 * @param attempt 第几次重连（从 0 开始）
 * @param baseMs 基础间隔（毫秒）
 * @param maxMs 最大间隔（毫秒）
 * @returns 本次应等待的毫秒数
 */
export function computeBackoff(
  attempt: number,
  baseMs = 1000,
  maxMs = 30000,
): number {
  // 指数增长：base * 2^attempt
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  // Jitter：加 0-50% 的随机抖动
  const jitter = exp * Math.random() * 0.5
  return Math.floor(exp + jitter)
}
```

**src/features/metrics/utils/sequence-tracker.ts**

```typescript
const MAX_SEEN_SIZE = 1000

export interface SequenceTracker {
  seen: Set<number>
  lastSeq: number
  gapDetected: boolean
}

export function createTracker(): SequenceTracker {
  return { seen: new Set(), lastSeq: -1, gapDetected: false }
}

/**
 * 处理新消息
 * @returns 'new' | 'duplicate' | 'gap'
 */
export function track(
  tracker: SequenceTracker,
  seq: number,
): 'new' | 'duplicate' | 'gap' {
  if (tracker.seen.has(seq)) return 'duplicate'
  
  // 内存保护：Set 超过阈值就清理旧的
  if (tracker.seen.size >= MAX_SEEN_SIZE) {
    const toRemove = Array.from(tracker.seen).sort((a, b) => a - b).slice(0, 500)
    toRemove.forEach(s => tracker.seen.delete(s))
  }
  
  tracker.seen.add(seq)
  
  // 缺口检测：新 seq 应该等于 lastSeq + 1
  if (tracker.lastSeq >= 0 && seq > tracker.lastSeq + 1) {
    tracker.gapDetected = true
    tracker.lastSeq = seq
    return 'gap'
  }
  
  tracker.lastSeq = Math.max(tracker.lastSeq, seq)
  return 'new'
}
```

**src/features/metrics/composables/useConnectionState.ts**

```typescript
import { ref, readonly } from 'vue'

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

export function useConnectionState() {
  const state = ref<ConnState>('idle')
  const attempt = ref(0)
  const lastError = ref<string | null>(null)
  
  function transitionTo(next: ConnState, error?: string) {
    // 状态机：定义合法转换
    const validTransitions: Record<ConnState, ConnState[]> = {
      idle: ['connecting'],
      connecting: ['connected', 'failed'],
      connected: ['reconnecting', 'idle'],
      reconnecting: ['connected', 'failed'],
      failed: ['connecting', 'idle'],
    }
    
    if (!validTransitions[state.value].includes(next)) {
      console.warn(`Invalid transition: ${state.value} → ${next}`)
      return false
    }
    
    state.value = next
    if (next === 'reconnecting') attempt.value++
    if (next === 'connected') attempt.value = 0
    if (error) lastError.value = error
    
    return true
  }
  
  return {
    state: readonly(state),
    attempt: readonly(attempt),
    lastError: readonly(lastError),
    transitionTo,
  }
}
```

**frontend/src/features/metrics/api/reliable-ws-client.ts**（v3 完整版）

```ts
import { io, Socket } from 'socket.io-client'
import { calcBackoff } from '../utils/backoff'
import { SequenceTracker } from '../utils/sequence-tracker'

export interface ReliableWsOptions {
  url: string
  serverId: string
  onMetric: (metric: any) => void
  onGap: (gap: { from: number; to: number }) => void
  onStateChange: (state: string) => void
}

export class ReliableWsClient {
  private socket: Socket | null = null
  private heartbeatTimer: number | null = null
  private reconnectTimer: number | null = null
  private tracker = new SequenceTracker()
  private closed = false
  private attempt = 0
  
  constructor(private opts: ReliableWsOptions) {}
  
  connect() {
    if (this.closed) return
    this.opts.onStateChange('connecting')
    
    this.socket = io(this.opts.url, {
      transports: ['websocket'],
      reconnection: false,
    })
    
    this.socket.on('connect', () => {
      this.attempt = 0
      this.opts.onStateChange('connected')
      this.socket!.emit('subscribe', { serverId: this.opts.serverId })
      this.startHeartbeat()
    })
    
    this.socket.on('metric.created', (msg: { sequence: number; data: any }) => {
      const result = this.tracker.accept(msg.sequence)
      if (result.duplicate) return
      if (result.gap) this.opts.onGap(result.gap)
      this.opts.onMetric(msg.data)
    })
    
    this.socket.on('pong', () => { /* keepalive */ })
    
    this.socket.on('disconnect', () => {
      this.stopHeartbeat()
      if (!this.closed) this.scheduleReconnect()
    })
    
    this.socket.on('connect_error', () => {
      if (!this.closed) this.scheduleReconnect()
    })
  }
  
  close() {
    this.closed = true
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.socket?.close()
  }
  
  private startHeartbeat() {
    this.heartbeatTimer = window.setInterval(() => {
      this.socket?.emit('ping')
    }, 30000)
  }
  
  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
  
  private scheduleReconnect() {
    this.attempt++
    const delay = calcBackoff(this.attempt)
    this.opts.onStateChange('reconnecting')
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
  }
  
  getLastSequence() {
    return this.tracker.getLast()
  }
}
```

**frontend/src/features/metrics/composables/useReliableMetrics.ts**（v3 完整版）

```ts
import { onUnmounted, shallowRef } from 'vue'
import { ReliableWsClient } from '../api/reliable-ws-client'
import { fetchMetricsSnapshot } from '../api/metrics-client'

export function useReliableMetrics(serverId: string) {
  const metrics = shallowRef<any[]>([])
  const connectionState = shallowRef<string>('idle')
  
  const client = new ReliableWsClient({
    url: 'http://localhost:3000',
    serverId,
    onMetric: (m) => {
      metrics.value = [...metrics.value, m].slice(-60)
    },
    onGap: async (gap) => {
      // REST 快照补偿
      const snapshot = await fetchMetricsSnapshot(serverId, gap.from, gap.to)
      metrics.value = [...metrics.value, ...snapshot].slice(-60)
    },
    onStateChange: (s) => {
      connectionState.value = s
    },
  })
  
  client.connect()
  
  onUnmounted(() => client.close())
  
  return { metrics, connectionState }
}
```

### 5.4 v3 用到的知识点

1. **至少一次投递（At-Least-Once）**
   - 解决的问题：网络不稳定时保证数据不丢
   - 运行机制：发送方持续重试直到收到 ACK，接收方需要幂等处理重复消息
   - 项目落点：`sequence-tracker.ts` 的 `accept()` 方法用 `Set` 去重
   - 生产误区：只做重试不做去重 → 消息处理 N 次导致数据错乱
   - 验证方法：手动触发重连，检查同一 sequence 是否只处理一次

2. **心跳机制（Heartbeat）**
   - 解决的问题：TCP 半开连接（网络断了但客户端不知道）
   - 运行机制：客户端每 30 秒发 `ping`，服务端回 `pong`；连续 N 次未收到 pong 判定断线
   - 项目落点：`ReliableWsClient` 的 `startHeartbeat()`
   - 生产误区：心跳间隔太短（浪费流量）或太长（发现断线太晚）
   - 验证方法：DevTools Network 面板 → 切换到 Offline，观察多久检测到断线

3. **指数退避 + Jitter**
   - 解决的问题：所有客户端同时重连击垮服务器（雪崩）
   - 运行机制：`delay = min(base × 2^attempt, max) + random(0, jitter)`
   - 项目落点：`backoff.ts` 的 `calcBackoff()`
   - 生产误区：只做退避不加 jitter → 1000 台机器同时在第 8 秒重连
   - 验证方法：单元测试同一 attempt 多次调用返回不同值

4. **Sequence 去重**
   - 解决的问题：至少一次投递导致的重复消息
   - 运行机制：接收方维护已处理的 sequence 集合，重复 sequence 直接丢弃
   - 项目落点：`SequenceTracker.accept()`
   - 生产误区：只用 lastSequence 判断 → 无法处理乱序（sequence 5 → 3 → 4）
   - 验证方法：注入乱序序列 [5, 3, 4, 5, 3]，验证只处理 [3, 4, 5]

5. **缺口检测（Gap Detection）**
   - 解决的问题：服务重启导致 sequence 跳跃（收到 104 → 直接 121）
   - 运行机制：收到 sequence N 时，检查 N - lastSequence > 1 就是缺口
   - 项目落点：`SequenceTracker.accept()` 返回 `gap` 字段
   - 生产误区：忽略缺口 → 图表数据不完整用户以为一切正常
   - 验证方法：模拟 sequence 5 → 10，验证 gap = {from: 6, to: 9}

6. **REST 快照补偿**
   - 解决的问题：缺口检测后需要补齐历史数据
   - 运行机制：发现 gap 后调用 REST API `/metrics?from=X&to=Y` 拉取缺失数据
   - 项目落点：`useReliableMetrics.onGap` 回调
   - 生产误区：补偿数据没有按 sequence 排序 → 图表 x 轴乱序
   - 验证方法：断开 5 秒，恢复后检查 metrics 数组连续无缺口

7. **连接状态机**
   - 解决的问题：连接状态复杂（idle/connecting/connected/reconnecting/failed），随意跳转会导致 UI 闪烁
   - 运行机制：定义合法转换表 `validTransitions`，非法转换报警不执行
   - 项目落点：`useConnectionState.ts`
   - 生产误区：直接用 `state.value = 'x'` → 允许 idle → connected 跳过 connecting
   - 验证方法：单元测试非法转换返回 false

8. **单例监听器（Listener Singleton）**
   - 解决的问题：重连时反复调用 `socket.on('metric.created', fn)` 导致同一事件被处理 N 次
   - 运行机制：客户端销毁旧 socket 才创建新 socket，或者使用 `socket.once` / `socket.off` 清理
   - 项目落点：`ReliableWsClient.connect()` 每次重新创建 socket 实例
   - 生产误区：`this.socket.on()` 在重连回调里累加 → 30 秒 12 次重连后每条消息处理 12 次
   - 验证方法：Chrome DevTools Memory → Detached listeners 应为 0

---

## 6. 三版对比

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| 代码行数 | ~200 | ~400 | ~800 |
| 文件数 | 4 | 6 | 10 |
| 心跳机制 | 无 | 无 | 30 秒 ping-pong |
| 断线重连 | 无 | 无 | 指数退避 + jitter |
| 消息去重 | 无 | 无 | Set + gap 检测 |
| 快照补偿 | 无 | 无 | REST 补缺 |
| 连接状态 | 无 | boolean | 5 态状态机 |
| 单元测试 | 0 | 3 | 15+ |
| 断网恢复 | 手动刷新 | 手动刷新 | 自动 |
| 适用场景 | 演示 | 稳定网络 | 生产 |

### 6.5 前端底子补弱（独立深挖 HTML 入口）

完整的深挖内容见 `Day06深挖-实时可靠性.html`，包含以下 8 个深挖主题：

1. **深挖 1**：TCP 半开连接 —— 从今天项目里的心跳超时讲起
2. **深挖 2**：指数退避与雪崩效应 —— 从今天项目里的 `calcBackoff` 讲起
3. **深挖 3**：至少一次 / 最多一次 / 恰好一次 —— 从今天项目里的 sequence 去重讲起
4. **深挖 4**：幂等设计 —— 从今天项目里的 `SequenceTracker` 讲起
5. **深挖 5**：连接状态机 —— 从今天项目里的 `useConnectionState` 讲起
6. **深挖 6**：Listener 泄漏 —— 从今天项目里的重连 listener 累加讲起
7. **深挖 7**：Page Visibility API —— 从今天项目里的后台标签页断连讲起
8. **深挖 8**：CAP 定理 —— 从今天项目里的最终一致性讲起

---

## 7. 项目验收清单（阶段 E-F，约 120 分钟）

### 7.6 E：写核心逻辑单元测试（60 分钟）

**frontend/src/features/metrics/utils/backoff.spec.ts**

```ts
import { describe, it, expect } from 'vitest'
import { calcBackoff } from './backoff'

describe('calcBackoff', () => {
  it('第 1 次重连延迟在 1-2 秒之间', () => {
    for (let i = 0; i < 100; i++) {
      const d = calcBackoff(1)
      expect(d).toBeGreaterThanOrEqual(1000)
      expect(d).toBeLessThanOrEqual(2000)
    }
  })
  
  it('延迟指数增长', () => {
    expect(calcBackoff(1, { jitter: 0 })).toBe(1000)
    expect(calcBackoff(2, { jitter: 0 })).toBe(2000)
    expect(calcBackoff(3, { jitter: 0 })).toBe(4000)
  })
  
  it('封顶不超过 max', () => {
    expect(calcBackoff(20, { jitter: 0 })).toBeLessThanOrEqual(30000)
  })
  
  it('jitter 产生随机差异', () => {
    const values = new Set()
    for (let i = 0; i < 10; i++) values.add(calcBackoff(3))
    expect(values.size).toBeGreaterThan(1)
  })
})
```

**frontend/src/features/metrics/utils/sequence-tracker.spec.ts**

```ts
import { describe, it, expect } from 'vitest'
import { SequenceTracker } from './sequence-tracker'

describe('SequenceTracker', () => {
  it('第一条消息不产生 gap', () => {
    const t = new SequenceTracker()
    expect(t.accept(1)).toEqual({ duplicate: false })
  })
  
  it('连续序列不产生 gap', () => {
    const t = new SequenceTracker()
    t.accept(1); t.accept(2)
    expect(t.accept(3)).toEqual({ duplicate: false })
  })
  
  it('重复序列返回 duplicate=true', () => {
    const t = new SequenceTracker()
    t.accept(1); t.accept(2)
    expect(t.accept(2)).toEqual({ duplicate: true })
  })
  
  it('跳跃序列产生 gap', () => {
    const t = new SequenceTracker()
    t.accept(1)
    expect(t.accept(5)).toEqual({
      duplicate: false,
      gap: { from: 2, to: 4 },
    })
  })
  
  it('乱序不影响去重', () => {
    const t = new SequenceTracker()
    t.accept(5); t.accept(3)
    expect(t.accept(5)).toEqual({ duplicate: true })
    expect(t.accept(3)).toEqual({ duplicate: true })
  })
})
```

### 7.7 F-1：反证实验 1（15 分钟）

**目标**：证明没有 sequence 去重时，重连会导致消息重复处理

**步骤**：
1. 注释掉 `SequenceTracker.accept` 里的重复检查
2. Chrome DevTools Network → Offline 5 秒 → Online
3. 观察 `metrics` 数组

**预期**：同一 sequence 出现多次，图表出现重复数据点

**修正**：恢复注释，验证 metrics 无重复

### 7.8 F-2：反证实验 2（15 分钟）

**目标**：证明没有指数退避时，重连雪崩

**步骤**：
1. 把 `calcBackoff` 改为固定返回 100
2. 启动 100 个浏览器 tab
3. 后端断开 5 秒后恢复
4. 观察后端 CPU 和连接建立日志

**预期**：所有 100 个 tab 同时重连，后端瞬时压力峰值

**修正**：恢复指数退避 + jitter，重连负载平滑分布

### 7.9 F-3：验证 + 提交（30 分钟）

```bash
cd frontend
pnpm typecheck && pnpm lint && pnpm test && pnpm build

cd ../backend
pnpm typecheck && pnpm lint && pnpm test && pnpm build

git add frontend/src/features/metrics/
git add backend/src/metrics/
git commit -m "feat(metrics): add heartbeat, reconnect, sequence dedup

Refs: Day6"
```

**注意**：不要执行 `git push`，等手动推。

---

## 8. 通过标准（v3 自检清单）

| 编号 | 检查项 | 通过标准 |
|---|---|---|
| 1 | 心跳机制 | 30 秒 ping-pong，超时判定断线 |
| 2 | 指数退避 | `calcBackoff(n)` 单元测试通过 |
| 3 | Jitter | 同 attempt 多次调用值不同 |
| 4 | Sequence 去重 | 重复消息不处理 |
| 5 | Gap 检测 | 跳跃序列返回 gap 字段 |
| 6 | REST 补偿 | onGap 回调调用 fetchMetricsSnapshot |
| 7 | 状态机 | 5 态转换合法性验证 |
| 8 | 单例 listener | 重连不累加 listener |
| 9 | 断网恢复 | Chrome Offline 30 秒后自动恢复 |
| 10 | 后台标签页 | 切回前台连接可用 |

---

## 9. 提交物

1. **代码**：前后端 `git diff HEAD~1` 输出（约 800 行）
2. **测试截图**：`pnpm test` 输出（至少 15 个测试全绿）
3. **故障注入记录**：断网、服务重启、后台标签页三种场景的恢复时间
4. **学习日志**：回答 §10 的 3 个核心问题
5. **架构证据**：状态机转换图 + 恢复时序图

---

## 10. 课末 3 个核心问题

1. **请从今天项目的真实入口到最终输出，解释"实时可靠性"的数据流或控制流；当天知识链"至少一次投递、心跳、退避+jitter、sequence、快照补偿"分别在哪一层起作用，为什么按这个顺序学习？**

   参考答案框架：
   - 入口：`useReliableMetrics(serverId)`
   - 至少一次投递：底层假设（网络会丢包，必须重试）
   - 心跳：`startHeartbeat` 检测 TCP 半开连接
   - 退避+jitter：`calcBackoff` 避免雪崩
   - sequence：`SequenceTracker` 处理重复和乱序
   - 快照补偿：`onGap` 回调用 REST 补缺
   - 顺序：底层假设 → 检测断线 → 平滑重连 → 处理重复 → 补齐缺口

2. **如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。**

   参考答案框架：
   - 移除机制：删除 SequenceTracker
   - 可观察现象：重连后同一数据点在图表上出现 N 次
   - 最小复现：Chrome Offline 5 秒 → Online
   - 定位证据：`console.log(metrics.value.map(m => m.sequence))` 出现重复
   - 恢复动作：加回 SequenceTracker
   - 防复发测试：`sequence-tracker.spec.ts` 的重复消息测试

3. **请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。**

   参考答案框架：
   - 代码证据：`ReliableWsClient` 的 `startHeartbeat/scheduleReconnect`
   - 测试证据：`backoff.spec.ts` 和 `sequence-tracker.spec.ts` 共 15+ 用例
   - 架构证据：状态机转换图
   - 缺少功能：消息持久化（离线队列）、优先级重试、分布式追踪
   - 下一步：Day 15 加历史恢复，接口不变（新增 REST 端点）

---

## 11. 真实项目情境题（联网更新 2026-07-16）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

### 情境题 1：网络抖动导致 listener 累加

**背景**：网络抖动使客户端 30 秒内重连 12 次，每次都新增 listener，同一 sequence 被处理 12 次。

**任务**：
用连接状态、listener 计数和重复事件日志定位；先关闭自动重连并刷新快照止损，再实现指数退避+jitter、单例监听和 sequence 去重，注入断网验证事件只生效一次。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - 加 `console.log('sequence', msg.sequence, 'total handlers')`
   - Chrome DevTools Memory → 查 Detached listeners
   - 日志：sequence 100 → handled 12 times

2. **临时止损**：
   - 关闭 `socket.reconnection`
   - 用 REST 全量拉取快照

3. **根因修复**：
   - 用 `SequenceTracker` 去重
   - 每次重连销毁旧 socket，创建新 socket
   - 加 `calcBackoff` 平滑重连

4. **回归验证**：
   - `sequence-tracker.spec.ts` 重复消息测试
   - 手动 Chrome Offline 30 秒验证

**依据**：[Socket.IO Reconnection](https://socket.io/docs/v4/client-options/#reconnection)

### 情境题 2：服务重启导致 sequence 跳跃

**背景**：服务重启造成 sequence 105-120 丢失，客户端从 104 直接收到 121，图表却显示"连接正常"。

**任务**：
用 lastSequence、REST 快照版本和连接时序定位缺口；先标记数据陈旧止损，再实现心跳、缺口检测和快照补偿，并在断网、后台标签页、服务重启组合下验证 RTO 与最终一致性。

**回答框架（定位证据 → 临时止损 → 根因修复 → 回归验证）**：

1. **定位证据**：
   - `SequenceTracker.accept(121)` 返回 gap: {from: 105, to: 120}
   - 后端日志显示服务在 T=10s 重启

2. **临时止损**：
   - UI 显示"数据可能不完整"提示
   - 允许用户手动刷新

3. **根因修复**：
   - `onGap` 回调调用 REST `/metrics?from=105&to=120`
   - 补齐数据后按 sequence 排序合并

4. **回归验证**：
   - 集成测试：kill 后端 3 秒 → 恢复 → 验证 metrics 连续
   - RTO ≤ 5 秒

**依据**：[MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

**知识映射**：至少一次投递、心跳、退避、sequence 去重和 REST 快照恢复。

---

## 12. PDF 面试题

> **说明**：以下题目来自 PDF 资源文件，文件名用于教学分类，不等于官方题库或真实面试题来源。题目构造用于教学练习。

### 题目 1：如何实现支持"多轮对话中断"和"重新生成"的状态机？

**来源**：《2026MiNiMax前端AI开发》第 6 页

**初级答法**：
- 定义状态：idle / streaming / interrupted / completed
- 用 useState 管理状态

**中级答法**：
- 定义合法转换表，非法转换报警
- interrupted 状态保留部分响应
- 重新生成时清空历史，回到 streaming

**高级答法（关联今天项目）**：
- 类似今天的 `useConnectionState`
- 中断时保存 lastSequence
- 重新生成时从 lastSequence + 1 继续
- 加 AbortController 保证中断的旧请求不污染新状态

### 题目 2：手写一个处理流式数据且支持中途取消的 useStream

**来源**：《2026MiNiMax前端AI开发》第 7 页

**思路**：
```ts
function useStream(url: string) {
  const data = ref('')
  const controller = new AbortController()
  
  const start = async () => {
    const res = await fetch(url, { signal: controller.signal })
    const reader = res.body!.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      data.value += new TextDecoder().decode(value)
    }
  }
  
  const cancel = () => controller.abort()
  
  onUnmounted(cancel)
  
  return { data, start, cancel }
}
```

**关联今天项目**：
- 类似 `ReliableWsClient.close()` 的清理逻辑
- 都用 AbortController 或类似机制取消
- 都在 `onUnmounted` 里清理

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。

五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

**示例问题方向**（实际问题会根据学生的 diff 调整）：

1. **演示验收**：请演示 Chrome Offline 30 秒后自动恢复，并展示 metrics 数组无重复无缺口。
2. **核心挑战**：Day06 最难的是什么？你卡在哪里最久？
3. **对比思考**：如果不加 jitter 只加指数退避会怎样？
4. **项目对手戏**：Day 15 要做历史数据恢复，会复用今天的哪部分逻辑？
5. **知识盲区**：Socket.IO 内置的 reconnection 为什么不用？你的实现和它的区别？

---

## 14. 本 Day 在 90 天路线中的锚点

**向前承接**：
- Day 3：AbortController 取消机制（复用到 ReliableWsClient.close）
- Day 5：Socket.IO 房间机制（v3 继续使用）

**向后传递**：
- Day 7：异常检测算法在稳定的数据流上运行
- Day 15：历史恢复复用 REST 快照补偿模式
- Day 30：分布式场景下的最终一致性

**复用点**：
- `calcBackoff` 会在所有需要重试的场景复用（HTTP 请求、任务队列）
- `SequenceTracker` 的去重模式会在 Kafka 消费者场景复用
- 状态机模式会在 Day 20 的 Agent 状态管理复用

**螺旋上升**：
- Day 3 在单个请求上练习取消
- Day 5 在连接上练习订阅
- Day 6 在数据流上练习可靠性
- Day 15 在历史数据上扩展可靠性（分页恢复）

---

**完成 Day 6 后，你已经掌握**：
- 心跳检测 TCP 半开连接
- 指数退避 + jitter 避免雪崩
- Sequence 去重处理重复消息
- Gap 检测触发 REST 快照补偿
- 5 态连接状态机
- 单例 listener 避免累加

**下一步 Day 7**：在稳定的数据流上加异常检测算法（Z-Score / 移动平均），实时标注异常点。

