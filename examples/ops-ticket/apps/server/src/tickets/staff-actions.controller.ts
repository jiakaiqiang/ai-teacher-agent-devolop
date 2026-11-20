import { Controller, Get, Param, Req, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { LoginOnly } from '../auth/permissions.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { visibleTickets } from './scope.js';

@Controller('tickets/:no/staff-actions')
@LoginOnly()
export class StaffActionsController {
  constructor(private readonly db:PrismaService) {}
  @Get()
  async read(@Param('no') ticketNo:string,@Req() req:AuthenticatedRequest) {
    const actor=await this.db.user.findFirstOrThrow({where:{id:req.user!.id,registrationStatus:'approved'}});
    const ticket=await this.db.ticket.findFirst({where:{AND:[{ticketNo},visibleTickets(actor)]}});
    if(!ticket) throw new NotFoundException();
    const lead=actor.role==='department_lead' && actor.departmentId===ticket.departmentId;
    const handler=actor.role==='operator' && actor.id===ticket.assigneeId;
    const assign=lead && ticket.status==='pending_assignment';
    const operators=assign?await this.db.user.findMany({
      where:{departmentId:ticket.departmentId,role:'operator',registrationStatus:'approved'},
      select:{id:true,displayName:true},orderBy:{displayName:'asc'}
    }):[];
    return {actions:assign?['assign']:lead && ticket.status==='handled'?['approve','return']:
      handler && ticket.status==='human_processing'?['handle']:[],operators};
  }
}
