import assert from 'node:assert/strict';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { CacheService } from '../../src/redis/cache.service.js';
import { WorklistStats } from '../../src/tickets/worklist-stats.js';
const db=new PrismaService(), redis=new RedisService();
try {
  await redis.onModuleInit();
  const api=new WorklistStats(db,new CacheService(redis));
  const lin=await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const wu=await db.user.findUniqueOrThrow({where:{username:'wu'}});
  assert.equal(await api.count(lin.id),1);
  assert.equal(await api.count(wu.id),1);
  const keys=await redis.keys('ops:worklist:*');
  assert.ok(keys.some(k=>k.includes(lin.id)) && keys.some(k=>k.includes(wu.id)));
  const key='worklist:'+JSON.stringify({companyId:lin.companyId,reporterId:lin.id});
  assert.equal(await redis.exists(key),1);
  await redis.del(key);
  assert.equal(await api.count(lin.id),1);
  console.log('甲乙的统计值分别写入独立范围键');
} finally { await db.$disconnect(); await redis.quit(); }
