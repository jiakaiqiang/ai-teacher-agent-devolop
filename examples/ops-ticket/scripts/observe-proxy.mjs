import assert from 'node:assert/strict';
import { LatencyTrace, summarizeLatency } from '../apps/server/dist/retrieval/latency.js';

// 只对本章六帧夹具采样，不采集正文或凭证。
const kind = process.argv[2] ?? 'flow';
assert.ok(['flow', 'idle'].includes(kind));
const trace = new LatencyTrace();
let frames = 0;
let outcome = 'failed';
let reader;
try {
  const response = await fetch('http://127.0.0.1:8089/' + kind, { signal: AbortSignal.timeout(9000) });
  assert.equal(response.status, 200);
  reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      if (frame.startsWith('data: ')) {
        trace.observe('text', frame.slice(6));
        frames++;
      }
    }
  }
  if (frames === 6 && !pending) outcome = 'completed';
} catch {
  outcome = 'failed';
} finally {
  if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const sample = trace.finish(outcome);
console.log(JSON.stringify({ source: 'local-nginx-fixture', kind, frames, sample, summary: summarizeLatency([sample]) }));
assert.equal(outcome, kind === 'flow' ? 'completed' : 'failed');
assert.equal(frames, kind === 'flow' ? 6 : 1);
