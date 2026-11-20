import { receive, selected } from './handoff.js';

const id = '00000000-0000-4000-8000-000000000001';
describe('交接契约', () => {
  it('只允许选择实际存在的证据片段', () => {
    expect(selected(id, ['已见掉线', '仍有丢包'], { index: 1, needCounts: true }))
      .toEqual({ runId: id, quote: '仍有丢包', needCounts: true });
    expect(() => selected(id, ['仅一项'], { index: 1, needCounts: false })).toThrow();
    expect(() => selected(id, ['原文'], { index: 0, needCounts: false, quote: '新文字' })).toThrow();
  });
  it('拒绝跨运行交接', () => {
    const packet = selected(id, ['已见掉线'], { index: 0, needCounts: false });
    expect(receive(id, packet)).toEqual(packet);
    expect(() => receive('00000000-0000-4000-8000-000000000002', packet)).toThrow('运行不一致');
  });
});
