# D52（周三）：流式Markdown与安全渲染

S2 AI前端 · W8 · 2小时。前置：[D51-会话分支与停止重生成](D51-会话分支与停止重生成.md)及前一天面试题。只在验证工程给出参考实现，用户练习代码由你自己手写。

## 今天要做出什么

将带未闭合代码围栏的报障日志分成两个片段，其中包含 HTML。分别观察生成中和生成结束的 DOM。

实现可流式更新的受限Markdown组件：使用固定版本markdown-it 15.0.3解析token，经白名单转换为Vue文本/VNode；禁止原始HTML和图片加载，链接只允许无认证信息的绝对HTTP(S)。每帧合并更新，终态立即刷新，复杂内容降级纯文本。未闭合围栏按CommonMark解释，不改写模型原文。D55再接到会话界面。

## 今天的目录结构

- `apps/web/package.json`
- `apps/web/src/assistant/frameBuffer.ts`
- `apps/web/src/assistant/markdown.spec.ts`
- `apps/web/src/assistant/markdown.ts`
- `apps/web/src/components/SafeMarkdown.vue`

## 时间安排（120分钟）

回忆10、知识35、动手55、自检与提交20。到100分钟先砍拓展与选做，保留必做契约和两反证；完整回归等待另计。

## 零、闭卷回忆

先回答再展开；前三题按昨天、3天前、7天前复习。复测[错题本](../学习记录/错题本.md)到期项；尚无用户提交，不登记已掌握。

**1. D51：重新生成如何保留原回答？**

<details><summary>答案</summary>

新建兄弟turn/run，保留旧节点及其后代，只切换activeLeaf。

</details>

**2. D49：为何合成字节回放要有独立期望？**

<details><summary>答案</summary>

两个同样错误的实现可能互相一致；先断言中文/状态/事件数量，再比较切点。

</details>

**3. D45：为何不用上游JSON直接驱动界面？**

<details><summary>答案</summary>

供应商结构不稳定且可能含无关字段，先校验映射应用契约；渲染还需独立处理内容安全。

</details>

## 一、知识点与推导

### 1.1 解析边界与输出边界分开

