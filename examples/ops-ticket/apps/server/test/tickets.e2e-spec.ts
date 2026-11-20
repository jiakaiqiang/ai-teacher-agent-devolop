import { PrismaService } from '../src/prisma/prisma.service.js';
import { bearer } from './login-fixtures.js';
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

it('返回客户、部门、日志和提交记录', async () => {
  const res = await request(app.getHttpServer()).get('/api/tickets/T-001').set('Authorization',await bearer(app)).expect(200);
  const ticket = res.body.data;
  expect(ticket.company.name).toBe('甲公司');
  expect(ticket.department.name).toBe('网络部');
  expect(ticket.materials).toHaveLength(1);
  expect(ticket.events[0].actor.displayName).toBe('lin');
  expect(ticket).not.toHaveProperty('companyId');
});
it('不存在的工单返回 404', async () => {
  await request(app.getHttpServer()).get('/api/tickets/missing').set('Authorization',await bearer(app)).expect(404);
});
it('删除被工单引用的分类返回 409', async () => {
  const db=app.get(PrismaService);
  const dept=await db.department.findUniqueOrThrow({where:{name:'网络部'}});
  const lead=await db.user.create({data:{username:'lead-'+crypto.randomUUID(),displayName:'负责人',role:'department_lead',departmentId:dept.id,registrationStatus:'approved'}});
  try {
    const path='/api/categories/'+encodeURIComponent('网络问题');
    await request(app.getHttpServer()).delete(path).set('Authorization',await bearer(app)).expect(403);
    await request(app.getHttpServer()).delete(path).set('Authorization',await bearer(app,lead.username)).expect(409);
  } finally {await db.user.delete({where:{id:lead.id}});}
});
