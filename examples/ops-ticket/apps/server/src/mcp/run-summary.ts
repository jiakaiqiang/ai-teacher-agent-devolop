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
