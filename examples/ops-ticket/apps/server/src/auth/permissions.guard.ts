import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@ops-ticket/shared';
import type { AuthenticatedRequest } from './auth.types.js';
import { LOGIN_ONLY, REQUIRED_PERMISSIONS } from './permissions.decorator.js';
import { PermissionsService } from './permissions.service.js';
import { IS_PUBLIC } from './public.decorator.js';

// 全局权限守卫（D16），在 JwtAuthGuard 之后执行（两个守卫在 AuthModule 里按这个顺序注册）
// 默认拒绝：接口必须声明 @Public()、@LoginOnly() 或 @RequirePermission() 之一，忘了写就是 403
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user!; // JwtAuthGuard 已经保证登录
    const permissions = await this.permissions.permissionsOf(user.id);
    if (!permissions) {
      // 令牌有效，但用户已经被删除：按“未登录”处理，而不是“没有权限”
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '用户不存在，请重新登录' });
    }
    // 查出来挂在请求上，Service 里需要判断权限时不用再查（D17）
    user.permissions = permissions;

    if (this.reflector.getAllAndOverride<boolean>(LOGIN_ONLY, targets)) {
      return true;
    }
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (!required) {
      // 这是代码写漏了，不是用户的问题：写错误日志，方便在开发和测试阶段发现
      this.logger.error(`接口没有声明权限：${context.getClass().name}.${context.getHandler().name}`);
      throw new ForbiddenException({ code: 'PERMISSION_NOT_DECLARED', message: '接口没有声明所需权限' });
    }
    const missing = required.filter((p) => !user.permissions!.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: `没有权限：${missing.join('、')}` });
    }
    return true;
  }
}
