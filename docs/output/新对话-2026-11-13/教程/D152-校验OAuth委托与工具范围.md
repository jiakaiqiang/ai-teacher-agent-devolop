# D152　校验OAuth委托与工具范围

第 22 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D151-提供可发现的HTTP资源.md)。

## 今天要做出什么

用只读 OAuth 委托访问日志，再请求发布共享知识，检查过期与受众错误。

## 今天的目录结构

- `apps/server/src/mcp/oauth.spec.ts`
- `apps/server/src/mcp/oauth.ts`
- `apps/server/src/mcp/serve-http.ts`
- `apps/server/test/mcp-oauth-fixture.ts`
- `apps/server/test/ticket-mcp.e2e-spec.ts`

## 零、闭卷回忆

**D151**　资源没有出现在列表就足够安全吗？

<details><summary>核对</summary>

发现与逐项读取均核对权限，缓存键包含可见范围和版本。

</details>

**D149**　标准输出里夹入一行调试日志会怎样？

<details><summary>核对</summary>

协议消息用标准输出，诊断写标准错误。核对请求配对和进程关闭。

</details>

**D145**　两个流程输出相同文案能证明分支一致吗？

<details><summary>核对</summary>

对照持久状态、下一操作者和终止条件，并检验重复事件。

</details>

## 一、知识点与推导

实际授权取主体权限、委托范围、资源用途的交集。

先从已登录用户取得自己的 runId。用工具目录查看允许的参数，发起一次 MCP 调用，再改用另一客户身份请求同一 runId。把工具回执与直接访问 HTTP 的结果并列。

客户端保管随机 verifier，只把 S256 摘要发到授权端；回跳时核对 state 与预登记的回调。兑换时提交授权码、原 verifier 和 resource。夹具验证错误证明不予兑换、正确证明可兑换、已成功兑换的码不能再用。

资源服务固定可信签发者、公钥、RS256 与精确受众，检查过期时间、令牌类型和 scope。用验证后的 sub 查业务会话。下游收到的是该用户独立的业务凭据，原 MCP 令牌只供资源服务器使用。

## 二、动手开发

1. 用只读 OAuth 委托访问日志，再请求发布共享知识，检查过期与受众错误。先记录操作者、输入和预期。
2. 校验 OAuth 委托和工具范围。在输出中圈出能区分成功和失败的字段。
3. 账户本身有写权，为什么代理仍可能被拒绝？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm exec vitest run src/mcp/oauth.spec.ts
pnpm exec vitest run --config vitest.config.e2e.ts test/ticket-mcp.e2e-spec.ts
```

<details><summary>提示一 · 方向</summary>

测试夹具固定已同意的教学用户、客户端和回调，每次生成新的密钥与授权码。

</details>
<details><summary>提示二 · API</summary>

mcp-oauth-fixture.ts 的 consent、/authorize、/token 以及头部挑战。

</details>
<details><summary>提示三 · 实现顺序</summary>

先走发现，再带 S256 和 state 请求授权。分别尝试错误证明、正确证明和重复兑换。

</details>

### 步骤 2　启动资源服务器

<details><summary>提示一 · 方向</summary>

复用同一套解析器，把 sub 通过服务端配置绑定到当前用户的工单会话。

</details>
<details><summary>提示二 · API</summary>

oauthGrant、JwtService.verifyAsync、serve-http.ts、StreamableHTTPClientTransport。

</details>
<details><summary>提示三 · 实现顺序</summary>

验证签名与声明，绑定 dispatch，按 scope 建只读目录，再调用摘要并比较工单号。

</details>

在 `apps/server` 运行 `pnpm exec vitest run src/mcp/oauth.spec.ts`。

在 `apps/server` 运行 `pnpm exec vitest run --config vitest.config.e2e.ts test/ticket-mcp.e2e-spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

用只读 OAuth 委托访问日志，再请求发布共享知识，检查过期与受众错误。

</details>

<details><summary>提示二 · 切换一个条件</summary>

账户本身有写权，为什么代理仍可能被拒绝？

</details>

<details><summary>提示三 · 对照判定</summary>

实际授权取主体权限、委托范围、资源用途的交集。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/src/mcp/oauth.spec.ts**

