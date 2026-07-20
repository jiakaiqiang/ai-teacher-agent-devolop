# Day 09 - 状态机（服务端权威 FSM + 乐观更新 + 版本冲突回滚）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段一（Day 1-30，前端 -> AI 前端）。所有 BFF、NestJS、数据库、队列和 Agent 后端增量都必须服务于 `p1-monitor` 的真实 AI 前端链路，不得另起无关 Demo。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **补充真实项目情境题**：
> 1. 两个审批请求携带同一个 `expectedVersion` 并发到达时，如何证明只有一个状态转换成功，另一个得到可解释的冲突？
> 2. 终态 Run 收到延迟的 `approval.required` 时，前后端如何保持终态并留下可追踪证据？

日期与时长：2026-07-22 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据 Day08 成绩生成补弱版、标准版或挑战版。

---

## §0 项目当前状态（进入 Day09 前）

到 Day08 结束时，`p1-monitor` 已经具备：

- 后端 `apps/api`：Nest + Prisma + Postgres，Cursor 分页 + 稳定排序 + Query DTO + ViewModel。
- 前端 `apps/web`：Vue3 + Vite + ECharts + WebSocket 实时更新，已有异常列表页与详情页。
- 领域 `packages/domain`：`AlertRow`、`AlertDetail` 值对象，`AlertQuery` 查询 DTO，`toAlertVM` 序列化函数。
- 事件 `packages/features/alert-detect`：Z-Score 异常检测，命中即写 `Alert` 表。

Day09 之前 `Alert.status` 只是一个 `boolean resolved`，前端点击"确认异常"直接 `PATCH /alerts/:id` 把它翻转为 true。

存在的问题（今天要解决的）：

1. 状态语义扁平：不能区分"新告警 / 处理中 / 已解决 / 误报"，产品要新增"忽略"和"回炉"两个操作时无法扩展。
2. 无合法转换约束：客户端可以把 `resolved: true` 直接改回 `false`，后端只校验字段类型，不校验业务合法性。
3. 无并发保护：两个人同时点确认，两次 PATCH 都成功，最后一次覆盖前一次，看不到冲突。
4. UI 乐观更新失败后不回滚：点了确认后先本地染色，若后端返回 500 用户看不到状态回退。

今天完成后，Alert 会变成一个受服务端权威 FSM 保护的领域实体，客户端只允许发起合法转换、附带 `expectedVersion`，冲突时 409 + 前端回滚。

---

## §1 今日目标

### §1.1 概述

把 `Alert.status` 从布尔字段演进为一个 5 态状态机（NEW / ACK / RESOLVED / IGNORED / REOPENED），合法转换集中在领域层，服务端拥有最终解释权；前端做乐观更新，冲突 409 回滚到服务端状态。

### §1.2 三层演进

| 版本 | 代码位置 | 特征 | 遗留问题 |
|---|---|---|---|
| v1 | `alerts.controller.ts` | 直接 `PATCH { resolved: true }`，字段级校验 | 状态语义扁平；无合法转换约束 |
| v2 | `packages/domain/alert-status.ts` | 客户端 + 后端共用 FSM 表；后端 `assertCanTransition(from,to)` | 双击/并发时后写覆盖先写；UI 失败不回滚 |
| v3 | `packages/domain/alert-fsm.ts` + `alerts.service.ts` + `apps/web/features/alert-detail` | 服务端权威 FSM + `expectedVersion` 乐观锁 + 409 → 前端 `revert(prev)` | （明日 Day10 引入审计日志） |

### §1.3 交付物

1. `packages/domain/alert-fsm.ts`：状态枚举 + 合法转换表 + `canTransition/assertCanTransition` 纯函数。
2. `apps/api/src/alerts/alerts.service.ts`：`transition(id, action, expectedVersion, actorId)`，事务内读 → 校验 → 写。
3. Prisma migration：`Alert.status String @default("NEW")`、`Alert.version Int @default(0)`。
4. `apps/web/features/alert-detail/state.ts`：`optimisticApply / commit / revert` 三段式。
5. 测试：单元测试遍历 25 种状态组合确认非法边为 0；集成测试制造 409 冲突并验证回滚。
6. 反证实验：删除服务端 FSM 校验后手工制造非法跳转，记录审计断层。

### §1.4 目录结构（本日项目视角）

**§1.4.1 rationale（先讲为什么这样组织）**

- 状态机放在 `packages/domain/alert-fsm.ts`：这是领域概念，前后端共用同一张转换表，避免客户端伪造非法转换而后端只做字段校验。
- 前端 `state.ts` 只做"乐观更新 + 回滚"，不重复实现 FSM 校验：客户端校验只用于按钮 disabled，最终仲裁权在服务端。
- Service 层的 `transition()` 与 `update()` 分离：状态转换是有约束的写路径，不能和普通字段更新混在一起。
- 版本号 `version` 挂在 `Alert` 表而非独立表：只有一个热点实体，不需要额外 join；后续 Day10 审计日志会引用 `(alertId, version)` 复合键。

**§1.4.2 tree（本日结束的目录快照，只展示与状态机相关的路径）**

