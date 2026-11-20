import { TriageService } from '../assistant/triage.service.js';
import { UsageMeter } from '../assistant/usage-meter.js';
import { AiQuotaService } from '../assistant/ai-quota.service.js';
import { redactForLog } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketCommands } from '../tickets/ticket-commands.js';

import { retrieve } from '../retrieval/retrieve.js';

async function referenceMaterials(db:PrismaService,query:string,companyId:string) {
  const hits=await retrieve(db,query,companyId,'');
  return hits.map(hit=>({id:hit.sourceKey+'@'+hit.version,text:hit.quote}));
}
export async function diagnoseTicket(db: PrismaService, triage: TriageService, ticketNo: string, version: number, lookup=referenceMaterials) {
  const ticket = await db.ticket.findUniqueOrThrow({where: {ticketNo}, include: {
    category: true, materials: {orderBy: {id:'asc'}, take:4},
  }});
  if (ticket.status !== 'agent_processing' || ticket.version !== version) return;
  const logs=ticket.materials.map(m=>redactForLog(m.logText).slice(0,800));
  const quota = new AiQuotaService(db);
  const meter = new UsageMeter();
  let reservation: string | undefined;
  let action: 'suggest' | 'offer_handoff' = 'offer_handoff';
  let comment = '诊断暂不可用，可申请人工接入';
  try {
    const references=await lookup(db,[ticket.description,...logs].join("\n"),ticket.companyId);
    reservation = await quota.reserve(ticket.reporterId, ticket.id);
    const result = await triage.suggest({
      category: ticket.category.name, description: redactForLog(ticket.description),
      logs, references,
    }, undefined, 'default', meter);
    const { intent, steps, evidenceIds, missingInformation } = result.suggestion;
    const supported = steps.length > 0 && evidenceIds.length > 0 && missingInformation.length === 0
      && evidenceIds.every(id => references.some(ref => ref.id === id));
    action = supported ? 'suggest' : 'offer_handoff';
    comment = supported ? [intent, ...steps, ...evidenceIds].join('\n')
      : [intent, ...missingInformation, '可申请人工接入'].join('\n');
  } catch {
    // 模型失败或额度不足时仍向用户提供人工接入入口。
  } finally {
    if (reservation) await quota.settle(reservation, meter.summary());
  }
  return new TicketCommands(db).apply(ticketNo, {source:'agent'}, action, version, undefined, comment);
}
