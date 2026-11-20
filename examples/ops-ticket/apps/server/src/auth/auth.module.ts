import { PermissionsService } from './permissions.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RegistrationsController } from './registrations.controller.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    // global：其他模块（以及接口测试）可以直接注入 JwtService
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        // 和 DATABASE_URL 一样，启动时就失败；不要给密钥写默认值，写了就会有人忘记改
        if (!secret || secret.length < 32) {
          throw new Error('缺少环境变量 JWT_SECRET，或长度不足 32 个字符，请检查 apps/server/.env');
        }
        return { secret, signOptions: { expiresIn: '2h' } };
      },
    }),
  ],
  controllers: [AuthController, RegistrationsController],
  providers: [PermissionsService, AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }, {provide:APP_GUARD,useClass:PermissionsGuard}],
})
export class AuthModule {}
