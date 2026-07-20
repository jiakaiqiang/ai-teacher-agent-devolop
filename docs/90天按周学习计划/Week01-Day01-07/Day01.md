# Day 01：Agent 运行时展示面板（v1 → v2 → v3 三版演进）

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day01.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

任务版本：标准版
日期与时长：2026-07-14 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\frontend`
角色视角：有 Vue 中后台经验、第一次为 Agent 场景搭前端的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + Python/FastAPI + RAG）

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 1 处在阶段一起点**，任务是搭建 `p1-monitor` 前端里第一个功能模块——**Agent 运行时展示面板**。这个面板会被后面 Day 5（WebSocket）、Day 14（SSE 升级）、Day 15（历史恢复）、Day 17（审批交互）反复扩展。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/frontend` 里交付一个组件 **`AgentRunPanel`**：当后端 Agent 执行一次诊断时，把它的执行过程（模型说了什么、调了什么工具、要不要用户批准、成功还是失败）实时展示给运维工程师。

### 1.1 用户能看到什么

浏览器里能看到一个面板，从上到下依次滚动出现：

```
┌────────────────────────────────────────────────┐
│  诊断执行  状态：awaiting-approval             │
├────────────────────────────────────────────────┤
│  • 模型输出                                    │
│    正在检查服务器 srv-042 的 CPU 指标...       │
│                                                │
│  • 调用工具：read_metrics                      │
│    参数：last 10min                            │
│    完成 (1800ms)：CPU 平均 87%，异常           │
│                                                │
│  • 模型输出                                    │
│    检测到 CPU 持续过载，建议重启异常进程       │
│                                                │
│  • 等待审批：restart_process                   │
│    风险级别：high                              │
│    [ 批准 ]  [ 拒绝 ]                          │
└────────────────────────────────────────────────┘
```

### 1.2 这个模块在项目里承担什么

- **输入**：一段 `AgentEvent[]`（今天先用 fixture 假数据，Day 5 换成 WebSocket 真事件）；
- **输出**：一个 Vue 组件，把事件流渲染成用户可读的时间线；
- **对齐后续**：今天定义的**事件类型**和**状态模型**，是 Day 2-17 前端主线都要遵守的合同。

### 1.3 三版演进的目标

同一个"Agent 运行时展示"功能，本教程给三个版本。每一版都能跑起来，功能一版比一版多，代码结构一版比一版正规：

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | 只展示**模型的文本输出** | 单组件、几个 `ref` | Vue 响应式、事件流 vs 请求-响应 |
| **v2** | v1 + **工具调用** + **审批** | 组合式函数、TypeScript 类型、事件数组 | 判别联合、事件形状、组件内 computed 归约 |
| **v3** | v2 + **错误** + **完成** + **取消** + **边界处理** | 分层架构（domain + features）、纯 reducer、状态机 | 状态机、reducer、终态保护、exhaustive check、UI 依赖倒转 |

**用户最终在项目里交付的是 v3**（也就是完整版）。v1 和 v2 是**教程用的过渡版本**，让你看清"为什么最终代码要长成 v3 那样"——每一步重构都在解决前一版的具体痛点。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架，再往里面填内容。骨架决定了每个知识点会落在哪个文件、哪一层。看完这棵树，下面章节里再出现 `src/domain/agent/agent-event.ts` 时，你就能立刻定位它在项目中的位置。

**今天在 `p1-monitor/frontend/` 下要建立的完整前端源码树（v3 完整版）**：

```
src/
├── domain/                             ← 领域层（纯类型 + 纯逻辑，不依赖 Vue）
│   └── agent/
│       ├── agent-event.ts              ← 事件类型（9 种事件的判别联合 + RunId branded type + assertNever）
│       ├── agent-run-state.ts          ← 状态类型 + 初始状态 + 纯函数 reducer
│       └── agent-run-state.spec.ts     ← reducer 单元测试（vitest，纯函数 → 无需 mock DOM）
├── features/                           ← 功能层（依赖 domain + Vue）
│   └── agent-run/
│       ├── ui/AgentRunPanel.vue        ← 只接 state prop 的展示组件（无副作用）
│       └── fixtures/sample-run.ts     ← 假事件序列（未来 WebSocket / SSE 的替身）
├── composables/
│   └── useAgentRun.ts                  ← 把事件源 + reducer 粘合成 Vue 响应式 state（v2 起引入）
└── App.vue                             ← 编排层：拉 fixture → reduce → 传给 Panel
```

**三版演进对应的文件差异**：

| 版本 | 建的文件 | 不建的文件 |
|---|---|---|
| **v1** | `App.vue`（全部塞这一个） | 其余都不建 |
| **v2** | `App.vue` + `composables/useAgentRun.ts` + 内联的 `AgentEvent` 类型 | 还没拆 `domain/` 和 `features/` |
| **v3** | 完整树（上图 5 个源码文件 + 1 个测试文件） | —— |

**依赖方向（务必单向，反过来一次都不行）**：

```
App.vue → composables/useAgentRun.ts → features/agent-run/ → domain/agent/
                                       features/agent-run/fixtures/ → domain/agent/
```

**红线**：`domain/agent/*.ts` 里出现 `import { ref } from 'vue'` 就是架构塌方的第一步。domain 必须能在纯 Node 里跑起来、跑测试。

**动手前先问自己 3 个问题**（答不上就带着问题往下读 v1 → v2 → v3）：

1. `domain/` 和 `features/` 为什么必须分开？—— 见 v3 的第 5.4 节「层与依赖方向」。
2. `agent-event.ts` 为什么放在 `domain/` 而不是 `features/agent-run/`？—— 因为事件类型是前后端合同，不属于 UI 特性。
3. `fixtures/sample-run.ts` 存在的意义是什么？为什么不直接接 WebSocket？—— 见 v3 的第 5.6 节「fixture 作为传输层替身」。

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

**为什么放在正文前面**：下面第 3-6 节以及 `Day01深挖-前端底子补弱.html` 都在讲"代码为什么这么写"。如果你手上没有一个能跑起来的项目，代码讲得再深也只是纸上谈兵。先用 20 分钟把 v3 骨架立起来、能在浏览器里跑，再回过头读代码解释才有感觉；写 reducer 测试和反证实验也才有地方放。

**动手节奏建议**：本节 1.5.1-1.5.5 快速过一遍（20 分钟） → 读第 2-6 节正文 + 深挖 HTML（约 120 分钟） → 到第 7 节做测试 + 反证 + 验收（60 分钟）。

### 1.5.1 D-1：搭工程骨架（10 分钟）

```powershell
# 检查工作区状态
git -C D:\demo\ai-techer status --short
Test-Path D:\demo\ai-techer\p1-monitor\frontend

# 如果 frontend 不存在，创建它
Set-Location D:\demo\ai-techer\p1-monitor
pnpm create vite frontend --template vue-ts
Set-Location frontend
pnpm install
pnpm add -D vitest @vue/test-utils jsdom
```

在 `vite.config.ts` 加 alias：

```typescript
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

在 `package.json` 里补 scripts：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint . --ext .ts,.vue"
  }
}
```

### 1.5.2 D-2：创建目录（2 分钟）

