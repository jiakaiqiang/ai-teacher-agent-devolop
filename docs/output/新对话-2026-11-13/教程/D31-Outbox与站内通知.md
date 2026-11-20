# D31：Outbox——“要发的通知”和业务数据写在同一个事务里

第 5 周 · 2 小时 · 前置 [D30-至少一次投递与消费者幂等](D30-至少一次投递与消费者幂等.md)。

## 今天要做出什么

用户提单与诊断待投递事件同事务写入；用户转人工与负责人通知同事务写入。投递器只消费尚未送出的记录。

## 今天的目录结构

- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/20261119070000_dispatch/migration.sql`
- `apps/server/src/tickets/submit-ticket.ts`
- `apps/server/src/tickets/ticket-commands.ts`
- `apps/server/src/queue/outbox.ts`
- `apps/server/prisma/scripts/outbox-replay.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

为什么 INSERT 之后直接 queue.add 会留下丢任务窗口？哪些动作通知用户？哪些动作通知负责人？

## 一、知识点与推导

把跨系统调用拆成数据库内的原子落库和可重试的投递。用事件 id 作为队列任务标识，收件人和业务版本限定通知唯一性。数据来源和对象身份都从工单取。

## 二、动手开发

先模拟提交成功、队列暂未收到任务，再从 dispatch_events 恢复。重复调用投递器，把任务处理后的用户通知计数与工单事件对照。

## 三、自检与提交

运行 outbox-replay.ts。确认未知诊断只通知用户，“人工接入”由用户选择后才出现部门待办。提交中途故障时恢复的依据。

## 四、本章完整源码

**apps/server/prisma/schema.prisma**

```text
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model Company {
  id      String   @id @default(uuid(7)) @db.Uuid
  name    String   @unique
  users   User[]
  tickets Ticket[]

  @@map("companies")
}

model Department {
  id         String     @id @default(uuid(7)) @db.Uuid
  name       String     @unique
  users      User[]
  categories Category[]
  tickets    Ticket[]

  @@map("departments")
}

model Category {
  id           String     @id @default(uuid(7)) @db.Uuid
  name         String     @unique
  departmentId String     @map("department_id") @db.Uuid
  department   Department @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  tickets      Ticket[]

  @@map("categories")
}

model User {
  id                 String        @id @default(uuid(7)) @db.Uuid
  username           String        @unique
  displayName        String        @map("display_name")
  role               String
  registrationStatus String        @default("pending") @map("registration_status")
  companyId          String?       @map("company_id") @db.Uuid
  departmentId       String?       @map("department_id") @db.Uuid
  company            Company?      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  department         Department?   @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  reported           Ticket[]      @relation("reporter")
  assigned           Ticket[]      @relation("assignee")
  events             TicketEvent[]

  passwordHash String? @map("password_hash")
  roles UserRole[]
  @@map("users")
}

model Ticket {
  id           String           @id @default(uuid(7)) @db.Uuid
  ticketNo     String           @unique @map("ticket_no")
  title        String
  description  String
  companyId    String           @map("company_id") @db.Uuid
  categoryId   String           @map("category_id") @db.Uuid
  departmentId String           @map("department_id") @db.Uuid
  reporterId   String           @map("reporter_id") @db.Uuid
  assigneeId   String?          @map("assignee_id") @db.Uuid
  status       String           @default("agent_processing")
  version      Int              @default(0)
  createdAt    DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  completedAt  DateTime?        @map("completed_at") @db.Timestamptz(3)
  company      Company          @relation(fields: [companyId], references: [id], onDelete: Restrict)
  category     Category         @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  department   Department       @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  reporter     User             @relation("reporter", fields: [reporterId], references: [id], onDelete: Restrict)
  assignee     User?            @relation("assignee", fields: [assigneeId], references: [id], onDelete: Restrict)
  materials    TicketMaterial[]
  events       TicketEvent[]

  @@index([companyId, createdAt(sort: Desc), id(sort: Desc)], map: "tickets_company_time")
  @@index([departmentId, status, createdAt(sort: Desc), id(sort: Desc)], map: "tickets_department_status_time")
  requestKey String? @map("request_key")
  requestHash String? @map("request_hash")
  @@unique([reporterId,requestKey])
  @@map("tickets")
}

model TicketMaterial {
  id       String @id @default(uuid(7)) @db.Uuid
  ticketId String @map("ticket_id") @db.Uuid
  logText  String @map("log_text")
  ticket   Ticket @relation(fields: [ticketId], references: [id], onDelete: Restrict)

  @@map("ticket_materials")
}

model TicketEvent {
  id         String   @id @default(uuid(7)) @db.Uuid
  ticketId   String   @map("ticket_id") @db.Uuid
  actorId    String?  @map("actor_id") @db.Uuid
  source     String
  action     String
  fromStatus String?  @map("from_status")
  toStatus   String   @map("to_status")
  comment    String   @default("")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Restrict)
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: Restrict)

  previousVersion Int? @map("previous_version")
  resultingVersion Int? @map("resulting_version")
  @@map("ticket_events")
}

model Role {
  id        String   @id @default(uuid(7)) @db.Uuid
  code      String   @unique @db.VarChar(32)
  name      String   @db.VarChar(64)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  permissions RolePermission[]
  users       UserRole[]

  @@map("roles")
}

model Permission {
  id          String @id @default(uuid(7)) @db.Uuid
  code        String @unique @db.VarChar(64)
  description String @db.VarChar(200)

  roles RolePermission[]

  @@map("permissions")
}

// 关联表：删除角色或权限时，关联行跟着删（Cascade）。
// 这是对“外键一律 RESTRICT”（D1）的有意例外：关联行不是业务历史，留着没有意义
model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  // 主键以 role_id 开头，按权限查角色要单独的索引
  @@index([permissionId], map: "role_permissions_permission_id_idx")
  @@map("role_permissions")
}

model UserRole {
  userId    String   @map("user_id") @db.Uuid
  roleId    String   @map("role_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@index([roleId], map: "user_roles_role_id_idx")
  @@map("user_roles")
}

model RegistrationAudit {
  id String @id @default(uuid(7)) @db.Uuid
  approverId String @map("approver_id") @db.Uuid
  applicantId String @map("applicant_id") @db.Uuid
  companyId String @map("company_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@map("registration_audits")
}

model DispatchEvent {
  id String @id @default(uuid(7)) @db.Uuid
  ticketNo String @map("ticket_no")
  version Int
  kind String
  sentAt DateTime? @map("sent_at") @db.Timestamptz(3)
  @@unique([ticketNo,version,kind])
  @@map("dispatch_events")
}
model Notice {
  id Int @id @default(autoincrement())
  ticketNo String @map("ticket_no")
  version Int
  recipientId String @map("recipient_id") @db.Uuid
  action String
  readAt DateTime? @map("read_at") @db.Timestamptz(3)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@unique([ticketNo,version,recipientId,action])
  @@map("notices")
}
```

