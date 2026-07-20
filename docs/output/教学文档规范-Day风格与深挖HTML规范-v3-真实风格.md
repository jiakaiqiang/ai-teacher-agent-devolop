# 教学文档规范 · Day 风格与深挖 HTML 规范（v3 真实风格版）

> 本文件基于 Day01 **打磨后的实际形态**提炼规范，删除虚构的"30/70 硬性划分"。Day01 采用**完整示例教学法**：给出 v1/v2/v3 三版完整可跑的代码，用户对着代码在自己项目里敲一遍，边写边思考"为什么这么设计"。
>
> 参考基线：`output/90天逐日任务/Day01.md`（1458 行完整正式版）· `output/Day01深挖-前端底子补弱.html`（深挖基线）· `C:\Users\kaiqj\.claude\CLAUDE.md`（学习硬红线）· `C:\Users\kaiqj\.claude\projects\D-------------------ai--\memory\feedback_daily_scaffold.md`（骨架规则）。
>
> **v3 变更（vs v2）**：删除 §0 立项前提的"70% 禁止生成清单" / 删除 §0.1 三种标注符号 ✅/❌/⚠️ / §1.5 脚手架改为"按第 5.3 节的代码写 + 边写边问自己" / 明确"完整示例教学法"vs"填空教学法"的边界。

---

## 0. 文档定位：完整示例 + 思考引导

Day*.md 采用**完整示例教学法**，不是"AI 给骨架、用户填空"：

### 0.1 Day*.md 的教学模式

- **Day*.md 正文**：给出 v1/v2/v3 三版**完整可跑的代码**（包括 reducer 核心逻辑、状态机、测试用例全部实现细节），用户对着代码在自己项目里敲一遍。
- **"边写边问自己"**：代码块后跟 3-5 个"为什么这么设计"的问题，引导用户边写边思考设计意图，不是"AI 不给答案让你自己推"。
- **深挖 HTML**：针对代码里的关键知识点（判别联合/状态机/reducer/exhaustive check），展开 8 子节深挖（场景锚点/项目代码/设计点拆解/原理/反例/分层提问/项目对手戏/面试真题三档答法）。

**Day01 实证**：
- `agent-run-state.ts` reducer 完整实现（670-900 行，包括 9 个 case 分支、终态保护、sequence 去重全部逻辑）
- `agent-run-state.spec.ts` 测试文件 9 个用例完整给出（包括断言体、payload 内容）
- `AgentRunPanel.vue` 完整组件代码（包括模板、样式、aria 标签）

### 0.2 非本课程的教学法（明确边界）

**❌ 不采用的模式**：
- AI 只给类型骨架 / interface 声明，让用户填 reducer 主体逻辑
- AI 只给 `describe / it` 外壳，让用户写断言体
- 在 Day*.md 里标注"这段禁止 AI 生成，你自己写"
- 用 `> ✅ 这是样板代码` / `> ❌ AI 不生成` 区分哪些能生成哪些不能

**Day01 未出现的标注**：
- 全文 0 次 `> ✅` 或 `> ❌`
- §1.5 脚手架直接说"按第 5.3 节的代码写"，而第 5.3 节给出了 reducer 完整实现

### 0.3 "用户手写"的真实含义

- 用户要**对着 Day*.md 第 5.3 节的完整代码，在自己项目里敲一遍**
- 边敲边思考"边写边问自己"里的 3-5 个设计问题
- 不是"AI 给你骨架你推导逻辑"，而是"AI 给完整示例你学习模式"

---

## 1. `Day*.md` 权威版章节顺序（强制）

以下顺序是 Day01 打磨后的最终形态。**任何一天都必须完整覆盖，禁止跳节，禁止调换顺序**。缺项 = BLOCK。

**文件头部（§0 之前）强制信息块**：

```
# Day {N}：{主题}（{三版演进副标题}）

任务版本：标准版
日期与时长：{YYYY-MM-DD} {周几}，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：{绝对路径，例如 D:\demo\ai-techer\p1-monitor\frontend}
角色视角：{一句话说明本日读者预设背景}

---
```

