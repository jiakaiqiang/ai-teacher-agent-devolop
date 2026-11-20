import { upstream } from './upstream.js';

const run = '00000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());

describe('工单接口适配', () => {
  it('提交单槽调用并返回业务数据', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ ok: true, data: { count: 0 } }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await upstream('http://127.0.0.1:3199', run, 'Bearer sample')('ticket_summary', {})).toEqual({ count: 0 });
    const options = fetcher.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ calls: [{ name: 'ticket_summary', version: 1, args: {} }] });
    expect(options.headers.authorization).toBe('Bearer sample');
  });

  it('保留业务层拒绝码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ ok: false, code: 'TOOL_FORBIDDEN' }] })));
    await expect(upstream('http://127.0.0.1:3199', run, 'Bearer sample')('ticket_summary', {}))
      .rejects.toMatchObject({ code: 'TOOL_FORBIDDEN' });
  });
});
