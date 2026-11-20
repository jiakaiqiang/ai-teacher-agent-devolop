import { pathToFileURL } from 'node:url';
import { passages, type Passage } from './gold.js';

// 汉字二元组保留局部词序，字母数字标识作为整体参与匹配。
function terms(text: string) {
  const result = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? []) {
    const chars = Array.from(token);
    if (/^[a-z0-9]/.test(token) || chars.length === 1) result.add(token);
    else for (let i=1;i<chars.length;i++) result.add(chars[i-1]! + chars[i]!);
  }
  return result;
}
export function lexical(query: string, docs: Passage[]) {
  const q = terms(query);
  return docs.map(d => {
    const bag = terms(d.text);
    const overlap = [...q].filter(t => bag.has(t)).length;
    return { id:d.id, score:overlap / Math.max(1,Math.sqrt(q.size * bag.size)) };
  }).filter(d => d.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
}

export function fuse(rankings: string[][], visible: Set<string>, constant = 60) {
  if (!Number.isFinite(constant) || constant <= 0) throw Error('RRF_CONSTANT');
  const scores = new Map<string,number>();
  for (const list of rankings) {
    const eligible = [...new Set(list)].filter(id => visible.has(id));
    eligible.forEach((id,i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (constant + i + 1)));
  }
  return [...scores].sort(([a,x],[b,y]) => y-x || a.localeCompare(b)).map(([id]) => id);
}

export function rerankCode(query: string, ranking: string[], docs: Passage[]) {
  const codesIn = (text: string): string[] => text.toLowerCase().match(/\b[a-z]+\d+\b/g) ?? [];
  const codes = codesIn(query);
  const exact = new Set(docs.filter(d => codes.some(c => codesIn(d.text).includes(c))).map(d => d.id));
  return [...ranking.filter(id => exact.has(id)), ...ranking.filter(id => !exact.has(id))];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const docs = passages.filter(d=>d.group==='A');
  const words=lexical('Q18 打印队列',docs).map(h=>h.id);
  const combined=fuse([['paper','queue'],words],new Set(docs.map(d=>d.id)));
  console.log(JSON.stringify({lexical:words, fused:combined, reranked:rerankCode('Q18',combined,docs)}));
}