markdown-it只解析token；关闭html/linkify/typographer并限制嵌套。token转换仅保留p/列表/强调/表格等受限元素，原始HTML和图片变文字；代码使用h(code,text)。不调用v-html或innerHTML，也不把token.attrs整包展开。[Vue渲染函数](https://vuejs.org/guide/extras/render-function.html)说明h可以用字符串子节点；信任边界仍由我们决定。

**推导题：html:false就能相信所有链接吗？**

<details><summary>答案</summary>

不能。库的默认校验和本项目策略不同，safeLink另行拒绝javascript/data/协议相对地址/控制字符/反斜杠/URL用户名密码。安全目标不是所有链接都可用。

</details>

### 1.2 未闭合语法不等于无效文档

[CommonMark围栏规则](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)允许围栏延伸到当前文档末尾。四反引号围栏不会被三反引号关闭，代码中的星号也不该计入正文配对。我们把累计原文当临时完整文档，每次有限重解析；不向原文补符号，不执行代码。

**推导题：按空行冻结前面段落永远安全吗？**

<details><summary>答案</summary>

不安全。后到的引用定义可改变前面链接，Setext标题和跨段列表也有上下文。专项用例直接验证引用定义到来后前文变化，因此不声称真正增量语法解析。

</details>

### 1.3 帧合批不消除同步解析成本

frameBuffer只保留最新全文，同一帧多个push只安排一次commit；非streaming立即flush并取消旧帧；卸载dispose防迟到回调。已结束且文本不变的组件不重新parse。rAF仍在主线程运行，长单次解析依旧可能阻塞，不能写异步线程化。

**推导题：结束前最后一帧未执行怎么办？**

<details><summary>答案</summary>

终态watch立即push当前全文并flush，取消等待帧；否则后台页rAF暂停时最后一段可能迟迟不可见。

</details>

### 1.4 限制与可读降级

输入最多32768个UTF-16单元、转换节点4096、解析嵌套20。超限/异常返回截取后的纯文本和可见说明，不让解析错误使整个助手崩溃。图片仅显示alt说明，不触发外网加载；链接新标签配noopener noreferrer。代码高亮、公式、Mermaid本章均未启用。

**推导题：为何不直接用正则删除script？**

<details><summary>答案</summary>

危险内容不限script，URL和属性也可能有执行语义，残缺标签/编码增加绕过空间。这里从不把字符串作为HTML解释，从允许的token创建节点。

</details>

## 二、自己动手（必做）

### 步骤1：安装并构造安全输出（20分钟）

<details><summary>提示1：方向</summary>

保留原始文本，输出层只创建允许的节点。

</details>
<details><summary>提示2：API与文档位置</summary>

先 pnpm --filter @ops-ticket/web add markdown-it@15.0.3 --save-exact；v15自带类型，无需@types包。官方[迁移说明](https://markdown-it.github.io/markdown-it/media/migration_v15.md)。

</details>
<details><summary>提示3：伪代码</summary>

parse→遍历nesting栈→只抽content/href→safeLink白名单→h(tag,安全props,children)。

</details>

### 步骤2：封装帧合批组件（15分钟）

<details><summary>提示1：方向</summary>

合批仅改变展示时机，不吞协议事件，不改Generation.text。

</details>
<details><summary>提示2：API与文档位置</summary>

createFrameBuffer、requestAnimationFrame/cancelAnimationFrame、watch、onScopeDispose。

</details>
<details><summary>提示3：伪代码</summary>

push覆盖latest；最多一个pending；终态flush；卸载取消；组件使用shallowRef保存解析结果。

</details>

### 步骤3：攻击与边界回归（20分钟）

<details><summary>提示1：方向</summary>

检验最终Vue SSR输出，而不只检查解析器配置字符串。

</details>
<details><summary>提示2：API与文档位置</summary>

markdown.spec.ts；html、危险协议、图片、未闭合围栏、引用定义、预算、帧取消。

</details>
<details><summary>提示3：伪代码</summary>

危险输入→renderToString→不得有script/img或危险href；四反引号包含三反引号；同帧3次只提交最后全文；dispose后回调无效。

</details>

三级提示仍无法完成再看第四节，并记一次需要复测。

```powershell
pnpm build
pnpm test
# apps/server 目录
pnpm lint --max-warnings 0
pnpm test:e2e
pnpm test:e2e
pnpm test:e2e
```

也可根目录运行 `pnpm run ci` 顺序执行以上门禁。只重置已授权的隔离测试库和Redis 1号库。shared通过dist导入，改完先build。

安装说明：本机镜像请求曾ECONNRESET；官方源解析整个既有workspace时找不到本机锁定的@types/react19.3.0。最终保留原源，使用 `--prefer-offline --network-concurrency=2` 安装成功，没有改既有依赖版本。v15自带类型：Token由 `ReturnType<typeof md.parse>[number]` 推导，attrGet返回string/number/null，href需先检查字符串；首次构建类型失败记录保留。

## 三、自检、反证与提交

恢复原始 HTML 渲染，哪个断言会发现风险？

先写下预期，临时去掉对应的检查，保存一次失败结果，再恢复并复跑。在提交记录中写明触发操作、预期、实际结果和用时。

## 四、本章完整源码

**apps/web/package.json**

```json
{
  "name": "@ops-ticket/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@ops-ticket/shared": "workspace:*",
    "markdown-it": "15.0.3",
    "vue": "^3.5.44",
    "vue-router": "5.5.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "@vitejs/plugin-vue": "^6.0.10",
    "@vue/tsconfig": "^0.9.1",
    "typescript": "~6.0.3",
    "vite": "^8.3.6",
    "vitest": "^4.1.12",
    "vue-tsc": "^3.3.14"
  }
}
```

**apps/web/src/assistant/frameBuffer.ts**

```ts
// 每帧只提交最新完整原文；合批不等于把同步解析移出主线程。
export function createFrameBuffer(commit: (text: string) => void, schedule: (fn: () => void) => number, cancel: (id: number) => void) {
  let pending: number | undefined; let latest = ''; let disposed = false
  function flush() { if (disposed) return; if (pending !== undefined) cancel(pending); pending = undefined; commit(latest) }
  return {
    push(text: string, immediate = false) { if (disposed) return; latest = text; if (immediate) flush(); else if (pending === undefined) pending = schedule(() => { pending = undefined; if (!disposed) commit(latest) }) },
    flush,
    dispose() { disposed = true; if (pending !== undefined) cancel(pending); pending = undefined },
  }
}
```

**apps/web/src/assistant/markdown.spec.ts**

```ts
import { describe, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { displayMarkdown, markdownVNodes, parseMarkdown, safeLink } from './markdown'
import { createFrameBuffer } from './frameBuffer'
const html = (text: string) => renderToString(createSSRApp(() => h('div', markdownVNodes(parseMarkdown(text)))))
const report = (value: object) => { if (process.env.D52_EVIDENCE_FILE) appendFileSync(process.env.D52_EVIDENCE_FILE, JSON.stringify(value)+'\n') }
describe('受限Markdown与帧合批（D52）', () => {
  it('HTML作为文字且不能创建script或img', async () => { const result=await html('<img src=x onerror=alert(1)><script>1</script>');expect(result).not.toMatch(/<(img|script)\b/);expect(result).toContain('&lt;img');report({case:'escaped-html',html:result}) })
  it('协议白名单拒绝javascript和伪装地址', () => { for(const raw of ['javascript:alert(1)','data:text/html,x','//evil.invalid','https://u:p@example.com','https://example.com\\x','https://exa\nmple.com']) expect(safeLink(raw)).toBeUndefined();expect(safeLink('https://example.com/docs')).toBe('https://example.com/docs') })
  it('Markdown危险链接不能变成可点击危险URL', async () => { for(const raw of ['[x](javascript:alert(1))','[x](data:text/html,x)','[x](//evil.invalid)']) expect(await html(raw)).not.toContain('href=') })
  it('安全链接附带隔离属性', async () => { const result=await html('[资料](https://example.com)');expect(result).toContain('rel="noopener noreferrer"');expect(result).toContain('href="https://example.com/"') })
  it('图片只显示说明不自动加载', async () => { const result=await html('![演示](https://example.com/tracker.png)');expect(result).toContain('[图片：演示]');expect(result).not.toContain('<img') })
  it('未闭合代码围栏已按代码显示且不改原文', async () => { const input='```js\nconst x = "<script>";';const result=await html(input);expect(result).toContain('<pre><code>');expect(result).toContain('&lt;script&gt;');expect(input.endsWith(';')).toBe(true);report({case:'unclosed-fence',html:result}) })
  it('四反引号内三反引号不关闭围栏', async () => { const result=await html('````\n```\n# 代码\n````');expect(result).toContain('```\n# 代码');expect(result).not.toContain('<h1>') })
  it('引用定义可以改变前面链接解析结果', async () => { expect(await html('[文档][id]')).not.toContain('href=');expect(await html('[文档][id]\n\n[id]: https://example.com')).toContain('href=') })
  it('列表表格强调和中文正常展示', async () => { const result=await html('**中文**\n\n- 一\n- 二\n\n|a|b|\n|-|-|\n|1|2|');expect(result).toContain('<strong>中文</strong>');expect(result).toContain('<li>');expect(result).toContain('<table>') })
  it('原文和节点预算拒绝超限', () => { expect(()=>parseMarkdown('x'.repeat(32769))).toThrow('MARKDOWN_LIMIT');expect(()=>parseMarkdown('x\n\n'.repeat(2100))).toThrow('MARKDOWN_LIMIT') })
  it('复杂文档降级纯文本且仍不插入HTML', async () => { const result=displayMarkdown('x\n\n'.repeat(2100)+'<script>1</script>');expect(result.limited).toBe(true);expect(await renderToString(createSSRApp(()=>h('div',markdownVNodes(result.nodes))))).not.toContain('<script>') })
  it('同一帧多个片段只提交最新全文', () => {
    const queued: (()=>void)[]=[];const seen:string[]=[];const b=createFrameBuffer(t=>seen.push(t),fn=>{queued.push(fn);return queued.length},()=>{})
    b.push('一');b.push('一二');b.push('一二三');expect(queued).toHaveLength(1);queued[0]!();expect(seen).toEqual(['一二三']);report({case:'frame-batch',scheduled:queued.length,committed:seen})
  })
  it('终态立即提交并取消待执行帧', () => { const seen:string[]=[];const cancelled:number[]=[];const b=createFrameBuffer(t=>seen.push(t),()=>7,id=>cancelled.push(id));b.push('部分');b.push('完整',true);expect(seen).toEqual(['完整']);expect(cancelled).toEqual([7]) })
  it('dispose取消帧且迟到回调不再提交', () => { let callback=()=>{};const seen:string[]=[];const b=createFrameBuffer(t=>seen.push(t),fn=>{callback=fn;return 1},()=>{});b.push('旧');b.dispose();callback();b.push('迟到',true);expect(seen).toEqual([]) })
})
```

**apps/web/src/assistant/markdown.ts**

```ts
import MarkdownIt from 'markdown-it'
import { h, type VNodeChild } from 'vue'

