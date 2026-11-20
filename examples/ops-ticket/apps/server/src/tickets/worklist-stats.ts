import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../redis/cache.service.js';
import { visibleTickets } from './scope.js';
@Injectable()
export class WorklistStats {
  constructor(private db:PrismaService,private cache:CacheService) {}
  async count(userId:string) {
    const user=await this.db.user.findUniqueOrThrow({where:{id:userId}});
    const scope=visibleTickets(user);
    const key='worklist:'+JSON.stringify(scope);
    return this.cache.getOrLoad(key,20,()=>this.db.ticket.count({where:scope}),{rebuildLock:true,jitterSeconds:5});
  }
}
