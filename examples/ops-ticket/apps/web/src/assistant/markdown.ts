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
