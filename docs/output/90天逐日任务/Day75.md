# Day 75 - Human Runtime

> **《90 天拆分规则说明》校正口径（Day 75 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师）。MCP、Human Runtime 与 RAG 都是多 Agent 主链路的受控能力，不是独立 Demo。
> - 完整模块：可持久化 Human Runtime 等待与响应状态机；代码落点为 backend/app/runtimes/human.py、domain/human_request.py、tests/day75，必须能运行、能测试、能观察结果。
> - v1：Run 进入 waiting 并接受一次人工 response；v2：加入 timeout、cancel、幂等响应和过期拒绝；v3：持久化等待态，进程重启后恢复并关联审批审计。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day74 的一次性审批、作用域和审计；本日输出直接交给 Day76 的审批 UX 与风险预览。
> - 时间盒：本日是周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）；深化用于 v3、故障注入、架构证据和复盘。
> - 硬门槛：完成 正常响应、双响应、超时、取消、过期、重启恢复和跨 Session；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：Run 进入 waiting 并接受一次人工 response。先写失败测试，再完成最短用户链路；checkpoint 是一次调用或 Run 有确定终态和 traceId。
2. **v2 关键加层**：加入 timeout、cancel、幂等响应和过期拒绝。复用 v1 合同；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：持久化等待态，进程重启后恢复并关联审批审计。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后无静默成功、越权和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day75 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day75。实际命令和输出写入 evidence/day75/。

## 必做测试与两个反证

- 测试范围：正常响应、双响应、超时、取消、过期、重启恢复和跨 Session；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：移除 response 幂等键并双击提交，测试必须观察到重复状态迁移。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：等待期间重启服务，若请求丢失或自动通过，恢复测试必须失败。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day74 的一次性审批、作用域和审计。
- 本日交付：可持久化 Human Runtime 等待与响应状态机。
- 后续消费：Day76 的审批 UX 与风险预览。

日期与时长：09-26 周六 6h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

实现 waiting/response/timeout/cancel、幂等和重启后恢复等待态。

## 必须掌握的知识

Human Runtime、waiting/response/timeout/cancel、幂等

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现真实可恢复 Human Runtime

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

状态机；无人响应、重复响应、过期响应

## 人与 AI 分工

人设计状态/幂等键；AI 生成 API/DTO 骨架

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日为周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）。阅读用于原理、源码和边界；动手用于 v1/v2/v3、测试、故障注入、架构证据与复盘。

## 通过标准

同一请求只接受一次；重启后恢复等待态

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“Human Runtime”的数据流或控制流；当天知识链“Human Runtime、waiting/response/timeout/cancel、幂等”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：Human Runtime 日均 8,000 个批准请求；用户双击响应产生两个 decision_id，工具执行两次。请按五段式给出 waiting 状态、幂等键和调用证据，止损重复副作用、修复一次性决策、验证并发响应，并演进可恢复 HITL。
   依据：[LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
2. 教学模拟：部署重启后 420 个 waiting 请求从内存丢失，用户界面永久加载；其中 60 个已过业务期限。请按五段式定位 checkpoint/thread 证据、先过期止损、修复持久化与恢复、验证重启/超时，并演进 Human Runtime 生命周期。
   依据：[LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
知识映射：Day 75：Human Runtime、waiting/response/timeout/cancel 与幂等。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 手写一个 Agent 状态机，模拟 Idle、Thinking、Calling_Tool、Responding、Error 的切换。  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 8 页。
2. 什么是 Function Calling？前端处理 Agent 工具调用要注意什么？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 7 页。
题目说明：waiting/response/error 可由状态机承接；Human Runtime、重复响应、超时、重启恢复没有直接原题，属于近似题/资源缺口。
