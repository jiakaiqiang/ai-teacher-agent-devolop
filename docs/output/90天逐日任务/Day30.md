# Day 30：月度门禁 M3（综合考试 + 关闭 AI 独立实现新功能）

> **《90 天拆分规则说明》校正口径（Day 30 权威执行口径）**
>
> - 阶段定位：阶段一收官（Day01-30，前端 -> AI 前端）；本日仍在 p1-monitor 完成一个可运行的跨层诊断报告模块和月度门禁。
> - 完整模块：Vue3 -> NestJS -> BullMQ -> Worker -> Prisma/OSS -> JWT/Redis 的导出、下载、状态和故障恢复链路，代码、E2E、故障证据必须进入主项目。
> - v1：闭卷实现最小导出任务；v2：补 owner 鉴权、jobId 幂等、事务和可观察状态；v3：加入随机故障、回滚/重放、50 次无重复副作用门禁。后一版必须修复前一版可观察的跨层痛点。
> - 累积复用：输入是 Day01-29 的事件、鉴权、缓存、事务、队列和 UI 合同；输出供 Day31 的后端/Agent 全栈深化复用。
> - 时间盒：90 分钟阅读 + 90 分钟动手；阅读 30 分钟复习架构、30 分钟读故障矩阵、30 分钟读评分门禁，动手 60 分钟独立实现、30 分钟故障注入和修复。
> - 硬门槛：测试、E2E、权限审计、故障时间线和提交证据齐全；未在关闭 AI 条件下运行的结果不计分。
>
> **反证 1**：临时移除 jobId 幂等并重放同一导出任务两次，必须观察到重复副作用，恢复幂等后 50 次演练只允许一次写入。
>
> **反证 2**：临时绕过 owner JWT 检查并用另一用户下载，必须观察到越权测试失败；恢复资源授权后下载应被拒绝并写审计。
>
> **跨 Day 导航**：前置 Day01-29 的全栈合同；本日输出诊断报告、E2E、故障和架构证据，后续由 Day31 的 AI 全栈后端/RAG 链路继续复用。

任务版本：标准版
日期与时长：2026-08-12 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
角色视角：完成 Day 1-29 全栈基础学习，第一次要在"关闭 AI"的情况下独立实现一个跨 Node/DB/JWT/Redis/Queue/UI 全链路的新功能、并通过教师随机故障注入验证可靠性的学习者

---

## 0. 今天在 90 天路线中的位置

90 天转型路线的三个阶段：

```
阶段一（Day 1-30）：前端 → AI 前端
   项目：p1-monitor 智能运维监控（Vue 3 + TypeScript + WebSocket + Agent UI）
   Day 1-5：前端 Agent 运行时展示、状态机、WebSocket 实时
   Day 6-10：后端 Nest + Prisma + FSM + M2 门禁
   Day 11-20：Tool Registry + Agent Loop + 持久化 + SSE + LangChain RAG
   Day 21-29：NestJS 架构 + API 合同 + 鉴权 + 测试 + 流式 BFF + 持久化 + 缓存 + 队列
   Day 30：M3 月度门禁（综合考试 + 独立实现）  ← 今天在这里

阶段二（Day 31-60）：AI 前端 → AI 全栈
   项目：p1-monitor 全栈深化 + LangGraph 多 Agent

阶段三（Day 61-90）：AI 全栈 → AI Agent 工程师
   项目：p2-agent-workbench 多 Agent 协同工作台
```

**Day 30 是阶段一总结日**。前 29 天学了 Vue3、NestJS、Prisma、JWT、Redis、BullMQ、LangChain 等技术栈，但都是"看着文档 + AI 辅助"完成的。今天要验证"**关闭 AI 后能否独立实现一个新功能**"——不是复制粘贴代码，而是从需求出发、设计架构、写代码、写测试、故障注入、全部自己完成。

### 到 Day 29 结束时项目已具备的能力

- **前端**（Day 1-5, Day 9）：Vue3 + Vite + ECharts，Agent 事件时间线，状态机 UI，服务端权威 FSM
- **后端架构**（Day 21）：NestJS 模块边界 + DI scope + Provider 生命周期
- **API 合同**（Day 22）：DTO + OpenAPI + 版本兼容
- **数据建模**（Day 23）：Conversation / Message / Citation / Diagnosis 聚合 + 复合索引
- **鉴权**（Day 24）：JWT + RBAC/ABAC + 资源级授权
- **测试**（Day 25）：单元 / 集成 / E2E 三层
- **流式 BFF**（Day 26）：模型流透传、背压、取消上游
- **持久化**（Day 27）：Outbox 一致性 + 乐观锁 + 软删除
- **缓存**（Day 28）：Redis Cache-aside + 限流 + 分布式幂等键
- **队列**（Day 29）：BullMQ jobId 幂等 + 重试退避 + 死信 + 取消传播

