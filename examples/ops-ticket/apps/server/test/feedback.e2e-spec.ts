import { bearer } from './login-fixtures.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('用户申请人工一次，过期反馈收到 409',async()=>{
  const http=request(app.getHttpServer());
  const created=await http.post('/api/tickets').set('Authorization',await bearer(app)).set('idempotency-key',crypto.randomUUID())
    .send({title:'演练',description:'测试人工接入',category:'网络问题',logs:[]}).expect(201);
  const {ticketNo}=created.body.data;
  const db=app.get(PrismaService);
  try {
    await db.ticket.update({where:{ticketNo},data:{status:'handoff_offered'}});
    const path='/api/tickets/'+ticketNo+'/actions';
    await http.post(path).set('Authorization',await bearer(app,'wu')).send({action:'request_human',version:0}).expect(403);
    await http.post(path).set('Authorization',await bearer(app)).send({action:'request_human',version:0}).expect(201);
    await http.post(path).set('Authorization',await bearer(app)).send({action:'request_human',version:0}).expect(409);
  } finally {
    await db.ticketEvent.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticket.delete({where:{ticketNo}});
  }
});
