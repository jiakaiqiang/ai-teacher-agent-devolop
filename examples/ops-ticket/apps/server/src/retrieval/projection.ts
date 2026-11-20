import { retrievalBackend, bridgeUpsert } from './bridge.js';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { PrismaService } from '../prisma/prisma.service.js';
import { chunks, dimension, encode, space } from './encoding.js';
import { ensureIndex, milvus } from './vector-index.js';

export const collection = 'service_knowledge_' + space;
export type Source = { key:string; audience:string; title:string; body:string; edition:number };
export function entrySource(entry:{id:string;companyId:string|null;kind:string;version:number;title:string;body:string}):Source {
  return {key:entry.kind+':'+entry.id,audience:entry.companyId ?? 'shared',edition:entry.version,title:entry.title,body:entry.body};
}
export function revision(source: Source) {
  return createHash('sha256').update(JSON.stringify([space, source.key, source.audience, source.title, source.body, source.edition])).digest('hex');
}

// 不把正文复制进 Milvus。以内容版本隔离迟到的旧写入，读侧核对权威记录。
export async function project(source: Source, embed = encode, send = milvus) {
  const version = revision(source);
  const parts = chunks(source.body);
  for (let i = 0; i < parts.length; i += 16) {
    const batch = parts.slice(i, i + 16);
    const vectors = await embed(batch.map(p => p.text), 'passage');
    const data = batch.map((p, j) => ({ id: [source.key, version, p.start].join('/'),
      sourceKey: source.key, audience: source.audience, version, start: p.start, end: p.end, vector: vectors[j] }));
    await send('entities/upsert', { collectionName: collection, data });
  }
  return parts.length;
}

export async function projectViaBridge(source: Source, upsert = bridgeUpsert) {
  const version = revision(source);
  const parts = chunks(source.body);
  for (let i = 0; i < parts.length; i += 16) {
    await upsert(parts.slice(i, i + 16).map(p => ({ sourceKey: source.key, groupId: source.audience, version,
      start: p.start, end: p.end, text: p.text })));
  }
  return parts.length;
}

export async function syncCatalogue(db: PrismaService, backend=retrievalBackend()) {
  if (backend === "node") await ensureIndex(collection, dimension);
  let count = 0;
  let lastId: string | undefined;
  for (;;) {
    const rows = await db.knowledgeEntry.findMany({where:{state:'published',id:{gt:lastId}},orderBy:{id:'asc'},take:32});
    if (!rows.length) break;
    for (const row of rows) count += await (backend==="node" ? project : projectViaBridge)(entrySource(row));
    lastId = rows.at(-1)!.id;
  }
  return { collection, chunksWritten: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/ops_ticket_test') throw new Error('TEST_DATABASE_REQUIRED');
  const { PrismaService: Database } = await import('../prisma/prisma.service.js');
  const db = new Database();
  try { console.log(JSON.stringify(await syncCatalogue(db))); } finally { await db.$disconnect(); }
}
