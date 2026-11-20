import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

// 同一个客户端入口适用于子进程和下一章的 HTTP 连接。
export async function withTicketClient<T>(transport: Transport, use: (client: Client) => Promise<T>) {
  const client = new Client({ name: 'ops-ticket-agent', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await use(client);
  } finally { await client.close(); }
}
