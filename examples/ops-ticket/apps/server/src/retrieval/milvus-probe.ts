import { z } from 'zod';
import { pathToFileURL } from 'node:url';

const collectionList = z.object({ code: z.literal(0), data: z.array(z.string()) });

// 两个请求共享截止时间。业务接口返回成功后才报告集合数。
export async function probeMilvus(request: typeof fetch = fetch) {
  const signal = AbortSignal.timeout(5000);
  const health = await request('http://127.0.0.1:19091/healthz', { signal, redirect: 'error' });
  await health.body?.cancel();
  if (!health.ok) throw new Error('MILVUS_HEALTH_FAILED');
  const response = await request('http://127.0.0.1:19531/v2/vectordb/collections/list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dbName: 'default' }), signal, redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('MILVUS_HTTP_FAILED');
  }
  const result = collectionList.safeParse(await response.json());
  if (!result.success) throw new Error('MILVUS_LIST_FAILED');
  return { database: 'default', collections: result.data.data.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await probeMilvus()));
}
