import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ticketServer, TicketToolFailure } from './server.js';
import { upstream } from './upstream.js';

const { TICKET_API_ORIGIN, TICKET_RUN_ID, TICKET_API_AUTH, TICKET_NOTE_WRITE } = process.env;
const configured = Boolean(TICKET_API_ORIGIN && TICKET_RUN_ID && TICKET_API_AUTH);
const dispatch = configured
  ? upstream(TICKET_API_ORIGIN!, TICKET_RUN_ID!, TICKET_API_AUTH!)
  : async () => { throw new TicketToolFailure('TICKET_SESSION_REQUIRED'); };
const server = ticketServer(dispatch, configured && TICKET_NOTE_WRITE === '1');
await server.connect(new StdioServerTransport());
