import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { diagnosisQueue, diagnosisWorker } from './diagnosis.js';
import { deliverPending } from './outbox.js';
import { scanOverdue } from './scan-overdue.js';
const db=new PrismaService(), queue=diagnosisQueue(), worker=diagnosisWorker(db);
let running=true;
for (const sig of ['SIGINT','SIGTERM']) process.once(sig,()=>{running=false;});
try {
  while (running) {
    try { await deliverPending(db,queue); await scanOverdue(db); }
    catch (error) {console.error('投递或扫描暂时失败',error instanceof Error?error.name:'unknown');}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
} finally {await worker.close();await queue.close();await db.$disconnect()}
