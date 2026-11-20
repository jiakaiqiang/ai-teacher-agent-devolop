// 接口测试开始前执行一次：删除并重建测试库，执行全部迁移，放入种子数据
// 这样每次测试都从同一份已知的数据开始，不受开发库里的批量数据和手工改动影响
import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';
import {
  assertTestDatabase,
  maintenanceDatabaseUrl,
  testDatabaseUrl,
} from './test-database.js';

export default async function setup() {
  const testUrl = testDatabaseUrl(process.env.DATABASE_URL);
  const testDbName = assertTestDatabase(testUrl);
  if (!/^[A-Za-z0-9_]+$/.test(testDbName)) throw new Error("测试库名包含无效字符");

  const admin = new pg.Client({ connectionString: maintenanceDatabaseUrl(testUrl) });
  await admin.connect();
  try {
    // WITH (FORCE) 会断开还连着测试库的会话，例如上次测试异常退出留下的连接
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end();
  }

  // 用测试库的连接串执行迁移和种子
  const env = { ...process.env, DATABASE_URL: testUrl };
  execSync('pnpm exec prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('pnpm exec prisma db seed', { env, stdio: 'pipe' });
}
