# Day 62 - 双 Agent 协同与 Event Sourcing

> **《90 天拆分规则说明》校正口径（Day 62 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师），所有增量进入 p2-agent-workbench 用户主链路。
> - 完整模块：coordinator -> executor 固定协同与 Event Sourcing；代码落点为 backend/app/domain/collaboration.py、backend/app/orchestrator/projector.py、tests/day62，必须能运行、能测试、能观察结果。
> - v1：固定两角色顺序执行一个 TaskContract；v2：接入首个 Local CLI Runtime 与 Handoff/Artifact；v3：加入幂等事件归约、SSE 回补、重启快照和无假完成门禁。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day61 的 Session/Run/Event/Artifact 合同；本日输出直接交给 Day63 的双 CLI Adapter 与统一 Runtime 合同，禁止新建无关 Demo。
> - 时间盒：本日是周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）；深化用于 v3、故障注入、架构证据和复盘。
> - 硬门槛：完成 正常协同、重复/乱序事件、断线回补、重启恢复；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：固定两角色顺序执行一个 TaskContract。先写失败测试，再实现最短用户链路；checkpoint 是一次 Run 有确定终态和 traceId。
2. **v2 关键加层**：接入首个 Local CLI Runtime 与 Handoff/Artifact。复用 v1 合同，不复制旁路实现；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：加入幂等事件归约、SSE 回补、重启快照和无假完成门禁。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后没有静默成功和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day62 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day62。实际命令和输出写入 evidence/day62/。

## 必做测试与两个反证

- 测试范围：正常协同、重复/乱序事件、断线回补、重启恢复；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：删除 event_id/aggregate_version 去重后重放重复事件，投影必须出现可观察错误。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：在 Artifact 写入前杀进程，恢复后不得重复执行副作用或标记 completed。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day61 的 Session/Run/Event/Artifact 合同。
- 本日交付：coordinator -> executor 固定协同与 Event Sourcing。
- 后续消费：Day63 的双 CLI Adapter 与统一 Runtime 合同。

日期与时长：09-13 周日 6h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

接入第一个本地 CLI Runtime，完成固定 `coordinator -> executor` 顺序协同，并用 Event Sourcing 保证 TaskContract、Handoff 和 Artifact 可追踪、可重放。

## 必须掌握的知识

固定角色协同、TaskContract/Handoff/Artifact、Event Sourcing、SSE 回补、幂等

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现本地 CLI 双 Agent 顺序协同、事件归约和断线恢复

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

协同时序图和事件状态机；CLI 失败、Handoff 缺失、重复、乱序、SSE 断线与回补

## 人与 AI 分工

人定义任务合同、角色边界和 reducer 不变量；AI 生成脚手架与异常事件排列

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日为周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）。阅读用于原理、源码和边界；动手用于 v1/v2/v3、测试、故障注入、架构证据与复盘。

## 通过标准

一次 coordinator -> executor Run 可完成并重放；无假完成；断线恢复无漏事件；至少 10 个合同/事件测试

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 从用户创建 Run 到 coordinator 生成 TaskContract、executor 消费 Handoff、CLI 输出事件并形成 Artifact，逐层说明角色合同、Event Sourcing、SSE 投影和幂等如何协作；为什么不能只靠两个 Prompt 串联？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：coordinator 已生成 TaskContract，executor 本地 CLI 已开始写入，但 `handoff.created` 晚于 `invocation.started` 到达；连续执行 300 个 Run 后有 9 个 UI 回到 planning。请按五段式使用 role、task_id、event_id、sequence 和 aggregate_version 定位，止损非法投影，修复协同状态机与幂等回补，并用乱序/重复排列验证。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)
2. 教学模拟：executor 完成本地 CLI 调用后进程退出，但 Artifact 写入前服务重启；恢复逻辑重新执行同一 TaskContract，产生两个不同 diff。请按五段式证明 Handoff/Invocation/Artifact 缺口，冻结自动完成，修复幂等恢复与快照加增量回放，并验证重启不会重复执行副作用。
   依据：[OTel JS](https://opentelemetry.io/docs/languages/js/instrumentation/)
知识映射：Day 62：固定双 Agent、TaskContract/Handoff/Artifact、事件归约、SSE 回补与幂等。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 如何实现支持“多轮对话中断”和“重新生成”的状态机？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。
2. Agent 交互中的 SSE 与 WebSocket 有什么区别？  
   来源：[《2026快手前端研发工程师面试（agent方向）》](<../../资源/2026快手前端研发工程师面试（agent方向）.pdf>)，第 1 页。
题目说明：状态机和流式恢复直接相关；Event Sourcing、乱序回补没有直接原题，属于近似题/资源缺口。
