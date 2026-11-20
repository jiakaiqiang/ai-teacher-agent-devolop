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

it('同一部门能读两家客户的进度，客户管理员无法替提单人验收',async()=>{
  const db=app.get(PrismaService);
  const company=await db.company.findUniqueOrThrow({where:{name:'甲公司'}});
  const admin=await db.user.create({data:{username:'admin-'+crypto.randomUUID(),displayName:'管理员',role:'customer_admin',companyId:company.id,registrationStatus:'approved'}});
  const http=request(app.getHttpServer());
  try {
    for(const no of ['T-001','T-002']) await http.get('/api/tickets/'+no).set('Authorization',await bearer(app,lead)).expect(200);
    const own=await http.get('/api/tickets/T-001').set('Authorization',await bearer(app,admin.username)).expect(200);
    expect(own.body.data.canConfirm).toBe(false);
    await http.get('/api/tickets/T-002').set('Authorization',await bearer(app,admin.username)).expect(404);
    const before=await db.ticket.findUniqueOrThrow({where:{ticketNo:'T-001'}});
    try {
      await db.ticket.update({where:{id:before.id},data:{status:'awaiting_feedback'}});
      await http.post('/api/tickets/T-001/actions').set('Authorization',await bearer(app,admin.username)).send({action:'resolved',version:before.version}).expect(403);
    } finally { await db.ticket.update({where:{id:before.id},data:{status:before.status}}); }
  } finally {await db.user.delete({where:{id:admin.id}});}
});
