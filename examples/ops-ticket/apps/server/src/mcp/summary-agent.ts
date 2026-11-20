import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { checkDirectory } from './manifest.js';

// 这一步是工作流中显式选择的只读动作；调用前核对整份目录。
export async function readSummary(client: Client) {
  checkDirectory(await client.listTools());
  const result = await client.callTool({ name: 'ticket_summary', arguments: {} });
  const content = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]).safeParse(result.content);
  if (result.isError || !content.success) throw new Error('工单摘要读取失败');
  return z.object({ ticketNo: z.string().min(1), title: z.object({ text: z.string() }), status: z.string() })
    .parse(JSON.parse(content.data[0].text));
}
