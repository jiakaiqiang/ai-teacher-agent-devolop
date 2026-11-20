# D151　提供可发现的HTTP资源

第 22 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D150-沿用工单接口的读写权限.md)。

## 今天要做出什么

列出当前用户可发现的资料 URI，再手工构造另一公司的原始工单 URI 读取。

## 今天的目录结构

- `apps/server/src/mcp/http.spec.ts`
- `apps/server/src/mcp/http.ts`

## 零、闭卷回忆

**D150**　切换协议能否扩大客户管理员的权限？

<details><summary>核对</summary>

MCP 转到同一业务服务，保留主体、用途及工单范围，拒绝结果一致。

</details>

**D148**　工具能被客户端发现是否代表当前用户可执行？

<details><summary>核对</summary>

描述只公开契约，调用时用真实主体重新授权并保留审计。

</details>

**D144**　缺负责人复核时能把人工结果发送给用户验收吗？

<details><summary>核对</summary>

服务端检查状态及操作者。已处理交负责人，已复核才到提单人。

</details>

## 一、知识点与推导

发现与逐项读取均核对权限，缓存键包含可见范围和版本。

先从已登录用户取得自己的 runId。用工具目录查看允许的参数，发起一次 MCP 调用，再改用另一客户身份请求同一 runId。把工具回执与直接访问 HTTP 的结果并列。

MCP 客户端需要知道为哪个资源申请令牌。WWW-Authenticate 提供 resource_metadata 地址；读取该文档能得到精确的 resource 和 authorization_servers。地址来自固定配置，不应由入站请求的 Host 拼接。

本例每个已授权 POST 创建独立的 server 与无状态 HTTP transport，响应关闭时释放。绑定回环地址并启用 Host 校验，有 Origin 时检查是否来自配置来源。教学端点用 JSON 应答，没有长时间 GET 订阅。

## 二、动手开发

1. 列出当前用户可发现的资料 URI，再手工构造另一公司的原始工单 URI 读取。先记录操作者、输入和预期。
2. 为 HTTP 资源附带可见范围。在输出中圈出能区分成功和失败的字段。
3. 资源没有出现在列表就足够安全吗？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm exec vitest run src/mcp/http.spec.ts
```

<details><summary>提示一 · 方向</summary>

先写客户端未认证时的第一步，成功后再接业务读取。

</details>
<details><summary>提示二 · API</summary>

WWW-Authenticate、/.well-known/oauth-protected-resource/mcp。

</details>
<details><summary>提示三 · 实现顺序</summary>

返回 401 挑战，读取元数据并逐字比较 resource 和签发者地址。

</details>

### 步骤 2　实现无状态端点

<details><summary>提示一 · 方向</summary>

每次请求按自己的 grant 建服务，响应关闭后释放资源。

</details>
<details><summary>提示二 · API</summary>

createMcpExpressApp、StreamableHTTPServerTransport、handleRequest。

</details>
<details><summary>提示三 · 实现顺序</summary>

检查来源，解析 Bearer，授权成功才接 POST；已授权 GET 返回 405。

</details>

在 `apps/server` 运行 `pnpm exec vitest run src/mcp/http.spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

列出当前用户可发现的资料 URI，再手工构造另一公司的原始工单 URI 读取。

</details>

<details><summary>提示二 · 切换一个条件</summary>

资源没有出现在列表就足够安全吗？

</details>

<details><summary>提示三 · 对照判定</summary>

发现与逐项读取均核对权限，缓存键包含可见范围和版本。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/src/mcp/http.spec.ts**

```ts
import request from 'supertest';
import { ticketHttp } from './http.js';

const resource = new URL('http://127.0.0.1:3891/mcp');
const issuer = new URL('http://127.0.0.1:3892/');
const app = ticketHttp(resource, issuer, async () => undefined);

describe('HTTP 资源发现', () => {
  it('未登录时返回可定位的资源元数据', async () => {
    const response = await request(app).post('/mcp').set('Host', resource.host).expect(401);
    expect(response.headers['www-authenticate']).toContain('resource_metadata="' + resource.origin + '/.well-known/oauth-protected-resource/mcp"');
    const meta = await request(app).get('/.well-known/oauth-protected-resource/mcp').set('Host', resource.host).expect(200);
    expect(meta.body).toMatchObject({ resource: resource.href, authorization_servers: [issuer.href] });
  });

  it('浏览器来源必须与配置的资源同源', async () => {
    await request(app).post('/mcp').set('Host', resource.host).set('Origin', issuer.origin).expect(403);
    await request(app).post('/mcp').set('Host', resource.host).set('Origin', resource.origin).expect(401);
  });
});
```

**apps/server/src/mcp/http.ts**

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ticketServer, type Dispatch } from './server.js';

export type Grant = { dispatch: Dispatch; writeNotes: boolean };
export type Authorize = (bearer: string) => Promise<Grant | 'insufficient_scope' | undefined>;
export const scopes = ['ticket:read', 'note:write'];

// 教学端点绑定回环地址；资源标识来自启动配置，不能从请求 Host 推断。
export function ticketHttp(resource: URL, issuer: URL, authorize: Authorize) {
  if (resource.protocol !== 'http:' || resource.hostname !== '127.0.0.1' ||
      resource.href !== resource.origin + '/mcp') throw new Error('资源地址无效');
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  const metadata = resource.origin + '/.well-known/oauth-protected-resource/mcp';
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
    res.json({ resource: resource.href, authorization_servers: [issuer.href], scopes_supported: scopes });
  });
  app.all('/mcp', async (req, res) => {
    if (req.headers.origin && req.headers.origin !== resource.origin) { res.sendStatus(403); return; }
    const bearer = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const grant = bearer ? await authorize(bearer) : undefined;
    if (!grant || grant === 'insufficient_scope') {
      const insufficient = grant === 'insufficient_scope';
      res.set('WWW-Authenticate', 'Bearer resource_metadata="' + metadata + '", scope="ticket:read"' +
        (insufficient ? ', error="insufficient_scope"' : '')).sendStatus(insufficient ? 403 : 401);
      return;
    }
    if (req.method !== 'POST') { res.set('Allow', 'POST').sendStatus(405); return; }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = ticketServer(grant.dispatch, grant.writeNotes);
    res.once('close', () => { void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return app;
}
```

## 五、核心面试题

1. 切换协议能否扩大客户管理员的权限？
2. 工具能被客户端发现是否代表当前用户可执行？
3. 资源没有出现在列表就足够安全吗？

发现与逐项读取均核对权限，缓存键包含可见范围和版本。 [本日配套面试题](D151-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机双客户端经 OAuth/HTTP 和 stdio 读取同一工单。Claude Code 使用本地模型夹具，实际发起 MCP 调用并验证返回的单号。[双客户端等接口验收](../学习记录/新版验收/D154-integration.txt)。
