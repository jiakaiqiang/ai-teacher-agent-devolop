import type { AuthUser } from '../auth/auth.types.js';
import { visibleTickets } from '../tickets/scope.js';
import { redactForLog } from '../common/sensitive.js';
import type { TransactionClient } from '../prisma/prisma.service.js';
import { CallError, pageArgs, type Name } from './tool-catalog.js';

export function shortText(value: string, limit = 240) {
  const chars = Array.from(redactForLog(value));
  return { text: chars.slice(0, limit).join(''), clipped: chars.length > limit };
}
export function pageOf<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, next: rows.length > limit ? items.at(-1)!.id : null };
}
export async function visibleTicket(tx:TransactionClient,user:AuthUser,ticketNo:string) {
  const actor=await tx.user.findUniqueOrThrow({where:{id:user.id}});
  const row=await tx.ticket.findFirst({where:{AND:[{ticketNo},visibleTickets(actor)]},include:{
    category:{select:{name:true}},assignee:{select:{displayName:true}}
  }});
  if(!row) throw new CallError('TOOL_TARGET_NOT_FOUND');
  return row;
}
export async function readTicketTool(tx:TransactionClient,user:AuthUser,ticketNo:string,name:Name,args:unknown) {
  const row=await visibleTicket(tx,user,ticketNo);
  switch(name) {
    case 'ticket_summary':return {ticketNo,title:shortText(row.title),description:shortText(row.description),status:row.status};
    case 'ticket_progress':return {status:row.status,version:row.version};
    case 'ticket_category':return {category:row.category.name};
    case 'ticket_owner':return {assignedTo:row.assignee?.displayName ?? null};
    case 'ticket_log_counts':return {counts:[{severity:'material',count:await tx.ticketMaterial.count({where:{ticketId:row.id}})}]};
    case 'ticket_log_page':
    case 'ticket_history_page':{
      const {limit,after}=pageArgs.parse(args);
      const params={where:{ticketId:row.id,id:{gt:after ?? undefined}},orderBy:{id:'asc' as const},take:limit+1};
      if(name==='ticket_log_page') return pageOf((await tx.ticketMaterial.findMany(params)).map(m=>({id:m.id,log:shortText(m.logText)})),limit);
      return pageOf((await tx.ticketEvent.findMany(params)).map(e=>({id:e.id,action:e.action,comment:shortText(e.comment)})),limit);
    }
    default:throw new CallError('TOOL_NOT_READABLE');
  }
}
