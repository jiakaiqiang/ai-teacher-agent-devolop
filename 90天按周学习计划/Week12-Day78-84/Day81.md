# Day 81 - 动态委派语义

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day81.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

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

原理与源码 40 分钟；真实项目增量 100 分钟；测试/故障注入 25 分钟；架构证据、AI Review 与复盘 15 分钟。

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

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

## PDF 面试题

1. 谈谈 AI Agent 的基本架构，以及前端如何实现一个简单的 Agent 闭环？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 9 页。
2. 从零设计 AI Agent 工作流可视化编辑器时，如何选型和设计架构？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。
题目说明：近似题/资源缺口：第一题包含 Planning/子任务概念，但没有 coordinator、agent-suggested、agent-delegated、委派深度和循环委派直接题。
