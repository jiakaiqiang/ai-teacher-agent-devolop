import { chunks, encode, model } from './encoding.js';

describe('中文切片和编码', () => {
  it('按码点保留重叠并停止在末尾', () => {
    expect(chunks('甲😀乙丙丁', 3, 1)).toEqual([
      { start: 0, end: 3, text: '甲😀乙' }, { start: 2, end: 5, text: '乙丙丁' },
    ]);
    expect(chunks('  ')).toEqual([]);
    expect(() => chunks('甲', 2, 2)).toThrow('CHUNK_WINDOW');
  });
  it('拒绝向量行数与文本数不一致', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ model, embeddings: [] }));
    await expect(encode(['已修复'], 'passage', request)).rejects.toThrow('EMBED_CARDINALITY');
  });
  it('仅查询带任务指令且禁用静默截断', async () => {
    const vector = Array<number>(1024).fill(1);
    const request = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ model, embeddings: [vector] })));
    await encode(['重置口令'], 'query', request);
    await encode(['已重置口令'], 'passage', request);
    expect(request.mock.calls[0]?.[1].body).toContain('Instruct:');
    expect(JSON.parse(request.mock.calls[1]?.[1].body as string)).toEqual({ model, input: ['已重置口令'], truncate: false });
  });
});
