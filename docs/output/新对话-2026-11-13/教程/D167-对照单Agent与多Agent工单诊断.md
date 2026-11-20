# D167　对照单Agent与多Agent工单诊断

第 24 周 · 300 分钟。回忆 30、推导 45、集成 115、反证 50、口述与复盘 60。前置阅读见[上一讲](D166-把两种诊断接入同一运行接口.md)。

## 今天要做出什么

在同一批题上逐题成对运行两种架构，记录任务是否达成、是否违规、费用和延迟。

## 今天的目录结构

- `apps/server/test/evaluation/paired.spec.ts`
- `apps/server/test/evaluation/paired.ts`
- `apps/server/test/evaluation/team-comparison.e2e-spec.ts`

## 零、闭卷回忆

**D166**　两种架构可以使用不同工具权限再比较成功率吗？

<details><summary>核对</summary>

配对对照需一致的授权、资料、判定标准及配置记录。

</details>

**D164**　为何共享方案可传，来源工单原文仍受限？

<details><summary>核对</summary>

交接保留通用条目标识、版本和许可范围；原始材料需单独授权。

</details>

**D160**　只检查最终到了人工待办能否发现这个错误？

<details><summary>核对</summary>

门禁校验触发人、事件顺序和状态。干净样本退出零，篡改样本退出非零。

</details>

## 一、知识点与推导

列出只在一侧成功或违规的工单，检查原因并注明模型或夹具来源。

两侧使用同一个数据集、工具授权和模型配置。逐题保存 mode、round、实际工具序列、业务状态、耗时和 token 数；按题号和轮次做配对。先核对违规，再讨论调用代价。

题目由数据集版本和场景编号确定。两侧用各自的数据库记录，具有相同内容、初始业务条件和请求身份；按场景、轮次、模式对齐。重复或缺失记录直接中止聚合。

正确分类还可能调用了额外工具。任务成功还要满足工具、授权和业务状态约束。延迟从发出诊断请求计到响应返回，输入与输出 token 取自同一次运行轨迹。

## 二、动手开发

1. 在同一批题上逐题成对运行两种架构，记录任务是否达成、是否违规、费用和延迟。先记录操作者、输入和预期。
2. 同批题配对比较成功率、违规、成本、延迟。在输出中圈出能区分成功和失败的字段。
3. 两组平均分有差异，哪几对样本实际改变了判断？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm exec vitest run test/evaluation/paired.spec.ts
pnpm exec vitest run --config vitest.config.e2e.ts test/evaluation/team-comparison.e2e-spec.ts
```

<details><summary>提示一 · 方向</summary>

固定数据版本、模型、身份与执行入口。

</details>
<details><summary>提示二 · API</summary>

从 apps/server 执行 pnpm exec vitest run test/evaluation/paired.spec.ts。

</details>
<details><summary>提示三 · 实现顺序</summary>

先对调记录顺序，再删除或重复一行，检查聚合是否仍正确或明确失败。

</details>

### 步骤 2　跑受控和真实模型

<details><summary>提示一 · 方向</summary>

受控网关能按规则稳定返回；替换为本机模型后保留相同采集与评分路径。

</details>
<details><summary>提示二 · API</summary>

在验证沙箱的 apps/server 配好数据库后，PowerShell 设置 $env:W24_LIVE="1"，再运行 pnpm exec vitest run --config vitest.config.e2e.ts test/evaluation/team-comparison.e2e-spec.ts。

</details>
<details><summary>提示三 · 实现顺序</summary>

需要保存原始结果时，运行前将 D167_EVIDENCE_FILE 设为一个新的 JSONL 路径；按 kind 选择批次后核对总数。

</details>

在 `apps/server` 运行 `pnpm exec vitest run test/evaluation/paired.spec.ts`。

在 `apps/server` 运行 `pnpm exec vitest run --config vitest.config.e2e.ts test/evaluation/team-comparison.e2e-spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

在同一批题上逐题成对运行两种架构，记录任务是否达成、是否违规、费用和延迟。

</details>

<details><summary>提示二 · 切换一个条件</summary>

两组平均分有差异，哪几对样本实际改变了判断？

</details>

<details><summary>提示三 · 对照判定</summary>

列出只在一侧成功或违规的工单，检查原因并注明模型或夹具来源。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/test/evaluation/paired.spec.ts**

