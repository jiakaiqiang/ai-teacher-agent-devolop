import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

function response(finished: boolean) {
  return Object.assign(new EventEmitter(), { writableFinished: finished, statusCode: 200, getHeader: () => undefined });
}
describe('请求指标生命周期', () => {
  it('finish 后 close 不能重复累计，Registry 按应用隔离', async () => {
    const first = new MetricsService(); const second = new MetricsService();
    const res = response(true);
    first.middleware()({ method: 'GET', route: { path: '/api/example' } } as Request, res as unknown as Response, () => {});
    res.emit('finish'); res.emit('close');
    const text = await first.registry.metrics();
    expect(text).toContain('ops_http_requests_total{method="GET",route="/api/example",status_class="2xx"} 1');
    expect(await second.registry.metrics()).not.toContain('/api/example');
  });
  it('未完成响应单列 aborted，未知方法与未匹配路由归并', async () => {
    const metrics = new MetricsService(); const res = response(false);
    metrics.middleware()({ method: 'CUSTOM', route: { path: '/*path' } } as Request, res as unknown as Response, () => {});
    res.emit('close');
    expect(await metrics.registry.metrics()).toContain('method="OTHER",route="unmatched",status_class="aborted"');
  });
});
