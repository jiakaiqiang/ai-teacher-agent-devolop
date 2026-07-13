# Week 1 / Day 01：AI 前端架构与 Agent 事件模型

任务版本：标准版  
日期与学习时间：2026-07-14 周二，180 分钟  
项目：`D:\demo\ai-techer\p1-monitor\frontend`  
角色视角：高级前端工程师设计可演进的 AI 诊断界面

## 1. 为什么这是 AI 前端

AI 前端不是普通表单加一个模型接口，也不等于聊天框。它需要把模型和 Agent 的非确定执行过程，转换成用户可理解、可取消、可恢复、可审计的状态。

Day 1 直接建立四个后续能力的基础：

```text
Agent/模型产生事件
  -> 前端验证事件合同
  -> 状态机归约事件
  -> UI 展示文本、工具、批准、错误和完成状态
  -> 用户可以观察、干预和恢复
```

今天产出的事件合同和状态机，后续会接入真实 SSE、WebSocket、Tool Calling 和 Agent Runtime，不是一次性 Demo。

## 2. 与 12.pdf 的连接

`12.pdf` 已证明你有 Vue、运维平台、机器人控制台、ECharts、性能优化和大模型助手接入经历。需要补强的是：

- 从“调用模型并展示结果”升级到“管理 Agent 执行生命周期”；
- 从页面组件思维升级到事件合同和状态机架构；
- 从成功路径升级到取消、工具失败、人工批准和恢复；
- 把 AI Coding 速度转化为可验证的工程质量。

## 3. 今日知识地图

```text
AI 系统边界
  -> Agent 事件合同
  -> TypeScript 判别联合
  -> Agent Run 状态机
  -> 事件归约器 reducer
  -> Tool/Approval/Result UI
  -> 测试与可审计证据
```

## 4. 知识点一：AI 前端的系统边界

### 四层责任

| 层 | 责任 | 不应该负责 |
|---|---|---|
| Model Provider | 生成文本、结构化输出或工具调用意图 | 直接控制浏览器权限和业务数据 |
| Agent/BFF | Prompt、Context、Tool 执行、权限、预算、密钥 | 依赖具体 Vue 组件结构 |
| Transport | SSE/WS/HTTP 传递类型化事件、取消和错误 | 决定页面展示样式 |
| Vue UI | 事件归约、状态展示、用户确认、恢复体验 | 保存模型 API key、直接执行高风险工具 |

浏览器是不可信边界。模型密钥、系统 Prompt、服务端权限和高风险工具执行不能放到前端。前端按钮隐藏只影响可见性，不构成授权。

### 项目落点

- 当前后端模型尚未完成，因此今天先定义 UI 所依赖的稳定事件合同。
- 后续更换 DeepSeek、OpenAI、Claude 或自建 Agent 时，UI 不应跟着 Provider API 大改。

### 常见误区

- Vue 组件直接调用模型供应商并暴露 API key。
- UI 直接理解 Provider 的原始 chunk 格式。
- 认为模型返回的工具名和参数天然可信。
- 把模型“思考过程”原样展示给用户。

## 5. 知识点二：Agent 事件合同

普通聊天可能只有文本片段，但 Agent 还会启动运行、调用工具、等待确认、失败和结束。前端应依赖自己的领域事件，而不是依赖某个 SDK 的内部事件名。

Day 1 至少定义：

```typescript
type AgentEvent =
  | RunStartedEvent
  | TextDeltaEvent
  | ToolStartedEvent
  | ToolSucceededEvent
  | ToolFailedEvent
  | ApprovalRequiredEvent
  | RunFailedEvent
  | RunFinishedEvent;
```

每个事件至少包含：

- `runId`：属于哪次 Agent 执行；
- `sequence`：事件顺序和去重依据；
- `timestamp`：发生时间；
- `type`：判别联合的区分字段；
- 与该事件相关的最小 payload。