按 §1.4 目录树建目录（此时先建空目录，文件在 1.5.3-1.5.5 里逐个填上）：

```
src/
├── domain/agent/
├── features/agent-run/ui/
└── features/agent-run/fixtures/
```

### 1.5.3 D-3：实现 domain 层（20 分钟）

按第 5.3 节的代码：

- 写 `src/domain/agent/agent-event.ts`；
- 写 `src/domain/agent/agent-run-state.ts`。

**边写边问自己**：

- `RunId` 为什么要 branded type？（防止手滑把普通 string 传进去）
- `EventMeta` 里为什么要有 `sequence`？（去重和排序）
- 规则 A 和规则 B 谁先谁后？（先去重再判终态，反过来的话终态收到重复事件会走进 return state 但又更新了 lastSequence——实际两条规则都会短路返回 state，谁先谁后不影响正确性，但 sequence 去重放在最前面语义上最清晰）

### 1.5.4 D-4：实现 features 层（15 分钟）

- 写 `src/features/agent-run/ui/AgentRunPanel.vue`；
- 写 `src/features/agent-run/fixtures/sample-run.ts`。

### 1.5.5 D-5：接入 App.vue（10 分钟）

按第 5.3 节改 `src/App.vue`。

```powershell
pnpm dev
```

浏览器打开 `http://localhost:5173`，观察：

- 徽章依次显示 `running` → `running` → `awaiting-approval`；
- 时间线依次冒出：文本 → 工具调用（开始）→ 工具卡片更新为"完成 1800ms" → 文本 → 审批。

看到这个画面就说明 v3 已经跑起来了。**卡住不要死磕**：先跳过继续读第 2-6 节正文，读完再回来调试；测试和反证实验放到第 7 节做。

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 类型 |
|---|---|---|---|
| A | 30 分钟 | 阅读第 3 节（v1 教程） | 阅读 |
| B | 30 分钟 | 阅读第 4 节（v2 教程） | 阅读 |
| C | 30 分钟 | 阅读第 5 节（v3 教程） | 阅读 |
| D | 60 分钟 | 在自己项目里实现 v3 完整功能 | 动手 |
| E | 20 分钟 | 写 reducer 测试 + 两个反证实验 | 动手 |
| F | 10 分钟 | 运行 lint/typecheck/test/build，提交 commit | 动手 |

前 90 分钟只读、不写；后 90 分钟只写、不读。**中途遇到不懂的先跳过、别停下**，读完 v3 你会发现前面卡住的地方多半是"没看到全景"造成的。

---

## 3. v1：只展示模型的文本输出

### 3.1 v1 要实现什么

只做一件事：Agent 后端会一段一段地吐出文本（就像 ChatGPT 打字机效果），前端把它们**按顺序拼接**并展示出来。

**用户看到**：一段文字慢慢冒出来，每次追加一小段。

**技术上要处理**：

- 接收多次 `text.delta` 事件（每次带一小段文字）；
- 收到 `run.started` 时把状态从"空闲"切到"运行中"；
- 收到 `run.finished` 时把状态切到"完成"。

### 3.2 v1 完整代码

**src/App.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'

// 你熟悉的 Vue 响应式：几个 ref 描述 UI 状态
const status = ref<'idle' | 'running' | 'completed'>('idle')
const text = ref('')

// 假的事件流：一秒后开始，然后每 300ms 追加一段文字，最后完成
function startFakeRun() {
  status.value = 'running'
  text.value = ''

  const chunks = [
    '正在检查服务器 srv-042 的 CPU 指标...',
    '\n\n最近 10 分钟平均 CPU 为 87%，超过阈值。',
    '\n\n建议进一步排查异常进程。',
  ]

  chunks.forEach((chunk, i) => {
    setTimeout(() => {
      text.value += chunk  // 追加到已有文本后面
      if (i === chunks.length - 1) {
        status.value = 'completed'
      }
    }, (i + 1) * 800)
  })
}
</script>

<template>
  <section>
    <header>
      <h2>诊断执行</h2>
      <output :data-status="status">{{ status }}</output>
    </header>

    <button @click="startFakeRun" :disabled="status === 'running'">
      开始诊断
    </button>

    <p style="white-space: pre-wrap;">{{ text }}</p>
  </section>
</template>

<style scoped>
output[data-status='running'] { color: orange; }
output[data-status='completed'] { color: green; }
</style>
```

### 3.3 v1 用到的知识点

**知识点 1：Agent 的输出是"事件流"，不是"请求-响应"**

你熟悉的 axios 是这样：

```typescript
const data = await axios.get('/api/report')  // 一次调用 → 一个完整结果
```

Agent 不一样：

```
后端逐步产生事件：
  t=0ms   → run.started
  t=800ms → text.delta("正在检查...")
  t=1600ms → text.delta("最近 10 分钟...")
  t=2400ms → text.delta("建议进一步...")
  t=2400ms → run.finished
```

前端不能等所有事件到齐再渲染，必须**每来一个就更新一次 UI**。v1 用 `text.value += chunk` 就是这个思路的最小体现。

**知识点 2：用响应式 `ref` 承接流式增量**

Vue 3 的 `ref` 天然适合这种场景：`text.value += chunk` 修改后，模板里的 `{{ text }}` 会自动重新渲染。这是从"一次性拿到 data 再显示"到"数据到一点显示一点"的第一步。

### 3.4 v1 暴露的痛点（引出 v2）

v1 只处理了 `text.delta`。但真实的 Agent 还会：

- 调用工具（比如"读取 CPU 指标"）；
- 等待你批准某个高风险操作；
- 可能失败。

如果继续用 v1 的写法，你会发现要不断加 `ref`：

```typescript
const status = ref(...)
const text = ref(...)
const isCallingTool = ref(false)
const currentToolName = ref('')
const toolResult = ref('')
const isWaitingApproval = ref(false)
const approvalAction = ref('')
// ...
```

而且事件之间**没有顺序**——`text` 和"工具调用"发生的先后关系丢了。用户看到的时间线会乱。

v2 要解决这两个问题。

---

## 4. v2：加工具调用 + 审批（引入判别联合）

### 4.1 v2 要实现什么

在 v1 基础上，额外支持：

- **工具调用卡片**：显示 Agent 调用了什么工具、参数是什么、结果是什么、耗时多少；
- **审批提示**：显示"Agent 想执行 XX 高风险操作，需要你批准"（今天只做展示，交互留给 Day 17）；
- **保留时间顺序**：文本和工具卡片在页面上按发生顺序排列。

**用户看到**：混排的时间线——文本段、工具卡片、审批提示按时间先后垂直排列。

### 4.2 v2 完整代码

**src/composables/useAgentRun.ts**（新增）

```typescript
import { ref, computed } from 'vue'

// 事件类型：用判别联合精确描述每种事件的形状
// 判别联合 = 用一个共同字段（type）作为"标签"，
// TypeScript 会根据 type 的值自动收窄其他字段的类型
export type AgentEvent =
  | { type: 'run.started' }
  | { type: 'text.delta'; text: string }
  | { type: 'tool.started'; callId: string; toolName: string; args: string }
  | { type: 'tool.succeeded'; callId: string; result: string; durationMs: number }
  | { type: 'approval.required'; approvalId: string; action: string; risk: 'low' | 'medium' | 'high' }
  | { type: 'run.finished' }

