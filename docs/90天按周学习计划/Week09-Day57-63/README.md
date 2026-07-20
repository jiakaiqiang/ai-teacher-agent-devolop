# Week 9：Day 57-63

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

Trace、事故、求职、AI 全栈考试与 Agent Runtime 桥接

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 57 | 09-08 周二 3h | 监控/Trace | OpenTelemetry 或等价方案；模型、Prompt、检索、工具、DB 链路可追踪。 | 打通浏览器-Nest-Python-RAG-模型-DB Trace | [打开](./Day57.md) |
| 58 | 09-09 周三 3h | 事故演练 | 模型 429、Redis 断开、DB 慢查询、队列积压、RAG 空召回、部署回滚。 | 生产演练：429、Redis 断、DB 慢、积压、空召回、部署失败 | [打开](./Day58.md) |
| 59 | 09-10 周四 3h | 求职证据 | README、架构图、ADR、性能报告、安全报告、Eval 报告、8 分钟 Demo。 | 整理 README、ADR、Eval、安全、性能和 8 分钟演示 | [打开](./Day59.md) |
| 60 | 09-11 周五 3h | AI 全栈毕业考 | 闭卷 + 全链路故障 + 项目答辩；总分 >= 70，后端/安全/Eval 各 >= 60。 | AI 全栈毕业考 | [打开](./Day60.md) |
| 61 | 09-12 周六 6h | Agent 系统分层 | 从空仓库初始化轻量 Agent 工作台，定义 Session、Run、Event、Artifact 合同，打通 Vue、FastAPI、Stub Runtime 与 SSE 最小主链路。 | 初始化项目并完成第一条可运行、可测试的 Agent Run | [打开](./Day61.md) |
| 62 | 09-13 周日 6h | 双 Agent 协同与 Event Sourcing | 接入第一个本地 CLI Runtime，完成固定 `coordinator -> executor` 顺序协同，并用 Event Sourcing 保证 TaskContract、Handoff 和 Artifact 可追踪、可重放。 | 实现本地 CLI 双 Agent 顺序协同、事件归约和断线恢复 | [打开](./Day62.md) |
| 63 | 09-14 周一 3h | 双 Local CLI Runtime | 完成 Codex CLI 与 Claude Code CLI 两个 Adapter，统一 Registry、InvocationPlan、availability、cancel 和 fail-closed；角色可以交换 Runtime，但合同不能漂移。 | 实现双 CLI Runtime 注册、可用性、角色路由与调用审计 | [打开](./Day63.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week08-Day50-56/README.md) | [总索引](../README.md) | [下一周](../Week10-Day64-70/README.md)
