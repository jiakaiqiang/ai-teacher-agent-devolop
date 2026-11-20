# D107（周二）：Step与事件溯源

第 16 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D106-Agent运行时与Run状态模型.md)。

## 今天要做出什么

从同一 run 的步骤事件重建输出，再去掉中间一条事件。

## 今天的目录结构

- `apps/server/prisma/migrations/20261118172045_agent_steps_events/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/agent/agent-journal.service.ts`
- `apps/server/src/agent/agent-runs.controller.ts`
- `apps/server/src/agent/agent.module.ts`
- `packages/shared/src/agent-run.ts`

## 零、闭卷回忆

**D106**　运行成功能否把已给建议的工单标为已完成？

<details><summary>核对</summary>

运行记录说明 Agent 是否结束。工单依据用户反馈或人工动作推进。

</details>

**D104**　只有一题不同，应从哪里找原因？

<details><summary>核对</summary>

先核对输入文本、空间和授权过滤，再查编码与排序；说明并列分数的处理。

</details>

**D100**　服务返回的向量少一项可以继续配对吗？

<details><summary>核对</summary>

校验批次数量、位置和维度。缺项要拒绝该批，避免把他人材料的向量贴错来源。

</details>

## 一、知识点与推导

按序号发现缺口，回补后再重建。工单事件和运行事件分别存储。

在两个浏览器会话分别以甲、乙公司提单人身份操作。先记下工单号、工单版本，再创建 run。按序号读取 events，按步骤关联 traces。把另一人的 runId 代入同一个接口，保存拒绝结果。

`agent_steps` 是「这一步现在怎么样」：序号（从 1 开始、`@@unique([runId, ordinal])`）、阶段（`plan`/`tool`/`answer`）、状态（`running`/`succeeded`/`failed`）、摘要、错误码、起止时间。`agent_events` 是「发生过什么」：只追加，不改不删，四种类型（`run_started`/`step_started`/`step_finished`/`run_finished`）。两者分工明确：要知道当前进展读 Step（一行一步，便于展示和统计），要回放过程读 Event（按序号重放）。事件的 `payload` 限制成扁平对象（最多 8 个键，值只能是字符串/数字/布尔/null，字符串最长 500），不接受嵌套——嵌套会让它变成第二个数据模型，想查什么都得先解析 JSON。

`beginStep` 在一个可串行化事务里做四件事：确认 Run 还是 `running`、检查步数没到上限（`STEP_LIMIT=8`）、建 Step、把 Run 的 `stepCount` 加一并追加 `step_started` 事件。`endStep` 同样在一个事务里：条件更新（`where: { id, status: 'running' }`）保证一步只能收一次，再追加 `step_finished`。**不要**先写事件再改状态，也不要分两个事务：中间崩溃会留下「事件说这步结束了，Step 还是 running」这种自相矛盾的轨迹，重放出来的状态和表里的状态不一致。失败才允许带错误码（库里也有 CHECK），成功时显式清空错误码。

读事件统一一个口径：`events(runId, after)` 返回序号大于 `after` 的、按升序、最多 200 条。接口 `GET /api/agent/runs/:id/events?after=N` 返回 `{ events, lastSeq }`，客户端把 `lastSeq` 作为下次的 `after`（D110 的推送复用同一套口径，断线重连也靠它）。出站的事件只给 `seq`、`type`、`stepOrdinal`、`payload`、`createdAt`：内部主键不暴露，`stepId` 换成人能看懂的步序。表上 `onDelete: Cascade`：删 Run 自动删掉它的步骤与事件，不留孤儿行（用例直接验证了这一点）。

## 二、动手开发

1. 从同一 run 的步骤事件重建输出，再去掉中间一条事件。先记录操作者、输入和预期。
2. 按步骤重建一次运行历史。在输出中圈出能区分成功和失败的字段。
3. 序号有缺口时能否宣布运行已正常完成？改变这一项条件，保存输出并恢复实现。

<details><summary>提示一 · 先找观察点</summary>

从同一 run 的步骤事件重建输出，再去掉中间一条事件。

</details>

<details><summary>提示二 · 切换一个条件</summary>

序号有缺口时能否宣布运行已正常完成？

</details>

<details><summary>提示三 · 对照判定</summary>

按序号发现缺口，回补后再重建。工单事件和运行事件分别存储。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/prisma/migrations/20261118172045_agent_steps_events/migration.sql**

