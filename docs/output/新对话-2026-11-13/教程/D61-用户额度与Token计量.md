# D61（周五）：用户额度与Token计量

第 9 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D60-结构化输出与校验重试.md)。

## 今天要做出什么

同一用户同时发出 20 个预留申请，记录成功数，再对一个成功请求并发结算两次。

## 今天的目录结构

- `apps/server/prisma/migrations/20261117100000_ai_quota/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/assistant/ai-quota.service.ts`
- `apps/server/src/assistant/assistant.module.ts`
- `apps/server/src/assistant/model-gateway.ts`
- `apps/server/src/assistant/triage.service.ts`
- `apps/server/src/assistant/usage-meter.spec.ts`
- `apps/server/src/assistant/usage-meter.ts`
- `apps/server/test/quota.e2e-spec.ts`

## 零、闭卷回忆

**D60**　结构正确就可以把引用展示给提单人吗？

<details><summary>核对</summary>

结构校验只检字段。进入业务层后还要把 evidenceIds 与当前请求确实提供的资料编号比对。

</details>

**D58**　已经交付第一段文字的请求可以从头重试吗？

<details><summary>核对</summary>

已输出正文后重放会产生重复内容。重试受错误种类、已发送内容和总期限约束。

</details>

**D54**　卡片显示 completed 时，负责人是否已经收到派单？

<details><summary>核对</summary>

卡片状态只描述这一轮展示。派单要有提单人的人工接入事件，首字时间从发起到首个文本增量计算。

</details>

## 一、知识点与推导

以用户和 UTC 日期查余额，请求键去重，条件更新避免重复扣费。将模拟用量和已知用量分开记。

知识点示例取自当天已通过测试，按TypeScript语法树排版。示例依赖同一测试文件中的导入与夹具，不能单独粘贴执行；先完成第四节对应文件，再在指定目录运行命令。数据库示例沿用隔离测试数据清理范围。

### 1.1 先固定计量口径

usage必须有非负安全整数prompt_tokens/completion_tokens/total_tokens，总数一致且单次不超过100万。每次HTTP尝试start，合法usage才record；失败尝试或缺usage使整次统计标为非精确。语义修复前的坏输出同样消耗token。

**可运行示例：修复前后两次输出都计量**

来源：`apps/server/src/assistant/usage-meter.spec.ts`。以下断言包含具体输入与预期结果，完整夹具见第四节。

```ts
it('修复前后两次输出都计量', () => { const meter = new UsageMeter(); for (let i = 0; i < 2; i++) {
    meter.start();
    meter.record({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
} expect(meter.summary()).toEqual({ inputTokens: 20, outputTokens: 10, exact: true, attempts: 2 }); expect(usageCharge(meter.summary())).toBe(40); if (process.env.D61_EVIDENCE_FILE)
    appendFileSync(process.env.D61_EVIDENCE_FILE, JSON.stringify({ case: 'usage-meter', ...meter.summary(), units: usageCharge(meter.summary()), currency: false }) + '\n'); });
```

在`apps/server`运行：

```powershell
pnpm test src/assistant/usage-meter.spec.ts -t "修复前后两次输出都计量"
```

**推导题：只统计最终成功回复会漏什么？**

<details><summary>答案</summary>

HTTP重试、失败响应、被schema拒绝的生成可能均收费，最终正文不能代表总消耗。

</details>

### 1.2 预留用数据库条件更新

事务内先建立日账户和唯一请求预留，再UPDATE available>=reserved条件扣减。只有成功扣减才提交预留；额度不足回滚。不要先读余额再普通UPDATE，也不复用fail-open Redis限流作为金额账本。

**可运行示例：20个并发预留最多4个成功**

来源：`apps/server/test/quota.e2e-spec.ts`。以下断言包含具体输入与预期结果，完整夹具见第四节。

```ts
it('20个并发预留最多4个成功', async () => { const id = await user(); const result = await Promise.allSettled(Array.from({ length: 20 }, () => service.reserve(id, randomUUID(), now))); const successful = result.filter(r => r.status === 'fulfilled').length; expect(successful).toBe(4); expect((await balance(id)).available).toBe(0); expect(await db.aiUsage.count({ where: { userId: id } })).toBe(4); if (process.env.D61_EVIDENCE_FILE)
    appendFileSync(process.env.D61_EVIDENCE_FILE, JSON.stringify({ case: 'atomic-quota', requests: 20, successful, rejected: 20 - successful, remaining: 0 }) + '\n'); });
```

