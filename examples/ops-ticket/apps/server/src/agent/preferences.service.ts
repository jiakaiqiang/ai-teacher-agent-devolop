import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readAccess } from '../assistant/read-tools.service.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { expiresOn, preferenceWrite } from './preference.js';

const view = { layout: true, revision: true, expiresAt: true } as const;
@Injectable()
export class PreferencesService {
  constructor(private readonly db: PrismaService) {}
  private async scope(tx: TransactionClient, userId: string) {
    const access = await readAccess(tx, userId).catch((err: unknown) => {
      if (err instanceof Error && err.message === 'TOOL_FORBIDDEN') throw new ForbiddenException();
      throw err;
    });
    if (!access.user.companyId) throw new ForbiddenException();
    return { userId, tenantKey: access.user.companyId };
  }
  async get(userId: string) {
    return this.db.$transaction(async tx => {
      const scope = await this.scope(tx, userId);
      return tx.agentPreference.findFirst({ where: { ...scope, expiresAt: { gt: new Date() } }, select: view });
    }, { isolationLevel: 'RepeatableRead' });
  }
  async write(userId: string, input: unknown) {
    const parsed = preferenceWrite.safeParse(input);
    if (!parsed.success) throw new BadRequestException('交接偏好格式无效');
    const { layout, days, expected } = parsed.data;
    return this.db.serializable(async tx => {
      const scope = await this.scope(tx, userId), now = new Date();
      const data = { layout, expiresAt: expiresOn(now, days), revision: randomUUID() };
      if (expected === null) {
        await tx.agentPreference.deleteMany({ where: { ...scope, expiresAt: { lte: now } } });
        const inserted = await tx.agentPreference.createMany({ data: { ...scope, ...data }, skipDuplicates: true });
        if (!inserted.count) throw new ConflictException('偏好已变化，请重新读取');
      } else {
        const changed = await tx.agentPreference.updateMany({ where: { ...scope, revision: expected, expiresAt: { gt: now } }, data });
        if (!changed.count) throw new ConflictException('偏好已变化，请重新读取');
      }
      return data;
    });
  }
  async forget(userId: string, expected: string) {
    return this.db.serializable(async tx => {
      const scope = await this.scope(tx, userId);
      const removed = await tx.agentPreference.deleteMany({ where: { ...scope, revision: expected } });
      if (!removed.count && await tx.agentPreference.count({ where: scope })) throw new ConflictException('偏好已变化，请重新读取');
      return { forgotten: true };
    });
  }
}
