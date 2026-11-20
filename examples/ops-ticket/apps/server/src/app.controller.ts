import { Public } from './auth/public.decorator.js';
import { Controller, Get } from '@nestjs/common';
import { AppService, type HealthStatus } from './app.service.js';

@Controller()
export class AppController {
  // 构造函数参数由 Nest 的依赖注入容器自动创建并传入
  constructor(private readonly appService: AppService) {}

  // 加上全局前缀后，完整路径是 GET /api/health
  @Public()
  @Get('health')
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
