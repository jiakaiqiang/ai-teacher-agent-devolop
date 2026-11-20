# D109（周四）：每一步的Trace与审计

第 16 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D108-三种预算与停止条件.md)。

## 今天要做出什么

为“读本单日志”和“找通用案例”建立两条工具 Trace，核对耗时和结果摘要。

## 今天的目录结构

- `apps/server/prisma/migrations/20261118184654_agent_traces/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/agent/agent-runs.controller.ts`
- `apps/server/src/agent/agent.module.ts`
- `apps/server/src/agent/run-executor.service.ts`
- `apps/server/src/agent/run-loop.ts`
- `apps/server/src/agent/run-trace.service.ts`
- `apps/server/src/agent/run-trace.spec.ts`
- `packages/shared/src/agent-run.ts`

## 零、闭卷回忆

**D108**　三个预算同时触及时，复盘要保存什么？

<details><summary>核对</summary>

保存配置、实际消耗、停止原因和已完成的工具步骤。

</details>

**D106**　运行成功能否把已给建议的工单标为已完成？

<details><summary>核对</summary>

运行记录说明 Agent 是否结束。工单依据用户反馈或人工动作推进。

</details>

**D102**　接口超时后应该根据哪个标识串起两侧日志？

<details><summary>核对</summary>

两个服务使用同一个请求标识，Node 负责业务授权，Python 只处理收到的限定请求。

</details>

## 一、知识点与推导

关联运行号、工具、状态与受权材料引用，原文在原工单权限下查看。

在两个浏览器会话分别以甲、乙公司提单人身份操作。先记下工单号、工单版本，再创建 run。按序号读取 events，按步骤关联 traces。把另一人的 runId 代入同一个接口，保存拒绝结果。

事件（D107）回答「发生了什么」，载荷是扁平的结构化字段；Trace 回答「这一步到底发给谁、拿回什么」，存的是文本。两者必须分开：事件要小、要能全量读出来做回放；Trace 大、只在排查时按需读。表上 `stepId @unique`——**一步最多一条 Trace**，重复写入说明调用方把同一步记了两次（捕获唯一约束报 `RUN_TRACE_DUPLICATE`）。字段只有必要的几项：`kind`（model/tool）、`input`、`output`（各 2000 字符）、分项 token、耗时、`truncated` 标记、`requestId`（串起同一请求的日志与审计，复用 D41 的请求上下文）。

`prepareField` 做两件事，顺序不能反：先 `redactForLog`（D19 的规则：手机号 → `138****0001`、`Bearer xxx.yyy.zzz` → `Bearer [已隐藏]`、`scrypt$...` → `scrypt$[已隐藏]`），再按**码点**截断。反过来做的后果是：截断可能把 `13800000001` 切成 `138000`，脱敏规则（`\b1\d{10}\b`）不再匹配，于是半截明文手机号就留在库里了。反证 A 去掉脱敏，断言立刻失败。截断按 `Array.from` 的码点切，不会把表情或汉字切成半个字符。

本章踩过一次：列是 `VARCHAR(2000)`，我按 2000 个码点截断后又追加了「…（省略 N 个字符）」，总长度超过 2000，Postgres 直接报 *value too long*。修正是把省略提示算进上限：`kept = limit - suffix 长度`，入库后总长度正好不超过列宽。教训：**截断上限的口径要和存储上限一致**，提示语、引号、包装字段都要算进去。另外 Postgres 的 `VARCHAR(n)` 按字符（码点）计数，和 `Array.from().length` 一致，所以两边口径能对上；如果列是按字节算的类型，就要换成字节口径。

## 二、动手开发

1. 为“读本单日志”和“找通用案例”建立两条工具 Trace，核对耗时和结果摘要。先记录操作者、输入和预期。
2. 记录分步工具输入与结果。在输出中圈出能区分成功和失败的字段。
3. 如何让负责人理解错误，又避免在系统日志复制客户原文？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm exec vitest run src/agent/run-trace.spec.ts
```

<details><summary>提示一 · 先找观察点</summary>

为“读本单日志”和“找通用案例”建立两条工具 Trace，核对耗时和结果摘要。

</details>

<details><summary>提示二 · 切换一个条件</summary>

如何让负责人理解错误，又避免在系统日志复制客户原文？

</details>

<details><summary>提示三 · 对照判定</summary>

关联运行号、工具、状态与受权材料引用，原文在原工单权限下查看。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/prisma/migrations/20261118184654_agent_traces/migration.sql**

```sql
-- CreateTable
CREATE TABLE "agent_traces" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "input" VARCHAR(2000) NOT NULL,
    "output" VARCHAR(2000) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_traces_step_id_key" ON "agent_traces"("step_id");

-- CreateIndex
CREATE INDEX "agent_traces_run_id_ordinal_idx" ON "agent_traces"("run_id", "ordinal");

