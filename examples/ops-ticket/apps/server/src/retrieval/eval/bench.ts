import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { bridgeEmbed } from '../bridge.js';
import { dimension, encode, model, space } from '../encoding.js';
import { ensureIndex, milvus } from '../vector-index.js';
import { labels, passages, validateSet, type Label } from './gold.js';
import { lexical, fuse, rerankCode } from './hybrid.js';
import { accept, calibrate, type Candidate } from './abstain.js';
import { metrics } from './metrics.js';

export function percentile(values: number[], fraction: number) {
  if (!values.length || fraction <= 0 || fraction > 1 || !Number.isFinite(fraction) || values.some(v=>!Number.isFinite(v) || v<0)) throw Error('BAD_LATENCY');
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(fraction*sorted.length)-1]!;
}

export function assemble(label: Label, dense: Candidate[]) {
  const docs=passages.filter(d=>d.group===label.group || d.group==='shared');
  const visible=new Set(docs.map(d=>d.id));
  if (dense.some(c=>!visible.has(c.id))) throw Error('SCOPE_MISMATCH');
  const byId=new Map(dense.map(c=>[c.id,c]));
  const words=lexical(label.query,docs).map(c=>c.id);
  const fused=fuse([dense.map(c=>c.id),words],visible);
  // 本实验对全部可见资料计算向量分数，所以两路候选均能复用原始相似度。
  return rerankCode(label.query,fused,docs).map(id=>{
    const c=byId.get(id);
    if (!c) throw Error('MISSING_SIMILARITY');
    return c;
  });
}
export function usage(queryCalls: number, passageCalls: number, points: number) {
  return {queryCalls,passageCalls,inputCodePoints:points,generatedTokens:0,monetaryCost:null};
}

export type Encoder = (texts: string[], role: 'query' | 'passage') => Promise<number[][]>;
export const encoders: Record<'node' | 'python', Encoder> = { node: encode, python: bridgeEmbed };

// 评测只替换编码实现，语料、标签、阈值网格、混合与门控完全不变。
export async function runBench(backend: 'node' | 'python' = 'node') {
  const embed = encoders[backend];
  if (!embed) throw Error('BAD_BACKEND');
  const digest=validateSet(passages,labels);
  const collectionName='verify_w12_'+digest.slice(0,16)+'_'+space+(backend==='node'?'':'_'+backend);
  const weightSha256='06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439';
  const info=await fetch('http://127.0.0.1:11434/api/show',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
  if (!info.ok) throw Error('MODEL_INFO_UNAVAILABLE');
  const { modelfile }=z.object({modelfile:z.string()}).parse(await info.json());
  if (!modelfile.split(/\r?\n/).some(line=>line.startsWith('FROM ') && line.trimEnd().endsWith(weightSha256))) throw Error('WEIGHT_MISMATCH');
  const started=performance.now();
  await ensureIndex(collectionName,dimension);
  const vectors=await embed(passages.map(d=>d.text),'passage');
  await milvus('entities/upsert',{collectionName,data:passages.map((d,i)=>({id:d.id,groupTag:d.group,vector:vectors[i]}))});
  const setupMs=performance.now()-started;
  const observations=[];
  for (const label of labels) {
    const start=performance.now();
    const query=await embed([label.query],'query');
    const raw=await milvus('entities/search',{collectionName,data:query,annsField:'vector',limit:passages.length,filter:'groupTag in ["shared",'+JSON.stringify(label.group)+']'});
    const dense=z.array(z.object({id:z.string(),distance:z.number().finite()})).parse(raw).map(h=>({id:h.id,similarity:h.distance}));
    if (new Set(dense.map(h=>h.id)).size!==passages.filter(d=>d.group===label.group || d.group==='shared').length) throw Error('INCOMPLETE_SEARCH');
    const candidates=assemble(label,dense);
    observations.push({label,dense,candidates,elapsedMs:performance.now()-start});
  }
  const grid=[0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,1.01];
  const calibration=calibrate(observations.filter(r=>r.label.split==='dev'),grid);
  const k=3;
  const rows=observations.map(r=>({id:r.label.id,split:r.label.split,family:r.label.family,group:r.label.group,
    query:r.label.query,expectedSources:r.label.relevant,
    dense:r.dense.slice(0,k).map(c=>c.id),hybrid:r.candidates.slice(0,k).map(c=>c.id),
    gated:accept(r.candidates,calibration.threshold,k),scores:r.candidates,elapsedMs:r.elapsedMs}));
  const held=rows.filter(r=>r.split==='holdout');
  const summary=(key:'dense'|'hybrid'|'gated')=>metrics(held.map(r=>({label:labels.find(l=>l.id===r.id)!,ranked:r[key]})),passages,k);
  const times=rows.map(r=>r.elapsedMs);
  return {schema:1,backend,digest,space,model,weightSha256,collectionName,corpus:passages,k,grid,calibration,rows,
    heldout:{dense:summary('dense'),hybrid:summary('hybrid'),gated:summary('gated')},
    timing:{setupMs,p50:percentile(times,0.5),p95:percentile(times,0.95)},
    usage:usage(labels.length,1,[...passages.map(d=>d.text),...labels.map(l=>l.query)].reduce((n,t)=>n+Array.from(t).length,0))};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const backend=process.argv[3]==='python'?'python':'node';
  const report=await runBench(backend);
  if (process.argv[2]) await writeFile(process.argv[2],JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({backend:report.backend,digest:report.digest,calibration:report.calibration,heldout:report.heldout,timing:report.timing,usage:report.usage}));
}
