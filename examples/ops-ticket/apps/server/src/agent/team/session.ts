import { z } from 'zod';
import { counts, excerpts, messages, type Counts } from './context.js';
import { proposal, receive, review, selected, selection, type Category, type Handoff } from './handoff.js';
import type { Role, ReadName } from './authority.js';
import type { PacketMessage } from '../context-packet.js';

export type Mode = 'single' | 'team';
type Stage = 'summary' | 'triage' | 'counts' | 'diagnosis' | 'review' | 'single' | 'done';
type Action = { kind: 'read'; role: Role; name: ReadName } |
  { kind: 'ask'; role: Role; messages: PacketMessage[]; schema: z.ZodType };
const singleChoice = z.union([proposal, z.object({ tool: z.literal('ticket_log_counts') }).strict()]);

// 一个实例对应一次认领的运行；传输、凭据及数据库均由外层持有。
export class TeamSession {
  private stage: Stage = 'summary';
  private parts: string[] = [];
  private packet?: Handoff;
  private alerts?: Counts;
  private candidate?: Category;
  constructor(private readonly mode: Mode, private readonly runId: string) {}

  next(): Action {
    switch (this.stage) {
      case 'summary': return { kind: 'read', role: this.mode === 'single' ? 'single' : 'triage', name: 'ticket_summary' };
      case 'counts': return { kind: 'read', role: this.mode === 'single' ? 'single' : 'diagnosis', name: 'ticket_log_counts' };
      case 'single': return { kind: 'ask', role: 'single', messages: messages({ role: 'single', excerpts: this.parts, alerts: this.alerts }),
        schema: this.alerts ? proposal : singleChoice };
      case 'triage': return { kind: 'ask', role: 'triage', messages: messages({ role: 'triage', excerpts: this.parts }),
        schema: selection.extend({ index: z.number().int().min(0).max(this.parts.length - 1) }) };
      case 'diagnosis': return { kind: 'ask', role: 'diagnosis', schema: proposal,
        messages: messages({ role: 'diagnosis', packet: receive(this.runId, this.packet), alerts: this.alerts }) };
      case 'review': return { kind: 'ask', role: 'review', schema: review,
        messages: messages({ role: 'review', packet: receive(this.runId, this.packet), candidate: this.candidate!, alerts: this.alerts }) };
      case 'done': throw new Error('协作已经结束');
    }
  }
  accept(raw: unknown): Category | undefined {
    switch (this.stage) {
      case 'summary':
        this.parts = excerpts(raw); this.stage = this.mode === 'team' ? 'triage' : 'single'; break;
      case 'triage':
        this.packet = selected(this.runId, this.parts, raw);
        this.parts = []; // 后续角色只能读取选中的交接材料。
        this.stage = this.packet.needCounts ? 'counts' : 'diagnosis'; break;
      case 'counts':
        this.alerts = counts.parse(raw); this.stage = this.mode === 'team' ? 'diagnosis' : 'single'; break;
      case 'single': {
        const decision = (this.alerts ? proposal : singleChoice).parse(raw);
        if ('tool' in decision) { this.stage = 'counts'; break; }
        this.stage = 'done'; return decision.category;
      }
      case 'diagnosis':
        this.candidate = proposal.parse(raw).category; this.stage = 'review'; break;
      case 'review': {
        const verdict = review.parse(raw).verdict;
        this.stage = 'done'; return verdict === 'accept' ? this.candidate : 'unknown';
      }
      case 'done': throw new Error('协作已经结束');
    }
    return undefined;
  }
}
