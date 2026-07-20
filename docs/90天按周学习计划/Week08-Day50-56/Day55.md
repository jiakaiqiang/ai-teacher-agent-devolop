# Day 55 - Docker Compose

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day55.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

日期与时长：09-06 周日 6h  
项目：`D:\demo\ai-techer\p1-monitor`  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

Vue、Nest、FastAPI、Postgres/pgvector、Redis 一键启动。

## 必须掌握的知识

容器网络、health/readiness、secret、migration、volume

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

Compose 启动 Vue、Nest、FastAPI、PG/pgvector、Redis、worker

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

部署图/Runbook；错误启动顺序、重启、数据卷恢复

## 人与 AI 分工

人定启动/迁移策略；AI 写 Dockerfile 草案

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

原理与源码 60 分钟；真实项目增量 210 分钟；测试/故障注入 60 分钟；架构证据、AI Review 与复盘 30 分钟。

## 通过标准

新环境一条命令启动；重启数据不丢

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“Docker Compose”的数据流或控制流；当天知识链“容器网络、health/readiness、secret、migration、volume”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：新环境 Compose 启动时 worker 先于 migration 就绪，反复报表不存在并重试 2 万次。请用容器日志、health/readiness 和队列指标定位启动竞态，先停 worker 并清理积压，再修复依赖健康检查和 migration 顺序，验证一条命令冷启动且无重试风暴。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)
2. 模拟情境：主机重启后 Postgres 数据存在，但 pgvector 索引和上传文档丢失，secret 还被写进镜像层。请先停止发布、轮换 secret 并恢复数据，再修复 volume、备份恢复和 secret 注入，完成空机部署、重启、恢复演练和数据校验。
   依据：[S5 AI 全栈](https://jobs.bytedance.com/experienced/position/7647767015784335669/detail)
知识映射：对应容器网络、健康检查、secret、migration、volume 与 Runbook。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

## PDF 面试题

1. 全栈 CI/CD 如何构建 Docker 镜像、经 K8s 或 Jenkins 部署，并支持灰度和回滚？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 12 页。
2. Node 流式中间层如何用 PM2、Docker、Nginx 部署并处理背压？  
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 6 页。
题目说明：直接匹配容器化和部署；health/readiness、secret、migration、volume 恢复没有直接题。
