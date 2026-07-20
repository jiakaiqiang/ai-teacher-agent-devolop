# Week 2：Day 8-14

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

异常闭环、Tool Registry、Agent Loop 与 SSE

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 8 | 07-21 周二 3h | API/分页 | 新增真实异常查询接口和列表，验证稳定排序、过滤及输入边界。 | 新增异常查询接口和 Vue 列表 | [打开](./Day08.md) |
| 9 | 07-22 周三 3h | 状态机 | 实现异常详情、合法状态转换、并发修改和失败回滚。 | 完成异常详情与合法状态转换 | [打开](./Day09.md) |
| 10 | 07-23 周四 3h | M2 门禁 | 关闭 AI 修 Bug，并证明指标到异常展示的真实纵向闭环；原理/编码均 >= 60%。 | M2 门禁：指标产生到异常详情的完整链路 | [打开](./Day10.md) |
| 11 | 07-24 周五 3h | Tool Registry | 基于 Prisma 实现三个只读运维工具，具备 Schema、超时、裁剪和测试。 | 实现三个只读运维 Tool，读取真实 Prisma 数据 | [打开](./Day11.md) |
| 12 | 07-25 周六 6h | Agent Loop | 异常触发真实 Agent 工具循环，设置 step/time/token 预算和 Provider 抽象。 | 异常触发单 Agent，调用 Day 11 工具生成结构化诊断 | [打开](./Day12.md) |
| 13 | 07-26 周日 6h | 持久化/幂等 | 保存 Diagnosis/ToolCall，处理重复事件、并发触发和中途故障恢复。 | 持久化 AgentRun、Diagnosis、ToolCall 和错误 | [打开](./Day13.md) |
| 14 | 07-27 周一 3h | SSE 合同演进 | 将 Day 1 AgentEvent 版本化并接入真实 run，覆盖断包、重复、续传和客户端断开。 | 将 Day 1 AgentEvent 升级为 `v1`，接真实 AgentRun SSE adapter | [打开](./Day14.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week01-Day01-07/README.md) | [总索引](../README.md) | [下一周](../Week03-Day15-21/README.md)
