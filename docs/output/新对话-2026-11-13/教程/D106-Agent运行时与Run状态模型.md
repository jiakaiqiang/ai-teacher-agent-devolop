# D106（周一）：Agent运行时与Run状态模型

第 16 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D105-第十五周复盘.md)。

## 今天要做出什么

让一次诊断运行成功结束，另一次因预算中断，随后读取工单和运行两张状态表。

## 今天的目录结构

- `apps/server/prisma/migrations/20261118160930_agent_runs/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/agent/agent-runs.controller.ts`
- `apps/server/src/agent/agent-runs.service.ts`
- `apps/server/src/agent/agent.module.ts`
- `apps/server/src/agent/run-errors.ts`
- `apps/server/src/agent/run-state.spec.ts`
- `apps/server/src/agent/run-state.ts`
- `apps/server/src/app.module.ts`
- `apps/server/src/common/current-user.decorator.ts`
- `packages/shared/src/agent-run.ts`
- `packages/shared/src/index.ts`

## 零、闭卷回忆

**D105**　两端都返回 HTTP 200 能说明迁移成功吗？

<details><summary>核对</summary>

需要逐题核对来源与拒答，用同一题集保存迁移前后的差异。

</details>

**D103**　超时回退能否自动放宽检索范围？

<details><summary>核对</summary>

回退仍带原范围，授权失败和下游不可用分别记录。

</details>

**D99**　Node 与 Python 对空数组和缺字段的解释一致吗？

<details><summary>核对</summary>

在 HTTP 边界固定版本、必填字段和状态码，用同一份夹具检查两侧解释。

</details>

## 一、知识点与推导

运行记录说明 Agent 是否结束。工单依据用户反馈或人工动作推进。

在两个浏览器会话分别以甲、乙公司提单人身份操作。先记下工单号、工单版本，再创建 run。按序号读取 events，按步骤关联 traces。把另一人的 runId 代入同一个接口，保存拒绝结果。

一次 Agent 运行（Run）是「为某张工单达成某个目标」的一个整体，它有自己的生命周期，和 W8—W10 的会话轮次不是一回事：轮次是一问一答，Run 会有多步推理与行动（Step 在 D107 做）。状态只留五个：`queued`（已登记未开跑）、`running`（已被认领）、`succeeded`、`failed`、`cancelled`。**不要**把 `thinking`、`acting`、`waiting_tool` 放进 Run 的状态：那是单步的阶段，放进 Run 会让状态数量随能力增长而爆炸，而且每加一种就要改所有判断。状态机写成纯数据表（`allowed`）加三个纯函数，不碰数据库，便于单测。

`stopReason` 回答「为什么停」：`answered` 才算成功，`step_limit`、`time_limit`、`token_limit`、`tool_failed`、`model_failed` 都归 `failed`，`user_cancelled` 归 `cancelled`。`assertTransition` 强制两件事：终态必须有一个与该终态匹配的原因，非终态不许带原因。`statusForReason` 反过来由原因推出终态，所以收尾时调用方只说原因、不挑状态，少一个出错的地方。注意「预算用完」和「工具挂了」都是 failed，但运维处理完全不同——所以原因要独立存，不能只存状态。

创建 Run 的请求可能重试（网络超时、用户连点）。做法：客户端生成 `requestKey`（UUID），库里 `@@unique([userId, requestKey])`，先按键查已有 Run，有就原样返回（`replay: true`），没有才建。键绑定的是「谁 + 哪个动作」，所以同一个键换了工单或目标要拒绝（`RUN_REQUEST_KEY_CONFLICT`），否则一个键会服务两次不同的意图。唯一索引是最后一道防线：两个请求同时到达时，先提交的赢，后提交的撞唯一约束，再读回已有记录。另外限制同时在跑的 Run 数（`RUN_LIMIT=20`），避免一个用户把运行队列占满。

## 二、动手开发