-- AddForeignKey
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "agent_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 轨迹的类型取值；token 与耗时不为负；序号从 1 开始。
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_kind_check"
    CHECK ("kind" IN ('model', 'tool'));
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_tokens_check"
    CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "duration_ms" >= 0);
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_ordinal_check" CHECK ("ordinal" >= 1);
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
  traces AgentTrace[]
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
  trace AgentTrace?
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

model AgentTrace {
  id String @id @default(uuid(7)) @db.Uuid
  runId String @map("run_id") @db.Uuid
  stepId String @unique @map("step_id") @db.Uuid
  ordinal Int
  kind String @db.VarChar(16)
  input String @db.VarChar(2000)
  output String @db.VarChar(2000)
  inputTokens Int @default(0) @map("input_tokens")
  outputTokens Int @default(0) @map("output_tokens")
  durationMs Int @default(0) @map("duration_ms")
  truncated Boolean @default(false)
  requestId String? @map("request_id") @db.VarChar(64)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  run AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  step AgentStep @relation(fields: [stepId], references: [id], onDelete: Cascade)
  @@index([runId, ordinal])
  @@map("agent_traces")
}
```

**apps/server/src/agent/agent-runs.controller.ts**

```ts
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query } from '@nestjs/common';
import { eventPageSchema, eventViewSchema, runDetailSchema, runListSchema, runStartSchema, runVersionSchema,
  runViewSchema, stepViewSchema, tracePageSchema, traceViewSchema } from '@ops-ticket/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';