在`apps/server`运行：

```powershell
pnpm test:e2e test/quota.e2e-spec.ts -t "20个并发预留最多4个成功"
```

**推导题：20个并发请求为什么只允许4个预留？**

<details><summary>答案</summary>

每个预留5万、总额20万，条件更新在数据库中原子竞争；后续请求看到余额不足而回滚。

</details>

### 1.3 结算必须幂等

用usage.status=pending条件更新抢占结算，只有成功者调整账户。相同结果重放返回已结算记录，不同金额报冲突。真实已知消耗超过预留时余额可负，后续生成被挡住；不能伪造余额或丢弃消耗。

**可运行示例：并发重复结算不会重复退款**

来源：`apps/server/test/quota.e2e-spec.ts`。以下断言包含具体输入与预期结果，完整夹具见第四节。

```ts
it('并发重复结算不会重复退款', async () => { const id = await user(), reservation = await service.reserve(id, randomUUID(), now); await Promise.all([service.settle(reservation, exact), service.settle(reservation, exact)]); expect((await balance(id)).available).toBe(DAILY_UNITS - 20); expect((await db.aiUsage.findUniqueOrThrow({ where: { id: reservation } })).status).toBe('exact'); });
```

在`apps/server`运行：

```powershell
pnpm test:e2e test/quota.e2e-spec.ts -t "并发重复结算不会重复退款"
```

**推导题：进程在预留后崩溃怎么办？**

<details><summary>答案</summary>

保持pending及占用量，等待有证据的对账；不能定时盲目退款，否则未知远端消耗会变免费。

</details>

### 1.4 估算与账单分开

完整usage才按输入+2×输出结算；有未知尝试时至少保留5万，已知部分超过5万则取已知消耗。此口径保守但不是供应商账单：缓存、推理token和不同模型价格仍需真实计费契约。

**可运行示例：未知usage保留预留量并标estimated**

来源：`apps/server/test/quota.e2e-spec.ts`。以下断言包含具体输入与预期结果，完整夹具见第四节。

```ts
it('未知usage保留预留量并标estimated', async () => { const id = await user(), reservation = await service.reserve(id, randomUUID(), now); const row = await service.settle(reservation, { inputTokens: 0, outputTokens: 0, exact: false, attempts: 1 }); expect(row.status).toBe('estimated'); expect((await balance(id)).available).toBe(DAILY_UNITS - RESERVATION_UNITS); });
```

在`apps/server`运行：

```powershell
pnpm test:e2e test/quota.e2e-spec.ts -t "未知usage保留预留量并标estimated"
```

**推导题：mock为什么可以结算0？**

<details><summary>答案</summary>

没有任何模型HTTP尝试，0请求是可确定的；未知网络错误则不是0。

</details>

## 二、动手开发

### 步骤1：新增账户和用量表

<details><summary>提示1：方向</summary>

只追加迁移，历史业务表保留；本章迁移在隔离测试库验证。

</details>
<details><summary>提示2：API与文档位置</summary>

AiQuota、AiUsage、migration.sql；根ci自动generate，e2e部署迁移。

</details>
<details><summary>提示3：伪代码</summary>

账户复合主键user/day；请求唯一user/requestKey；CHECK约束待结算与已结算字段完整性。

</details>

### 步骤2：写原子预留和幂等结算

<details><summary>提示1：方向</summary>

所有扣减/退款与记录状态在同一事务。

</details>
<details><summary>提示2：API与文档位置</summary>

AiQuotaService.reserve/settle；updateMany.count。

</details>
<details><summary>提示3：伪代码</summary>

创建预留→条件扣减→提交；结算pending→调整差额→返回；冲突重放核对金额。

</details>

### 步骤3：接通每次HTTP计量

<details><summary>提示1：方向</summary>

在真正发请求的工作函数里start，而不是控制器只加一次。

</details>
<details><summary>提示2：API与文档位置</summary>

UsageMeter、ModelGateway.complete、TriageService.suggest。

