# Day 73 - MCP Runtime Adapter

> **《90 天拆分规则说明》校正口径（Day 73 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师）。MCP、Human Runtime 与 RAG 都是多 Agent 主链路的受控能力，不是独立 Demo。
> - 完整模块：MCP Runtime Adapter 与统一调用生命周期；代码落点为 backend/app/runtimes/mcp.py、mcp_registry.py、tests/day73，必须能运行、能测试、能观察结果。
> - v1：把 Day72 搜索工具映射为 mcp_tool Runtime；v2：实现 discovery/cache、availability、start、usage 与 error 事件；v3：加入 cancel、超时、缓存失效、Server identity 和 fail-closed。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day72 的 project_search MCP Server 与 Schema；本日输出直接交给 Day74 的 capability binding 和隔离策略。
> - 时间盒：本日固定 90 分钟阅读 + 90 分钟动手；阅读先建立因果模型，动手按 v1 -> v2 -> v3 完成运行、测试和证据。
> - 硬门槛：完成 可用/不可用 Server、发现缓存、Schema 错误、取消、超时和统一事件；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：把 Day72 搜索工具映射为 mcp_tool Runtime。先写失败测试，再完成最短用户链路；checkpoint 是一次调用或 Run 有确定终态和 traceId。
2. **v2 关键加层**：实现 discovery/cache、availability、start、usage 与 error 事件。复用 v1 合同；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：加入 cancel、超时、缓存失效、Server identity 和 fail-closed。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后无静默成功、越权和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day73 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day73。实际命令和输出写入 evidence/day73/。

## 必做测试与两个反证

- 测试范围：可用/不可用 Server、发现缓存、Schema 错误、取消、超时和统一事件；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：Server 不可用时静默回退 mock，合同测试必须识别假成功。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：取消后接受晚到 tool_result，终态测试必须拒绝写入 Artifact。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day72 的 project_search MCP Server 与 Schema。
- 本日交付：MCP Runtime Adapter 与统一调用生命周期。
- 后续消费：Day74 的 capability binding 和隔离策略。

日期与时长：09-24 周四 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

实现 `mcp_tool` availability/start/cancel/usage/error，禁止不可用时静默回退 mock。

## 必须掌握的知识

`mcp_tool` Runtime Adapter、错误映射、usage、cancel

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

接入 Registry/InvocationPlan

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

Adapter 时序；不可用 Server、结果 Schema 错

## 人与 AI 分工

人写 adapter/cancel；AI 生成 stub

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日固定为 90 分钟阅读 + 90 分钟动手。阅读覆盖原理、源码和边界；动手覆盖 v1/v2/v3、测试、反证、架构证据与复盘。

## 通过标准

availability/start/cancel/usage/error 符合合同；无静默 mock 回退

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“MCP Runtime Adapter”的数据流或控制流；当天知识链“`mcp_tool` Runtime Adapter、错误映射、usage、cancel”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：`mcp_tool` Adapter 的 cancel 只改变本地状态，未发送到 Server；每天约 70 个已取消调用继续计费并写 Artifact。请按五段式给出 client/server request id、usage 和副作用证据，立即阻断写回，修复取消传播、验证竞态，并演进 Adapter 合同。
   依据：[MCP Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
2. 教学模拟：MCP Server 不可用时 Adapter 静默返回本地 stub，28 个生产 Run 被假成功；另有结果 Schema 错误被当成文本。请按五段式定位 availability 与 mapping 证据、关闭回退、修复 fail-closed、验证故障矩阵，并演进 Runtime Registry。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
知识映射：Day 73：MCP Runtime Adapter、usage、cancel 与错误映射。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. AI 接口超时和异常重试策略应该如何设计？  
   来源：[《2026腾讯混元AIGC前端架构师》](<../../资源/2026腾讯混元AIGC前端架构师.pdf>)，第 1 页。
2. 解释 Function Calling 原理，前端如何配合模型完成一次完整工具调用？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 1 页。
题目说明：近似题/资源缺口：覆盖 Adapter 的调用、错误和超时，但没有 `mcp_tool` Runtime Adapter、usage、cancel 合同直接题。
