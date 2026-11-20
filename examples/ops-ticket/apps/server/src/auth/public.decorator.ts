import { SetMetadata } from '@nestjs/common';

// 标记不需要登录的接口（登录本身、健康检查）
// 全局守卫默认要求登录，新接口忘了加守卫也是安全的；需要公开的接口要显式写出来
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