```
p1-monitor/
├─ packages/
│  ├─ domain/
│  │  ├─ src/
│  │  │  ├─ alert-fsm.ts               # 【新增】状态枚举 + 转换表 + 纯函数
│  │  │  ├─ alert.ts                   # 【修改】加 status/version 字段
│  │  │  └─ index.ts                   # 【修改】导出 fsm
│  │  └─ package.json
│  └─ features/
│     └─ alert-detect/                  # 【不改】Day07 已完成
├─ apps/
│  ├─ api/
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma              # 【修改】status + version
│  │  │  └─ migrations/
│  │  │     └─ 20260722_alert_fsm/     # 【新增】
│  │  └─ src/alerts/
│  │     ├─ alerts.service.ts          # 【修改】新增 transition()
│  │     ├─ alerts.controller.ts       # 【修改】POST /alerts/:id/transition
│  │     ├─ dto/transition.dto.ts      # 【新增】action + expectedVersion
│  │     └─ alerts.service.spec.ts     # 【新增】25 组转换用例
│  └─ web/
│     └─ src/features/alert-detail/
│        ├─ state.ts                   # 【新增】optimistic/commit/revert
│        ├─ AlertActions.vue           # 【修改】按钮 disabled 与 revert
│        └─ __tests__/state.spec.ts    # 【新增】409 回滚用例
```

**§1.4.3 与 Day08 的目录 diff 表**

| 变更 | 路径 | 新/改/删 | 为什么在这里 |
|---|---|---|---|
| 新增 | `packages/domain/src/alert-fsm.ts` | 新 | 领域规则，前后端共用 |
| 修改 | `packages/domain/src/alert.ts` | 改 | 加 `status: AlertStatus` + `version: number` |
| 修改 | `apps/api/prisma/schema.prisma` | 改 | 加两列 + 索引 `@@index([status])` |
| 新增 | `apps/api/prisma/migrations/20260722_alert_fsm/` | 新 | 迁移脚本 |
| 修改 | `apps/api/src/alerts/alerts.service.ts` | 改 | 新增 `transition()` 事务方法 |
| 修改 | `apps/api/src/alerts/alerts.controller.ts` | 改 | 新增 `POST /alerts/:id/transition` 路由 |
| 新增 | `apps/api/src/alerts/dto/transition.dto.ts` | 新 | Action + expectedVersion |
| 新增 | `apps/api/src/alerts/alerts.service.spec.ts` | 新 | 25 组 × 4 用户的组合表 |
| 新增 | `apps/web/src/features/alert-detail/state.ts` | 新 | 前端三段式 |
| 修改 | `apps/web/src/features/alert-detail/AlertActions.vue` | 改 | 用 fsm 计算 disabled + 接 revert |
| 新增 | `apps/web/src/features/alert-detail/__tests__/state.spec.ts` | 新 | 409 → revert 用例 |

**§1.4.4 依赖箭头（谁调用谁）**

```
apps/web/AlertActions.vue
        ↓ 只做 UI 判定
apps/web/state.ts (optimistic/commit/revert)
        ↓ HTTP POST /alerts/:id/transition
apps/api/alerts.controller.ts
        ↓ 调用
apps/api/alerts.service.ts (transition 方法)
        ↓ 读转换表 & 纯函数
packages/domain/alert-fsm.ts (assertCanTransition)
        ↓ 通过后
Prisma updateMany({ where: { id, version: expected }, data: { status: to, version: version + 1 } })
```

关键点：前端 `state.ts` 也 import `alert-fsm.ts` 里的 `canTransition`，但只用于按钮 disabled，绝不用于最终判定。

**§1.4.5 3 个理解问题（写代码前先在心里回答）**

1. 为什么 `alert-fsm.ts` 放在 `packages/domain` 而不是 `apps/api` 里？
   参考答：领域规则前后端共用一份定义，前端按钮 disabled、后端权威校验、测试遍历都指向同一张表；放 `apps/api` 前端就要复制一份，两份最终一定漂移。
2. 为什么 `transition()` 用 `updateMany` 而不是 `update`？
   参考答：Prisma 的 `update({ where: { id } })` 找不到会抛 `P2025`；`updateMany` 会返回 `{ count: 0 or 1 }`，用它拿 `count === 0` 精确识别"id 存在但 version 不匹配"这种冲突场景。
3. 为什么前端 `state.ts` 要保存 `prev` 快照而不是重新拉一次接口？
   参考答：乐观更新回滚必须"瞬间恢复到用户点击前的样子"，网络往返 300ms 用户会看到闪回；重新拉接口是 fallback，不是主路径。

### §1.5 按第 5.3 节的代码 + 边写边问自己

第 5.3 节给出完整代码，请按顺序：读 → 抄 → 停下来问下面 5 个问题 → 若能回答再往下写。

- 为什么 `AlertStatus` 用 `as const` 数组而不是 TS enum？
  → enum 有运行时对象但不能做 union 收敛；`as const` 拿到 `readonly ['NEW', ...]` 后可以 `typeof arr[number]` 得到精确 union，同时 `Array.includes` 校验也用同一张表。
- 为什么 `TRANSITIONS` 表用 `Record<AlertStatus, AlertStatus[]>`？
  → 结构与"图的邻接表"一一对应；`canTransition(from, to) = TRANSITIONS[from].includes(to)` 一行搞定，改动只加数据、不改逻辑。
