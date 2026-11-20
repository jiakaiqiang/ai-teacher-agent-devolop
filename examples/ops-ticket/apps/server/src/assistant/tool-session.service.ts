import { HttpException, Injectable } from '@nestjs/common';
import { toolSessionEventSchema, type ToolSessionEvent, type ToolSessionPayload } from '@ops-ticket/shared';
import { ConversationsService } from './conversations.service.js';
import { ReadToolsService, readToolDefinitions } from './read-tools.service.js';
import { ModelGateway } from './model-gateway.js';
import { AiQuotaService } from './ai-quota.service.js';
import { UsageMeter } from './usage-meter.js';
import { readModelRegistry } from './model-registry.js';
import { GatewayFailure } from './model-policy.js';
import { ToolFailure } from './tool-protocol.js';
import { buildConversationContext, parseStoredTranscript } from './conversation-context.js';
import { runToolLoop } from './tool-loop.js';
import { mockToolCompletion } from './mock-tools.js';

export function sessionFailureCode(error: unknown): string {
  if (error instanceof ToolFailure || error instanceof GatewayFailure) return error.code;
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body && 'code' in body && typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)) return body.code;
  }
  return 'CONVERSATION_FAILED';
}

@Injectable()
export class ToolSessionService {
  constructor(private readonly store: ConversationsService, private readonly tools: ReadToolsService,
    private readonly gateway: ModelGateway, private readonly quota: AiQuotaService) {}
  async run(userId: string, conversationId: string, input: { requestKey: string; version: number; question: string }, signal: AbortSignal, emit: (event: ToolSessionEvent) => Promise<void>) {
    signal.throwIfAborted();
    const history = await this.store.get(userId, conversationId);
    const context = buildConversationContext(history.turns, input.question);
    const begun = await this.store.begin(userId, { ...input, conversationId });
    let seq = 0;
    const send = (payload: ToolSessionPayload) => emit(toolSessionEventSchema.parse({ ...payload, protocol: 1, runId: begun.turn.id, seq: ++seq }));
    if (begun.replay) {
      await send({ type: 'meta', mode: begun.turn.mode === 'model' ? 'model' : 'mock', replay: true });
      if (begun.turn.status === 'failed') { await send({ type: 'error', code: begun.turn.errorCode ?? 'CONVERSATION_FAILED' }); return; }
      const receipt = await this.quota.receipt(userId, begun.turn.id);
      await send({ type: 'answer', text: begun.turn.answer });
      await send({ type: 'done', conversationVersion: history.conversation.version, billing: receipt });
      return;
    }
    const meter = new UsageMeter();
    let reservation: string | undefined, settlementAttempted = false, persisted = false;
    let mode: 'mock' | 'model' = 'mock';
    try {
      signal.throwIfAborted();
      mode = readModelRegistry().resolve() ? 'model' : 'mock';
      // 用服务端轮次ID计量，避免不同会话或分诊共用客户端请求键。
      reservation = await this.quota.reserve(userId, begun.turn.id);
      await send({ type: 'meta', mode, replay: false });
      const deadline = Date.now() + 10000;
      const result = await runToolLoop({ messages: context.messages, signal,
        complete: (messages, child, enabled) => mode === 'mock' ? mockToolCompletion(messages, child, enabled) :
          this.gateway.complete(messages, child, 'default', Math.min(5000, Math.max(1, deadline - Date.now())), undefined, meter, { tools: readToolDefinitions, tool_choice: enabled ? 'auto' : 'none' }),
        execute: (call, child) => this.tools.execute(call, userId, child),
        onProgress: event => event.kind === 'tool-start' ? send({ type: 'tool-start', callId: event.call.id, name: event.call.function.name, arguments: event.call.function.arguments }) :
          send({ type: 'tool-result', callId: event.call.id, name: event.call.function.name, content: event.content }),
      });
      signal.throwIfAborted();
      // 生成前后各复核一次；不把读取时检查宣传为实时撤权中断。
      const previous = history.turns.filter(turn => turn.status === 'completed').flatMap(turn => parseStoredTranscript(turn.transcript));
      await this.tools.assertReferences(userId, [...previous, ...result.appended], history.conversation.scopeHash);
      settlementAttempted = true;
      const bill = await this.quota.settle(reservation, meter.summary());
      await this.store.finish(userId, begun.turn.id, { status: 'completed', mode, answer: result.text, transcript: result.appended, errorCode: null });
      persisted = true;
      const stored = await this.store.get(userId, conversationId);
      // 先提交，再发送最终正文和done；这是工具进度流，不是token级输出。
      await send({ type: 'answer', text: result.text });
      await send({ type: 'done', conversationVersion: stored.conversation.version, billing: { status: bill.status === 'exact' ? 'exact' : 'estimated', units: bill.charged! } });
    } catch (error) {
      if (persisted) throw error; // 断线不撤销已经提交的成功结果，重载可读取。
      let code = signal.aborted ? 'TOOL_CANCELLED' : sessionFailureCode(error);
      if (reservation && !settlementAttempted) {
        settlementAttempted = true;
        try { await this.quota.settle(reservation, meter.summary()); }
        catch { code = 'AI_SETTLEMENT_PENDING'; }
      }
      // 失败只保留问题与错误；中途工具卡片不伪装成完整成功轨迹。
      await this.store.finish(userId, begun.turn.id, { status: 'failed', mode, answer: '', transcript: [], errorCode: code });
      throw new ToolFailure(code);
    }
  }
}
