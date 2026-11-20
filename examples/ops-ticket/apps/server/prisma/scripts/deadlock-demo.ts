// 死锁演示：两个事务按相反的顺序锁两张工单；排查谁在等谁；固定加锁顺序后不再死锁
// 运行：pnpm exec tsx prisma/scripts/deadlock-demo.ts（连开发库，自己造数据，结束时清理）
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const a = new pg.Client({ connectionString: url, application_name: 'demo-A' }); // 事务 A
const b = new pg.Client({ connectionString: url, application_name: 'demo-B' }); // 事务 B
const setup = new pg.Client({ connectionString: url, application_name: 'demo-setup' });

async function run(client: pg.Client, sql: string, params: unknown[] = []) {
  try {
    const res = await client.query(sql, params);
    return res.command === 'UPDATE' ? `UPDATE ${res.rowCount}` : res.rows;
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    return `${err.code} ${err.message}${err.detail ? `\n    ${err.detail.replaceAll('\n', '\n    ')}` : ''}`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function timed(client: pg.Client, sql: string) {
  const start = Date.now();
  const result = await run(client, sql);
  return { result, ms: Date.now() - start };
}

const touch = (no: string) => `UPDATE tickets SET version = version + 1 WHERE ticket_no = '${no}'`;

async function prepare() {
  for (const no of ['DL-1', 'DL-2']) {
    await setup.query(
      `INSERT INTO tickets (id,ticket_no,title,description,status,reporter_id,category_id,company_id,department_id)
       SELECT gen_random_uuid(),$1,'派单锁实验',description,'pending_assignment',reporter_id,category_id,company_id,department_id
       FROM tickets WHERE ticket_no='T-001'
       ON CONFLICT (ticket_no) DO UPDATE SET status='pending_assignment', version=0`,
      [no],
    );
  }
}

async function scenario1() {
  console.log('\n== 1 相反的顺序：A 先锁 DL-1 再锁 DL-2，B 先锁 DL-2 再锁 DL-1');
  console.log('deadlock_timeout =', (await run(setup, 'SHOW deadlock_timeout'))[0]);
  await run(a, 'BEGIN');
  await run(b, 'BEGIN');
  console.log('A 锁 DL-1', await run(a, touch('DL-1')));
  console.log('B 锁 DL-2', await run(b, touch('DL-2')));
  // 两边都不 await：各自等对方手里的锁
  const pa = timed(a, touch('DL-2'));
  const pb = timed(b, touch('DL-1'));
  const [ra, rb] = await Promise.all([pa, pb]);
  console.log(`A 锁 DL-2：${ra.result}，用时 ${ra.ms}ms`);
  console.log(`B 锁 DL-1：${rb.result}，用时 ${rb.ms}ms`);
  await run(a, 'ROLLBACK');
  await run(b, 'ROLLBACK');
}

async function scenario2() {
  console.log('\n== 2 排查：B 被 A 挡住时，从 pg_stat_activity 看谁在等谁');
  await run(a, 'BEGIN');
  await run(a, touch('DL-1'));
  await run(b, 'BEGIN');
  const pb = timed(b, touch('DL-1'));
  await sleep(300);
  console.table(
    await run(
      setup,
      `SELECT application_name AS app, pid, pg_blocking_pids(pid) AS blocked_by, state,
              wait_event_type AS wait, left(query, 60) AS query
       FROM pg_stat_activity
       WHERE application_name LIKE 'demo-%' AND application_name <> 'demo-setup'
       ORDER BY application_name`,
    ),
  );
  console.table(
    await run(
      setup,
      `SELECT a.application_name AS app, l.locktype, l.mode, l.granted
       FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE a.application_name IN ('demo-A', 'demo-B') AND l.locktype IN ('transactionid', 'tuple')
       ORDER BY a.application_name, l.granted DESC`,
    ),
  );
  await run(a, 'COMMIT');
  console.log('A 提交后 B', await pb);
  await run(b, 'COMMIT');
}

async function scenario3() {
  console.log('\n== 3 固定顺序：A、B 都先锁 DL-1 再锁 DL-2');
  await run(a, 'BEGIN');
  await run(b, 'BEGIN');
  console.log('A 锁 DL-1', await run(a, touch('DL-1')));
  const pb = (async () => {
    const first = await timed(b, touch('DL-1')); // 在这里排队，还没碰 DL-2
    const second = await timed(b, touch('DL-2'));
    return { first, second };
  })();
  console.log('A 锁 DL-2', await run(a, touch('DL-2')));
  await sleep(500);
  await run(a, 'COMMIT');
  console.log('A 提交');
  const { first, second } = await pb;
  console.log(`B 锁 DL-1：${first.result}，等了 ${first.ms}ms；B 锁 DL-2：${second.result}，用时 ${second.ms}ms`);
  await run(b, 'COMMIT');
}

await Promise.all([a.connect(), b.connect(), setup.connect()]);
try {
  await prepare();
  await scenario1();
  await scenario2();
  await scenario3();
} finally {
  await setup.query(`DELETE FROM tickets WHERE ticket_no LIKE 'DL-%'`);
  await Promise.all([a.end(), b.end(), setup.end()]);
}