1. 让一次诊断运行成功结束，另一次因预算中断，随后读取工单和运行两张状态表。先记录操作者、输入和预期。
2. 区分 Agent 运行状态与工单业务状态。在输出中圈出能区分成功和失败的字段。
3. 运行成功能否把已给建议的工单标为已完成？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm exec vitest run src/agent/run-state.spec.ts
```

<details><summary>提示一 · 先找观察点</summary>

让一次诊断运行成功结束，另一次因预算中断，随后读取工单和运行两张状态表。

</details>

<details><summary>提示二 · 切换一个条件</summary>

运行成功能否把已给建议的工单标为已完成？

</details>

<details><summary>提示三 · 对照判定</summary>

运行记录说明 Agent 是否结束。工单依据用户反馈或人工动作推进。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/prisma/migrations/20261118160930_agent_runs/migration.sql**

```sql
-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "ticket_no" VARCHAR(64) NOT NULL,
    "goal" VARCHAR(500) NOT NULL,
    "scope_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "stop_reason" VARCHAR(32),
    "version" INTEGER NOT NULL DEFAULT 0,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_user_id_created_at_idx" ON "agent_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_user_id_request_key_key" ON "agent_runs"("user_id", "request_key");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 状态与停止原因的取值在库里也约束一次：应用有 bug 时写不进非法状态。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_stop_reason_check"
    CHECK ("stop_reason" IS NULL OR "stop_reason" IN ('answered', 'step_limit', 'time_limit',
        'token_limit', 'tool_failed', 'model_failed', 'user_cancelled'));
-- 终态必须有停止原因和结束时间；非终态都不允许有。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_terminal_check"
    CHECK (("status" IN ('succeeded', 'failed', 'cancelled'))
        = ("stop_reason" IS NOT NULL AND "ended_at" IS NOT NULL));
-- queued 还没开始；running 必须有开始时间。queued 直接取消时仍然没有开始时间。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_started_check"
    CHECK (("status" <> 'queued' OR "started_at" IS NULL)
        AND ("status" <> 'running' OR "started_at" IS NOT NULL));
-- 步数不为负。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_step_count_check"
    CHECK ("step_count" >= 0);
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
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  startedAt DateTime? @map("started_at") @db.Timestamptz
  endedAt DateTime? @map("ended_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)
  @@unique([userId, requestKey])
  @@index([userId, createdAt(sort: Desc)])
  @@map("agent_runs")
}
```

**apps/server/src/agent/agent-runs.controller.ts**

```ts
import { Body, Controller, Get, HttpCode, HttpException, Param, Post } from '@nestjs/common';
import { runListSchema, runStartSchema, runVersionSchema, runViewSchema } from '@ops-ticket/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { AgentRunsService } from './agent-runs.service.js';
import { RunFailure } from './run-errors.js';
import { RunStateError } from './run-state.js';

type RunRow = Awaited<ReturnType<AgentRunsService['get']>>;

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
  constructor(private readonly runs: AgentRunsService) {}

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
    try { return runView(await this.runs.get(user, id)); } catch (error) { httpError(error); }
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

**apps/server/src/agent/agent-runs.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { visibleTickets } from '../tickets/scope.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ReadToolsService } from '../assistant/read-tools.service.js';
import { assertTransition, statusForReason, type RunStatus, type StopReason } from './run-state.js';
import { RunFailure } from './run-errors.js';

const startSchema = z.object({
  requestKey: z.uuid(),
  ticketNo: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(500),
}).strict();
export type StartInput = z.infer<typeof startSchema>;
export const RUN_LIMIT = 20;

@Injectable()
export class AgentRunsService {
  constructor(private readonly db: PrismaService, private readonly tools: ReadToolsService) {}

  // 开跑前先确认工单在当前用户的数据权限范围内；范围由 W3 的 groupScope 决定。
  private async target(user: AuthUser, ticketNo: string) {
    const ticket = await this.db.ticket.findFirst({
      where: { ...visibleTickets((await this.tools.access(user.id)).user), ticketNo }, select: { ticketNo: true },
    });
    if (!ticket) throw new RunFailure('RUN_TICKET_NOT_FOUND');
    return ticket.ticketNo;
  }

  async start(user: AuthUser, input: unknown) {
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
    const { requestKey, goal } = parsed.data;
    const ticketNo = await this.target(user, parsed.data.ticketNo);
    const { fingerprint } = await this.tools.access(user.id);
    // 同一用户同一请求键只建一次：重试拿回原来的 Run，不会重复开跑。
    const existing = await this.db.agentRun.findUnique({ where: { userId_requestKey: { userId: user.id, requestKey } } });
    if (existing) {
      if (existing.ticketNo !== ticketNo || existing.goal !== goal) throw new RunFailure('RUN_REQUEST_KEY_CONFLICT');
      return { run: existing, replay: true };
    }
    return this.db.serializable(async tx => {
      const live = await tx.agentRun.count({ where: { userId: user.id, status: { in: ['queued', 'running'] } } });
      if (live >= RUN_LIMIT) throw new RunFailure('RUN_LIMIT');
      const run = await tx.agentRun.create({
        data: { userId: user.id, requestKey, ticketNo, goal, scopeHash: fingerprint },
      });
      return { run, replay: false };
    });
  }

