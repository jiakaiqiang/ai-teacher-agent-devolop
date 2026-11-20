import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ticketServer } from './server.js';

async function session(write = false) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const dispatch = vi.fn().mockResolvedValue({ ticketNo: 'DEMO-7' });
  const server = ticketServer(dispatch, write);
  const client = new Client({ name: 'lesson', version: '1' });
  await server.connect(right);
  await client.connect(left);
  return { client, dispatch, close: async () => { await client.close(); await server.close(); } };
}

describe('工单 MCP 契约', () => {
  it('只读目录仅列出工单摘要', async () => {
    const s = await session();
    try {
      expect((await s.client.listTools()).tools.map(x => x.name)).toEqual(['ticket_summary']);
      expect((await s.client.callTool({ name: 'ticket_summary', arguments: {} })).content)
        .toEqual([{ type: 'text', text: '{"ticketNo":"DEMO-7"}' }]);
    } finally { await s.close(); }
  });

  it('获准写笔记时发布原有参数结构', async () => {
    const s = await session(true);
    try {
      const note = (await s.client.listTools()).tools.find(x => x.name === 'save_private_note');
      expect(note?.inputSchema.required).toEqual(expect.arrayContaining(['text', 'requestKey']));
      const bad = await s.client.callTool({ name: 'save_private_note', arguments: {} });
      expect(bad.isError).toBe(true);
      expect(s.dispatch).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
});
