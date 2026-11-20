import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { labels, passages, validateSet } from './gold.js';
import { metrics } from './metrics.js';

const ids=z.array(z.string());
const saved=z.object({ schema:z.literal(1), digest:z.string(), k:z.number().int().positive(), model:z.string(), space:z.string(),
  rows:z.array(z.object({id:z.string(),split:z.enum(['dev','holdout']),dense:ids,hybrid:ids,gated:ids})) });
type Saved=z.infer<typeof saved>;
type Variant='dense'|'hybrid'|'gated';
function indexReport(report: Saved) {
  const rows=new Map(report.rows.map(r=>[r.id,r]));
  if (rows.size!==labels.length || rows.size!==report.rows.length || labels.some(l=>rows.get(l.id)?.split!==l.split)) {
    throw Error('CASESET_MISMATCH');
  }
  return rows;
}
// 配对比较只用留出题；参考、候选可以来自不同运行的报告。
export function compare(left: unknown, right: unknown, from: Variant='dense', to: Variant='gated') {
  const a=saved.parse(left), b=saved.parse(right);
  if (a.digest!==validateSet(passages,labels) || a.digest!==b.digest || a.k!==b.k) throw Error('INCOMPARABLE');
  const oldRows=indexReport(a), newRows=indexReport(b);
  const held=labels.filter(l=>l.split==='holdout');
  const changes=held.map(label=>{
    const before=oldRows.get(label.id)![from].slice(0,a.k), after=newRows.get(label.id)![to].slice(0,b.k);
    const correct=(v:string[])=>label.relevant.length ? label.relevant.includes(v[0] ?? '') : v.length===0;
    return {id:label.id,expected:label.relevant,before,after,wasCorrect:correct(before),nowCorrect:correct(after)};
  });
  return {dataset:a.digest,from,to,k:a.k,paired:held.length,
    lost:changes.filter(c=>c.wasCorrect && !c.nowCorrect).map(c=>c.id),
    gained:changes.filter(c=>!c.wasCorrect && c.nowCorrect).map(c=>c.id),
    before:metrics(held.map(label=>({label,ranked:oldRows.get(label.id)![from]})),passages,a.k),
    after:metrics(held.map(label=>({label,ranked:newRows.get(label.id)![to]})),passages,b.k),changes};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [first,second]=process.argv.slice(2);
  if (!first) throw Error('请提供本机报告路径');
  const left:unknown=JSON.parse(await readFile(first,'utf8'));
  const right:unknown=second ? JSON.parse(await readFile(second,'utf8')) : left;
  console.log(JSON.stringify(compare(left,right)));
}
