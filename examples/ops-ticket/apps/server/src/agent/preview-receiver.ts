import type { PrismaService } from '../prisma/prisma.service.js';

// 教学接收器的副作用是写入一次预览回执。生产系统的外部操作需由接收端提供幂等契约。
export async function receivePreview(db:PrismaService,id:string) {
  return db.$executeRaw`INSERT INTO preview_receipts(task_id) SELECT id FROM operation_tasks
    WHERE id=${id}::uuid AND state='dispatching' AND command->>'service'='diagnosis-preview'
    ON CONFLICT(task_id) DO NOTHING`;
}
export async function confirmPreview(db:PrismaService,id:string) {
  return db.$executeRaw`UPDATE operation_tasks SET state='done' WHERE id=${id}::uuid AND state='dispatching'
    AND EXISTS(SELECT 1 FROM preview_receipts WHERE task_id=${id}::uuid)`;
}
