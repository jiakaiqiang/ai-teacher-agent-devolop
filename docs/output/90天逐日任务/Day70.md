# Day 70 - Local CLI 多 Agent 主链路门禁

> **《90 天拆分规则说明》校正口径（Day 70 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师），所有增量进入 p2-agent-workbench 用户主链路。
> - 完整模块：Local CLI 多 Agent 主链路独立门禁；代码落点为 docs/exams/day70.md、scripts/run_day70_gate.py、tests/day70，必须能运行、能测试、能观察结果。
> - v1：闭卷画出 Runtime/协同/权限/工作区主链路；v2：独立修复一个随机故障并通过定向测试；v3：组合两类故障完成止损、恢复、回归和评分证据。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day61-69 的 Runtime、事件、Context、权限、Validator 与 worktree 合同；本日输出直接交给 Day71 的 MCP Host/Client/Server 边界设计，禁止新建无关 Demo。
> - 时间盒：本日固定 90 分钟阅读 + 90 分钟动手；阅读先建立因果模型，动手按 v1 -> v2 -> v3 完成运行、测试和证据。
> - 硬门槛：完成 CLI 缺失、流中断、权限拒绝、Handoff 缺失、worktree 冲突五选二；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：闭卷画出 Runtime/协同/权限/工作区主链路。先写失败测试，再实现最短用户链路；checkpoint 是一次 Run 有确定终态和 traceId。
2. **v2 关键加层**：独立修复一个随机故障并通过定向测试。复用 v1 合同，不复制旁路实现；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：组合两类故障完成止损、恢复、回归和评分证据。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后没有静默成功和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day70 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day70。实际命令和输出写入 evidence/day70/。

## 必做测试与两个反证

- 测试范围：CLI 缺失、流中断、权限拒绝、Handoff 缺失、worktree 冲突五选二；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：删除 runtime availability 检查，CLI 缺失时门禁必须阻止假成功。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：绕过 Handoff/合并门禁，冲突 Artifact 必须使总门禁失败。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day61-69 的 Runtime、事件、Context、权限、Validator 与 worktree 合同。
- 本日交付：Local CLI 多 Agent 主链路独立门禁。
- 后续消费：Day71 的 MCP Host/Client/Server 边界设计。

日期与时长：09-21 周一 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

关闭 AI，随机注入 CLI 缺失、流中断、权限拒绝、Handoff 缺失或 worktree 冲突之一并独立定位修复；原理和故障定位均 >= 70%。

## 必须掌握的知识

Local CLI Runtime、多 Agent 协同合同、架构答辩、未知故障定位

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

第一 Local CLI 多 Agent 门禁

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

ADR 汇总；随机注入 CLI/流/Handoff/权限/worktree 故障

## 人与 AI 分工

人独立定位修复；AI 仅事后 review

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日固定为 90 分钟阅读 + 90 分钟动手。阅读覆盖原理、源码和边界；动手覆盖 v1/v2/v3、测试、反证、架构证据与复盘。

## 通过标准

总分 >=70；原理和故障定位各 >=70%

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 不看代码说明用户任务如何经过 TaskContract、Local CLI Runtime、Handoff、worktree、Artifact 和 validator 到达终态；再指出每一层的 owner、可观测证据和最危险的假成功路径。
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：门禁演练中随机移除本地 CLI、截断流、删除 Handoff 或拒绝 executor 写权限；系统仍有一条路径把失败显示为 completed。请按五段式独立定位跨角色和跨进程证据、止损假成功、修复终态、验证四种故障，并提出统一协同主链路的高层演进。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：一次需求变更同时修改 TaskContract、两个 CLI Adapter 和前端投影，coordinator 使用新合同、executor 仍解析旧 Handoff，validator 又错误通过。请按五段式用合同版本、事件和 Artifact 还原边界，冻结高风险运行，修复兼容层、验证角色 x Runtime 矩阵，并演进架构治理。
   依据：[S1 Aime](https://jobs.bytedance.com/experienced/position/7650035429911824693/detail)
知识映射：Day 70：Local CLI Runtime、固定多 Agent 协同、Handoff/worktree、架构答辩与未知故障定位。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 从零设计 AI Agent 前端架构时，你会考虑哪些核心模块？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 9 页。
2. 如何建立一套 AI 前端应用质量监控体系？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 9 页。
题目说明：直接匹配 Agent 主链路架构答辩和质量门禁，可要求结合真实源码与随机故障回答。
