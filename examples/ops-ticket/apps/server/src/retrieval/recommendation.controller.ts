import { Controller, Get, NotFoundException, Param, Req, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { visibleTickets } from '../tickets/scope.js';
import { RequirePermission } from '../auth/permissions.decorator.js';

import { PrismaService } from '../prisma/prisma.service.js';
import { retrieve } from './retrieve.js';

@Controller('tickets')
export class RecommendationController {
  constructor(private readonly db: PrismaService) {}

  @RequirePermission('ticket:read')
  @Get(':ticketNo/recommendations')
  async list(@Param('ticketNo') ticketNo: string, @Req() req: AuthenticatedRequest) {
    const user=await this.db.user.findUniqueOrThrow({where:{id:req.user!.id}});
    const scope=visibleTickets(user);
    const ticket = await this.db.ticket.findFirst({ where: { ...scope, ticketNo }, select: { companyId:true,title: true, description: true } });
    if (!ticket) throw new NotFoundException('工单不存在');
    try {
      return await retrieve(this.db, [ticket.title, ticket.description].join('\n'), ticket.companyId, 'ticket:' + ticketNo);
    } catch {
      // 推荐单独降级，避免依赖内部信息或原文出现在错误里。
      throw new ServiceUnavailableException('处置参考暂不可用');
    }
  }
}
