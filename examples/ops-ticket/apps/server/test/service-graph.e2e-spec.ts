import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { advance, replay, type Snapshot, type Command } from '../src/agent/incident-plan.js';
const state=Annotation.Root({ticket:Annotation<Snapshot>(),commands:Annotation<Command[]>(),index:Annotation<number>()});
const graph=new StateGraph(state).addNode('apply',({ticket,commands,index})=>({
  ticket:advance(ticket,commands[index]!),index:index+1
})).addEdge(START,'apply').addConditionalEdges('apply',s=>s.index<s.commands.length?'apply':END,['apply',END]).compile();

it('两种执行方式都在复核后回原人，再次处理后由提单人确认',async()=>{
  const initial:Snapshot={status:'reviewed',version:5,departmentId:'net',assigneeId:'worker',companyId:'a',reporterId:'lin'};
  const reporter={id:'lin',role:'reporter',companyId:'a'};
  const commands:Command[]=[
    {action:'unresolved',actor:reporter,version:5},
    {action:'handle',actor:{id:'worker',role:'operator',departmentId:'net'},version:6},
    {action:'approve',actor:{id:'lead',role:'department_lead',departmentId:'net'},version:7},
    {action:'resolved',actor:reporter,version:8}
  ];
  for(let length=1;length<=commands.length;length++){
    const prefix=commands.slice(0,length);
    const result=await graph.invoke({ticket:initial,commands:prefix,index:0});
    expect(result.ticket).toEqual(replay(initial,prefix));
    expect(result.ticket.assigneeId).toBe('worker');
    expect(result.ticket.status).toBe(['human_processing','handled','reviewed','completed'][length-1]);
  }
  await expect(graph.invoke({ticket:initial,commands:[commands[0]!,commands[0]!],index:0})).rejects.toThrow('版本');
});
