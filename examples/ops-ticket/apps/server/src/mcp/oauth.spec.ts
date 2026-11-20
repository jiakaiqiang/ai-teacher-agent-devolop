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
