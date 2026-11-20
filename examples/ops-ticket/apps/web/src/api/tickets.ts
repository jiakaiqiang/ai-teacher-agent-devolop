import {
  ticketDetailSchema,
  ticketPageSchema,
  type TicketDetail,
  type TicketPage,
} from '@ops-ticket/shared'
import { getJson } from './http'

export interface ListTicketsParams {
  company?: string
  cursor?: string | null
  limit?: number
}

export function listTickets(params: ListTicketsParams, signal?: AbortSignal): Promise<TicketPage> {
  const query = new URLSearchParams()
  if (params.company) query.set('company', params.company)
  if (params.cursor) query.set('cursor', params.cursor)
  query.set('limit', String(params.limit ?? 20))
  return getJson(`/api/tickets?${query}`, ticketPageSchema, signal)
}

export function getTicket(ticketNo: string, signal?: AbortSignal): Promise<TicketDetail> {
  return getJson(`/api/tickets/${encodeURIComponent(ticketNo)}`, ticketDetailSchema, signal)
}
