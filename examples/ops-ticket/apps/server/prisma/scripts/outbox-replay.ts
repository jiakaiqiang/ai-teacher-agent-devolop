import { deliverPending } from '../../src/queue/outbox.js';
import assert from 'node:assert/strict';
import { QueueEvents } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SubmitTicket } from '../../src/tickets/submit-ticket.js';
import { diagnosisQueue, diagnosisWorker } from '../../src/queue/diagnosis.js';
import { queueRootOptions } from '../../src/queue/queue.config.js';
const db=new PrismaService(), queue=diagnosisQueue(), worker=diagnosisWorker(db);
const events=new QueueEvents(queue.name,queueRootOptions());
const key=crypto.randomUUID();
try {
  await events.waitUntilReady();
  const reporter=await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const ticket=await new SubmitTicket(db).submit(reporter.id,key,{category:'网络问题',title:'练习',description:'证据不足',logs:[]});
  const event=await db.dispatchEvent.findUniqueOrThrow({where:{ticketNo_version_kind:{ticketNo:ticket.ticketNo,version:0,kind:'diagnose'}}});
  await deliverPending(db,queue);
  const job=await queue.getJob(event.id);
  assert.ok(job);
  await job.waitUntilFinished(events,10000);
  await deliverPending(db,queue);
  assert.equal(await db.notice.count({where:{ticketNo:ticket.ticketNo,recipientId:reporter.id}}),1);
  assert.equal((await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'handoff_offered');
  assert.equal(await db.ticketEvent.count({where:{ticketId:ticket.id,action:'offer_handoff'}}),1);
  console.log('两次投递，一个人工接入入口，尚未进入待派单');
} finally {
  await Promise.all([events.close(),worker.close(),queue.close()]);
  await db.ticketEvent.deleteMany({where:{ticket:{requestKey:key}}});
  const t=await db.ticket.findFirst({where:{requestKey:key}});
  if (t) {await db.dispatchEvent.deleteMany({where:{ticketNo:t.ticketNo}}); await db.notice.deleteMany({where:{ticketNo:t.ticketNo}});}
  await db.ticket.deleteMany({where:{requestKey:key}});
  await db.$disconnect();
}
