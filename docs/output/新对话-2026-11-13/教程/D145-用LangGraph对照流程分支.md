# D145　用LangGraph对照流程分支

第 21 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。在手写工程的 apps/server 安装本日 package.json 所列的 @langchain/langgraph，再运行本章图分支测试。前置阅读见[上一讲](D144-从业务证据推导工作流.md)。

## 今天要做出什么

让普通状态机和 LangGraph 分别处理同一条已复核未解决事件，比较下一步及原处理人。

## 今天的目录结构

- `apps/server/package.json`
- `apps/server/test/service-graph.e2e-spec.ts`

## 零、闭卷回忆

**D144**　缺负责人复核时能把人工结果发送给用户验收吗？

<details><summary>核对</summary>

服务端检查状态及操作者。已处理交负责人，已复核才到提单人。

</details>

**D142**　只用 companyId 作偏好键会发生什么？

<details><summary>核对</summary>

同时限定公司和用户，删除操作也使用同一复合范围。

</details>

**D138**　相同前缀是否意味着相同用户材料可以共享？

<details><summary>核对</summary>

前缀只含通用约束。工单材料按本次主体和权限加载。

</details>

## 一、知识点与推导

对照持久状态、下一操作者和终止条件，并检验重复事件。

把展示偏好、当前工单事件及共享知识分三处读取。用已复核后未解决的事件重放同一张单，检查处理人、版本和下一操作者。删除偏好后重复读取。

## 二、动手开发

1. 让普通状态机和 LangGraph 分别处理同一条已复核未解决事件，比较下一步及原处理人。先记录操作者、输入和预期。
2. 用同样输入对照流程分支。在输出中圈出能区分成功和失败的字段。
3. 两个流程输出相同文案能证明分支一致吗？改变这一项条件，保存输出并恢复实现。

在手写工程的 `apps/server` 目录运行

```sh
pnpm exec vitest run --config vitest.config.e2e.ts test/service-graph.e2e-spec.ts
```

<details><summary>提示一 · 方向</summary>

开始只传事实、空 completed、空 next 和 waiting。

</details>
<details><summary>提示二 · API</summary>

Annotation.Root、StateGraph、addConditionalEdges。

</details>
<details><summary>提示三 · 实现顺序</summary>

先让空缺口返回 END，再让有证据的节点只推进一步。

</details>

### 步骤 2　做成对样本

<details><summary>提示一 · 方向</summary>

让原生循环与图消费同一份不可变输入。

</details>
<details><summary>提示二 · API</summary>

incidentGraph.invoke 与 incidentPlan。

</details>
<details><summary>提示三 · 实现顺序</summary>

分别删除 diagnosed、approved、verified 等标志，比较三个返回字段。

</details>

在 `apps/server` 运行 `pnpm exec vitest run --config vitest.config.e2e.ts test/service-graph.e2e-spec.ts`。

<details><summary>提示一 · 先找观察点</summary>

让普通状态机和 LangGraph 分别处理同一条已复核未解决事件，比较下一步及原处理人。

</details>

<details><summary>提示二 · 切换一个条件</summary>

两个流程输出相同文案能证明分支一致吗？

</details>

<details><summary>提示三 · 对照判定</summary>

对照持久状态、下一操作者和终止条件，并检验重复事件。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

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
  "files": [
    "dist"
  ],
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
    "@nestjs/bullmq": "12.0.2",
    "@nestjs/common": "^12.0.1",
    "@nestjs/core": "^12.0.1",
    "@nestjs/jwt": "12.0.5",
    "@nestjs/platform-express": "^12.0.1",
    "@nestjs/terminus": "12.2.0",
    "@ops-ticket/shared": "workspace:*",
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "bullmq": "6.7.6",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "dotenv": "^18.0.10",
    "ioredis": "6.0.0",
    "pg": "^8.23.1",
    "prom-client": "15.1.3",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "4.6.7",
    "llama-tokenizer-js": "1.2.2"
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
    "vitest": "^4.1.2",
    "@langchain/langgraph": "1.7.5",
    "@langchain/core": "1.4.2"
  }
}
```

**apps/server/test/service-graph.e2e-spec.ts**

```ts
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { advance, replay, type Snapshot, type Command } from '../src/agent/incident-plan.js';
const state=Annotation.Root({ticket:Annotation<Snapshot>(),commands:Annotation<Command[]>(),index:Annotation<number>()});
const graph=new StateGraph(state).addNode('apply',({ticket,commands,index})=>({
  ticket:advance(ticket,commands[index]!),index:index+1
})).addEdge(START,'apply').addConditionalEdges('apply',s=>s.index<s.commands.length?'apply':END,['apply',END]).compile();

it('两种执行方式都在复核后回原人，再次处理后由提单人确认',async()=>{
  const initial:Snapshot={status:'reviewed',version:5,departmentId:'net',assigneeId:'worker',companyId:'a',reporterId:'lin'};
  const reporter={id:'lin',role:'reporter',companyId:'a'};
  const commands:Command[]=[
    {action:'unresolved',actor:reporter,version:5},
    {action:'handle',actor:{id:'worker',role:'operator',departmentId:'net'},version:6},
    {action:'approve',actor:{id:'lead',role:'department_lead',departmentId:'net'},version:7},
    {action:'resolved',actor:reporter,version:8}
  ];
  for(let length=1;length<=commands.length;length++){
    const prefix=commands.slice(0,length);
    const result=await graph.invoke({ticket:initial,commands:prefix,index:0});
    expect(result.ticket).toEqual(replay(initial,prefix));
    expect(result.ticket.assigneeId).toBe('worker');
    expect(result.ticket.status).toBe(['human_processing','handled','reviewed','completed'][length-1]);
  }
  await expect(graph.invoke({ticket:initial,commands:[commands[0]!,commands[0]!],index:0})).rejects.toThrow('版本');
});
```

## 五、核心面试题

1. 缺负责人复核时能把人工结果发送给用户验收吗？
2. 只用 companyId 作偏好键会发生什么？
3. 两个流程输出相同文案能证明分支一致吗？

对照持久状态、下一操作者和终止条件，并检验重复事件。 [本日配套面试题](D145-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

跨公司隔离、用户返工、负责人两次复核、确认后生成候选，以及获批版本发布均在本机业务接口复现。[工单事件](../学习记录/新版验收/D160-clean.json)。