### 今天要验证的 4 个能力

1. **能力 1：关闭 AI 独立实现新功能（全链路贯通）**
   需求：新增"导出诊断报告"功能——用户在前端点"导出"按钮，后端生成 PDF 报告（包含所有诊断记录），存到 OSS，返回下载链接。这个功能要贯通 **Vue3 UI → NestJS Controller → BullMQ Queue → Worker 生成 PDF → Prisma 查询 → JWT 鉴权（只能导出自己的） → Redis 幂等键 → 前端轮询状态**。**关闭 AI 后，能否独立完成？**

2. **能力 2：跨层故障注入（随机故障下的可靠性）**
   教师随机注入 3 个故障（例如"Redis 在幂等检查后断开" + "worker 在 DB 提交前崩溃" + "JWT 同时过期"），要求：定位唯一根因链（不是 3 个独立故障，而是 1 条因果链）、设计临时止损、完成根因修复、连续演练 50 次验证无重复副作用或越权。**能否在 40 分钟内完成？**

3. **能力 3：综合考试（>=70 分）**
   笔试题覆盖 Day 1-29 的核心知识点（Node 运行时、数据库、鉴权、缓存、队列），每题必须写出"问题/机制/落点/误区/验证"五要素，不能只记 API。**能否达到 70 分及格线？**

4. **能力 4：架构回顾（一个月的成长可视化）**
   对比 Day 01 和 Day 30 的项目架构图，说明"增加了哪些层"、"解决了哪些问题"、"还缺什么"。**能否清晰表达？**

---

## 1. 今天要交付的功能模块

**不是三版演进，而是独立考试**。今天的任务是：在关闭 AI 的情况下，独立实现一个新功能"导出诊断报告"，要求贯通 Vue3 → NestJS → BullMQ → Prisma → JWT → Redis 全链路，通过教师随机故障注入验证可靠性。

### 1.1 用户能看到什么

**场景：导出诊断报告（全链路贯通）**

```
时间轴：

16:00:00.000  用户：在前端点"导出诊断报告"按钮
  → 前端：POST /reports/export  Header: Authorization: Bearer <JWT>
  → 后端 Controller：
    1. 解析 JWT，提取 userId
    2. 计算 jobId = sha256(userId + date)（幂等：同一天只能导出一次）
    3. 检查 Redis 幂等键：redis.get(`export:${userId}:${date}`)
    4. 未命中，添加到 BullMQ 队列：queue.add('export', {userId, date}, {jobId})
    5. 200ms 返回 {jobId, status: 'waiting'}

16:00:00.200  前端收到 jobId，开始轮询状态：
  → GET /reports/jobs/{jobId}/status
  → {status: 'active', progress: 30}
  前端显示进度条

16:00:10.000  Worker 执行：
  → 查询 DB：SELECT * FROM diagnosis WHERE user_id = ? ORDER BY created_at
  → 生成 PDF（puppeteer 渲染 HTML 模板）
  → 上传到 OSS：putObject('reports/{userId}/{date}.pdf')
  → 写入 Redis 结果：redis.set(`export:${userId}:${date}`, downloadUrl, 'EX', 86400)
  → 标记 job completed

16:00:10.100  前端轮询状态：
  → GET /reports/jobs/{jobId}/status
  → {status: 'completed', result: {downloadUrl: 'https://oss.../report.pdf'}}
  前端显示"下载"按钮

16:00:10.200  用户点"下载"：
  → GET /reports/download?url=https://oss.../report.pdf  Header: Authorization: Bearer <JWT>
  → 后端验证：
    1. 解析 JWT，提取 userId
    2. 检查 downloadUrl 是否属于该 userId（防止跨用户下载）
    3. 返回 302 redirect 到 OSS 签名 URL（有效期 10 分钟）
```

用户体验：
- 点"导出"后 200ms 返回，前端显示进度条
- 10 秒后生成完成，显示"下载"按钮
- 点"下载"后跳转到 OSS，直接下载 PDF
- 同一天重复点"导出"，直接返回已有的 downloadUrl（幂等）
- 其他用户无法下载（JWT 鉴权）

