import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { commandDigest, commandSchema } from './durable-command.js';

export async function applyOperation(db:PrismaService,id:string) {
  return db.serializable(async tx=>{
    const [job]=await tx.$queryRaw<{owner_id:string;ticket_no:string;request_key:string;command:unknown;approved_digest:string}[]>`SELECT * FROM operation_tasks
      WHERE id=${id}::uuid AND state='ready' AND valid_until>now() FOR UPDATE`;
    if(!job) return false;
    const command=commandSchema.parse(job.command);
    const row=await tx.ticket.findUniqueOrThrow({where:{ticketNo:job.ticket_no}});
    if(job.approved_digest!==commandDigest(job.request_key,row.ticketNo,job.owner_id,row.companyId,command)) throw new ConflictException('命令快照已变更');
    const actor=await tx.user.findFirst({where:{id:job.owner_id,role:'department_lead',departmentId:row.departmentId,registrationStatus:'approved'}});
    if(!actor || row.version!==command.version) throw new ConflictException('身份或工单已变化');
    if(command.action==='restart') {
      await tx.$executeRaw`UPDATE operation_tasks SET state='dispatching' WHERE id=${id}::uuid`;
      return true;
    }
    const target=await tx.user.findFirst({where:{username:command.assignee,role:'operator',departmentId:row.departmentId,registrationStatus:'approved'}});
    if(!target || row.status!=='human_processing') throw new ConflictException('改派目标或状态无效');
    await tx.ticket.update({where:{id:row.id,version:command.version},data:{assigneeId:target.id,version:{increment:1}}});
    await tx.ticketEvent.create({data:{ticketId:row.id,source:'user',actorId:actor.id,action:'reassign',
      fromStatus:row.status,toStatus:row.status,previousVersion:row.version,resultingVersion:row.version+1,comment:command.reason}});
    await tx.notice.create({data:{recipientId:target.id,ticketNo:row.ticketNo,version:row.version+1,action:'reassign'}});
    await tx.$executeRaw`UPDATE operation_tasks SET state='done' WHERE id=${id}::uuid`;
    return true;
  });
}