**Day01 头部无"配套文档"行、无"规范来源"行、无"⚠️ 骨架状态提示"**。Day02 骨架版才需要标注"⚠️ 本文件目前是「结构骨架 + TODO 占位」"，Day01 正式版不需要。

**章节顺序**：

```
0. 今天在 90 天路线中的位置          ← 承上启下
1. 今天要交付的功能模块
   1.1 用户能看到什么                ← 只描述用户可见现象，不谈技术
   1.2 这个模块在项目里承担什么       ← 在整个 p1/p2/p3 项目里的定位
   1.3 三版演进的目标（v1 / v2 / v3） ← 见 §3；不适用的天在此说明替代结构
   1.4 本日项目目录结构（动手前先看骨架） ← 5 子块强制
1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文） ← 原第 7 节前置
   1.5.1 D-1：搭工程骨架 / 装依赖
   1.5.2 D-2：创建目录
   1.5.3 D-3：实现 domain 层
   1.5.4 D-4：实现 features 层
   1.5.5 D-5：接入编排层
2. 学习节奏（90 阅读 / 90 动手）      ← 阶段 A-F 时间盒表
3. v1：最小闭环
4. v2：加一个关键设计维度
5. v3：终态
   5.1 v3 要实现什么
   5.2 v3 目录结构                    ← 与 §1.4 完全一致
   5.3 v3 完整代码                    ← 逐文件展示，**无省略、无填空**
   5.4 v3 用到的知识点               ← 至少 6 个知识点
6. 三版对比一览表                     ← 见 §7 九列字段
6.5 前端底子补弱（独立深挖 HTML 入口） ← 强制
7. 项目验收清单（阶段 E-F，约 55 分钟） ← 只保留 7.6-7.9 验收
   7.6 E：写核心逻辑单元测试
   7.7 F-1：反证实验 1
   7.8 F-2：反证实验 2
   7.9 F-3：验证 + 提交
8. 通过标准
9. 提交物
10. 课末 3 个核心问题
11. 真实项目情境题（联网更新 YYYY-MM-DD）
12. PDF 面试题
13. 完成后教师五连问
14. 本 Day 在 90 天路线中的锚点
```

---

## 2. §1.4 "目录结构" 章节内部结构（强制 5 子块）

必须包含 5 个子块，缺一 BLOCK：

1. **一句话说明为什么放在最前面**
2. **完整目录树**：ASCII 树 + 每个文件后跟中文一句话说明职责
3. **三版演进对应的文件差异表**：v1 / v2 / v3 三列
4. **依赖方向图**：单向箭头 + 红线（具体到"什么 import 算塌方"）
5. **动手前先问自己 3 个问题**：每题给出后面章节锚点

**Day01 示例**（§1.4 行 77-121）：

