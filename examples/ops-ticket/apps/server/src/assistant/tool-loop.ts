import { parseToolReply, ToolFailure, type ToolCall, type ToolMessage } from './tool-protocol.js';

export type ToolProgress = { kind: 'tool-start'; call: ToolCall }
  | { kind: 'tool-result'; call: ToolCall; content: string };
export interface ToolLoopOptions {
  messages: ToolMessage[];
  complete: (messages: ToolMessage[], signal: AbortSignal, toolsEnabled: boolean) => Promise<unknown>;
  execute: (call: ToolCall, signal: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
  budgetMs?: number;
  onProgress?: (event: ToolProgress) => void | Promise<void>;
}

// 一轮最多三个只读工具，再给模型一次总结机会；不是无限Agent循环。
export async function runToolLoop(options: ToolLoopOptions) {
  const budget = options.budgetMs ?? 10000;
  if (!Number.isInteger(budget) || budget < 1 || budget > 10000) throw new ToolFailure('TOOL_BUDGET_INVALID');
  const controller = new AbortController();
  const cancel = () => controller.abort(new ToolFailure('TOOL_CANCELLED'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new ToolFailure('TOOL_TIMEOUT')), budget);
  const messages = structuredClone(options.messages);
  const appended: ToolMessage[] = [];
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  const work = async () => {
    for (let step = 0; step < 2; step++) {
      controller.signal.throwIfAborted();
      const raw = await options.complete(messages, controller.signal, step === 0);
      controller.signal.throwIfAborted();
      const reply = parseToolReply(raw);
      if (reply.kind === 'answer') {
        appended.push({ role: 'assistant', content: reply.text });
        return { text: reply.text, appended };
      }
      if (step !== 0) throw new ToolFailure('TOOL_STEP_LIMIT');
      const assistant: ToolMessage = { role: 'assistant', content: reply.content, tool_calls: reply.calls };
      messages.push(assistant); appended.push(assistant);
      for (const call of reply.calls) {
        controller.signal.throwIfAborted();
        await options.onProgress?.({ kind: 'tool-start', call });
        const result = await options.execute(call, controller.signal);
        controller.signal.throwIfAborted();
        const content = JSON.stringify(result);
        if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 4096) throw new ToolFailure('TOOL_RESULT_LIMIT');
        const message: ToolMessage = { role: 'tool', tool_call_id: call.id, content };
        messages.push(message); appended.push(message);
        await options.onProgress?.({ kind: 'tool-result', call, content });
      }
    }
    throw new ToolFailure('TOOL_STEP_LIMIT');
  };
  try { return await Promise.race([work(), aborted]); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
