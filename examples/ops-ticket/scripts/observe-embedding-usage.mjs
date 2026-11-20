import assert from 'node:assert/strict';
import { model, dimension } from '../apps/server/dist/retrieval/encoding.js';
import { embeddingUsage, quoteUsage } from '../apps/server/dist/assistant/cost-quote.js';

// 固定合成问题；只输出用量元数据，不打印向量或环境变量。
const start = performance.now();
const response = await fetch('http://127.0.0.1:11434/api/embed', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, input: ['VPN登录失败，如何核对动态口令？'], truncate: false }),
});
assert.equal(response.status, 200);
const raw = await response.json();
assert.equal(raw.model, model);
assert.equal(raw.embeddings.length, 1);
assert.equal(raw.embeddings[0].length, dimension);
assert.ok(raw.embeddings[0].every(Number.isFinite));
const usage = embeddingUsage(raw);
assert.ok(usage.exact);
assert.ok(Number.isSafeInteger(raw.total_duration) && raw.total_duration >= 0);
console.log(JSON.stringify({
  source: 'local-ollama-embedding', model, dimension, usage,
  clientTotalMs: performance.now() - start, providerTotalMs: raw.total_duration / 1e6,
  demoQuote: quoteUsage(usage), actualCost: null,
}));