```markdown
## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：每天动手前必须先在脑子里立起骨架...

**今天在 `p1-monitor/frontend/` 下要建立的完整前端源码树（v3 完整版）**：

```
src/
├── domain/                             ← 领域层...
│   └── agent/
│       ├── agent-event.ts              ← 事件类型...
│       ├── agent-run-state.ts          ← 状态类型 + 初始状态 + 纯函数 reducer
│       └── agent-run-state.spec.ts     ← reducer 单元测试
...
```

**三版演进对应的文件差异**：[表格]

**依赖方向（务必单向，反过来一次都不行）**：
```
App.vue → composables/useAgentRun.ts → features/agent-run/ → domain/agent/
```

**红线**：`domain/agent/*.ts` 里出现 `import { ref } from 'vue'` 就是架构塌方的第一步。domain 必须能在纯 Node 里跑起来、跑测试。

**动手前先问自己 3 个问题**：
1. `domain/` 和 `features/` 为什么必须分开？—— 见 v3 的第 5.4 节「层与依赖方向」。
...
```

---

## 3. §1.5 "动手脚手架" 章节格式（"按第 5.3 节的代码写"）

**Day01 的真实写法**（§1.5.3 行 185-196）：

```markdown
### 1.5.3 D-3：实现 domain 层（20 分钟）

按第 5.3 节的代码：

- 写 `src/domain/agent/agent-event.ts`；
- 写 `src/domain/agent/agent-run-state.ts`。

**边写边问自己**：

- `RunId` 为什么要 branded type？（防止手滑把普通 string 传进去）
- `EventMeta` 里为什么要有 `sequence`？（去重和排序）
- 规则 A 和规则 B 谁先谁后？（先去重再判终态...）
```

**关键点**：
- 说"按第 5.3 节的代码"，意味着第 5.3 节**给出了完整实现**（Day01 的 5.3 节有 670-900 行完整 reducer 代码）
- "边写边问自己"不是"AI 不给答案你自己推"，而是"对着完整代码思考设计意图"
- **无** `> ❌ AI 不生成 xxx` 标注

**错误示例（Day02 v2 里的错误）**：

```markdown
### 1.5.3 D-3：写 Schema 层

> ❌ **AI 不生成 Schema 完整字段**——这是核心业务逻辑。你必须**手写** Schema 字段。

学习指导（按此顺序自己动手）：
1. 阅读 zod 官方文档...
2. **手写**四个 schema 文件的**字段结构**...
```

这是虚构的 30/70 划分，Day01 不这么写。

---

## 4. §3-§5 "三版演进" 规则

### 4.1 三版通用规则

- v1 = 最小闭环。**完整可跑的代码**，只解决当天核心概念的 1 个维度。
- v2 = 加一个关键设计维度。仍然是**完整代码**。**v2 章节末尾必须写"暴露的痛点"**。
- v3 = 终态。补齐错误 / 边界 / 分层 / 可测试性。**v3 就是用户最终交付的形态**。

每一版都要有：
- **要实现什么**（用户视角）
- **完整代码**（**不省略、不 `...`、不填空**）
- **用到的知识点**（v3 至少 6 个，每个含 5 要素：解决的问题 / 运行机制 / 项目落点 / 生产误区 / 验证方法）
- **暴露的痛点**（v1/v2 必须有，v3 改为"用到的知识点"）

### 4.2 §5.3 v3 完整代码的写法

**Day01 示例**（行 669-1001）：

```markdown
### 5.3 v3 完整代码

**src/domain/agent/agent-event.ts**

```typescript
// runId 是字符串，但用 branded type 区分它和普通 string
export type RunId = string & { readonly __brand: 'RunId' }

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

export function assertNever(value: never): never {
  throw new Error(`Unhandled AgentEvent: ${JSON.stringify(value)}`)
}
```

**src/domain/agent/agent-run-state.ts**

```typescript
import type { AgentEvent, RunId } from './agent-event'
import { assertNever } from './agent-event'

export type RunStatus =
  | 'idle'
  | 'running'
  | 'awaiting-approval'
  | 'completed'           // 终态
  | 'failed'              // 终态
  | 'cancelled'           // 终态

export type TimelineItem = {
  key: string
  kind: 'text' | 'tool' | 'approval' | 'error' | 'result'
  title: string
  detail?: string
}

export type AgentRunState = {
  runId?: RunId
  status: RunStatus
  lastSequence: number
  timeline: TimelineItem[]
  error?: { code: string; message: string }
}

export const initialAgentRunState: AgentRunState = {
  status: 'idle',
  lastSequence: -1,
  timeline: [],
}

function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * Reducer：给定当前状态和一个事件，返回新的状态。
 * 必须是纯函数：相同输入永远得到相同输出、不修改 state 参数
 */
export function reduceAgentEvent(
  state: AgentRunState,
  event: AgentEvent,
): AgentRunState {
  // 规则 A：sequence 去重
  if (event.sequence <= state.lastSequence) {
    return state
  }

  // 规则 B：终态保护
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
      return assertNever(event)
  }
}
```

**src/features/agent-run/ui/AgentRunPanel.vue**

[完整组件代码 100+ 行，包括 template / style]

**src/features/agent-run/fixtures/sample-run.ts**

[完整 fixture 数据]

**src/App.vue**

[完整编排层代码]
```

