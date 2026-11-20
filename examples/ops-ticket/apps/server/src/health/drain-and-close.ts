import { RunStreamService } from '../agent/run-stream.service.js';
import { AssistantStreams } from '../assistant/stream-lifecycle.js';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { logEvent } from '../common/structured-log.js';
import { ShutdownState } from './shutdown-state.js';

export function drainingMiddleware(state: ShutdownState) {
  return (req: Request, res: Response, next: NextFunction) => {
    const healthProbe = ['/api/health/live', '/api/health/ready'].includes(req.path);
    if (state.draining && !healthProbe) {
      res.setHeader('Connection', 'close');
      res.status(503).json({ error: { code: 'SHUTTING_DOWN', message: '服务正在停止，请稍后重试' } });
      return;
    }
    if (!healthProbe) {
      const finished = state.trackResponse();
      res.once('finish', finished);
      res.once('close', finished);
    }
    next();
  };
}

const closing = new WeakMap<INestApplication, Promise<void>>();
// 先摘流量、结束 SSE、等待在途任务，再关闭 HTTP 与依赖；重复调用共用同一 Promise。
export function drainAndClose(app: INestApplication): Promise<void> {
  const previous = closing.get(app);
  if (previous) return previous;
  const task = (async () => {
    app.get(ShutdownState).begin();
    logEvent('shutdown.started');
    app.get(RunStreamService).beginShutdown();
    app.get(AssistantStreams).beginShutdown();
    // 保持队列生产者可用，已进入的 HTTP 仍可能要完成入队。
    await app.get(ShutdownState).waitForResponses();
    await app.close();
    logEvent('shutdown.completed');
  })();
  closing.set(app, task);
  return task;
}
