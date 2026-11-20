import { PrismaService } from '../src/prisma/prisma.service.js';
import { hashPassword } from '../src/auth/password.js';
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

it('同公司管理员审批后新用户才能登录',async()=>{
  const db=app.get(PrismaService);
  const company=await db.company.findUniqueOrThrow({where:{name:'甲公司'}});
  const username='applicant-'+crypto.randomUUID();
  const admin=await db.user.create({data:{username:'admin-'+crypto.randomUUID(),displayName:'管理员',role:'customer_admin',companyId:company.id,
    registrationStatus:'approved',passwordHash:await hashPassword('course-demo-password')}});
  const http=request(app.getHttpServer());
  try {
    const result=await http.post('/api/registrations').send({username,password:'course-demo-password',company:'甲公司'}).expect(201);
    const credentials={username,password:'course-demo-password'};
    await http.post('/api/auth/login').send(credentials).expect(401);
    const login=await http.post('/api/auth/login').send({...credentials,username:admin.username}).expect(200);
    await http.post('/api/registrations/'+result.body.data.id+'/approve').set('Authorization','Bearer '+login.body.data.accessToken).expect(201);
    await http.post('/api/auth/login').send(credentials).expect(200);
    expect(await db.registrationAudit.count({where:{approverId:admin.id}})).toBe(1);
  } finally { await db.registrationAudit.deleteMany({where:{approverId:admin.id}}); await db.user.deleteMany({where:{username:{in:[username,admin.username]}}}); }
});
