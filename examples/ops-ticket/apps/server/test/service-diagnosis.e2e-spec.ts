import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ModelGateway } from '../src/assistant/model-gateway.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { bearer } from './login-fixtures.js';

it('运行的步骤、工具和断点续读均归发起人，诊断完成保留工单状态', async () => {
  const mod = await Test.createTestingModule({imports:[AppModule]}).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  try {
    const db = app.get(PrismaService);
    const old = await db.ticket.findUniqueOrThrow({where:{ticketNo:'T-001'}});
    const auth = await bearer(app), peer = await bearer(app,'wu');
    const http = request(app.getHttpServer());
    const input = {requestKey:crypto.randomUUID(), ticketNo:old.ticketNo, goal:'排查当前工单'};
    const create = () => http.post('/api/agent/runs').set('authorization',auth).send(input).expect(201);
    const run = (await create()).body.data;
    expect((await create()).body.data.id).toBe(run.id);
    const path = '/api/agent/runs/'+run.id;
    await http.get(path).set('authorization',peer).expect(404);
    vi.spyOn(app.get(ModelGateway),'complete').mockResolvedValue({choices:[{index:0,finish_reason:'stop',message:{content:JSON.stringify({category:'network'})}}]});
    const result = await http.post(path+'/diagnose').set('authorization',auth).expect(200);
    expect(result.body.data.status).toBe('succeeded');
    const read = async (part:string) => (await http.get(path+part).set('authorization',auth).expect(200)).body.data;
    expect((await read('')).steps.map((s:{phase:string})=>s.phase)).toEqual(['tool','answer']);
    const {events,lastSeq}=await read('/events');
    expect(events.at(-1).type).toBe('run_finished');
    expect((await read('/events?after='+lastSeq)).events).toEqual([]);
    expect((await read('/traces')).traces.map((t:{kind:string})=>t.kind)).toEqual(['tool','model']);
    const now=await db.ticket.findUniqueOrThrow({where:{id:old.id}});
    expect([now.status,now.version]).toEqual([old.status,old.version]);
  } finally {
    vi.restoreAllMocks();
    await app.close();
  }
});