### 为什么使用判别联合

`type` 确定后，TypeScript 可以收窄 payload。配合 exhaustive switch，新增事件但没有处理时可以在编译阶段暴露遗漏。

### 重要边界

TypeScript 只能检查编译期。网络事件在运行时仍然是 `unknown`，后续必须通过 Schema 校验后才能进入 reducer。Day 1 先建立类型合同，Day 2 完成运行时合同。

### 常见误区

- 使用 `{ type: string; data: any }`，导致所有错误推迟到运行时。
- 每个事件复制完整会话和消息，导致流量和状态不一致。
- 用数组下标代替 sequence，无法处理重复和断线恢复。
- 把完整工具参数、密钥和私有推理放入 UI 事件。

## 6. 知识点三：Agent Run 状态机

Agent UI 不能由 `isLoading/isError/isToolRunning` 等多个布尔量随意组合，否则会产生“不可能状态”，例如同时完成又加载。

建议状态：

```text
idle
  -> running
  -> awaiting-approval
  -> running
  -> completed

running -> failed
running -> cancelled
awaiting-approval -> cancelled
```

状态机由三部分组成：

- **State**：当前权威状态；
- **Event**：发生了什么；
- **Transition**：当前状态收到事件后允许进入哪里。

Reducer 必须是纯函数：同样的旧状态和事件得到同样的新状态，不直接请求网络、操作 DOM 或读取时间。

### 必须处理的边界

- terminal 状态收到晚到事件；
- sequence 重复或倒退；
- Tool 失败后 Run 是继续还是失败；
- awaiting-approval 时收到取消；
- `run-finished` 到达但仍存在 running tool。

## 7. 知识点四：Tool Calling UI 与可审计体验

高级 AI 前端不展示私有 Chain of Thought，而展示可审计执行事实：

- 当前阶段；
- 工具名称和安全参数摘要；
- pending/running/success/error；
- 开始时间和耗时；
- 是否需要人工批准；
- 用户可以采取的下一步。

模型提出工具调用不等于工具已执行。UI 必须区分：

```text
模型提出 -> 服务端校验 -> 等待批准 -> 服务端执行 -> 返回结果
```

今天只实现状态展示，不执行真实高风险工具。

## 8. 知识点五：人和 AI 的高效分工

### 人必须负责

- 定义系统边界、事件语义和状态转换；
- 判断哪些数据可展示，哪些属于安全边界；
- 编写至少一个核心 reducer 测试；
- 审查 AI diff，并运行最终验证；
- 脱离 AI 解释代码。

### AI 适合负责

- 创建 Vite/Vue/Vitest/ESLint 工程骨架；
- 根据人定义的合同生成重复类型和测试候选；
- 枚举遗漏的状态转换和失败场景；
- 进行只读代码审查和文档整理。

### Builder/Reviewer 模式

- Codex 或 Claude Code 选择一个作为 Builder 生成机械代码。
- 另一个只在高风险改动后作为 Reviewer，不与 Builder 同时编辑同一文件。
- 人决定接受、修改或拒绝，AI 之间不自动互相批准。

效率指标不是生成行数，而是首次全绿时间、返工次数、遗漏问题数和独立讲解通过率。

## 9. 三小时项目任务

### 0-30 分钟：学习并确定边界

- 阅读本任务单五个知识点。
- 阅读后端 Prisma 中 `Diagnosis`、`ToolCall`、`Anomaly` 的字段，只理解领域，不研究 NestJS DI。
- 创建 `docs/architecture/ai-frontend-boundary-day-01.md`，画 Model/BFF/Transport/Vue 四层边界。

### 30-55 分钟：人工定义事件合同

独立完成：

- `src/domain/agent/agent-event.ts`
- `src/domain/agent/agent-run-state.ts`

写出九类事件、状态集合、sequence 规则和敏感字段限制。此阶段禁止 AI 直接替你决定事件语义。

