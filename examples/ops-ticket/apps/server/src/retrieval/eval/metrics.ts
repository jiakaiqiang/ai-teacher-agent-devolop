import { pathToFileURL } from 'node:url';
import { labels, passages, type Label, type Passage } from './gold.js';

export type Trial = { label: Label; ranked: string[] };
export function metrics(trials: Trial[], docs: Passage[], k: number) {
  if (!Number.isInteger(k) || k < 1) throw Error('INVALID_K');
  const groups = new Map(docs.map(d => [d.id,d.group]));
  let recall = 0, reciprocal = 0, answerable = 0, empty = 0, correctEmpty = 0;
  let cited = 0, correct = 0, forbidden = 0;
  for (const {label, ranked} of trials) {
    const top = [...new Set(ranked)].slice(0,k);
    const hits = top.filter(id => label.relevant.includes(id));
    cited += top.length;
    correct += hits.length;
    forbidden += top.filter(id => !['shared',label.group].includes(groups.get(id) ?? '')).length;
    if (label.relevant.length) {
      answerable++;
      recall += hits.length / label.relevant.length;
      const first = top.findIndex(id => label.relevant.includes(id));
      if (first >= 0) reciprocal += 1 / (first + 1);
    } else {
      empty++;
      if (!top.length) correctEmpty++;
    }
  }
  return { queries: trials.length, answerable, noAnswer: empty, cited, correct, forbidden,
    recallAtK: answerable ? recall / answerable : null,
    mrrAtK: answerable ? reciprocal / answerable : null,
    sourcePrecision: cited ? correct / cited : null, correctAbstention: empty ? correctEmpty / empty : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 手算对照：多标签只取其一，另一个无答案问题错误给出引用。
  const sample = [{ label: labels[6]!, ranked: ['paper'] },{ label: labels[4]!, ranked: ['cert'] }];
  console.log(JSON.stringify(metrics(sample,passages,3)));
}
