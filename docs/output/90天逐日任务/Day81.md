# Day 81 - 动态委派语义

> **《90 天拆分规则说明》校正口径（Day 81 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师），动态委派、验证与治理都服务于同一个 p2-agent-workbench 主链路。
> - 完整模块：受控动态委派合同、责任链与终止边界；代码落点为 backend/app/domain/delegation.py、orchestrator/delegation_graph.py、tests/day81，必须能运行、能测试、能观察结果。
> - v1：复用 Day62 固定 coordinator -> executor 图；v2：增加 agent-suggested 委派建议并由 coordinator 决定；v3：允许受控 agent-delegated，绑定 owner、depth、capability、budget、stop reason 和审计链。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day62 固定协同与 Day80 的权限/恢复门禁；本日输出直接交给 Day82 的 claim、lease 和 worker 调度。
> - 时间盒：本日固定 90 分钟阅读 + 90 分钟动手；阅读先建立因果模型，动手按 v1 -> v2 -> v3 完成运行、测试和证据。
> - 硬门槛：完成 固定/建议/委派三模式、深度超限、权限不足、循环和终止责任；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：复用 Day62 固定 coordinator -> executor 图。先写失败测试，再完成最短用户链路；checkpoint 是一次任务有确定终态、owner 和 traceId。
2. **v2 关键加层**：增加 agent-suggested 委派建议并由 coordinator 决定。复用 v1 合同；checkpoint 是正常、边界和权限/并发测试可重复。
3. **v3 生产约束**：允许受控 agent-delegated，绑定 owner、depth、capability、budget、stop reason 和审计链。补预算、审计、恢复、Eval 或发布门禁；checkpoint 是故障后无静默成功、越权和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day81 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day81。实际命令和输出写入 evidence/day81/。

## 必做测试与两个反证

- 测试范围：固定/建议/委派三模式、深度超限、权限不足、循环和终止责任；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：删除 max_depth 后让两个角色互相委派，预算测试必须终止循环。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：只记录最终 owner 而删除 parent delegation，审计测试必须判定责任链不可重建。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day62 固定协同与 Day80 的权限/恢复门禁。
- 本日交付：受控动态委派合同、责任链与终止边界。
- 后续消费：Day82 的 claim、lease 和 worker 调度。

日期与时长：10-02 周五 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

将 Day 62 的固定 coordinator/executor/validator 角色图升级为受控动态委派，补齐 agent-suggested/agent-delegated 的深度、权限、终止和责任链审计。

## 必须掌握的知识

coordinator/agent-suggested/agent-delegated、责任链、深度

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

将固定角色协同升级为受控动态委派

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

委派 ADR；越深、无能力 Agent、循环委派

## 人与 AI 分工

人定深度/权限/终止；AI 生成属性测试

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日固定为 90 分钟阅读 + 90 分钟动手。阅读覆盖原理、源码和边界；动手覆盖 v1/v2/v3、测试、反证、架构证据与复盘。

## 通过标准

最大深度生效；循环拒绝；路由原因可审计

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. Day 62 的固定角色图升级为动态委派后，TaskContract、owner、parent/child、route_reason、depth、Capability 和终止责任分别如何变化？哪些不变量必须保持不变？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：项目只有 coordinator、executor、validator 三个角色，但 coordinator 允许 executor 再次委派给 coordinator，形成 A-B-A 循环并产生 24 个子任务。请按五段式给出 parent/child、route_reason、runtime 和 depth 证据，熔断循环、修复委派图校验、验证属性测试，并演进责任链。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：agent-suggested 路由到没有 write capability 的 Agent，系统随后借用 coordinator 权限完成写入。请按五段式定位权限继承证据、撤销越权结果、修复委派时能力绑定、验证无能力路径，并演进受控自主委派。
   依据：[OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/)
知识映射：Day 81：从固定角色图升级到动态委派、责任链、深度、循环与权限。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 谈谈 AI Agent 的基本架构，以及前端如何实现一个简单的 Agent 闭环？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 9 页。
2. 从零设计 AI Agent 工作流可视化编辑器时，如何选型和设计架构？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。
题目说明：近似题/资源缺口：第一题包含 Planning/子任务概念，但没有 coordinator、agent-suggested、agent-delegated、委派深度和循环委派直接题。
