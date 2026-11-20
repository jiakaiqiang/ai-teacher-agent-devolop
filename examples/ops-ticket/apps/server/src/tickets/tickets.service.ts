import { redactForLog } from '../common/sensitive.js';
import { visibleTickets } from './scope.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import type { ListTicketsQuery } from './dto/list-tickets.query.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const detailSelect = {
  reporterId:true, version: true, ticketNo: true, title: true, description: true, status: true, createdAt: true,
  company: { select: { name: true } }, department: { select: { name: true } },
  category: { select: { name: true } }, reporter: { select: { displayName: true } },
  assignee: { select: { displayName: true } },
  materials: { select: { logText: true }, orderBy: { id: 'asc' } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { action: true, comment: true, toStatus: true, actor: { select: { displayName: true } } } },
} satisfies Prisma.TicketSelect;

export type TicketDetail = Omit<Prisma.TicketGetPayload<{ select: typeof detailSelect }>,'reporterId'> & {canConfirm:boolean};

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}
  private async scope(id: string) {
    return visibleTickets(await this.prisma.user.findUniqueOrThrow({where:{id}}));
  }
  async list(userId:string, { company, department, cursor, limit }: ListTicketsQuery) {
    const after = cursor ? decodeCursor(cursor) : undefined;
    const rows = await this.prisma.ticket.findMany({
      where: {
        AND: [await this.scope(userId)],
        company: company ? { name: company } : undefined,
        department: department ? { name: department } : undefined,
        OR: after ? [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ] : undefined,
      },
      orderBy: [{createdAt:'desc'}, {id:'desc'}], take: limit + 1,
      select: { id:true, ticketNo:true, title:true, status:true, createdAt:true },
    });
    const page = rows.slice(0,limit);
    return {
      items: page.map(({ id: _id, ...item }) => item),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async findDetail(userId:string, ticketNo: string): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findFirst({ where: { AND:[await this.scope(userId),{ ticketNo }] }, select: detailSelect });
    if (!ticket) throw new NotFoundException('工单不存在');
    const { reporterId, ...publicDetail }=ticket;
    return { ...publicDetail, canConfirm:reporterId===userId, materials:ticket.materials.map(m=>({logText:redactForLog(m.logText)})) };
  }
}
