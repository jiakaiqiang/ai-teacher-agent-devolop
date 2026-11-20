# D48（周六）：工单 AI 排查助手集成

S2 AI 前端 · W7 · 5 小时。前置：[D47 前端读取与中断状态](D47-前端读取与中断状态.md)。沿用 Vue 3.5.44、Vite 8.3.8、Nest 12、Vitest 4.1.12，无新增依赖。只操作模拟工单。

## 今天要做出什么

打开自己的工单详情，依次演示生成完成、收到半段后断开、生成中离开详情。

工单详情页能提出问题、看到分段建议、停止生成，并明确区分完成、截断和中断。切工单、离开详情和退出登录后旧内容不会残留。今天把 W7 的协议、权限、取消和界面串起来，不把预设模拟文本称为真实模型结果。

## 今天的目录结构

- `apps/server/src/assistant/mock-stream.spec.ts`
- `apps/server/src/assistant/mock-stream.ts`
- `apps/server/src/assistant/model.source.ts`
- `apps/web/src/components/AssistantPanel.vue`
- `apps/web/src/composables/useTicketAssistant.spec.ts`
- `apps/web/src/composables/useTicketAssistant.ts`
- `apps/web/src/views/TicketDetailView.vue`

## 时间安排（300 分钟）

| 环节 | 分钟 | 产出 |
|---|---:|---|
| 闭卷回忆与错题 | 15 | 解释取消、权限、指标边界 |
| 集成设计与推导 | 45 | 画清三层生命周期 |
| 手写组件与接线 | 85 | 问题、生成、停止、工单隔离 |
| 模拟源与测试 | 45 | 可观察分段和取消 |
| 浏览器验收与两反证 | 70 | 操作记录、失败与恢复证据 |
| W7小结与提交 | 40 | 演示、边界清单 |

必做纯文本、状态语义、取消与两反证。到第 4 小时仍未完成，先砍选做截图美化、渲染节流和自动滚动；保留权限和终止检查。完整接口三轮等待可以另计，不把未跑项目勾为完成。

## 零、开头回忆（15 分钟）

**1. D47：stop、reset、dispose 分别做什么？**

<details><summary>答案</summary>

stop 取消当前请求、失效序号、保留部分文字；reset 取消并清内容与状态；dispose 再解除监听、禁止继续发起。旧回调和 finally 都需检查归属。

</details>

**2. D45：在哪一步检查工单范围？**

<details><summary>答案</summary>

打开模型流之前把 ticketNo 与用户范围合并查询。不可见返回404且不调用上游；页面隐藏入口不能替代后端检查。

</details>

**3. D41：为什么 HTTP 200 不能证明 AI 输出成功？**

<details><summary>答案</summary>

流头发出后仍可能中断；HTTP指标描述连接层，应用done/error描述生成语义。首字延迟、终止原因等需要单独采集，本周尚未接AI专项指标。

</details>

查看[错题本](../学习记录/错题本.md)到期项；当前尚无用户提交批改，不能把教程生成当作已掌握。

## 一、集成知识与推导（45 分钟）

### 1.1 三层生命周期各有责任

```text
AssistantPanel：问题与状态展示
  → useTicketAssistant：工单号变化 / 作用域结束
    → useAssistant：请求序号 / 身份变化 / start stop reset
      → streamAssistant：POST JWT / SSE契约 / reader释放
        → Nest：权限 / 工单范围 / 上游取消 / 总与空闲预算
```

工单路由常复用同一页面实例，单靠卸载不够。useTicketAssistant 监听传入getter，工单号变化就同步reset。onScopeDispose在组件作用域结束时dispose；测试用effectScope复现，不需要新增组件测试依赖。详情重新加载时原组件也可能被v-if移除，两条清理路径均安全。

**推导题**：只给组件加`:key="ticketNo"`是否就足够？

<details><summary>答案</summary>