```ts
import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { oauthGrant } from './oauth.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const issuer = new URL('http://127.0.0.1:3810/');
const resource = new URL('http://127.0.0.1:3811/mcp');
const grant = oauthGrant(issuer, resource, pem, sub => sub === 'learner' ? async () => ({}) : undefined);
function token(scope: string, overrides = {}) {
  return new JwtService().sign({ sub: 'learner', client_id: 'lesson', scope, iss: issuer.href,
    aud: resource.href, exp: Math.floor(Date.now() / 1000) + 60, ...overrides },
    { privateKey: keys.privateKey, algorithm: 'RS256', header: { alg: 'RS256', typ: 'at+jwt' } });
}

describe('OAuth 委托范围', () => {
  it('精确校验签发者受众过期时间和身份绑定', async () => {
    expect(await grant(token('ticket:read'))).toMatchObject({ writeNotes: false });
    expect(await grant(token('ticket:read', { aud: issuer.href }))).toBeUndefined();
    expect(await grant(token('ticket:read', { iss: resource.href }))).toBeUndefined();
    expect(await grant(token('ticket:read', { exp: 1 }))).toBeUndefined();
    expect(await grant(token('ticket:read', { sub: 'unbound' }))).toBe('insufficient_scope');
  });

  it('笔记权限和摘要权限分别检查', async () => {
    expect(await grant(token('note:write'))).toBe('insufficient_scope');
    expect(await grant(token('ticket:read note:write'))).toMatchObject({ writeNotes: true });
  });
});
```

**apps/server/src/mcp/oauth.ts**

```ts
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import type { Authorize } from './http.js';
import type { Dispatch } from './server.js';

const claims = z.object({ sub: z.string().min(1), client_id: z.string().min(1),
  exp: z.number().int(), scope: z.string(), aud: z.string() });

// 签发者、公钥、受众与业务身份映射来自资源服务器自己的配置。
export function oauthGrant(issuer: URL, resource: URL, publicKey: string,
  sessionFor: (subject: string) => Dispatch | undefined): Authorize {
  const jwt = new JwtService();
  return async bearer => {
    try {
      const verified = await jwt.verifyAsync(bearer, { publicKey, algorithms: ['RS256'],
        issuer: issuer.href, audience: resource.href, complete: true });
      if (verified.header?.typ !== 'at+jwt') return undefined;
      const parsed = claims.safeParse(verified.payload);
      if (!parsed.success || parsed.data.aud !== resource.href) return undefined;
      const allowed = new Set(parsed.data.scope.split(' '));
      if (!allowed.has('ticket:read')) return 'insufficient_scope';
      const dispatch = sessionFor(parsed.data.sub);
      if (!dispatch) return 'insufficient_scope';
      return { dispatch, writeNotes: allowed.has('note:write') };
    } catch { return undefined; }
  };
}
```

**apps/server/src/mcp/serve-http.ts**

```ts
import { readFileSync } from 'node:fs';
import { ticketHttp } from './http.js';
import { oauthGrant } from './oauth.js';
import { upstream } from './upstream.js';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('缺少配置 ' + name);
  return value;
}
const resource = new URL(required('MCP_RESOURCE'));
const issuer = new URL(required('MCP_ISSUER'));
if (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && issuer.hostname === '127.0.0.1')) {
  throw new Error('签发者地址无效');
}
const pem = readFileSync(required('MCP_PUBLIC_KEY_FILE'), 'utf8');
const subject = required('MCP_SUBJECT');
const dispatch = upstream(required('TICKET_API_ORIGIN'), required('TICKET_RUN_ID'), required('TICKET_API_AUTH'));
const grant = oauthGrant(issuer, resource, pem, sub => sub === subject ? dispatch : undefined);
ticketHttp(resource, issuer, grant).listen(Number(resource.port || 80), '127.0.0.1');
```

**apps/server/test/mcp-oauth-fixture.ts**

