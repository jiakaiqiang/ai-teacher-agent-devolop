# Day 65 - 多 Agent Context/Handoff

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day65.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

日期与时长：09-16 周三 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

为 coordinator、executor、validator 建立共享 ContextEnvelope 和角色最小视图，完成 Evidence Gate、token budget、Handoff 引用、裁剪与补读恢复。

## 必须掌握的知识

共享事实/角色视图、ContextEnvelope、Evidence Gate、token budget、Handoff 补读

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现多角色 ContextEnvelope、Handoff 引用、裁剪和补读

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

角色上下文血缘图；Handoff 缺源码、超预算、重复/过期 evidence

## 人与 AI 分工

人决定共享事实、角色私有上下文和裁剪规则；AI 生成缺证据/过期 Handoff 样本

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

原理与源码 40 分钟；真实项目增量 100 分钟；测试/故障注入 25 分钟；架构证据、AI Review 与复盘 15 分钟。

## 通过标准

`CONTEXT_INSUFFICIENT` 可复现并恢复；Handoff 引用可追踪；角色不接收无关全量上下文

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 同一任务中，哪些事实必须在 coordinator、executor、validator 间共享，哪些只能属于角色临时上下文？请沿 ContextEnvelope、Handoff 引用、token budget、Evidence Gate 和补读链路说明数据所有权。
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：coordinator 交给 executor 的 Handoff 有 86K token，简单截断后丢失验收条件；executor 修改完成，但 validator 因缺少原始源码证据错误通过。请按五段式记录角色视图、选择血缘与预算，先触发 `CONTEXT_INSUFFICIENT`，再修复引用式 Handoff、补读和 Evidence Gate，并验证三角色看到的最小必要上下文。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：coordinator 与 executor 分别收集了同一文件的不同 commit 版本，Handoff 去重只按路径，validator 最终使用旧证据。请按五段式给出 evidence identity、base hash、版本与来源定位，冻结过期验证，修复去重键和新鲜度规则，做反例测试并演进共享 ContextEnvelope。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
知识映射：Day 65：多角色 ContextEnvelope、Handoff、Evidence Gate、token budget 与补读。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

## PDF 面试题

1. 如何处理大模型对话中的 Context Window？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 11 页。
2. 大模型应用如何处理 Token 长度限制导致的上下文丢失？  
   来源：[《2026阿里云高级前端开发（AI经验）》](<../../资源/2026阿里云高级前端开发（AI经验）.pdf>)，第 1 页。
题目说明：直接匹配上下文裁剪、摘要、Token 预算和关键信息保留，可追问 Evidence Gate 与补读策略。
