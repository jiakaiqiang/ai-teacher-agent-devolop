import assert from 'node:assert/strict';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SubmitTicket } from '../src/tickets/submit-ticket.js';

const db=new PrismaService();
const key=crypto.randomUUID();
try {
  const user=await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const api=new SubmitTicket(db);
  const input={title:'网络异常',description:'请求超时',category:'网络问题',logs:['timeout']};
  const [a,b]=await Promise.all([api.submit(user.id,key,input),api.submit(user.id,key,input)]);
  assert.equal(a.id,b.id);
  assert.equal(await db.ticketEvent.count({where:{ticketId:a.id}}),1);
  assert.equal(await db.ticketMaterial.count({where:{ticketId:a.id}}),1);
  await assert.rejects(api.submit(user.id,key,{...input,description:'不同问题'}),/相同请求键/);
  console.log('相同载荷并发重试返回同一张单；复用键更换描述得到冲突');
} finally {
  const where={ticket:{requestKey:key}};
  await db.ticketEvent.deleteMany({where});
  await db.ticketMaterial.deleteMany({where});
  await db.ticket.deleteMany({where:{requestKey:key}});
  await db.$disconnect();
}
