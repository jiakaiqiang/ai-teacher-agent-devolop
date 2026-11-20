import { Injectable } from '@nestjs/common';
import type { Permission } from '@ops-ticket/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  // 用户通过所有角色得到的权限点，去重、排序；用户不存在时返回 null（令牌还没过期，但账号已经删了）
  // 每个请求查一次数据库：改了角色立即生效，不用等令牌过期。W4 有了 Redis 后可以加缓存
  async permissionsOf(userId: string): Promise<Permission[] | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, registrationStatus: "approved" },
      select: {
        roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } },
      },
    });
    if (!user) {
      return null;
    }
    const codes = user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code as Permission));
    return [...new Set(codes)].sort();
  }
}
