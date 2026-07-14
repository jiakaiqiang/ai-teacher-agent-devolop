# Week 10：Day 64-70

> 本周文件由 `scripts/Generate-WeeklyPlan.ps1` 从 `output/90天逐日任务` 生成。权威内容仍以源任务为准。

## 本周结果

本地 CLI 流、Context、Capability、Validator、Memory 与 DAG

总学习时间：27 小时。

## 每日任务

| Day | 日期/时长 | 主题 | 今日目标 | 项目任务 | 完整任务 |
|---:|---|---|---|---|---|
| 64 | 09-15 周二 3h | 双 CLI 统一流协议 | 将 Codex JSONL 与 Claude Code stream-json 归一化为统一事件，验证增量解码、碎帧、首帧/idle watchdog、session mismatch、完整进程树取消和晚到输出。 | 实现双 CLI 统一事件映射与 ProcessSupervisor | [打开](./Day64.md) |
| 65 | 09-16 周三 3h | 多 Agent Context/Handoff | 为 coordinator、executor、validator 建立共享 ContextEnvelope 和角色最小视图，完成 Evidence Gate、token budget、Handoff 引用、裁剪与补读恢复。 | 实现多角色 ContextEnvelope、Handoff 引用、裁剪和补读 | [打开](./Day65.md) |
| 66 | 09-17 周四 3h | 角色与 Local CLI 权限 | 验证 role/workspace/runtime/tool/approval 权限交集；coordinator 与 validator 默认只读，executor 只能写入分配工作区，危险 CLI 参数必须 fail-closed。 | 实现角色最小权限、CLI 命令 allowlist 与稳定 block reason | [打开](./Day66.md) |
| 67 | 09-18 周五 3h | Tool Loop 与 Validation Agent | 建立 executor 的有界 Tool Loop，并增加独立只读 validator；验证必须引用 diff、测试和 Artifact，失败最多返工两次。 | 建立 executor -> validator -> 有界返工的协同 E2E | [打开](./Day67.md) |
| 68 | 09-19 周六 6h | 多 Agent Memory/RAG 基线 | 区分多角色共享事实、角色临时上下文、长期记忆与 RAG；建立 20 条查询的关键词召回基线和可审计写入策略。 | 建立多角色共享事实索引、关键词检索基线和 Memory 写入策略 | [打开](./Day68.md) |
| 69 | 09-20 周日 6h | Worktree/DAG 并行协同 | 允许最多两个 executor 在独立 git worktree 中执行受限 ready-wave，使用 TaskContract、base hash、并发上限、失败传播、checkpoint、冲突门禁和 cancel fence。 | 实现两个本地 CLI executor 的隔离 worktree/DAG 并行 | [打开](./Day69.md) |
| 70 | 09-21 周一 3h | Local CLI 多 Agent 主链路门禁 | 关闭 AI，随机注入 CLI 缺失、流中断、权限拒绝、Handoff 缺失或 worktree 冲突之一并独立定位修复；原理和故障定位均 >= 70%。 | 第一 Local CLI 多 Agent 门禁 | [打开](./Day70.md) |

## 执行门禁

- 每天只领取和完成当天任务，不提前用后续答案替代当日思考。
- 提交真实 commit、测试输出、学习日志、架构证据和 AI Review。
- 完成课末核心题、真实项目情境题和 PDF 题后，再接受教师五连问。
- 功能完成但原理、测试或独立排障不通过，当天仍不合格。

[上一周](../Week09-Day57-63/README.md) | [总索引](../README.md) | [下一周](../Week11-Day71-77/README.md)
