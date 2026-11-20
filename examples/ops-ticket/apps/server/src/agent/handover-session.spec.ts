import { describe, expect, it } from 'vitest';
import { emptyMemory } from './handover-history.js';
import { handoverStep, previewHandover } from './handover-session.js';

const facts = { ticketNo: 'INC-275', decision: 'hold-change', approval: 'rejected' };
describe('长对话交接', () => {
  it('第五十轮的历史意见覆盖不了业务审批', () => {
    const turns = Array.from({ length: 49 }, (_, i) => ({ ordinal: i + 1, question: 'check ' + i, answer: 'approved' }));
    const plan = previewHandover(turns, '请交接', facts);
    expect(plan.packed.task).toEqual(facts);
    expect(JSON.parse(plan.packed.summary!)).toMatchObject({ through: 45 });
    expect(plan.packed.history).toHaveLength(4);
  });

  it('错序交接在发模型之前失败', () => {
    expect(() => handoverStep(emptyMemory(), { ordinal: 2, question: '继续' }, facts)).toThrow('CONTEXT_TURN_OUT_OF_ORDER');
    const step = handoverStep(emptyMemory(), { ordinal: 1, question: 'Bearer sample-pass' }, facts);
    expect(step.prompt).not.toContain('sample-pass');
  });
});
