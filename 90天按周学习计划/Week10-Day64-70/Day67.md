# Day 67 - Tool Loop 与 Validation Agent

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day67.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

日期与时长：09-18 周五 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

建立 executor 的有界 Tool Loop，并增加独立只读 validator；验证必须引用 diff、测试和 Artifact，失败最多返工两次。

## 必须掌握的知识

Tool Loop、Validation Agent、证据门禁、结果回灌、返工上限、幂等

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

建立 executor -> validator -> 有界返工的协同 E2E

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

Loop/Validation/返工状态图；伪造测试、缺证据、重复调用、无限返工

## 人与 AI 分工

人实现验收规则、预算、终止和幂等；AI 生成对抗 Artifact、Schema 与 fuzz

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

原理与源码 40 分钟；真实项目增量 100 分钟；测试/故障注入 25 分钟；架构证据、AI Review 与复盘 15 分钟。

## 通过标准

无证据不能 passed；Tool/返工上限生效；重复副作用为 0；非法参数可诊断

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 从 executor Tool Loop 到 validator 判定和返工，说明结果回灌、Artifact 证据、step/rework budget、终止原因和副作用幂等分别由谁负责；为什么 validator 不能只相信 executor 的自然语言结论？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：executor 的 Tool Loop 上限为 8 步，但 validator 每次只返回“继续优化”，导致 executor/validator 往返 12 轮，单 Run 成本增长 6 倍。请按五段式给出 trajectory、角色、step/rework budget 和停止原因，先熔断超限 Run，再修复结构化验收与返工上限，验证循环和人工升级。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：executor 声称测试通过，但 Artifact 只有一段文本，没有命令、退出码和 diff；validator 仍标记 passed。请按五段式定位证据门禁缺口，撤销假通过，修复 Artifact Schema 与独立验证，注入伪造/缺失/过期证据回归，并演进可追责 Validation Agent。
   依据：[OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/)
知识映射：Day 67：Tool Loop、Validation Agent、证据门禁、返工上限、终止与幂等。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

## PDF 面试题

1. 谈谈 AI Agent 的基本架构，以及前端如何实现一个简单的 Agent 闭环？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 9 页。
2. 手写一个带并发限制的异步调度器 Scheduler。  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 1 页。
题目说明：Agent 工具结果回灌和调度直接相关；最大步数、成本预算、幂等副作用需要在项目追问中补充。
