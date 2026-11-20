import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Report { category: string; title: string; description: string; logs: string[] }

@Injectable()
export class SubmitTicket {
  constructor(private readonly db: PrismaService) {}
  async submit(reporterId:string, key:string, input:Report) {
    if (!key.trim() || !input.title.trim() || !input.description.trim()) throw new BadRequestException('请填写分类、标题和描述');
    const hash=createHash('sha256').update(JSON.stringify([input.category,input.title,input.description,input.logs])).digest('hex');
    const where={reporterId_requestKey:{reporterId,requestKey:key}};
    const user=await this.db.user.findFirst({where:{id:reporterId,role:'reporter',registrationStatus:'approved'}});
    if (!user?.companyId) throw new ForbiddenException('需要已获批的提单账号');
    const companyId=user.companyId;
    const replay=async () => {
      const old=await this.db.ticket.findUnique({where});
      if (!old) return null;
      if (old.requestHash!==hash) throw new ConflictException('相同请求键对应不同报障材料');
      return old;
    };
    const existing=await replay();
    if (existing) return existing;
    try {
      return await this.db.$transaction(async tx=>{
        const category=await tx.category.findUnique({where:{name:input.category}});
        if (!category) throw new BadRequestException('问题分类不存在');
        const ticket=await tx.ticket.create({data:{
          ticketNo:'T-'+randomUUID(),reporterId,companyId,categoryId:category.id,departmentId:category.departmentId,
          title:input.title,description:input.description,requestKey:key,requestHash:hash,
          materials:{create:input.logs.map(logText=>({logText}))},
          events:{create:{source:'user',actorId:reporterId,action:'submitted',toStatus:'agent_processing'}},
        }});
        await tx.dispatchEvent.create({data:{ticketNo:ticket.ticketNo,version:ticket.version,kind:"diagnose"}});
        return ticket;
      });
    } catch(error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') {
        const winner=await replay();
        if (winner) return winner;
      }
      throw error;
    }
  }
}
