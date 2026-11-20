import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@ops-ticket/shared';

// 接口需要的权限点（D16），写多个时要求全部具备
export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

// 只要登录、不需要任何权限点的接口，例如“查看我自己是谁”
// 必须显式写出来：既没有 @Public()、也没有 @RequirePermission()、也没有 @LoginOnly() 的接口一律拒绝
export const LOGIN_ONLY = 'loginOnly';
export const LoginOnly = () => SetMetadata(LOGIN_ONLY, true);
