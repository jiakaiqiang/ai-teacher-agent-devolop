import { diagnosisMessages } from './diagnosis-context.js';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { ModelGateway } from '../assistant/model-gateway.js';
import { parseToolReply } from '../assistant/tool-protocol.js';
import { UsageMeter } from '../assistant/usage-meter.js';
import { issueGrant } from './diagnosis-grant.js';
import { definitions, type Name } from './tool-catalog.js';
import { TicketToolsService } from './ticket-tools.service.js';
import { RunExecutorService } from './run-executor.service.js';

export const diagnosisSchema = z.object({ category: z.enum(['network', 'storage', 'power', 'unknown']) }).strict();
const checks = { network: '核对链路状态与丢包记录', storage: '核对磁盘容量与增长记录',
  power: '核对供电与电源告警', unknown: '补充发生时间和设备告警' };

@Injectable()
export class DiagnosisService {
  constructor(private readonly executor: RunExecutorService, private readonly tools: TicketToolsService,
    private readonly gateway: ModelGateway) {}

  async execute(user: AuthUser, id: string) {
    const evidence: unknown[] = [];
    let pending = 'ticket_summary';
    let expanded = false;
    let grant: object | undefined;
    return this.executor.execute(user, id, async (step, context) => {
      const topic = /历史|记录/.test(context.goal) ? 'history' : 'device';
      const allowedTools = definitions(topic);
      grant ??= issueGrant(user.id, id, ['ticket_summary', ...allowedTools.map(tool => tool.name as Name)]);
      const signal = AbortSignal.timeout(step.deadlineMs);
      if (pending) {
        const name = pending;
        pending = '';
        const args = name.endsWith('_page') ? { limit: 3, after: null } : {};
        const call = { name, version: 1, args };
        const [result] = await this.tools.batch(user, id, [call], signal, false, grant);
        evidence.push(result);
        const failure = !result?.ok && name === 'ticket_summary' ? 'TICKET_READ_FAILED' : undefined;
        return { phase: 'tool', summary: name, tokens: 0, failure,
          trace: { kind: 'tool', input: JSON.stringify(call), output: JSON.stringify(result) } };
      }
      const available = expanded ? [] : allowedTools;
      const names = available.map(t => t.name);
      const messages=diagnosisMessages(available,{ticketNo:context.ticketNo,goal:context.goal,evidence});
      const [instruction,input]=messages.map(message=>message.content);
      const meter = new UsageMeter();
      let output = '';
      try {
        const schema = expanded ? diagnosisSchema : z.union([diagnosisSchema, z.object({ tool: z.enum(names) }).strict()]);
        const raw = await this.gateway.complete(messages,
          signal, 'default', Math.min(step.deadlineMs, 5000), { type: 'json_schema',
            json_schema: { name: 'diagnosis', strict: true, schema: z.toJSONSchema(schema) } }, meter);
        const reply = parseToolReply(raw);
        if (reply.kind !== 'answer') throw new Error('DIAGNOSIS_INVALID');
        output = reply.text;
        const choice = schema.parse(JSON.parse(output));
        const usage = meter.summary();
        const trace = { kind: 'model' as const, input: instruction + '\n' + input, output,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
        const tokens = usage.inputTokens + usage.outputTokens;
        if ('tool' in choice) {
          if (expanded || !names.includes(choice.tool)) throw new Error('DIAGNOSIS_TOOL_UNAVAILABLE');
          expanded = true; pending = choice.tool;
          return { phase: 'plan', summary: '选择补查工具', tokens, trace };
        }
        return { phase: 'answer', summary: '分诊与核查建议', answer: choice.category + ' · ' + checks[choice.category], tokens, trace };
      } catch {
        const usage = meter.summary();
        return { phase: 'answer', summary: '模型未给出有效分诊', tokens: usage.inputTokens + usage.outputTokens,
          failure: 'DIAGNOSIS_MODEL_FAILED', failureReason: 'model_failed',
          trace: { kind: 'model', input: instruction + '\n' + input, output, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } };
      }
    });
  }
}
