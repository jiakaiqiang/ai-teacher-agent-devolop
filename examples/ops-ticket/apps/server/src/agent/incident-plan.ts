import { transition, type Action, type Actor, type TicketSnapshot } from '../tickets/workflow.js';
export interface Command {action:Action; actor:Actor; target?:Actor; version:number}
export type Snapshot=TicketSnapshot & {version:number};
export function advance(snapshot:Snapshot,cmd:Command):Snapshot {
  if(snapshot.version!==cmd.version) throw new Error('工单版本已变化');
  return {...transition(snapshot,cmd.actor,cmd.action,cmd.target), version:snapshot.version+1};
}
export function replay(initial:Snapshot,commands:Command[]) {
  return commands.reduce(advance,initial);
}