```ts
import { dataset } from './dataset.js';
import { compare, order, type Arm } from './paired.js';

const c = dataset[0];
const state = { status: 'pending', version: 0, events: 0, approvals: 0 };
const one: Arm = { id: c.id, mode: 'single', round: 1, before: state, after: state, predicted: c.expected, reason: 'answered',
  http: 200, calls: ['ticket_summary'], modelCalls: 1, steps: 2, ms: 10, inputTokens: 20, outputTokens: 3 };
describe('成对比较', () => {
  it('按身份对齐并保留质量与用量两个维度', () => {
    const team: Arm = { ...one, mode: 'team', predicted: 'unknown', steps: 4, inputTokens: 60 };
    const result = compare([team, one], 1, [c]);
    expect(result.singleOnly).toBe(1);
    expect(result.team).toMatchObject({ success: 0, inputTokens: 60, violations: 0 });
    expect(() => compare([one, one], 1, [c])).toThrow('配对不完整');
  });
  it('跨工单和轮次交换先后顺序', () => {
    expect(order(0, 1)).toEqual(['single', 'team']);
    expect(order(0, 2)).toEqual(['team', 'single']);
    expect(order(1, 1)).toEqual(['team', 'single']);
  });
});
```

**apps/server/test/evaluation/paired.ts**

```ts
import { dataset, type Case } from './dataset.js';
import { grade, type Observation } from './grade.js';
import type { Mode } from '../../src/agent/team/session.js';

export type Arm = Observation & { mode: Mode; round: number; ms: number; inputTokens: number; outputTokens: number };
export function order(index: number, round: number): Mode[] {
  return (index + round) % 2 === 1 ? ['single', 'team'] : ['team', 'single'];
}
export function compare(rows: Arm[], rounds: number, cases: readonly Case[] = dataset) {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || !cases.length || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('配对清单无效');
  const index = new Map(rows.map(r => [JSON.stringify([r.round, r.id, r.mode]), r]));
  if (index.size !== rows.length || rows.length !== rounds * cases.length * 2) throw new Error('配对不完整');
  const graded = (mode: Mode) => cases.flatMap(c => Array.from({ length: rounds }, (_, i) => {
    const row = index.get(JSON.stringify([i + 1, c.id, mode]));
    if (!row || ![row.ms, row.steps, row.modelCalls, row.inputTokens, row.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('配对观测无效');
    return { row, grade: grade(c, row), hit: c.actor === 'owner' && row.reason === 'answered' && row.predicted === c.expected };
  }));
  const single = graded('single'), team = graded('team');
  function summarize(values: typeof single) {
    const times = values.map(x => x.row.ms).sort((a, b) => a - b);
    return { total: values.length, success: values.filter(x => x.grade.success).length,
      hits: values.filter(x => x.hit).length, answered: values.filter(x => x.row.reason === 'answered').length,
      violations: values.filter(x => x.grade.violation).length, correctTools: values.filter(x => x.grade.correctTools).length,
      modelCalls: values.reduce((n, x) => n + x.row.modelCalls, 0), steps: values.reduce((n, x) => n + x.row.steps, 0),
      inputTokens: values.reduce((n, x) => n + x.row.inputTokens, 0), outputTokens: values.reduce((n, x) => n + x.row.outputTokens, 0),
      p95Ms: times[Math.ceil(times.length * 0.95) - 1] };
  }
  return { single: summarize(single), team: summarize(team),
    teamOnly: team.filter((x, i) => x.grade.success && !single[i].grade.success).length,
    singleOnly: single.filter((x, i) => x.grade.success && !team[i].grade.success).length };
}
```

**apps/server/test/evaluation/team-comparison.e2e-spec.ts**

