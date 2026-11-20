import { pathToFileURL } from 'node:url';
import type { Label } from './gold.js';
export type Candidate = { id: string; similarity: number };
export type Observation = { label: Label; candidates: Candidate[] };
// 先按各自语义分数裁剪候选，保留传入策略已经决定的相对次序。
export function accept(candidates: Candidate[], threshold: number, k = 3) {
  if (!Number.isFinite(threshold) || !Number.isInteger(k) || k < 1) throw Error('BAD_POLICY');
  return candidates.filter(c=>Number.isFinite(c.similarity) && c.similarity >= threshold).slice(0,k).map(c=>c.id);
}
export function loss(row: Observation, threshold: number) {
  const [first] = accept(row.candidates,threshold);
  if (!first) return row.label.relevant.length ? 1 : 0;
  return row.label.relevant.includes(first) ? 0 : 2;
}
export function calibrate(rows: Observation[], grid: number[]) {
  if (!rows.length || !grid.length || !grid.every(Number.isFinite)) throw Error('EMPTY_CALIBRATION');
  if (rows.some(row=>row.label.split !== 'dev')) throw Error('HOLDOUT_IN_CALIBRATION');
  return [...new Set(grid)].map(threshold=>({ threshold, cost:rows.reduce((sum,row)=>sum+loss(row,threshold),0) }))
    .sort((a,b)=>a.cost-b.cost || b.threshold-a.threshold)[0]!;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { labels } = await import('./gold.js');
  const fixtures = [{label:labels[0]!,candidates:[{id:'vpn',similarity:0.8}]},
    {label:labels[4]!,candidates:[{id:'cert',similarity:0.55}]}];
  console.log(JSON.stringify(calibrate(fixtures,[0.5,0.6,0.7,0.9])));
}
