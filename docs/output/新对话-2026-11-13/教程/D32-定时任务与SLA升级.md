# D32：定时任务与 SLA 升级

第 5 周 · 2 小时 · 前置 [D31-Outbox与站内通知](D31-Outbox与站内通知.md)。

## 今天要做出什么

让独立 Worker 周期投递诊断任务，扫描进入待派单已经 30 分钟的工单，向运维部门负责人发送超时提醒。

## 今天的目录结构

- `apps/server/src/queue/scan-overdue.ts`
- `apps/server/src/queue/start-worker.ts`
- `apps/server/package.json`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

计时从用户提单还是申请人工开始？同一工单退回后如何区分上一轮待办？

## 一、知识点与推导

比较状态进入事件的时间和工单当前版本。扫描相同记录时数据库复合唯一键防止重复通知。同一张单仍在等用户选择人工接入时不会触发负责人提醒。

## 二、动手开发

先用待选择人工和已转人工两种样例预测提醒对象。实现 scanOverdue，再用独立 worker 脚本循环调用 relay 和扫描。模拟重复扫描、通知已经存在及网络断开后恢复。

## 三、自检与提交

在 apps/server 运行 pnpm worker，用提交接口创建单后查看 offer_handoff。用户点击接入后才开始计时，读取 notices 核对收件人、版本、动作。

## 四、本章完整源码

**apps/server/src/queue/scan-overdue.ts**

```ts
import { PrismaService } from '../prisma/prisma.service.js';

// 课程阈值从进入待派单的事件计算。重复扫描由收件人、版本和动作的联合唯一约束去重。
export async function scanOverdue(db:PrismaService, now=new Date()) {
  const cutoff=new Date(now.getTime()-30*60_000);
  return db.$executeRaw`
    INSERT INTO notices(ticket_no,version,recipient_id,action)
    SELECT t.ticket_no,t.version,u.id,'assignment_overdue'
    FROM tickets t JOIN ticket_events e ON t.id=e.ticket_id AND e.resulting_version=t.version
    JOIN users u ON u.department_id=t.department_id AND u.role='department_lead' AND u.registration_status='approved'
    WHERE t.status='pending_assignment' AND e.to_status='pending_assignment' AND e.created_at<=${cutoff}
    ON CONFLICT (ticket_no,version,recipient_id,action) DO NOTHING`;
}
```

**apps/server/src/queue/start-worker.ts**

```ts
import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { diagnosisQueue, diagnosisWorker } from './diagnosis.js';
import { deliverPending } from './outbox.js';
import { scanOverdue } from './scan-overdue.js';
const db=new PrismaService(), queue=diagnosisQueue(), worker=diagnosisWorker(db);
let running=true;
for (const sig of ['SIGINT','SIGTERM']) process.once(sig,()=>{running=false;});
try {
  while (running) {
    try { await deliverPending(db,queue); await scanOverdue(db); }
    catch (error) {console.error('投递或扫描暂时失败',error instanceof Error?error.name:'unknown');}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
} finally {await worker.close();await queue.close();await db.$disconnect()}
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
    "db:seed": "prisma db seed",
    "worker": "tsx src/queue/start-worker.ts"
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


## 五、核心面试题

1. 为什么 SLA 根据进入待派状态的事件计时？
2. 为什么重复扫描不会重复通知？
3. 多进程停止时要释放哪些连接？

结合本日业务样例回答后，再核对[配套面试题](D32-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

扫描及队列源文件纳入新版验证工程；本地 30 分钟真实等待时长未作为测试证据。
