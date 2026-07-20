# Week 12：Day 78-84

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

生产 RAG、动态委派、并行 Handoff 与对抗验证

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 78 | 09-29 周二 3h | RAG Eval | 人工标注 30 条黄金集，建立关键词检索 Recall@5/MRR 基线和失败分类。 | 为现有关键词 RAG 建企业评测基线 | [打开](./Day78.md) |
| 79 | 09-30 周三 3h | Hybrid RAG | 增加 Embedding、pgvector、hybrid/rerank 和引用；保留可见的关键词降级。 | 升级检索并保留关键词降级路径 | [打开](./Day79.md) |
| 80 | 10-01 周四 3h | MCP/Human/RAG 门禁 | 断 MCP、拒绝审批、Embedding 失败三种演练；安全 >= 70%，不得产生越权副作用。 | 第二 Agent 门禁 | [打开](./Day80.md) |
| 81 | 10-02 周五 3h | 动态委派语义 | 将 Day 62 的固定 coordinator/executor/validator 角色图升级为受控动态委派，补齐 agent-suggested/agent-delegated 的深度、权限、终止和责任链审计。 | 将固定角色协同升级为受控动态委派 | [打开](./Day81.md) |
| 82 | 10-03 周六 6h | 自主委派调度 | claim、lease、幂等、任务级队列和 worker 恢复；同一任务最多一个有效 owner。 | 实现自主委派调度 | [打开](./Day82.md) |
| 83 | 10-04 周日 6h | 并行冲突/Handoff | 文件冲突、base hash 和 Artifact 交接；冲突不得静默覆盖。 | 加固并行 Agent 产物交接 | [打开](./Day83.md) |
| 84 | 10-05 周一 3h | 对抗 Validation Agent | 升级 Day 67 的独立验证者，加入对抗 Artifact、伪造测试识别、角色/Runtime 独立性和更严格的证据门禁；无证据不能标记 passed。 | 升级独立验证者与对抗证据门禁 | [打开](./Day84.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week11-Day71-77/README.md) | [总索引](../README.md) | [下一周](../Week13-Day85-90/README.md)