type Token = ReturnType<typeof md.parse>[number]
export interface MarkdownNode { tag: string; text?: string; href?: string; children: MarkdownNode[] }
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, maxNesting: 20 })
const allowed = new Set(['p','strong','em','s','blockquote','ul','ol','li','table','thead','tbody','tr','th','td'])
export function safeLink(raw: string): string | undefined {
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw)) return undefined
  try { const url = new URL(raw); return url.username || url.password ? undefined : url.href } catch { return undefined }
}

// 只消费token，不生成或插入HTML；HTML、图片和未知节点均不能创建主动内容。
export function parseMarkdown(text: string): MarkdownNode[] {
  if (text.length > 32_768) throw new Error('MARKDOWN_LIMIT')
  let count = 0
  function parse(tokens: Token[]): MarkdownNode[] {
    const root: MarkdownNode[] = []; const stack = [root]
    const add = (node: MarkdownNode) => { if (++count > 4096) throw new Error('MARKDOWN_LIMIT'); stack[stack.length-1]!.push(node) }
    for (const token of tokens) {
      if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue }
      if (token.type === 'inline') { parse(token.children ?? []).forEach(node => stack[stack.length-1]!.push(node)); continue }
      if (token.type === 'text' || token.type.startsWith('html_')) { add({ tag:'text', text:token.content, children:[] }); continue }
      if (token.type === 'image') { add({tag:'text',text:`[图片：${token.content}]`,children:[]}); continue }
      if (token.type === 'fence' || token.type === 'code_block') { add({tag:'pre',text:token.content,children:[]}); continue }
      if (token.type === 'code_inline') { add({tag:'code',text:token.content,children:[]}); continue }
      if (token.type === 'softbreak' || token.type === 'hardbreak') { add({tag:'br',children:[]}); continue }
      if (token.type === 'hr') { add({tag:'hr',children:[]}); continue }
      if (token.nesting === 1) {
        const rawHref = token.attrGet('href')
        const href = token.type === 'link_open' && typeof rawHref === 'string' ? safeLink(rawHref) : undefined
        const tag = token.type === 'link_open' ? (href ? 'a' : 'span') : allowed.has(token.tag) ? token.tag : 'p'
        const node: MarkdownNode = {tag,children:[], ...(href ? {href} : {})}; add(node); stack.push(node.children)
      }
    }
    return root
  }
  return parse(md.parse(text, {}))
}

