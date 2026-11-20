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

it('通知按本人读取，重复标记已读只更新一次',async()=>{
  const db=app.get(PrismaService), user=await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const row=await db.notice.create({data:{recipientId:user.id,ticketNo:'T-001',version:0,action:'exercise'}});
  const http=request(app.getHttpServer());
  try {
    const own=await http.get('/api/notices').set('Authorization',await bearer(app)).expect(200);
    expect(own.body.data.some((n:{id:number})=>n.id===row.id)).toBe(true);
    const path='/api/notices/'+row.id+'/read';
    for (const [name,count] of [['wu',0],['lin',1],['lin',0]] as const) {
      const response=await http.post(path).set('Authorization',await bearer(app,name)).expect(201);
      expect(response.body.data.count).toBe(count);
    }
  } finally {await db.notice.delete({where:{id:row.id}});}
});
