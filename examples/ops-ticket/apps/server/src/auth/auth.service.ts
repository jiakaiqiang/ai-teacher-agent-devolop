import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TokenPayload } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import { hashPassword, verifyPassword } from './password.js';

export interface LoginResult {
  accessToken: string;
  user: { username: string; displayName: string; role:string };
}

// 用户不存在时也要做一次同样耗时的校验，否则“用户不存在”比“密码错误”返回得快，
// 攻击者可以靠响应时间判断哪些用户名存在
const dummyHash = hashPassword('dummy-password-for-timing');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      select: { id: true, username: true, displayName: true, role:true, registrationStatus: true, passwordHash: true },
    });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? (await dummyHash));
    if (!user?.passwordHash || !ok || user.registrationStatus !== "approved") {
      // 用户不存在、没有设置密码、密码错误，返回完全一样的错误
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    }
    const payload: TokenPayload = { sub: user.id, username: user.username };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { username: user.username, displayName: user.displayName, role:user.role },
    };
  }

  async me(userId: string): Promise<{ username: string; displayName: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    if (!user) {
      // 令牌还没过期，但用户已经被删了
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '用户不存在，请重新登录' });
    }
    return user;
  }
}
