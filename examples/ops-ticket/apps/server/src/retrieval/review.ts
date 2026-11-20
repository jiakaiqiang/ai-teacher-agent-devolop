import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { collectionSchema, milvus } from './vector-index.js';

export function assess(top: string[], expected: string, allowed: ReadonlySet<string>) {
  const pos = top.indexOf(expected);
  return { firstRelevantRank: pos < 0 ? null : pos + 1, reciprocalRank: pos < 0 ? 0 : 1 / (1 + pos),
    outOfScope: top.filter(key => !allowed.has(key)) };
}

// 同一度量和测试集，在小规模教学数据上比较三个索引的实际排名。
export async function compareIndexes() {
  const result: Record<string, { indexType: string; metric: string; ranking: string[] }> = {};
  for (const indexType of ['FLAT', 'HNSW', 'IVF_FLAT']) {
    const collectionName = 'verify_d77_' + indexType.toLowerCase();
    const schema = collectionSchema(collectionName, 2);
    const params = indexType === 'HNSW' ? { M: '8', efConstruction: '32' } : indexType === 'IVF_FLAT' ? { nlist: '1' } : {};
    const has = z.object({ has: z.boolean() }).parse(await milvus('collections/has', { collectionName }));
    if (!has.has) await milvus('collections/create', { ...schema,
      indexParams: [{ ...schema.indexParams[0], indexType, params }] });
    await milvus('collections/load', { collectionName });
    const data = [{ id: 'east', vector: [1, 0] }, { id: 'diagonal', vector: [1, 1] }, { id: 'north', vector: [0, 1] }];
    await milvus('entities/upsert', { collectionName, data });
    const rows = z.array(z.object({ id: z.string() })).parse(await milvus('entities/search', { collectionName,
      data: [[1, 0]], annsField: 'vector', limit: 3 }));
    const info = z.array(z.object({ indexType: z.string(), metricType: z.string() })).nonempty()
      .parse(await milvus('indexes/describe', { collectionName, indexName: 'vector_cosine' }))[0]!;
    if (info.indexType !== indexType || info.metricType !== 'COSINE') throw new Error('INDEX_CONFIG_MISMATCH');
    result[indexType] = { indexType: info.indexType, metric: info.metricType, ranking: rows.map(r => r.id) };
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ranks = await compareIndexes();
  console.log(JSON.stringify(ranks));
}
