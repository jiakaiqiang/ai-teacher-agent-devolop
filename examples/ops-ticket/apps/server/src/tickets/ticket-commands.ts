import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ticketStatusSchema } from '@ops-ticket/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { transition, type Action } from './workflow.js';

type Caller = { source: 'agent' } | { source:'user'; id:string };

@Injectable()
export class TicketCommands {
  constructor(private readonly db: PrismaService) {}
  // Caller 由受信入口构造。Agent 调用只来自服务端诊断任务。
  async apply(ticketNo:string, caller:Caller, action:Action, expectedVersion:number, targetId?:string, comment='') {
    return this.db.$transaction(async tx => {
      const row = await tx.ticket.findUnique({where:{ticketNo}});
      if (!row) throw new NotFoundException('工单不存在');
      const actor = caller.source === 'agent' ? {id:'agent',role:'agent'} :
        await tx.user.findFirst({where:{id:caller.id,registrationStatus:'approved'}});
      if (!actor) throw new ForbiddenException('账号未获批');
      const target = targetId ? await tx.user.findFirst({where:{id:targetId,registrationStatus:'approved'}}) : null;
      const next=transition({...row,status:ticketStatusSchema.parse(row.status)},actor,action,target ?? undefined);
      const changed=await tx.ticket.updateMany({where:{id:row.id,version:expectedVersion,status:row.status},
        data:{status:next.status,assigneeId:next.assigneeId,version:{increment:1},
          completedAt:next.status==='completed' ? new Date() : null}});
      if (changed.count!==1) throw new ConflictException('工单已变化，请刷新');
      const recipients=next.status==='pending_assignment' || next.status==='handled'
        ? (await tx.user.findMany({where:{departmentId:row.departmentId,role:'department_lead',registrationStatus:'approved'},select:{id:true}})).map(u=>u.id)
        : next.status==='human_processing' && next.assigneeId ? [next.assigneeId]
        : ['reviewed','awaiting_feedback','handoff_offered'].includes(next.status) ? [row.reporterId] : [];
      await tx.notice.createMany({data:recipients.map(recipientId=>({recipientId,ticketNo,version:row.version+1,action})),skipDuplicates:true});
      if (next.status==='completed') {
        const solution=await tx.ticketEvent.findFirst({
          where:{ticketId:row.id,action:row.status==='reviewed'?'handle':'suggest'},
          orderBy:{resultingVersion:'desc'},select:{comment:true},
        });
        // 候选仅供承办部门整理。检索只收录已批准发布的正文。
        await tx.knowledgeEntry.create({data:{kind:'solution',state:'candidate',version:1,
          title:'待整理的解决步骤',body:solution?.comment ?? '',sourceTicketId:row.id}});
      }
      return tx.ticketEvent.create({data:{ticketId:row.id,actorId:caller.source==='user'?caller.id:null,
        previousVersion:row.version,resultingVersion:row.version+1,action,source:caller.source,fromStatus:row.status,toStatus:next.status,comment}});
    });
  }
}