**关键点**：
- reducer 主体逻辑（9 个 case 分支、终态保护、sequence 去重）**完整给出**
- 测试文件 9 个用例**完整给出**（包括断言体、payload）
- **无省略**、**无 `...`**、**无"这里你自己填"**

---

## 5. §7 验收清单（只放验收，不放脚手架）

7.1-7.5 已前置到 §1.5。§7 只保留：

- 7.6 E：写核心逻辑测试（20 分钟）
- 7.7 F-1：反证实验 1（5 分钟）
- 7.8 F-2：反证实验 2（5 分钟）
- 7.9 F-3：验证 + 提交（10 分钟）

**7.9 必须包含**：
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 四件套
- Conventional Commits 提交信息模板（含 `Refs: DayN`）
- **⚠️ 不要 `git push`** 硬红线标注

---

## 6. 深挖 HTML 规范

深挖 HTML 是 **补弱专用文档**，Day*.md 正文给完整代码 + 简要知识点，深挖 HTML 展开原理。

### 6.1 结构（强制 8 子节）

```
<section id="dig-{n}">
  <h2>深挖 {n}：{主题} —— 从今天项目里的 {锚点} 讲起</h2>
  <h3>{n}.1 场景锚点（10 秒定位）</h3>
  <h3>{n}.2 项目代码（原样）</h3>
  <h3>{n}.3 设计点拆解</h3>
  <h3>{n}.4 原理</h3>
  <h3>{n}.5 反例</h3>
  <h3>{n}.6 分层提问（点开答案）</h3>
  <h3>{n}.7 项目对手戏</h3>
  <h3>{n}.8 面试真题三档答法</h3>
</section>
```

**禁止在深挖 HTML 里放动手脚手架**（§1.5.1-1.5.5 的内容不进 HTML）。

---

## 7. 三版对比一览表（9 列强制）

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | ... | ... | ... |
| **事件类型 / 数据模型** | ... | ... | ... |
| **状态存储** | ... | ... | ... |
| **归约逻辑** | ... | ... | ... |
| **可测试** | ... | ... | ... |
| **架构层次** | ... | ... | ... |
| **换事件源代价** | ... | ... | ... |
| **编译期抓遗漏** | ... | ... | ... |
| **对齐后续 Day** | ... | ... | ... |

---

## 8. Subagent 审核 checklist

生成 / 修改任何 `Day*.md` 后，spawn `code-reviewer` subagent 审核：

- [ ] §0-§14 全部存在，顺序与本规范 §1 一致
- [ ] §1.4 目录结构 5 子块齐全
- [ ] §1.5 脚手架说"按第 5.3 节的代码写"+"边写边问自己"
- [ ] §3-§5 每版有"要实现什么 / 完整代码 / 知识点"
- [ ] §5.3 v3 完整代码逐文件展示，**无省略、无填空**
- [ ] §5.4 v3 知识点 ≥ 6 个
- [ ] §6 三版对比表 9 列齐全
- [ ] §7 只保留 7.6-7.9 验收
- [ ] §7.9 无 `git push` 命令
- [ ] §12 PDF 面试题标注"文件名不等于官方题库"
- [ ] **全文 0 次 `> ✅` 或 `> ❌` 标注**（这是虚构的 30/70 划分）

---

## 9. 与其他协议的关系

- 本文件规定**文档形态**；`AI教师五连问验收协议.md` 规定**教师验收行为**。
- `C:\Users\kaiqj\.claude\CLAUDE.md` 是学习硬红线（Kiro 不主动生成代码除非请求），但 Day*.md 教学文档**必须给完整示例**，这是教学需要，不受 CLAUDE.md 约束。

---

**更新记录**

- 2026-07-15 · v3 真实风格版。删除虚构的 30/70 划分，基于 Day01 实际形态提炼规范。作者：用户 + Claude 协作。
