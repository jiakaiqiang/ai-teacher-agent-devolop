import { ConsoleLogger } from '@nestjs/common';
import { currentRequestId } from './request-context.js';

// 优先使用 Nest 内置 JSON logger；业务事件采用字段白名单，不接收完整请求或 Error。
const logger = new ConsoleLogger({
  json: true, colors: false, forceConsole: true,
  redact: ['password', 'authorization', 'cookie', 'ticket', 'accessToken', 'JWT_SECRET', 'SEED_USER_PASSWORD'],
});
const SAFE_FIELDS = new Set(['method', 'route', 'statusCode', 'durationMs', 'aborted', 'queue', 'jobId', 'attempt', 'operation', 'errorCode']);

export function eventRecord(event: string, fields: Record<string, unknown> = {}) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SAFE_FIELDS.has(key) && (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string')) {
      safe[key] = typeof value === 'string' ? value.slice(0, 160) : value;
    }
  }
  return { event, requestId: currentRequestId() ?? null, ...safe };
}

export function logEvent(event: string, fields: Record<string, unknown> = {}, level: 'log' | 'warn' | 'error' = 'log'): void {
  logger[level](eventRecord(event, fields), 'Operations');
}

// 不读取 message/stack/查询参数。保留已知错误码用于聚类，其余统一归类。
export function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^(P\d{4}|[A-Z0-9_]{2,40})$/.test(error.code)) return error.code;
  return 'UNCLASSIFIED';
}