// UI 时间线上要渲染的每一项
export type TimelineItem = {
  key: string
  kind: 'text' | 'tool' | 'approval'
  title: string
  detail?: string
}

export function useAgentRun() {
  // 所有收到的事件，按顺序存起来
  const events = ref<AgentEvent[]>([])

  // 从事件流算出当前状态（computed 会缓存，事件变了才重算）
  const status = computed<'idle' | 'running' | 'awaiting-approval' | 'completed'>(() => {
    if (events.value.length === 0) return 'idle'
    const last = events.value[events.value.length - 1]
    if (last.type === 'run.finished') return 'completed'
    if (last.type === 'approval.required') return 'awaiting-approval'
    return 'running'
  })

  // 从事件流算出时间线（同样按顺序）
  const timeline = computed<TimelineItem[]>(() => {
    const items: TimelineItem[] = []

    events.value.forEach((event, index) => {
      switch (event.type) {
        case 'text.delta':
          // 注意：TS 在这里知道 event 一定是 { type: 'text.delta'; text: string }
          // 写 event.text 有类型提示，写 event.toolName 会报错
          items.push({
            key: `text-${index}`,
            kind: 'text',
            title: '模型输出',
            detail: event.text,
          })
          break

        case 'tool.started':
          items.push({
            key: `tool-${event.callId}`,
            kind: 'tool',
            title: `调用工具：${event.toolName}`,
            detail: `参数：${event.args}`,
          })
          break

        case 'tool.succeeded':
          // 通过 callId 找到对应的 tool 卡片，更新它的 detail
          // 这就是"事件关联"：succeeded 事件和 started 事件通过 callId 关联
          const existing = items.find((item) => item.key === `tool-${event.callId}`)
          if (existing) {
            existing.detail = `完成 (${event.durationMs}ms)：${event.result}`
          }
          break

        case 'approval.required':
          items.push({
            key: `approval-${event.approvalId}`,
            kind: 'approval',
            title: `等待审批：${event.action}`,
            detail: `风险级别：${event.risk}`,
          })
          break

        // run.started / run.finished 不产生时间线项，只影响 status
        case 'run.started':
        case 'run.finished':
          break
      }
    })

    return items
  })

  function pushEvent(event: AgentEvent) {
    events.value.push(event)
  }

  return { status, timeline, pushEvent }
}
```

**src/App.vue**（改造）

```vue
<script setup lang="ts">
import { useAgentRun, type AgentEvent } from './composables/useAgentRun'

const { status, timeline, pushEvent } = useAgentRun()

// 假事件序列
const fakeEvents: AgentEvent[] = [
  { type: 'run.started' },
  { type: 'text.delta', text: '正在检查服务器 srv-042 的 CPU 指标...' },
  { type: 'tool.started', callId: 'c1', toolName: 'read_metrics', args: 'last 10min' },
  { type: 'tool.succeeded', callId: 'c1', result: 'CPU 平均 87%，异常', durationMs: 1800 },
  { type: 'text.delta', text: '检测到 CPU 持续过载，建议重启异常进程。' },
  { type: 'approval.required', approvalId: 'a1', action: 'restart_process', risk: 'high' },
]

function startFakeRun() {
  fakeEvents.forEach((event, i) => {
    setTimeout(() => pushEvent(event), (i + 1) * 700)
  })
}
</script>

<template>
  <section>
    <header>
      <h2>诊断执行</h2>
      <output :data-status="status">{{ status }}</output>
    </header>

    <button @click="startFakeRun" :disabled="status !== 'idle' && status !== 'completed'">
      开始诊断
    </button>

    <ol>
      <li v-for="item in timeline" :key="item.key" :data-kind="item.kind">
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail" style="white-space: pre-wrap;">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>
```

### 4.3 v2 用到的知识点

**知识点 3：判别联合（Discriminated Union）——用类型描述"多种可能形状"**

在 v1 里，事件只有 `text.delta` 一种，直接用一个 `string` 就够了。到了 v2，事件有 6 种，每种带的字段都不一样：

```typescript
{ type: 'text.delta', text: '...' }
{ type: 'tool.started', callId: '...', toolName: '...', args: '...' }
{ type: 'approval.required', approvalId: '...', action: '...', risk: 'high' }
```

如果你写成 `{ type: string, data: any }`，TS 检查不出任何错误：

```typescript
type BadEvent = { type: string; data: any }
function handle(e: BadEvent) {
  if (e.type === 'tool.stared') {  // 拼错了 → TS 不报错
    console.log(e.data.tolName)    // 字段拼错 → TS 不报错
  }
}
```

判别联合就是让 TS 知道**这个字段等于这个值时，其他字段一定长什么样**：

```typescript
type AgentEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool.started'; callId: string; toolName: string; args: string }
  //   ↑ type 字段是"判别符"，值不同 → 其他字段就不同

function handle(e: AgentEvent) {
  if (e.type === 'text.delta') {
    console.log(e.text)        // ✓ TS 知道有 text
    console.log(e.toolName)    // ✗ 编译错误：text.delta 没有 toolName
  }
}
```

**知识点 4：通过共同字段关联事件——`callId`**

`tool.started` 和 `tool.succeeded` 是两个独立事件，可能中间还夹着其他事件。它们通过 `callId` 关联：

```
tool.started    { callId: 'c1', toolName: 'read_metrics' }
text.delta      { text: '正在读取...' }
tool.succeeded  { callId: 'c1', result: '87%' }
                   ↑ 用同一个 callId 找到上面的 tool 卡片
```

v2 的 `timeline` computed 里，`items.find(item => item.key === 'tool-' + event.callId)` 就是在做这个关联。

**知识点 5：用 `computed` 从"事件流"派生"UI 状态"**

v1 的做法是收到事件时直接改 UI 状态（`text.value += chunk`）。v2 的做法是**只把事件塞进 `events` 数组，UI 状态用 computed 从事件流算出来**：

```
events （原始数据，只增不改）
  ↓ computed
status（UI 用的当前阶段）
timeline（UI 用的时间线）
```

好处：`events` 永远保留完整历史，任何时候都能重新算出 UI 状态。如果哪天要"回放"这段执行，把 `events` 从头喂一遍就能复现——这是 v3 的 reducer 思想的雏形。

### 4.4 v2 暴露的痛点（引出 v3）

**痛点 1：归约逻辑塞在 composable 的 computed 里，没法单独测试**

`timeline` 是个 computed，测试它要装载 Vue、创建组件实例、mock 响应式系统。而 v3 的 reducer 是**纯函数**，`expect(reduce(state, event)).toEqual(...)` 就能直接测。

**痛点 2：`status` 只看"最后一个事件"，遇到乱序/重复就错**

v2 的 status 判断是：

```typescript
const last = events.value[events.value.length - 1]
if (last.type === 'run.finished') return 'completed'
if (last.type === 'approval.required') return 'awaiting-approval'
```

如果网络乱序，`run.finished` 先到、`approval.required` 后到：

```
events = [run.started, ..., run.finished, approval.required]
             ↑ 最后一个是 approval.required
             → status 显示 awaiting-approval
             → 但实际上 run 已经结束了
