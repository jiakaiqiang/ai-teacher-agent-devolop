import { pageOf, shortText } from './ticket-tool-read.js';
describe('工具结果边界', () => {
  it('先脱敏再裁剪且保留完整字符', () => {
    expect(shortText('门🙂13800000001归档', 6)).toEqual({ text: '门🙂138*', clipped: true });
    expect(shortText('磁盘🙂', 3)).toEqual({ text: '磁盘🙂', clipped: false });
  });
  it('用多读的一条判断是否还有下一页', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(pageOf(rows, 2)).toEqual({ items: rows.slice(0, 2), next: 'b' });
    expect(pageOf(rows.slice(0, 2), 2).next).toBeNull();
    expect(pageOf([], 2)).toEqual({ items: [], next: null });
  });
});
