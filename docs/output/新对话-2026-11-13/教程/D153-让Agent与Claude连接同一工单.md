# D153　让Agent与Claude连接同一工单

第 22 周 · 300 分钟。回忆 30、推导 45、集成 115、反证 50、口述与复盘 60。前置阅读见[上一讲](D152-校验OAuth委托与工具范围.md)。

## 今天要做出什么

用项目 Agent 和第二个 MCP 客户端查同一张可见工单，对照调用参数、授权主体及返回摘要。

## 今天的目录结构

- `.mcp.json`
- `apps/server/src/mcp/manifest.spec.ts`
- `apps/server/src/mcp/manifest.ts`
- `apps/server/src/mcp/run-summary.ts`
- `apps/server/src/mcp/summary-agent.ts`
- `apps/server/test/mcp-claude-driver.ts`
- `apps/server/test/ticket-mcp.e2e-spec.ts`

## 零、闭卷回忆

**D152**　账户本身有写权，为什么代理仍可能被拒绝？

<details><summary>核对</summary>

实际授权取主体权限、委托范围、资源用途的交集。

</details>

**D150**　切换协议能否扩大客户管理员的权限？

<details><summary>核对</summary>

MCP 转到同一业务服务，保留主体、用途及工单范围，拒绝结果一致。

</details>

**D146**　返工会创建新单或重新交给另一位处理人吗？

<details><summary>核对</summary>

同单直接回原处理人，版本连续增长。最后确认的事件属于提单人，知识审批另行进行。

</details>

## 一、知识点与推导

核对真实工具回执、工单号、事件版本和拒绝场景，记录是否使用模型夹具。

先从已登录用户取得自己的 runId。用工具目录查看允许的参数，发起一次 MCP 调用，再改用另一客户身份请求同一 runId。把工具回执与直接访问 HTTP 的结果并列。

项目 Agent 用 OAuth 得到只读令牌，检查目录后读取摘要；Claude Code 读取项目 MCP 配置，启动本地构建好的 stdio 服务。两者最后都进入绑定用户的工单接口。测试用回环模型端点让 Claude Code 提交工具调用，收到实际工单号才记为成功。

工具说明是服务端提供给模型的文本，描述变化可能改变模型的选择。项目只读 Agent 在发起调用前比较工具名、说明、完整输入结构和执行提示；目录未读完或发生变化时停止。Claude CLI 例子固定本地入口及可调用工具名。

## 二、动手开发

1. 用项目 Agent 和第二个 MCP 客户端查同一张可见工单，对照调用参数、授权主体及返回摘要。先记录操作者、输入和预期。
2. 同一工单走两个真实客户端并核验结果。在输出中圈出能区分成功和失败的字段。
3. 两个客户端都显示“成功”能证明读到同一条记录吗？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm build
pnpm exec vitest run src/mcp/manifest.spec.ts
pnpm exec vitest run --config vitest.config.e2e.ts test/ticket-mcp.e2e-spec.ts
```

<details><summary>提示一 · 方向</summary>

先限定摘要返回的字段，再连接 D152 的回环资源。

</details>
<details><summary>提示二 · API</summary>

readSummary、checkDirectory、StreamableHTTPClientTransport。

</details>
<details><summary>提示三 · 实现顺序</summary>

先获取完整目录，与本地通过评审的描述逐项比较，再读取 ticketNo、title.text 和 status。

</details>

### 步骤 2　让 Claude Code 完成一次同工单交接

<details><summary>提示一 · 方向</summary>

使用临时配置目录、本机模型夹具和项目 .mcp.json，向客户端只提供摘要工具。

</details>
<details><summary>提示二 · API</summary>

mcp-claude-driver.ts、--bare、--strict-mcp-config、--allowedTools。

</details>
<details><summary>提示三 · 实现顺序</summary>

本地模型回复一次工具请求；收到 tool_result 时检查工单号；保存布尔结果和运行 ID，再清理临时目录。

</details>

在 `apps/server` 运行 `pnpm exec vitest run src/mcp/manifest.spec.ts`。

在 `apps/server` 运行 `pnpm exec vitest run --config vitest.config.e2e.ts test/ticket-mcp.e2e-spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

