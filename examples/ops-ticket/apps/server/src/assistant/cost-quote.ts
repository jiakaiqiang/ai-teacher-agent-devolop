import type { UsageSummary } from './usage-meter.js';

// 演示价表，不是供应商报价，更不代表本机实际成本。
export const demoTariff = Object.freeze({
  id: 'demo-linear-v1', currency: 'CNY', inputMicroPerToken: 2n, outputMicroPerToken: 6n,
});

function validate(summary: UsageSummary) {
  const counts = [summary.inputTokens, summary.outputTokens];
  if (counts.some(v => !Number.isSafeInteger(v) || v < 0 || v > 4_000_000) ||
      !Number.isSafeInteger(summary.attempts) || summary.attempts < 0 || summary.attempts > 4 ||
      typeof summary.exact !== 'boolean' ||
      (summary.attempts === 0 && counts.some(v => v !== 0))) throw new Error('USAGE_INVALID');
}

function formatMicro(value: bigint) {
  return (value / 1_000_000n).toString() + '.' + (value % 1_000_000n).toString().padStart(6, '0');
}

export function quoteUsage(summary: UsageSummary) {
  validate(summary);
  const micro = BigInt(summary.inputTokens) * demoTariff.inputMicroPerToken +
    BigInt(summary.outputTokens) * demoTariff.outputMicroPerToken;
  const knownAmount = formatMicro(micro);
  return {
    tariffId: demoTariff.id, currency: demoTariff.currency, tariffKind: 'synthetic' as const,
    status: summary.exact ? 'complete-usage' as const : 'unknown' as const,
    amount: summary.exact ? knownAmount : null, knownAmount,
    attempts: summary.attempts,
  };
}

// embed只有输入token；向量维度不属于completion token。
export function embeddingUsage(raw: unknown): UsageSummary {
  const count = raw && typeof raw === 'object' && 'prompt_eval_count' in raw ? raw.prompt_eval_count : undefined;
  const exact = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000;
  return { inputTokens: exact ? count : 0, outputTokens: 0, exact, attempts: 1 };
}
