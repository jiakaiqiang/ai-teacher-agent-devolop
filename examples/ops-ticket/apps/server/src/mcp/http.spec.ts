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
