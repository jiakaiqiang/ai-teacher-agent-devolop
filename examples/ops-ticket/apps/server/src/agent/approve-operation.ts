import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
// 负责人复看具体参数并确认。显式绑定版本摘要和有效期。
export async function approveOperation(db:PrismaService,leadId:string,id:string,digest:string) {
  const count=await db.$executeRaw`UPDATE operation_tasks t SET state='ready',approved_digest=t.digest
    FROM users u,tickets k WHERE t.id=${id}::uuid AND u.id=${leadId}::uuid AND u.role='department_lead'
    AND u.registration_status='approved' AND k.ticket_no=t.ticket_no AND u.department_id=k.department_id
    AND t.state='waiting' AND t.valid_until>now() AND t.digest=${digest}`;
  if(count!==1) throw new ConflictException('无权确认、参数已变化或任务已过期');
}
