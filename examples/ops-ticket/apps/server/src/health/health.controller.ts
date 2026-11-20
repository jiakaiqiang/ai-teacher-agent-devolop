import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { Public } from '../auth/public.decorator.js';
import { logEvent } from '../common/structured-log.js';
import { DependencyProbe } from './dependency-probe.service.js';
import { ShutdownState } from './shutdown-state.js';
import { boundedProbe } from './bounded-probe.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService, private readonly indicators: HealthIndicatorService,
    private readonly probes: DependencyProbe, private readonly shutdown: ShutdownState) {}

  @Public()
  @Get('live')
  live() { return { status: 'alive' }; }

  @Public()
  @Get('ready')
  @HealthCheck()
  async ready() {
    if (this.shutdown.draining) throw new ServiceUnavailableException({ code: 'NOT_READY', message: '服务正在停止' });
    try {
      const result = await this.health.check([
        () => this.indicators.check('database').attempt(async () => {
          try { await this.probes.pingDatabase(); } catch { throw new Error('DATABASE_NOT_READY'); }
        }).withTimeout(700).cacheFor(250),
        () => this.indicators.check('queue').attempt(async () => {
          try { await this.probes.pingQueue(); } catch { throw new Error('QUEUE_NOT_READY'); }
        }).withTimeout(700).cacheFor(250),
        async () => {
          const indicator = this.indicators.check('cache');
          // 缓存降级仍能提供核心工单 API；SSE 签票等依赖缓存的功能会返回自己的 503。
          try { await boundedProbe(() => this.probes.pingCache(), 700); return indicator.up(); }
          catch { return indicator.degraded(); }
        },
      ]);
      return { status: result.status, database: result.details.database.status,
        queue: result.details.queue.status, cache: result.details.cache.status };
    } catch {
      logEvent('health.not_ready', { errorCode: 'DEPENDENCY_UNAVAILABLE' }, 'warn');
      // 对公开探针只给通用状态，不暴露连接串、堆栈或驱动细节。
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: '必要依赖暂不可用' });
    }
  }
}