```ts
import { appendFileSync } from 'node:fs';
import { vi } from 'vitest';
import { dataset, edition, modelInput, type Case } from './dataset.js';
import { openLab, response, type Lab } from './team-lab.js';
import { compare, order, type Arm } from './paired.js';
import type { Mode } from '../../src/agent/team/session.js';

describe('工单诊断配对实验', () => {
  let lab: Lab;
  beforeAll(async () => { lab = await openLab('TCP'); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => lab.close());

  async function measure(item: Case, mode: Mode, round: number, calls: () => number): Promise<Arm> {
    const { id, ticket, path } = await lab.start(modelInput(item).description);
    const inspect = async () => ({
      ...await lab.db.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { status: true, version: true } }),
      events: await lab.db.ticketEvent.count({ where: { ticketId: ticket.id } }),
      approvals: await lab.db.knowledgeEntry.count({ where: { sourceTicketId: ticket.id, approvedVersion: { not: null } } }),
    });
    const before = await inspect(), initialCalls = calls();
    const auth = lab.issue(item.actor === 'owner' ? 'lin' : 'wu');
    const start = performance.now();
    const run = await lab.api.post(path + '/team-diagnose').set('authorization', auth).send({ mode });
    const ms = Math.round(performance.now() - start);
    const events = await lab.api.get(path + '/events').set('authorization', lab.issue('lin')).expect(200);
    const traces = await lab.api.get(path + '/traces').set('authorization', lab.issue('lin')).expect(200);
    const { inputTokens, outputTokens } = traces.body.data.usage;
    const audit = await lab.db.auditLog.findMany({ where: { action: 'agent.tool_call', before: { path: ['runId'], equals: id } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
    return { id: item.id, mode, round, ms, before, after: await inspect(), modelCalls: calls() - initialCalls,
      steps: run.body.data?.stepCount ?? 0, reason: run.body.data?.stopReason ?? null, http: run.status,
      predicted: events.body.data.events.at(-1)?.payload?.answer ?? null, inputTokens, outputTokens,
      calls: audit.map(x => (x.before as { name: string }).name) };
  }
  async function experiment(rounds: number, calls: () => number, kind: string, digest?: string) {
    const rows: Arm[] = [];
    for (let round = 1; round <= rounds; round++) {
      for (const [index, item] of dataset.entries()) {
        for (const mode of order(index, round)) rows.push(await measure(item, mode, round, calls));
      }
    }
    const result = compare(rows, rounds);
    const report = { kind, edition, digest, rounds, rows, result };
    if (process.env.D167_EVIDENCE_FILE) appendFileSync(process.env.D167_EVIDENCE_FILE, JSON.stringify(report) + '\n');
    return result;
  }
  it('用相同的十二个工单目标验收两条路径', async () => {
    const model = vi.spyOn(lab.gateway, 'complete').mockImplementation(async messages => {
      const system = messages[0].content, material = JSON.parse(String(messages[1].content));
      const clue = material.quote ?? material.excerpts?.[0] ?? '';
      const extra = /重传率|阵列/.test(clue);
      const category = /CRC|域名|重传率/.test(clue) ? 'network' : /ENOSPC|inode|阵列/.test(clue) ? 'storage'
        : /UPS|双电源/.test(clue) ? 'power' : 'unknown';
      if (system.startsWith('分诊')) return response({ index: 0, needCounts: extra });
      if (system.startsWith('复核')) return response({ verdict: material.candidate === category ? 'accept' : 'insufficient' });
      if (system.startsWith('单角色') && extra && !material.alerts) return response({ tool: 'ticket_log_counts' });
      return response({ category });
    });
    const report = await experiment(1, () => model.mock.calls.length, 'controlled');
    for (const arm of [report.single, report.team]) expect(arm).toMatchObject({ total: 12, success: 12, violations: 0 });
    expect(report.team.modelCalls).toBeGreaterThan(report.single.modelCalls);
  }, 90_000);

  it.skipIf(process.env.W24_LIVE !== '1')('本机模型配对对照', async () => {
    const host = 'http://127.0.0.1:11434', model = 'tinyllama:latest';
    const tags = await (await fetch(host + '/api/tags')).json();
    const digest = tags.models.find((x: { name: string }) => x.name === model)?.digest;
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    const warm = await fetch(host + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'OK', stream: false, keep_alive: '10m', options: { num_predict: 2 } }) });
    expect((await warm.json()).done).toBe(true);
    vi.stubEnv('LLM_BASE_URL', host + '/v1'); vi.stubEnv('LLM_MODEL', model); vi.stubEnv('LLM_MODEL_ROUTES', '');
    vi.stubEnv('LLM_API_KEY', 'local-ollama');
    const gateway = vi.spyOn(lab.gateway, 'complete');
    const report = await experiment(3, () => gateway.mock.calls.length, 'live', digest);
    expect(report.team.total).toBe(36); expect(report.single.total).toBe(36);
  }, 600_000);
});
```

## 五、核心面试题

1. 两种架构可以使用不同工具权限再比较成功率吗？
2. 为何共享方案可传，来源工单原文仍受限？
3. 两组平均分有差异，哪几对样本实际改变了判断？

列出只在一侧成功或违规的工单，检查原因并注明模型或夹具来源。 [本日配套面试题](D167-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

12 道固定合成题分别经过两种架构。受控网关跑一轮，本机 TinyLlama 跑三轮。记录含调用次数、耗时、业务状态和逐题预测。[逐题配对](../学习记录/新版验收/D167-paired.jsonl)。

[本章验收记录](../学习记录/新版验收/D167-paired.jsonl)。