</details>
<details><summary>提示3：伪代码</summary>

每attempt start→完整响应record；结构修复共享meter→最终summary。

</details>

### 步骤4：运行真实数据库并发反证

<details><summary>提示1：方向</summary>

只使用授权隔离测试库，随机测试用户不触碰开发数据。

</details>
<details><summary>提示2：API与文档位置</summary>

quota.e2e-spec.ts；20并发与两次并发结算。

</details>
<details><summary>提示3：伪代码</summary>

放掉余额条件→超额；去掉pending条件→重复退款；恢复逐字及SHA再完整门禁。

</details>

三级提示仍无法完成再看第四节，并记一次需要复测。

```powershell
pnpm build
pnpm test
# apps/server 目录
pnpm lint --max-warnings 0
pnpm test:e2e
pnpm test:e2e
pnpm test:e2e
```

也可根目录运行 `pnpm run ci` 顺序执行以上门禁。只重置已授权的隔离测试库和Redis 1号库。shared通过dist导入，改完先build。

在 `apps/server` 运行 `pnpm exec vitest run src/assistant/usage-meter.spec.ts`。

在 `apps/server` 运行 `pnpm exec vitest run --config vitest.config.e2e.ts test/quota.e2e-spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

同一用户同时发出 20 个预留申请，记录成功数，再对一个成功请求并发结算两次。

</details>

<details><summary>提示二 · 切换一个条件</summary>

乙公司的另一个提单人是否也会被本次预留扣额？

</details>

<details><summary>提示三 · 对照判定</summary>

以用户和 UTC 日期查余额，请求键去重，条件更新避免重复扣费。将模拟用量和已知用量分开记。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/prisma/migrations/20261117100000_ai_quota/migration.sql**

```sql
-- 只新增表，不重置开发数据。
CREATE TABLE ai_quotas (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 period varchar(10) NOT NULL,
 available integer NOT NULL DEFAULT 200000,
 PRIMARY KEY (user_id,period)
);
CREATE TABLE ai_usage (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 period varchar(10) NOT NULL,
 request_key uuid NOT NULL,
 reserved integer NOT NULL CHECK (reserved > 0),
 charged integer CHECK (charged >= 0),
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','exact','estimated')),
 input_tokens integer CHECK (input_tokens >= 0),
 output_tokens integer CHECK (output_tokens >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 FOREIGN KEY (user_id,period) REFERENCES ai_quotas(user_id,period) ON DELETE RESTRICT,
 CONSTRAINT ai_usage_settlement_complete CHECK (
  (status='pending' AND charged IS NULL AND input_tokens IS NULL AND output_tokens IS NULL AND settled_at IS NULL)
  OR (status IN ('exact','estimated') AND charged IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND settled_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX ai_usage_user_request_unique ON ai_usage(user_id,request_key);
CREATE INDEX ai_usage_user_id_period_idx ON ai_usage(user_id,period);
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
  aiQuotas AiQuota[]
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
```

**apps/server/src/assistant/ai-quota.service.ts**

```ts
import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DAILY_UNITS, RESERVATION_UNITS, usageCharge, type UsageSummary } from './usage-meter.js';

@Injectable()
export class AiQuotaService {
  constructor(private readonly prisma:PrismaService){}
  async reserve(userId:string,requestKey:string,now=new Date()) {
    const period=now.toISOString().slice(0,10); // 明确使用UTC自然日，不随浏览器时区变化。
    return this.prisma.$transaction(async tx=>{
      await tx.aiQuota.createMany({data:[{userId,period,available:DAILY_UNITS}],skipDuplicates:true});
      const [reservation]=await tx.aiUsage.createManyAndReturn({data:[{userId,period,requestKey,reserved:RESERVATION_UNITS}],skipDuplicates:true,select:{id:true}});
      if(!reservation)throw new ConflictException({code:'AI_REQUEST_ALREADY_USED',message:'请求标识已使用，请勿重复生成'});
      const changed=await tx.aiQuota.updateMany({where:{userId,period,available:{gte:RESERVATION_UNITS}},data:{available:{decrement:RESERVATION_UNITS}}});
      if(changed.count!==1)throw new HttpException({code:'AI_QUOTA_EXCEEDED',message:'今日AI额度不足'},429);
      return reservation.id;
    });
  }
  async settle(id:string,summary:UsageSummary) {
    const charged=usageCharge(summary),status=summary.exact?'exact':'estimated';
    return this.prisma.$transaction(async tx=>{
      const row=await tx.aiUsage.findUniqueOrThrow({where:{id}});
      const changed=await tx.aiUsage.updateMany({where:{id,status:'pending'},data:{charged,status,inputTokens:summary.inputTokens,outputTokens:summary.outputTokens,settledAt:new Date()}});
      if(changed.count===0){
        const existing=await tx.aiUsage.findUniqueOrThrow({where:{id}});
        if(existing.charged!==charged||existing.status!==status||existing.inputTokens!==summary.inputTokens||existing.outputTokens!==summary.outputTokens)throw new ConflictException('AI_SETTLEMENT_CONFLICT');
        return existing;
      }
      // 实际消耗超过预留时允许余额为负，忠实记账并阻止新预留；不是供应商硬限额。
      await tx.aiQuota.update({where:{userId_period:{userId:row.userId,period:row.period}},data:{available:{increment:row.reserved-charged}}});
      return tx.aiUsage.findUniqueOrThrow({where:{id}});
    });
  }
}
```

**apps/server/src/assistant/assistant.module.ts**

```ts
import { AiQuotaService } from './ai-quota.service.js';
import { TriageService } from './triage.service.js';
import { AssistantStreams } from './stream-lifecycle.js';
import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { ModelSource } from './model.source.js';
import { ModelGateway } from './model-gateway.js';

@Module({ controllers: [AssistantController], providers: [AiQuotaService, TriageService, AssistantService, ModelSource, ModelGateway, AssistantStreams], exports: [AiQuotaService, TriageService, AssistantStreams, ModelGateway] })
export class AssistantModule {}
```

**apps/server/src/assistant/model-gateway.ts**

```ts
import type { UsageMeter } from './usage-meter.js';
import { Injectable } from '@nestjs/common';
import { ChatClient, ModelError, type ChatMessage } from './chat.client.js';
import { readModelRegistry } from './model-registry.js';
import { mockStream } from './mock-stream.js';
import { ModelPolicy, GatewayFailure } from './model-policy.js';
import { requestCompletion } from './model-completion.js';

@Injectable()
export class ModelGateway {
  private readonly policies = new Map<string, ModelPolicy>();
  async complete(messages: ChatMessage[], signal?: AbortSignal, alias = 'default', budgetMs = 5000, responseFormat?: Record<string, unknown>, meter?: UsageMeter): Promise<unknown> {
    const registry = readModelRegistry();
    const config = registry.resolve(alias);
    if (!config) throw new GatewayFailure('MODEL_CONFIG_ERROR');
    // 按受控别名保存进程内状态；配置变更需重启，最多8个。
    for (const key of this.policies.keys()) if (!registry.aliases().includes(key)) this.policies.delete(key);
    let policy = this.policies.get(alias);
    if (!policy) { policy = new ModelPolicy(); this.policies.set(alias, policy); }
    return policy.run(async child => { meter?.start(); const raw = await requestCompletion(config, messages, child, responseFormat); meter?.record(raw); return raw; }, signal, budgetMs);
  }
  async stream(messages: ChatMessage[], signal: AbortSignal, alias = 'default') {
    signal.throwIfAborted();
    const config = readModelRegistry().resolve(alias);
    if (!config) return { body: mockStream(signal), mode: 'mock' as const };
    const response = await new ChatClient(config).open(messages, true, signal);
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
      await response.body?.cancel(); throw new ModelError('MODEL_PROTOCOL_ERROR');
    }
    // 本周流式保持W7预算与终止校验；不会在已发正文后重放请求。
    return { body: response.body, mode: 'model' as const };
  }
}
```

**apps/server/src/assistant/triage.service.ts**

```ts
import { UsageMeter } from './usage-meter.js';
import { Injectable } from '@nestjs/common';
import { triageSuggestionSchema, type TriageResult } from '@ops-ticket/shared';
import { ModelGateway } from './model-gateway.js';
import { readModelRegistry } from './model-registry.js';
import { buildTriagePrompt, triageInputSchema } from './prompt-catalog.js';
import { GatewayFailure, abortable } from './model-policy.js';
import { parseTriageOutput, triageResponseFormat } from './triage-output.js';

@Injectable()
export class TriageService {
  constructor(private readonly gateway: ModelGateway) {}
  async suggest(input: unknown, parent?: AbortSignal, alias = 'default', meter = new UsageMeter()): Promise<TriageResult> {
    if(parent?.aborted) throw new GatewayFailure('MODEL_CANCELLED');
    const data = triageInputSchema.parse(input);
    const prompt = buildTriagePrompt(data);
    if (!readModelRegistry().resolve(alias)) {
      return { suggestion: triageSuggestionSchema.parse({intent:'资料不足',steps:[],evidenceIds:[],missingInformation:['请核对日志与适用手册。']}), mode:'mock',promptVersion:prompt.version,promptHash:prompt.hash,validationAttempts:0 };
    }
    const controller = new AbortController();
    const cancel = () => controller.abort(new GatewayFailure('MODEL_CANCELLED'));
    parent?.addEventListener('abort',cancel,{once:true});
    const deadline = Date.now() + 5000;
    const timer = setTimeout(()=>controller.abort(new GatewayFailure('MODEL_TIMEOUT',true)),5000);
    try {
      for(let attempt=1;attempt<=2;attempt++) {
        controller.signal.throwIfAborted();
        const messages = attempt===1 ? prompt.messages : [...prompt.messages,{role:'user' as const,content:'上次输出未通过JSON字段校验。请按原任务和schema重新输出完整JSON，不要Markdown或额外字段。'}];
        const raw = await abortable(this.gateway.complete(messages,controller.signal,alias,Math.max(0,deadline-Date.now()),triageResponseFormat,meter),controller.signal);
        try {
          return {suggestion:parseTriageOutput(raw),mode:'model',promptVersion:prompt.version,promptHash:prompt.hash,validationAttempts:attempt};
        } catch(error) {
          // 只修复JSON语法或业务schema失败；拒绝、截断和协议异常不自动重生成。
          if (!(error instanceof GatewayFailure) || error.code!=='MODEL_INVALID_OUTPUT' || attempt===2) throw error;
        }
      }
      throw new GatewayFailure('MODEL_INVALID_OUTPUT');
    } finally { clearTimeout(timer);parent?.removeEventListener('abort',cancel); }
  }
}
```

**apps/server/src/assistant/usage-meter.spec.ts**

```ts
import { appendFileSync } from 'node:fs';
import {parseUsage,UsageMeter,usageCharge,RESERVATION_UNITS} from './usage-meter.js';
import {ModelGateway} from './model-gateway.js';
import {TriageService} from './triage.service.js';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function configured(){vi.stubEnv('LLM_BASE_URL','https://example.test/v1');vi.stubEnv('LLM_API_KEY','fake-only');vi.stubEnv('LLM_MODEL','fixture');vi.stubEnv('LLM_MODEL_ROUTES','');}
describe('模型用量口径（D61）',()=>{
 it('接受一致的整数usage',()=>{expect(parseUsage({usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}})).toEqual({inputTokens:10,outputTokens:3});});
 it('缺失负数小数和总数不一致均不当精确值',()=>{for(const usage of [undefined,{prompt_tokens:-1,completion_tokens:1,total_tokens:0},{prompt_tokens:1.2,completion_tokens:1,total_tokens:2.2},{prompt_tokens:1,completion_tokens:2,total_tokens:4}])expect(parseUsage({usage})).toBeNull();});
 it('修复前后两次输出都计量',()=>{const meter=new UsageMeter();for(let i=0;i<2;i++){meter.start();meter.record({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});}expect(meter.summary()).toEqual({inputTokens:20,outputTokens:10,exact:true,attempts:2});expect(usageCharge(meter.summary())).toBe(40);if(process.env.D61_EVIDENCE_FILE)appendFileSync(process.env.D61_EVIDENCE_FILE,JSON.stringify({case:'usage-meter',...meter.summary(),units:usageCharge(meter.summary()),currency:false})+'\n');});
 it('未知失败消耗不能当零退还',()=>{const meter=new UsageMeter();meter.start();expect(meter.summary().exact).toBe(false);expect(usageCharge(meter.summary())).toBe(RESERVATION_UNITS);});
 it('已知消耗超过预留仍如实计量',()=>{expect(usageCharge({inputTokens:60000,outputTokens:2,exact:false,attempts:1})).toBe(60004);});
 it('模拟零请求为精确零',()=>{expect(usageCharge(new UsageMeter().summary())).toBe(0);});
 it('不接受无界和负数汇总',()=>{expect(()=>usageCharge({inputTokens:-1,outputTokens:0,exact:true,attempts:1})).toThrow('USAGE_INVALID');expect(()=>usageCharge({inputTokens:0,outputTokens:0,exact:true,attempts:5})).toThrow('USAGE_INVALID');});
 it('网关每次HTTP尝试都进入计量',async()=>{configured();vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('fail',{status:503})).mockResolvedValueOnce(Response.json({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})));const meter=new UsageMeter();const pending=new ModelGateway().complete([],undefined,'default',5000,undefined,meter);await vi.runAllTimersAsync();await pending;expect(meter.summary()).toEqual({inputTokens:10,outputTokens:5,exact:false,attempts:2});});
 it('分诊修复的坏输出也累计usage',async()=>{configured();const answer=(text:string)=>Response.json({choices:[{index:0,finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});const valid={intent:'超时',steps:[],evidenceIds:[],missingInformation:['服务端日志']};vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(answer('{}')).mockResolvedValueOnce(answer(JSON.stringify(valid))));const meter=new UsageMeter();await new TriageService(new ModelGateway()).suggest({description:'故障'},undefined,'default',meter);expect(meter.summary()).toEqual({inputTokens:20,outputTokens:10,exact:true,attempts:2});});
});
```

**apps/server/src/assistant/usage-meter.ts**

```ts
// 教学额度单位：输入token=1单位，输出token=2单位；不是供应商人民币价格。
export const RESERVATION_UNITS = 50000;
export const DAILY_UNITS = 200000;
export interface UsageSummary { inputTokens: number; outputTokens: number; exact: boolean; attempts: number; }
export function parseUsage(raw: unknown): { inputTokens: number; outputTokens: number } | null {
  const usage = (raw as {usage?:{prompt_tokens?:unknown;completion_tokens?:unknown;total_tokens?:unknown}} | null)?.usage;
  if(!usage) return null;
  const values=[usage.prompt_tokens,usage.completion_tokens,usage.total_tokens];
  if(values.some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1000000)) return null;
  const input=usage.prompt_tokens as number, output=usage.completion_tokens as number;
  if(input+output!==usage.total_tokens) return null;
  return {inputTokens:input,outputTokens:output};
}
export class UsageMeter {
  private attempts=0;private received=0;private inputTokens=0;private outputTokens=0;
  start(){this.attempts++;}
  record(raw:unknown){const u=parseUsage(raw);if(u){this.received++;this.inputTokens+=u.inputTokens;this.outputTokens+=u.outputTokens;}}
  summary():UsageSummary{return {inputTokens:this.inputTokens,outputTokens:this.outputTokens,exact:this.attempts===this.received,attempts:this.attempts};}
}
export function usageCharge(summary:UsageSummary) {
  if(!Number.isSafeInteger(summary.attempts)||summary.attempts<0||summary.attempts>4||!Number.isSafeInteger(summary.inputTokens)||!Number.isSafeInteger(summary.outputTokens)||summary.inputTokens<0||summary.outputTokens<0||summary.inputTokens>4000000||summary.outputTokens>4000000)throw new Error('USAGE_INVALID');
  const known=summary.inputTokens+summary.outputTokens*2;
  return summary.exact ? known : Math.max(RESERVATION_UNITS,known);
}
```

**apps/server/test/quota.e2e-spec.ts**

```ts
import type {INestApplication} from '@nestjs/common';
import {Test} from '@nestjs/testing';
import {randomUUID} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {AppModule} from '../src/app.module.js';
import {configureApp} from '../src/app.setup.js';
import {PrismaService} from '../src/prisma/prisma.service.js';
import {AiQuotaService} from '../src/assistant/ai-quota.service.js';
import {DAILY_UNITS,RESERVATION_UNITS} from '../src/assistant/usage-meter.js';
describe('数据库AI额度（D61）',()=>{
 let app:INestApplication,db:PrismaService,service:AiQuotaService;
 const now=new Date('2026-11-17T12:00:00Z'),period='2026-11-17';
 const exact={inputTokens:10,outputTokens:5,exact:true,attempts:1};
 beforeAll(async()=>{const m=await Test.createTestingModule({imports:[AppModule]}).compile();app=m.createNestApplication();configureApp(app);await app.init();db=app.get(PrismaService);service=app.get(AiQuotaService);});
 afterAll(async()=>{await app.close();});
 async function user(){return (await db.user.create({data:{username:'quota-'+randomUUID(),displayName:'隔离额度测试',role:'reporter',companyId:(await db.company.findFirstOrThrow()).id}})).id;}
 const balance=(userId:string,p=period)=>db.aiQuota.findUniqueOrThrow({where:{userId_period:{userId,period:p}}});
 it('20个并发预留最多4个成功',async()=>{const id=await user();const result=await Promise.allSettled(Array.from({length:20},()=>service.reserve(id,randomUUID(),now)));const successful=result.filter(r=>r.status==='fulfilled').length;expect(successful).toBe(4);expect((await balance(id)).available).toBe(0);expect(await db.aiUsage.count({where:{userId:id}})).toBe(4);if(process.env.D61_EVIDENCE_FILE)appendFileSync(process.env.D61_EVIDENCE_FILE,JSON.stringify({case:'atomic-quota',requests:20,successful,rejected:20-successful,remaining:0})+'\n');});
 it('同请求标识只预留一次',async()=>{const id=await user(),key=randomUUID();const result=await Promise.allSettled([service.reserve(id,key,now),service.reserve(id,key,now)]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await balance(id)).available).toBe(DAILY_UNITS-RESERVATION_UNITS);});
 it('并发重复结算不会重复退款',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);await Promise.all([service.settle(reservation,exact),service.settle(reservation,exact)]);expect((await balance(id)).available).toBe(DAILY_UNITS-20);expect((await db.aiUsage.findUniqueOrThrow({where:{id:reservation}})).status).toBe('exact');});
 it('不同金额重结算拒绝',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);await service.settle(reservation,exact);await expect(service.settle(reservation,{...exact,inputTokens:11})).rejects.toThrow('AI_SETTLEMENT_CONFLICT');expect((await balance(id)).available).toBe(DAILY_UNITS-20);});
 it('未知usage保留预留量并标estimated',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);const row=await service.settle(reservation,{inputTokens:0,outputTokens:0,exact:false,attempts:1});expect(row.status).toBe('estimated');expect((await balance(id)).available).toBe(DAILY_UNITS-RESERVATION_UNITS);});
 it('超出预留真实记账并阻止后续生成',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);await service.settle(reservation,{inputTokens:250000,outputTokens:0,exact:true,attempts:1});expect((await balance(id)).available).toBe(-50000);await expect(service.reserve(id,randomUUID(),now)).rejects.toThrow('今日AI额度不足');});
 it('UTC换日创建独立额度且历史保留',async()=>{const id=await user();await service.reserve(id,randomUUID(),now);await service.reserve(id,randomUUID(),new Date('2026-11-18T00:00:00Z'));expect(await db.aiQuota.count({where:{userId:id}})).toBe(2);expect(await db.aiUsage.count({where:{userId:id}})).toBe(2);});
 it('未结算预留不会自动退还',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);expect((await db.aiUsage.findUniqueOrThrow({where:{id:reservation}})).status).toBe('pending');expect((await balance(id)).available).toBe(DAILY_UNITS-RESERVATION_UNITS);});
});
```

## 五、核心面试题

乙公司的另一个提单人是否也会被本次预留扣额？

以用户和 UTC 日期查余额，请求键去重，条件更新避免重复扣费。将模拟用量和已知用量分开记。 [本日配套面试题](D61-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机助手单元 138 项、接口回归 39 项通过。[助手](../.cache/验证/新版验收/D70-unit.log) · [接口](../.cache/验证/新版验收/D70-http.log)。
