import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReadToolsService } from '../src/assistant/read-tools.service.js';
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({imports:[AppModule]}).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
afterAll(async () => { await app.close(); });
it('日志工具重新校验调用人的工单范围',async () => {
  const db = app.get(PrismaService), tools = app.get(ReadToolsService);
  const call = {id:'sample',type:'function' as const,function:{name:'list_ticket_logs' as const,arguments:JSON.stringify({ticketNo:'T-001',limit:2})}};
  const run = async (username:string) => tools.execute(call,(await db.user.findUniqueOrThrow({where:{username}})).id,new AbortController().signal);
  expect(await run('lin')).toMatchObject({logs:['client timeout after 5s']});
  await expect(run('wu')).rejects.toThrow('TOOL_NOT_FOUND');
});