  async get(user: AuthUser, id: string) {
    if (!z.uuid().safeParse(id).success) throw new RunFailure('RUN_INPUT_INVALID');
    const run = await this.db.agentRun.findFirst({ where: { id, userId: user.id } });
    if (!run) throw new RunFailure('RUN_NOT_FOUND');
    await this.target(user,run.ticketNo);
    return run;
  }

  async list(user: AuthUser) {
    return this.db.agentRun.findMany({
      where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30,
    });
  }

  // 状态推进统一走条件更新：WHERE 带上旧状态和版本，影响 0 行就是被别人改过。
  private async move(id: string, from: RunStatus, to: RunStatus, version: number,
    reason?: StopReason, extra: { startedAt?: Date; endedAt?: Date } = {}) {
    assertTransition(from, to, reason);
    const result = await this.db.agentRun.updateMany({
      where: { id, status: from, version },
      data: { status: to, version: { increment: 1 }, stopReason: reason ?? null, ...extra },
    });
    if (result.count !== 1) throw new RunFailure('RUN_STATE_CONFLICT');
    return this.db.agentRun.findUniqueOrThrow({ where: { id } });
  }

  // 认领：把 queued 变成 running。多个工作者同时认领只有一个成功。
  async claim(user: AuthUser, id: string, version: number) {
    const run = await this.get(user, id);
    if (run.scopeHash !== (await this.tools.access(user.id)).fingerprint) throw new RunFailure('RUN_SCOPE_CHANGED');
    return this.move(run.id, run.status as RunStatus, 'running', version, undefined, { startedAt: new Date() });
  }

  // 收尾：停止原因决定终态，不让调用方自己挑状态。
  async finish(id: string, version: number, reason: StopReason, from: RunStatus = 'running') {
    return this.move(id, from, statusForReason(reason), version, reason, { endedAt: new Date() });
  }

  async cancel(user: AuthUser, id: string, version: number) {
    const run = await this.get(user, id);
    return this.finish(run.id, version, 'user_cancelled', run.status as RunStatus);
  }
}
```

**apps/server/src/agent/agent.module.ts**

```ts
import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { AgentRunsController } from './agent-runs.controller.js';
import { AgentRunsService } from './agent-runs.service.js';

// 复用 AssistantModule 导出的只读工具与权限指纹，不重复实现数据权限。
@Module({ imports: [AssistantModule], controllers: [AgentRunsController],
  providers: [AgentRunsService], exports: [AgentRunsService] })
export class AgentModule {}
```

**apps/server/src/agent/run-errors.ts**

```ts
// Agent 运行相关的失败只携带固定码；HTTP 状态在控制器按码映射。
export class RunFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
```

**apps/server/src/agent/run-state.spec.ts**

```ts
import { assertTransition, canTransition, isTerminal, runStatuses, statusForReason, stopReasons,
  RunStateError, type RunStatus } from './run-state.js';

