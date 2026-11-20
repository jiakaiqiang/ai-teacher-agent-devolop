// 从已构建的服务端复用组装与分词代码。只向本机模型发送本文件的合成工单。
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { advance, emptyMemory } from '../apps/server/dist/agent/handover-history.js';
import { handoverStep } from '../apps/server/dist/agent/handover-session.js';
import { countTokens, modelProfile, rawPrompt } from '../apps/server/dist/agent/handover-budget.js';

const destination = process.argv[2];
if (!destination) throw new Error('请提供新建的实验记录文件路径');
const base = 'http://127.0.0.1:11434';
const model = modelProfile.name;
const tags = await (await fetch(base + '/api/tags')).json();
const digest = tags.models.find(row => row.name === model)?.digest;
if (!digest) throw new Error('本机缺少 tinyllama:latest');
const facts = { ticketNo: 'INC-275', decision: 'return-to-handler', approval: 'reviewed' };
const finalFormat = { type: 'object', properties: Object.fromEntries(Object.keys(facts).map(k => [k, { type: 'string' }])),
  required: Object.keys(facts), additionalProperties: false };
async function infer(prompt, last) {
  const inputTokens = countTokens(prompt);
  if (inputTokens + modelProfile.output > modelProfile.window) throw new Error('基线也必须放得下，不能比较被截断的输入');
  const response = await fetch(base + '/api/generate', { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, raw: true, prompt, stream: false,
      format: last ? finalFormat : { type: 'string', enum: ['OK'] },
      options: { seed: 7, temperature: 0, num_ctx: modelProfile.window, num_predict: modelProfile.output } }) });
  if (!response.ok) throw new Error('Ollama HTTP ' + response.status);
  const data = await response.json();
  if (!data.done || !Number.isSafeInteger(data.prompt_eval_count) || !Number.isSafeInteger(data.eval_count)) throw new Error('缺少模型计数');
  return { prompt, sha256: createHash('sha256').update(prompt).digest('hex'), inputTokens,
    reportedInput: data.prompt_eval_count, reportedOutput: data.eval_count, reply: data.response };
}

const rows = [];
let memory = emptyMemory();
const history = [];
for (let ordinal = 1; ordinal <= 50; ordinal++) {
  const last = ordinal === 50;
  const question = last ? 'Return the ticketNo, decision and approval from the task.' : 'Disk check ' + ordinal + ': acknowledge.';
  const plan = handoverStep(memory, { ordinal, question }, facts);
  const full = rawPrompt({ ...plan.packed, history, summary: '' });
  const pair = {};
  // 两组看到同一份已发生的问答，交替先后，最后一轮不限定正确取值。
  for (const arm of ordinal % 2 ? ['full', 'window'] : ['window', 'full']) pair[arm] = await infer(arm === 'full' ? full : plan.prompt, last);
  rows.push({ ordinal, ...pair });
  const answer = pair.window.reply;
  memory = advance(memory, { ordinal, question, answer });
  history.push(JSON.stringify([ordinal, question, answer]));
}
const totals = Object.fromEntries(['full', 'window'].map(arm => [arm,
  Object.fromEntries(['inputTokens', 'reportedInput', 'reportedOutput'].map(key => [key, rows.reduce((s,r) => s + r[arm][key], 0)]))]));
const recalls = Object.fromEntries(['full', 'window'].map(arm => {
  let parsed = {};
  try { parsed = JSON.parse(rows.at(-1)[arm].reply); } catch { /* 不完整输出按未命中记录 */ }
  return [arm, Object.fromEntries(Object.entries(facts).map(([k,v]) => [k, parsed?.[k] === v]))];
}));
const finalInput = rows.at(-1).window.prompt;
if (!Object.values(facts).every(v => finalInput.includes(v))) throw new Error('第五十轮丢失关键事实');
const report = { model, digest, rounds: rows.length, facts, totals, recalls, rows };
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ digest, totals, recalls }));
