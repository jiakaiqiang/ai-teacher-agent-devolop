import { Injectable } from '@nestjs/common';

// 健康检查返回的数据结构
export interface HealthStatus {
  status: 'ok';
  service: string;
  time: string;
}

@Injectable()
export class AppService {
  // 只说明“进程活着并能处理请求”；以后接入数据库后再补依赖检查
  getHealth(): HealthStatus {
    return {
      status: 'ok',
      service: 'ops-ticket-server',
      time: new Date().toISOString(),
    };
  }
}
