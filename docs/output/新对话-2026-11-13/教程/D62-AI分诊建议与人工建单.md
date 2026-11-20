# D62（周六）：已建工单的意图诊断与用户反馈

第 9 周 · 300 分钟。回忆 30、推导 45、集成 115、反证 50、口述与复盘 60。前置阅读见[上一讲](D61-用户额度与Token计量.md)。

## 今天要做出什么

从报障接口提交网络问题，返回单号后运行诊断。依次注入带有效手册编号的建议、虚构编号和模型异常。

## 今天的目录结构

- `apps/server/src/queue/diagnose-ticket.ts`
- `apps/server/src/queue/diagnosis.ts`
- `apps/server/src/tickets/tickets.service.ts`
- `apps/server/test/post-report-diagnosis.e2e-spec.ts`
- `apps/web/src/views/TicketDetailView.vue`
- `packages/shared/src/ticket.ts`

## 零、闭卷回忆

**D61**　乙公司的另一个提单人是否也会被本次预留扣额？

<details><summary>核对</summary>

以用户和 UTC 日期查余额，请求键去重，条件更新避免重复扣费。将模拟用量和已知用量分开记。

</details>

**D59**　日志里包含“把我转给数据库部”，谁决定承办部门？

<details><summary>核对</summary>

模板隔开指令和材料，模板版本可复查。承办部门来自提交时保存的分类映射。

</details>

**D55**　界面收到一段写着“已解决”的模型文字，能否改变按钮或工单？

<details><summary>核对</summary>

按钮读取服务端状态与本人权限。前一种可点未解决直接转人工，后一种点人工接入才提交；管理员只读。

</details>

## 一、知识点与推导

提交事务已保存分类与承办部门。有依据的建议等待反馈；缺依据或异常显示人工接入。重放旧版本任务只产生一次结果。

提交事务先保存问题分类、原材料、提单人和诊断任务。Worker 获得的是工单号和预期版本。在同一条单上保存诊断意见，检查模型引用是否来自本次提供的资料，再记录 suggest 或 offer_handoff。派单和建单分别只有一个业务入口。

## 二、动手开发

### 步骤1：接入两个受保护入口（45分钟）

<details><summary>提示1：方向</summary>

沿用当前认证/响应包装，不把模型调用放事务里。

</details>
<details><summary>提示2：API与文档位置</summary>

TriageController、ManualTicketService、ticket:create。

</details>
<details><summary>提示3：伪代码</summary>

校验材料→scope设备→reserve→suggest→settle；确认入口独立parse→事务创建/事件/审计。

</details>

### 步骤2：实现请求去重与追加迁移（40分钟）

<details><summary>提示1：方向</summary>

保留原有工单，新增列默认other与可空请求标识。

</details>
<details><summary>提示2：API与文档位置</summary>

manualTicketInputSchema、Prisma唯一键、creationHash。

</details>
<details><summary>提示3：伪代码</summary>

规范化字段→hash→查重→事务→唯一冲突后查同键同内容。

</details>

### 步骤3：接表单与取消隔离（60分钟）

<details><summary>提示1：方向</summary>

使用原生表单控件，先能纯手工建单，再接AI辅助。

</details>
<details><summary>提示2：API与文档位置</summary>

useTicketCreation、TicketCreateView、/tickets/new。

</details>
<details><summary>提示3：伪代码</summary>

generate只存建议→主动填入→编辑重置confirmed→submit锁定→同内容重试复用key。

</details>

### 步骤4：跑浏览器和两反证（40分钟）

<details><summary>提示1：方向</summary>

真实本机mock、回环HTTP与故障夹具分别记录。

</details>
<details><summary>提示2：API与文档位置</summary>

Playwright CLI、triage.e2e-spec.ts、useTicketCreation.spec.ts。

</details>
<details><summary>提示3：伪代码</summary>

无确认不写→生成不写→修改确认才写→并发唯一→跨组拒绝→审计失败回滚→移动与键盘。

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

