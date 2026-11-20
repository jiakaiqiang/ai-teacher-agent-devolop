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
