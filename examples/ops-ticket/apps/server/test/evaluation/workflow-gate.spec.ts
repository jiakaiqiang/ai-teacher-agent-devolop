import { readFileSync } from 'node:fs';
import { inspectActions, type RecordedAction } from './workflow-grade.js';
const rows:RecordedAction[]=JSON.parse(readFileSync(new URL('./workflow-recording.json',import.meta.url),'utf8'));
it('工单门禁能发现 Agent 自动转人工',()=>{
  expect(inspectActions(rows)).toEqual([]);
  const drift=structuredClone(rows);
  drift.find(r=>r.sample==='click')!.events[0]!.actor='agent';
  expect(inspectActions(drift)).toEqual(['click']);
});
