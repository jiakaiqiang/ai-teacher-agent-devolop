import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { agreement, blind, type Ballot } from './judge.js';

// helpful-base/test.jsonl.gz，以下为零起始行号。只将候选文本送给本机裁判。
const lines = [31, 709, 801, 1231, 1485, 2109];
const revision = '09be8c5bbc57cb3887f3a9732ad6aa7ec602a1fa';
const packed = readFileSync(process.env.EVAL_HH_FILE ?? 'helpful-base-test.jsonl.gz');
if (createHash('sha256').update(packed).digest('hex') !== '8be3fc1a13b27901631696f2be6f184c799f1baeaf145f53ac5db24960adc37b') throw new Error('语料版本不符');
const source = gunzipSync(packed).toString('utf8').trimEnd().split('\n');
const host = 'http://127.0.0.1:11434', model = 'tinyllama:latest';
const tags = await (await fetch(host + '/api/tags')).json();
const digest = tags.models.find((x: { name: string }) => x.name === model)?.digest;
if (!digest) throw new Error('本机裁判模型不可用');
const ballots: Ballot[] = [];
for (const line of lines) {
  const row = JSON.parse(source[line]);
  const [question, chosen] = row.chosen.split('\n\nAssistant:');
  const [same, rejected] = row.rejected.split('\n\nAssistant:');
  if (same !== question || !chosen || !rejected) throw new Error('问题和候选未配对');
  for (const reverse of [false, true]) {
    const input = blind({ line, question, chosen, rejected }, reverse);
    const response = await fetch(host + '/api/chat', { method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false,
        messages: [{ role: 'system', content: 'Select the more helpful and accurate answer to the question. Return your choice in the vote field.' },
          { role: 'user', content: JSON.stringify(input) }], options: { seed: 23, temperature: 0, num_predict: 32 },
        format: { type: 'object', properties: { vote: { type: 'string', enum: ['A', 'B'] } }, required: ['vote'] } }) });
    if (!response.ok) throw new Error('裁判调用失败 ' + response.status);
    const result = await response.json();
    let vote: Ballot['vote'] = 'invalid';
    try {
      const answer = JSON.parse(result.message.content);
      if (answer.vote === 'A' || answer.vote === 'B') vote = answer.vote;
    } catch { /* 无效票也保留在分母。 */ }
    ballots.push({ line, reverse, vote });
  }
}
const report = { model, digest, revision, lines, ballots, ...agreement(lines, ballots) };
console.log(JSON.stringify(report));
if (process.env.EVAL_JUDGE_REPORT) writeFileSync(process.env.EVAL_JUDGE_REPORT, JSON.stringify(report, null, 2));