```

**用户会看到"已经完成的 Run 却在等待批准"这种不可能状态。**

**痛点 3：没有 `run.failed` / `run.cancelled` / `tool.failed`，也没有"事件序号去重"**

真实 Agent 可能：

- 中途报错（`run.failed`）；
- 被用户取消（`run.cancelled`）；
- 工具执行失败（`tool.failed`）；
- 网络重发导致同一个事件收到两次。

v2 都没处理。加上这些之后，if-else 组合会爆炸——**必须引入状态机**。

**痛点 4：`AgentEvent` 类型和 UI 组件强耦合在同一个 composable 里**

Day 2 要给事件加运行时校验，Day 5 要接 WebSocket，Day 14 要升级到 SSE v1——每次都要动这个 composable。v3 会把类型、状态、UI 分成三层，让每一层独立演进。

---

## 5. v3：加错误 + 完成 + 取消 + 边界处理（引入状态机 + reducer + 分层）

### 5.1 v3 要实现什么

在 v2 基础上，额外支持：

- **完整的 Run 生命周期**：`run.started` → `running` → `completed` / `failed` / `cancelled`；
- **工具失败**：`tool.failed` 事件显示在对应的 tool 卡片上；
- **乱序、重复事件的正确处理**：通过 `sequence` 字段去重；
- **终态保护**：Run 结束后再来事件必须被忽略；
- **可测试**：核心归约逻辑是纯函数，能直接单元测试；
- **可演进**：类型、状态、UI 分层，Day 2-17 每一层独立扩展。

**用户看到**：任何事件序列（正常、乱序、重复、失败、取消）都能得到确定的、正确的 UI 表现。

### 5.2 v3 目录结构

```
src/
├── domain/                          ← 领域层（纯类型 + 纯逻辑，不依赖 Vue）
│   └── agent/
│       ├── agent-event.ts           ← 事件类型（v2 的 AgentEvent 升级版）
│       ├── agent-run-state.ts       ← 状态类型 + 初始状态 + reducer
│       └── agent-run-state.spec.ts  ← reducer 单元测试
├── features/                        ← 功能层（依赖 domain + Vue）
│   └── agent-run/
│       ├── ui/AgentRunPanel.vue     ← 只接 state prop 的展示组件
│       └── fixtures/sample-run.ts   ← 假事件序列（未来 WebSocket 的替身）
└── App.vue                          ← 把 fixture reduce 后传给 Panel
```

**为什么这么分层**：

- **domain 层**：不依赖 Vue、不依赖任何框架，可以在 Node 里直接跑测试。事件类型和 reducer 都属于业务规则，不属于 UI。
- **features 层**：只依赖 domain，通过 props 消费 state。换成 Pinia Store、换成 SSE 事件源、换成 fixture，UI 组件都不用改。
- **App.vue**：只做"事件源和 UI 的粘合"。

### 5.3 v3 完整代码

**src/domain/agent/agent-event.ts**

```typescript
// runId 是字符串，但用 branded type 区分它和普通 string，避免手滑传错
export type RunId = string & { readonly __brand: 'RunId' }

// 所有事件共享的元数据字段
type EventMeta = {
  runId: RunId
  sequence: number         // 全局递增的序号，用于去重和排序
  occurredAt: string       // ISO 时间戳
}

// 九种事件的完整判别联合
export type AgentEvent =
  | (EventMeta & { type: 'run.started'; payload: Record<string, never> })
  | (EventMeta & { type: 'text.delta'; payload: { text: string } })
  | (EventMeta & { type: 'tool.started'; payload: { callId: string; toolName: string; argumentSummary: string } })
  | (EventMeta & { type: 'tool.succeeded'; payload: { callId: string; resultSummary: string; durationMs: number } })
  | (EventMeta & { type: 'tool.failed'; payload: { callId: string; code: string; message: string } })
  | (EventMeta & { type: 'approval.required'; payload: { approvalId: string; action: string; risk: 'low' | 'medium' | 'high' } })
  | (EventMeta & { type: 'run.cancelled'; payload: { reason: string } })
  | (EventMeta & { type: 'run.failed'; payload: { code: string; message: string } })
  | (EventMeta & { type: 'run.finished'; payload: { summary: string } })

// 辅助工具：exhaustive check 时使用
// 当 switch 没有覆盖所有分支时，未覆盖的分支会走到 default，
// default 里把 value 赋给 never 类型，TS 会在编译期报错
export function assertNever(value: never): never {
  throw new Error(`Unhandled AgentEvent: ${JSON.stringify(value)}`)
}
```

**src/domain/agent/agent-run-state.ts**

```typescript
import type { AgentEvent, RunId } from './agent-event'
import { assertNever } from './agent-event'

// Run 只能处于这六种状态之一（互斥的枚举）
export type RunStatus =
  | 'idle'                // 还没开始
  | 'running'             // 执行中
  | 'awaiting-approval'   // 停下来等用户批准
  | 'completed'           // 正常结束（终态）
  | 'failed'              // 失败结束（终态）
  | 'cancelled'           // 取消结束（终态）

// 时间线上要渲染的每一项
export type TimelineItem = {
  key: string
  kind: 'text' | 'tool' | 'approval' | 'error' | 'result'
  title: string
  detail?: string
}

export type AgentRunState = {
  runId?: RunId
  status: RunStatus
  lastSequence: number     // 最后处理的事件序号
  timeline: TimelineItem[]
  error?: { code: string; message: string }
}

export const initialAgentRunState: AgentRunState = {
  status: 'idle',
  lastSequence: -1,
  timeline: [],
}

// 判断是否为终态
function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * Reducer：给定当前状态和一个事件，返回新的状态。
 * 必须是纯函数：
 *   - 相同输入永远得到相同输出
 *   - 不读 Date.now() / Math.random() / 不发请求 / 不改 DOM
 *   - 不修改 state 参数（用 spread / map / filter 返回新对象）
 */
