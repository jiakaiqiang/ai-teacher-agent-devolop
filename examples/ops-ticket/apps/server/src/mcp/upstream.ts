import { z } from 'zod';
import { TicketToolFailure, type Dispatch } from './server.js';

// 本地教学实例只向启动者配置的回环 API 发送该用户的业务令牌。
export function upstream(origin: string, runId: string, authorization: string): Dispatch {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin + '/' !== url.href ||
      !z.uuid().safeParse(runId).success || !/^Bearer [^\s]+$/.test(authorization)) {
    throw new Error('工单连接配置无效');
  }
  return async (name, args) => {
    const res = await fetch(new URL('/api/agent/runs/' + runId + '/tools', url), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ calls: [{ name, version: 1, args }] }),
    });
    if (!res.ok) throw new TicketToolFailure('TICKET_HTTP_' + res.status);
    const body = z.object({ data: z.tuple([z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), data: z.unknown() }),
      z.object({ ok: z.literal(false), code: z.string().regex(/^TOOL_[A-Z_]+$/) }),
    ])]) }).parse(await res.json());
    const item = body.data[0];
    if (!item.ok) throw new TicketToolFailure(item.code);
    return item.data;
  };
}
