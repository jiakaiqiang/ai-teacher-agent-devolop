# D29：BullMQ 接入——告警先进队列，后台慢慢建单

第 5 周 · 2 小时 · 前置 [D28-第四周复盘](D28-第四周复盘.md)。

## 今天要做出什么

让已经提交的用户工单进入 BullMQ 的诊断任务。W5 使用确定性替身：无法判断时只向用户显示人工入口。

## 今天的目录结构

- `infra/docker-compose.yml`
- `apps/server/.env.example`
- `apps/server/package.json`
- `apps/server/src/queue/queue.config.ts`
- `apps/server/src/queue/diagnosis.ts`
- `apps/server/prisma/scripts/replay-diagnosis.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

已有工单与队列中的任务各有什么标识？同一张单是否允许多个 Agent 写回？缓存 Redis 淘汰键对任务意味着什么？

## 一、知识点与推导

先持久化用户工单，再异步处理。任务只携带业务编号和预期版本，Worker 回库读取权威状态。队列使用独立的无淘汰 Redis，避免缓存压力影响任务。

## 二、动手开发

起动独立队列 Redis，配置 QUEUE_REDIS_URL，写入 SubmitTicket 后向 diagnosis 队列提交工单号和版本，等待 Worker 更新。核对显示按钮与进入待派单之间的边界。

## 三、自检与提交

运行 pnpm exec tsx --env-file=.env prisma/scripts/replay-diagnosis.ts，查看工单的提交和诊断事件。D31 再将建单与待投递事件绑定到同一事务。

## 四、本章完整源码

**infra/docker-compose.yml**

```text
# 本机开发用的依赖服务。今天只有 PostgreSQL，W4 加 Redis，W11 加 Milvus
name: ops-ticket-course-v2

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ops
      # 只用于本机开发的密码，真实环境的密码不能写进仓库
      POSTGRES_PASSWORD: ops_local_only
      POSTGRES_DB: ops_ticket
    ports:
      # 宿主机用 55433：5432 常被本机其他项目的 PostgreSQL 占用
      - "127.0.0.1:55433:5432"
    volumes:
      # 数据存在命名卷里，容器删除后数据仍在；docker compose down -v 才会删除
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ops -d ops_ticket"]
      interval: 2s
      timeout: 3s
      retries: 15

  redis:
    image: redis:7-alpine
    # 只做缓存和限流，丢了可以重建，不开持久化；--maxmemory 防止缓存把内存吃满
    command: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports:
      # 宿主机用 56379：6379 常被本机其他项目的 Redis 占用
      - "127.0.0.1:56379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 15

  queue:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    ports:
      - "127.0.0.1:56380:6379"
    volumes:
      - queuedata:/data
volumes:
  queuedata:
  pgdata:
```

**apps/server/.env.example**

```text
# 复制为 .env 后使用；.env 不提交到 Git
# 端口 55433 对应 infra/docker-compose.yml 里映射的端口
DATABASE_URL="postgresql://ops:ops_local_only@localhost:55433/ops_ticket?schema=public"

REDIS_URL=redis://127.0.0.1:56379/0
# 在本地 .env 中生成至少 32 字符的随机值
JWT_SECRET=

QUEUE_REDIS_URL=redis://127.0.0.1:56380/0
```

**apps/server/package.json**

```json
{
  "name": "@ops-ticket/server",
  "version": "0.0.1",
  "description": "",
  "author": "",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "deploy": "nest deploy",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "oxlint --type-aware src/ test/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --no-file-parallelism",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:status": "prisma migrate status",
    "db:seed": "prisma db seed"
  },
  "dependencies": {
    "@nestjs/common": "^12.0.1",
    "@nestjs/core": "^12.0.1",
    "@nestjs/platform-express": "^12.0.1",
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "dotenv": "^18.0.10",
    "pg": "^8.23.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "@ops-ticket/shared": "workspace:*",
    "@nestjs/jwt": "12.0.5",
    "ioredis": "6.0.0",
    "bullmq": "6.7.6"
  },
  "devDependencies": {
    "@nestjs/cli": "^12.0.0",
    "@nestjs/mau": "^0.2.6",
    "@nestjs/schematics": "^12.0.0",
    "@nestjs/testing": "^12.0.1",
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "@types/supertest": "^7.0.0",
    "@vitest/coverage-v8": "^4.1.2",
    "oxlint": "^1.58.0",
    "oxlint-tsgolint": "^7.0.2001",
    "prettier": "^3.4.2",
    "prisma": "7.10.1",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "tsx": "^4.23.15",
    "typescript": "^6.0.2",
    "vite": "^8.0.0",
    "vitest": "^4.1.2"
  }
}
```

**apps/server/src/queue/queue.config.ts**

```ts
import type { QueueOptions } from 'bullmq';