### 1.2 这个功能在项目里承担什么

- **输入**：用户点"导出诊断报告"按钮，前端携带 JWT
- **输出**：PDF 报告（包含用户所有诊断记录）+ 下载链接（只有本人能下载）
- **验证点**：Vue3 UI → NestJS Controller → BullMQ Queue → Worker → Prisma → JWT → Redis 全链路贯通 + 随机故障注入可靠性验证

### 1.3 今天的学习节奏（与前 29 天不同）

今天仍是"**90 分钟阅读 + 90 分钟独立考试/故障注入**"模式：

| 阶段 | 时长 | 内容 | 交付物 |
|---|---|---|---|
| A：阅读 | 90 min | §2 复习清单、§4 故障矩阵、评分与回滚门禁 | 能口述每个知识点的"问题/机制/落点/误区/验证"五要素 |
| B：动手 | 90 min | §3 独立实现导出报告，§4 注入并修复随机故障 | 前端 + 后端 + worker + 测试完成，E2E 与反证通过 |

**总计**：90 分钟阅读 + 90 分钟动手 = 180 min

---

## 2. 月度复习清单（Day 1-29 核心知识点）

在开始独立实现前，先复习 10 个核心知识点（每个 4 分钟）。每个知识点必须能口述"问题 / 机制 / 落点 / 误区 / 验证"五要素。

### 2.1 Node.js Event Loop（Day 11）

- **问题**：为什么 `setTimeout(fn, 0)` 不是立即执行？为什么 Promise.then 比 setTimeout 先执行？
- **机制**：Event Loop 六个阶段（timers / pending / idle / poll / check / close），每个阶段清空对应队列；micro-task（Promise.then）在每个阶段结束后立即执行
- **落点**：Agent Loop 的"下一次 step"要等当前 step 的所有 Promise 完成（micro-task 清空）
- **误区**：认为 Node.js 是多线程（实际是单线程 + libuv 线程池）；认为 `setImmediate` 比 `setTimeout` 慢（实际在 poll 阶段后的 check 阶段，可能更快）
- **验证**：打印执行顺序（`setTimeout` / `setImmediate` / `Promise.then` / `process.nextTick`）

### 2.2 Prisma 事务与隔离级别（Day 27）

- **问题**：为什么"先 SELECT 版本号，再 UPDATE"的乐观锁有竞态？
- **机制**：Postgres 默认隔离级别 ReadCommitted，乐观锁要用 `updateMany WHERE version=?` 把判定和更新合并到一条 SQL（原子）
- **落点**：`updateDiagnosis` 的 `updateMany` + `version: { increment: 1 }`
- **误区**：认为事务自动防止丢失更新（需要显式乐观锁或悲观锁）；认为 Serializable 没有性能损失（实际会 serialization failure）
- **验证**：两个并发事务基于同版本更新，断言一个成功一个 409

### 2.3 JWT 与无状态鉴权（Day 24）

- **问题**：为什么 JWT 无法主动失效（例如用户修改密码后旧 JWT 仍有效）？
- **机制**：JWT 自包含（payload 里有 userId / exp），服务端验签不查 DB；要主动失效需要引入黑名单（Redis）
- **落点**：`JwtAuthGuard` 解析 JWT 提取 userId；`ResourceOwnerGuard` 检查"请求的资源是否属于该 userId"
- **误区**：把敏感信息（密码、信用卡号）放进 JWT payload（base64 可解码）；exp 设太长（7 天，泄漏后 7 天内有效）
- **验证**：JWT 过期后返回 401；修改 payload 后验签失败返回 401

### 2.4 Redis Cache-aside 模式（Day 28）

- **问题**：为什么"先写缓存、再查 DB"错了？
- **机制**：Cache-aside = 先查缓存 → 未命中查 DB → 写缓存；Cache-through = 缓存层自己负责
- **落点**：`getOrCompute(key, compute, ttl)` 封装三步
- **误区**：把"写缓存"放在 compute 回调里（compute 失败缓存也写了，脏数据）；TTL 不加 jitter（同时过期雪崩）
- **验证**：第一次查耗时 200ms（DB），第二次查耗时 5ms（缓存）

### 2.5 BullMQ jobId 幂等（Day 29）

