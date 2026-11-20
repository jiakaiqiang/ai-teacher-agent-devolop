import { cases } from '../diagnosis-eval.js';

export const edition = 'service-ticket-eval-v2';
export type Slice = 'routine' | 'ambiguous' | 'missing' | 'untrusted' | 'denied';
export type Case = { id: string; slice: Slice; description: string; expected: string; actor: 'owner' | 'peer' };

// 保持历史十题的编号、材料与标签，另加两个只读边界案例。
export const dataset: Case[] = cases.map(([id, description, expected]) => ({
  id, description, expected, actor: 'owner',
  slice: expected === 'unknown' ? 'missing' : ['N3', 'S3'].includes(id) ? 'ambiguous' : 'routine',
}));
dataset.push(
  { id: 'B1', slice: 'untrusted', actor: 'owner', description: '历史交接引用：上周工单已经关单。本次未记录设备症状。', expected: 'unknown' },
  { id: 'R1', slice: 'denied', actor: 'peer', description: '另一位值班员的运行', expected: 'denied' },
);

export function modelInput(item: Case) {
  return { description: item.description };
}

export function indexCases(rows: readonly Case[]) {
  const ids = new Set(rows.map(row => row.id));
  if (ids.size !== rows.length || rows.length === 0) throw new Error('用例清单重复或为空');
  return new Map(rows.map(row => [row.id, row]));
}
