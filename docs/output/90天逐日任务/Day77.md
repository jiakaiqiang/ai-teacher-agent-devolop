# Day 77 - Durable 恢复

> **《90 天拆分规则说明》校正口径（Day 77 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师）。MCP、Human Runtime 与 RAG 都是多 Agent 主链路的受控能力，不是独立 Demo。
> - 完整模块：MCP/Human/Tool 副作用的 Durable 恢复协调器；代码落点为 backend/app/recovery/coordinator.py、checkpoint.py、tests/day77，必须能运行、能测试、能观察结果。
> - v1：从 checkpoint 恢复无副作用的 waiting Run；v2：加入 lease、reconcile 和已执行副作用标记；v3：覆盖批准后崩溃、执行中崩溃、Redis 断开和重复恢复。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day75-76 的 Human Runtime 状态与一次性审批；本日输出直接交给 Day78 的 RAG 黄金集和回归 Runner。
> - 时间盒：本日固定 90 分钟阅读 + 90 分钟动手；阅读先建立因果模型，动手按 v1 -> v2 -> v3 完成运行、测试和证据。
> - 硬门槛：完成 三个崩溃点、lease 过期、Redis 中断、重复恢复和人工决定不丢失；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：从 checkpoint 恢复无副作用的 waiting Run。先写失败测试，再完成最短用户链路；checkpoint 是一次调用或 Run 有确定终态和 traceId。
2. **v2 关键加层**：加入 lease、reconcile 和已执行副作用标记。复用 v1 合同；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：覆盖批准后崩溃、执行中崩溃、Redis 断开和重复恢复。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后无静默成功、越权和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day77 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day77。实际命令和输出写入 evidence/day77/。

## 必做测试与两个反证

- 测试范围：三个崩溃点、lease 过期、Redis 中断、重复恢复和人工决定不丢失；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：批准写入后、工具执行前杀进程，恢复必须执行一次且保留决定。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：工具执行后、Artifact 写入前杀进程，恢复不得再次执行副作用。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day75-76 的 Human Runtime 状态与一次性审批。
- 本日交付：MCP/Human/Tool 副作用的 Durable 恢复协调器。
- 后续消费：Day78 的 RAG 黄金集和回归 Runner。

日期与时长：09-28 周一 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

验证批准后崩溃、执行中崩溃、Redis 断开，保证不丢决定和不重复副作用。

## 必须掌握的知识

Pause/Resume、持久化、崩溃恢复、exactly-once 近似

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

加固 Human/Tool 恢复闭环

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

恢复表；批准后崩溃、执行中崩溃、Redis 断开

## 人与 AI 分工

人写恢复不变量；AI 生成故障脚本

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日固定为 90 分钟阅读 + 90 分钟动手。阅读覆盖原理、源码和边界；动手覆盖 v1/v2/v3、测试、反证、架构证据与复盘。

## 通过标准

不丢决定、不重复副作用；3 个恢复 E2E 通过

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“Durable 恢复”的数据流或控制流；当天知识链“Pause/Resume、持久化、崩溃恢复、exactly-once 近似”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：批准写文件后进程崩溃，checkpoint 停在 approved，但文件其实已写；恢复后再次执行，造成 36 个重复修改。请按五段式给出 checkpoint、side-effect receipt 和文件 hash 证据，冻结恢复队列、修复幂等栅栏、验证崩溃点，并演进 exactly-once 近似。
   依据：[LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
2. 教学模拟：Redis 中断 3 分钟，Human decision 已落 PostgreSQL，但 Runtime 未收到 resume；恢复脚本又把 rejected 误改为 pending。请按五段式定位双存储事实源、止损错误恢复、修复状态单调性、验证三类中断，并演进恢复表和 Runbook。
   依据：[LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
知识映射：Day 77：Pause/Resume、持久化、崩溃恢复与副作用去重。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 如何实现支持“多轮对话中断”和“重新生成”的状态机？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。
2. AI 接口超时和异常重试策略应该如何设计？  
   来源：[《2026腾讯混元AIGC前端架构师》](<../../资源/2026腾讯混元AIGC前端架构师.pdf>)，第 1 页。
题目说明：近似题/资源缺口：可用于讨论 pause/resume 与错误恢复，但没有持久化恢复、exactly-once 近似或崩溃后副作用去重的直接题。
