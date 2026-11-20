import { readFile, readdir, mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { parseFragment, serialize } from 'parse5';

export const app = fileURLToPath(new URL('.', import.meta.url));
export const source = path.resolve(app, '../../../docs/output/新对话-2026-11-13/教程');
export const dist = path.join(app, 'dist');
const hash = text => createHash('sha256').update(text).digest('hex');

export async function build() {
  const names = (await readdir(source)).filter(name => /^D\d+-.+\.md$/.test(name));
  const files = await Promise.all(names.map(async name => ({ name, text: await readFile(path.join(source, name), 'utf8'), modified: (await stat(path.join(source, name))).mtime.toISOString() })));
  const byName = new Map(files.map(file => {
    const [, day, title] = file.name.match(/^D(\d+)-(.+)\.md$/);
    return [file.name, { day: Number(day), kind: title === '面试题' ? 'interview' : 'lesson', id: `d${day.padStart(3, '0')}-${title === '面试题' ? 'interview' : 'lesson'}` }];
  }));
  const markdown = new MarkdownIt({ html: true, linkify: true });
  // 只保留讲义需要的 HTML；去掉脚本、嵌入页面、事件和本机链接。
  function sanitize(html) {
    const tree = parseFragment(html);
    const forbidden = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'base']);
    function visit(node) {
      if (node.childNodes) {
        node.childNodes = node.childNodes.filter(child => !forbidden.has(child.tagName));
        node.childNodes.forEach(visit);
      }
      if (!node.attrs) return;
      node.attrs = node.attrs.filter(attr => !/^on/i.test(attr.name) && !['style', 'srcdoc'].includes(attr.name));
      for (const attr of node.attrs) {
        if (!['href', 'src', 'xlink:href'].includes(attr.name)) continue;
        const value = attr.value.trim();
        if (value.startsWith('#')) continue;
        if (/^https?:\/\//i.test(value)) continue;
        if (attr.name === 'href' && value.startsWith('?doc=')) continue;
        if (attr.name === 'href') {
          const [target, anchor] = value.split('#');
          let decoded; try { decoded = decodeURIComponent(target); } catch { decoded = target; }
          const entry = !decoded.includes('..') && byName.get(path.basename(decoded));
          if (entry) { attr.value = `?doc=${entry.id}${anchor ? `#${anchor}` : ''}`; continue; }
        }
        attr.name = 'data-local-reference';
        attr.value = value;
        node.attrs.push({ name: 'title', value: '此引用为本地资料，未发布到阅读站' });
      }
      if (node.tagName === 'a' && node.attrs.some(attr => attr.name === 'href' && /^https?:/.test(attr.value))) {
        node.attrs.push({ name: 'target', value: '_blank' }, { name: 'rel', value: 'noopener noreferrer' });
      }
    }
    visit(tree);
    return serialize(tree);
  }
  await mkdir(path.join(dist, 'content'), { recursive: true });
  const documents = [];
  for (const file of files) {
    const entry = byName.get(file.name);
    const tokens = markdown.parse(file.text, {});
    const headings = [];
    const slugs = new Map();
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const title = (inline.children ?? []).filter(token => ['text', 'code_inline'].includes(token.type)).map(token => token.content).join('') || inline.content;
      const base = title.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section';
      const count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      tokens[i].attrSet('id', id);
      if (tokens[i].tag === 'h2') headings.push({ id, title });
    }
    const title = file.text.match(/^#\s+(.+)$/m)?.[1] ?? file.name.replace(/\.md$/, '');
    const document = { ...entry, title, headings, html: sanitize(markdown.renderer.render(tokens, markdown.options, {})), modified: file.modified };
    const rendered = JSON.stringify(document);
    // 地址随实际发布内容改变，浏览器缓存不会掩盖正文或渲染修正。
    const digest = hash(rendered).slice(0, 12);
    const url = `content/${entry.id}-${digest}.json`;
    await writeFile(path.join(dist, url), rendered);
    documents.push({ ...entry, title, label: file.name.replace(/^D\d+-|\.md$/g, ''), url, modified: file.modified });
  }
  documents.sort((a, b) => a.day - b.day || (a.kind === 'lesson' ? -1 : 1));
  const assets = ['index.html', 'reader.css', 'reader.js'];
  const assetTexts = await Promise.all(assets.map(name => readFile(path.join(app, name), 'utf8')));
  const revision = hash(JSON.stringify(documents) + assetTexts.join(''));
  const modified = documents.map(doc => doc.modified).sort().at(-1);
  const manifest = { revision, modified, days: new Set(documents.map(doc => doc.day)).size, documents };
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest));
  for (const name of assets) await copyFile(path.join(app, name), path.join(dist, name));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build();
  console.log(JSON.stringify({ days: result.days, documents: result.documents.length, revision: result.revision, dist }));
}