- **问题**：为什么重复上传同一文件会创建多个 job？
- **机制**：`queue.add(name, data, {jobId})` 时，BullMQ 用 jobId 作 Redis key；重复添加时返回已有 job
- **落点**：`jobId = sha256(fileContent)`，保证同一文件只摄取一次
- **误区**：jobId 用 `requestId`（前端每次刷新生成新 requestId，幂等失效）；jobId 用随机数（没有幂等）
- **验证**：同一文件上传两次，`redis-cli KEYS bull:ingest:*` 只有一个 job key

### 2.6 Outbox 模式（Day 27）

- **问题**：为什么"写库成功 + 发消息失败"会导致"已展示未发布"裂缝？
- **机制**：把待发事件作为一行写进同库的 Outbox 表（同事务原子），relay 进程异步轮询发布
- **落点**：`outbox.writeInTx` 接收调用方 tx；`OutboxRelayService` 轮询 + 崩溃重扫
- **误区**：relay 发布后忘记 markPublished（无限重发）；Outbox 不清理（表无限膨胀）
- **验证**：在 message.create 后、事务提交前 kill 进程，重启后断言事件仍被发出

### 2.7 滑动窗口限流（Day 28）

- **问题**：为什么固定窗口限流有"窗口边界突刺"？
- **机制**：ZSET 的 score 是时间戳，每次请求先删窗口外的旧记录、统计窗口内计数、加入本次请求
- **落点**：`slidingWindow.allowRequest(key, 60, 10)` 判断过去 60 秒内是否超过 10 次
- **误区**：忘记 `zremrangebyscore` 清理旧记录（ZSET 无限增长）；窗口 key 忘记设过期（内存泄漏）
- **验证**：1 秒内发 11 次请求，第 11 次返回 429

### 2.8 死信队列（Day 29）

- **问题**：为什么毒任务不能自动重试？
- **机制**：重试 N 次仍失败的 job 移入死信队列；DLQ 里的 job 不会自动重试，需要人工介入
- **落点**：监听 `failed` 事件，调 `dlq.moveToDeadLetter`
- **误区**：DLQ 自动重试（会无限循环）；DLQ 不监控（毒任务堆积不知道）
- **验证**：上传损坏 PDF，重试 3 次后进 DLQ；`redis-cli XLEN bull:dead-letter:wait` 看 DLQ 长度

### 2.9 流式 BFF 背压（Day 26）

- **问题**：为什么"客户端断开连接后服务端还在生成"浪费资源？
- **机制**：客户端断开 → req.on('close') → AbortController.abort() → 上游检查 signal.aborted
- **落点**：BFF 的 `req.on('close')` 触发 `abortController.abort()`；上游 Agent Loop 在每次 step 前检查 `signal.aborted`
- **误区**：只关闭前端连接不传播取消（上游还在跑）；AbortController 只在开头检查一次（长任务执行到一半取消无效）
- **验证**：客户端断开连接，500ms 内上游停止生成

### 2.10 服务端权威 FSM（Day 9）

- **问题**：为什么前端本地状态机会和服务端不一致？
- **机制**：服务端是唯一状态源，前端发送 action + expectedVersion；服务端原子检查版本 + 执行转换 + 返回新状态；版本不匹配返回 409
- **落点**：`PUT /diagnosis/:id/transition` 接收 `{action, expectedVersion}`；服务端 `updateMany WHERE id=? AND version=?`
- **误区**：前端直接更新状态（乐观 UI），服务端拒绝后前端忘记回滚；expectedVersion 用时间戳（时钟回拨撞）
- **验证**：两个客户端同时发 action，一个成功一个 409

---

## 3. 独立实现：导出诊断报告（关闭 AI，100 分钟）

**重要提示**：这一节不提供完整代码，只提供需求、架构设计和验收标准。**关闭 AI 后，你需要独立完成全部实现**。

### 3.1 需求描述

**功能**：用户在前端点"导出诊断报告"按钮，后端生成 PDF 报告（包含该用户所有诊断记录），上传到 OSS，返回下载链接。

**约束**：
- 前端：Vue3 组件，显示"导出"按钮 + 进度条 + "下载"按钮
- 后端：NestJS Controller + BullMQ Queue + Worker
- 鉴权：JWT，只能导出自己的报告、只能下载自己的报告
- 幂等：同一天只能导出一次（jobId = sha256(userId + date)）
- 可观测：前端轮询 job 状态（waiting / active / completed / failed）