- 为什么 `transition()` 里必须 `updateMany`，不能先 `findUnique` 再 `update`？
  → find + update 之间存在 read-modify-write 竞态；两个并发请求都读到 version=3，各自把 version 更新到 4，后写覆盖先写。`updateMany({ where: { id, version: expected } })` 把校验和写入合并成一条 SQL，Postgres 保证串行。
- 为什么前端 `optimisticApply` 要立刻 setter，而不是等 200 响应？
  → 用户体验：确认按钮 → 状态染色 → 服务端异步确认；等 200 响应意味着 300ms 的空白，产品体感差。
- 为什么 `revert(prev)` 要在 `catch` 里而不是 `finally` 里？
  → `finally` 会覆盖成功路径；只有失败才需要回滚。

---

## §2 环境准备

- Node ≥ 20.11、pnpm ≥ 9、Postgres ≥ 15、Nest CLI ≥ 10、Vue ≥ 3.4、Prisma ≥ 5.10。
- 上一日 Day08 的分支 `feat/day08-cursor-pagination` 已合入 `main`。
- 本日新分支：`git switch -c feat/day09-alert-fsm`。
- 数据库需要能执行 `pnpm --filter api prisma migrate dev`；如果本地库有生产数据，先 `pg_dump` 备份再迁移。

---

## §3 数据模型变更（Prisma）

`apps/api/prisma/schema.prisma`：

```prisma
model Alert {
  id           String       @id @default(cuid())
  serverId     String
  metric       String
  value        Float
  zScore       Float
  status       String       @default("NEW")   // NEW/ACK/RESOLVED/IGNORED/REOPENED
  version      Int          @default(0)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  server       Server       @relation(fields: [serverId], references: [id])

  @@index([status])
  @@index([serverId, createdAt])
}
```

执行：

```bash
pnpm --filter api prisma migrate dev --name alert_fsm
```

迁移会写一次 `UPDATE alerts SET status='RESOLVED' WHERE resolved=true; UPDATE alerts SET status='NEW' WHERE resolved=false;` 完成历史数据回填；`resolved` 字段保留 1 天后由 Day10 删除。

---

## §4 引入依赖

本日不新增运行时依赖，仅补测试工具：

```bash
pnpm --filter api add -D @nestjs/testing
pnpm --filter web add -D @vitest/coverage-v8
```

---

## §5 核心代码

### §5.1 v1 —— 布尔字段（今日进场时的样子）

`apps/api/src/alerts/alerts.controller.ts`（截取）：

```ts
@Patch(':id')
async update(@Param('id') id: string, @Body() body: { resolved: boolean }) {
  return this.prisma.alert.update({
    where: { id },
    data: { resolved: body.resolved },
  });
}
```

前端 `AlertActions.vue`（截取）：

```vue
<button @click="ack">确认异常</button>
<script setup>
async function ack() {
  await fetch(`/api/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved: true }) });
  alert.resolved = true;
}
</script>
```

v1 的问题：
- `resolved: false → true` 之外任何语义都无法表达；产品要"忽略"就得再加字段。
- 客户端可以 `PATCH { resolved: false }` 把已解决的告警"未解决"回去，无校验。
- 双击两次都返回 200，没有冲突提示。

### §5.2 v2 —— 客户端 + 后端共用 FSM 表（有转换约束，但无并发保护）

`packages/domain/src/alert-status.ts`（v2 版本，仅保留一日就演进到 v3）：

```ts
export const ALERT_STATUS = ['NEW', 'ACK', 'RESOLVED', 'IGNORED', 'REOPENED'] as const;
export type AlertStatus = typeof ALERT_STATUS[number];

export const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  NEW:       ['ACK', 'IGNORED'],
  ACK:       ['RESOLVED', 'IGNORED'],
  RESOLVED:  ['REOPENED'],
  IGNORED:   ['REOPENED'],
  REOPENED:  ['ACK', 'IGNORED'],
};

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
```

Service 层（v2）：

```ts
async setStatus(id: string, next: AlertStatus) {
  const cur = await this.prisma.alert.findUnique({ where: { id } });
  if (!cur) throw new NotFoundException();
  if (!canTransition(cur.status as AlertStatus, next)) {
    throw new BadRequestException(`invalid transition ${cur.status} -> ${next}`);
  }
  return this.prisma.alert.update({ where: { id }, data: { status: next } });
}
```

v2 的问题：
- `findUnique` 与 `update` 之间存在 read-modify-write 竞态；两个用户同时把 NEW→ACK，两次都成功，事件被"确认"了两次。
- 前端仍然是"点了就染色"，失败不回滚。

### §5.3 v3 —— 服务端权威 FSM + 乐观锁 + 前端回滚（今日最终态）

#### §5.3.1 `packages/domain/src/alert-fsm.ts`

```ts
export const ALERT_STATUS = ['NEW', 'ACK', 'RESOLVED', 'IGNORED', 'REOPENED'] as const;
export type AlertStatus = typeof ALERT_STATUS[number];

export const ALERT_ACTIONS = ['ack', 'resolve', 'ignore', 'reopen'] as const;
export type AlertAction = typeof ALERT_ACTIONS[number];

const TABLE: Record<AlertStatus, Partial<Record<AlertAction, AlertStatus>>> = {
  NEW:       { ack: 'ACK', ignore: 'IGNORED' },
  ACK:       { resolve: 'RESOLVED', ignore: 'IGNORED' },
  RESOLVED:  { reopen: 'REOPENED' },
  IGNORED:   { reopen: 'REOPENED' },
  REOPENED:  { ack: 'ACK', ignore: 'IGNORED' },
};

