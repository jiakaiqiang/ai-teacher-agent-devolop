export interface TicketFacts { ticketNo: string; decision: string; approval: string }
export type HandoverEvent = { ordinal: number; question: string; answer: string };
export interface Memory {
  through: number;
  archived: number;
  lastArchived: string;
  recent: HandoverEvent[];
}
export const emptyMemory = (): Memory => ({ through: 0, archived: 0, lastArchived: '', recent: [] });

// 只把问答记作历史。决定与审批来自调用方持有的业务快照，不从模型文本提取。
export function advance(memory: Memory, turn: HandoverEvent): Memory {
  if (turn.ordinal !== memory.through + 1) throw new Error('CONTEXT_TURN_OUT_OF_ORDER');
  const recent = [...memory.recent, { ...turn }];
  const old = recent.length > 4 ? recent.shift() : undefined;
  return { through: turn.ordinal, recent, archived: memory.archived + Number(Boolean(old)),
    lastArchived: old ? Array.from(old.question).slice(0, 48).join('') : memory.lastArchived };
}

export function historyBlocks(memory: Memory) {
  return { history: memory.recent.map(row => JSON.stringify([row.ordinal, row.question, row.answer])),
    summary: memory.archived ? JSON.stringify({ through: memory.archived, lastQuestion: memory.lastArchived }) : '' };
}
