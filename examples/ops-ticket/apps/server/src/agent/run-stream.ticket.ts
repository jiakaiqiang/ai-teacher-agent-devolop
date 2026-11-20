import { BadRequestException, CanActivate, ExecutionContext, Injectable, ServiceUnavailableException,
  UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

export const RUN_TICKET_TTL_SECONDS = 30;
export const runTicketKey = (ticket: string) =>
  'agent-run-ticket:' + createHash('sha256').update(ticket).digest('hex');

const invalidTicket = () =>
  new UnauthorizedException({ code: 'RUN_TICKET_INVALID', message: '连接票据无效或已过期，请重新获取' });

// 浏览器的 EventSource 不能带 Authorization 头（D33 的结论），所以先用已登录的接口换一张
// 短期、一次性、绑定到这个 Run 的票据，再用它建立 SSE 连接。
@Injectable()
export class RunTicketService {
  constructor(private readonly redis: RedisService) {}

  async issue(userId: string, runId: string, after: number) {
    const ticket = randomBytes(32).toString('hex');
    try {
      await this.redis.set(runTicketKey(ticket), JSON.stringify({ userId, runId, after }),
        'EX', RUN_TICKET_TTL_SECONDS);
    } catch {
      throw new ServiceUnavailableException({ code: 'RUN_STREAM_UNAVAILABLE', message: '运行事件流暂不可用，请稍后重试' });
    }
    return { ticket, expiresAt: new Date(Date.now() + RUN_TICKET_TTL_SECONDS * 1000).toISOString() };
  }

  async consume(ticket: unknown, runId: string, lastEventId?: string) {
    if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) throw invalidTicket();
    let raw: string | null;
    try {
      // 原子读取并删除：同一张票据只能换一条连接。
      raw = await this.redis.getdel(runTicketKey(ticket));
    } catch {
      throw new ServiceUnavailableException({ code: 'RUN_STREAM_UNAVAILABLE', message: '运行事件流暂不可用，请稍后重试' });
    }
    if (raw === null) throw invalidTicket();
    let saved: { userId?: unknown; runId?: unknown; after?: unknown };
    try {
      saved = JSON.parse(raw) as typeof saved;
    } catch {
      throw invalidTicket();
    }
    if (typeof saved.userId !== 'string' || typeof saved.runId !== 'string'
      || typeof saved.after !== 'number') throw invalidTicket();
    // 票据绑定 Run：拿着另一个运行的票据来连，拒绝。
    if (saved.runId !== runId) throw invalidTicket();
    return { userId: saved.userId, runId: saved.runId, after: parseRunCursor(lastEventId) ?? saved.after };
  }
}

export function parseRunCursor(value: string | undefined) {
  if (value === undefined || value === '') return null;
  if (value.length > 12 || !/^r-(0|[1-9]\d*)$/.test(value)) {
    throw new BadRequestException({ code: 'RUN_CURSOR_INVALID', message: '运行事件游标无效' });
  }
  return Number(value.slice(2));
}

export interface RunStreamRequest extends Request {
  runStream: { userId: string; runId: string; after: number };
}

@Injectable()
export class RunStreamGuard implements CanActivate {
  constructor(private readonly tickets: RunTicketService) {}

  // 在写出 SSE 响应头之前鉴权：失败返回标准 HTTP 错误，不建立一条错误的长连接。
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RunStreamRequest>();
    const runId = String(request.params.id ?? '');
    request.runStream = await this.tickets.consume(request.query.ticket, runId,
      request.header('last-event-id'));
    return true;
  }
}
