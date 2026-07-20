# Day 69 - Worktree/DAG 并行协同

> **《90 天拆分规则说明》校正口径（Day 69 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师），所有增量进入 p2-agent-workbench 用户主链路。
> - 完整模块：独立 worktree、ready-wave DAG 与合并门禁；代码落点为 backend/app/orchestrator/scheduler.py、worktree_manager.py、tests/day69，必须能运行、能测试、能观察结果。
> - v1：在单 worktree 顺序执行两个 TaskContract；v2：两个 executor 在独立 worktree 按 ready-wave 并行；v3：加入 base hash、并发上限、失败传播、冲突检测、Artifact 交接和合并门禁。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day68 的 Context/Memory 与可追踪 Handoff；本日输出直接交给 Day70 的 Local CLI 多 Agent 主链路门禁，禁止新建无关 Demo。
> - 时间盒：本日是周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）；深化用于 v3、故障注入、架构证据和复盘。
> - 硬门槛：完成 依赖顺序、并发上限、base hash 漂移、文件冲突、失败传播和恢复清理；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：在单 worktree 顺序执行两个 TaskContract。先写失败测试，再实现最短用户链路；checkpoint 是一次 Run 有确定终态和 traceId。
2. **v2 关键加层**：两个 executor 在独立 worktree 按 ready-wave 并行。复用 v1 合同，不复制旁路实现；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：加入 base hash、并发上限、失败传播、冲突检测、Artifact 交接和合并门禁。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后没有静默成功和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day69 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day69。实际命令和输出写入 evidence/day69/。

## 必做测试与两个反证

- 测试范围：依赖顺序、并发上限、base hash 漂移、文件冲突、失败传播和恢复清理；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：让两个 executor 写同一工作区，冲突测试必须捕获静默覆盖。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：删除 base hash 校验后在旧基线上合并，门禁必须拒绝过期 ChangeSet。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day68 的 Context/Memory 与可追踪 Handoff。
- 本日交付：独立 worktree、ready-wave DAG 与合并门禁。
- 后续消费：Day70 的 Local CLI 多 Agent 主链路门禁。

日期与时长：09-20 周日 6h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

允许最多两个 executor 在独立 git worktree 中执行受限 ready-wave，使用 TaskContract、base hash、并发上限、失败传播、checkpoint、冲突门禁和 cancel fence。

## 必须掌握的知识

git worktree、base hash、DAG、ready-wave、依赖调度、冲突门禁、cancel fence

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现两个本地 CLI executor 的隔离 worktree/DAG 并行

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

DAG/worktree/合并时序；循环依赖、同文件冲突、并行任务失败、取消竞态

## 人与 AI 分工

人定义调度、工作区和合并不变量；AI 生成 DAG、冲突与取消组合

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日为周末扩展日：90 分钟阅读 + 90 分钟动手完成基线，再增加 180 分钟动手深化（合计 270 分钟动手）。阅读用于原理、源码和边界；动手用于 v1/v2/v3、测试、故障注入、架构证据与复盘。

## 通过标准

并发最多 2；独立任务同波启动；无共享目录并写；冲突不静默覆盖；失败/取消可恢复

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 从 ready-wave 选择两个 TaskContract，到创建独立 worktree、启动两个本地 CLI、生成 Artifact、validator 验证和合并，说明 DAG、base hash、并发上限、冲突门禁与 cancel fence 的控制顺序。
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：一个 12 节点 DAG 由 Codex 与 Claude 两个本地 CLI executor 执行；隐藏依赖让两者在不同 worktree 同时修改同一配置，validator 只看测试结果便允许合并。请按五段式给出 DAG 版本、TaskContract、base hash、worktree 和调度 span 证据，停止合并，修复依赖/冲突门禁并验证失败传播。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：用户取消 Run 时，一个 executor 正从 ready 进入 running，CLI 子进程仍在旧 worktree 写入 Artifact；重试在新 worktree 生成另一版本。请按五段式重放 claim/cancel/base hash 竞态，隔离两个结果，修复 cancel fence、进程树终止和版本检查，并验证压力竞态。
   依据：[S4 WorkBuddy](https://careers.tencent.com/jobdesc.html?postId=2074485456237670400)
知识映射：Day 69：Local CLI executor、git worktree、DAG、ready-wave、base hash、冲突与 cancel fence。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 从零设计 AI Agent 工作流可视化编辑器时，如何选型和设计架构？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。
2. 手写一个带并发限制的异步调度器 Scheduler。  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 1 页。
题目说明：DAG 与并发调度直接相关；ready-wave、失败传播和 cancel race 没有直接原题，属于近似题/资源缺口。