### 3.2 架构设计（你需要设计的 7 个组件）

```
前端（Vue3）：
  ExportButton.vue                       ← 点击触发导出
      │
      ├─ POST /reports/export
      │      ↓
      └─ GET /reports/jobs/:id/status    ← 轮询状态

后端（NestJS）：
  ReportsController
      │
      ├─ POST /reports/export            ← 添加 job 到队列
      │     ↓
      │   QueueProducer.addExportJob({userId, date}, {jobId})
      │
      ├─ GET /reports/jobs/:id/status    ← 查询 job 状态
      │     ↓
      │   QueueProducer.getJobStatus(jobId)
      │
      └─ GET /reports/download?url=...   ← 验证授权后 302 redirect

Worker（BullMQ）：
  ExportWorker
      │
      ├─ 查询 DB：prisma.diagnosis.findMany({where: {userId}})
      ├─ 生成 PDF：puppeteer 渲染 HTML 模板
      ├─ 上传 OSS：ossClient.put('reports/{userId}/{date}.pdf', buffer)
      └─ 写入 Redis 结果：redis.set(`export:${userId}:${date}`, downloadUrl)
```

### 3.3 你需要实现的文件清单

**前端（3 个文件）**：
1. `frontend/src/components/ExportButton.vue`（导出按钮 + 进度条）
2. `frontend/src/api/reports.ts`（调用后端 API）
3. `frontend/src/types/report.ts`（类型定义）

**后端（7 个文件）**：
1. `apps/api/src/reports/reports.controller.ts`（HTTP 入口）
2. `apps/api/src/reports/reports.service.ts`（业务逻辑）
3. `apps/api/src/reports/dto/export-report.dto.ts`（DTO）
4. `apps/api/src/queue/worker/export.worker.ts`（PDF 生成 worker）
5. `apps/api/src/oss/oss.service.ts`（OSS 上传封装）
6. `apps/api/src/reports/templates/report.html`（PDF HTML 模板）
7. `apps/api/src/reports/reports.module.ts`（NestJS 模块）

**测试（3 个文件）**：
1. `apps/api/src/reports/reports.controller.spec.ts`（Controller 单测）
2. `apps/api/src/queue/worker/export.worker.spec.ts`（Worker 单测）
3. `apps/api/test/reports.e2e-spec.ts`（E2E 测试）

### 3.4 关键实现要点

**要点 1：jobId 幂等（同一天只能导出一次）**

```typescript
// 计算 jobId
const jobId = createHash('sha256')
  .update(`${userId}-${date}`)
  .digest('hex')
  .slice(0, 16)

// 添加 job 时传 jobId
await this.exportQueue.add('export', {userId, date}, {jobId})
```

**要点 2：JWT 鉴权（只能导出自己的）**

```typescript
// Controller 里提取 userId
@UseGuards(JwtAuthGuard)
@Post('/export')
async export(@Request() req) {
  const userId = req.user.id // 从 JWT 提取
  // ...
}

// 下载时验证 downloadUrl 属于该 userId
@Get('/download')
async download(@Query('url') url: string, @Request() req) {
  const userId = req.user.id
  // 检查 url 是否以 `reports/${userId}/` 开头
  if (!url.includes(`reports/${userId}/`)) {
    throw new ForbiddenException('不能下载其他用户的报告')
  }
  // 返回 302 redirect 到 OSS 签名 URL
}
```

**要点 3：Worker 生成 PDF（puppeteer）**

```typescript
import puppeteer from 'puppeteer'

async generatePdf(data: { diagnoses: Diagnosis[] }): Promise<Buffer> {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  
  // 渲染 HTML 模板
  const html = this.renderTemplate(data)
  await page.setContent(html)
  
  // 生成 PDF
  const pdf = await page.pdf({ format: 'A4' })
  await browser.close()
  
  return pdf
}
```

**要点 4：前端轮询状态**

```typescript
// ExportButton.vue
async function startExport() {
  // 1. 发起导出
  const { jobId } = await api.export()
  
  // 2. 轮询状态
  const interval = setInterval(async () => {
    const status = await api.getJobStatus(jobId)
    progress.value = status.progress
    
    if (status.status === 'completed') {
      clearInterval(interval)
      downloadUrl.value = status.result.downloadUrl
      showDownloadButton.value = true
    }
  }, 1000) // 每秒轮询一次
}
```

### 3.5 验收标准（必须全部通过）

