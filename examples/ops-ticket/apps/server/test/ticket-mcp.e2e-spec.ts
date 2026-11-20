import { appendFileSync } from 'node:fs';
import { claudeRead } from './mcp-claude-driver.js';
import { readSummary } from '../src/mcp/summary-agent.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sandboxOAuth } from './mcp-oauth-fixture.js';
import { upstream } from '../src/mcp/upstream.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { withTicketClient } from '../src/mcp/client.js';
import { bearer } from './login-fixtures.js';

describe('MCP 与业务 API 的权限对照', () => {
  let app: INestApplication, db: PrismaService;
  let origin: string, runId: string, ticketNo: string, owner: string, other: string;
  function child(auth: string) {
    return new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/stdio.ts'],
      env: { TICKET_API_ORIGIN: origin, TICKET_RUN_ID: runId, TICKET_API_AUTH: auth, TICKET_NOTE_WRITE: '1' } });
  }
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
    db=app.get(PrismaService); ticketNo='T-001';
    owner=await bearer(app); other=await bearer(app,'wu');
    const res = await request(app.getHttpServer()).post('/api/agent/runs').set('authorization', owner)
      .send({ requestKey: randomUUID(), ticketNo, goal: '读取摘要并核对个人笔记' }).expect(201);
    runId = res.body.data.id;
  });
  afterAll(async () => {
    await db.agentRun.deleteMany({where:{id:runId}}); await app.close();
  });

  it('本人通过子进程读取真实工单并幂等保存笔记', async () => {
    await withTicketClient(child(owner), async client => {
      const summary = await client.callTool({ name: 'ticket_summary', arguments: {} });
      expect(summary.content).toEqual([{ type: 'text', text: expect.stringContaining(ticketNo) }]);
      const input = { name: 'save_private_note', arguments: { requestKey: randomUUID(), text: '教学核查' } };
      const first = await client.callTool(input); const again = await client.callTool(input);
      expect(first.content).toEqual([{ type: 'text', text: expect.stringContaining('"replay":false') }]);
      expect(again.content).toEqual([{ type: 'text', text: expect.stringContaining('"replay":true') }]);
    });
  });

  it('同一运行对另一位用户沿用直接请求的拒绝', async () => {
    await request(app.getHttpServer()).post('/api/agent/runs/' + runId + '/tools').set('authorization', other)
      .send({ calls: [{ name: 'ticket_summary', version: 1, args: {} }] }).expect(404);
    await withTicketClient(child(other), async client => {
      const r = await client.callTool({ name: 'ticket_summary', arguments: {} });
      expect(r).toMatchObject({ isError: true, content: [{ type: 'text', text: 'TICKET_HTTP_404' }] });
    });
  });

  it('以授权码和 PKCE 换取专属受众令牌并从 HTTP 读取工单', async () => {
    const sandbox = await sandboxOAuth(upstream(origin, runId, owner));
    try {
      const exchange = await sandbox.consent('ticket:read');
      expect((await exchange('incorrect-proof')).status).toBe(400);
      const token = await exchange(); expect(token.status).toBe(200);
      const body = await token.json(); expect((await exchange()).status).toBe(400);
      const http = new StreamableHTTPClientTransport(sandbox.resource, {
        requestInit: { headers: { Authorization: 'Bearer ' + body.access_token } },
      });
      await withTicketClient(http, async client => {
        expect((await client.listTools()).tools.map(t => t.name)).toEqual(['ticket_summary']);
        const result = await client.callTool({ name: 'ticket_summary', arguments: {} });
        expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining(ticketNo) }]);
      });
    } finally { await sandbox.close(); }
  });

  it('只读 Agent 核对已评审目录后读取当前工单', async () => {
    const sandbox = await sandboxOAuth(upstream(origin, runId, owner));
    try {
      const exchange = await sandbox.consent('ticket:read');
      const body = await (await exchange()).json();
      const transport = new StreamableHTTPClientTransport(sandbox.resource, {
        requestInit: { headers: { Authorization: 'Bearer ' + body.access_token } },
      });
      const data = await withTicketClient(transport, readSummary);
      expect(data.ticketNo).toBe(ticketNo);
    } finally { await sandbox.close(); }
  });

  it.skipIf(!process.env.W22_CLAUDE_EXE)('Claude Code 用本地受控模型读取同一张工单', async () => {
    const result = await claudeRead(process.env.W22_CLAUDE_EXE!, origin, runId, owner, ticketNo);
    expect(result).toEqual({ exitCode: 0, toolOffered: true, returned: true });
    if (process.env.D153_EVIDENCE_FILE) appendFileSync(process.env.D153_EVIDENCE_FILE,
      JSON.stringify({ sample: 'claude-mcp-read', ticketNo, runId, ...result }) + '\n');
  }, 50_000);

  it.skipIf(!process.env.W22_CLAUDE_EXE)('通过项目 Skill 读取绑定的摘要', async () => {
    const result = await claudeRead(process.env.W22_CLAUDE_EXE!, origin, runId, owner, ticketNo, true);
    expect(result).toEqual({ exitCode: 0, toolOffered: true, returned: true, skillSeen: true });
  }, 50_000);
});