### 55-95 分钟：AI 辅助创建工程骨架

使用一个 AI Builder 辅助完成：

- Vue 3 + TypeScript + Vite；
- Vue Router、Pinia；
- Vitest、Vue Test Utils；
- ESLint、Prettier；
- `lint/typecheck/test/build` scripts；
- `app/domain/features/shared` 目录。

人工逐项检查依赖用途和脚本，不接受无法解释的配置。

### 95-140 分钟：人工实现状态机

实现：

- `src/features/agent-run/model/createAgentRunState.ts`
- `src/features/agent-run/model/reduceAgentEvent.ts`
- 对应单元测试。

至少覆盖：正常完成、工具成功、工具失败、等待批准、取消、重复 sequence、terminal 状态晚到事件、非法状态转换。

### 140-165 分钟：实现项目内 Agent Run UI

实现 `AgentRunPanel.vue`，展示：

- Run 状态；
- 增量文本；
- Tool 调用状态、参数摘要和耗时；
- Approval waiting；
- error/finished/cancelled。

使用测试 fixture 驱动 UI。Fixture 只能放在测试或开发适配层，不能混入生产 Store；它是未来真实 Transport 的合同替身，不是独立 Demo。

### 165-180 分钟：AI Review、验证与提交

- 让 Reviewer 只读检查状态遗漏、类型不安全和安全泄漏。
- 人工决定接受/拒绝建议，记录到 `docs/evidence/day-01/ai-review.md`。
- 运行 lint、typecheck、test、build。
- 提交 commit。

## 10. 学生先实现的 starter code

先检查工作区，不能覆盖已有改动：

```powershell
git -C D:\demo\ai-techer status --short
Test-Path D:\demo\ai-techer\p1-monitor\frontend
```

如果 `frontend` 不存在，在 `D:\demo\ai-techer\p1-monitor` 执行：

```powershell
pnpm create vite frontend --template vue-ts
Set-Location frontend
pnpm install
pnpm add -D vitest @vue/test-utils jsdom
```

### 10.1 事件合同

创建 `src/domain/agent/agent-event.ts`。下面只有合同，没有 reducer 最终答案：

```typescript
export type RunId = string & { readonly __brand: 'RunId' };

type EventMeta = {
  runId: RunId;
  sequence: number;
  occurredAt: string;
};

export type AgentEvent =
  | (EventMeta & { type: 'run.started'; payload: Record<string, never> })
  | (EventMeta & { type: 'text.delta'; payload: { text: string } })
  | (EventMeta & {
      type: 'tool.started';
      payload: { callId: string; toolName: string; argumentSummary: string };
    })
  | (EventMeta & {
      type: 'tool.succeeded';
      payload: { callId: string; resultSummary: string; durationMs: number };
    })
  | (EventMeta & {
      type: 'tool.failed';
      payload: { callId: string; code: string; message: string };
    })
  | (EventMeta & {
      type: 'approval.required';
      payload: { approvalId: string; action: string; risk: 'low' | 'medium' | 'high' };
    })
  | (EventMeta & { type: 'run.cancelled'; payload: { reason: string } })
  | (EventMeta & { type: 'run.failed'; payload: { code: string; message: string } })
  | (EventMeta & { type: 'run.finished'; payload: { summary: string } });

export function assertNever(value: never): never {
  throw new Error(`Unhandled AgentEvent: ${JSON.stringify(value)}`);
}
```

学生先解释：为什么事件中没有 `apiKey`、完整 Prompt、完整工具参数和 Chain of Thought？解释不清，不进入 reducer。

### 10.2 唯一状态来源

创建 `src/domain/agent/agent-run-state.ts`：

