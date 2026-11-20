import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import { currentRequestId, runWithRequestId } from './request-context.js';
import { logEvent } from './structured-log.js';

export function httpLogMiddleware(req: Request, res: Response, next: NextFunction) {
  const started = performance.now();
  const requestId = currentRequestId()!;
  let written = false;
  const complete = (aborted: boolean) => {
    if (written) return;
    written = true;
    // 使用匹配到的路由模板，不写 URL、query、body 或认证头；404 合并成固定名称。
    const path: unknown = req.route?.path;
    runWithRequestId(requestId, () => logEvent('http.completed', {
      method: req.method,
      route: typeof path === 'string' && !path.includes('*') ? path : 'unmatched',
      statusCode: res.statusCode,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      aborted,
    }));
  };
  res.once('finish', () => complete(false));
  res.once('close', () => complete(!res.writableFinished));
  next();
}
