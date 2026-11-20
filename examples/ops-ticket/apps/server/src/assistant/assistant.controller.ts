import { Body, Controller, HttpCode, Param, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { AssistantDto } from './assistant.dto.js';
import { AssistantService } from './assistant.service.js';
import { buildMessages, ModelError } from './chat.client.js';
import { parseChatStream } from './chat.stream.js';
import { ModelSource } from './model.source.js';
import { AssistantStreams } from './stream-lifecycle.js';

@Controller('tickets')
export class AssistantController {
  constructor(private readonly assistant: AssistantService, private readonly source: ModelSource, private readonly streams: AssistantStreams) {}
  @Post(':ticketNo/assistant')
  @HttpCode(200)
  @RequirePermission('ticket:report')
  async stream(@Param('ticketNo') ticketNo: string, @Body() dto: AssistantDto,
    @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const context = await this.assistant.context(ticketNo, req.user!.id);
    // 查询自身不支持取消；预算从允许调用模型时开始，鉴权/查询仍走原HTTP链路。
    const lease = this.streams.open(res);
    let body: ReadableStream<Uint8Array> | undefined;
    try {
      lease.signal.throwIfAborted();
      const source = await this.source.open(buildMessages(context, dto.question), lease.signal);
      body = source.body; lease.signal.throwIfAborted();
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      await lease.send({ type: 'meta', mode: source.mode });
      for await (const event of parseChatStream(body, lease.signal)) await lease.send(event);
    } catch (error) {
      const reason: unknown = lease.signal.aborted ? lease.signal.reason : error;
      const code = reason instanceof ModelError ? reason.code : 'MODEL_PROTOCOL_ERROR';
      if (!res.headersSent && !res.destroyed) throw new ServiceUnavailableException({ code, message: '排查建议暂不可用' });
      // 慢客户端的缓冲已满时直接关闭，不继续堆积错误帧。
      if (res.headersSent && !res.destroyed && !res.writableNeedDrain) res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', code })}\n\n`);
    } finally {
      lease.dispose();
      if (body && !body.locked) await body.cancel().catch(() => {});
      if (res.headersSent && !res.destroyed) {
        if (res.writableNeedDrain) res.destroy(); else res.end();
      }
    }
  }
}
