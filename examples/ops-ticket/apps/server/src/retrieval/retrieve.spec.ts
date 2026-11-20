import { revision, type Source } from './projection.js';
import { scalarFilter, verifyCandidate } from './retrieve.js';
const groupId = '12345678-1234-4123-8123-123456789012';
const src: Source = { key:'solution:test', edition:1, audience:groupId, title: '恢复', body: '更换网线' };
const hit = { sourceKey: src.key, version: revision(src), start: 0, end: 4, distance: 0.7 };
describe('引用复核', () => {
  it('无班组无跨组许可时拒绝搜索', () => {
    expect(scalarFilter(groupId)).toContain('shared');
    expect(() => scalarFilter('')).toThrow();
  });
  it('版本变化丢弃旧片段', () => {
    expect(verifyCandidate(hit, { ...src, body: '网线更新' }, groupId)).toBeNull();
  });
  it('只有当前可见的精确窗口可以成为引用', () => {
    expect(verifyCandidate(hit, src, groupId)).toMatchObject({ quote: '更换网线' });
    expect(verifyCandidate(hit, null, groupId)).toBeNull();
    expect(verifyCandidate(hit, src, 'other')).toBeNull();
    expect(verifyCandidate({ ...hit, end: 3 }, src, groupId)).toBeNull();
  });
});