describe('Run 状态机', () => {
  it('终态不再接受任何转移', () => {
    const terminal: RunStatus[] = ['succeeded', 'failed', 'cancelled'];
    for (const status of terminal) {
      expect(isTerminal(status)).toBe(true);
      for (const to of runStatuses) expect(canTransition(status, to)).toBe(false);
    }
    expect(terminal.every(status => !canTransition(status, 'running'))).toBe(true);
  });

  it('只有 queued 能被认领，running 只能走向终态', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('queued', 'cancelled')).toBe(true);
    expect(canTransition('queued', 'succeeded')).toBe(false);
    expect(canTransition('running', 'queued')).toBe(false);
    expect(runStatuses.filter(to => canTransition('running', to))).toEqual(['succeeded', 'failed', 'cancelled']);
  });

  it('终态必须带匹配的停止原因，非终态不接受停止原因', () => {
    expect(() => assertTransition('running', 'succeeded', 'answered')).not.toThrow();
    expect(() => assertTransition('running', 'succeeded')).toThrow(RunStateError);
    expect(() => assertTransition('running', 'succeeded', 'step_limit')).toThrow('RUN_STOP_REASON_INVALID');
    expect(() => assertTransition('running', 'failed', 'answered')).toThrow('RUN_STOP_REASON_INVALID');
    expect(() => assertTransition('queued', 'running', 'answered')).toThrow('RUN_STOP_REASON_INVALID');
  });

  it('每个停止原因都能反推唯一终态', () => {
    expect(stopReasons.map(statusForReason)).toEqual(['succeeded', 'failed', 'failed', 'failed',
      'failed', 'failed', 'cancelled']);
    expect(() => statusForReason('unknown' as never)).toThrow('RUN_STOP_REASON_INVALID');
    // 预算类停止都落在 failed：成功只有“模型给出了答案”一种。
    expect(stopReasons.filter(reason => statusForReason(reason) === 'succeeded')).toEqual(['answered']);
  });
});
```

**apps/server/src/agent/run-state.ts**

```ts
// Run 的状态机与停止原因：纯函数，不依赖数据库，便于单测与推理。
export const runStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof runStatuses)[number];
export const stopReasons = ['answered', 'step_limit', 'time_limit', 'token_limit', 'tool_failed',
  'model_failed', 'user_cancelled'] as const;
export type StopReason = (typeof stopReasons)[number];

// 只写允许的边：queued 可被认领或取消，running 只能走向终态。
const allowed: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};
const reasonFor: Record<Exclude<RunStatus, 'queued' | 'running'>, readonly StopReason[]> = {
  succeeded: ['answered'],
  failed: ['step_limit', 'time_limit', 'token_limit', 'tool_failed', 'model_failed'],
  cancelled: ['user_cancelled'],
};

export class RunStateError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function isTerminal(status: RunStatus) {
  return allowed[status].length === 0;
}

export function canTransition(from: RunStatus, to: RunStatus) {
  return allowed[from].includes(to);
}

// 终态必须带一个与之匹配的停止原因；非终态不接受停止原因。
export function assertTransition(from: RunStatus, to: RunStatus, reason?: StopReason) {
  if (!canTransition(from, to)) throw new RunStateError('RUN_STATE_INVALID');
  if (isTerminal(to)) {
    const expected = reasonFor[to as keyof typeof reasonFor];
    if (!reason || !expected.includes(reason)) throw new RunStateError('RUN_STOP_REASON_INVALID');
  } else if (reason) throw new RunStateError('RUN_STOP_REASON_INVALID');
}

export function statusForReason(reason: StopReason): RunStatus {
  const found = (Object.keys(reasonFor) as (keyof typeof reasonFor)[])
    .find(status => reasonFor[status].includes(reason));
  if (!found) throw new RunStateError('RUN_STOP_REASON_INVALID');
  return found;
}
```

**apps/server/src/app.module.ts**

```ts
import { AgentModule } from './agent/agent.module.js';
import { AssistantModule } from './assistant/assistant.module.js';
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TicketsModule } from './tickets/tickets.module.js';

@Module({
  imports: [AgentModule, AssistantModule, HealthModule, RedisModule, PrismaModule, TicketsModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**apps/server/src/common/current-user.decorator.ts**

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
export const CurrentUser=createParamDecorator((_data:unknown,context:ExecutionContext)=>
  context.switchToHttp().getRequest<AuthenticatedRequest>().user);
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
```

**packages/shared/src/index.ts**

```ts
// 前后端共用的接口契约：取值常量、zod schema 和由它推导出的类型
export * from './api.js';
export * from './ticket.js';
export * from './permissions.js';
export * from './sse.js';
export * from './assistant.js';
export * from './conversation.js';
export * from './triage.js';
export * from './tool-session.js';
export * from './agent-run.js';
```

## 五、核心面试题

1. 两端都返回 HTTP 200 能说明迁移成功吗？
2. 超时回退能否自动放宽检索范围？
3. 运行成功能否把已给建议的工单标为已完成？

运行记录说明 Agent 是否结束。工单依据用户反馈或人工动作推进。 [本日配套面试题](D106-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

运行轨迹专项以受控模型返回分类，同时验证业务单状态、跨客户拒绝和增量事件。知识发布专项使用本机数据库、Milvus 和 Ollama。[接口验收](../学习记录/新版验收/D154-integration.txt)。