export function markdownVNodes(nodes: MarkdownNode[]): VNodeChild[] {
  return nodes.map(node => {
    if (node.tag === 'text') return node.text ?? ''
    if (node.tag === 'pre') return h('pre', [h('code', node.text ?? '')])
    if (node.tag === 'code') return h('code', node.text ?? '')
    return h(node.tag, node.tag === 'a' ? { href: node.href, target:'_blank', rel:'noopener noreferrer' } : null, markdownVNodes(node.children))
  })
}

export function displayMarkdown(text: string) {
  try { return { nodes: parseMarkdown(text), limited: false } }
  catch { return { nodes: [{tag:'text',text:text.slice(0,32_768),children:[]}] as MarkdownNode[], limited: true } }
}
```

**apps/web/src/components/SafeMarkdown.vue**

```vue
<script setup lang="ts">
import { defineComponent, h, onScopeDispose, shallowRef, watch } from 'vue'
import { displayMarkdown, markdownVNodes } from '../assistant/markdown'
import { createFrameBuffer } from '../assistant/frameBuffer'
const props = defineProps<{ text: string; streaming?: boolean }>()
const display = shallowRef(displayMarkdown(props.text))
const buffer = createFrameBuffer(text => { display.value = displayMarkdown(text) }, fn => requestAnimationFrame(fn), id => cancelAnimationFrame(id))
watch(() => props.text, text => buffer.push(text, !props.streaming), { flush:'sync' })
watch(() => props.streaming, value => { if (!value) buffer.push(props.text, true) }, { flush:'sync' })
onScopeDispose(buffer.dispose)
const Content = defineComponent(() => () => h('div', { class:'safe-markdown' }, markdownVNodes(display.value.nodes)))
</script>

