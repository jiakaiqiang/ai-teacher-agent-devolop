import { LoginOnly } from '../auth/permissions.decorator.js';
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuthService, type LoginResult } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/login  { "username": "bob", "password": "..." }
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto);
  }

  // GET /api/auth/me：前端刷新页面后用令牌换回当前用户
  @LoginOnly()
@Get('me')
  me(@Req() request: AuthenticatedRequest): Promise<{ username: string; displayName: string }> {
    // 全局守卫已经保证 request.user 存在
    return this.authService.me(request.user!.id);
  }
}
