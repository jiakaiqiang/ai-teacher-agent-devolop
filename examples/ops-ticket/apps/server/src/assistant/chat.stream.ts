import { chatChunkSchema, readSse } from '@ops-ticket/shared';
import { ModelError } from './chat.client.js';

export type ModelEvent = { type: 'delta'; text: string } | { type: 'done'; finishReason: 'stop' | 'length' };
export async function* parseChatStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
  let finish: 'stop' | 'length' | null = null;
  let chars = 0;
  for await (const frame of readSse(body, { signal })) {
    if (frame.event !== 'message') throw new ModelError('MODEL_PROTOCOL_ERROR');
    if (frame.data === '[DONE]') {
      if (!finish) throw new ModelError('MODEL_PROTOCOL_ERROR');
      yield { type: 'done', finishReason: finish }; return;
    }
    let input: unknown;
    try { input = JSON.parse(frame.data) as unknown; } catch { throw new ModelError('MODEL_PROTOCOL_ERROR'); }
    const parsed = chatChunkSchema.safeParse(input);
    if (!parsed.success) throw new ModelError('MODEL_PROTOCOL_ERROR');
    const choice = parsed.data.choices[0];
    if (!choice) continue; // 允许usage尾块没有choice；不推断费用。
    if (finish || choice.delta.refusal || choice.delta.tool_calls !== undefined) throw new ModelError('MODEL_PROTOCOL_ERROR');
    const text = choice.delta.content;
    if (text) {
      chars += text.length;
      if (chars > 32_768 || text.length > 16_384) throw new ModelError('MODEL_OUTPUT_LIMIT');
      yield { type: 'delta', text };
    }
    if (choice.finish_reason !== null) {
      if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'length') throw new ModelError('MODEL_PROTOCOL_ERROR');
      finish = choice.finish_reason;
    }
  }
  // HTTP EOF不是模型成功结束，缺少DONE时保留已经发出的部分结果并报错。
  throw new ModelError('MODEL_PROTOCOL_ERROR');
}