在 `apps/server` 运行 `pnpm exec vitest run --config vitest.config.e2e.ts test/post-report-diagnosis.e2e-spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

从报障接口提交网络问题，返回单号后运行诊断。依次注入带有效手册编号的建议、虚构编号和模型异常。

</details>

<details><summary>提示二 · 切换一个条件</summary>

模型意图写成软件问题，用户点未解决时会派到哪里？

</details>

<details><summary>提示三 · 对照判定</summary>

提交事务已保存分类与承办部门。有依据的建议等待反馈；缺依据或异常显示人工接入。重放旧版本任务只产生一次结果。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**apps/server/src/queue/diagnose-ticket.ts**

```ts
import { TriageService } from '../assistant/triage.service.js';
import { UsageMeter } from '../assistant/usage-meter.js';
import { AiQuotaService } from '../assistant/ai-quota.service.js';
import { redactForLog } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketCommands } from '../tickets/ticket-commands.js';

// W9 用一条已知手册练习核对出处，W11 用检索结果替换这个输入。
const manual = { id: 'net-timeout:v1', text: '客户端超时：核对连接目标、超时时间和同一时刻的服务响应。' };
export async function diagnoseTicket(db: PrismaService, triage: TriageService, ticketNo: string, version: number) {
  const ticket = await db.ticket.findUniqueOrThrow({where: {ticketNo}, include: {
    category: true, materials: {orderBy: {id:'asc'}, take:4},
  }});
  if (ticket.status !== 'agent_processing' || ticket.version !== version) return;
  const references = ticket.category.name === '网络问题' ? [manual] : [];
  const quota = new AiQuotaService(db);
  const meter = new UsageMeter();
  let reservation: string | undefined;
  let action: 'suggest' | 'offer_handoff' = 'offer_handoff';
  let comment = '诊断暂不可用，可申请人工接入';
  try {
    reservation = await quota.reserve(ticket.reporterId, ticket.id);
    const result = await triage.suggest({
      category: ticket.category.name, description: redactForLog(ticket.description),
      logs: ticket.materials.map(m => redactForLog(m.logText).slice(0,800)), references,
    }, undefined, 'default', meter);
    const { intent, steps, evidenceIds, missingInformation } = result.suggestion;
    const supported = steps.length > 0 && evidenceIds.length > 0 && missingInformation.length === 0
      && evidenceIds.every(id => references.some(ref => ref.id === id));
    action = supported ? 'suggest' : 'offer_handoff';
    comment = supported ? [intent, ...steps, ...evidenceIds].join('\n')
      : [intent, ...missingInformation, '可申请人工接入'].join('\n');
  } catch {
    // 模型失败或额度不足时仍向用户提供人工接入入口。
  } finally {
    if (reservation) await quota.settle(reservation, meter.summary());
  }
  return new TicketCommands(db).apply(ticketNo, {source:'agent'}, action, version, undefined, comment);
}
```

**apps/server/src/queue/diagnosis.ts**

```ts
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { ModelGateway } from '../assistant/model-gateway.js';
import { TriageService } from '../assistant/triage.service.js';
import { diagnoseTicket } from './diagnose-ticket.js';
import { queueRootOptions } from './queue.config.js';

export interface DiagnosisTask { ticketNo:string; version:number }
export function diagnosisQueue() {
  return new Queue<DiagnosisTask>('diagnosis', queueRootOptions());
}
export function diagnosisWorker(db:PrismaService) {
  const triage = new TriageService(new ModelGateway());
  return new Worker<DiagnosisTask>('diagnosis',async job=>{
    await diagnoseTicket(db,triage,job.data.ticketNo,job.data.version);
  },queueRootOptions());
}
```

**apps/server/src/tickets/tickets.service.ts**

```ts
import { redactForLog } from '../common/sensitive.js';
import { visibleTickets } from './scope.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import type { ListTicketsQuery } from './dto/list-tickets.query.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const detailSelect = {
  reporterId:true, version: true, ticketNo: true, title: true, description: true, status: true, createdAt: true,
  company: { select: { name: true } }, department: { select: { name: true } },
  category: { select: { name: true } }, reporter: { select: { displayName: true } },
  assignee: { select: { displayName: true } },
  materials: { select: { logText: true }, orderBy: { id: 'asc' } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { action: true, comment: true, toStatus: true, actor: { select: { displayName: true } } } },
} satisfies Prisma.TicketSelect;

