# Day 69 - Worktree/DAG 并行协同

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

原理与源码 60 分钟；真实项目增量 210 分钟；测试/故障注入 60 分钟；架构证据、AI Review 与复盘 30 分钟。

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