```typescript
import type { AgentEvent, RunId } from './agent-event';

export type RunStatus =
  | 'idle'
  | 'running'
  | 'awaiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TimelineItem = {
  key: string;
  kind: 'text' | 'tool' | 'approval' | 'error' | 'result';
  title: string;
  detail?: string;
};

export type AgentRunState = {
  runId?: RunId;
  status: RunStatus;
  lastSequence: number;
  timeline: TimelineItem[];
  error?: { code: string; message: string };
};

export const initialAgentRunState: AgentRunState = {
  status: 'idle',
  lastSequence: -1,
  timeline: [],
};

export function reduceAgentEvent(
  state: AgentRunState,
  event: AgentEvent,
): AgentRunState {
  // TODO: 定义重复/乱序 sequence 策略。
  // TODO: 定义 completed/failed/cancelled 终态后的事件策略。
  // TODO: 穷尽处理九类事件；不允许宽泛 default 静默返回 state。
  throw new Error('Student implementation required');
}
```

### 10.3 失败测试先行

创建 `src/domain/agent/agent-run-state.spec.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentEvent, RunId } from './agent-event';
import { initialAgentRunState, reduceAgentEvent } from './agent-run-state';

const runId = 'run-1' as RunId;
type EventInput = AgentEvent extends infer T
  ? T extends AgentEvent
    ? Omit<T, 'runId' | 'sequence' | 'occurredAt'>
    : never
  : never;

function event(value: EventInput, sequence: number): AgentEvent {
  return {
    ...value,
    runId,
    sequence,
    occurredAt: '2026-07-14T00:00:00.000Z',
  } as AgentEvent;
}

describe('reduceAgentEvent', () => {
  it('replays the same events deterministically', () => {
    const events: AgentEvent[] = [
      event({ type: 'run.started', payload: {} }, 0),
      event({ type: 'run.finished', payload: { summary: 'done' } }, 1),
    ];
    const replay = () => events.reduce(reduceAgentEvent, initialAgentRunState);
    expect(replay()).toEqual(replay());
  });

  it.todo('ignores an already applied sequence');
  it.todo('defines an observable policy for an out-of-order sequence');
  it.todo('enters awaiting-approval after approval.required');
  it.todo('correlates tool completion by callId');
  it.todo('records a safe tool failure');
  it.todo('enters cancelled from a non-terminal state');
  it.todo('enters a terminal run failure');
  it.todo('does not mutate a terminal state after a late event');
});
```

把 8 个 `todo` 实现为真实测试，再补至少 1 个状态边界测试。`as AgentEvent` 只允许出现在测试 fixture；Day 2 用运行时 Schema 消除网络边界的强制断言。

### 10.4 最小 UI

`AgentRunPanel.vue` 只接收 `AgentRunState`，不接收 Provider 原始事件：

```vue
<script setup lang="ts">
import type { AgentRunState } from '@/domain/agent/agent-run-state';

defineProps<{ state: AgentRunState }>();
</script>

<template>
  <section aria-labelledby="agent-run-title">
    <header>
      <h2 id="agent-run-title">诊断执行</h2>
      <output :data-status="state.status">{{ state.status }}</output>
    </header>
    <ol aria-live="polite">
      <li v-for="item in state.timeline" :key="item.key">
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail">{{ item.detail }}</p>
      </li>
    </ol>
  </section>
</template>
```

最终运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

四条命令必须使用真实输出；不能在日志中预写“全绿”。

## 11. 原理反证实验

先把 reducer 中的 exhaustive check 临时替换为宽泛 default，再增加一个新事件，观察编译器为什么无法提醒遗漏；随后恢复 exhaustive check，并保留能够证明新增事件必须处理的类型测试或编译证据。

再构造一个重复 sequence 事件，证明不去重时 Tool 卡片或文本会重复追加。

## 12. 架构证据

`ai-frontend-boundary-day-01.md` 必须包含：

- Model/BFF/Transport/Vue 责任矩阵；
- Agent Event 时序图；
- Agent Run 状态图；
- 浏览器信任边界；
- SDK/Provider 替换时哪些层应该变化；
- 当前使用 fixture、未来接入真实 transport 的演进条件。

