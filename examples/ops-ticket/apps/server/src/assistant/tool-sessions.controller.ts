import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sessionCreateSchema, sessionTurnInputSchema, sessionDetailSchema, sessionSummarySchema, sessionListSchema, type ToolSessionEvent } from '@ops-ticket/shared';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

import { RequirePermission } from '../auth/permissions.decorator.js';

import { ConversationsService } from './conversations.service.js';
import { ToolSessionService, sessionFailureCode } from './tool-session.service.js';
import { AssistantStreams } from './stream-lifecycle.js';
import { ToolFailure } from './tool-protocol.js';
import { parseStoredTranscript } from './conversation-context.js';

function httpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = sessionFailureCode(error);
  const status = code.endsWith('NOT_FOUND') ? 404 : code === 'TOOL_FORBIDDEN' ? 403 : /INVALID|ARGUMENT/.test(code) ? 400 : /CONFLICT|BUSY|CHANGED|LIMIT/.test(code) ? 409 : 503;
  throw new HttpException({ code, message: '会话请求未完成，请查看状态后再试' }, status);
}
function summary(row: { id: string; title: string; version: number; activeTurnId: string | null; updatedAt: Date }) {
  return sessionSummarySchema.parse({ id: row.id, title: row.title, version: row.version, activeTurnId: row.activeTurnId, updatedAt: row.updatedAt.toISOString() });
}

@Controller('assistant/conversations')
@RequirePermission('ticket:report')
export class ToolSessionsController {
  constructor(private readonly store: ConversationsService, private readonly sessions: ToolSessionService, private readonly streams: AssistantStreams) {}
  @Post() @HttpCode(201)
  async create(@Req() req: AuthenticatedRequest, @Body() input: unknown) {
    try { const parsed = sessionCreateSchema.safeParse(input); if (!parsed.success) throw new ToolFailure('CONVERSATION_INVALID'); return summary(await this.store.create(req.user!.id, parsed.data.title)); }
    catch (error) { httpError(error); }
  }
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    try { return sessionListSchema.parse((await this.store.list(req.user!.id)).map(summary)); } catch (error) { httpError(error); }
  }
  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    try {
      const { conversation, turns } = await this.store.get(req.user!.id, id);
      return sessionDetailSchema.parse({ conversation: summary(conversation), turns: turns.map(turn => {
        const messages = turn.status === 'completed' ? parseStoredTranscript(turn.transcript) : [];
        const calls = messages.flatMap(message => message.role === 'assistant' ? message.tool_calls ?? [] : []);
        return { id: turn.id, requestKey: turn.requestKey, ordinal: turn.ordinal, question: turn.question, status: turn.status, mode: turn.mode, answer: turn.answer, errorCode: turn.errorCode,
          tools: calls.map(call => ({ callId: call.id, name: call.function.name, arguments: call.function.arguments, content: messages.find(message => message.role === 'tool' && message.tool_call_id === call.id)?.content ?? '' })) };
      }) });
    } catch (error) { httpError(error); }
  }
  @Post(':id/turns') @HttpCode(200)
  async turn(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() input: unknown, @Res() res: Response) {
    const parsed = sessionTurnInputSchema.safeParse(input);
    if (!parsed.success) httpError(new ToolFailure('CONVERSATION_INVALID'));
    const lease = this.streams.open(res);
    let last: ToolSessionEvent | undefined, bytes = 0;
    const send = async (event: ToolSessionEvent) => {
      bytes += Buffer.byteLength(JSON.stringify(event));
      if (bytes > 65536) throw new ToolFailure('TOOL_RESULT_LIMIT');
      if (!res.headersSent) { res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.flushHeaders(); }
      last = event; await lease.send(event);
    };
    try { await this.sessions.run(req.user!.id, id, parsed.data, lease.signal, send); }
    catch (error) {
      if (!res.headersSent && !res.destroyed) httpError(error);
      if (last && !res.destroyed && !res.writableNeedDrain && last.type !== 'done' && last.seq < 16) {
        const event = { protocol: 1, runId: last.runId, seq: last.seq + 1, type: 'error', code: sessionFailureCode(error) };
        res.write(`event: error\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      lease.dispose();
      if (res.headersSent && !res.destroyed) { if (res.writableNeedDrain) res.destroy(); else res.end(); }
    }
  }
}
