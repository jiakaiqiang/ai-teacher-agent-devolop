import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { withTicketClient } from './client.js';

function processTransport() {
  return new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/stdio.ts'], env: {} });
}

describe('子进程协议', () => {
  it('从真实子进程取得服务名称和工具清单', async () => {
    await withTicketClient(processTransport(), async client => {
      expect(client.getServerVersion()?.name).toBe('ops-ticket');
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(['ticket_summary']);
    });
  });

  it('未配置业务身份时返回工具错误', async () => {
    await withTicketClient(processTransport(), async client => {
      const result = await client.callTool({ name: 'ticket_summary', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'TICKET_SESSION_REQUIRED' }]);
    });
  });
});
