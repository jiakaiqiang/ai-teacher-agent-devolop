import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { visibleTickets } from '../tickets/scope.js';
import { redactForLog } from '../common/sensitive.js';

@Injectable()
export class AssistantService {
  constructor(private readonly db: PrismaService) {}

  async context(ticketNo: string, userId: string): Promise<string> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const ticket = await this.db.ticket.findFirst({
      where: { AND: [visibleTickets(user), { ticketNo }] },
      select: {
        ticketNo: true, description: true, category: { select: { name: true } },
        materials: { orderBy: { id: 'asc' }, take: 4, select: { logText: true } },
      },
    });
    if (!ticket) throw new NotFoundException('工单不存在');
    return JSON.stringify({
      ticketNo, category: ticket.category.name, description: redactForLog(ticket.description).slice(0, 1600),
      logs: ticket.materials.map(item => redactForLog(item.logText).slice(0, 800)),
    });
  }
}
