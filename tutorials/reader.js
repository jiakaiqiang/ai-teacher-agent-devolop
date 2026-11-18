/* 站点只读取公开课程内容，阅读偏好保存在当前浏览器。 */
const $ = id => document.getElementById(id);
let manifest;
let current;
let loadNumber = 0;
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
function sidebar() {
  const query = $('search').value.trim().toLowerCase();
  const weeks = new Map();
  for (const doc of manifest.documents) {
    const searchText = `${doc.title} d${doc.day} d${String(doc.day).padStart(2, '0')}`.toLowerCase();
    if (query && !searchText.includes(query)) continue;
    const week = Math.ceil(doc.day / 7);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(doc);
  }
  $('chapters').innerHTML = [...weeks].map(([week, docs]) => `<details class="week" ${query || docs.some(doc => doc.id === current?.id) ? 'open' : ''}><summary>第 ${String(week).padStart(2, '0')} 周<span>D${(week - 1) * 7 + 1}—D${week * 7}</span></summary>${docs.map(doc => `<a class="chapter ${doc.kind}" href="?doc=${doc.id}" ${doc.id === current?.id ? 'aria-current="page"' : ''}>${doc.kind === 'lesson' ? `<span class="day">D${String(doc.day).padStart(2, '0')}</span>${escapeHtml(doc.label)}` : '面试题与参考解答'}</a>`).join('')}</details>`).join('') || '<p class="empty">没有找到匹配的课程标题</p>';
  $('count').textContent = `${manifest.days} 天 · ${manifest.documents.length} 篇`;
}
async function load(id, { focus = false, preserveScroll = false } = {}) {
  const sequence = ++loadNumber;
  const entry = manifest.documents.find(doc => doc.id === id);
  if (!entry) {
    $('article').innerHTML = '<h1>这份教程尚未发布</h1><p>请从左侧目录选择已发布的课程。</p>';
    $('article').setAttribute('aria-busy', 'false');
    $('contents').hidden = true;
    $('pagination').innerHTML = '';
    return;
  }
  $('article').setAttribute('aria-busy', 'true');
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error('正文暂时无法加载，请刷新页面重试。');
  const doc = await response.json();
  if (sequence !== loadNumber) return;
  current = entry;
  document.title = `${doc.title} · AI 工程实践`;
  $('article').innerHTML = doc.html;
  $('article').setAttribute('aria-busy', 'false');
  $('breadcrumb').textContent = `第 ${Math.ceil(doc.day / 7)} 周 / D${String(doc.day).padStart(2, '0')} / ${doc.kind === 'lesson' ? '实践讲义' : '面试题'}`;
  $('document-meta').textContent = `更新于 ${date(doc.modified)}`;
  $('heading-links').innerHTML = doc.headings.map(heading => `<a href="#${encodeURIComponent(heading.id)}">${escapeHtml(heading.title)}</a>`).join('');
  $('contents').hidden = !doc.headings.length;
  $('article').querySelectorAll('table').forEach(table => {
    const wrap = document.createElement('div'); wrap.className = 'table-wrap'; table.before(wrap); wrap.append(table);
  });
  $('article').querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;
    const tools = document.createElement('div'); tools.className = 'code-tools';
    const language = document.createElement('span'); language.textContent = code.className.replace('language-', '') || '代码';
    const button = document.createElement('button'); button.className = 'copy'; button.textContent = '复制'; button.setAttribute('aria-label', '复制此代码块');
    button.onclick = async () => { try { await navigator.clipboard.writeText(code.textContent); button.textContent = '已复制'; } catch { button.textContent = '请选中复制'; } setTimeout(() => { button.textContent = '复制'; }, 1800); };
    tools.append(language, button); pre.prepend(tools);
  });
  const index = manifest.documents.findIndex(item => item.id === id);
  $('pagination').innerHTML = [manifest.documents[index - 1], manifest.documents[index + 1]].map((item, position) => item ? `<a href="?doc=${item.id}"><small>${position ? '下一篇 →' : '← 上一篇'}</small>${escapeHtml(item.title)}</a>` : '<span></span>').join('');
  sidebar();
  if (!preserveScroll) {
    if (location.hash) { let anchor; try { anchor = decodeURIComponent(location.hash.slice(1)); } catch {} document.getElementById(anchor)?.scrollIntoView(); }
    else window.scrollTo(0, 0);
  }
  if (focus) $('article').focus({ preventScroll: true });
}
function error(message) { $('notice').hidden = false; $('notice').textContent = message; $('article').setAttribute('aria-busy', 'false'); }
async function refresh(initial = false) {
  const response = await fetch(`manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('课程目录暂时无法加载，请稍后刷新。');
  const next = await response.json();
  const previous = manifest;
  manifest = next;
  $('sync-status').textContent = `${manifest.days} 天课程 · ${date(manifest.modified)} 更新`;
  if (initial) {
    sidebar();
    await load(new URLSearchParams(location.search).get('doc') || 'd001-lesson');
  } else if (previous.revision !== next.revision) {
    sidebar();
    const updated = next.documents.find(doc => doc.id === current?.id);
    if (updated && updated.url !== current.url) await load(current.id, { preserveScroll: true });
    error('课程已同步更新，左侧目录已刷新。');
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="?doc="]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  history.pushState(null, '', link.href);
  $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false');
  load(new URL(link.href).searchParams.get('doc'), { focus: true }).catch(err => error(err.message));
});
$('menu').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('menu').setAttribute('aria-expanded', String(open)); };
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('sidebar').classList.contains('open')) { $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false'); $('menu').focus(); } });
$('search').oninput = sidebar;
window.onpopstate = () => load(new URLSearchParams(location.search).get('doc') || 'd001-lesson').catch(err => error(err.message));
refresh(true).catch(err => error(err.message));
setInterval(() => { if (!document.hidden && manifest) refresh().catch(() => {}); }, 60000);