- [ ] 前端点"导出"按钮后 500ms 内返回 jobId
- [ ] 前端显示进度条（0% → 50% → 100%）
- [ ] Worker 生成 PDF 并上传 OSS（10 秒内完成）
- [ ] 前端显示"下载"按钮，点击后跳转到 OSS
- [ ] 同一天重复点"导出"，直接返回已有 downloadUrl（不重新生成）
- [ ] 其他用户无法下载（JWT 验证失败返回 403）
- [ ] E2E 测试通过（模拟完整流程）

### 3.6 时间分配建议（100 分钟）

- 前端（25 分钟）：ExportButton.vue + api.ts
- 后端 Controller（15 分钟）：添加 job + 查询状态 + 下载验证
- Worker（30 分钟）：查询 DB + 生成 PDF + 上传 OSS
- 测试（20 分钟）：单测 + E2E
- 调试（10 分钟）：端到端验证

---

## 4. 故障注入：跨层故障排查（40 分钟）

**重要提示**：这一节由教师现场随机注入 3 个跨层故障，你需要在 40 分钟内定位唯一根因链、设计临时止损、完成根因修复、连续演练 50 次验证。

### 4.1 故障场景示例

**教师注入的 3 个故障**（实际考试时随机）：

1. **故障 A**：Redis 在幂等检查后断开（`redis.get` 成功返回 null，`redis.set` 时抛 `ECONNREFUSED`）
2. **故障 B**：Worker 在 DB 提交前崩溃（`prisma.diagnosis.findMany` 成功，`ossClient.put` 成功，`redis.set` 前崩溃）
3. **故障 C**：JWT 同时过期（用户点"下载"时 JWT 刚好过期）

**观察到的现象**：
- 用户点"导出"后，生成了 2 份重复的 PDF（同一 jobId 执行了 2 次）
- 用户 A 能下载用户 B 的报告（跨用户可见）

### 4.2 你需要完成的 4 步

**步骤 1：定位唯一根因链（10 分钟）**

画出因果链（不是 3 个独立故障，而是 1 条链）：

```
根因：Redis 断开 + Worker 崩溃 + JWT 过期的组合
  │
  ├─ Redis 断开 → 幂等键写入失败 → 重复请求创建多个 job
  │                                    │
  │                                    ├─ job-001 执行到一半崩溃
  │                                    └─ job-002 重新执行（重复）
  │
  └─ JWT 过期 → 下载时鉴权失败 → 用户重新登录 → 获得新 JWT
                                              │
                                              └─ 新 JWT 的 userId 错了（因为登录接口有 bug）
```

**定位证据**：
- Redis 日志：`ECONNREFUSED at 16:00:05.123`
- Worker 日志：`Job job-001 failed: OOM at 16:00:08.456`
- JWT payload：`{"userId": "user-B", "exp": 1723456789}`（应该是 user-A）

**步骤 2：临时止损（5 分钟）**

- **止损 1**：禁用"导出"按钮（前端灰掉）
- **止损 2**：隔离下载链接（后端检查 Redis 里的 `export:${userId}:${date}` 是否存在，不存在返回 404）
- **止损 3**：清理重复 PDF（手动删除 OSS 里的重复文件）

**步骤 3：根因修复（15 分钟）**

- **修复 1**：Redis 降级（幂等键写入失败时不抛错，记日志继续）

```typescript
try {
  await redis.set(key, value)
} catch (err) {
  console.warn('[Degradation] Redis set failed, skip cache')
  // 不抛错，让 job 继续执行
}
```

- **修复 2**：Worker 原子性（把"生成 PDF + 上传 OSS + 写 Redis"包在一个事务里，失败全回滚）

```typescript
// 伪代码
try {
  const pdf = await generatePdf()
  const url = await ossClient.put(pdf)
  await redis.set(key, url)
} catch (err) {
  // 回滚：删除已上传的 OSS 文件
  await ossClient.delete(url)
  throw err
}
```

- **修复 3**：JWT 下载鉴权（检查 downloadUrl 是否属于该 userId，而不是只检查 JWT 是否有效）

```typescript
if (!url.includes(`reports/${userId}/`)) {
  throw new ForbiddenException()
}
```

**步骤 4：回归验证（10 分钟）**

- 连续演练 50 次（脚本自动化）：

