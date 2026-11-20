import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';

type Entry = { id:string; version:number; title:string; body:string };
function digest(row:Entry) {
  return createHash('sha256').update(JSON.stringify([row.id,row.version,row.title,row.body])).digest('hex');
}

@Injectable()
export class SolutionService {
  constructor(private readonly db:PrismaService) {}

  private async lead(tx:TransactionClient, userId:string, ticketId:string) {
    const ticket=await tx.ticket.findUniqueOrThrow({where:{id:ticketId}});
    const lead=await tx.user.findFirst({where:{id:userId,departmentId:ticket.departmentId,role:'department_lead',registrationStatus:'approved'}});
    if (!lead) throw new ForbiddenException('需要承办部门负责人审核');
    return ticket;
  }

  async draft(userId:string,ticketNo:string,title:string,body:string) {
    if (!title.trim() || !body.trim()) throw new BadRequestException('请填写通用步骤');
    return this.db.serializable(async tx=>{
      const row=await tx.ticket.findUniqueOrThrow({where:{ticketNo}});
      await this.lead(tx,userId,row.id);
      const confirmed=await tx.ticketEvent.findFirst({where:{ticketId:row.id,actorId:row.reporterId,action:'resolved',toStatus:'completed'}});
      if(row.status!=='completed' || !confirmed) throw new ConflictException('请等待提单人确认有效');
      const previous=await tx.knowledgeEntry.findFirst({where:{sourceTicketId:row.id,kind:'solution'}});
      const fields={title:title.trim(),body:body.trim(),state:'draft',approvedVersion:null,approvedDigest:null,reviewerId:null};
      if(previous) return tx.knowledgeEntry.update({where:{id:previous.id},data:{...fields,version:{increment:1}}});
      return tx.knowledgeEntry.create({data:{...fields,kind:'solution',sourceTicketId:row.id}});
    });
  }

  async reviewQueue(userId:string) {
    const user=await this.db.user.findFirst({where:{id:userId,role:'department_lead',registrationStatus:'approved'}});
    if(!user?.departmentId) throw new ForbiddenException();
    return this.db.$queryRaw<{id:string;ticketNo:string;version:number;state:string;title:string;body:string}[]>`
      SELECT k.id,t.ticket_no AS "ticketNo",k.version,k.state,k.title,k.body
      FROM knowledge_entries k JOIN tickets t ON t.id=k.source_ticket_id
      WHERE t.department_id=${user.departmentId}::uuid AND k.kind='solution' AND k.state IN ('candidate','draft')
      ORDER BY t.completed_at,k.id`;
  }

  async reject(userId:string,id:string,version:number) {
    return this.db.serializable(async tx=>{
      const row=await tx.knowledgeEntry.findUnique({where:{id}});
      if(!row?.sourceTicketId) throw new NotFoundException();
      await this.lead(tx,userId,row.sourceTicketId);
      if(row.version!==version || row.state!=='draft') throw new ConflictException('请重新读取待审草稿');
      return tx.knowledgeEntry.update({where:{id},data:{state:'candidate',approvedDigest:null,approvedVersion:null,reviewerId:null}});
    });
  }

  async approve(userId:string,id:string,version:number) {
    return this.db.serializable(async tx=>{
      const row=await tx.knowledgeEntry.findUnique({where:{id}});
      if (!row?.sourceTicketId || row.kind!=='solution') throw new NotFoundException();
      await this.lead(tx,userId,row.sourceTicketId);
      if(row.version!==version || row.state!=='draft') throw new ConflictException('请重新查看草稿');
      return tx.knowledgeEntry.update({where:{id},data:{reviewerId:userId,approvedVersion:version,approvedDigest:digest(row)}});
    });
  }

  async publish(userId:string,id:string,version:number) {
    return this.db.serializable(async tx=>{
      const row=await tx.knowledgeEntry.findUnique({where:{id}});
      if (!row?.sourceTicketId || row.kind!=='solution') throw new NotFoundException();
      await this.lead(tx,userId,row.sourceTicketId);
      if (!row.reviewerId || row.approvedVersion!==version || row.version!==version || row.approvedDigest!==digest(row) || row.state==='withdrawn') {
        throw new ConflictException('需要审核该版本的完整正文');
      }
      await this.lead(tx,row.reviewerId,row.sourceTicketId);
      return tx.knowledgeEntry.update({where:{id},data:{state:'published'}});
    });
  }
}
