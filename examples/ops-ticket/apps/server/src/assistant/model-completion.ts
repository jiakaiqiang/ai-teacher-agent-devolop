import type { ToolMessage } from './tool-protocol.js';
import type { ModelConfig } from './model.config.js';
import { readLimitedJson, type ChatMessage } from './chat.client.js';
import { GatewayFailure, statusFailure } from './model-policy.js';

// 不复用流式HTTP错误折叠：这里需要区分是否值得重试。
export async function requestCompletion(config: ModelConfig, messages: (ChatMessage | ToolMessage)[], signal: AbortSignal, responseFormat?: Record<string, unknown>, toolOptions?: { tools: unknown[]; tool_choice: 'auto' | 'none' }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, stream: false, max_completion_tokens: 512, store: false, ...toolOptions, ...(responseFormat ? { response_format: responseFormat } : {}) }),
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new GatewayFailure('MODEL_UNAVAILABLE', true);
  }
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw statusFailure(response.status); }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    void response.body?.cancel().catch(() => {}); throw new GatewayFailure('MODEL_PROTOCOL_ERROR');
  }
  try { return await readLimitedJson(response); }
  catch { if (signal.aborted) throw signal.reason; throw new GatewayFailure('MODEL_PROTOCOL_ERROR'); }
}