```ts
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { ticketHttp } from '../src/mcp/http.js';
import { oauthGrant } from '../src/mcp/oauth.js';
import type { Dispatch } from '../src/mcp/server.js';

async function loopback() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
async function stop(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
function challenge(verifier: string) { return createHash('sha256').update(verifier).digest('base64url'); }

// 只用于测试：固定客户端、已同意的教学身份和回调；授权码限一次、60 秒。
export async function sandboxOAuth(dispatch: Dispatch) {
  const auth = await loopback(), mcp = await loopback();
  const issuer = new URL(auth.origin), resource = new URL('/mcp', mcp.origin);
  const redirect = 'http://127.0.0.1:39817/callback', clientId = 'ops-lesson';
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map<string, { proof: string; expires: number; scope: string }>();
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: issuer.href, authorization_endpoint: auth.origin + '/authorize', token_endpoint: auth.origin + '/token',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['ticket:read', 'note:write'],
  }));
  app.get('/authorize', (req, res) => {
    const q = req.query;
    if (q.client_id !== clientId || q.redirect_uri !== redirect || q.resource !== resource.href ||
        q.response_type !== 'code' || q.code_challenge_method !== 'S256' ||
        typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge) ||
        typeof q.state !== 'string' || typeof q.scope !== 'string' || !['ticket:read', 'ticket:read note:write'].includes(q.scope)) {
      res.sendStatus(400); return;
    }
    const code = randomUUID(); codes.set(code, { proof: q.code_challenge, expires: Date.now() + 60_000, scope: q.scope });
    const location = new URL(redirect); location.search = new URLSearchParams({ code, state: q.state }).toString();
    res.redirect(location.href);
  });
  // SDK 的 Express 入口只预装 JSON；表单正文在这里按 OAuth 格式读取。
  app.post('/token', async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const code = form.get('code') ?? '', saved = codes.get(code);
    if (!saved || saved.expires <= Date.now() || form.get('grant_type') !== 'authorization_code' ||
        form.get('client_id') !== clientId || form.get('redirect_uri') !== redirect ||
        form.get('resource') !== resource.href || challenge(form.get('code_verifier') ?? '') !== saved.proof) {
      res.status(400).json({ error: 'invalid_grant' }); return;
    }
    codes.delete(code);
    const token = new JwtService().sign({ sub: 'lesson-bob', client_id: clientId, scope: saved.scope, aud: resource.href, iss: issuer.href },
      { privateKey: keys.privateKey, algorithm: 'RS256', expiresIn: 60, header: { typ: 'at+jwt', alg: 'RS256' } });
    res.set('Cache-Control', 'no-store').json({ access_token: token, token_type: 'Bearer', expires_in: 60, scope: saved.scope });
  });
  auth.server.on('request', app);
  const grant = oauthGrant(issuer, resource, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sub => sub === 'lesson-bob' ? dispatch : undefined);
  mcp.server.on('request', ticketHttp(resource, issuer, grant));
  async function consent(scope: string) {
    const probe = await fetch(resource, { method: 'POST' });
    const metaUrl = /resource_metadata="([^"]+)"/.exec(probe.headers.get('www-authenticate') ?? '')?.[1];
    if (probe.status !== 401 || metaUrl !== mcp.origin + '/.well-known/oauth-protected-resource/mcp') throw new Error('资源发现失败');
    const meta = await (await fetch(metaUrl)).json();
    if (meta.resource !== resource.href || meta.authorization_servers[0] !== issuer.href) throw new Error('签发者不匹配');
    const discovery = await (await fetch(new URL('/.well-known/oauth-authorization-server', issuer))).json();
    if (discovery.issuer !== issuer.href || new URL(discovery.authorization_endpoint).origin !== auth.origin ||
        new URL(discovery.token_endpoint).origin !== auth.origin) throw new Error('签发者发现失败');
    const state = randomUUID(), verifier = randomBytes(32).toString('base64url');
    const params = { client_id: clientId, redirect_uri: redirect, resource: resource.href };
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({ ...params, scope, state, response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge(verifier) }).toString();
    const reply = await fetch(url, { redirect: 'manual' });
    const callback = new URL(reply.headers.get('location') ?? '');
    if (reply.status !== 302 || callback.origin + callback.pathname !== redirect || callback.searchParams.get('state') !== state) throw new Error('回调校验失败');
    const code = callback.searchParams.get('code') ?? '';
    return (proof = verifier) => fetch(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({
      ...params, grant_type: 'authorization_code', code, code_verifier: proof,
    }) });
  }
  return { resource, consent, close: async () => { await Promise.all([stop(auth.server), stop(mcp.server)]); } };
}
```

**apps/server/test/ticket-mcp.e2e-spec.ts**

```ts
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
});
```

## 五、核心面试题

1. 资源没有出现在列表就足够安全吗？
2. 标准输出里夹入一行调试日志会怎样？
3. 账户本身有写权，为什么代理仍可能被拒绝？

实际授权取主体权限、委托范围、资源用途的交集。 [本日配套面试题](D152-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机双客户端经 OAuth/HTTP 和 stdio 读取同一工单。Claude Code 使用本地模型夹具，实际发起 MCP 调用并验证返回的单号。[双客户端等接口验收](../学习记录/新版验收/D154-integration.txt)。