// BullMQ 的连接配置（D29）。队列用单独的 Redis（QUEUE_REDIS_URL）：
// 缓存用的那个 Redis 内存满了会淘汰键（allkeys-lru），队列里的任务不能被淘汰，BullMQ 要求 noeviction
export function queueRootOptions(): QueueOptions {
  const url = process.env.QUEUE_REDIS_URL;
  if (!url) {
    throw new Error('缺少环境变量 QUEUE_REDIS_URL，请检查 apps/server/.env');
  }
  return {
    // 不像 D22 那样关掉离线队列：BullMQ 一创建连接就要发命令检查 Redis 版本，关掉后连接还没建立就失败了（D29 实测）
    connection: { url },
    // 所有队列的键都以 ops: 开头，和 W4 的缓存键一样好认
    prefix: 'ops',
  };
}
```

**apps/server/src/queue/diagnosis.ts**

```ts
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketCommands } from '../tickets/ticket-commands.js';
import { queueRootOptions } from './queue.config.js';

export interface DiagnosisTask { ticketNo:string; version:number }
export function diagnosisQueue() {
  return new Queue<DiagnosisTask>('diagnosis', queueRootOptions());
}
export function diagnosisWorker(db:PrismaService) {
  return new Worker<DiagnosisTask>('diagnosis',async job=>{
    const ticket=await db.ticket.findUniqueOrThrow({where:{ticketNo:job.data.ticketNo}});
    if (ticket.status!=='agent_processing' || ticket.version!==job.data.version) return;
    // W5 的确定性替身：缺少可验证依据时只显示人工入口。
    const commands=new TicketCommands(db);
    await commands.apply(ticket.ticketNo,{source:'agent'},'offer_handoff',ticket.version);
  },queueRootOptions());
}
```

**apps/server/prisma/scripts/replay-diagnosis.ts**

```ts
import assert from 'node:assert/strict';
import { QueueEvents } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SubmitTicket } from '../../src/tickets/submit-ticket.js';
import { diagnosisQueue, diagnosisWorker } from '../../src/queue/diagnosis.js';
import { queueRootOptions } from '../../src/queue/queue.config.js';
const db=new PrismaService(), queue=diagnosisQueue(), worker=diagnosisWorker(db);
const events=new QueueEvents(queue.name,queueRootOptions());
const key=crypto.randomUUID();
try {
  await events.waitUntilReady();
  const reporter=await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const ticket=await new SubmitTicket(db).submit(reporter.id,key,{category:'网络问题',title:'练习',description:'证据不足',logs:[]});
  for (const delivery of [1,2]) {
    const job=await queue.add('diagnose',{ticketNo:ticket.ticketNo,version:0},{jobId:key+'-'+delivery,removeOnComplete:true});
    await job.waitUntilFinished(events,10000);
  }
  assert.equal((await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'handoff_offered');
  assert.equal(await db.ticketEvent.count({where:{ticketId:ticket.id,action:'offer_handoff'}}),1);
  console.log('两次投递，一个人工接入入口，尚未进入待派单');
} finally {
  await Promise.all([events.close(),worker.close(),queue.close()]);
  await db.ticketEvent.deleteMany({where:{ticket:{requestKey:key}}});
  await db.ticket.deleteMany({where:{requestKey:key}});
  await db.$disconnect();
}
```


## 五、核心面试题

1. 队列为何只携带工单号和版本？
2. 入队超时就代表没有入队吗？
3. Worker 可以直接给负责人派单吗？

结合本日业务样例回答后，再核对[配套面试题](D29-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

独立 BullMQ 队列、Worker 和 PostgreSQL 实测用例通过。
