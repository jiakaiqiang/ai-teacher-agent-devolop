import { describe, expect, it } from 'vitest';
import { countTokens, packHandover, type HandoverInput } from './handover-budget.js';

const base: HandoverInput = { policy: 'Use only ticket evidence.', task: { ticketNo: 'T-7', decision: 'hold', approval: 'waiting' },
  question: '当前进展？', history: [], documents: [], results: [] };

describe('输入和输出共享模型窗口', () => {
  it('必需块差一个 token 也不能挤占输出', () => {
    const exact = packHandover(base).guardTokens;
    expect(packHandover(base, exact + 16, 16).guardTokens).toBe(exact);
    expect(() => packHandover(base, exact + 15, 16)).toThrow('CONTEXT_REQUIRED_TOO_LARGE');
    expect(countTokens('Hello world!')).toBe(4);
  });

  it('可选块按字节上界裁剪且独立报告分词数', () => {
    const history = ['steady '.repeat(40)];
    const baseCost = packHandover(base).guardTokens;
    const plan = packHandover({ ...base, history }, baseCost + 30, 16);
    expect(plan.packed.history).toEqual([]);
    expect(plan.guardTokens).toBeGreaterThan(plan.inputTokens);
    expect(plan.guardTokens + plan.output).toBeLessThanOrEqual(baseCost + 30);
  });

  it('按区块限制历史同时保持最近轮次', () => {
    const history = Array.from({ length: 50 }, (_, i) => 'round ' + i + ' ' + 'disk check '.repeat(10));
    const result = packHandover({ ...base, history });
    expect(result.packed.history.length).toBeLessThan(history.length);
    expect(result.packed.history.at(-1)).toBe(history.at(-1));
    expect(result.packed.task.ticketNo).toBe('T-7');
  });
});
