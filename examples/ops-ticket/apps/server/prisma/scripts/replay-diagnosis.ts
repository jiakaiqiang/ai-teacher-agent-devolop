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
  for (const delivery of [1,2]) {
    const job=await queue.add('diagnose',{ticketNo:ticket.ticketNo,version:0},{jobId:key+'-'+delivery,removeOnComplete:true});
    await job.waitUntilFinished(events,10000);
  }
  assert.equal((await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'handoff_offered');
  assert.equal(await db.ticketEvent.count({where:{ticketId:ticket.id,action:'offer_handoff'}}),1);
  console.log('两次投递，一个人工接入入口，尚未进入待派单');
} finally {
  await Promise.all([events.close(),worker.close(),queue.close()]);
  await db.ticketEvent.deleteMany({where:{ticket:{requestKey:key}}});
  await db.ticket.deleteMany({where:{requestKey:key}});
  await db.$disconnect();
}
