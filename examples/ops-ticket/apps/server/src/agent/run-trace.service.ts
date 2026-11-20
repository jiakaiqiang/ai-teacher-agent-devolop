import { Injectable } from '@nestjs/common';
import { redactForLog } from '../common/sensitive.js';
import { currentRequestId } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunFailure } from './run-errors.js';

export const TRACE_FIELD_LIMIT = 2000;
export type TraceKind = 'model' | 'tool';
export interface TraceInput {
  stepId: string;
  ordinal: number;
  kind: TraceKind;
  input: string;
  output: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

// 先脱敏再截断：顺序反了会把一半的手机号或令牌留在文本里。
// limit 是入库后的总长度上限（列是 VARCHAR(2000)，按字符计），所以省略提示也要算进去。
export function prepareField(value: string, limit = TRACE_FIELD_LIMIT) {
  const redacted = redactForLog(typeof value === 'string' ? value : String(value));
  const points = Array.from(redacted);
  if (points.length <= limit) return { text: redacted, truncated: false };
  const omitted = points.length - limit;
  const suffix = `…（省略 ${omitted} 个字符）`;
  const kept = Math.max(0, limit - Array.from(suffix).length);
  // 按码点截断，不切断表情或汉字。
  return { text: points.slice(0, kept).join('') + suffix, truncated: true };
}

const counts = (value: number | undefined) => {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new RunFailure('RUN_TRACE_INVALID');
  return value;
};

@Injectable()
export class RunTraceService {
  constructor(private readonly db: PrismaService) {}

  // 一步最多一条 Trace（stepId 唯一）：重复写入说明调用方把同一步记了两次。
  async record(runId: string, trace: TraceInput) {
    if (trace.kind !== 'model' && trace.kind !== 'tool') throw new RunFailure('RUN_TRACE_INVALID');
    if (!Number.isSafeInteger(trace.ordinal) || trace.ordinal < 1) throw new RunFailure('RUN_TRACE_INVALID');
    const input = prepareField(trace.input);
    const output = prepareField(trace.output);
    try {
      return await this.db.agentTrace.create({
        data: {
          runId, stepId: trace.stepId, ordinal: trace.ordinal, kind: trace.kind,
          input: input.text, output: output.text,
          inputTokens: counts(trace.inputTokens), outputTokens: counts(trace.outputTokens),
          durationMs: counts(trace.durationMs),
          truncated: input.truncated || output.truncated,
          requestId: currentRequestId() ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('agent_traces_step_id_key')) {
        throw new RunFailure('RUN_TRACE_DUPLICATE');
      }
      throw error;
    }
  }

  async list(runId: string) {
    return this.db.agentTrace.findMany({ where: { runId }, orderBy: { ordinal: 'asc' }, take: 8 });
  }

  // 用量汇总：供 run_finished 事件与审计使用，不重新解析正文。
  async usage(runId: string) {
    const rows = await this.list(runId);
    return rows.reduce((total, row) => ({
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      durationMs: total.durationMs + row.durationMs,
      traces: total.traces + 1,
      truncated: total.truncated || row.truncated,
    }), { inputTokens: 0, outputTokens: 0, durationMs: 0, traces: 0, truncated: false });
  }
}
