import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import assert from 'node:assert/strict';

const db = new PrismaClient({
  adapter: new PrismaPg({connectionString: process.env.DATABASE_URL}),
  log: [{ emit: 'event', level: 'query' }],
});
let count = 0;
db.$on('query', () => { count++; });

async function compare() {
  const rows = await db.ticket.findMany({select:{id:true, ticketNo:true},orderBy:{ticketNo:'asc'}});
  const slow = [];
  for (const row of rows) {
    const logs = await db.ticketMaterial.findMany({ where:{ ticketId:row.id } });
    slow.push(logs.length);
  }
  const first = count;
  count = 0;
  const batched = await db.ticket.findMany({select:{_count:{select:{materials:true}}},orderBy:{ticketNo:'asc'}});
  assert.deepEqual(slow,batched.map(row => row._count.materials));
  assert.ok(first > count);
  console.log({ tickets: rows.length, individual: first, batched: count });
}
compare().finally(() => db.$disconnect()).catch(error => {console.error(error);process.exitCode=1;});
