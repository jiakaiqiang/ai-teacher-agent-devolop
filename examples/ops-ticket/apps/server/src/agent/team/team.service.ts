import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../auth/auth.types.js';
import { ModelGateway } from '../../assistant/model-gateway.js';
import { parseToolReply } from '../../assistant/tool-protocol.js';
import { UsageMeter } from '../../assistant/usage-meter.js';
import { RunExecutorService } from '../run-executor.service.js';
import { TicketToolsService } from '../ticket-tools.service.js';
import type { StepOutcome } from '../run-loop.js';
import { grantRead } from './authority.js';
import { TeamSession, type Mode } from './session.js';

@Injectable()
export class TeamDiagnosisService {
  constructor(private readonly executor: RunExecutorService, private readonly tools: TicketToolsService,
    private readonly gateway: ModelGateway) {}
  execute(user: AuthUser, id: string, mode: Mode) {
    const session = new TeamSession(mode, id);
    return this.executor.execute(user, id, async (step): Promise<StepOutcome> => {
      const action = session.next(), signal = AbortSignal.timeout(step.deadlineMs);
      if (action.kind === 'read') {
        const call = { name: action.name, version: 1, args: {} };
        try {
          const grant = grantRead(action.role, user.id, id, action.name);
          const [result] = await this.tools.batch(user, id, [call], signal, false, grant);
          if (!result?.ok) throw new Error('读取未获准');
          session.accept(result.data);
          return { phase: 'tool', summary: action.name, tokens: 0,
            trace: { kind: 'tool', input: JSON.stringify(call), output: JSON.stringify(result) } };
        } catch { return { phase: 'tool', summary: '读取中止', failure: 'TEAM_READ_FAILED', failureReason: 'tool_failed', tokens: 0 }; }
      }
      // 每一角色使用新消息；保存快照时重新校验运行归属与权限指纹。
      const packet = await this.tools.saveContext(user, id, step.ordinal, action.messages).catch(() => null);
      if (!packet) return { phase: 'plan', summary: '交接中止', failure: 'TEAM_CONTEXT_UNAVAILABLE', failureReason: 'tool_failed', tokens: 0 };
      const meter = new UsageMeter();
      let output = '', valid = false, answer: string | undefined;
      try {
        const raw = await this.gateway.complete(packet.messages, signal, 'default', Math.min(step.deadlineMs, 5000),
          { type: 'json_schema', json_schema: { name: action.role, strict: true, schema: z.toJSONSchema(action.schema) } }, meter);
        const reply = parseToolReply(raw);
        if (reply.kind !== 'answer') throw new Error('角色答复无效');
        output = reply.text;
        answer = session.accept(JSON.parse(output)); valid = true;
      } catch { /* 已用 token 与失败步骤一起记账。 */ }
      const { inputTokens, outputTokens } = meter.summary();
      return { phase: answer || !valid ? 'answer' : 'plan', summary: action.role, tokens: inputTokens + outputTokens,
        ...(answer ? { answer } : {}), ...(!valid ? { failure: 'TEAM_MODEL_FAILED', failureReason: 'model_failed' as const } : {}),
        trace: { kind: 'model', input: packet.messages.map(m => m.content).join('\n'), output, inputTokens, outputTokens } };
    });
  }
}
