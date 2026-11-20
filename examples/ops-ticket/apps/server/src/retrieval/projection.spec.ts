import { project, revision, type Source } from './projection.js';
const source: Source = { key: 'manual:demo', audience:'a', edition:1, title: 'VPN', body: '重新绑定动态口令' };
describe('文档投影', () => {
  it('组别变化产生新版本', () => {
    expect(revision(source)).not.toBe(revision({ ...source, audience:'b' }));
  });
  it('重试同一来源复用相同主键', async () => {
    const embed = vi.fn().mockResolvedValue([[1]]);
    const send = vi.fn().mockResolvedValue({});
    await project(source, embed, send);
    await project(source, embed, send);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[0]?.[0]).toBe('entities/upsert');
    expect(send.mock.calls[0]?.[1]).toMatchObject({ data: [{ sourceKey: source.key, start: 0, end: 8 }] });
  });
  it('正文修改后旧版本仍可识别', () => {
    expect(revision(source)).not.toBe(revision({ ...source, body: '更新口令' }));
    expect(revision({ ...source })).toBe(revision(source));
  });
});
