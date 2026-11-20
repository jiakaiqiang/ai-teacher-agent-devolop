import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ticketServer, TicketToolFailure, type Dispatch } from './server.js';
import { withTicketClient } from './client.js';
import { readSummary } from './summary-agent.js';

async function run(dispatch: Dispatch) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const server = ticketServer(dispatch);
  await server.connect(right);
  try { return await withTicketClient(left, readSummary); }
  finally { await server.close(); }
}
describe('摘要交接', () => {
  it('只投影核对所需字段', async () => {
    const data = { ticketNo: 'MCP-7', title: { text: '巡检', clipped: false }, status: 'open', description: '正文' };
    expect(await run(async () => data)).toEqual({ ticketNo: data.ticketNo, title: { text: '巡检' }, status: 'open' });
  });

  it('区分业务拒绝与不完整的成功结果', async () => {
    await expect(run(async () => { throw new TicketToolFailure('TICKET_HTTP_404'); })).rejects.toThrow('工单摘要读取失败');
    await expect(run(async () => ({ ticketNo: 'MCP-7', title: { text: '巡检' } }))).rejects.toThrow('status');
  });
});