export type TicketDetail = Omit<Prisma.TicketGetPayload<{ select: typeof detailSelect }>,'reporterId'> & {canConfirm:boolean};

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}
  private async scope(id: string) {
    return visibleTickets(await this.prisma.user.findUniqueOrThrow({where:{id}}));
  }
  async list(userId:string, { company, department, cursor, limit }: ListTicketsQuery) {
    const after = cursor ? decodeCursor(cursor) : undefined;
    const rows = await this.prisma.ticket.findMany({
      where: {
        AND: [await this.scope(userId)],
        company: company ? { name: company } : undefined,
        department: department ? { name: department } : undefined,
        OR: after ? [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ] : undefined,
      },
      orderBy: [{createdAt:'desc'}, {id:'desc'}], take: limit + 1,
      select: { id:true, ticketNo:true, title:true, status:true, createdAt:true },
    });
    const page = rows.slice(0,limit);
    return {
      items: page.map(({ id: _id, ...item }) => item),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async findDetail(userId:string, ticketNo: string): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findFirst({ where: { AND:[await this.scope(userId),{ ticketNo }] }, select: detailSelect });
    if (!ticket) throw new NotFoundException('工单不存在');
    const { reporterId, ...publicDetail }=ticket;
    return { ...publicDetail, canConfirm:reporterId===userId, materials:ticket.materials.map(m=>({logText:redactForLog(m.logText)})) };
  }
}
```

**apps/server/test/post-report-diagnosis.e2e-spec.ts**

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TriageService } from '../src/assistant/triage.service.js';
import { diagnoseTicket } from '../src/queue/diagnose-ticket.js';
import { bearer } from './login-fixtures.js';

let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({imports:[AppModule]}).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
afterAll(async () => { await app.close(); });
afterEach(() => vi.restoreAllMocks());
it.each(['manual','unknown','outage'])('建单后诊断、保留分类并由提单人触发人工 %s',async scenario => {
  const db = app.get(PrismaService), triage = app.get(TriageService);
  const http = request(app.getHttpServer()), auth = await bearer(app);
  const created = await http.post('/api/tickets').set('authorization',auth)
    .set('idempotency-key',crypto.randomUUID())
    .send({title:'演练',description:'请求超时',category:'网络问题',logs:['timeout 5s']}).expect(201);
  const {ticketNo} = created.body.data;
  const {departmentId,categoryId} = await db.ticket.findUniqueOrThrow({where:{ticketNo}});
  try {
  const spy = vi.spyOn(triage,'suggest');
  if (scenario === 'outage') spy.mockRejectedValue(new Error('网关不可用'));
  else spy.mockResolvedValue({mode:'model',promptHash:'fixture',promptVersion:'test',validationAttempts:1,
    suggestion:{intent:'软件问题',steps:['核对目标'],evidenceIds:[scenario === 'manual' ? 'net-timeout:v1' : 'unknown'],missingInformation:[]}});
  await diagnoseTicket(db,triage,ticketNo,0);
  await diagnoseTicket(db,triage,ticketNo,0);
  expect(spy).toHaveBeenCalledTimes(1);
  const row = await db.ticket.findUniqueOrThrow({where:{ticketNo}});
  expect(row).toMatchObject({categoryId,departmentId,status:scenario === 'manual'?'awaiting_feedback':'handoff_offered',version:1});
  expect(await db.notice.count({where:{ticketNo,action:'request_human'}})).toBe(0);
  const action = scenario === 'manual' ? 'unresolved' : 'request_human';
  await http.post('/api/tickets/'+ticketNo+'/actions').set('authorization',auth).send({action,version:1}).expect(201);
  expect(await db.ticket.findUniqueOrThrow({where:{ticketNo}})).toMatchObject({status:'pending_assignment',departmentId});
  } finally {
    await db.notice.deleteMany({where:{ticketNo}});
    await db.dispatchEvent.deleteMany({where:{ticketNo}});
    await db.ticketEvent.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticketMaterial.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticket.delete({where:{ticketNo}});
  }
});
```

