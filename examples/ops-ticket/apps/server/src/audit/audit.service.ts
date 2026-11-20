import { Injectable } from '@nestjs/common';
import type { TransactionClient } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { currentRequestId } from '../common/request-context.js';
@Injectable()
export class AuditService {
  record(tx:TransactionClient,data:Prisma.AuditLogUncheckedCreateInput) {
    return tx.auditLog.create({data:{...data,requestId:currentRequestId()}});
  }
}
