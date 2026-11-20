import { UsageMeter } from './usage-meter.js';
import { Injectable } from '@nestjs/common';
import { triageSuggestionSchema, type TriageResult } from '@ops-ticket/shared';
import { ModelGateway } from './model-gateway.js';
import { readModelRegistry } from './model-registry.js';
import { buildTriagePrompt, triageInputSchema } from './prompt-catalog.js';
import { GatewayFailure, abortable } from './model-policy.js';
import { parseTriageOutput, triageResponseFormat } from './triage-output.js';

@Injectable()
export class TriageService {
  constructor(private readonly gateway: ModelGateway) {}
  async suggest(input: unknown, parent?: AbortSignal, alias = 'default', meter = new UsageMeter()): Promise<TriageResult> {
    if(parent?.aborted) throw new GatewayFailure('MODEL_CANCELLED');
    const data = triageInputSchema.parse(input);
    const prompt = buildTriagePrompt(data);
    if (!readModelRegistry().resolve(alias)) {
      return { suggestion: triageSuggestionSchema.parse({intent:'资料不足',steps:[],evidenceIds:[],missingInformation:['请核对日志与适用手册。']}), mode:'mock',promptVersion:prompt.version,promptHash:prompt.hash,validationAttempts:0 };
    }
    const controller = new AbortController();
    const cancel = () => controller.abort(new GatewayFailure('MODEL_CANCELLED'));
    parent?.addEventListener('abort',cancel,{once:true});
    const deadline = Date.now() + 5000;
    const timer = setTimeout(()=>controller.abort(new GatewayFailure('MODEL_TIMEOUT',true)),5000);
    try {
      for(let attempt=1;attempt<=2;attempt++) {
        controller.signal.throwIfAborted();
        const messages = attempt===1 ? prompt.messages : [...prompt.messages,{role:'user' as const,content:'上次输出未通过JSON字段校验。请按原任务和schema重新输出完整JSON，不要Markdown或额外字段。'}];
        const raw = await abortable(this.gateway.complete(messages,controller.signal,alias,Math.max(0,deadline-Date.now()),triageResponseFormat,meter),controller.signal);
        try {
          return {suggestion:parseTriageOutput(raw),mode:'model',promptVersion:prompt.version,promptHash:prompt.hash,validationAttempts:attempt};
        } catch(error) {
          // 只修复JSON语法或业务schema失败；拒绝、截断和协议异常不自动重生成。
          if (!(error instanceof GatewayFailure) || error.code!=='MODEL_INVALID_OUTPUT' || attempt===2) throw error;
        }
      }
      throw new GatewayFailure('MODEL_INVALID_OUTPUT');
    } finally { clearTimeout(timer);parent?.removeEventListener('abort',cancel); }
  }
}