用项目 Agent 和第二个 MCP 客户端查同一张可见工单，对照调用参数、授权主体及返回摘要。

</details>

<details><summary>提示二 · 切换一个条件</summary>

两个客户端都显示“成功”能证明读到同一条记录吗？

</details>

<details><summary>提示三 · 对照判定</summary>

核对真实工具回执、工单号、事件版本和拒绝场景，记录是否使用模型夹具。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**.mcp.json**

```json
{
  "mcpServers": {
    "ticket": {
      "command": "node",
      "args": [
        "apps/server/dist/mcp/stdio.js"
      ],
      "env": {
        "TICKET_API_ORIGIN": "${TICKET_API_ORIGIN}",
        "TICKET_RUN_ID": "${TICKET_RUN_ID}",
        "TICKET_API_AUTH": "${TICKET_API_AUTH}"
      }
    }
  }
}
```

**apps/server/src/mcp/manifest.spec.ts**

```ts
import { checkDirectory, summaryTool } from './manifest.js';

describe('已评审的只读工具清单', () => {
  it('识别仅修改说明文字的版本差异', () => {
    expect(() => checkDirectory({ tools: [summaryTool] })).not.toThrow();
    expect(() => checkDirectory({ tools: [{ ...summaryTool, description: '新版工单说明' }] })).toThrow('重新核准');
  });

  it('发现后续分页时暂停调用', () => {
    expect(() => checkDirectory({ tools: [summaryTool], nextCursor: 'second' })).toThrow('重新核准');
  });
});
```

**apps/server/src/mcp/manifest.ts**

```ts
import { isDeepStrictEqual } from 'node:util';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

// 评审后保存的只读 Skill 契约。升级 SDK 或描述时需先检查差异。
export const summaryTool = {
  name: 'ticket_summary', description: '读取工单标题、描述和状态',
  inputSchema: { type: 'object', properties: {}, $schema: 'http://json-schema.org/draft-07/schema#', additionalProperties: false },
  execution: { taskSupport: 'forbidden' },
} as const;
export function checkDirectory(list: ListToolsResult) {
  if (list.nextCursor || !isDeepStrictEqual(list.tools, [summaryTool])) {
    throw new Error('工单工具清单需要重新核准');
  }
}
```

**apps/server/src/mcp/run-summary.ts**

```ts
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { withTicketClient } from './client.js';
import { readSummary } from './summary-agent.js';

const env: Record<string, string> = {};
for (const name of ['TICKET_API_ORIGIN', 'TICKET_RUN_ID', 'TICKET_API_AUTH']) {
  const value = process.env[name];
  if (!value) throw new Error('缺少当前工单配置 ' + name);
  env[name] = value;
}
// 命令由本地构建产物定位，不在运行时下载外部服务。
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('./stdio.js', import.meta.url))], env });
const summary = await withTicketClient(transport, readSummary);
console.log(JSON.stringify(summary));
```

**apps/server/src/mcp/summary-agent.ts**

```ts
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { checkDirectory } from './manifest.js';

// 这一步是工作流中显式选择的只读动作；调用前核对整份目录。
export async function readSummary(client: Client) {
  checkDirectory(await client.listTools());
  const result = await client.callTool({ name: 'ticket_summary', arguments: {} });
  const content = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]).safeParse(result.content);
  if (result.isError || !content.success) throw new Error('工单摘要读取失败');
  return z.object({ ticketNo: z.string().min(1), title: z.object({ text: z.string() }), status: z.string() })
    .parse(JSON.parse(content.data[0].text));
}
```

**apps/server/test/mcp-claude-driver.ts**

