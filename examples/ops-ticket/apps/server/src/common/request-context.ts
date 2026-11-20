import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// 请求上下文（D18）：同一个请求里任何地方都能拿到请求 ID，不用一层层当参数传
// AsyncLocalStorage 跟着异步调用链走：await、Promise、Prisma 的回调里都还在同一个上下文
interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

// 在指定的请求 ID 下执行（D29）：后台任务没有 HTTP 请求，用入队时那个请求的 ID，审计和日志能对上最初的请求
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

// 客户端（或网关）传了合法的 x-request-id 就沿用，方便跨服务追踪；否则生成一个
// 只接受字母、数字和连字符：它会写进日志和审计，不能让人塞进换行之类的字符伪造日志
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  // 响应头里带回去：用户报问题时给出这个 ID，就能找到对应的日志和审计
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId }, next);
}
