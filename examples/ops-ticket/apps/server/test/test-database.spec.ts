import { appendFileSync } from 'node:fs';
import { assertTestDatabase, assertTestRedis, maintenanceDatabaseUrl, testDatabaseUrl, testRedisUrl } from './test-database.js';
import { preflightTestResources, withTestResources } from './test-resources.js';

// 全部是纯校验或 mock，不连接数据库/Redis，不实际执行清理。
const database = `postgresql://probe:probe-credential@localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket?schema=public`;
const env = { DATABASE_URL: database, REDIS_URL: `redis://127.0.0.1:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/0`, QUEUE_REDIS_URL: `redis://127.0.0.1:${process.env.COURSE_TEST_QUEUE_PORT ?? "56380"}/0` };
const report = (data: object) => {
  if (process.env.D36_EVIDENCE_FILE) appendFileSync(process.env.D36_EVIDENCE_FILE, JSON.stringify(data) + '\n');
};

describe('测试资源预检（D36）', () => {
  it('开发库精确映射为测试库，多次调用不改变目标', () => {
    const url = testDatabaseUrl(database);
    expect(new URL(url).pathname).toBe('/ops_ticket_test');
    expect(testDatabaseUrl(url)).toBe(url);
    expect(assertTestDatabase(url)).toBe('ops_ticket_test');
    expect(new URL(url).search).toBe('?schema=public');
  });

  it('精确库名保护：其他项目的 _test 库也必须拒绝', () => {
    expect(() => assertTestDatabase(`postgresql://localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/another_test`)).toThrow('测试只能使用 ops_ticket_test');
    expect(() => assertTestDatabase(database)).toThrow('测试只能使用 ops_ticket_test');
  });

  it.each([
    `postgresql://example.invalid:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket_test`,
    'postgresql://localhost:5432/ops_ticket_test',
    `https://localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket_test`,
    `postgresql://localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket_test?host=example.invalid`,
    `postgresql://localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket_test?schema=public&schema=public`,
    `postgresql://localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket_test#fragment`,
  ])('数据库拒绝错误端点和参数：%s', (url) => {
    expect(() => assertTestDatabase(url)).toThrow();
  });

  it('输入库名、维护连接和错误输出都保留保护', () => {
    expect(() => testDatabaseUrl(`postgresql://localhost:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/another`)).toThrow();
    expect(() => testDatabaseUrl(undefined)).toThrow();
    expect(() => maintenanceDatabaseUrl(database)).toThrow();
    expect(new URL(maintenanceDatabaseUrl(testDatabaseUrl(database))).pathname).toBe('/postgres');
    try {
      testDatabaseUrl(`postgresql://probe:probe-credential@example.invalid:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket`);
      throw new Error('应当拒绝');
    } catch (error) {
      expect(String(error)).not.toContain('probe-credential');
      expect(String(error)).not.toContain('postgresql://');
    }
    expect(() => testDatabaseUrl('bad-url')).toThrow('URL 格式无效');
  });

  it('两种 Redis 分别映射到 1 号库，允许 loopback IPv6', () => {
    expect(testRedisUrl(env.REDIS_URL)).toBe(`redis://127.0.0.1:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/1`);
    expect(testRedisUrl(env.QUEUE_REDIS_URL, 'queue')).toBe(`redis://127.0.0.1:${process.env.COURSE_TEST_QUEUE_PORT ?? "56380"}/1`);
    assertTestRedis(`redis://[::1]:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/1`);
    assertTestDatabase(`postgresql://[::1]:${process.env.COURSE_TEST_DB_PORT ?? "55433"}/ops_ticket_test`);
  });

  it('Redis 0 号库保护：清理断言必须拒绝开发库', () => {
    expect(() => assertTestRedis(`redis://127.0.0.1:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/0`)).toThrow('测试只能使用 1 号库');
    expect(() => assertTestRedis(`redis://127.0.0.1:${process.env.COURSE_TEST_QUEUE_PORT ?? "56380"}/0`, 'queue')).toThrow('测试只能使用 1 号库');
  });

  it.each([
    [`redis://example.invalid:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/1`, 'cache'],
    [`redis://localhost:${process.env.COURSE_TEST_QUEUE_PORT ?? "56380"}/1`, 'cache'],
    [`redis://localhost:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/1`, 'queue'],
    [`redis://localhost:${process.env.COURSE_TEST_QUEUE_PORT ?? "56380"}/1?db=0`, 'queue'],
    [`rediss://localhost:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/1`, 'cache'],
  ] as const)('Redis 拒绝错误端点和参数：%s', (url, kind) => {
    expect(() => assertTestRedis(url, kind)).toThrow();
  });

  it('Redis 输入只能是 0 或 1，异常消息不带连接凭据', () => {
    expect(() => testRedisUrl(`redis://localhost:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/2`)).toThrow();
    expect(() => testRedisUrl(undefined)).toThrow();
    expect(() => assertTestRedis(`redis://probe:probe-credential@localhost:${process.env.COURSE_TEST_CACHE_PORT ?? "56379"}/0`)).toThrow('测试只能使用 1 号库');
  });

  it('坏队列配置时所有重置动作都是零次', async () => {
    const reset = vi.fn(async () => {});
    await expect(withTestResources({ ...env, QUEUE_REDIS_URL: `redis://example.invalid:${process.env.COURSE_TEST_QUEUE_PORT ?? "56380"}/0` }, reset)).rejects.toThrow();
    expect(reset).not.toHaveBeenCalled();
    report({ case: 'preflight-reject', resetCalls: reset.mock.calls.length, connected: false });
  });

  it('全部预检通过以后，回调拿到精确的测试目标', async () => {
    const resources = preflightTestResources(env);
    const reset = vi.fn(async () => {});
    await withTestResources(env, reset);
    expect(reset).toHaveBeenCalledExactlyOnceWith(resources);
    report({ case: 'preflight-pass', database: resources.databaseName, redisDatabases: [1, 1], resetCalls: reset.mock.calls.length, connected: false });
  });
});
