# Week 4：Day 22-28

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

API、数据、鉴权、测试、流式 BFF、PostgreSQL 与 Redis

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 22 | 08-04 周二 3h | API 合同 | DTO、Zod/AJV、统一错误、OpenAPI；前后端共享类型不得漂移。 | 统一 API/SSE/WS 错误和响应合同 | [打开](./Day22.md) |
| 23 | 08-05 周三 3h | 数据建模 | Conversation/Message/Citation/User 模型、索引、分页和迁移。 | 建模 Conversation/Message/Citation/User 并接诊断会话 | [打开](./Day23.md) |
| 24 | 08-06 周四 3h | 鉴权/权限 | JWT/Session、RBAC、资源级权限；证明前端菜单不能防越权。 | 登录、用户隔离及异常/诊断资源级权限 | [打开](./Day24.md) |
| 25 | 08-07 周五 3h | 后端测试 | Service/Controller/Repository 单测与集成测试；关键模块覆盖 >= 75%。 | 为核心 Backend 模块建立分层测试 | [打开](./Day25.md) |
| 26 | 08-08 周六 6h | 流式 BFF | 模型流透传、客户端断开取消上游、超时、重试、request id 和结构化日志。 | 建模型流代理并接现有 Agent UI | [打开](./Day26.md) |
| 27 | 08-09 周日 6h | Postgres 持久化 | 会话与消息事务、用户隔离、删除策略；三层链路考试。 | 保证 Message、Diagnosis、事件发布的一致性 | [打开](./Day27.md) |
| 28 | 08-10 周一 3h | Redis | 缓存、限流、幂等键、会话状态；解释缓存穿透/雪崩及失效。 | Redis 缓存指标摘要、限流模型调用、保存幂等键 | [打开](./Day28.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week03-Day15-21/README.md) | [总索引](../README.md) | [下一周](../Week05-Day29-35/README.md)
