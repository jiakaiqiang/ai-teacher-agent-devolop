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
