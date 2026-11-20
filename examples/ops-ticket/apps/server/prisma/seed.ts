import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const createdAt = new Date('2026-11-19T01:00:00Z');

async function seed() {
  await prisma.$transaction(async tx => {
    const department = await tx.department.upsert({
      where: { name: '网络部' }, create: { name: '网络部' }, update: {},
    });
    const category = await tx.category.upsert({
      where: { name: '网络问题' }, update: {},
      create: { name: '网络问题', departmentId: department.id },
    });
    for (const [name, username, ticketNo] of [
      ['甲公司', 'lin', 'T-001'], ['乙公司', 'wu', 'T-002'],
    ]) {
      const company = await tx.company.upsert({ where: { name }, create: { name }, update: {} });
      const reporter = await tx.user.upsert({
        where: { username }, update: {}, create: {
          username, displayName: username, role: 'reporter', registrationStatus: 'approved', companyId: company.id,
        },
      });
      // 嵌套写入使新建工单、初始事件和日志同进同退。再次播种保留已有记录。
      await tx.ticket.upsert({
        where: { ticketNo }, update: {}, create: {
          ticketNo, title: '网络连接超时', description: '提交请求后连续超时',
          companyId: company.id, departmentId: category.departmentId, categoryId: category.id,
          reporterId: reporter.id, createdAt,
          materials: { create: { logText: 'client timeout after 5s' } },
          events: { create: { action: 'submitted', source: 'user', actorId: reporter.id,
            toStatus: 'agent_processing', createdAt } },
        },
      });
    }
  });
}
seed().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
