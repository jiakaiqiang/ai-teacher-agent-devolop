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