export function reduceAgentEvent(
  state: AgentRunState,
  event: AgentEvent,
): AgentRunState {
  // 规则 A：sequence 去重
  // 如果收到的 sequence 不比已处理过的大，说明是重复或迟到，忽略
  if (event.sequence <= state.lastSequence) {
    return state
  }

  // 规则 B：终态保护
  // Run 已结束（completed/failed/cancelled）之后，任何事件都被忽略
  // 避免"已完成还在追加工具卡片"这种不可能状态
  if (isTerminal(state.status)) {
    return state
  }

  // 规则 C：按事件类型分派处理
  switch (event.type) {
    case 'run.started':
      return {
        ...state,
        runId: event.runId,
        status: 'running',
        lastSequence: event.sequence,
      }

    case 'text.delta':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `text-${event.sequence}`,
            kind: 'text',
            title: '模型输出',
            detail: event.payload.text,
          },
        ],
      }

    case 'tool.started':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `tool-${event.payload.callId}`,
            kind: 'tool',
            title: `调用工具：${event.payload.toolName}`,
            detail: `参数：${event.payload.argumentSummary}`,
          },
        ],
      }

    case 'tool.succeeded':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: state.timeline.map((item) =>
          item.key === `tool-${event.payload.callId}`
            ? { ...item, detail: `完成 (${event.payload.durationMs}ms)：${event.payload.resultSummary}` }
            : item,
        ),
      }

    case 'tool.failed':
      return {
        ...state,
        lastSequence: event.sequence,
        timeline: state.timeline.map((item) =>
          item.key === `tool-${event.payload.callId}`
            ? { ...item, detail: `失败 [${event.payload.code}]：${event.payload.message}` }
            : item,
        ),
      }

    case 'approval.required':
      return {
        ...state,
        status: 'awaiting-approval',
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `approval-${event.payload.approvalId}`,
            kind: 'approval',
            title: `等待审批：${event.payload.action}`,
            detail: `风险级别：${event.payload.risk}`,
          },
        ],
      }

    case 'run.cancelled':
      return {
        ...state,
        status: 'cancelled',
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `cancel-${event.sequence}`,
            kind: 'error',
            title: '已取消',
            detail: event.payload.reason,
          },
        ],
      }

    case 'run.failed':
      return {
        ...state,
        status: 'failed',
        lastSequence: event.sequence,
        error: event.payload,
        timeline: [
          ...state.timeline,
          {
            key: `error-${event.sequence}`,
            kind: 'error',
            title: `执行失败 [${event.payload.code}]`,
            detail: event.payload.message,
          },
        ],
      }

    case 'run.finished':
      return {
        ...state,
        status: 'completed',
        lastSequence: event.sequence,
        timeline: [
          ...state.timeline,
          {
            key: `result-${event.sequence}`,
            kind: 'result',
            title: '完成',
            detail: event.payload.summary,
          },
        ],
      }

    default:
      // 如果未来 AgentEvent 加了一种新类型（比如 budget.exceeded），
      // 而这个 switch 没有处理，TypeScript 会在这一行编译报错：
      // "Argument of type 'BudgetExceededEvent' is not assignable to parameter of type 'never'"
      // 这样就不会有"新事件被 UI 静默吞掉"的 Bug
      return assertNever(event)
  }
}
```

**src/features/agent-run/ui/AgentRunPanel.vue**

```vue
<script setup lang="ts">
import type { AgentRunState } from '@/domain/agent/agent-run-state'

// 组件只接 state prop，不知道也不关心事件从哪来
defineProps<{ state: AgentRunState }>()
</script>

<template>
  <section aria-labelledby="agent-run-title">
    <header>
      <h2 id="agent-run-title">诊断执行</h2>
      <output :data-status="state.status">{{ state.status }}</output>
    </header>

    <ol aria-live="polite">
      <li
        v-for="item in state.timeline"
        :key="item.key"
        :data-kind="item.kind"
      >
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail" style="white-space: pre-wrap;">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
output[data-status='running'] { color: orange; }
output[data-status='awaiting-approval'] { color: goldenrod; }
output[data-status='completed'] { color: green; }
output[data-status='failed'] { color: red; }
output[data-status='cancelled'] { color: gray; }

li[data-kind='tool'] { border-left: 3px solid steelblue; padding-left: 8px; }
li[data-kind='approval'] { border-left: 3px solid gold; padding-left: 8px; }
li[data-kind='error'] { border-left: 3px solid crimson; padding-left: 8px; }
li[data-kind='result'] { border-left: 3px solid green; padding-left: 8px; }
</style>
```

**src/features/agent-run/fixtures/sample-run.ts**

```typescript
import type { AgentEvent, RunId } from '@/domain/agent/agent-event'

const runId = 'run-fixture-1' as RunId

export const sampleEvents: AgentEvent[] = [
  { runId, sequence: 0, occurredAt: '2026-07-14T10:00:00Z',
    type: 'run.started', payload: {} },
  { runId, sequence: 1, occurredAt: '2026-07-14T10:00:01Z',
    type: 'text.delta', payload: { text: '正在检查服务器 srv-042 的 CPU 指标...' } },
  { runId, sequence: 2, occurredAt: '2026-07-14T10:00:02Z',
    type: 'tool.started',
    payload: { callId: 'c1', toolName: 'read_metrics', argumentSummary: 'last 10min' } },
  { runId, sequence: 3, occurredAt: '2026-07-14T10:00:04Z',
    type: 'tool.succeeded',
    payload: { callId: 'c1', resultSummary: 'CPU 平均 87%，异常', durationMs: 1800 } },
  { runId, sequence: 4, occurredAt: '2026-07-14T10:00:05Z',
    type: 'text.delta', payload: { text: '检测到 CPU 持续过载，建议重启异常进程。' } },
  { runId, sequence: 5, occurredAt: '2026-07-14T10:00:06Z',
    type: 'approval.required',
    payload: { approvalId: 'a1', action: 'restart_process', risk: 'high' } },
]
```

**src/App.vue**

```vue
<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import AgentRunPanel from '@/features/agent-run/ui/AgentRunPanel.vue'
import { sampleEvents } from '@/features/agent-run/fixtures/sample-run'
import { initialAgentRunState, reduceAgentEvent } from '@/domain/agent/agent-run-state'
import type { AgentEvent } from '@/domain/agent/agent-event'

// 实时收到的事件（模拟 WebSocket 一条一条推）
const receivedEvents = ref<AgentEvent[]>([])

// 每次 receivedEvents 变化，从头 reduce 一遍得到最新状态
// Day 5 会改成"增量 reduce"，只处理新事件
const state = computed(() =>
  receivedEvents.value.reduce(reduceAgentEvent, initialAgentRunState),
)

// 模拟事件按时间到达
onMounted(() => {
  sampleEvents.forEach((event, i) => {
    setTimeout(() => receivedEvents.value.push(event), (i + 1) * 800)
  })
})
</script>

<template>
  <AgentRunPanel :state="state" />
</template>
```

### 5.4 v3 用到的知识点

**知识点 6：状态机——用单一字段表示"当前处于什么阶段"**

v2 的问题是 `status` 通过"看最后一个事件"临时算出来，遇到乱序就崩。v3 把 `status` 提升为**状态的一部分**：它是 `AgentRunState` 里的一个字段，由 reducer 显式更新。

允许的迁移只有这几条：

```
idle ──run.started──> running
running ──approval.required──> awaiting-approval
awaiting-approval ──其他非终态事件──> running（可以退回执行）
running / awaiting-approval ──run.finished──> completed（终态）
running / awaiting-approval ──run.failed──> failed（终态）
非终态 ──run.cancelled──> cancelled（终态）
终态 ──任何事件──> 保持终态（规则 B 兜底）
```

其他组合都被 reducer 显式拒绝或忽略。这就杜绝了"既完成又等待批准"这种不可能状态。

**知识点 7：reducer 是纯函数——可测试、可回放**

回想 `Array.prototype.reduce`：

```typescript
const sum = [1, 2, 3].reduce((acc, x) => acc + x, 0)  // 0 → 1 → 3 → 6
```

Agent 状态的更新是同样模式：

```typescript
const state = events.reduce(reduceAgentEvent, initialAgentRunState)
```

因为是纯函数：

- **可测试**：`expect(reduceAgentEvent(state, event)).toEqual(newState)` 直接就能测；
- **可回放**：把事件日志保存下来，任何时候重新 reduce 一遍就能还原状态。Day 6 断线重连后靠这个恢复；
- **不可变**：`state` 参数永远不被修改，React/Vue 都能高效对比是否需要重渲染。

**知识点 8：exhaustive check——编译期抓遗漏**

`switch` 的 `default` 分支写：

```typescript
default:
  return assertNever(event)
