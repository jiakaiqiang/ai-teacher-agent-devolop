import { z } from 'zod';
import { pathToFileURL } from 'node:url';

// 只供验证工程的本机 Milvus REST v2 使用。
export async function milvus(path: string, body: Record<string, unknown>) {
  const response = await fetch('http://127.0.0.1:19531/v2/vectordb/' + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('MILVUS_HTTP_' + response.status);
  }
  const reply = z.object({ code: z.number(), data: z.unknown() }).parse(await response.json());
  if (reply.code !== 0) throw new Error('MILVUS_CODE_' + reply.code);
  return reply.data;
}

export function checkVector(vector: number[], dimension: number) {
  if (vector.length !== dimension) throw new Error('VECTOR_DIMENSION');
  if (!vector.every(Number.isFinite) || !vector.some(value => value !== 0)) {
    throw new Error('VECTOR_DIRECTION');
  }
  return vector;
}

export function collectionSchema(collectionName: string, dimension: number) {
  return {
    collectionName,
    schema: { autoId: false, enableDynamicField: true, fields: [
      { fieldName: 'id', dataType: 'VarChar', isPrimary: true, elementTypeParams: { max_length: '256' } },
      { fieldName: 'vector', dataType: 'FloatVector', elementTypeParams: { dim: String(dimension) } },
    ] },
    indexParams: [{ fieldName: 'vector', indexName: 'vector_cosine', metricType: 'COSINE', indexType: 'FLAT' }],
    params: { consistencyLevel: 'Strong' },
  };
}

export async function ensureIndex(collectionName: string, dimension: number) {
  const state = z.object({ has: z.boolean() }).parse(await milvus('collections/has', { collectionName }));
  if (!state.has) await milvus('collections/create', collectionSchema(collectionName, dimension));
  await milvus('collections/load', { collectionName });
}

export async function vectorDemo() {
  const collectionName = 'verify_d72_angles_v1';
  await ensureIndex(collectionName, 2);
  const data = [['east', [1, 0]], ['diagonal', [1, 1]], ['north', [0, 1]]] as const;
  await milvus('entities/upsert', { collectionName, data: data.map(([id, vector]) => ({ id, vector: checkVector([...vector], 2) })) });
  const result = await milvus('entities/search', { collectionName, data: [[1, 0]], limit: 3, annsField: 'vector' });
  const hits = z.array(z.object({ id: z.string(), distance: z.number() })).parse(result);
  if (hits.map(hit => hit.id).join(',') !== 'east,diagonal,north') throw new Error('RANK_MISMATCH');
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await vectorDemo()));
}