```ts
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// 只在本地模拟模型回复。Claude Code 的 MCP 握手、工具调用和结果回传由真实 CLI 执行。
export async function claudeRead(exe: string, api: string, run: string, auth: string, ticket: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'ticket-claude-'));
  const config = join(cwd, 'config'); await mkdir(config);
  const name = 'mcp__ticket__ticket_summary';
  let returned = false, toolOffered = false;
  const model = createServer(async (req, res) => {
    if (!req.url?.startsWith('/v1/messages')) { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const offered = Array.isArray(input.tools) && input.tools.some((tool: { name: string }) => tool.name === name);
    toolOffered ||= offered;
    const blocks = (input.messages ?? []).flatMap((m: { content: unknown }) => Array.isArray(m.content) ? m.content : []);
    const got = blocks.some((b: { type: string; content?: unknown }) => b.type === 'tool_result' && JSON.stringify(b.content).includes(ticket));
    returned ||= got;
    const call = offered && !blocks.some((b: { type: string }) => b.type === 'tool_result');
    const content = call ? { type: 'tool_use', id: 'toolu_ticket', name, input: {} } : { type: 'text', text: got ? '摘要已核实' : '完成' };
    const message = { id: 'msg_ticket', type: 'message', role: 'assistant', model: input.model,
      content: [content], stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 4 } };
    if (!input.stream) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type: string, args: object) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...args }) + '\n\n');
    event('message_start', { message: { ...message, content: [], stop_reason: null } });
    event('content_block_start', { index: 0, content_block: call ? content : { type: 'text', text: '' } });
    if (!call) event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: content.text } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 4 } });
    event('message_stop', {}); res.end();
  });
  await new Promise<void>(ok => model.listen(0, '127.0.0.1', ok));
  try {
    const local = 'http://127.0.0.1:' + (model.address() as AddressInfo).port;
    const projectRoot = resolve('../..');
    const project = JSON.parse(await readFile(join(projectRoot, '.mcp.json'), 'utf8'));
    const ticketServer = project.mcpServers.ticket;
    ticketServer.command = process.execPath;
    ticketServer.args = ticketServer.args.map((arg: string) => resolve(projectRoot, arg));
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) env[key] = process.env[key];
    const child = spawn(exe, ['--bare', '--print', '--no-session-persistence', '--strict-mcp-config',
      '--mcp-config', JSON.stringify(project), '--model', 'claude-sonnet-4-6', '--tools', '',
      '--allowedTools', name, '--', '请用工单摘要工具核对当前工单。'], {
      cwd, env: { ...env, HOME: cwd, USERPROFILE: cwd, CLAUDE_CONFIG_DIR: config, TICKET_API_AUTH: auth, TICKET_API_ORIGIN: api, TICKET_RUN_ID: run,
        ANTHROPIC_API_KEY: 'local-fixture', ANTHROPIC_BASE_URL: local, ENABLE_TOOL_SEARCH: 'false',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 35_000);
    try {
      const exitCode = await new Promise<number | null>((ok, fail) => { child.once('error', fail); child.once('close', ok); });
      return { exitCode, toolOffered, returned };
    } finally { clearTimeout(timer); }
  } finally {
    await new Promise<void>(ok => model.close(() => ok()));
    if (dirname(resolve(cwd)) === resolve(tmpdir())) await rm(cwd, { recursive: true, force: true });
  }
}
```

**apps/server/test/ticket-mcp.e2e-spec.ts**

```ts
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
});
```

## 五、核心面试题

1. 账户本身有写权，为什么代理仍可能被拒绝？
2. 切换协议能否扩大客户管理员的权限？
3. 两个客户端都显示“成功”能证明读到同一条记录吗？

核对真实工具回执、工单号、事件版本和拒绝场景，记录是否使用模型夹具。 [本日配套面试题](D153-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机双客户端经 OAuth/HTTP 和 stdio 读取同一工单。Claude Code 使用本地模型夹具，实际发起 MCP 调用并验证返回的单号。[双客户端等接口验收](../学习记录/新版验收/D154-integration.txt)。
