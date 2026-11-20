import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TriageService } from '../src/assistant/triage.service.js';
import { diagnoseTicket } from '../src/queue/diagnose-ticket.js';
import { bearer } from './login-fixtures.js';

let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({imports:[AppModule]}).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
afterAll(async () => { await app.close(); });
afterEach(() => vi.restoreAllMocks());
it.each(['manual','unknown','outage'])('建单后诊断、保留分类并由提单人触发人工 %s',async scenario => {
  const db = app.get(PrismaService), triage = app.get(TriageService);
  const http = request(app.getHttpServer()), auth = await bearer(app);
  const created = await http.post('/api/tickets').set('authorization',auth)
    .set('idempotency-key',crypto.randomUUID())
    .send({title:'演练',description:'请求超时',category:'网络问题',logs:['timeout 5s']}).expect(201);
  const {ticketNo} = created.body.data;
  const {departmentId,categoryId} = await db.ticket.findUniqueOrThrow({where:{ticketNo}});
  try {
  const spy = vi.spyOn(triage,'suggest');
  if (scenario === 'outage') spy.mockRejectedValue(new Error('网关不可用'));
  else spy.mockResolvedValue({mode:'model',promptHash:'fixture',promptVersion:'test',validationAttempts:1,
    suggestion:{intent:'软件问题',steps:['核对目标'],evidenceIds:[scenario === 'manual' ? 'net-timeout:v1' : 'unknown'],missingInformation:[]}});
  await diagnoseTicket(db,triage,ticketNo,0,async()=>[{id:'net-timeout:v1',text:'检查超时'}]);
  await diagnoseTicket(db,triage,ticketNo,0,async()=>[{id:'net-timeout:v1',text:'检查超时'}]);
  expect(spy).toHaveBeenCalledTimes(1);
  const row = await db.ticket.findUniqueOrThrow({where:{ticketNo}});
  expect(row).toMatchObject({categoryId,departmentId,status:scenario === 'manual'?'awaiting_feedback':'handoff_offered',version:1});
  expect(await db.notice.count({where:{ticketNo,action:'request_human'}})).toBe(0);
  const action = scenario === 'manual' ? 'unresolved' : 'request_human';
  await http.post('/api/tickets/'+ticketNo+'/actions').set('authorization',auth).send({action,version:1}).expect(201);
  expect(await db.ticket.findUniqueOrThrow({where:{ticketNo}})).toMatchObject({status:'pending_assignment',departmentId});
  if(scenario==='manual' && process.env.FEEDBACK_CAPTURE) {
    const event=await db.ticketEvent.findFirstOrThrow({where:{ticket:{ticketNo},action:'unresolved'}});
    const actor=await db.user.findUniqueOrThrow({where:{id:event.actorId!}});
    writeFileSync(process.env.FEEDBACK_CAPTURE,JSON.stringify({sample:'suggestion_failed',events:[{actor:actor.role,
      action:event.action,from:event.fromStatus,to:event.toStatus,before:event.previousVersion,after:event.resultingVersion}]}));
  }
  } finally {
    await db.notice.deleteMany({where:{ticketNo}});
    await db.dispatchEvent.deleteMany({where:{ticketNo}});
    await db.ticketEvent.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticketMaterial.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticket.delete({where:{ticketNo}});
  }
});