**apps/server/prisma/migrations/20261119070000_dispatch/migration.sql**

```sql
CREATE TABLE dispatch_events(id UUID PRIMARY KEY,ticket_no TEXT NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL,sent_at TIMESTAMPTZ(3),UNIQUE(ticket_no,version,kind));
CREATE TABLE notices(id SERIAL PRIMARY KEY,ticket_no TEXT NOT NULL,version INTEGER NOT NULL,recipient_id UUID NOT NULL,action TEXT NOT NULL,read_at TIMESTAMPTZ(3),created_at TIMESTAMPTZ(3) DEFAULT now() NOT NULL,UNIQUE(ticket_no,version,recipient_id,action));
```

**apps/server/src/tickets/submit-ticket.ts**

```ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Report { category: string; title: string; description: string; logs: string[] }

@Injectable()
export class SubmitTicket {
  constructor(private readonly db: PrismaService) {}
  async submit(reporterId:string, key:string, input:Report) {
    if (!key.trim() || !input.title.trim() || !input.description.trim()) throw new BadRequestException('请填写分类、标题和描述');
    const hash=createHash('sha256').update(JSON.stringify([input.category,input.title,input.description,input.logs])).digest('hex');
    const where={reporterId_requestKey:{reporterId,requestKey:key}};
    const user=await this.db.user.findFirst({where:{id:reporterId,role:'reporter',registrationStatus:'approved'}});
    if (!user?.companyId) throw new ForbiddenException('需要已获批的提单账号');
    const companyId=user.companyId;
    const replay=async () => {
      const old=await this.db.ticket.findUnique({where});
      if (!old) return null;
      if (old.requestHash!==hash) throw new ConflictException('相同请求键对应不同报障材料');
      return old;
    };
    const existing=await replay();
    if (existing) return existing;
    try {
      return await this.db.$transaction(async tx=>{
        const category=await tx.category.findUnique({where:{name:input.category}});
        if (!category) throw new BadRequestException('问题分类不存在');
        const ticket=await tx.ticket.create({data:{
          ticketNo:'T-'+randomUUID(),reporterId,companyId,categoryId:category.id,departmentId:category.departmentId,
          title:input.title,description:input.description,requestKey:key,requestHash:hash,
          materials:{create:input.logs.map(logText=>({logText}))},
          events:{create:{source:'user',actorId:reporterId,action:'submitted',toStatus:'agent_processing'}},
        }});
        await tx.dispatchEvent.create({data:{ticketNo:ticket.ticketNo,version:ticket.version,kind:"diagnose"}});
        return ticket;
      });
    } catch(error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') {
        const winner=await replay();
        if (winner) return winner;
      }
      throw error;
    }
  }
}
```

**apps/server/src/tickets/ticket-commands.ts**

