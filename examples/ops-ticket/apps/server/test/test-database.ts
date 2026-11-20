export type TestRedisKind = 'cache' | 'queue';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const REDIS_PORT = { cache:process.env.COURSE_TEST_CACHE_PORT ?? '56379', queue:process.env.COURSE_TEST_QUEUE_PORT ?? '56380' } as const;

// 错误信息不带原始 URL，避免把连接凭据带入日志。
function localUrl(value: string | undefined, protocols: string[], port: string): URL {
  if (!value) throw new Error('缺少测试资源连接配置');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('测试资源 URL 格式无效');
  }
  if (!protocols.includes(url.protocol) || !LOOPBACK.has(url.hostname) || url.port !== port || url.hash) {
    throw new Error('拒绝操作测试资源：协议、主机或端口不在本机白名单');
  }
  return url;
}

function databaseUrl(value: string | undefined): URL {
  const url = localUrl(value, ['postgresql:', 'postgres:'], process.env.COURSE_TEST_DB_PORT ?? '55433');
  const entries = [...url.searchParams];
  // 防止 host/port 等连接参数绕过主机检查；只保留现有 schema=public。
  if (entries.some(([key, val]) => key !== 'schema' || val !== 'public') || entries.length > 1) {
    throw new Error('拒绝操作数据库：不允许额外连接参数');
  }
  return url;
}

function redisUrl(value: string | undefined, kind: TestRedisKind): URL {
  const url = localUrl(value, ['redis:'], REDIS_PORT[kind]);
  if (url.search) throw new Error('拒绝操作 Redis：不允许额外连接参数');
  return url;
}

// 只从这套工程的开发库映射到精确测试库；多次调用结果不变。
export function testDatabaseUrl(devUrl: string | undefined): string {
  const url = databaseUrl(devUrl);
  if (!['/ops_ticket', '/ops_ticket_test'].includes(url.pathname)) {
    throw new Error('拒绝操作数据库：输入必须是本工程的开发库或测试库');
  }
  url.pathname = '/ops_ticket_test';
  return url.toString();
}

// 清理断言必须精确匹配，其他项目的 *_test 也不在授权范围。
export function assertTestDatabase(value: string): string {
  const url = databaseUrl(value);
  if (url.pathname !== '/ops_ticket_test') {
    throw new Error('拒绝操作数据库：测试只能使用 ops_ticket_test');
  }
  return 'ops_ticket_test';
}

export function testRedisUrl(devUrl: string | undefined, kind: TestRedisKind = 'cache'): string {
  const url = redisUrl(devUrl, kind);
  if (!['/0', '/1'].includes(url.pathname)) {
    throw new Error('拒绝操作 Redis：输入必须是本工程的 0 或 1 号库');
  }
  url.pathname = '/1';
  return url.toString();
}

// 缓存与队列分别检查端口；任何清理入口都只能接收 1 号库。
export function assertTestRedis(value: string, kind: TestRedisKind = 'cache'): void {
  const url = redisUrl(value, kind);
  if (url.pathname !== '/1') {
    throw new Error('拒绝清空 Redis：测试只能使用 1 号库');
  }
}

// 先确认目标测试库，再生成用于建库/重建的 postgres 维护连接。
export function maintenanceDatabaseUrl(value: string): string {
  assertTestDatabase(value);
  const maintenance = new URL(value);
  maintenance.pathname = '/postgres';
  return maintenance.toString();
}
