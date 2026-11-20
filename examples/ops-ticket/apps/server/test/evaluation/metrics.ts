import { cases, score, type Trial } from '../diagnosis-eval.js';

export type Metered = Trial & { inputTokens: number; outputTokens: number };
type Prices = { inputPerMillion: number; outputPerMillion: number };
function count(value: number) { return Number.isSafeInteger(value) && value >= 0; }

// 每一轮必须覆盖相同十题。分母包含超时与未回答的尝试。
export function summarize(rounds: Metered[][], prices?: Prices) {
  if (!rounds.length || rounds.some(rows => rows.some(x =>
    ![x.ms, x.steps, x.inputTokens, x.outputTokens, x.tokens].every(count) ||
    x.inputTokens + x.outputTokens !== x.tokens))) throw new Error('计量无效');
  if (prices && Object.values(prices).some(x => !Number.isFinite(x) || x < 0)) throw new Error('单价无效');
  const scored = rounds.map(score);
  const rows = scored.flatMap(r => r.rows);
  const byCase = cases.map(([id]) => {
    const runs = rows.filter(row => row.id === id);
    return { id, hits: runs.filter(r => r.correct).length, stable: new Set(runs.map(r => JSON.stringify([r.reason, r.predicted]))).size === 1 };
  });
  const latencies = rows.map(x => x.ms).sort((a, b) => a - b);
  const all = rounds.flat();
  const inputTokens = all.reduce((n, x) => n + x.inputTokens, 0), outputTokens = all.reduce((n, x) => n + x.outputTokens, 0);
  return { rounds: rounds.length, attempts: rows.length, hits: rows.filter(x => x.correct).length,
    answered: rows.filter(x => x.reason === 'answered').length, byCase,
    alwaysCorrect: byCase.filter(x => x.hits === rounds.length).length, everCorrect: byCase.filter(x => x.hits > 0).length,
    stable: byCase.filter(x => x.stable).length, p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
    inputTokens, outputTokens, totalSteps: rows.reduce((n, x) => n + x.steps, 0),
    estimatedCost: prices ? (inputTokens * prices.inputPerMillion + outputTokens * prices.outputPerMillion) / 1_000_000 : null };
}
