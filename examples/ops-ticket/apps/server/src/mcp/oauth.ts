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
