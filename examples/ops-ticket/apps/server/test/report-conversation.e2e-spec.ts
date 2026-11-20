import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { bearer } from './login-fixtures.js';
import request from 'supertest';
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({imports:[AppModule]}).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
afterAll(async () => { await app.close(); });
it('持久会话回显本单日志并拒绝跨用户读取',async () => {
  const http=request(app.getHttpServer()), auth=await bearer(app);
  const path='/api/assistant/conversations';
  const created=await http.post(path).set('authorization',auth).send({title:'T-001 排查'}).expect(201);
  const target=path+'/'+created.body.data.id;
  const res=await http.post(target+'/turns').set('authorization',auth).send({question:'查询工单 T-001 的日志',version:0,requestKey:crypto.randomUUID()}).expect(200);
  expect(res.text).toContain('client timeout after 5s');
  const detail=await http.get(target).set('authorization',auth).expect(200);
  expect(detail.body.data.turns[0].tools.map((t:{name:string})=>t.name)).toContain('list_ticket_logs');
  await http.get(target).set('authorization',await bearer(app,'wu')).expect(404);
});
