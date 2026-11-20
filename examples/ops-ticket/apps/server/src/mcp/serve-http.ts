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
