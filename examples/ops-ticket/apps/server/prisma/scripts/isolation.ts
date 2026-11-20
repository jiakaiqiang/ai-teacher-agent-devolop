import assert from 'node:assert/strict';
import pg from 'pg';

async function observe(level: 'READ COMMITTED' | 'REPEATABLE READ') {
  const reader = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const writer = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([reader.connect(), writer.connect()]);
  const table = 'isolation_lab_' + process.pid;
  try {
    await writer.query(`CREATE TABLE ${table}(ticket_no text PRIMARY KEY, status text NOT NULL)`);
    await writer.query(`INSERT INTO ${table} VALUES ('T-LAB', 'pending_assignment')`);
    await reader.query('BEGIN ISOLATION LEVEL ' + level);
    const read = async () => (await reader.query(`SELECT status FROM ${table} WHERE ticket_no='T-LAB'`)).rows[0].status;
    const first = await read();
    await writer.query(`UPDATE ${table} SET status='human_processing' WHERE ticket_no='T-LAB'`);
    const second = await read();
    assert.equal(first, 'pending_assignment');
    assert.equal(second, level === 'READ COMMITTED' ? 'human_processing' : 'pending_assignment');
    console.log(level, first, second);
  } finally {
    await reader.query('ROLLBACK');
    await writer.query(`DROP TABLE IF EXISTS ${table}`);
    await Promise.all([reader.end(),writer.end()]);
  }
}
await observe('READ COMMITTED');
await observe('REPEATABLE READ');
