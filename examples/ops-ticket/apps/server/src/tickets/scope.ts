import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export interface ScopeUser {id:string;role:string;companyId:string|null;departmentId:string|null}
export function visibleTickets(user:ScopeUser):Prisma.TicketWhereInput {
  switch(user.role) {
    case 'reporter':
      if (user.companyId) return {companyId:user.companyId,reporterId:user.id};
      break;
    case 'customer_admin':
      if (user.companyId) return {companyId:user.companyId};
      break;
    case 'department_lead':
      if (user.departmentId) return {departmentId:user.departmentId};
      break;
    case 'operator':
      if (user.departmentId) return {departmentId:user.departmentId,assigneeId:user.id};
      break;
  }
  throw new ForbiddenException('缺少有效的数据范围');
}
