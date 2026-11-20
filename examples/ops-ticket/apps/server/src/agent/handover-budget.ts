import tokenizer from 'llama-tokenizer-js';

export const modelProfile = { name: 'tinyllama:latest', window: 2048, output: 64 } as const;
export const countTokens = (text: string) => tokenizer.encode(text).length;
// TinyLlama 的 raw 提示走 LLaMA 字节回退。按原始 UTF-8 字节另留 8 个位置给边界标记。
// 该上界仅用于放行判断；展示与成本对照仍保留分词器读数和模型回报。
function guardedTokens(prompt: string) {
  return Math.max(countTokens(prompt), Buffer.byteLength(prompt, 'utf8') + 8);
}
export interface HandoverInput {
  policy: string;
  task: { ticketNo: string; decision: string; approval: string };
  question: string;
  history: readonly string[];
  documents: readonly string[];
  results: readonly string[];
  summary?: string;
}

// 实验走 Ollama raw 模式。计数和发送使用同一份字符串，模型端不会再套模板。
export function rawPrompt(input: HandoverInput) {
  const { policy, ...material } = input;
  return policy + '\nDATA ' + JSON.stringify(material) + '\nAnswer briefly:';
}

function suffixWithin(items: readonly string[], budget: number) {
  const selected: string[] = [];
  for (const item of [...items].reverse()) {
    if (countTokens(JSON.stringify([item, ...selected])) > budget) break;
    selected.unshift(item);
  }
  return selected;
}

export function packHandover(input: HandoverInput, window: number = modelProfile.window, output: number = modelProfile.output) {
  if (!Number.isSafeInteger(window) || !Number.isSafeInteger(output) || output < 1 || window > modelProfile.window || output >= window) {
    throw new Error('CONTEXT_BUDGET_INVALID');
  }
  const packed = { ...input, history: suffixWithin(input.history, 400),
    documents: suffixWithin(input.documents, 256), results: suffixWithin(input.results, 384) };
  // 区块上限约束单一来源，再按实际序列化总长挤出低优先级材料。
  for (const items of [packed.history, packed.documents, packed.results]) {
    while (items.length && guardedTokens(rawPrompt(packed)) + output > window) items.shift();
  }
  const prompt = rawPrompt(packed);
  const inputTokens = countTokens(prompt);
  const guardTokens = guardedTokens(prompt);
  if (guardTokens + output > window) throw new Error('CONTEXT_REQUIRED_TOO_LARGE');
  return { prompt, inputTokens, guardTokens, output, packed };
}
