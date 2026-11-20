import type { ToolMessage } from './tool-protocol.js';
import type { UsageMeter } from './usage-meter.js';
import { Injectable } from '@nestjs/common';
import { ChatClient, ModelError, type ChatMessage } from './chat.client.js';
import { readModelRegistry } from './model-registry.js';
import { mockStream } from './mock-stream.js';
import { ModelPolicy, GatewayFailure } from './model-policy.js';
import { requestCompletion } from './model-completion.js';

@Injectable()
export class ModelGateway {
  private readonly policies = new Map<string, ModelPolicy>();
  async complete(messages: (ChatMessage | ToolMessage)[], signal?: AbortSignal, alias = 'default', budgetMs = 5000, responseFormat?: Record<string, unknown>, meter?: UsageMeter, toolOptions?: { tools: unknown[]; tool_choice: 'auto' | 'none' }): Promise<unknown> {
    const registry = readModelRegistry();
    const config = registry.resolve(alias);
    if (!config) throw new GatewayFailure('MODEL_CONFIG_ERROR');
    // 按受控别名保存进程内状态；配置变更需重启，最多8个。
    for (const key of this.policies.keys()) if (!registry.aliases().includes(key)) this.policies.delete(key);
    let policy = this.policies.get(alias);
    if (!policy) { policy = new ModelPolicy(); this.policies.set(alias, policy); }
    return policy.run(async child => { meter?.start(); const raw = await requestCompletion(config, messages, child, responseFormat, toolOptions); meter?.record(raw); return raw; }, signal, budgetMs);
  }
  async stream(messages: ChatMessage[], signal: AbortSignal, alias = 'default') {
    signal.throwIfAborted();
    const config = readModelRegistry().resolve(alias);
    if (!config) return { body: mockStream(signal), mode: 'mock' as const };
    const response = await new ChatClient(config).open(messages, true, signal);
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
      await response.body?.cancel(); throw new ModelError('MODEL_PROTOCOL_ERROR');
    }
    // 本周流式保持W7预算与终止校验；不会在已发正文后重放请求。
    return { body: response.body, mode: 'model' as const };
  }
}
