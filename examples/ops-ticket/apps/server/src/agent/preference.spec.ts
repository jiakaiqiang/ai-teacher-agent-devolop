import { describe, expect, it } from 'vitest';
import { expiresOn, isCurrent, preferenceWrite } from './preference.js';

describe('显式交接偏好', () => {
  it('只允许版式和有界期限', () => {
    const value = { layout: 'evidence-first', days: 90, expected: null };
    expect(preferenceWrite.parse(value)).toEqual(value);
    expect(preferenceWrite.safeParse({ ...value, approval: 'approved' }).success).toBe(false);
    expect(preferenceWrite.safeParse({ ...value, days: 91 }).success).toBe(false);
  });

  it('达到到期时刻立即失效', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const end = expiresOn(now, 1);
    expect(end.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(isCurrent(end, new Date(end.getTime() - 1))).toBe(true);
    expect(isCurrent(end, end)).toBe(false);
  });
});
