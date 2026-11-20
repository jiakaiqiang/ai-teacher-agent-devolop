import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const EXCLUDED = new Set(['/api/operations/metrics', '/api/health', '/api/health/live', '/api/health/ready']);

@Injectable()
export class MetricsService {
  // 每个应用独立注册，测试启动多个 Nest 应用也不会重复注册到全局。
  readonly registry = new Registry();
  private readonly requests = new Counter({
    name: 'ops_http_requests_total', help: 'Completed ordinary HTTP responses or aborted connections',
    labelNames: ['method', 'route', 'status_class'] as const, registers: [this.registry],
  });
  private readonly duration = new Histogram({
    name: 'ops_http_duration_seconds', help: 'Ordinary HTTP duration until finish or close',
    labelNames: ['method', 'route', 'status_class'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 1, 3], registers: [this.registry],
  });

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const started = performance.now();
      let recorded = false;
      const complete = () => {
        if (recorded) return;
        recorded = true;
        const template: unknown = req.route?.path;
        const route = typeof template === 'string' && !template.includes('*') ? template : 'unmatched';
        // 成功建立的长连接不与普通请求耗时混算；拒绝的签票/连接仍算普通错误响应。
        if (EXCLUDED.has(route) || String(res.getHeader('content-type')).startsWith('text/event-stream')) return;
        const labels = {
          method: METHODS.has(req.method) ? req.method : 'OTHER', route,
          status_class: res.writableFinished ? `${Math.floor(res.statusCode / 100)}xx` : 'aborted',
        };
        this.requests.inc(labels);
        this.duration.observe(labels, Math.max(0, (performance.now() - started) / 1000));
      };
      res.once('finish', complete);
      res.once('close', complete);
      next();
    };
  }
}
