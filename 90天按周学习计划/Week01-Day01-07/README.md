# Week 1：Day 1-7

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

实时指标合同、Vue 状态与 WebSocket 可靠性

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 1 | 2026-07-14 周二，180 分钟 | AI 前端架构与 Agent 事件模型 | 建立 AI 前端系统边界、Agent 事件合同、Run 状态机与 Tool/Approval UI。 | 创建 Vue 3 工程，实现 AgentEvent、状态归约、时间线 UI、测试和架构证据。 | [打开](./Day01.md) |
| 2 | 07-15 周三 3h | 领域合同 | 从 Prisma 建立领域类型和运行时 Schema，用非法输入证明静态类型边界。 | 为 AgentEvent、Server、Metric、Anomaly 建立 Schema 和网络适配层 | [打开](./Day02.md) |
| 3 | 07-16 周四 3h | 异步与竞态 | 并发读取真实指标，切换服务器时取消旧请求，测试旧响应覆盖问题。 | 实现指标首屏 API Client 和 `loading/empty/error/ready` 状态 | [打开](./Day03.md) |
| 4 | 07-17 周五 3h | Vue/ECharts 原理 | 用数据库指标完成四图、60 点滑窗和生命周期清理，记录优化证据。 | 用真实指标实现四图及 60 点窗口 | [打开](./Day04.md) |
| 5 | 07-18 周六 6h | WebSocket 全栈 | NestJS Gateway 将 `metric.created` 推送到 Pinia/ECharts，处理非法和乱序事件。 | Nest Gateway 推送 `metric.created`，前端合并进指标 Store | [打开](./Day05.md) |
| 6 | 07-19 周日 6h | 实时可靠性 | 心跳、重连、去重和 REST 快照补偿；断网/重启/后台标签页故障注入。 | 建立连接状态机，重连后通过 REST 补缺 | [打开](./Day06.md) |
| 7 | 07-20 周一 3h | 事件与算法 | 先写失败测试，再修复异常模块依赖、时间顺序和重复异常策略。 | 先写失败测试，再修复真实异常检测链路 | [打开](./Day07.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[总索引](../README.md) | [下一周](../Week02-Day08-14/README.md)
