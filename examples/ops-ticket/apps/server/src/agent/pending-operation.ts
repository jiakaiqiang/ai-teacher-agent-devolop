import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService, TransactionClient } from '../prisma/prisma.service.js';
import { commandDigest, commandSchema, type DurableCommand } from './durable-command.js';

interface Task { id:string; owner_id:string; ticket_no:string; command:DurableCommand; digest:string;
  state:string; valid_until:Date; approved_digest:string|null; }

async function departmentLead(tx:TransactionClient,actorId:string,ticketNo:string) {
  const row=await tx.ticket.findUniqueOrThrow({where:{ticketNo}});
  const lead=await tx.user.findFirst({where:{id:actorId,registrationStatus:'approved',role:'department_lead',departmentId:row.departmentId}});
  if(!lead) throw new ForbiddenException('需要本部门负责人');
  return row;
}
export async function submitOperation(db:PrismaService,userId:string,ticketNo:string,key:string,input:unknown) {
  const command=commandSchema.parse(input);
  return db.serializable(async tx=>{
    const row=await departmentLead(tx,userId,ticketNo);
    const hash=commandDigest(key,ticketNo,userId,row.companyId,command);
    const id=randomUUID();
    await tx.$executeRaw`INSERT INTO operation_tasks(id,request_key,owner_id,ticket_no,command,digest,state,valid_until)
      VALUES (${id}::uuid,${key}::uuid,${userId}::uuid,${ticketNo},${JSON.stringify(command)}::jsonb,${hash},'waiting',now()+interval '24 hours')
      ON CONFLICT(owner_id,request_key) DO NOTHING`;
    const [saved]=await tx.$queryRaw<Task[]>`SELECT * FROM operation_tasks WHERE owner_id=${userId}::uuid AND request_key=${key}::uuid`;
    if(saved.digest!==hash) throw new ConflictException('相同请求键的参数已改变');
    return saved;
  });
}
export async function cancelOperation(db:PrismaService,userId:string,id:string) {
  return db.$executeRaw`UPDATE operation_tasks SET state='cancelled' WHERE id=${id}::uuid AND owner_id=${userId}::uuid AND state IN ('waiting','ready')`;
}
