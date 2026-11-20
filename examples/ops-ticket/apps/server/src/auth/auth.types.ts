import type { Permission } from '@ops-ticket/shared';
import type { Request } from 'express';

// 令牌里放的内容：sub 是用户 id（JWT 的标准字段名），username 方便日志和排查
// 不放角色和权限：它们会变，令牌在过期前改不了（D16 会从数据库读权限）
export interface TokenPayload {
  sub: string;
  username: string;
}

// 守卫校验通过后挂在请求上的当前用户
export interface AuthUser {
  id: string;
  username: string;
  // 权限守卫查出来后挂上（D16）
  permissions?: Permission[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