```bash
for i in {1..50}; do
  # 注入相同的 3 个故障
  docker pause redis
  kill -9 <worker-pid>
  # 模拟 JWT 过期
  
  # 执行导出 + 下载
  curl POST /reports/export
  curl GET /reports/download
  
  # 验证：无重复 PDF、无跨用户可见
  count=$(ls /oss/reports/user-A/ | wc -l)
  if [ $count -gt 1 ]; then
    echo "FAIL: duplicate PDF"
    exit 1
  fi
done
echo "PASS: 50 times"
```

### 4.3 验收标准

- [ ] 定位出唯一根因链（不是 3 个独立故障）
- [ ] 临时止损在 5 分钟内生效
- [ ] 根因修复在 15 分钟内完成
- [ ] 连续演练 50 次无重复副作用或越权
- [ ] 全程关闭 AI（教师监督）

---

## 5. 综合考试（笔试，可选）

**说明**：如果时间不够，可以跳过笔试，只完成§3 独立实现 + §4 故障注入。笔试题在 Day 30 结束后作为复习材料。

### 5.1 考试题示例（10 题，每题 10 分）

**题 1**：请解释 Node.js Event Loop 的 6 个阶段，并说明 `setTimeout` / `setImmediate` / `Promise.then` / `process.nextTick` 的执行顺序。

**题 2**：请解释 Prisma 事务的 4 种隔离级别，并说明"先 SELECT 版本号、再 UPDATE"的乐观锁为什么有竞态。

**题 3**：请解释 JWT 的无状态鉴权机制，并说明"用户修改密码后旧 JWT 仍有效"的问题如何解决。

**题 4**：请解释 Redis Cache-aside 模式的 3 个步骤，并说明"先写缓存、再查 DB"为什么错了。

**题 5**：请解释 BullMQ jobId 幂等的原理，并说明"jobId 用 requestId"为什么幂等失效。

**题 6**：请解释 Outbox 模式解决的"已展示未发布"裂缝，并说明"relay 发布后忘记 markPublished"的后果。

**题 7**：请解释滑动窗口限流的 ZSET 实现，并说明"忘记 zremrangebyscore 清理旧记录"的后果。

**题 8**：请解释死信队列的设计，并说明"DLQ 自动重试"为什么错了。

**题 9**：请解释流式 BFF 背压传播的 AbortController 机制，并说明"只在开头检查 signal.aborted 一次"为什么不够。

**题 10**：请解释服务端权威 FSM 的 expectedVersion 机制，并说明"expectedVersion 用时间戳"为什么有风险。

### 5.2 评分标准

每题必须包含"问题 / 机制 / 落点 / 误区 / 验证"五要素，缺一个扣 2 分。

- **问题**（2 分）：清晰说明这个知识点解决的问题
- **机制**（2 分）：解释运行机制（不能只记 API）
- **落点**（2 分）：说明在项目里的具体应用
- **误区**（2 分）：说明常见错误
- **验证**（2 分）：说明如何验证

**及格线**：总分 >= 70 分，后端基础、SQL、鉴权各 >= 60%。

---

## 6. 架构回顾（一个月的成长）

### 6.1 Day 01 架构 vs Day 30 架构

**Day 01 架构**（只有前端）：

```
Vue3 App
  ├─ AgentTimeline.vue（前端内存状态机）
  └─ mock-events.ts（模拟数据）
```

**Day 30 架构**（全栈 + 队列 + 缓存）：

```
Vue3 App
  ├─ ExportButton.vue
  └─ api/reports.ts
      │
      ▼ HTTP
NestJS API
  ├─ ReportsController (JWT Guard)
  ├─ QueueProducer (BullMQ)
  │     │
  │     ▼ Redis Streams
  ├─ ExportWorker
  │     │
  │     ├─ PrismaService (Postgres)
  │     ├─ OssService (阿里云 OSS)
  │     └─ RedisService (幂等键)
  │
  └─ CacheService (Cache-aside)
```

### 6.2 增加了哪些层

- **NestJS 后端**（Day 6-10, Day 21）：模块化架构 + DI + Provider
- **Prisma ORM**（Day 23, Day 27）：类型安全查询 + 事务 + 乐观锁
- **JWT 鉴权**（Day 24）：无状态鉴权 + RBAC/ABAC
- **Redis 缓存**（Day 28）：Cache-aside + 限流 + 分布式幂等键
- **BullMQ 队列**（Day 29）：异步任务 + jobId 幂等 + 死信 + 取消传播

### 6.3 解决了哪些问题

