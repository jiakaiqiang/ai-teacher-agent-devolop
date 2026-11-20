import { probeMilvus } from './milvus-probe.js';

describe('本机 Milvus 就绪探针', () => {
  it('健康失败时不进入数据接口', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(probeMilvus(request)).rejects.toThrow('MILVUS_HEALTH_FAILED');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('拒绝 HTTP 成功中的业务错误码', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response())
      .mockResolvedValueOnce(Response.json({ code: 100, data: [] }));
    await expect(probeMilvus(request)).rejects.toThrow('MILVUS_LIST_FAILED');
  });
  it('空库也能完成只读检查', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response())
      .mockResolvedValueOnce(Response.json({ code: 0, data: [] }));
    expect(await probeMilvus(request)).toEqual({ database: 'default', collections: 0 });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"dbName":"default"}' });
  });
});
