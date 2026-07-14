# Week 6：Day 36-42

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

后端生产质量、Node 门禁与 Python/FastAPI 桥接

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 36 | 08-18 周二 3h | API 安全 | CORS、CSP、请求大小、上传、注入、速率限制和错误脱敏。 | 加固 API、Markdown、上传和模型入口 | [打开](./Day36.md) |
| 37 | 08-19 周三 3h | 性能 | SQL explain、索引、连接池、缓存命中率、流式背压基础。 | 优化真实慢查询和高频指标/Agent 时间线 | [打开](./Day37.md) |
| 38 | 08-20 周四 3h | 稳定性 | 超时、重试、熔断、降级；区分可重试与不可重试错误。 | 为模型/Tool/DB/Redis 建分层韧性策略 | [打开](./Day38.md) |
| 39 | 08-21 周五 3h | Agent 指标 | 工具成功率、平均步数、终止原因、成本和人工接管率。 | 实现运行质量看板和问题下钻 | [打开](./Day39.md) |
| 40 | 08-22 周六 6h | Node 全栈门禁 | 故障注入 + SQL/API/权限/Tool Loop 答辩；后端基础 >= 65。 | Node 全栈门禁和故障演练 | [打开](./Day40.md) |
| 41 | 08-23 周日 6h | Python 工程边界 | typing、asyncio、pytest、ruff；创建 `services/ai` 并由 NestJS 当天实际调用，禁止孤立小 Demo。 | 在 `services/ai` 创建并接入 p1-monitor 的诊断服务骨架 | [打开](./Day41.md) |
| 42 | 08-24 周一 3h | FastAPI | 路由、依赖注入、Pydantic、异常、中间件、OpenAPI 和测试客户端。 | 提供 health、diagnose、embed 内部接口 | [打开](./Day42.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week05-Day29-35/README.md) | [总索引](../README.md) | [下一周](../Week07-Day43-49/README.md)
