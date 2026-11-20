import { describe, expect, it } from 'vitest';
import { presentHandover } from './handover-layout.js';
const facts = { ticketNo: 'T-21', decision: 'reassign alice', approval: 'rejected' };

describe('交接时解析版式', () => {
  it('本次选择覆盖记忆且保留事实', () => {
    const view = presentHandover(facts, 'evidence-first', 'summary-first');
    expect(view.source).toBe('request');
    expect(view.sections.map(s => s.section)).toEqual(['summary', 'evidence']);
    expect(view.sections[1]?.text).toBe('rejected');
  });

  it('没有有效记忆时稳定回到默认', () => {
    expect(presentHandover(facts, 'legacy-value').source).toBe('default');
    expect(presentHandover(facts).layout).toBe('summary-first');
    expect(presentHandover(facts, 'evidence-first').sections[0]?.section).toBe('evidence');
  });
});
