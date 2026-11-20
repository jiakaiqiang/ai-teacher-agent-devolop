import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest, TokenPayload } from './auth.types.js';
import { IS_PUBLIC } from './public.decorator.js';

const unauthenticated = (message: string) => new UnauthorizedException({ code: 'UNAUTHENTICATED', message });

// 全局守卫：除了标了 @Public() 的接口，都要带 Authorization: Bearer <令牌>
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 方法上和类上的标记都要看：@Public() 可以加在单个接口上，也可以加在整个控制器上
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw unauthenticated('请先登录');
    }
    try {
      // 校验签名和过期时间；签名不对、过期、格式错误都会抛错
      const payload = await this.jwt.verifyAsync<TokenPayload>(token);
      request.user = { id: payload.sub, username: payload.username };
      return true;
    } catch {
      throw unauthenticated('登录已失效，请重新登录');
    }
  }
}
