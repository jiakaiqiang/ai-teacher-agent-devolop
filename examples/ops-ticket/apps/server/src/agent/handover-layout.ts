import { layoutSchema, type Layout } from './preference.js';
import type { TicketFacts } from './handover-history.js';

export function presentHandover(facts: TicketFacts, saved?: string | null, override?: Layout) {
  const stored = layoutSchema.safeParse(saved);
  const layout = override ?? (stored.success ? stored.data : 'summary-first');
  const source = override ? 'request' : stored.success ? 'memory' : 'default';
  const summary = { section: 'summary', text: facts.ticketNo + ' · ' + facts.decision };
  const evidence = { section: 'evidence', text: facts.approval };
  return { layout, source, sections: layout === 'evidence-first' ? [evidence, summary] : [summary, evidence] };
}
