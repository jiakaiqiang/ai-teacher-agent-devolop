# 90 天按周学习计划

本目录按 13 周组织 Day 1-90 的完整学习计划和项目任务。内容从 `output/90天逐日任务` 自动生成，源目录是唯一权威版本。

总天数：90 天。总学习时间：348 小时。工作日每天 3 小时，周末每天 6 小时。

重新生成：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Generate-WeeklyPlan.ps1
```

## 周导航

| 周 | Day | 时长 | 阶段结果 | 目录 |
|---:|---:|---:|---|---|
| Week 1 | Day 1-7 | 27h | 实时指标合同、Vue 状态与 WebSocket 可靠性 | [进入](./Week01-Day01-07/README.md) |
| Week 2 | Day 8-14 | 27h | 异常闭环、Tool Registry、Agent Loop 与 SSE | [进入](./Week02-Day08-14/README.md) |
| Week 3 | Day 15-21 | 27h | Agent UX、安全、Trace、第一节点考试与 NestJS 桥接 | [进入](./Week03-Day15-21/README.md) |
| Week 4 | Day 22-28 | 27h | API、数据、鉴权、测试、流式 BFF、PostgreSQL 与 Redis | [进入](./Week04-Day22-28/README.md) |
| Week 5 | Day 29-35 | 27h | 队列、编排、Durable HITL、恢复与可观测性 | [进入](./Week05-Day29-35/README.md) |
| Week 6 | Day 36-42 | 27h | 后端生产质量、Node 门禁与 Python/FastAPI 桥接 | [进入](./Week06-Day36-42/README.md) |
| Week 7 | Day 43-49 | 27h | 模型网关、结构化输出、Prompt、RAG 与引用 | [进入](./Week07-Day43-49/README.md) |
| Week 8 | Day 50-56 | 27h | RAG/LLM Eval、多租户、Docker 与 CI/CD | [进入](./Week08-Day50-56/README.md) |
| Week 9 | Day 57-63 | 27h | Trace、事故、求职、AI 全栈考试与 Agent Runtime 桥接 | [进入](./Week09-Day57-63/README.md) |
| Week 10 | Day 64-70 | 27h | 本地 CLI 流、Context、Capability、Validator、Memory 与 DAG | [进入](./Week10-Day64-70/README.md) |
| Week 11 | Day 71-77 | 27h | MCP、Human Runtime、审批 UX 与恢复 | [进入](./Week11-Day71-77/README.md) |
| Week 12 | Day 78-84 | 27h | 生产 RAG、动态委派、并行 Handoff 与对抗验证 | [进入](./Week12-Day78-84/README.md) |
| Week 13 | Day 85-90 | 24h | Agent Eval、Replay、SLO、Chaos、求职与最终答辩 | [进入](./Week13-Day85-90/README.md) |

## 使用规则

- 每个周目录的 `README.md` 给出本周结果和每日总览。
- 每个 `DayNN.md` 是完整任务，包含知识、项目、时间盒、验收、真实项目情境题和 PDF 面试题。
- 生成副本只用于按周执行；调整课程时先修改 `output/90天逐日任务`，再运行生成脚本。
- 本地 PDF 不进入公开 Git 仓库，文件名不代表企业官方题库。
