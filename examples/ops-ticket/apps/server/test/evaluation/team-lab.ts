import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ModelGateway } from '../../src/assistant/model-gateway.js';
import { bearer } from '../login-fixtures.js';


export async function openLab(prefix: string) {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication(); configureApp(app); await app.init();
  const db = app.get(PrismaService), api = request(app.getHttpServer());
  const owner=await bearer(app), peer=await bearer(app,'wu');
  const issue=(who:string)=>who==='lin'?owner:peer;
  const runs:string[]=[], createdNos:string[]=[];
  async function start(description:string) {
    const report=await api.post('/api/tickets').set('authorization',owner).set('idempotency-key',randomUUID())
      .send({title:'配对实验 '+prefix,description,category:'网络问题',logs:[]}).expect(201);
    const ticket=await db.ticket.findUniqueOrThrow({where:{ticketNo:report.body.data.ticketNo}});
    createdNos.push(ticket.ticketNo);
    const created = await api.post('/api/agent/runs').set('authorization', issue('lin'))
      .send({ ticketNo: ticket.ticketNo, goal: '核对现象并给出分类', requestKey: randomUUID() }).expect(201);
    const id: string = created.body.data.id; runs.push(id);
    return { id, ticket, path: '/api/agent/runs/' + id };
  }
  return { db, api, issue, start, gateway: app.get(ModelGateway), close: async () => {
    await db.agentRun.deleteMany({ where: { id: { in: runs } } });
    const scope={ticketNo:{in:createdNos}};
    await db.dispatchEvent.deleteMany({where:scope});
    await db.ticketEvent.deleteMany({where:{ticket:scope}});
    await db.ticket.deleteMany({where:scope});
    await app.close();
  } };
}
export type Lab = Awaited<ReturnType<typeof openLab>>;
export function response(value: unknown) {
  return { choices: [{ index: 0, finish_reason: 'stop', message: { content: JSON.stringify(value) } }] };
}