```

它做的事：把 `event` 变量赋给 `never` 类型的参数。因为 `switch` 前面处理了所有九种事件，走到 `default` 时 TS 认为 `event` 的类型是 `never`——**任何类型都能赋给 `never`**，编译通过。

一旦未来 `AgentEvent` 加了新类型（比如 `budget.exceeded`）而这个 switch 没处理，`event` 在 `default` 里就不再是 `never` 而是 `BudgetExceededEvent`，赋给 `never` 参数会**编译报错**。

**编译器变成了你的自动化 code review 工具**——加了新事件就必须处理，不处理就发布不了。

**知识点 9：UI 依赖倒转——组件只依赖 state，不依赖事件源**

v2 的 composable 把"事件"和"UI 逻辑"耦合在一起。v3 明确切开：

```
事件源（fixture / WebSocket / SSE）
  ↓ AgentEvent
Reducer（domain 层，纯函数）
  ↓ AgentRunState
UI 组件（features 层，只接 state prop）
```

好处：

- Day 5 把事件源从 fixture 换成 WebSocket → 只改 `App.vue`，`AgentRunPanel` 一行不动；
- Day 15 加历史恢复 → 只改 reducer，UI 组件不动；
- Day 17 加审批交互 → UI 组件接一个新 prop `onApprove`，reducer 不动。

**知识点 10：分层——domain / features / app**

三层各司其职：

| 层 | 依赖什么 | 被谁依赖 | 变化频率 |
|---|---|---|---|
| domain | 只有 TypeScript 标准库 | features、app | 低（合同稳定） |
| features | domain + Vue | app | 中（UI 迭代） |
| app | features + domain + 事件源 | 无 | 高（每次接入新数据源） |

面试时你能说清"我把领域逻辑和 UI 隔离了，测试直接跑纯函数不需要 mount 组件"——这是从"写页面"到"设计架构"的分界线。

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 只显示文本流 | 加工具、审批 | 加错误、完成、取消、去重、终态保护 |
| **事件类型** | 隐式（不显式建模） | 判别联合（6 种） | 判别联合（9 种）+ sequence + runId |
| **状态存储** | 多个 `ref` | 事件数组 + computed | reducer 结果的 `AgentRunState` |
| **归约逻辑** | 塞在事件回调里 | 塞在 computed 里 | 独立的纯函数 reducer |
| **可测试** | 只能 E2E | 需要 mount 组件 | 纯函数直接单测 |
| **架构层次** | 单文件 | composable 抽离 | domain / features / app 三层 |
| **换事件源代价** | UI 重写 | composable 改造 | 只改 App.vue 粘合处 |
| **编译期抓遗漏** | 无 | 部分（判别联合） | 完整（exhaustive check） |
| **对齐后续 Day** | ✗ | 部分 | ✓（Day 2-17 都基于 v3） |

---

## 6.5 前端底子补弱（独立深挖文档）

针对 12 号报告点出的弱点（TypeScript 深度、JS/Event Loop、测试纪律、AI 流式、架构表达、证据链），补弱内容已从本文迁出到独立 HTML 深挖文档，避免主课程被撑爆：

**→ 打开 [Day01深挖-前端底子补弱.html](../../output/Day01深挖-前端底子补弱.html)**

每个弱点都锚定今天 v3 项目里的一段真实代码，按 **场景锚点 → 项目代码原样 → 设计点拆解 → 原理 → 反例 → 分层提问（折叠答案）→ 项目对手戏 → 面试真题三档答法** 的结构展开。当前已完成深挖 1（TS 判别联合），2-6 待补。

自检依据：[12 号学生严格训练报告](../../output/12号学生严格训练报告.md) · [当前能力画像](../../output/当前用户能力画像与评级.md) · [简历用词红线自检清单](../../output/简历用词红线自检清单.md)

### 6.5.1 TypeScript:判别联合 + exhaustive check(报告 A 级第 2 条 / B 级第 1 条)

- v3 位置:`domain/agent/agent-event.ts` 的 9 种 `AgentEvent`;`agent-run-state.ts` reducer 结尾的 `const _exhaustive: never = event`。
- 自检:`interface` 与 `type` 差别?为什么 `AgentEvent` 只能用 `type`?`_exhaustive: never` 防的是哪一类 bug?去掉它编译器还会报错吗?
- 补强动作:把 `AgentEvent` 复制到临时文件,故意删一个分支或漏一个 `case`,观察 TS 红波浪线出现的位置;再故意把 `RunStarted.runId` 拼错成 `runld`,看错误链。
- 面试答法:"判别联合 + never 是给未来的自己上锁 —— 加事件时编译器强制我处理,忘一个就红。" 报告点名"简历没有 TypeScript",这就是最短的证据。

### 6.5.2 JavaScript:闭包与 Event Loop(报告 A 级第 2 条)

- v3 位置:`useAgentRun` composable 内 `state.value = events.value.reduce(reduce, initial)`;`fixtures/sample-run.ts` 用 `setTimeout` 串事件。
- 自检:`setTimeout(fn, 0)` 里 `fn` 什么时候真正执行?为什么"文本一段一段出现"不需要额外的 `requestAnimationFrame`?把 `setTimeout` 换成 `queueMicrotask`,UI 会怎样?
- 补强动作:把 fixture 的 `setTimeout(..., 100)` 分别改成 `queueMicrotask` 和 `requestAnimationFrame`,分别记录浏览器帧率、输入延迟和事件顺序。
- 面试答法:"流式 UI 的顺序保证来自事件队列,不来自我,我只保证 reducer 是纯的。"

### 6.5.3 测试纪律:为什么提出 reducer 才能测(报告 B 级第 2 条)

- v3 位置:`agent-run-state.spec.ts`。v1、v2 的逻辑塞在 composable / computed 里,只能 mount 组件才能测;v3 拆出纯函数后,`expect(reduce(state, event)).toEqual(...)` 就够了。
- 自检:pure function 的两个条件是什么?"终态保护(`completed` 后忽略事件)"应该在 reducer 里测还是 UI 里测?为什么?
- 补强动作:给 `reduce` 写两个测试 —— "重复 sequence 被丢弃"、"进入 `completed` 后再来 `TextDelta` 状态不变"。两个测试都不 import Vue。
- 面试答法:"我把可以纯函数化的部分单独提出来,测试成本从 mount 组件降到调用函数。" 报告"测试 4.5/10"最快的补法就是这类测试文件。

### 6.5.4 AI 流式处理:先在 fixture 上练,别急着接真接口(报告 C 级第 1-3 条)

- v3 位置:`fixtures/sample-run.ts`;`AgentRunPanel.vue` 消费事件的部分。
- 自检:今天为什么用 fixture 而不是真 SSE?如果今天直接接 SSE,最容易踩的是哪几个坑(提示:跨 chunk 的 UTF-8、未闭合 `<`、乱序、断线、幂等)?`TextDecoder({ stream: true })` 的 `stream: true` 起什么作用?
- 补强动作:在旁边写一个玩具 `sseToEvents(stream)`(不接入项目),把 `ReadableStream<Uint8Array>` 解码成 `AgentEvent[]`,用一个故意在 UTF-8 中间切开的小样本验证跨 chunk。Day 3 / Day 5 会真接入。
- 面试答法:"事件流的顺序、去重、终态我在 fixture 层就固定了,真接口只是换 transport,业务不用改。" 这正是报告 C 级清单第 1-3 条。

### 6.5.5 架构表达:能不能 30 秒讲清 v3 的分层(报告 B 级第 5 条)

- v3 位置:`domain/` `features/` `shared/` 三层;`App.vue` 作为 composition root。
- 自检:为什么 `domain/agent/` 不能 import `features/agent-run/ui/`?fixture 放在 `domain/` 会怎样?面试官问"为什么不把 reducer 直接写在组件里",你怎么用 30 秒答?
- 补强动作:画一张最简架构图(三个盒子 + 单向箭头),写进今日学习日志。每画一根箭头都问"这个方向反了会怎样"。
- 面试答法:"依赖方向:domain 只依赖类型,features 依赖 domain,UI 依赖 features;这样换 transport、换 UI 库、加新事件互相不污染。"

### 6.5.6 证据链与自述表达(报告第 7 节"项目回答模板")

- v3 位置:v3 完成后,你必须能填出报告模板 —— 背景 / 目标 / 基线 / 定位 / 方案对比 / 实施 / 验证 / 限制 / 复盘。
- 自检:面试官问"你怎么处理流式事件的乱序",能不能同时给出:一行代码(`sequence` 去重)、一个测试(重复 seq 被丢弃)、一句权衡(为什么放 reducer 而不是 UI)?
- 补强动作:今天日志里写这一句 —— "v3 相对 v2 增加了错误 / 完成 / 取消 / 去重 / 终态保护;证据是 `agent-run-state.spec.ts` 的 N 条测试;限制是真 SSE、并发 Run、埋点未做,见 Day 3 / 5 / 17。"
- 面试答法:从 Day 1 就练报告第 7 节的模板,别等到 Day 89 再补。

### 6.5.7 别再写这些(报告第 3 页 / 简历修辞纠正)

- 不写"熟练掌握 Vue 源码" —— 除非能默写 `effect / track / trigger / scheduler / patchFlag / diff` 的调用关系(Week 2 会补)。
- 不写"通过 Vue 实现权限控制" —— 前端只是 UI 权限,后端资源鉴权才是边界(Week 4 会补)。
- 不写"AI 助手 / 大模型分析报表" —— 换成"SSE / Fetch Stream 传输、状态机管理、Markdown 增量渲染、Function Calling 前端确认、引用溯源"(v3 用到的正是前两项)。
- 不写"提效 40%" —— 换成"N 个模板节省 M 分钟 / 次,基线 K 分钟 / 次,样本量 X,测量周期 Y"(报告第 3 页 LCP 案例已给示范)。
- 不写`vibing code` —— 行业术语是 `vibe coding`;`Codex/Claude Code 熟练使用` 也不是 AI 工程能力,必须说明上下文管理、代码验证、失败恢复(报告第 9 节)。

Day 1 只是起点,但用词从今天就开始改。教师五连问会直接从报告第 6 节 20 道个性化题里挑。

---

## 7. 项目验收清单（阶段 E-F，55 分钟）

阶段 D（搭骨架 / 7.1-7.5）已在前面 §1.5 完成。这一节是**收尾验收**——测试、反证、lint/typecheck/build、提交。

### 7.6 E：写 reducer 测试（20 分钟）

**src/domain/agent/agent-run-state.spec.ts**

```typescript
import { describe, expect, it } from 'vitest'
import type { AgentEvent, RunId } from './agent-event'
import { initialAgentRunState, reduceAgentEvent } from './agent-run-state'