- **Day 01 问题**：前端内存状态机（刷新丢失）→ **Day 09 解决**：服务端权威 FSM
- **Day 01 问题**：模拟数据（无真实后端）→ **Day 11-13 解决**：Agent Loop + 持久化
- **Day 01 问题**：无鉴权（任何人都能访问）→ **Day 24 解决**：JWT + 资源级授权
- **Day 01 问题**：无缓存（每次查 DB）→ **Day 28 解决**：Redis Cache-aside
- **Day 01 问题**：长任务阻塞请求→ **Day 29 解决**：BullMQ 队列异步化

### 6.4 还缺什么

- **缺失 1**：LangChain RAG（Day 15-20 学了，但还没集成到生产）
- **缺失 2**：LangGraph 多 Agent 协同（Day 31-40 学）
- **缺失 3**：可观测性（Prometheus + Grafana 监控，Day 50-60 学）
- **缺失 4**：CI/CD 自动化部署（Day 70-80 学）

---

## 7. 通过标准

- [ ] 独立实现"导出诊断报告"全链路（关闭 AI，100 分钟内完成）
- [ ] E2E 测试通过（前端 → 后端 → worker → OSS → 下载）
- [ ] 故障注入定位 + 修复（40 分钟内完成，连续演练 50 次无重复副作用或越权）
- [ ] 笔试 >= 70 分（可选）
- [ ] commit 含 `Refs: Day30`，未执行 `git push`

---

## 8. 提交物

1. commit（含 `Refs: Day30`，未执行 `git push`）
2. 独立实现代码（前端 + 后端 + worker + 测试）
3. E2E 测试输出（全绿）
4. 故障注入证据（定位根因链 + 修复 diff + 50 次演练通过）
5. 学习日志（500 字，回顾一个月成长）
6. 架构对比图（Day 01 vs Day 30）

---

## 9. 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释"月度门禁"的数据流或控制流；当天知识链"Node 运行时、数据库、鉴权、缓存、队列"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制（例如去掉 jobId 幂等或去掉 JWT 鉴权），线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## 10. 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. **月度考试现场新增"导出诊断报告"后台任务：请求立即返回 jobId，worker 生成文件，UI 实时显示状态，且只能由 owner 下载。** 请给出 Node/DB/JWT/Redis/Queue 全链路证据；任一层失败先设计止损，再完成修复和 E2E，关闭 AI 独立实现。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[阿里 AI 前端](https://campus-talent.alibaba.com/campus/position/199904460001)

2. **考官随机让 Redis 在幂等检查后断开、worker 在 DB 提交前崩溃、JWT 同时过期，出现重复导出和跨用户可见。** 请用 trace、事务、queue、授权审计定位唯一根因链；先隔离下载止损，再修复跨层不变量，连续演练 50 次验证无重复副作用或越权。回答必须按"定位证据 → 临时止损 → 根因修复 → 回归验证"组织。
   依据：[AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

**知识映射**：一个月综合门禁：Node 运行时、数据库、鉴权、缓存、队列和 UI 的跨层排障。

---

## 11. PDF 面试题

> 以下题目引用自公开面经 PDF 汇编，文件名不等于官方题库；用作练习触发点，不代表本项目对齐了任何一家公司的真实校招/社招题库。

1. **Node.js 的事件循环与浏览器事件循环有什么主要区别？**
   来源：[《2026美团前端全栈开发》](../../资源/2026美团前端全栈开发.pdf)，第 4 页。

2. **介绍项目中最难的技术问题及解决方案。**
   来源：[《2026美团前端全栈开发》](../../资源/2026美团前端全栈开发.pdf)，第 11 页。

**题目说明**：月度门禁题：前者验证 Node 运行时原理，后者必须贯通数据库、鉴权、缓存、队列和 UI 的真实跨层排障。

---

## 12. 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由上面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## 13. 本 Day 在 90 天路线中的锚点

- **前置依赖**：Day 1-29 全部（前端 + 后端 + 鉴权 + 缓存 + 队列）
- **直接后继**：Day 31 开始阶段二（LangGraph 多 Agent 协同）
- **远期对齐**：阶段三 p2-agent-workbench 多 Agent 协同工作台（跨层故障排查是多 Agent 调试的基础）

**Day 30 是阶段一总结日**——通过月度门禁后，证明你已经掌握"前端 → AI 前端"的全栈基础，可以进入阶段二"AI 前端 → AI 全栈"的深化学习。