## 13. 通过标准

- 九类事件为判别联合，不存在 `data: any`。
- reducer 为纯函数，非法转换有明确策略。
- 至少 8 个状态转换测试全部通过。
- UI 可以展示 text/tool/approval/error/finish，而不展示 Chain of Thought。
- 模型 API key、系统 Prompt 和完整敏感参数不进入前端。
- lint、typecheck、test、build 全部通过。
- AI Review 有接受和拒绝理由，不是复制 AI 结论。

项目证据达到 49/70 后进入教师五连问，执行规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## 14. 掌握标准

脱离 AI 后能够：

1. 解释 AI 前端四层边界。
2. 说明判别联合为什么优于 `type + any`。
3. 手写至少五个 Agent 状态转换。
4. 解释重复 sequence 和晚到事件如何处理。
5. 区分模型提出工具、服务端执行工具和前端展示工具。
6. 说明哪些工作交给 AI 可以提效，哪些必须由人决策。

## 15. 提交物

- `frontend` 工程和 Agent Run 功能代码；
- `docs/architecture/ai-frontend-boundary-day-01.md`；
- `docs/learning/day-01.md`；
- `docs/evidence/day-01/commands.md`；
- `docs/evidence/day-01/ai-review.md`；
- commit：`day-01: define agent event model and run state UI`。

完成时提交：

```text
Day 1 已完成
commit: <hash>
测试输出: <路径或关键结果>
学习日志: <路径>
架构证据: <路径>
AI Review: <路径>
```

## 16. 课末 3 个核心问题

1. 从 `AgentEvent` 进入 `reduceAgentEvent` 再到 `AgentRunPanel`，数据所有权如何变化？为什么 Vue 组件不能直接消费 Provider 原始 chunk？
2. 如果网络把 `tool.started` 至少投递一次且发生乱序，当前 sequence 策略能保证什么、不能保证什么？未来执行有副作用工具时还缺哪一层幂等？
3. 请引用一个测试和一个反证实验，证明状态机比多个布尔量更可靠；当前 fixture 实现距离线上 SSE 断线续传还缺什么？

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. `AgentRunPanel` 在 1 秒内收到 `tool-started`、`approval-required`、`run-finished` 三个事件，其中最后两个乱序，UI 同时显示“已完成”和“等待批准”。请用事件日志、sequence 与 reducer 输入输出定位不可能状态；先禁止终态继续归约止损，再修复判别联合和转换表，并用乱序、重复、晚到事件测试验证。回答必须按“定位证据 -> 临时止损 -> 根因修复 -> 回归验证”组织。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)
2. 200 个并发 Agent Run 通过同一 Transport 进入页面，某个 Provider 新增事件类型后旧 UI 静默忽略，5% 的运行永远停在 `running`。请给出合同版本、exhaustive switch 编译证据和 runId 时间线；先降级为“未知事件/可重试”，再设计 Provider-BFF-Transport-Vue 边界及兼容策略，并以回放 10 万事件验证无悬挂 Run。回答必须按“定位证据 -> 临时止损 -> 根因修复 -> 回归验证”组织。
   依据：[S20 TypeScript unions](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html)
知识映射：事件合同、判别联合、FSM、Tool/Approval UI；从单次归约错误扩展到 Provider 演进。

## 17. PDF 面试题

1. 手写一个简单状态机，模拟 AI Agent 的 Idle、Thinking、Calling_Tool、Responding、Error 状态切换。  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 8 页。
2. 如果从零设计 AI Agent 前端架构，会考虑哪些核心模块？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 9 页。

题目边界：文件名不等于官方题库；答案必须引用今天的事件合同、状态机、测试和边界图。

## 18. 完成后教师五连问

教师核验真实 commit、测试、学习日志、反证记录和架构证据后，再按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”提出 5 道问题。五连问不提前固定，执行规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