const runId = 'run-1' as RunId

// 测试用的事件工厂：自动填 runId 和 occurredAt
type EventInput = AgentEvent extends infer T
  ? T extends AgentEvent
    ? Omit<T, 'runId' | 'sequence' | 'occurredAt'>
    : never
  : never

function event(value: EventInput, sequence: number): AgentEvent {
  return {
    ...value,
    runId,
    sequence,
    occurredAt: '2026-07-14T00:00:00.000Z',
  } as AgentEvent
}

describe('reduceAgentEvent', () => {
  it('starts run and enters running state', () => {
    const state = reduceAgentEvent(
      initialAgentRunState,
      event({ type: 'run.started', payload: {} }, 0),
    )
    expect(state.status).toBe('running')
    expect(state.runId).toBe(runId)
  })

  it('replays the same events deterministically', () => {
    const events: AgentEvent[] = [
      event({ type: 'run.started', payload: {} }, 0),
      event({ type: 'text.delta', payload: { text: 'hello' } }, 1),
      event({ type: 'run.finished', payload: { summary: 'done' } }, 2),
    ]
    const replay = () => events.reduce(reduceAgentEvent, initialAgentRunState)
    expect(replay()).toEqual(replay())
  })

  it('ignores duplicated sequence', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({ type: 'text.delta', payload: { text: 'a' } }, 1))
    const before = state
    state = reduceAgentEvent(state, event({ type: 'text.delta', payload: { text: 'a' } }, 1))
    expect(state).toBe(before)  // 完全相等，说明被忽略了
  })

  it('correlates tool completion by callId', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({
      type: 'tool.started',
      payload: { callId: 'c1', toolName: 'read_metrics', argumentSummary: 'x' },
    }, 1))
    state = reduceAgentEvent(state, event({
      type: 'tool.succeeded',
      payload: { callId: 'c1', resultSummary: '87%', durationMs: 100 },
    }, 2))
    const tool = state.timeline.find((i) => i.key === 'tool-c1')
    expect(tool?.detail).toContain('完成 (100ms)')
    expect(tool?.detail).toContain('87%')
  })

  it('enters awaiting-approval after approval.required', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({
      type: 'approval.required',
      payload: { approvalId: 'a1', action: 'restart', risk: 'high' },
    }, 1))
    expect(state.status).toBe('awaiting-approval')
  })

  it('does not mutate a terminal state after a late event', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({ type: 'run.finished', payload: { summary: 'ok' } }, 1))
    const before = state
    // 终态之后来一个晚到的事件
    state = reduceAgentEvent(state, event({ type: 'text.delta', payload: { text: 'late' } }, 2))
    expect(state).toBe(before)
  })

  it('enters cancelled from a non-terminal state', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({ type: 'run.cancelled', payload: { reason: 'user' } }, 1))
    expect(state.status).toBe('cancelled')
  })

  it('records a run failure', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({
      type: 'run.failed',
      payload: { code: 'MODEL_TIMEOUT', message: '超时' },
    }, 1))
    expect(state.status).toBe('failed')
    expect(state.error?.code).toBe('MODEL_TIMEOUT')
  })

  it('records a tool failure without ending the run', () => {
    let state = initialAgentRunState
    state = reduceAgentEvent(state, event({ type: 'run.started', payload: {} }, 0))
    state = reduceAgentEvent(state, event({
      type: 'tool.started',
      payload: { callId: 'c1', toolName: 'read_metrics', argumentSummary: 'x' },
    }, 1))
    state = reduceAgentEvent(state, event({
      type: 'tool.failed',
      payload: { callId: 'c1', code: 'DB_DOWN', message: '连接失败' },
    }, 2))
    // 工具失败不等于 run 失败，run 状态仍是 running
    expect(state.status).toBe('running')
    const tool = state.timeline.find((i) => i.key === 'tool-c1')
    expect(tool?.detail).toContain('DB_DOWN')
  })
})
```

跑测试：

```powershell
pnpm test
```

九个测试应该全绿。

### 7.7 F-1：反证实验 1——去掉去重会怎样（5 分钟）

临时把 `agent-run-state.ts` 里规则 A 的两行注释掉：

```typescript
// if (event.sequence <= state.lastSequence) {
//   return state
// }
```

重新跑测试，`ignores duplicated sequence` 会失败。把失败输出截图保存到 `docs/evidence/day-01/dedup.md`，然后**恢复代码**。

### 7.8 F-2：反证实验 2——去掉 exhaustive check 会怎样（5 分钟）

临时把 `agent-run-state.ts` 里 `default` 分支改成 `return state`：

```typescript
default:
  return state  // 原来是 return assertNever(event)
