import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyOperation } from './apply-operation.js';
import { receivePreview,confirmPreview } from './preview-receiver.js';
// 每次从持久记录恢复。传入任务 ID 可由独立进程执行该步。
const db=new PrismaService();
try {
  const id=process.argv[2];
  await applyOperation(db,id);
  await receivePreview(db,id);
  if(process.argv.includes('--interrupt-before-ack')) process.exitCode=75;
  else await confirmPreview(db,id);
} finally {await db.$disconnect();}
