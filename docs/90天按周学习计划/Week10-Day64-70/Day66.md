# Day 66 - 角色与 Local CLI 权限

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day66.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

日期与时长：09-17 周四 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

验证 role/workspace/runtime/tool/approval 权限交集；coordinator 与 validator 默认只读，executor 只能写入分配工作区，危险 CLI 参数必须 fail-closed。

## 必须掌握的知识

角色 Capability、workspace/runtime/tool/approval 交集、命令模板、allowlist、fail-closed

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现角色最小权限、CLI 命令 allowlist 与稳定 block reason

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

权限决策表；角色权限借用、路径逃逸、危险参数、撤 grant、越权写入

## 人与 AI 分工

人定义角色权限和服务端命令模板；AI 扫描遗漏组合与攻击样本

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

原理与源码 40 分钟；真实项目增量 100 分钟；测试/故障注入 25 分钟；架构证据、AI Review 与复盘 15 分钟。

## 通过标准

至少 16 个 allow/block 组合；planner/validator 写入、路径逃逸和危险 bypass 参数全部拒绝

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 一次本地 CLI Invocation 在启动前要依次通过哪些 role、workspace、runtime、tool 和 approval 检查？请说明为什么命令模板、cwd 与 env 必须由服务端决定，以及 validator 为什么不能继承 executor 写权限。
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：轻量项目有 3 个角色和 8 个工具；只读 validator 因 workspace 通配规则获得写权限，并尝试修改测试让失败变绿。请按五段式给出 role/runtime/workspace/tool 权限交集和 block reason，立即冻结 validator 写入，修复最小权限决策，验证 16 组 allow/block，并演进策略即代码。
   依据：[OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/)
2. 教学模拟：服务端允许前端提交 CLI 参数，攻击者注入危险权限绕过选项并把工作目录指向仓库外；审计只记录了角色名。请按五段式定位 argv/cwd/env 证据，停止原始参数透传，改为服务端命令模板和 allowlist，验证路径逃逸与危险参数拒绝，并演进 Local CLI Capability 治理。
   依据：[MCP Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
知识映射：Day 66：角色 Capability、CLI 命令模板、工作区隔离、最小权限与稳定拒绝原因。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

## PDF 面试题

1. 什么是 Function Calling？前端处理 Agent 工具调用要注意什么？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 7 页。
2. 前端如何用工程化手段提升 Prompt 的质量和安全性？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 1 页。
题目说明：工具参数、安全与敏感操作确认直接相关；Capability 交集、最小权限矩阵没有直接原题，属于近似题/资源缺口。
