import { WorklistStats } from './worklist-stats.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { ListTicketsQuery } from './dto/list-tickets.query.js';
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { TicketsService, type TicketDetail } from './tickets.service.js';

@RequirePermission('ticket:read')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService, private readonly stats:WorklistStats) {}

  @Get()
  list(@Req() req:AuthenticatedRequest, @Query() query: ListTicketsQuery) {
    return this.ticketsService.list(req.user!.id,query);
  }

  // 用给人看的工单编号查询，不在 URL 里暴露内部主键
  @Get('stats/count')
  total(@Req() req:AuthenticatedRequest) {return this.stats.count(req.user!.id);}

  @Get(':ticketNo')
  findDetail(@Req() req:AuthenticatedRequest, @Param('ticketNo') ticketNo: string): Promise<TicketDetail> {
    return this.ticketsService.findDetail(req.user!.id,ticketNo);
  }
}
