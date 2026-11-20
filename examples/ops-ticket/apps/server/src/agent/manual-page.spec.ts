import { describe, expect, it } from 'vitest';
import { manualForModel, manualPage } from './manual-page.js';

describe('手册按引用读取', () => {
  it('两页拼回脱敏正文且不切断表情', () => {
    const text = '盘'.repeat(239) + '📦结束';
    const first = manualPage('m', text);
    expect(first.next).toBe(240);
    const second = manualPage('m', text, first.next!, first.revision);
    expect(second.next).toBeNull();
    expect(first.quote.text + second.quote.text).toBe(text);
  });

  it('长手册只发引用而短手册仍给出原句', () => {
    const page = (body: string) => ({ title: { text: '手册', clipped: false }, ...manualPage('m', body) });
    const long = page('磁'.repeat(241));
    expect(manualForModel(long)).toEqual({ sourceKey: 'manual:m', revision: long.revision, title: long.title, offset: 0 });
    expect(manualForModel(page('磁'.repeat(240)))).toHaveProperty('quote.text', '磁'.repeat(240));
  });

  it('过期版本与越界游标分别拒绝', () => {
    const ref = manualPage('m', '旧文');
    expect(() => manualPage('m', '新文', 0, ref.revision)).toThrow('MANUAL_VERSION_CHANGED');
    expect(() => manualPage('m', '旧文', 3, ref.revision)).toThrow('MANUAL_OFFSET_INVALID');
  });
});
