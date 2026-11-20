import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TicketCommands } from '../src/tickets/ticket-commands.js';
import { bearer } from './login-fixtures.js';
import { syncCatalogue } from '../src/retrieval/projection.js';

let app:INestApplication;
beforeAll(async ()=>{
  const mod=await Test.createTestingModule({imports:[AppModule]}).compile();
  app=mod.createNestApplication();configureApp(app);await app.init();
});
afterAll(async()=>app.close());
it('用户反馈、回原人返工、知识送审、批准版本发布和跨客户检索',async()=>{
  const db=app.get(PrismaService), http=request(app.getHttpServer());
  const token=await bearer(app), bob=await bearer(app,'wu');
  const report=await http.post('/api/tickets').set('authorization',token).set('idempotency-key',crypto.randomUUID())
    .send({title:'网络连接超时',category:'网络问题',description:'连接后无响应',logs:['本单私有日志 z734']}).expect(201);
  const no=report.body.data.ticketNo;
  const row=await db.ticket.findUniqueOrThrow({where:{ticketNo:no}});
  const users=await Promise.all(['department_lead','operator','customer_admin'].map((role,i)=>db.user.create({data:{
    role,username:'u'+crypto.randomUUID(),displayName:'演练'+i,registrationStatus:'approved',
    ...(role==='customer_admin'?{companyId:row.companyId}:{departmentId:row.departmentId})}})));
  const [lead,worker,admin]=await Promise.all(users.map(u=>bearer(app,u.username)));
  const post=(path:string,who:string,data:object)=>http.post('/api/'+path).set('authorization',who).send(data);
  const draft='knowledge/tickets/'+no+'/draft';
  const content={title:'检查网络连接超时',body:'核对超时设置，再验证服务端响应。'};
  const act=(who:string,action:string,version:number,extra={})=>post('tickets/'+no+'/actions',who,{action,version,...extra}).expect(201);
  try {
    await post(draft,lead,content).expect(409);
    await new TicketCommands(db).apply(no,{source:'agent'},'offer_handoff',0);
    await act(token,'request_human',1);
    await act(lead,'assign',2,{targetId:users[1].id});
    await act(worker,'handle',3,{comment:'检查代理配置'});
    await act(lead,'approve',4);
    await act(token,'unresolved',5,{comment:'重试仍超时'});
    expect(await db.ticket.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({status:'human_processing',assigneeId:users[1].id});
    await act(worker,'handle',6,{comment:'调整超时并复测'});
    await act(lead,'approve',7);
    await act(token,'resolved',8);
    const events=await db.ticketEvent.findMany({where:{ticketId:row.id},orderBy:{createdAt:'asc'}});
    expect(events.map(e=>e.toStatus)).toEqual(['agent_processing','handoff_offered','pending_assignment','human_processing','handled','reviewed','human_processing','handled','reviewed','completed']);
    expect(events.at(-1)?.actorId).toBe(row.reporterId);
    if(process.env.WORKFLOW_CAPTURE) {
      const roles=new Map([[row.reporterId,'reporter'],[users[0].id,'department_lead'],[users[1].id,'operator']]);
      const samples=['offer','click','assign','handled','review','rework','handled','review','finish'];
      const records=events.slice(1).map((e,i)=>({sample:samples[i],events:[{actor:e.actorId?roles.get(e.actorId):e.source,
        action:e.action,from:e.fromStatus,to:e.toStatus,before:e.previousVersion,after:e.resultingVersion}]}));
      writeFileSync(process.env.WORKFLOW_CAPTURE,JSON.stringify(records.filter((row,i)=>records.findIndex(r=>r.sample===row.sample)===i)));
    }
    const candidate=await db.knowledgeEntry.findFirstOrThrow({where:{sourceTicketId:row.id,kind:'solution'}});
    expect(candidate).toMatchObject({state:'candidate',body:'调整超时并复测'});
    expect(candidate.body).not.toContain('本单私有日志');
    await post('knowledge/'+candidate.id+'/approve',lead,{version:candidate.version}).expect(409);
    await http.get('/api/knowledge/reviews').set('authorization',admin).expect(403);
    const queue=await http.get('/api/knowledge/reviews').set('authorization',lead).expect(200);
    expect(queue.body.data.some((r:{id:string})=>r.id===candidate.id)).toBe(true);
    await post(draft,admin,content).expect(403);
    const {id}= (await post(draft,lead,content).expect(201)).body.data;
    const path='knowledge/'+id;
    await post(path+'/reject',lead,{version:2}).expect(201);
    await post(path+'/publish',lead,{version:2}).expect(409);
    await post(draft,lead,content).expect(201);
    await post(path+'/publish',lead,{version:3}).expect(409);
    await post(path+'/approve',lead,{version:3}).expect(201);
    await post(draft,lead,{...content,body:content.body+'记录复测时刻。'}).expect(201);
    await post(path+'/publish',lead,{version:3}).expect(409);
    await post(path+'/approve',admin,{version:4}).expect(403);
    await post(path+'/approve',lead,{version:4}).expect(201);
    await post(path+'/publish',lead,{version:4}).expect(201);
    await syncCatalogue(db);
    const refs=await http.get('/api/tickets/T-002/recommendations').set('authorization',bob).expect(200);
    expect(refs.body.data).toEqual(expect.arrayContaining([expect.objectContaining({sourceKey:'solution:'+id,title:content.title})]));
    expect(JSON.stringify(refs.body.data)).not.toContain('本单私有日志');
    await http.get('/api/tickets/'+no).set('authorization',bob).expect(404);
    await db.knowledgeEntry.update({where:{id},data:{state:'withdrawn'}});
    const withdrawn=await http.get('/api/tickets/T-002/recommendations').set('authorization',bob).expect(200);
    expect(withdrawn.body.data.some((ref:{sourceKey:string})=>ref.sourceKey==='solution:'+id)).toBe(false);
  } finally {
    await db.knowledgeEntry.deleteMany({where:{sourceTicketId:row.id}});
    await db.notice.deleteMany({where:{ticketNo:no}});
    await db.dispatchEvent.deleteMany({where:{ticketNo:no}});
    await db.ticketEvent.deleteMany({where:{ticketId:row.id}});
    await db.ticketMaterial.deleteMany({where:{ticketId:row.id}});
    await db.ticket.delete({where:{id:row.id}});
    await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  }
},30000);
