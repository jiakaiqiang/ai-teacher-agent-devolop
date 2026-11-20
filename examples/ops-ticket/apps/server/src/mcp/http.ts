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
