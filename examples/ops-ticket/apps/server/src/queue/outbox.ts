import { diagnosisQueue } from './diagnosis.js';
import { PrismaService } from '../prisma/prisma.service.js';

// add 成功且进程在标记前崩溃时，下一轮仍用同一 outbox id 投递。
export async function deliverPending(db:PrismaService, queue:ReturnType<typeof diagnosisQueue>) {
  const events=await db.dispatchEvent.findMany({where:{sentAt:null},orderBy:{id:'asc'},take:50});
  for (const event of events) {
    if (event.kind==='diagnose') {
      await queue.add('diagnose',{ticketNo:event.ticketNo,version:event.version},{
        jobId:event.id, attempts:3,backoff:{type:'exponential',delay:500}});
    }
    await db.dispatchEvent.updateMany({where:{id:event.id,sentAt:null},data:{sentAt:new Date()}});
  }
}
