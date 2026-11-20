import { describe, expect, it } from 'vitest';
import { advance, emptyMemory, historyBlocks } from './handover-history.js';

describe('滚动交接记录', () => {
  it('五十轮后保留最近四轮和连续摘要水位', () => {
    let memory = emptyMemory();
    for (let ordinal = 1; ordinal <= 50; ordinal++) memory = advance(memory, { ordinal, question: '巡检' + ordinal, answer: '记录' });
    expect(memory.recent.map(row => row.ordinal)).toEqual([47, 48, 49, 50]);
    expect(JSON.parse(historyBlocks(memory).summary)).toEqual({ through: 46, lastQuestion: '巡检46' });
  });

  it('重复和跳号都不能推进交接水位', () => {
    const first = { ordinal: 1, question: '审批通过了吗', answer: '文字称通过' };
    const saved = advance(emptyMemory(), first);
    expect(() => advance(saved, first)).toThrow('CONTEXT_TURN_OUT_OF_ORDER');
    expect(() => advance(saved, { ...first, ordinal: 3 })).toThrow('CONTEXT_TURN_OUT_OF_ORDER');
    expect(saved.through).toBe(1);
  });
});