```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ticketStatusSchema } from '@ops-ticket/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { transition, type Action } from './workflow.js';

type Caller = { source: 'agent' } | { source:'user'; id:string };

@Injectable()
export class TicketCommands {
  constructor(private readonly db: PrismaService) {}
  // Caller 由受信入口构造。Agent 调用只来自服务端诊断任务。
  async apply(ticketNo:string, caller:Caller, action:Action, expectedVersion:number, targetId?:string, comment='') {
    return this.db.$transaction(async tx => {
      const row = await tx.ticket.findUnique({where:{ticketNo}});
      if (!row) throw new NotFoundException('工单不存在');
      const actor = caller.source === 'agent' ? {id:'agent',role:'agent'} :
        await tx.user.findFirst({where:{id:caller.id,registrationStatus:'approved'}});
      if (!actor) throw new ForbiddenException('账号未获批');
      const target = targetId ? await tx.user.findFirst({where:{id:targetId,registrationStatus:'approved'}}) : null;
      const next=transition({...row,status:ticketStatusSchema.parse(row.status)},actor,action,target ?? undefined);
      const changed=await tx.ticket.updateMany({where:{id:row.id,version:expectedVersion,status:row.status},
        data:{status:next.status,assigneeId:next.assigneeId,version:{increment:1},
          completedAt:next.status==='completed' ? new Date() : null}});
      if (changed.count!==1) throw new ConflictException('工单已变化，请刷新');
      const recipients=next.status==='pending_assignment' || next.status==='handled'
        ? (await tx.user.findMany({where:{departmentId:row.departmentId,role:'department_lead',registrationStatus:'approved'},select:{id:true}})).map(u=>u.id)
        : next.status==='human_processing' && next.assigneeId ? [next.assigneeId]
        : ['reviewed','awaiting_feedback','handoff_offered'].includes(next.status) ? [row.reporterId] : [];
      await tx.notice.createMany({data:recipients.map(recipientId=>({recipientId,ticketNo,version:row.version+1,action})),skipDuplicates:true});
      return tx.ticketEvent.create({data:{ticketId:row.id,actorId:caller.source==='user'?caller.id:null,
        previousVersion:row.version,resultingVersion:row.version+1,action,source:caller.source,fromStatus:row.status,toStatus:next.status,comment}});
    });
  }
}
```

**apps/server/src/queue/outbox.ts**

```ts
import { diagnosisQueue } from './diagnosis.js';
import { PrismaService } from '../prisma/prisma.service.js';

// add 成功且进程在标记前崩溃时，下一轮仍用同一 outbox id 投递。
export async function deliverPending(db:PrismaService, queue:ReturnType<typeof diagnosisQueue>) {
  const events=await db.dispatchEvent.findMany({where:{sentAt:null},orderBy:{id:'asc'},take:50});
  for (const event of events) {
    if (event.kind==='diagnose') {
      await queue.add('diagnose',{ticketNo:event.ticketNo,version:event.version},{
        jobId:event.id, attempts:3,backoff:{type:'exponential',delay:500}});
    }
    await db.dispatchEvent.updateMany({where:{id:event.id,sentAt:null},data:{sentAt:new Date()}});
  }
}
```

**apps/server/prisma/scripts/outbox-replay.ts**

```ts
import { deliverPending } from '../../src/queue/outbox.js';
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
  const event=await db.dispatchEvent.findUniqueOrThrow({where:{ticketNo_version_kind:{ticketNo:ticket.ticketNo,version:0,kind:'diagnose'}}});
  await deliverPending(db,queue);
  const job=await queue.getJob(event.id);
  assert.ok(job);
  await job.waitUntilFinished(events,10000);
  await deliverPending(db,queue);
  assert.equal(await db.notice.count({where:{ticketNo:ticket.ticketNo,recipientId:reporter.id}}),1);
  assert.equal((await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'handoff_offered');
  assert.equal(await db.ticketEvent.count({where:{ticketId:ticket.id,action:'offer_handoff'}}),1);
  console.log('两次投递，一个人工接入入口，尚未进入待派单');
} finally {
  await Promise.all([events.close(),worker.close(),queue.close()]);
  await db.ticketEvent.deleteMany({where:{ticket:{requestKey:key}}});
  const t=await db.ticket.findFirst({where:{requestKey:key}});
  if (t) {await db.dispatchEvent.deleteMany({where:{ticketNo:t.ticketNo}}); await db.notice.deleteMany({where:{ticketNo:t.ticketNo}});}
  await db.ticket.deleteMany({where:{requestKey:key}});
  await db.$disconnect();
}
```


## 五、核心面试题

1. 为什么 outbox 记录和工单同时提交？
2. 哪种崩溃会形成重复投递？
3. 同部门客户能否收到其他公司材料？

结合本日业务样例回答后，再核对[配套面试题](D31-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

真实 PostgreSQL 和 BullMQ 运行投递、消费及重复 relay，用户通知与诊断状态都只产生一次。