```

在 `agent-event.ts` 加一个新事件：

```typescript
export type AgentEvent =
  | ...
  | (EventMeta & { type: 'budget.exceeded'; payload: { limit: number } })
```

跑 `pnpm typecheck`——**编译通过了**。这意味着新事件被 UI 静默吞掉。

把 `default` 改回 `return assertNever(event)`，再跑 `pnpm typecheck`——现在**编译报错**，逼你去处理 `budget.exceeded`。

把编译错误截图保存到 `docs/evidence/day-01/exhaustive-check.md`，然后**删除 budget.exceeded 那一行、恢复 default 分支**。

### 7.9 F-3：验证 + 提交（10 分钟）

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

四条命令都通过后：

```powershell
git add .
git commit -m "day-01: agent event model and run panel v3"
```

---

## 8. 通过标准

**功能层面**：

- [ ] 浏览器能看到 v3 的完整效果（状态徽章 + 时间线）；
- [ ] 全项目 `grep "data: any"` 结果为 0；
- [ ] `reduceAgentEvent` 是纯函数（没有 `Date.now()` / `fetch` / DOM 操作）；
- [ ] 至少 9 个 reducer 测试全部通过。

**架构层面**：

- [ ] 目录结构分了 `domain/` 和 `features/` 两层；
- [ ] `AgentRunPanel.vue` 只有一个 prop：`state: AgentRunState`；
- [ ] fixture 只出现在 `features/**/fixtures/`，Pinia Store（如果建了）里 grep 不到。

**工程层面**：

- [ ] `pnpm lint / typecheck / test / build` 四条命令真实通过；
- [ ] 两个反证实验都有截图证据；
- [ ] commit 已提交。

**能脱口说清**：

- [ ] v1 → v2 → v3 每一步重构解决的**具体痛点**（不是"更清晰了"这种空话）；
- [ ] 判别联合 + exhaustive check 在**编译期**抓到了什么、在**运行时**没抓到什么；
- [ ] `AgentRunPanel` 为什么不能接 `AgentEvent[]` prop——Day 5 换 WebSocket 时会付出什么代价。

---

## 9. 提交物

- `p1-monitor/frontend/` 工程源码（含 v3 完整实现）；
- `docs/evidence/day-01/commands.md`（四条命令真实输出）；
- `docs/evidence/day-01/dedup.md`（反证 1 截图）；
- `docs/evidence/day-01/exhaustive-check.md`（反证 2 截图）；
- `docs/learning/day-01.md`（学习日志，回答第 10 节课末三问）；
- commit：`day-01: agent event model and run panel v3`。

---

## 10. 课末 3 个核心问题（提交前先自己写下答案）

1. v1 → v2 → v3 每一次重构，**具体解决了哪个现象**？请从"用户会看到什么 Bug"的角度回答，不要说"代码更好了"。
2. `AgentEvent` 判别联合、`AgentRunState` 状态机、`reduceAgentEvent` 纯函数，这三样**任选一样去掉**，说出会出现的一个真实 Bug 和它的复现步骤。
3. Day 5 要把事件源从 fixture 换成 WebSocket。在 v3 架构下**需要改哪些文件、不需要改哪些文件**？如果当初选了 v2 的架构，改动范围会有什么不同？

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。规模和指标是练习约束，不是本项目已经取得的生产数据。

1. `AgentRunPanel` 在 1 秒内收到 `tool.started`、`approval.required`、`run.finished` 三个事件，其中最后两个乱序，UI 同时显示"已完成"和"等待批准"。请用事件日志、sequence 与 reducer 输入输出定位不可能状态；先禁止终态继续归约止损，再修复判别联合和转换表，并用乱序、重复、晚到事件测试验证。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)

2. 200 个并发 Agent Run 通过同一 Transport 进入页面，某个 Provider 新增事件类型后旧 UI 静默忽略，5% 的运行永远停在 `running`。请给出合同版本、exhaustive switch 编译证据和 runId 时间线；先降级为"未知事件/可重试"，再设计 Provider-BFF-Transport-Vue 边界及兼容策略，并以回放 10 万事件验证无悬挂 Run。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[S20 TypeScript unions](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html)

知识映射：事件合同、判别联合、FSM、Tool/Approval UI；从单次归约错误扩展到 Provider 演进。

---

## 12. PDF 面试题

1. 手写一个简单状态机，模拟 AI Agent 的 Idle、Thinking、Calling_Tool、Responding、Error 状态切换。
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 8 页。
2. 如果从零设计 AI Agent 前端架构，会考虑哪些核心模块？
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 9 页。

题目边界：文件名不等于官方题库；答案必须引用今天的事件合同、状态机、测试和边界图。

---

## 13. 完成后教师五连问

教师核验真实 commit、测试、反证记录后，按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"提出 5 道问题。规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

**已完成**：Agent 事件合同 + Run 状态机 + 时间线 UI。

**明天 Day 2 要做**：给 `AgentEvent` 加**运行时**校验（Zod Schema），因为 TypeScript 只在编译期起作用，网络传来的 JSON 到手时是 `unknown`。今天定的类型合同是 Day 2 校验规则的基础。

**Day 5-17 复用今天的**：

- `AgentEvent` 类型（Day 5 WebSocket 直接吐这个格式）；
- `reduceAgentEvent`（Day 5 增量 reduce、Day 6 用 lastSequence 做重连去重）；
- `AgentRunPanel`（Day 15 加历史恢复、Day 17 加审批交互，组件签名不变）。

**如果今天没完成到 v3**：Day 2 会直接卡住（没有类型合同就没法加 Schema）。今天必须交付 v3 完整版。
