import { PrismaService } from '../src/prisma/prisma.service.js';
import { bearer } from './login-fixtures.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
let lead: string;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const db=app.get(PrismaService);
  const dept=await db.department.findUniqueOrThrow({where:{name:'网络部'}});
  lead=(await db.user.create({data:{username:'lead-'+crypto.randomUUID(),displayName:'主管',role:'department_lead',departmentId:dept.id,registrationStatus:'approved'}})).username;
});
afterAll(async () => { if (app && lead) await app.get(PrismaService).user.deleteMany({where:{username:lead}}); await app?.close(); });

it('客户和部门是两个独立的筛选维度', async () => {
  const customer = await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app,lead)).query({ company: '甲公司' }).expect(200);
  expect(customer.body.data.items.map((r: { ticketNo: string }) => r.ticketNo)).toEqual(['T-001']);
  const department = await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app,lead)).query({ department: '网络部' }).expect(200);
  expect(department.body.data.items).toHaveLength(2);
});

it('同一时间的两张工单能逐页读出并拒绝无效游标', async () => {
  const http = request(app.getHttpServer());
  const first = (await http.get('/api/tickets?limit=1').set('Authorization',await bearer(app,lead)).expect(200)).body.data;
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = (await http.get('/api/tickets').set('Authorization',await bearer(app,lead)).query({ limit: 1, cursor: first.nextCursor }).expect(200)).body.data;
  expect(second.items).toHaveLength(1);
  expect(new Set([first.items[0].ticketNo, second.items[0].ticketNo]).size).toBe(2);
  expect(second.nextCursor).toBeNull();
  await http.get('/api/tickets?cursor=broken').set('Authorization',await bearer(app,lead)).expect(400);
});

it('甲公司提单人直接读乙公司详情与材料得到 404',async()=>{
  await request(app.getHttpServer()).get('/api/tickets/T-002').set('Authorization',await bearer(app)).expect(404);
  const r=await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app)).query({company:'乙公司'}).expect(200);
  expect(r.body.data.items).toHaveLength(0);
});
