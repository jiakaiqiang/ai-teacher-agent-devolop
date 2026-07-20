# Day 61 - Agent 系统分层

> **《90 天拆分规则说明》校正口径（Day 61 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师），所有增量进入 p2-agent-workbench 用户主链路。
> - 完整模块：Session/Run/Event/Artifact 合同与单 Agent 主链路；代码落点为 backend/app/domain/contracts.py、backend/app/runtimes/stub.py、frontend/src/features/runs、tests/day61，必须能运行、能测试、能观察结果。
> - v1：用 Stub Runtime 创建 Run 并返回终态；v2：接入 FastAPI、Vue 与 SSE 事件时间线；v3：加入合同校验、取消、Artifact 持久化和显式失败。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day60 的事件、Trace、权限和发布证据；本日输出直接交给 Day62 的 TaskContract/Handoff 与事件重放，禁止新建无关 Demo。
> - 时间盒：本日是周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）；深化用于 v3、故障注入、架构证据和复盘。
> - 硬门槛：完成 合同、正常终态、SSE 断线回补、未注册 Runtime；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：用 Stub Runtime 创建 Run 并返回终态。先写失败测试，再实现最短用户链路；checkpoint 是一次 Run 有确定终态和 traceId。
2. **v2 关键加层**：接入 FastAPI、Vue 与 SSE 事件时间线。复用 v1 合同，不复制旁路实现；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：加入合同校验、取消、Artifact 持久化和显式失败。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后没有静默成功和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day61 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day61。实际命令和输出写入 evidence/day61/。

## 必做测试与两个反证

- 测试范围：合同、正常终态、SSE 断线回补、未注册 Runtime；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：移除 Runtime 注册后创建 Run，必须得到 runtime_unavailable 而非假完成。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：破坏 Event 或 Artifact schema，合同测试必须阻止终态写入。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day60 的事件、Trace、权限和发布证据。
- 本日交付：Session/Run/Event/Artifact 合同与单 Agent 主链路。
- 后续消费：Day62 的 TaskContract/Handoff 与事件重放。

日期与时长：09-12 周六 6h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

从空仓库初始化轻量 Agent 工作台，定义 Session、Run、Event、Artifact 合同，打通 Vue、FastAPI、Stub Runtime 与 SSE 最小主链路。

## 必须掌握的知识

Agent 分层、Session、Orchestrator、Runtime、Event/Artifact

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

初始化项目并完成第一条可运行、可测试的 Agent Run

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

组件图/时序图；移除 Runtime 注册或破坏事件合同，验证系统显式失败

## 人与 AI 分工

人定义领域合同、状态机和模块边界；AI 生成脚手架候选、测试样本和反向质疑

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日为周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）。阅读用于原理、源码和边界；动手用于 v1/v2/v3、测试、故障注入、架构证据与复盘。

## 通过标准

一条 Run 可从 Vue 创建并经 SSE 到达终态；至少 5 个合同测试；未注册 Runtime 显式失败

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“Agent 系统分层”的数据流或控制流；当天知识链“Agent 分层、Session、Orchestrator、Runtime、Event/Artifact”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：系统日均 5,000 个 Session、接入 4 种 Runtime；约 1.8% 的 Run 显示 completed，但没有最终 Artifact，前端事件流、Orchestrator 日志和 Runtime 日志时间不一致。请按五段式给出定位证据、止损、修复、验证和高层演进，并画出 Vue-SSE-Orchestrator-Runtime-Artifact 的真实时序。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：新同事把 Session、Task、Run、Invocation 混成一个实体，导致重试会新建 Task、审计无法还原责任链。现有库有 12 个入口和 5 类合同。请按五段式说明如何用源码证据还原边界、冻结错误写入、迁移模型、验证历史兼容，并演进为可治理的 Agent 分层。
   依据：[S4 WorkBuddy](https://careers.tencent.com/jobdesc.html?postId=2074485456237670400)
知识映射：Day 61：Agent 分层、主链路、合同与 Artifact。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 谈谈 AI Agent 的基本架构，以及前端如何实现一个简单的 Agent 闭环？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 1 页。
2. 从零设计 AI Agent 前端架构时，你会考虑哪些核心模块？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 1 页。
题目说明：直接匹配 Agent 分层、规划、记忆、工具与执行反馈，可用于反推 Session-Orchestrator-Runtime-Event 主链路。
