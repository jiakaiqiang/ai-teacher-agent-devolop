import { bridgeCall, bridgeSearch, bridgeUpsert, readBridgeConfig, retrievalBackend } from './bridge.js';
import { space } from './encoding.js';
import { projectViaBridge, revision, type Source } from './projection.js';


const token = 'fixture-bridge-token-not-a-real-secret';
const config = { base: 'http://127.0.0.1:8090', token };
const version = 'a'.repeat(64);
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('Python桥接客户端', () => {
  it('配置只接受回环地址与足够长的令牌', () => {
    expect(readBridgeConfig({ OPS_BRIDGE_TOKEN: token })).toEqual(config);
    for (const env of [{}, { OPS_BRIDGE_TOKEN: 'short' }, { OPS_BRIDGE_TOKEN: token, OPS_BRIDGE_URL: 'http://10.0.0.5:8090' },
      { OPS_BRIDGE_TOKEN: token, OPS_BRIDGE_URL: 'http://127.0.0.1:8090/v1' }, { OPS_BRIDGE_TOKEN: token, OPS_BRIDGE_URL: 'https://127.0.0.1' }]) {
      expect(() => readBridgeConfig(env)).toThrow('BRIDGE_CONFIG');
    }
  });

  it('后端开关只认node与python', () => {
    expect(retrievalBackend({})).toBe('node');
    expect(retrievalBackend({ RETRIEVAL_BACKEND: 'python' })).toBe('python');
    expect(() => retrievalBackend({ RETRIEVAL_BACKEND: 'pyhton' })).toThrow('RETRIEVAL_BACKEND');
  });

  it('请求带服务令牌，失败只保留对方的固定码', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(504, { error: { code: 'EMBED_TIMEOUT' } }))
      .mockResolvedValueOnce(new Response('<html>private</html>', { status: 500 }));
    await expect(bridgeCall('/v1/chunks/search', { query: '甲' }, config, request)).rejects.toThrow(/^BRIDGE_EMBED_TIMEOUT$/);
    await expect(bridgeCall('/v1/chunks/search', { query: '甲' }, config, request)).rejects.toThrow(/^BRIDGE_HTTP_500$/);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8090/v1/chunks/search');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer ' + token);
    expect(init!.redirect).toBe('error');
  });

  it('检索响应按契约解析，向量空间不符即拒绝', async () => {
    const hit = { source_key: 'solution:K1', version, start: 0, end: 4, distance: 0.9 };
    const call = vi.fn().mockResolvedValue({ schema_version: 1, space, candidates: [hit] });
    await expect(bridgeSearch('网络', null, call)).resolves.toEqual([
      { sourceKey: 'solution:K1', version, start: 0, end: 4, distance: 0.9 }]);
    expect(call).toHaveBeenCalledWith('/v1/chunks/search', { query: '网络', group_id: null, limit: 24 });
    call.mockResolvedValue({ schema_version: 1, space: 'other_space', candidates: [hit] });
    await expect(bridgeSearch('网络', null, call)).rejects.toThrow('BRIDGE_CONTRACT');
  });

  it('写入数量与发送行数不一致视为失败', async () => {
    const row = { sourceKey: 'solution:K1', groupId: '12345678-1234-4123-8123-123456789012', version, start: 0, end: 4, text: '更换网线' };
    await expect(bridgeUpsert([row], vi.fn().mockResolvedValue({ written: 1 }))).resolves.toBe(1);
    await expect(bridgeUpsert([row, row], vi.fn().mockResolvedValue({ written: 1 }))).rejects.toThrow('BRIDGE_CONTRACT');
  });

  it('投影在Node端切片与计算版本，按16条分批交给桥接', async () => {
    const source: Source = { key: 'solution:K1', edition:1,audience: '12345678-1234-4123-8123-123456789012', title: '甲', body: '网'.repeat(4000) };
    const upsert = vi.fn().mockImplementation(async (rows: unknown[]) => rows.length);
    const total = await projectViaBridge(source, upsert);
    const batches = upsert.mock.calls.map(([rows]) => rows as { version: string; start: number }[]);
    expect(batches.map(rows => rows.length)).toEqual([16, 4]);
    expect(total).toBe(20);
    expect(batches.flat().every(row => row.version === revision(source))).toBe(true);
    expect(batches[1]![0]!.start).toBe(16 * 200);
  });
});
