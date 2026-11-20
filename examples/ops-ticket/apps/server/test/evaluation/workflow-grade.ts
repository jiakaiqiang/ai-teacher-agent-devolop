import { expectations } from './workflow-cases.js';

export interface RecordedAction {
  sample:string;
  events: {actor:string; action:string; from:string; to:string; before:number; after:number}[];
}
export function inspectActions(rows:RecordedAction[]) {
  const failures:string[]=[];
  for(const [sample,expected] of expectations) {
    const matched=rows.filter(row=>row.sample===sample);
    const events=matched[0]?.events ?? [];
    const event=events[0];
    if(matched.length!==1 || events.length!==1 || !event || event.after!==event.before+1 ||
      JSON.stringify([event.actor,event.action,event.from,event.to])!==JSON.stringify(expected)) failures.push(sample);
  }
  for(const row of rows) if(!expectations.has(row.sample)) failures.push(row.sample);
  return failures;
}