export function nextStatus(from: AlertStatus, action: AlertAction): AlertStatus | null {
  return TABLE[from][action] ?? null;
}

export function canTransition(from: AlertStatus, action: AlertAction): boolean {
  return nextStatus(from, action) !== null;
}

export class InvalidTransitionError extends Error {
  constructor(public from: AlertStatus, public action: AlertAction) {
    super(`invalid transition: ${from} --${action}-->`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertCanTransition(from: AlertStatus, action: AlertAction): AlertStatus {
  const to = nextStatus(from, action);
  if (!to) throw new InvalidTransitionError(from, action);
  return to;
}
```

#### §5.3.2 `apps/api/src/alerts/dto/transition.dto.ts`

```ts
import { IsIn, IsInt, Min } from 'class-validator';
import { ALERT_ACTIONS, AlertAction } from '@p1/domain';

export class TransitionDto {
  @IsIn([...ALERT_ACTIONS])
  action!: AlertAction;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
```

#### §5.3.3 `apps/api/src/alerts/alerts.service.ts` 新增 `transition()`

```ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AlertAction,
  AlertStatus,
  assertCanTransition,
  InvalidTransitionError,
} from '@p1/domain';

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    id: string,
    action: AlertAction,
    expectedVersion: number,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.alert.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException(`alert ${id} not found`);

      let to: AlertStatus;
      try {
        to = assertCanTransition(cur.status as AlertStatus, action);
      } catch (e) {
        if (e instanceof InvalidTransitionError) {
          throw new ConflictException({
            code: 'INVALID_TRANSITION',
            from: e.from,
            action: e.action,
            currentVersion: cur.version,
          });
        }
        throw e;
      }

      const updated = await tx.alert.updateMany({
        where: { id, version: expectedVersion },
        data: { status: to, version: { increment: 1 } },
      });

      if (updated.count === 0) {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          currentVersion: cur.version,
          expectedVersion,
        });
      }

      return tx.alert.findUnique({ where: { id } });
    });
  }
}
```

#### §5.3.4 `apps/api/src/alerts/alerts.controller.ts` 新增路由

```ts
@Post(':id/transition')
async transition(
  @Param('id') id: string,
  @Body() dto: TransitionDto,
  @Req() req: RequestWithUser,
) {
  return this.alertsService.transition(id, dto.action, dto.expectedVersion, req.user.id);
}
```

注意：`update` 路由本身还保留用于普通字段编辑（比如备注），但对 `status/version` 加了写保护——见下方 `alerts.service.ts.update`：

```ts
async update(id: string, patch: UpdateAlertDto) {
  const { status, version, ...safe } = patch as any;
  if (status !== undefined || version !== undefined) {
    throw new BadRequestException('use POST /transition for status change');
  }
  return this.prisma.alert.update({ where: { id }, data: safe });
}
```

#### §5.3.5 `apps/web/src/features/alert-detail/state.ts`

```ts
import { reactive } from 'vue';
import type { AlertAction, AlertStatus } from '@p1/domain';
import { canTransition } from '@p1/domain';

interface AlertVM {
  id: string;
  status: AlertStatus;
  version: number;
}

