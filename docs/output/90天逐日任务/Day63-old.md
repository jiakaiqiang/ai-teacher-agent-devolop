# Day 63 - 双 Local CLI Runtime

日期与时长：09-14 周一 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

完成 Codex CLI 与 Claude Code CLI 两个 Adapter，统一 Registry、InvocationPlan、availability、cancel 和 fail-closed；角色可以交换 Runtime，但合同不能漂移。

## 必须掌握的知识

Codex/Claude Local CLI Adapter、Registry、InvocationPlan、availability、cancel、fail-closed

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现双 CLI Runtime 注册、可用性、角色路由与调用审计

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

Adapter 边界 ADR；CLI 缺失、版本不兼容、未注册 Runtime、角色切换

## 人与 AI 分工

人定义统一事件合同、命令模板和角色路由；AI 生成双 CLI fixture 与测试矩阵

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

原理与源码 40 分钟；真实项目增量 100 分钟；测试/故障注入 25 分钟；架构证据、AI Review 与复盘 15 分钟。

## 通过标准

Codex/Claude 可互换运行同一 TaskContract；不可用 Runtime 显式失败；Invocation 可审计；合同测试全过

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 同一 TaskContract 分别交给 Codex CLI 与 Claude Code CLI 时，Registry、InvocationPlan、Adapter 和统一事件合同如何屏蔽命令及输出差异？请说明 unavailable、启动失败和取消为何必须 fail-closed。
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：本机 Codex CLI 被升级后可执行文件路径改变，Registry 却静默回退到 Stub，导致 18 个 executor 任务被标记成功。请按五段式给出版本预检、Registry 快照、InvocationPlan、runtime identity 和审计证据，关闭静默回退，修复 fail-closed 合同并补双 CLI 合同测试。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：Codex 和 Claude Code 都声明 available，但支持的输出格式、权限与工具集合不同；路由器只按角色名选择，7% 的 validator 调用获得写权限。请按五段式定位 capability/permission 证据、止损错误路由、重构可用性判定、验证角色 x Runtime 组合矩阵，并演进版本化 Adapter 协议。
   依据：[MCP Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
知识映射：Day 63：双 Local CLI Runtime、Registry、InvocationPlan、角色路由与 fail-closed。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 解释 Function Calling 原理，前端如何配合模型完成一次完整工具调用？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 1 页。
2. 什么是 Function Calling？前端处理 Agent 工具调用要注意什么？  
   来源：[《2026高德 Al agent 前端开发》](<../../资源/2026高德 Al agent 前端开发.pdf>)，第 7 页。
题目说明：工具调用合同直接匹配；Runtime Adapter、Registry、InvocationPlan、fail-closed 没有直接原题，属于近似题/资源缺口。