```sql
-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "event_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "phase" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'running',
    "summary" VARCHAR(500) NOT NULL DEFAULT '',
    "error_code" VARCHAR(64),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_run_id_ordinal_key" ON "agent_steps"("run_id", "ordinal");

-- CreateIndex
CREATE INDEX "agent_events_run_id_seq_idx" ON "agent_events"("run_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "agent_events_run_id_seq_key" ON "agent_events"("run_id", "seq");

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "agent_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 单步的阶段与状态取值；终态必须有结束时间，running 不能有。
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_phase_check"
    CHECK ("phase" IN ('plan', 'tool', 'answer'));
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_status_check"
    CHECK ("status" IN ('running', 'succeeded', 'failed'));
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_terminal_check"
    CHECK (("status" = 'running') = ("ended_at" IS NULL));
-- 失败才允许带错误码。
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_error_check"
    CHECK (("status" = 'failed') OR "error_code" IS NULL);
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_ordinal_check"
    CHECK ("ordinal" >= 1);

-- 事件序号从 1 开始连续递增；类型取值固定。
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_seq_check" CHECK ("seq" >= 1);
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_type_check"
    CHECK ("type" IN ('run_started', 'step_started', 'step_finished', 'run_finished'));
```

**apps/server/prisma/schema.prisma**

```prisma
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
  conversations AiConversation[]
  aiQuotas AiQuota[]
  roles UserRole[]
  agentRuns AgentRun[]
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

model AiQuota {
  userId String @map("user_id") @db.Uuid
  period String @db.VarChar(10)
  available Int @default(200000)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)
  usages AiUsage[]
  @@id([userId, period])
  @@map("ai_quotas")
}

model AiUsage {
  id String @id @default(uuid(7)) @db.Uuid
  userId String @map("user_id") @db.Uuid
  period String @db.VarChar(10)
  requestKey String @map("request_key") @db.Uuid
  reserved Int
  charged Int?
  status String @default("pending") @db.VarChar(16)
  inputTokens Int? @map("input_tokens")
  outputTokens Int? @map("output_tokens")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  settledAt DateTime? @map("settled_at") @db.Timestamptz
  quota AiQuota @relation(fields: [userId, period], references: [userId, period], onDelete: Restrict)
  @@unique([userId, requestKey], map: "ai_usage_user_request_unique")
  @@index([userId, period])
  @@map("ai_usage")
}

model AiConversation {
  id String @id @default(uuid(7)) @db.Uuid
  userId String @map("user_id") @db.Uuid
  scopeHash String @map("scope_hash") @db.VarChar(64)
  title String @db.VarChar(200)
  version Int @default(0)
  activeTurnId String? @map("active_turn_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)
  turns AiChatTurn[]
  @@index([userId, updatedAt(sort: Desc)])
  @@map("ai_conversations")
}

model AiChatTurn {
  id String @id @default(uuid(7)) @db.Uuid
  conversationId String @map("conversation_id") @db.Uuid
  requestKey String @map("request_key") @db.Uuid
  ordinal Int
  question String @db.VarChar(2000)
  status String @default("running") @db.VarChar(16)
  mode String? @db.VarChar(8)
  transcript Json @default("[]")
  answer String @default("")
  errorCode String? @map("error_code") @db.VarChar(64)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  endedAt DateTime? @map("ended_at") @db.Timestamptz
  conversation AiConversation @relation(fields: [conversationId], references: [id], onDelete: Restrict)
  @@unique([conversationId, requestKey])
  @@unique([conversationId, ordinal])
  @@map("ai_chat_turns")
}

// 只有通用正文用于检索；私有手册绑定公司，草稿和撤回版本不投影。
model KnowledgeEntry {
  id String @id @default(uuid(7)) @db.Uuid
  kind String
  companyId String? @map("company_id") @db.Uuid
  title String
  body String
  version Int @default(1)
  state String
  @@map("knowledge_entries")
}

model AgentRun {
  id String @id @default(uuid(7)) @db.Uuid
  userId String @map("user_id") @db.Uuid
  requestKey String @map("request_key") @db.Uuid
  ticketNo String @map("ticket_no") @db.VarChar(64)
  goal String @db.VarChar(500)
  scopeHash String @map("scope_hash") @db.VarChar(64)
  status String @default("queued") @db.VarChar(16)
  stopReason String? @map("stop_reason") @db.VarChar(32)
  version Int @default(0)
  stepCount Int @default(0) @map("step_count")
  eventSeq Int @default(0) @map("event_seq")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  startedAt DateTime? @map("started_at") @db.Timestamptz
  endedAt DateTime? @map("ended_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)
  steps AgentStep[]
  events AgentEvent[]
  @@unique([userId, requestKey])
  @@index([userId, createdAt(sort: Desc)])
  @@map("agent_runs")
}

model AgentStep {
  id String @id @default(uuid(7)) @db.Uuid
  runId String @map("run_id") @db.Uuid
  ordinal Int
  phase String @db.VarChar(16)
  status String @default("running") @db.VarChar(16)
  summary String @default("") @db.VarChar(500)
  errorCode String? @map("error_code") @db.VarChar(64)
  startedAt DateTime @default(now()) @map("started_at") @db.Timestamptz
  endedAt DateTime? @map("ended_at") @db.Timestamptz
  run AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  events AgentEvent[]
  @@unique([runId, ordinal])
  @@map("agent_steps")
}

model AgentEvent {
  id String @id @default(uuid(7)) @db.Uuid
  runId String @map("run_id") @db.Uuid
  stepId String? @map("step_id") @db.Uuid
  seq Int
  type String @db.VarChar(32)
  payload Json @default("{}")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  run AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  step AgentStep? @relation(fields: [stepId], references: [id], onDelete: Cascade)
  @@unique([runId, seq])
  @@index([runId, seq])
  @@map("agent_events")
}
```

