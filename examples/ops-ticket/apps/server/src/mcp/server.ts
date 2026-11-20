import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { catalog } from '../agent/tool-catalog.js';

export type TicketTool = 'ticket_summary' | 'save_private_note';
export type Dispatch = (name: TicketTool, args: Record<string, unknown>) => Promise<unknown>;

// 权限由服务端上下文传入，客户端提供的工具参数只能描述业务数据。
export function ticketServer(dispatch: Dispatch, writeNotes = false) {
  const server = new McpServer({ name: 'ops-ticket', version: '1.0.0' });
  function register(name: TicketTool) {
    const entry = catalog[name];
    server.registerTool(name, { description: entry.description, inputSchema: entry.schema }, async (args: unknown) => {
      try {
        const data = await dispatch(name, entry.schema.parse(args) as Record<string, unknown>);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (error) {
        const code = error instanceof TicketToolFailure ? error.code : 'TICKET_UNAVAILABLE';
        return { isError: true, content: [{ type: 'text' as const, text: code }] };
      }
    });
  }
  register('ticket_summary');
  if (writeNotes) register('save_private_note');
  return server;
}

export class TicketToolFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
