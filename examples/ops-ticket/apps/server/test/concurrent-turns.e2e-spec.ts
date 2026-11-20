import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ConversationsService } from '../src/assistant/conversations.service.js';
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({imports:[AppModule]}).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
afterAll(async () => { await app.close(); });
it('相同版本的会话只能认领一轮',async () => {
  const db = app.get(PrismaService), store = app.get(ConversationsService);
  const {id} = await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const conversation = await store.create(id,'T-001 诊断');
  const input = {conversationId:conversation.id,question:'读取本单日志',version:0};
  const both = await Promise.allSettled([1,2].map(()=>store.begin(id,{...input,requestKey:crypto.randomUUID()})));
  expect(both.filter(item=>item.status==='fulfilled')).toHaveLength(1);
  expect(await db.aiChatTurn.count({where:{conversationId:conversation.id}})).toBe(1);
});
