import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// 标记为全局模块：各业务模块直接注入 PrismaService，不用每个都 imports
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