**apps/server/src/agent/agent-journal.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { RunFailure } from './run-errors.js';

export const stepPhases = ['plan', 'tool', 'answer'] as const;
export type StepPhase = (typeof stepPhases)[number];
export const eventTypes = ['run_started', 'step_started', 'step_finished', 'run_finished'] as const;
export type EventType = (typeof eventTypes)[number];
export const STEP_LIMIT = 8;

const payloadSchema = z.record(z.string().max(32), z.union([z.string().max(500), z.number().finite(),
  z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 8, 'PAYLOAD_TOO_WIDE');
export type EventPayload = z.infer<typeof payloadSchema>;

type Journal = Pick<TransactionClient, 'agentRun' | 'agentStep' | 'agentEvent' | '$queryRaw'>;

@Injectable()
export class AgentJournalService {
  constructor(private readonly db: PrismaService) {}

  // 事件序号由 Run 行上的计数器分配：同一事务内 UPDATE ... RETURNING 保证不重号，
  // 并发写第二个事务会等锁，拿到的一定是递增后的值。
  private async append(tx: Journal, runId: string, type: EventType, stepId: string | null,
    payload: EventPayload) {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) throw new RunFailure('RUN_EVENT_INVALID');
    const [row] = await tx.$queryRaw<{ event_seq: number }[]>`
      UPDATE agent_runs SET event_seq = event_seq + 1 WHERE id = ${runId}::uuid RETURNING event_seq`;
    if (!row) throw new RunFailure('RUN_NOT_FOUND');
    return tx.agentEvent.create({
      data: { runId, stepId, seq: row.event_seq, type, payload: parsed.data },
    });
  }

  async record(runId: string, type: EventType, payload: EventPayload = {}, stepId: string | null = null) {
    return this.db.$transaction(tx => this.append(tx, runId, type, stepId, payload));
  }

  // 开一步：序号由库里的现有步数决定，并和 step_started 事件写在同一个事务里。
  async beginStep(runId: string, phase: StepPhase, summary = '') {
    if (!stepPhases.includes(phase)) throw new RunFailure('RUN_STEP_PHASE_INVALID');
    return this.db.serializable(async tx => {
      const run = await tx.agentRun.findUnique({ where: { id: runId }, select: { status: true, stepCount: true } });
      if (!run) throw new RunFailure('RUN_NOT_FOUND');
      if (run.status !== 'running') throw new RunFailure('RUN_NOT_RUNNING');
      if (run.stepCount >= STEP_LIMIT) throw new RunFailure('RUN_STEP_LIMIT');
      const ordinal = run.stepCount + 1;
      const step = await tx.agentStep.create({
        data: { runId, ordinal, phase, summary: summary.slice(0, 500) },
      });
      await tx.agentRun.update({ where: { id: runId }, data: { stepCount: { increment: 1 } } });
      const event = await this.append(tx, runId, 'step_started', step.id, { ordinal, phase });
      return { step, event };
    });
  }

  // 收一步：只允许 running → succeeded/failed，失败才带错误码。
  async endStep(stepId: string, outcome: { status: 'succeeded' | 'failed'; summary?: string; errorCode?: string }) {
    return this.db.$transaction(async tx => {
      const changed = await tx.agentStep.updateMany({
        where: { id: stepId, status: 'running' },
        data: {
          status: outcome.status, endedAt: new Date(),
          errorCode: outcome.status === 'failed' ? outcome.errorCode ?? 'STEP_FAILED' : null,
          ...(outcome.summary === undefined ? {} : { summary: outcome.summary.slice(0, 500) }),
        },
      });
      if (changed.count !== 1) throw new RunFailure('RUN_STEP_STATE_CONFLICT');
      const step = await tx.agentStep.findUniqueOrThrow({ where: { id: stepId } });
      const event = await this.append(tx, step.runId, 'step_finished', step.id,
        { ordinal: step.ordinal, phase: step.phase, status: step.status, errorCode: step.errorCode });
      return { step, event };
    });
  }

  async steps(runId: string) {
    return this.db.agentStep.findMany({ where: { runId }, orderBy: { ordinal: 'asc' }, take: STEP_LIMIT });
  }

  // 读事件：按序号升序，支持 after 增量拉取（D110 的事件流用同一个口径）。
  async events(runId: string, after = 0, take = 100) {
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(take) || take < 1 || take > 200) {
      throw new RunFailure('RUN_INPUT_INVALID');
    }
    return this.db.agentEvent.findMany({
      where: { runId, seq: { gt: after } }, orderBy: { seq: 'asc' }, take,
    });
  }
}
```

**apps/server/src/agent/agent-runs.controller.ts**

```ts
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query } from '@nestjs/common';
import { eventPageSchema, eventViewSchema, runDetailSchema, runListSchema, runStartSchema, runVersionSchema,
  runViewSchema, stepViewSchema } from '@ops-ticket/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';
