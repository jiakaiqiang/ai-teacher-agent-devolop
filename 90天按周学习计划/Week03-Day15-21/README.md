# Week 3：Day 15-21

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

Agent UX、安全、Trace、第一节点考试与 NestJS 桥接

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 15 | 07-28 周二 3h | Agent 时间线 | 将真实事件归约为可恢复时间线，不展示私有 Chain of Thought。 | Day 1 AgentRunPanel 接入真实 SSE 和历史记录 | [打开](./Day15.md) |
| 16 | 07-29 周三 3h | 证据与 XSS | 安全渲染诊断报告，并把模型结论链接到指标、异常和工具证据。 | 诊断报告展示指标、异常、ToolCall 引用 | [打开](./Day16.md) |
| 17 | 07-30 周四 3h | Human-in-the-loop | 高风险状态变更先等待服务端批准，验证越权、重复和过期请求。 | Agent 提议 `changeAnomalyStatus`，用户批准后执行 | [打开](./Day17.md) |
| 18 | 07-31 周五 3h | Trace/性能 | trace id 贯穿全链路，测量 TTFT、P95、工具成功率、内存和渲染长任务。 | traceId 贯穿 UI/WS/Agent/Tool/SSE/DB | [打开](./Day18.md) |
| 19 | 08-01 周六 6h | 生产演练 | 全链路 E2E、模型/DB/WS/SSE/Tool 故障注入，形成发布候选和报告。 | 冻结功能，形成第一阶段发布候选 | [打开](./Day19.md) |
| 20 | 08-02 周日 6h | 项目毕业考 | 闭卷原理、独立编码、未知故障排查和项目答辩；总分 >= 70。 | 第一节点考试，现场增加一种事件并贯通全链路 | [打开](./Day20.md) |
| 21 | 08-03 周一 3h | NestJS 架构深化 | 重构 Agent/Metrics/Anomaly 模块边界和 DI scope；不改变外部合同，禁止重复入门教程。 | 重构 Agent、Metrics、Anomaly 模块边界，不改变外部行为 | [打开](./Day21.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week02-Day08-14/README.md) | [总索引](../README.md) | [下一周](../Week04-Day22-28/README.md)