key能让该位置重新创建实例，但仍要取消资源、保护迟到结果，也不解决身份变化。本章把资源所有权写进组合式函数，使组件复用和卸载路径都有明确契约。watch的同步刷新仅用于低频工单号变化；不是建议把所有watch都改为sync。参见[Vue watch时序与清理](https://vuejs.org/guide/essentials/watchers.html)。

</details>

### 1.2 模拟流要有可观察的时间行为

D45把整段响应一次放进Response，能验证协议，却很难演示停止。今天每段延迟350ms，四段正文和一个终止块逐次pull；AbortSignal或reader.cancel清timer和listener，结束挂起pull。已取消signal不创建计时器。

```text
读第1段 → 等350ms → 正文1 → 等下一段
                         ↓ 用户停止
                  abort → 清计时器 → reader拒绝 → 资源释放
```

这是预设演示，不代表模型每350ms生成一个token。fake timers验证资源清理，真实浏览器验证能观察到部分结果；两种证据各自有边界。

**推导题**：只设置ended=true，不clearTimeout会怎样？

<details><summary>答案</summary>

正文可能不再写入，但计时器仍占用资源直到触发。反证B直接断言取消后的timer数量，不用“页面没文字变化”推断资源已释放。

</details>

### 1.3 展示结果时保留语义

生成中禁用重复提交，输入readonly仍可读。停止保留文字并把焦点移回生成按钮；自然结束不主动抢焦点。status区域只播报状态，正文不逐字放进live区域；未用读屏器实测，不能声称完整无障碍验收。

| 收尾 | 显示 | 是否完整 |
|---|---|---|
| done.stop | 生成完成 | 协议完整，内容正确性仍需人工核实 |
| done.length | 已达到长度限制 | 否 |
| 用户stop | 已停止，保留部分内容 | 否 |
| error/EOF且有正文 | 生成中断，保留部分内容 | 否 |
| HTTP失败且无正文 | 生成失败 | 否 |

**推导题**：停止之后再点生成，是恢复还是重做？

<details><summary>答案</summary>

新POST、新请求序号，清掉上次答案后重新生成。本周没有持久生成任务与游标，不支持从断点续写。生产模型可能重新产生费用，因此不能自动循环重试。

</details>

### 1.4 纯文本先完成可验证闭环

正文使用Vue插值、white-space:pre-wrap、overflow-wrap:anywhere。`<img ...>`被作为文字展示，不交给v-html。Vue自动转义的范围见[官方安全说明](https://vuejs.org/guide/best-practices/security.html)。这不等于完整AI安全体系，Prompt注入、内容真实性、工具权限另有层次。

**推导题**：收到合法delta，就可以把其中HTML直接插入吗？

<details><summary>答案</summary>

schema只能证明字段类型，不能证明HTML可信。本章仅纯文本；W8再决定Markdown解析、链接策略与消毒，不能把语法解析当安全清洗。

</details>

## 二、动手集成（130 分钟）

### 步骤1：接工单作用域（25分钟）

<details><summary>提示1：方向</summary>

把工单getter与useAssistant组合，不让通用请求层依赖路由。

</details>
<details><summary>提示2：API与位置</summary>

watch(getter, reset, {flush:'sync'})，onScopeDispose(dispose)。generate使用执行当下的ticketNo。

</details>
<details><summary>提示3：骨架</summary>

创建assistant→监听工单变化→注册作用域清理→返回assistant与generate；测试scope.stop后再发迟到delta必须无效。

</details>

### 步骤2：写面板并挂详情（60分钟）

<details><summary>提示1：方向</summary>

label、textarea、form、两个button、状态和答案即可。全部状态来自D47模块，不维护另一套loading。

</details>
<details><summary>提示2：API与验收</summary>

props.ticketNo传getter；停止后nextTick再focus；required/maxLength配合服务端校验，纯空白禁生成。status与alert分别表达状态和错误。

</details>
<details><summary>提示3：骨架</summary>

submit.prevent→generate(question)；stop→nextTick→生成按钮focus；mode为mock时显示模拟输出；正文插值且保留换行。详情用当前route.params.ticketNo传参。

</details>

### 步骤3：实现可取消模拟源（45分钟）

<details><summary>提示1：方向</summary>

ReadableStream.pull每次只安排一个延迟块，统一cleanup管理timer、listener、挂起promise。

</details>
<details><summary>提示2：API与测试</summary>

start监听signal，pull返回Promise，cancel执行cleanup；vi.useFakeTimers和getTimerCount检查取消，不靠真实睡眠。结束块必须含finish_reason及[DONE]。

</details>
<details><summary>提示3：骨架</summary>

start预检signal→pull计时→enqueue→末块cleanup并close；abort cleanup并controller.error；reader.cancel只cleanup。先过正常4段、取消、提前取消，再做反证。

</details>

### 步骤4：浏览器与完整门禁

在自己的工程用模拟工单演示。作者在验证工程用临时本机工具将资源限定到ops_ticket_test和两个Redis的1号库，真实服务走Vite代理；先关闭浏览器应用服务再执行会重置测试库的完整门禁。

```powershell
pnpm --filter @ops-ticket/server test src/assistant/mock-stream.spec.ts
pnpm --filter @ops-ticket/web test src/composables/useTicketAssistant.spec.ts
pnpm run ci
```

常见问题：不要让页面服务和e2e同时使用正被重置的库。作者浏览器登录态经真实登录/权限接口取得后写入sessionStorage，仅用于助手验收，不构成登录表单测试。故障UI用响应夹具，明确区分与服务端故障测试。

## 三、自检、反证与提交

重新打开详情还能看到上一张单的建议吗？

先写下预期，临时去掉对应的检查，保存一次失败结果，再恢复并复跑。在提交记录中写明触发操作、预期、实际结果和用时。

## 四、本章完整源码

**apps/server/src/assistant/mock-stream.spec.ts**

```ts
import { appendFileSync } from 'node:fs';
import { mockStream } from './mock-stream.js';
import { parseChatStream } from './chat.stream.js';

describe('分段模拟源（D48）', () => {
  afterEach(() => vi.useRealTimers());
  it('分段输出且完整终止', async () => {
    vi.useFakeTimers(); const events: object[] = [];
    const task = (async () => { for await (const event of parseChatStream(mockStream(new AbortController().signal))) events.push(event); })();
    await vi.runAllTimersAsync(); await task;
    expect(events).toHaveLength(5); expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
    expect(vi.getTimerCount()).toBe(0);
    if (process.env.D48_EVIDENCE_FILE) appendFileSync(process.env.D48_EVIDENCE_FILE, JSON.stringify({ case: 'paced-mock', events: events.length, timersAfter: vi.getTimerCount() }) + '\n');
  });
  it('请求取消立即清计时器并拒绝挂起读取', async () => {
    vi.useFakeTimers(); const abort = new AbortController(); const reader = mockStream(abort.signal).getReader();
    const read = reader.read(); const rejection = expect(read).rejects.toThrow('模拟取消');
    await Promise.resolve(); expect(vi.getTimerCount()).toBe(1); abort.abort(new Error('模拟取消'));
    expect(vi.getTimerCount()).toBe(0); await rejection; reader.releaseLock();
  });
  it('reader取消清计时器且后续read结束', async () => {
    vi.useFakeTimers(); const reader = mockStream(new AbortController().signal).getReader();
    const read = reader.read(); await Promise.resolve(); await reader.cancel();
    expect(await read).toEqual({ value: undefined, done: true }); expect(vi.getTimerCount()).toBe(0); reader.releaseLock();
  });
  it('已取消的signal不创建计时器', async () => {
    vi.useFakeTimers(); const abort = new AbortController(); abort.abort(new Error('提前取消'));
    const reader = mockStream(abort.signal).getReader(); await expect(reader.read()).rejects.toThrow('提前取消');
    expect(vi.getTimerCount()).toBe(0); reader.releaseLock();
  });
});
```

**apps/server/src/assistant/mock-stream.ts**

```ts
// 分段演示源：每次消费前等待，取消时清除计时器，不访问外部模型。
export function mockStream(signal: AbortSignal, delayMs = 350): ReadableStream<Uint8Array> {
  const pieces = ['这是模拟排查建议。', '\n1. 核对报障时间和日志中的超时记录。', '\n2. 对比近期变更与监控曲线。', '\n3. 记录证据后由人工决定下一步。'];
  const frames = pieces.map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
  frames.push('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  let index = 0; let ended = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (() => void) | undefined; let abort: () => void = () => {};
  const cleanup = () => { ended = true; clearTimeout(timer); signal.removeEventListener('abort', abort); settle?.(); settle = undefined; };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => { if (ended) return; cleanup(); controller.error(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    pull(controller) {
      if (ended) return;
      return new Promise<void>((resolve) => {
        settle = resolve;
        timer = setTimeout(() => {
          if (!ended) {
            controller.enqueue(new TextEncoder().encode(frames[index++]!));
            if (index === frames.length) { cleanup(); controller.close(); }
          }
          settle = undefined; resolve();
        }, delayMs);
      });
    },
    cancel() { cleanup(); },
  });
}
```

**apps/server/src/assistant/model.source.ts**

```ts
import { Injectable } from '@nestjs/common';
import { ChatClient, ModelError, type ChatMessage } from './chat.client.js';
import { readModelConfig } from './model.config.js';
import { mockStream } from './mock-stream.js';

@Injectable()
export class ModelSource {
  async open(messages: ChatMessage[], signal: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; mode: 'mock' | 'model' }> {
    const config = readModelConfig();
    if (!config) {
      // W7默认可演示夹具；这是预设文本，不冒充模型推理，也不执行任何操作。
      return { body: mockStream(signal), mode: 'mock' };
    }
    const response = await new ChatClient(config).open(messages, true, signal);
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
      await response.body?.cancel(); throw new ModelError('MODEL_PROTOCOL_ERROR');
    }
    return { body: response.body, mode: 'model' };
  }
}
```

**apps/web/src/components/AssistantPanel.vue**

```vue
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTicketAssistant } from '../composables/useTicketAssistant'
const props = defineProps<{ ticketNo: string }>()
const { text, status, mode, error, busy, generate, stop } = useTicketAssistant(() => props.ticketNo)
const question = ref('请给出这张模拟工单的排查步骤'); const generateButton = ref<HTMLButtonElement>()
const labels = { idle: '等待提问', connecting: '正在连接…', streaming: '正在生成…', completed: '生成完成', truncated: '已达到长度限制，内容不完整', stopped: '已停止，保留部分内容', interrupted: '生成中断，保留部分内容', error: '生成失败' }
const statusText = computed(() => labels[status.value])
watch(() => props.ticketNo, () => { question.value = '请给出这张模拟工单的排查步骤' })
async function stopAndFocus() { stop(); await nextTick(); generateButton.value?.focus() }
</script>

<template>
  <section class="assistant" aria-labelledby="assistant-heading">
    <h3 id="assistant-heading">AI 排查助手</h3>
    <p id="assistant-help" class="muted">仅用于模拟工单练习。建议需人工核实，不会自动执行操作。</p>
    <form @submit.prevent="generate(question)">
      <label for="assistant-question">排查问题（1—1000 字）</label>
      <textarea id="assistant-question" v-model="question" required maxlength="1000" rows="3"
        :readonly="busy" aria-describedby="assistant-help assistant-error" />
      <div class="controls">
        <button ref="generateButton" type="submit" :disabled="busy || !question.trim()">生成建议</button>
        <button type="button" :disabled="!busy" @click="stopAndFocus">停止生成</button>
        <span v-if="mode === 'mock'" class="badge">模拟输出</span>
        <span v-else-if="mode === 'model'" class="badge">模型输出</span>
      </div>
    </form>
    <p role="status" aria-live="polite">{{ statusText }}</p>
    <p id="assistant-error" class="error" role="alert">{{ error }}</p>
    <!-- 只渲染文本；逐段内容不放进live区域，避免不断重复播报。 -->
    <div class="answer" aria-label="排查建议" :aria-busy="busy">{{ text || '生成后的建议会显示在这里。' }}</div>
  </section>
</template>

<style scoped>
.assistant { margin-top: 24px; border-top: 1px solid #d0d7de; padding-top: 16px; min-width: 0; }
h3 { margin: 0 0 8px; }
.muted { color: #57606a; font-size: 14px; }
label { display: block; margin-bottom: 6px; }
textarea { box-sizing: border-box; width: 100%; padding: 8px; font: inherit; resize: vertical; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
button { min-height: 36px; padding: 6px 12px; }
button:focus-visible, textarea:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }
.badge { padding: 3px 8px; background: #ddf4ff; color: #0550ae; border-radius: 4px; font-size: 13px; }
.answer { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #f6f8fa; line-height: 1.7; min-height: 48px; }
.error { color: #cf222e; }
.error:empty { display: none; }
</style>
```

**apps/web/src/composables/useTicketAssistant.spec.ts**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'
import { appendFileSync } from 'node:fs'
import type { AssistantEvent } from '@ops-ticket/shared'
import { setSession } from '../api/session'
import type { streamAssistant } from '../api/assistant'
import { useTicketAssistant } from './useTicketAssistant'
beforeEach(() => setSession({ accessToken: 'fake', user: { username: 'alice', displayName: '模拟' } }))
afterEach(() => setSession(null))
function harness() {
  const calls: { ticket: string; signal: AbortSignal; emit: (event: AssistantEvent) => void; resolve: () => void }[] = []
  const transport: typeof streamAssistant = (ticket, _q, _t, signal, emit) => new Promise((resolve) => calls.push({ ticket, signal, emit, resolve }))
  const ticket = ref('T1'); const scope = effectScope(); const a = scope.run(() => useTicketAssistant(() => ticket.value, transport))!
  return { calls, ticket, scope, a }
}
describe('工单助手接线（D48）', () => {
  it('切工单立即清空取消且不接受迟到片段', async () => {
    const { calls, ticket, scope, a } = harness(); const task = a.generate('模拟'); calls[0]!.emit({ type: 'delta', text: '旧工单内容' }); ticket.value = 'T2'
    expect(a.text.value).toBe(''); expect(calls[0]!.signal.aborted).toBe(true)
    calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await task; expect(a.text.value).toBe('')
    if (process.env.D48_EVIDENCE_FILE) appendFileSync(process.env.D48_EVIDENCE_FILE, JSON.stringify({ case: 'ticket-switch', text: a.text.value, aborted: calls[0]!.signal.aborted }) + '\n')
    scope.stop()
  })
  it('新生成使用当前工单号', async () => {
    const { calls, ticket, scope, a } = harness(); ticket.value = 'T2'; const task = a.generate('模拟'); expect(calls[0]!.ticket).toBe('T2')
    calls[0]!.emit({ type: 'done', finishReason: 'stop' }); calls[0]!.resolve(); await task; scope.stop()
  })
  it('作用域结束取消且不接受结果', async () => {
    const { calls, scope, a } = harness(); const task = a.generate('模拟'); scope.stop(); expect(calls[0]!.signal.aborted).toBe(true)
    calls[0]!.emit({ type: 'delta', text: '迟到' }); calls[0]!.resolve(); await task; expect(a.text.value).toBe('')
  })
});
```

**apps/web/src/composables/useTicketAssistant.ts**

```ts
import { onScopeDispose, watch } from 'vue'
import { useAssistant } from './useAssistant'
import { streamAssistant } from '../api/assistant'

// 组件复用时工单号仍可能变化，不能只依赖卸载清理。
export function useTicketAssistant(ticketNo: () => string, transport = streamAssistant) {
  const assistant = useAssistant(transport)
  watch(ticketNo, () => assistant.reset(), { flush: 'sync' })
  onScopeDispose(() => assistant.dispose())
  return { ...assistant, generate: (question: string) => assistant.start(ticketNo(), question) }
}
```

**apps/web/src/views/TicketDetailView.vue**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import AssistantPanel from '../components/AssistantPanel.vue'
import TicketFeedback from '../components/TicketFeedback.vue'
import { useRoute } from 'vue-router'
import type { TicketDetail } from '@ops-ticket/shared'
import { getTicket } from '../api/tickets'
const refresh = ref(0)
const route = useRoute()
const ticket = ref<TicketDetail>()
const error = ref('')
watch([() => String(route.params.ticketNo), refresh], async ([no], _, cleanup) => {
  const controller = new AbortController()
  cleanup(() => controller.abort())
  ticket.value = undefined
  error.value = ''
  try {
    const result = await getTicket(no, controller.signal)
    if (!controller.signal.aborted) ticket.value = result
  } catch {
    if (!controller.signal.aborted) error.value = '工单加载失败'
  }
}, { immediate: true })
</script>
<template>
  <RouterLink to="/">返回工单列表</RouterLink>
  <p v-if="error" role="alert">{{ error }}</p>
  <article v-if="ticket"><h2>{{ ticket.ticketNo }} · {{ ticket.title }}</h2>
    <p>{{ ticket.company.name }} · {{ ticket.category.name }} · {{ ticket.department.name }}</p>
    <p>{{ ticket.description }}</p><h3>报障材料</h3>
    <pre v-for="(m, i) in ticket.materials" :key="i">{{ m.logText }}</pre>
  
    <h3>处理记录</h3>
    <ol><li v-for="(event,i) in ticket.events" :key="i">{{event.actor?.displayName ?? 'Agent'}} · {{event.action}} · {{event.toStatus}}</li></ol>
    <AssistantPanel v-if="ticket.canConfirm" :ticket-no="ticket.ticketNo" />
    <TicketFeedback :can-confirm="ticket.canConfirm" :ticket-no="ticket.ticketNo" :status="ticket.status" :version="ticket.version" @reload="refresh++"/>
  </article>
</template>
```

## 五、核心面试题

1. 组件复用时如何防止串工单？要点：工单getter、同步reset、作用域dispose、旧序号。
2. 怎么证明停止按钮有效？要点：部分保留、状态/焦点、后端取消、timer清理分别验证。
3. 流式文本如何安全展示？要点：插值转义、大小限制、终态、与Markdown安全的区别。

完整题目见[D48面试题](D48-面试题.md)。

## 六、个人建议

你已经有7年Vue经验，今天不要把时间花在重新写复杂聊天框。面试演示抓住“正确归属、正确结束、资源释放”三件事：先展示停止保留半段，再切工单，最后解释为什么不能把EOF标完成。说明模拟与真实模型的界限，比展示一段流畅文字更可信。

## 七、拓展知识点

| 方向 | 为什么学 | 到什么程度与时机 |
|---|---|---|
| Markdown与代码块 | 阅读体验与注入边界 | W8加入解析、消毒、链接策略后再测 |
| 渲染合批与虚拟列表 | 高频长会话减少渲染开销 | 先测瓶颈；今天只有最多32Ki字符的单答 |
| AI专项指标 | 首字、总时长、终止原因与成本 | 后续模型网关；HTTP指标不足 |
| 独立客户端预算 | 代理悬挂时自动结束等待 | 当前依赖服务端预算及手动停止，尚未实现 |

## 本文验证范围

本机复跑助手协议与流生命周期 42 项，10 个 HTTP 测试文件共 25 项通过。Vue 工程 117 项测试通过。 [后端接口记录](../.cache/验证/新版验收/D56-http.log) · [助手单元记录](../.cache/验证/新版验收/D56-assistant-unit.log) · [前端记录](../.cache/验证/新版验收/D56-web.log)。

助手流使用本地受控上游。端到端浏览器交互、真实模型诊断质量和长时连接需另验。
