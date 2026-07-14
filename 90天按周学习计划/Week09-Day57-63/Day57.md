# Day 57 - 监控/Trace

> 生成说明：本文件由 [权威源任务](../../output/90天逐日任务/Day57.md) 自动生成。请修改源文件后运行 `scripts/Generate-WeeklyPlan.ps1`，不要只修改本副本。

日期与时长：09-08 周二 3h  
项目：`D:\demo\ai-techer\p1-monitor`  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

OpenTelemetry 或等价方案；模型、Prompt、检索、工具、DB 链路可追踪。

## 必须掌握的知识

OpenTelemetry、跨语言 context、span attributes、采样、成本

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

打通浏览器-Nest-Python-RAG-模型-DB Trace

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

Trace topology；header 丢失、async context 断裂、敏感属性

## 人与 AI 分工

人定 span/采样/脱敏；AI 加 instrumentation

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

原理与源码 40 分钟；真实项目增量 100 分钟；测试/故障注入 25 分钟；架构证据、AI Review 与复盘 15 分钟。

## 通过标准

一次 RAG run 有完整跨语言 trace；敏感泄漏为 0

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“监控/Trace”的数据流或控制流；当天知识链“OpenTelemetry、跨语言 context、span attributes、采样、成本”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：浏览器和 Nest span 正常，Nest 调 FastAPI 后生成新 Trace，RAG 与模型耗时无法关联。请检查 traceparent header、async context 和 HTTP instrumentation，先在日志中保留双侧 correlationId，再修复跨语言传播与 span attributes，验证单次 run 形成完整拓扑。
   依据：[OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/instrumentation/)
2. 模拟情境：为排查质量问题，团队把完整 Prompt、检索 chunk 和模型输出写入 span，遥测成本增至每天 900 元并泄露手机号。请先关闭敏感属性并降低采样，再制定属性白名单、脱敏和 head/tail sampling，验证成本预算、排障能力与泄漏扫描同时达标。
   依据：[OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/instrumentation/)
知识映射：对应 OTel、跨语言 context、span 属性、采样和成本。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../../output/AI教师五连问验收协议.md)。

## PDF 面试题

1. AI 性能与异常监控如何用 TraceID 串起前端请求和后端模型日志？  
   来源：[《2026腾讯音乐 前端开发（AI产品）》](<../../资源/2026腾讯音乐 前端开发（AI产品）.pdf>)，第 6 页。
2. 从零设计监控系统时，如何规划采集、传输、后端处理、存储和告警？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 12 页。
题目说明：近似题/资源缺口：覆盖全链路追踪思路，但没有 OpenTelemetry、跨语言 context、span attributes、采样与敏感属性规范的直接题。
