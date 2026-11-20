import { writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { bearer } from './login-fixtures.js';
import { cases, score, type Trial } from './diagnosis-eval.js';
it.skipIf(process.env.COURSE_MODEL_BASELINE!=='1')('本机固定十题的单次基线',async()=>{
  vi.stubEnv('LLM_BASE_URL','http://127.0.0.1:11434/v1');
  vi.stubEnv('LLM_MODEL','tinyllama:latest');vi.stubEnv('LLM_MODEL_ROUTES','');vi.stubEnv('LLM_API_KEY','local-ollama');
  const mod=await Test.createTestingModule({imports:[AppModule]}).compile();
  const app=mod.createNestApplication();configureApp(app);await app.init();
  const api=request(app.getHttpServer()),auth=await bearer(app),db=app.get(PrismaService),trials:Trial[]=[];
  const numbers:string[]=[];
  try{
    for(const [id,description] of cases) {
      const report=await api.post('/api/tickets').set('authorization',auth).set('idempotency-key',crypto.randomUUID())
        .send({title:'固定基线 '+id,description,logs:[description],category:'网络问题'}).expect(201);
      const {ticketNo}=report.body.data;numbers.push(ticketNo);
      const created=await api.post('/api/agent/runs').set('authorization',auth).send({ticketNo,goal:'根据材料分诊',requestKey:crypto.randomUUID()}).expect(201);
      const path='/api/agent/runs/'+created.body.data.id,start=performance.now();
      const run=(await api.post(path+'/diagnose').set('authorization',auth).expect(200)).body.data;
      const events=(await api.get(path+'/events').set('authorization',auth).expect(200)).body.data.events;
      const {usage}=(await api.get(path+'/traces').set('authorization',auth).expect(200)).body.data;
      trials.push({id,predicted:events.at(-1)?.payload?.answer?.split(' · ')[0]??null,reason:run.stopReason,
        ms:Math.round(performance.now()-start),steps:run.stepCount,tokens:usage.inputTokens+usage.outputTokens});
    }
    const report=score(trials); expect(report.total).toBe(10);
    if(process.env.COURSE_REPORT)writeFileSync(process.env.COURSE_REPORT,JSON.stringify(report,null,2));
  }finally{
    const where={ticketNo:{in:numbers}};
    await db.agentRun.deleteMany({where});await db.dispatchEvent.deleteMany({where});
    await db.ticketMaterial.deleteMany({where:{ticket:where}});await db.ticketEvent.deleteMany({where:{ticket:where}});
    await db.ticket.deleteMany({where});await app.close();vi.unstubAllEnvs();
  }
},90000);