import { RunTraceService } from './run-trace.service.js';
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
  constructor(private readonly runs: AgentRunsService, private readonly journal: AgentJournalService,
    private readonly traces: RunTraceService) {}

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

  // Trace 只给运行的发起人；内容已在写入时脱敏并截断。
  @Get(':id/traces')
  async traceList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    try {
      const run = await this.runs.get(user, id);
      const rows = await this.traces.list(run.id);
      return tracePageSchema.parse({
        runId: run.id,
        traces: rows.map(row => traceViewSchema.parse({
          ordinal: row.ordinal, kind: row.kind, input: row.input, output: row.output,
          inputTokens: row.inputTokens, outputTokens: row.outputTokens,
          durationMs: row.durationMs, truncated: row.truncated,
        })),
        usage: await this.traces.usage(run.id),
      });
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
import { RunExecutorService } from './run-executor.service.js';
import { RunTraceService } from './run-trace.service.js';


// 复用 AssistantModule 导出的只读工具与权限指纹，不重复实现数据权限。
@Module({ imports: [AssistantModule], controllers: [AgentRunsController],
  providers: [AgentRunsService, AgentJournalService, RunExecutorService, RunTraceService],
  exports: [AgentRunsService, AgentJournalService, RunExecutorService, RunTraceService] })
export class AgentModule {}
```

**apps/server/src/agent/run-executor.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';

import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';
import { RunTraceService } from './run-trace.service.js';

import { parseBudget, type RunBudget } from './run-budget.js';
import { runLoop, type StepOutcome, type StepRequest } from './run-loop.js';
import { RunFailure } from './run-errors.js';

export type Think = (request: StepRequest, context: { ticketNo: string; goal: string }) => Promise<StepOutcome>;

@Injectable()
export class RunExecutorService {
  constructor(private readonly runs: AgentRunsService, private readonly journal: AgentJournalService,
    private readonly traces: RunTraceService, 
    ) {}

  // 认领 → 逐步执行 → 把停止原因写进 Run。每一步的状态与事件由 journal 落库。
  async execute(user: AuthUser, runId: string, think: Think, budget: Partial<RunBudget> = {}) {
    const limits = parseBudget(budget);
    const claimed = await this.runs.claim(user, runId, (await this.runs.get(user, runId)).version);
    await this.journal.record(claimed.id, 'run_started',
      { ticketNo: claimed.ticketNo, maxSteps: limits.maxSteps, maxMs: limits.maxMs, maxTokens: limits.maxTokens });
    const context = { ticketNo: claimed.ticketNo, goal: claimed.goal };
    const result = await runLoop({
      budget: limits,
      think: request => think(request, context),
      onStep: async (outcome, request) => {
        const startedAt = Date.now();
        const { step } = await this.journal.beginStep(claimed.id, outcome.phase, outcome.summary);
        if (step.ordinal !== request.ordinal) throw new RunFailure('RUN_STEP_ORDINAL_MISMATCH');
        if (outcome.trace) {
          // Trace 与步骤一一对应；内容先脱敏再截断，正文不进事件。
          await this.traces.record(claimed.id, {
            stepId: step.id, ordinal: step.ordinal, kind: outcome.trace.kind,
            input: outcome.trace.input, output: outcome.trace.output,
            inputTokens: outcome.trace.inputTokens, outputTokens: outcome.trace.outputTokens,
            durationMs: Date.now() - startedAt,
          });
        }
        await this.journal.endStep(step.id, outcome.failure
          ? { status: 'failed', errorCode: outcome.failure }
          : { status: 'succeeded' });
      },
    });
    const current = await this.runs.get(user, runId);
    const finished = await this.runs.finish(current.id, current.version, result.reason);
    const usage = await this.traces.usage(finished.id);
    await this.journal.record(finished.id, 'run_finished',
      { stopReason: result.reason, steps: result.spend.steps, tokens: result.spend.tokens,
        elapsedMs: Math.trunc(result.spend.elapsedMs), answer: result.answer });
    return { run: finished, result, usage };
  }
}
```

**apps/server/src/agent/run-loop.ts**

```ts
import { exhausted, stepDeadlineMs, type RunBudget, type RunSpend } from './run-budget.js';
import type { StepPhase } from './agent-journal.service.js';
import type { StopReason } from './run-state.js';

export interface StepRequest { ordinal: number; deadlineMs: number; spend: RunSpend; }
export interface StepOutcome {
  phase: StepPhase;
  summary: string;
  tokens: number;
  // Trace 用：这一步实际发给模型/工具的内容与拿回的结果，以及分项用量。
  trace?: { kind: 'model' | 'tool'; input: string; output: string; inputTokens?: number; outputTokens?: number };
  // answer 非空表示本步给出了最终答案，循环就此结束。
  answer?: string;
  failure?: string;
}
export interface LoopHooks {
  budget: RunBudget;
  now?: () => number;
  think: (request: StepRequest) => Promise<StepOutcome>;
  onStep: (outcome: StepOutcome, request: StepRequest) => Promise<void>;
}
export interface LoopResult { reason: StopReason; spend: RunSpend; answer: string | null; }

// 推理-行动循环：每一步之前检查三种预算，任何一项用完就停并给出原因。
// 这里不碰数据库，也不认识模型：think 由调用方注入（测试注入假实现，D111 注入真实链路）。
export async function runLoop(hooks: LoopHooks): Promise<LoopResult> {
  const now = hooks.now ?? (() => Date.now());
  const startedAt = now();
  const spend: RunSpend = { steps: 0, elapsedMs: 0, tokens: 0 };
  for (;;) {
    spend.elapsedMs = now() - startedAt;
    const stop = exhausted(hooks.budget, spend);
    if (stop) return { reason: stop, spend, answer: null };
    const request: StepRequest = {
      ordinal: spend.steps + 1,
      deadlineMs: stepDeadlineMs(hooks.budget, spend),
      spend: { ...spend },
    };
    let outcome: StepOutcome;
    try {
      outcome = await hooks.think(request);
    } catch (error) {
      // 单步异常也要先记账：这一步已经发生过，步数和耗时都算。
      spend.steps += 1;
      spend.elapsedMs = now() - startedAt;
      await hooks.onStep({ phase: 'plan', summary: '单步异常', tokens: 0,
        failure: error instanceof Error ? error.message : 'STEP_FAILED' }, request);
      return { reason: 'model_failed', spend, answer: null };
    }
    spend.steps += 1;
    spend.tokens += Math.max(0, Math.trunc(outcome.tokens));
    spend.elapsedMs = now() - startedAt;
    await hooks.onStep(outcome, request);
    if (outcome.failure) return { reason: 'tool_failed', spend, answer: null };
    if (outcome.answer) return { reason: 'answered', spend, answer: outcome.answer };
  }
}
```

**apps/server/src/agent/run-trace.service.ts**

```ts
import { Injectable } from '@nestjs/common';
import { redactForLog } from '../common/sensitive.js';
import { currentRequestId } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunFailure } from './run-errors.js';

export const TRACE_FIELD_LIMIT = 2000;
export type TraceKind = 'model' | 'tool';
export interface TraceInput {
  stepId: string;
  ordinal: number;
  kind: TraceKind;
  input: string;
  output: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

// 先脱敏再截断：顺序反了会把一半的手机号或令牌留在文本里。
// limit 是入库后的总长度上限（列是 VARCHAR(2000)，按字符计），所以省略提示也要算进去。
export function prepareField(value: string, limit = TRACE_FIELD_LIMIT) {
  const redacted = redactForLog(typeof value === 'string' ? value : String(value));
  const points = Array.from(redacted);
  if (points.length <= limit) return { text: redacted, truncated: false };
  const omitted = points.length - limit;
  const suffix = `…（省略 ${omitted} 个字符）`;
  const kept = Math.max(0, limit - Array.from(suffix).length);
  // 按码点截断，不切断表情或汉字。
  return { text: points.slice(0, kept).join('') + suffix, truncated: true };
}

const counts = (value: number | undefined) => {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new RunFailure('RUN_TRACE_INVALID');
  return value;
};

@Injectable()
export class RunTraceService {
  constructor(private readonly db: PrismaService) {}

  // 一步最多一条 Trace（stepId 唯一）：重复写入说明调用方把同一步记了两次。
  async record(runId: string, trace: TraceInput) {
    if (trace.kind !== 'model' && trace.kind !== 'tool') throw new RunFailure('RUN_TRACE_INVALID');
    if (!Number.isSafeInteger(trace.ordinal) || trace.ordinal < 1) throw new RunFailure('RUN_TRACE_INVALID');
    const input = prepareField(trace.input);
    const output = prepareField(trace.output);
    try {
      return await this.db.agentTrace.create({
        data: {
          runId, stepId: trace.stepId, ordinal: trace.ordinal, kind: trace.kind,
          input: input.text, output: output.text,
          inputTokens: counts(trace.inputTokens), outputTokens: counts(trace.outputTokens),
          durationMs: counts(trace.durationMs),
          truncated: input.truncated || output.truncated,
          requestId: currentRequestId() ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('agent_traces_step_id_key')) {
        throw new RunFailure('RUN_TRACE_DUPLICATE');
      }
      throw error;
    }
  }

  async list(runId: string) {
    return this.db.agentTrace.findMany({ where: { runId }, orderBy: { ordinal: 'asc' }, take: 8 });
  }

  // 用量汇总：供 run_finished 事件与审计使用，不重新解析正文。
  async usage(runId: string) {
    const rows = await this.list(runId);
    return rows.reduce((total, row) => ({
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      durationMs: total.durationMs + row.durationMs,
      traces: total.traces + 1,
      truncated: total.truncated || row.truncated,
    }), { inputTokens: 0, outputTokens: 0, durationMs: 0, traces: 0, truncated: false });
  }
}
```

**apps/server/src/agent/run-trace.spec.ts**

```ts
import { prepareField, TRACE_FIELD_LIMIT } from './run-trace.service.js';

describe('Trace 字段处理', () => {
  it('先脱敏再截断：手机号、令牌、口令哈希都不会留半截', () => {
    const text = '联系人 13800000001，Bearer aaa.bbb.ccc，口令 scrypt$16384$8$1$abcdef';
    const { text: masked, truncated } = prepareField(text);
    expect(truncated).toBe(false);
    expect(masked).toContain('138****0001');
    expect(masked).toContain('Bearer [已隐藏]');
    expect(masked).toContain('scrypt$[已隐藏]');
    expect(masked).not.toContain('13800000001');
    expect(masked).not.toContain('aaa.bbb.ccc');
    // 截断发生在脱敏之后：先截断会把手机号切成明文片段
    const long = '联系人 13800000001；'.repeat(200);
    const result = prepareField(long, 40);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('138****0001');
    expect(result.text).not.toMatch(/\d{11}/);
  });

  it('超长按码点截断并标注省略数量', () => {
    const emoji = '😀'.repeat(TRACE_FIELD_LIMIT + 5);
    const { text, truncated } = prepareField(emoji);
    expect(truncated).toBe(true);
    // 总长度不超过列宽：省略提示也算在 limit 里面
    expect(Array.from(text)).toHaveLength(TRACE_FIELD_LIMIT);
    expect(text.endsWith('…（省略 5 个字符）')).toBe(true);
    // 不切断代理对：保留下来的每个码点都仍是完整的表情
    const kept = text.slice(0, text.indexOf('…'));
    expect(Array.from(kept).every(point => point === '😀')).toBe(true);
    const exact = prepareField('一'.repeat(TRACE_FIELD_LIMIT));
    expect(exact.truncated).toBe(false);
  });
});
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

export const traceViewSchema = z.object({
  ordinal: z.number().int().min(1),
  kind: z.enum(['model', 'tool']),
  input: z.string().max(2100),
  output: z.string().max(2100),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  truncated: z.boolean(),
}).strict();

export const tracePageSchema = z.object({
  runId: z.uuid(),
  traces: z.array(traceViewSchema).max(8),
  usage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    durationMs: z.number().int().min(0),
    traces: z.number().int().min(0),
    truncated: z.boolean(),
  }).strict(),
}).strict();

export type TraceView = z.infer<typeof traceViewSchema>;
```

## 五、核心面试题

1. 三个预算同时触及时，复盘要保存什么？
2. 运行成功能否把已给建议的工单标为已完成？
3. 如何让负责人理解错误，又避免在系统日志复制客户原文？

关联运行号、工具、状态与受权材料引用，原文在原工单权限下查看。 [本日配套面试题](D109-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

运行轨迹专项以受控模型返回分类，同时验证业务单状态、跨客户拒绝和增量事件。知识发布专项使用本机数据库、Milvus 和 Ollama。[接口验收](../学习记录/新版验收/D154-integration.txt)。