<template><p v-if="display.limited" role="status">内容较复杂，已按纯文本显示（最多32768个文本单元）</p><Content /></template>

<style>
.safe-markdown { overflow-wrap: anywhere; line-height: 1.65; }
.safe-markdown pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: .75rem; background: #f3f4f6; border-radius: 6px; }
.safe-markdown p { margin: .5rem 0; }
.safe-markdown table { display: block; overflow-x: auto; border-collapse: collapse; }
.safe-markdown th, .safe-markdown td { border: 1px solid #cbd5e1; padding: .3rem; }
.safe-markdown a { color: #155eab; text-decoration: underline; }
</style>
```

## 五、核心面试题

1. 如何安全地展示模型返回的Markdown？ 要点：将模型输出视为不可信文本。关闭原始HTML，token白名单转Vue VNode，仅文本子节点承载内容，属性只手动允许安全href与固定target/rel；图片退成说明，不加载远程资源。追问：解析库升级后还安全么？需复核token API与安全测试，不能因为当前通过就永久信任插件。
2. 未闭合代码块是否需要先补三个反引号？ 要点：不需要，本实现按CommonMark把围栏延伸到当前文档末尾，代码内容保持文本；原文不改写。围栏长度和标记种类均有语义，简单奇偶计数错误。追问：四反引号里的三反引号？仍是代码内容，测试已覆盖。
3. rAF合批与真正增量解析差别是什么？ 要点：合批减少调用频次，仍对有界累计全文解析。增量解析要维护语法状态和依赖关系，处理后来引用定义改变前文等问题。追问：为什么不冻结所有空行前内容？不能证明那些块语义永远不受后文影响。

完整原题、答案、补充和网络来源见[D52面试题](D52-面试题.md)。

## 六、个人建议

你熟悉组件封装，今天重点审查输出边界：有没有传入innerHTML，有没有展开任意attrs，链接有没有独立策略。讲性能时明确rAF在哪个线程执行，并用“减少重复parse次数”代替未经测量的流畅度承诺。

## 七、拓展知识点

选做：在Web Worker里解析并设计序号取消、序列化预算；语法高亮只对完成代码块按需加载。加入任何Markdown插件前重新检查节点/属性白名单和大小限制。浏览器真实渲染与键盘验收在D55。

## 本文验证范围

本机复跑 Vue 工程 117 项测试通过，覆盖分支、渲染、滚动、卡片及会话组件。 [后端接口记录](../.cache/验证/新版验收/D56-http.log) · [助手单元记录](../.cache/验证/新版验收/D56-assistant-unit.log) · [前端记录](../.cache/验证/新版验收/D56-web.log)。

助手流使用本地受控上游。端到端浏览器交互、真实模型诊断质量和长时连接需另验。
