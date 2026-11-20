import { bridgeSearch,retrievalBackend } from './bridge.js';
import { z } from 'zod';

import type { PrismaService } from '../prisma/prisma.service.js';
import { chunks, encode } from './encoding.js';
import { collection, entrySource, revision, type Source } from './projection.js';
import { milvus } from './vector-index.js';

const candidate = z.object({ sourceKey: z.string(), version: z.string(), start: z.number().int().nonnegative(),
  end: z.number().int().positive(), distance: z.number().finite() });
type Candidate = z.infer<typeof candidate>;
export type Citation = { sourceKey: string; title: string; version: string; start: number; end: number; quote: string; score: number };
export function scalarFilter(companyId:string):string {
  return 'audience in ["shared",'+JSON.stringify(z.uuid().parse(companyId))+']';
}

export function verifyCandidate(hit: Candidate, source: Source | null, companyId: string): Citation | null {
  if (!source || hit.sourceKey !== source.key || (source.audience !== 'shared' && source.audience !== companyId)) return null;
  if (hit.version !== revision(source)) return null;
  const part = chunks(source.body).find(p => p.start === hit.start && p.end === hit.end);
  if (!part) return null;
  return { sourceKey: source.key, title: source.title, version: hit.version,
    start: part.start, end: part.end, quote: part.text, score: hit.distance };
}

async function readSource(db: PrismaService, key: string, companyId: string) {
  const [kind,id] = key.split(':');
  if (!['manual','solution'].includes(kind ?? '') || !z.uuid().safeParse(id).success) return null;
  const row = await db.knowledgeEntry.findFirst({where:{id,kind,state:'published',OR:[{companyId:null},{companyId}]}});
  return row && entrySource(row);
}

async function nodeSearch(query:string,companyId:string) {
  const filter=scalarFilter(companyId);
  const vectors = await encode([Array.from(query).slice(0, 2048).join('')], 'query');
  return milvus('entities/search', { collectionName: collection,
    annsField: 'vector', data: vectors, limit: 24, filter, outputFields: ['sourceKey','version','start','end'] });
}

export async function retrieve(db: PrismaService, query: string, companyId: string, exclude: string, search: (query:string,companyId:string)=>Promise<unknown> = retrievalBackend()==="python" ? bridgeSearch : nodeSearch) {
  const filter = scalarFilter(companyId);
  if (filter === null || !query.trim()) return [];
  const text=Array.from(query).slice(0,2048).join('');
  const hits=z.array(candidate).parse(await search(text,companyId));
  const sources = new Map<string, Source | null>();
  const citations: Citation[] = [];
  for (const hit of hits) {
    if (hit.sourceKey === exclude || citations.some(c => c.sourceKey === hit.sourceKey)) continue;
    if (!sources.has(hit.sourceKey)) sources.set(hit.sourceKey, await readSource(db, hit.sourceKey, companyId));
    const citation = verifyCandidate(hit, sources.get(hit.sourceKey) ?? null, companyId);
    if (citation) citations.push(citation);
    if (citations.length === 3) break;
  }
  return citations;
}