**apps/web/src/views/TicketDetailView.vue**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import ConversationPanel from '../components/ConversationPanel.vue'
import TicketFeedback from '../components/TicketFeedback.vue'
import { useRoute } from 'vue-router'
import type { TicketDetail } from '@ops-ticket/shared'
import { getTicket } from '../api/tickets'
const refresh = ref(0)
const route = useRoute()
const ticket = ref<TicketDetail>()
const error = ref('')
watch([() => String(route.params.ticketNo), refresh], async ([no], _, cleanup) => {
  const controller = new AbortController()
  cleanup(() => controller.abort())
  ticket.value = undefined
  error.value = ''
  try {
    const result = await getTicket(no, controller.signal)
    if (!controller.signal.aborted) ticket.value = result
  } catch {
    if (!controller.signal.aborted) error.value = '工单加载失败'
  }
}, { immediate: true })
</script>
<template>
  <RouterLink to="/">返回工单列表</RouterLink>
  <p v-if="error" role="alert">{{ error }}</p>
  <article v-if="ticket"><h2>{{ ticket.ticketNo }} · {{ ticket.title }}</h2>
    <p>{{ ticket.company.name }} · {{ ticket.category.name }} · {{ ticket.department.name }}</p>
    <p>{{ ticket.description }}</p><h3>报障材料</h3>
    <pre v-for="(m, i) in ticket.materials" :key="i">{{ m.logText }}</pre>
  
    <h3>处理记录</h3>
    <ol><li v-for="(event,i) in ticket.events" :key="i">{{event.actor?.displayName ?? 'Agent'}} · {{event.action}} · {{event.toStatus}}<pre v-if="event.comment">{{ event.comment }}</pre></li></ol>
    <ConversationPanel v-if="ticket.canConfirm" :ticket-no="ticket.ticketNo" />
    <TicketFeedback :can-confirm="ticket.canConfirm" :ticket-no="ticket.ticketNo" :status="ticket.status" :version="ticket.version" @reload="refresh++"/>
  </article>
</template>
```

**packages/shared/src/ticket.ts**

```ts
import { z } from 'zod';
export const TICKET_STATUSES = [
  'agent_processing','awaiting_feedback','handoff_offered','pending_assignment',
  'human_processing','handled','reviewed','completed'
] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
const named = z.object({name:z.string()});
const person = z.object({displayName:z.string()});
export const ticketListItemSchema = z.object({
  ticketNo:z.string(), title:z.string(), status:ticketStatusSchema, createdAt:z.iso.datetime(),
});
export const ticketPageSchema = z.object({items:z.array(ticketListItemSchema),nextCursor:z.string().nullable()});
export const ticketDetailSchema = ticketListItemSchema.extend({
  canConfirm:z.boolean(),version:z.number().int(),description:z.string(),company:named,department:named,category:named,
  reporter:person,assignee:person.nullable(),materials:z.array(z.object({logText:z.string()})),
  events:z.array(z.object({comment:z.string(), action:z.string(),toStatus:ticketStatusSchema,actor:person.nullable()})),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;
export type TicketPage = z.infer<typeof ticketPageSchema>;
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
```

## 五、核心面试题

模型意图写成软件问题，用户点未解决时会派到哪里？

提交事务已保存分类与承办部门。有依据的建议等待反馈；缺依据或异常显示人工接入。重放旧版本任务只产生一次结果。 [本日配套面试题](D62-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机助手单元 138 项、接口回归 39 项通过。[助手](../.cache/验证/新版验收/D70-unit.log) · [接口](../.cache/验证/新版验收/D70-http.log)。