import { RunFailure } from './run-errors.js';
import { RunStateError } from './run-state.js';
import { z } from 'zod';

type RunRow = Awaited<ReturnType<AgentRunsService['get']>>;
type StepRow = Awaited<ReturnType<AgentJournalService['steps']>>[number];
type EventRow = Awaited<ReturnType<AgentJournalService['events']>>[number];

export function stepView(step: StepRow) {
  return stepViewSchema.parse({
    id: step.id, ordinal: step.ordinal, phase: step.phase, status: step.status, summary: step.summary,
    errorCode: step.errorCode, startedAt: step.startedAt.toISOString(),
    endedAt: step.endedAt?.toISOString() ?? null,
  });
}

// 事件对外只给序号、类型、所属步序和扁平载荷；不暴露内部主键。
export function eventView(event: EventRow, stepOrdinal: number | null) {
  return eventViewSchema.parse({
    seq: event.seq, type: event.type, stepOrdinal,
    payload: event.payload ?? {}, createdAt: event.createdAt.toISOString(),
  });
}

export function runView(run: RunRow) {
  return runViewSchema.parse({
    id: run.id, ticketNo: run.ticketNo, goal: run.goal, status: run.status, stopReason: run.stopReason,
    version: run.version, stepCount: run.stepCount, createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null, endedAt: run.endedAt?.toISOString() ?? null,
  });
}

// 输入问题是 400，看不到是 404，权限变化是 403；状态类问题（转移不允许或被别人改过）都是 409。
export function runHttpStatus(code: string, stateError = false) {
  if (stateError) return 409;
  if (code.endsWith('NOT_FOUND')) return 404;
  if (code === 'RUN_INPUT_INVALID') return 400;
  if (code === 'RUN_SCOPE_CHANGED') return 403;
  return 409;
}

function httpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const known = error instanceof RunFailure || error instanceof RunStateError;
  const code = known ? error.code : 'RUN_FAILED';
  throw new HttpException({ code, message: '运行请求未完成，请查看运行状态后再试' },
    known ? runHttpStatus(code, error instanceof RunStateError) : 503);
}

@Controller('agent/runs')
@RequirePermission('ticket:report')
export class AgentRunsController {
  constructor(private readonly runs: AgentRunsService, private readonly journal: AgentJournalService) {}

  @Post() @HttpCode(201)
  async start(@CurrentUser() user: AuthUser, @Body() input: unknown) {
    try {
      const parsed = runStartSchema.safeParse(input);
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      const { run } = await this.runs.start(user, parsed.data);
      return runView(run);
    } catch (error) { httpError(error); }
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    try { return runListSchema.parse((await this.runs.list(user)).map(runView)); } catch (error) { httpError(error); }
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    try {
      const run = await this.runs.get(user, id);
      return runDetailSchema.parse({ run: runView(run), steps: (await this.journal.steps(run.id)).map(stepView) });
    } catch (error) { httpError(error); }
  }

