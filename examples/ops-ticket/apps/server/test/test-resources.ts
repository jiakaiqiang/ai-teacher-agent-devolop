import { assertTestDatabase, assertTestRedis, maintenanceDatabaseUrl, testDatabaseUrl, testRedisUrl } from './test-database.js';

interface TestEnvironment {
  DATABASE_URL?: string;
  REDIS_URL?: string;
  QUEUE_REDIS_URL?: string;
}

export function preflightTestResources(env: TestEnvironment) {
  const database = testDatabaseUrl(env.DATABASE_URL);
  const databaseName = assertTestDatabase(database);
  const cacheRedis = testRedisUrl(env.REDIS_URL, 'cache');
  const queueRedis = testRedisUrl(env.QUEUE_REDIS_URL, 'queue');
  assertTestRedis(cacheRedis, 'cache');
  assertTestRedis(queueRedis, 'queue');
  return { database, databaseName, maintenance: maintenanceDatabaseUrl(database), cacheRedis, queueRedis };
}

export type TestResources = ReturnType<typeof preflightTestResources>;

// 所有资源预检成功后，才允许调用含重置动作的回调。
export async function withTestResources(env: TestEnvironment, reset: (resources: TestResources) => Promise<void>) {
  const resources = preflightTestResources(env);
  await reset(resources);
}
