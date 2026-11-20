import { redactForLog } from './sensitive.js';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

// 错误响应统一结构：code 给程序判断，message 给人看，details 放校验失败的字段
export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface MappedError {
  status: number;
  code: string;
  message: string;
}

// 把数据库约束错误翻译成 HTTP 错误；约束名等内部细节只写日志，不返回给客户端
function mapPrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): MappedError | undefined {
  switch (error.code) {
    case 'P2002': // 唯一约束冲突
      return { status: HttpStatus.CONFLICT, code: 'DUPLICATE_RESOURCE', message: '数据已存在' };
    case 'P2003': // 外键约束：被引用的行不能删，或引用的行不存在
      return { status: HttpStatus.CONFLICT, code: 'RESOURCE_IN_USE', message: '数据仍被其他记录引用，不能删除' };
    case 'P2025': // 要更新或删除的记录不存在
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: '记录不存在' };
  }
  // CHECK 约束没有专门的 Prisma 错误码，要看 PostgreSQL 的原始错误码 23514
  const cause = (error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined)?.cause;
  if (cause?.originalCode === '23514') {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: 'CONSTRAINT_VIOLATION', message: '数据不满足业务约束' };
  }
  return undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      // ValidationPipe 抛出的 400，message 是字段错误数组，放进 details
      const message =
        typeof raw === 'object' && raw !== null && 'message' in raw
          ? (raw as { message: unknown }).message
          : exception.message;
      const body: ErrorBody = {
        error: {
          code: typeof raw === 'object' && raw !== null && 'code' in raw && typeof raw.code === 'string'
            ? raw.code : HttpStatus[status] ?? 'HTTP_ERROR',
          message: Array.isArray(message) ? '请求参数不合法' : String(message),
          ...(Array.isArray(message) ? { details: message } : {}),
        },
      };
      if (status === 429 && typeof raw === 'object' && 'retryAfterSeconds' in raw) {
        const delay = Number(raw.retryAfterSeconds);
        if (Number.isSafeInteger(delay) && delay > 0) response.setHeader('Retry-After', String(delay));
      }
      response.status(status).json(body);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      if (mapped) {
        // 约束名这类细节写日志，方便排查
        this.logger.warn(`${exception.code}: ${exception.message.split('\n').filter(Boolean).pop()}`);
        const body: ErrorBody = { error: { code: mapped.code, message: mapped.message } };
        response.status(mapped.status).json(body);
        return;
      }
    }

    // 未知异常：完整堆栈只写日志，不返回给客户端，避免泄露内部信息
    this.logger.error(exception instanceof Error ? exception.stack ? redactForLog(exception.stack) : undefined : exception);
    const body: ErrorBody = {
      error: { code: 'INTERNAL_SERVER_ERROR', message: '服务器内部错误' },
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