  // 增量拉取：客户端带上已经看到的最大序号，只取后面的事件。
  @Get(':id/events')
  async events(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('after') after?: string) {
    try {
      const run = await this.runs.get(user, id);
      const parsed = z.coerce.number().int().min(0).max(1_000_000).safeParse(after ?? 0);
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      const steps = await this.journal.steps(run.id);
      const ordinals = new Map(steps.map(step => [step.id, step.ordinal]));
      const events = await this.journal.events(run.id, parsed.data);
      const views = events.map(event => eventView(event, event.stepId ? ordinals.get(event.stepId) ?? null : null));
      return eventPageSchema.parse({ runId: run.id, events: views, lastSeq: views.at(-1)?.seq ?? parsed.data });
    } catch (error) { httpError(error); }
  }

  @Post(':id/cancel') @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: unknown) {
    try {
      const parsed = runVersionSchema.safeParse(input);
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      return runView(await this.runs.cancel(user, id, parsed.data.version));
    } catch (error) { httpError(error); }
  }
}
```

**apps/server/src/agent/agent.module.ts**

```ts
import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { AgentRunsController } from './agent-runs.controller.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';

// 复用 AssistantModule 导出的只读工具与权限指纹，不重复实现数据权限。
@Module({ imports: [AssistantModule], controllers: [AgentRunsController],
  providers: [AgentRunsService, AgentJournalService], exports: [AgentRunsService, AgentJournalService] })
export class AgentModule {}
```

**packages/shared/src/agent-run.ts**

```ts
import { z } from 'zod';

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const runStopReasonSchema = z.enum(['answered', 'step_limit', 'time_limit', 'token_limit',
  'tool_failed', 'model_failed', 'user_cancelled']);

export const runStartSchema = z.object({
  requestKey: z.uuid(),
  ticketNo: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(500),
}).strict();

export const runVersionSchema = z.object({ version: z.number().int().min(0) }).strict();

// 出站只给调用方需要的字段：不含 scopeHash、requestKey 这类内部信息。
export const runViewSchema = z.object({
  id: z.uuid(),
  ticketNo: z.string().min(1).max(64),
  goal: z.string().min(1).max(500),
  status: runStatusSchema,
  stopReason: runStopReasonSchema.nullable(),
  version: z.number().int().min(0),
  stepCount: z.number().int().min(0),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
}).strict();
export const runListSchema = z.array(runViewSchema).max(30);

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStopReason = z.infer<typeof runStopReasonSchema>;
export type RunView = z.infer<typeof runViewSchema>;

export const stepPhaseSchema = z.enum(['plan', 'tool', 'answer']);
export const stepStatusSchema = z.enum(['running', 'succeeded', 'failed']);
export const eventTypeSchema = z.enum(['run_started', 'step_started', 'step_finished', 'run_finished']);

export const stepViewSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1),
  phase: stepPhaseSchema,
  status: stepStatusSchema,
  summary: z.string().max(500),
  errorCode: z.string().max(64).nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
}).strict();

export const eventViewSchema = z.object({
  seq: z.number().int().min(1),
  type: eventTypeSchema,
  stepOrdinal: z.number().int().min(1).nullable(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: z.string(),
}).strict();

export const runDetailSchema = z.object({
  run: runViewSchema,
  steps: z.array(stepViewSchema).max(8),
}).strict();

export const eventPageSchema = z.object({
  runId: z.uuid(),
  events: z.array(eventViewSchema).max(200),
  lastSeq: z.number().int().min(0),
}).strict();

export type StepView = z.infer<typeof stepViewSchema>;
export type EventView = z.infer<typeof eventViewSchema>;
```

## 五、核心面试题

1. 运行成功能否把已给建议的工单标为已完成？
2. 只有一题不同，应从哪里找原因？
3. 序号有缺口时能否宣布运行已正常完成？

按序号发现缺口，回补后再重建。工单事件和运行事件分别存储。 [本日配套面试题](D107-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

运行轨迹专项以受控模型返回分类，同时验证业务单状态、跨客户拒绝和增量事件。知识发布专项使用本机数据库、Milvus 和 Ollama。[接口验收](../学习记录/新版验收/D154-integration.txt)。
