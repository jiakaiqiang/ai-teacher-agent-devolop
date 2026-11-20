import { z } from 'zod';
export const TICKET_STATUSES = [
  'agent_processing','awaiting_feedback','handoff_offered','pending_assignment',
  'human_processing','handled','reviewed','completed'
] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
const named = z.object({name:z.string()});
const person = z.object({displayName:z.string()});
export const ticketListItemSchema = z.object({
  ticketNo:z.string(), title:z.string(), status:ticketStatusSchema, createdAt:z.iso.datetime(),
});
export const ticketPageSchema = z.object({items:z.array(ticketListItemSchema),nextCursor:z.string().nullable()});
export const ticketDetailSchema = ticketListItemSchema.extend({
  canConfirm:z.boolean(),version:z.number().int(),description:z.string(),company:named,department:named,category:named,
  reporter:person,assignee:person.nullable(),materials:z.array(z.object({logText:z.string()})),
  events:z.array(z.object({comment:z.string(), action:z.string(),toStatus:ticketStatusSchema,actor:person.nullable()})),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;
export type TicketPage = z.infer<typeof ticketPageSchema>;
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
