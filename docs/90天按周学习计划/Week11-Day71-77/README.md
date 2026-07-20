# Week 11：Day 71-77

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

MCP、Human Runtime、审批 UX 与恢复

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 71 | 09-22 周二 3h | MCP 设计 | 先完成 Host/Client/Server、transport、发现、调用、取消、审计、权限和现有 Runtime 对接 ADR。 | 先设计 MCP 与现有 Runtime/Capability 的边界 | [打开](./Day71.md) |
| 72 | 09-23 周三 3h | MCP Server | 实现受控只读项目搜索工具；路径穿越、超时、断连和非法 Schema 必须失败可见。 | 实现受控项目搜索 MCP Server | [打开](./Day72.md) |
| 73 | 09-24 周四 3h | MCP Runtime Adapter | 实现 `mcp_tool` availability/start/cancel/usage/error，禁止不可用时静默回退 mock。 | 接入 Registry/InvocationPlan | [打开](./Day73.md) |
| 74 | 09-25 周五 3h | MCP 权限治理 | Capability binding、租户/Session 隔离、高风险审批和全链路审计。 | 将 MCP Tool 纳入统一权限治理 | [打开](./Day74.md) |
| 75 | 09-26 周六 6h | Human Runtime | 实现 waiting/response/timeout/cancel、幂等和重启后恢复等待态。 | 实现真实可恢复 Human Runtime | [打开](./Day75.md) |
| 76 | 09-27 周日 6h | Agent 审批 UX | 展示对象、风险、作用域、diff 和副作用；验证双击、过期、切 Session 不串卡。 | 完善审批控制面 | [打开](./Day76.md) |
| 77 | 09-28 周一 3h | Durable 恢复 | 验证批准后崩溃、执行中崩溃、Redis 断开，保证不丢决定和不重复副作用。 | 加固 Human/Tool 恢复闭环 | [打开](./Day77.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week10-Day64-70/README.md) | [总索引](../README.md) | [下一周](../Week12-Day78-84/README.md)