export function useAlertActions(alert: AlertVM) {
  const state = reactive({
    alert,
    pending: false as false | AlertAction,
    lastError: null as null | { code: string; message: string },
  });

  async function fire(action: AlertAction) {
    if (state.pending) return;
    if (!canTransition(state.alert.status, action)) {
      state.lastError = { code: 'CLIENT_INVALID', message: `${state.alert.status} 无法 ${action}` };
      return;
    }
    const prev = { status: state.alert.status, version: state.alert.version };
    state.pending = action;
    state.lastError = null;

    // 1. 乐观染色（不写 version，version 只在服务端权威）
    state.alert.status = predictNext(prev.status, action);

    try {
      const res = await fetch(`/api/alerts/${state.alert.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, expectedVersion: prev.version }),
      });

      if (res.status === 409) {
        const body = await res.json();
        // 2. 版本冲突或非法转换：回滚到 prev
        state.alert.status = prev.status;
        state.alert.version = body.currentVersion ?? prev.version;
        state.lastError = { code: body.code, message: '状态已被他人修改，请刷新查看最新状态' };
        return;
      }
      if (!res.ok) throw new Error(`http ${res.status}`);

      // 3. 服务端确认，用权威结果覆盖乐观值
      const authoritative = await res.json();
      state.alert.status = authoritative.status;
      state.alert.version = authoritative.version;
    } catch (err) {
      state.alert.status = prev.status;
      state.alert.version = prev.version;
      state.lastError = { code: 'NETWORK', message: (err as Error).message };
    } finally {
      state.pending = false;
    }
  }

  return { state, fire };
}

function predictNext(from: AlertStatus, action: AlertAction): AlertStatus {
  // 前端仅用于染色，与领域层保持同一张 TABLE
  const MAP: Record<AlertStatus, Partial<Record<AlertAction, AlertStatus>>> = {
    NEW: { ack: 'ACK', ignore: 'IGNORED' },
    ACK: { resolve: 'RESOLVED', ignore: 'IGNORED' },
    RESOLVED: { reopen: 'REOPENED' },
    IGNORED: { reopen: 'REOPENED' },
    REOPENED: { ack: 'ACK', ignore: 'IGNORED' },
  };
  return MAP[from][action]!;
}
```

#### §5.3.6 `apps/web/src/features/alert-detail/AlertActions.vue`

```vue
<template>
  <div class="actions">
    <button v-for="a in visible" :key="a" :disabled="!!state.pending" @click="fire(a)">
      {{ label(a) }}
      <span v-if="state.pending === a">…</span>
    </button>
    <p v-if="state.lastError" class="err">{{ state.lastError.message }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ALERT_ACTIONS, canTransition, type AlertAction } from '@p1/domain';
import { useAlertActions } from './state';

const props = defineProps<{ alert: { id: string; status: any; version: number } }>();
const { state, fire } = useAlertActions(props.alert);

const visible = computed(() =>
  ALERT_ACTIONS.filter((a) => canTransition(state.alert.status, a as AlertAction)),
);

function label(a: AlertAction) {
  return { ack: '确认', resolve: '解决', ignore: '忽略', reopen: '回炉' }[a];
}
</script>
```

### §5.4 六个必掌握的知识点（每点五要素）

#### 知识点 1：有限状态机（FSM）

- 解决的问题：把"业务实体现在能做什么、不能做什么"从散落在各处的 if-else 收敛到一张转换表。
- 运行机制：定义 `Status` 集合 + `Action` 集合 + `TABLE: Status → Action → Status` 的部分函数；查表命中即合法，未命中即非法。
- 项目落点：`packages/domain/alert-fsm.ts` 的 `TABLE` 常量；`assertCanTransition` 是唯一入口。
- 生产误区：把 FSM 写在 Service 层里当业务代码维护；下次新增状态就要改 5 个 if 分支，永远漏掉一个。
- 验证方法：写一个测试遍历所有 `(Status × Action)` 组合共 5×4=20 对，断言只有 TABLE 定义过的返回非 null，其余全部抛 `InvalidTransitionError`。

#### 知识点 2：服务端权威（Server Authoritative）

- 解决的问题：客户端可以被篡改、可以旧、可以恶意；不能把业务规则的最终仲裁权交给客户端。
- 运行机制：所有状态修改必须过服务端接口；客户端可复用同一张 FSM 表做 UI 判定，但服务端拿到请求后再重新校验一次，任何差异以服务端为准。
- 项目落点：前端 `state.ts` 用 `canTransition` 决定按钮 disabled，服务端 `transition()` 独立调用 `assertCanTransition`；两者共用同一份 `alert-fsm.ts` 保证不漂移。
- 生产误区：只在前端 disable 按钮不在后端校验；用户用 Postman 一发直接绕过。
- 验证方法：写测试模拟"绕过前端"——直接 POST 一个非法 action，断言返回 409 `INVALID_TRANSITION` 且数据库 status/version 均未变化。

#### 知识点 3：乐观更新（Optimistic UI）

- 解决的问题：网络延迟下用户点击后 300ms 的空白，产品体感差。
- 运行机制：客户端先按预测结果更新本地状态，再异步请求服务端；成功则用服务端权威值覆盖，失败则回滚到 `prev` 快照。
- 项目落点：`state.ts` 的 `fire()` 函数的三步——`state.alert.status = predictNext(...)` → `fetch` → 成功 `覆盖` / 失败 `revert(prev)`。
- 生产误区：乐观更新时把 `version` 也预测 +1；服务端权威值到来时 version 已经错乱，下一次请求带上错的 expectedVersion。**只预测 status，不预测 version**。
- 验证方法：单元测试用 `msw` mock 一个 409 响应，断言 `state.alert.status` 从预测值回到 `prev.status`；再断言 `lastError.code === 'VERSION_CONFLICT'`。

#### 知识点 4：并发控制（Optimistic Locking / expectedVersion）

- 解决的问题：多客户端同时改同一实体，最后写入者悄悄覆盖前一次修改，用户以为自己的操作生效了，其实被吞了。
- 运行机制：每次写入都带上 `expectedVersion`；SQL `UPDATE ... WHERE id=? AND version=?`，命中 0 行即冲突，用 `RETURNING` 或再读一次拿到最新 version 返回给客户端。
- 项目落点：`alerts.service.ts` 的 `updateMany({ where: { id, version: expectedVersion } })` + `count === 0 → ConflictException`。
- 生产误区：用 `findUnique` + 内存 `if (cur.version !== expected)` + `update`——read-modify-write 之间仍有窗口；两个请求可以都通过 if 检查。**必须让数据库在同一条 SQL 里判断 version**。
- 验证方法：起两个并发 `Promise.all([transition(id,'ack',0), transition(id,'ack',0)])`，断言恰好一个成功、一个 409；最终 version === 1。

#### 知识点 5：失败回滚（Rollback）

- 解决的问题：乐观更新 UI 已经染色，如果服务端拒绝，界面必须立刻恢复到操作前的样子，不能让用户带着错误的状态感继续点。
- 运行机制：`fire()` 里保存 `prev = { status, version }` 快照；`catch` 分支或 `res.status === 409` 分支里 `state.alert.status = prev.status; state.alert.version = body.currentVersion ?? prev.version`。
- 项目落点：`state.ts` 里的 `prev` 快照 + 两处赋值。
- 生产误区：把 `revert` 放到 `finally`——成功路径也被回滚了；或者只回滚 `status` 不回滚 `version`——下一次请求带的 `expectedVersion` 是错的。
- 验证方法：在 vitest 里 mock 409，断言 fire 结束后 `state.alert.status === prev.status`；再 mock 200，断言状态不回滚。

#### 知识点 6：非法转换的可观察性

- 解决的问题：非法转换如果只返回 400/500 用户看不懂；同时也需要给运维一个可查询的证据链。
- 运行机制：定义 `InvalidTransitionError`，服务端 catch 后转成 `ConflictException({ code, from, action })`；前端根据 `code` 决定 UI 文案；后端在 Day10 会把这些冲突写入 `alert_audit` 表。
- 项目落点：`alert-fsm.ts` 的 `InvalidTransitionError` + `alerts.service.ts` 的 catch 转换。
- 生产误区：直接抛 500 或者用 400 但错误体是字符串；前端只能显示"操作失败"，运维只能看 500 曲线飙升。
- 验证方法：集成测试 POST 一个 `RESOLVED → ack` 的非法转换，断言 HTTP 409、body.code === `INVALID_TRANSITION`、body.from === `RESOLVED`、body.action === `ack`。

---

## §6 前端底子补弱

### §6.1 - §6.4（本日不涉及，跳过）

### §6.5 HTML/表单底子补弱（本日必做）

**主题：`<button>` 的 `disabled` 属性、`aria-busy`、按钮防抖与状态可访问性**

Day09 前端有一组"确认 / 解决 / 忽略 / 回炉"按钮，需要根据当前状态决定 disabled，并在请求 pending 时给出无障碍可读的忙碌反馈。

**背景知识**：

1. `<button disabled>` 会同时禁用鼠标点击和键盘触发；不需要额外拦 `@click`。但仅仅 disabled 不能反馈"正在处理中"这一子状态。
2. `aria-busy="true"` 表示元素及其后代内容正在更新中；屏幕阅读器会通知"正在忙"。它不阻止点击，只做可访问性宣告。
3. 防抖不是 `setTimeout(300)`：真正的防抖是"请求未回来前，同一按钮不允许再点"，本质是 `pending` 状态门。

**本日代码里的应用**：

```vue
<button
  :disabled="!!state.pending"
  :aria-busy="state.pending === a"
  @click="fire(a)"
>
  {{ label(a) }}
</button>
```

- `state.pending` 是 `false | AlertAction`；只要有正在进行的请求，所有按钮 disabled。
- 只有当前正在被点击的那个按钮 `aria-busy=true`；其余按钮 disabled 但不 busy。
- 请求成功或失败后 `state.pending = false`，disabled 自动解除。

**思考**：

- 为什么不用 `<div @click>` 加自定义 `.disabled` 样式？→ div 没有语义、键盘 Tab 走不到、屏幕阅读器不会宣告"按钮"；无障碍失败。
- `aria-busy` 和 `aria-live` 的差别？→ busy 是"忙"，live 是"内容会自动更新，念给我听"；两者常配合但概念不同。

---

## §7 验证

### §7.1 - §7.5（本日不涉及）

### §7.6 单元 + 集成测试

**§7.6.1 FSM 表遍历测试**（`packages/domain/src/__tests__/alert-fsm.spec.ts`）

```ts
import { describe, expect, it } from 'vitest';
import {
  ALERT_STATUS,
  ALERT_ACTIONS,
  canTransition,
  assertCanTransition,
  InvalidTransitionError,
  nextStatus,
} from '../alert-fsm';

describe('alert-fsm', () => {
  it('所有 (status, action) 组合的合法性与转换表一致', () => {
    const legal = new Set<string>();
    // 手工枚举合法边（与 TABLE 定义一一对应）
    legal.add('NEW|ack'); legal.add('NEW|ignore');
    legal.add('ACK|resolve'); legal.add('ACK|ignore');
    legal.add('RESOLVED|reopen');
    legal.add('IGNORED|reopen');
    legal.add('REOPENED|ack'); legal.add('REOPENED|ignore');

    for (const from of ALERT_STATUS) {
      for (const action of ALERT_ACTIONS) {
        const key = `${from}|${action}`;
        if (legal.has(key)) {
          expect(canTransition(from, action)).toBe(true);
          expect(nextStatus(from, action)).not.toBeNull();
        } else {
          expect(canTransition(from, action)).toBe(false);
          expect(() => assertCanTransition(from, action)).toThrow(InvalidTransitionError);
        }
      }
    }
  });
});
```

**§7.6.2 Service 并发冲突集成测试**（`apps/api/src/alerts/alerts.service.spec.ts`）

```ts
it('两个并发 ack 恰好一个成功一个 409', async () => {
  const created = await prisma.alert.create({
    data: { serverId: 's1', metric: 'cpu', value: 99, zScore: 4, status: 'NEW', version: 0 },
  });

  const results = await Promise.allSettled([
    service.transition(created.id, 'ack', 0, 'user-a'),
    service.transition(created.id, 'ack', 0, 'user-b'),
  ]);

  const oks = results.filter((r) => r.status === 'fulfilled');
  const conflicts = results.filter(
    (r) => r.status === 'rejected' && (r.reason?.getStatus?.() === 409),
  );
  expect(oks).toHaveLength(1);
  expect(conflicts).toHaveLength(1);

  const final = await prisma.alert.findUnique({ where: { id: created.id } });
  expect(final?.status).toBe('ACK');
  expect(final?.version).toBe(1);
});
```

**§7.6.3 前端回滚测试**（`apps/web/src/features/alert-detail/__tests__/state.spec.ts`）

```ts
import { describe, expect, it, vi } from 'vitest';
import { useAlertActions } from '../state';

function mockFetch(status: number, body: any) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  });
}

describe('useAlertActions', () => {
  it('409 时回滚 status 与 version', async () => {
    global.fetch = mockFetch(409, { code: 'VERSION_CONFLICT', currentVersion: 5 }) as any;
    const { state, fire } = useAlertActions({ id: 'a1', status: 'NEW', version: 0 });
    await fire('ack');
    expect(state.alert.status).toBe('NEW');
    expect(state.alert.version).toBe(5);
    expect(state.lastError?.code).toBe('VERSION_CONFLICT');
  });

  it('200 时用服务端权威值覆盖', async () => {
    global.fetch = mockFetch(200, { id: 'a1', status: 'ACK', version: 1 }) as any;
    const { state, fire } = useAlertActions({ id: 'a1', status: 'NEW', version: 0 });
    await fire('ack');
    expect(state.alert.status).toBe('ACK');
    expect(state.alert.version).toBe(1);
    expect(state.lastError).toBeNull();
  });
});
```

三组测试全部通过后才算 §7.6 结束。

### §7.7 反证实验 1 —— 移除服务端 FSM 校验

**假设**：只有前端 disable 按钮，后端不校验也没关系。

**动作**：把 `alerts.service.ts` 的 `assertCanTransition` 那一行注释掉，直接 `updateMany({ ..., data: { status: computedFromAction, ... } })`。

**造假验证**：用 curl 直接发 POST `/alerts/:id/transition`，body 里传 `{ action: 'reopen', expectedVersion: 0 }`，此时 alert 状态是 `NEW`：

```bash
curl -X POST http://localhost:3000/alerts/xxx/transition \
  -H 'content-type: application/json' \
  -d '{"action":"reopen","expectedVersion":0}'
```

**期待现象**：
- 请求返回 200，`status: REOPENED`，version: 1。
- 数据库里出现了一条"从未 RESOLVED 过就直接 REOPENED"的告警，这在业务上是非法的。
- 后续再 GET 列表，看到这条告警但没有前置状态记录，运维无法解释为什么它是 REOPENED。

**恢复**：撤销注释，重新跑 `§7.6.2` 的集成测试，确认再次 curl 时返回 409 `INVALID_TRANSITION`。

**结论证据**：单靠前端 disable 无法防御任何有工具的用户，服务端权威 FSM 是必要防线。

### §7.8 反证实验 2 —— 移除 `expectedVersion` 校验

**假设**：只用 FSM 检查合法转换，不用 version 也能防并发。

**动作**：把 `updateMany({ where: { id, version: expectedVersion } })` 改成 `update({ where: { id } })`；DTO 里删掉 `expectedVersion`。

**造假验证**：写一段脚本模拟两个用户几乎同时点"确认"：

```ts
const alert = await prisma.alert.create({ data: { ..., status: 'NEW', version: 0 } });
const [a, b] = await Promise.all([
  fetch(`/api/alerts/${alert.id}/transition`, { method:'POST', body: JSON.stringify({ action:'ack' })}),
  fetch(`/api/alerts/${alert.id}/transition`, { method:'POST', body: JSON.stringify({ action:'ack' })}),
]);
```

**期待现象**：
- 两个请求都返回 200。
- 数据库最终 status=ACK，但版本号只有一次递增（因为没在 SQL 里比较 version），审计视角看不出发生过两次操作。
- 若两个用户分别选择"确认"和"忽略"，那么后一个悄悄覆盖前一个，用户 A 看到的是"确认"但实际最终是"忽略"。

**恢复**：还原 `updateMany` 与 `expectedVersion` 校验，运行 §7.6.2 集成测试确认恰好一个 200、一个 409。

**结论证据**：FSM 只解决"能不能"的问题，`expectedVersion` 才解决"谁先谁后、要不要告知冲突"的问题。两者缺一不可。

### §7.9 四件套 + commit（不推送）

四件套（都必须落盘）：

1. commit：本地一次提交，见下方 message。
2. 测试输出：`pnpm --filter domain test`、`pnpm --filter api test`、`pnpm --filter web test` 三段贴入 `学习日志/2026-07-22.md`。
3. 学习日志：《Day09 学习日志》里回答课末 3 个核心问题 + 五要素表格 + 两次反证实验的动作/期待/结论/恢复。
4. 架构证据：把 `alert-fsm.ts` 的转换表和 `alerts.service.ts` 的 `transition()` 截图或代码块贴入《架构证据/Day09-状态机与乐观锁.md》，并画一张时序图展示两个并发请求分别走成功/409 两条路径。

commit：

```bash
git add packages/domain apps/api apps/web
git commit -m "feat(alert): server-authoritative FSM with optimistic locking (Day09)

- add AlertStatus/AlertAction and TABLE in packages/domain/alert-fsm.ts
- add POST /alerts/:id/transition with expectedVersion
- add updateMany-based optimistic lock, 409 on version mismatch
- add web optimistic UI with revert on 409

Refs: Day9"
```

**禁止 `git push`**，禁止部署，禁止执行 Prisma 生产环境迁移。

---

## §8 v3 自检清单（对齐规范 §8）

按顺序逐项打勾，一个不过要回去补。

1. `§0 项目当前状态` 明确列出 Day08 已完成的能力与今天要解决的 4 个问题。
2. `§1.4` 有 5 个子块：rationale / tree / diff-table / 依赖箭头 / 3 个理解问题。
3. `§1.5` 出现"按第 5.3 节的代码"和"边写边问自己"两条指令。
4. `§5` 覆盖 v1 → v2 → v3 三层演进，每层给出代码与遗留问题。
5. `§5.3` 完整代码零省略号、零"…此处略"。
6. `§5.4` 六个知识点，每点五要素俱全（解决的问题 / 运行机制 / 项目落点 / 生产误区 / 验证方法）。
7. `§6.5` 存在，主题聚焦 HTML/表单原生能力（本日：button disabled + aria-busy）。
8. `§7.6/§7.7/§7.8` 分别给出单元/集成测试代码与两个反证实验。
9. `§7.9` 明确禁止 `git push`，commit message 含 `Refs: Day9`。
10. 全文 0 处 `> ✅` 或 `> ❌` 块引用格式。
11. `§12` 保留 PDF 面试题原文与"不能替代教师五连问"的免责声明。

---

## §9 AI 与人分工

- 人写：`alert-fsm.ts` 的 TABLE、`transition()` 事务体、前端 `state.ts` 三段式回滚、两次反证实验的操作与结论。
- AI 辅助：枚举 5×4=20 组转换用例、生成 Prisma migration SQL 骨架、生成按钮 label 映射、生成 vitest mock fetch 的样板。
- 记录：AI Review 里必须写清每段 AI 建议的接受/修改/拒绝理由；核心 FSM 表、乐观锁 SQL、reducer 一律不得由 AI 代写。

---

## §10 时间盒

- 原理与源码理解 90 分钟：读完本文 §1、§3-§5、§5.4、§7.7、§7.8；不写代码。
- 真实项目增量 60 分钟：写 `alert-fsm.ts` → Prisma migration → `transition()` service → controller → 前端 state.ts → AlertActions.vue。
- 测试与故障注入 20 分钟：跑 §7.6 三组测试；执行 §7.7、§7.8 两次反证实验。
- 架构证据 + AI Review + 复盘 10 分钟：更新架构证据文档，回答课末三题。

超时提醒：若"真实项目增量"块超过 130 分钟，停下来评估是否卡在了乐观锁的 Prisma 语法上，先做 §5.4 知识点 4 的验证方法（两个 Promise.all）再回来。

---

## §11 通过标准

- 所有 5×4 组状态-动作组合中，非法边为 0（`§7.6.1` 测试通过）。
- 两并发 ack 恰好一成功一 409，最终 version=1（`§7.6.2` 通过）。
- UI 收到 409 后 status 立即回到 prev，version 采用服务端返回值（`§7.6.3` 通过）。
- `§7.7` `§7.8` 两次反证实验都记录了"动作 / 期待现象 / 恢复动作 / 结论证据"四项。
- commit 存在且 message 以 `Refs: Day9` 结尾；本地无 `git push`。

---

## §12 PDF 面试题

以下两道来源于公开 PDF 面试题，作为知识对照点保留，**不能替代**教师依据真实 diff 现场提出的五连问。教师验收权在教师，本节仅供自查。

1. 手写状态机模拟 AI Agent 的状态切换，并说明非法转换如何处理。
   来源：《2026高德 AI agent 前端开发》，第 8 页。
2. 如何实现支持多轮对话中断和重新生成的状态机？
   来源：《2026MiNiMax前端AI开发》，第 6 页。

对应知识：服务端权威 FSM、并发操作、幂等、UI 回滚。

---

## §13 课末 3 个核心问题（写完后先答这三题，再进入教师五连问）

1. 请从今天项目的真实入口（AlertActions.vue 的 click）到最终输出（数据库里 version 递增的那一行）解释"状态机"的数据流；FSM 表、`assertCanTransition`、`updateMany` 乐观锁、前端 `revert(prev)` 分别在哪一层、按什么顺序生效？为什么必须是这个顺序，颠倒会出什么问题？
2. 如果故意移除本日最关键的保护机制（选一个：服务端 FSM 校验 / expectedVersion / 前端 revert），线上会看到什么可观察现象？请给出最小复现步骤、定位证据（哪张表、哪条日志）、临时止损与根因修复、以及一条防复发测试。
3. 引用今天 `alert-fsm.ts`、`alerts.service.ts` 与 `state.ts` 的具体代码段，证明"非法转换不可能被写入数据库、并发写恰好一次成功、UI 失败可恢复"三项目标已经达成；再说明本实现距离企业生产标准还缺什么（比如：审计日志、幂等 key、事务隔离级别、跨服务事件通知），并给出下一步演进路径。

---

## §14 教师五连问（教师在真实 diff 前现场发问，不预设题目）

学生提交 commit、测试输出、学习日志、反证记录、架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"发问 5 道。评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
