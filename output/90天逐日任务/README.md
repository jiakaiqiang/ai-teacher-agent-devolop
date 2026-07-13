# 90 天逐日任务索引

项目分段：Day 1-60 使用 `D:\demo\ai-techer\p1-monitor`；Day 61 从零创建 `D:\demo\ai-techer\p2-agent-workbench`，并持续使用到 Day 90。新项目的规模和非目标见[《p2-agent-workbench 项目边界》](../p2-agent-workbench项目边界.md)。

课程的 13 周递进目标、每天知识点分钟分配、项目结果和代码落点，以[《90 天岗位驱动项目课程 v2》](../90天岗位驱动项目课程-v2.md)为准。每个 Day 文件是当天教师基线；领取任务时还要读取上一日 commit 和当前源码，补充不会与真实分支冲突的 starter code。

本目录将课程拆分为 90 个独立日任务。PDF 题目来自本地资源，文件名不等于官方题库；题目只用于复习和答辩训练。

执行时仍遵守：学生发送 `开始 Day N` 后，教师根据上一日成绩、当前代码和中国岗位动态只分发当天任务。
每个 Day 文件结尾包含 3 个课末自检核心题、至少 2 个联网来源的真实项目情境题和 2 个 PDF 面试题；项目初检通过后，教师再按[《五连问验收协议》](../AI教师五连问验收协议.md)根据真实 diff 现场出题。情境题是基于岗位职责和官方机制构造的教学模拟，不代表来源企业真实事故；标有“近似题/资源缺口”的 PDF 内容不得宣称为该主题直接原题。

## 周次导航

| 周 | Day | 阶段结果 |
|---:|---:|---|
| Week 1 | 1-7 | 实时指标合同、Vue 状态和 WebSocket 可靠性 |
| Week 2 | 8-14 | 异常闭环、Tool Registry、Agent Loop、SSE |
| Week 3 | 15-21 | Agent UX、安全、Trace、第一节点考试、NestJS 桥接 |
| Week 4 | 22-28 | API、数据、鉴权、测试、流式 BFF、Postgres、Redis |
| Week 5 | 29-35 | 队列、编排、Durable HITL、恢复、可观测性 |
| Week 6 | 36-42 | 后端生产质量、Node 门禁、Python/FastAPI 桥接 |
| Week 7 | 43-49 | 模型网关、生成式 UI、Prompt、RAG 与引用 |
| Week 8 | 50-56 | RAG/LLM Eval、多租户、Docker、CI/CD |
| Week 9 | 57-63 | Trace、事故、求职、AI 全栈考试、Agent Runtime 桥接 |
| Week 10 | 64-70 | CLI 流、Context、Capability、Tool、Memory、DAG |
| Week 11 | 71-77 | MCP、Human Runtime、审批 UX、恢复 |
| Week 12 | 78-84 | 生产 RAG、动态委派、并行 Handoff、对抗 Validation Agent |
| Week 13 | 85-90 | Agent Eval、Replay、SLO、Chaos、求职与最终答辩 |

| Day | 日期/时长 | 主题 | 任务文件 |
|---:|---|---|---|
| 1 | 07-14 周二 3h | AI 前端架构 | [Day 01](./Day01.md) |
| 2 | 07-15 周三 3h | 领域合同 | [Day 02](./Day02.md) |
| 3 | 07-16 周四 3h | 异步与竞态 | [Day 03](./Day03.md) |
| 4 | 07-17 周五 3h | Vue/ECharts 原理 | [Day 04](./Day04.md) |
| 5 | 07-18 周六 6h | WebSocket 全栈 | [Day 05](./Day05.md) |
| 6 | 07-19 周日 6h | 实时可靠性 | [Day 06](./Day06.md) |
| 7 | 07-20 周一 3h | 事件与算法 | [Day 07](./Day07.md) |
| 8 | 07-21 周二 3h | API/分页 | [Day 08](./Day08.md) |
| 9 | 07-22 周三 3h | 状态机 | [Day 09](./Day09.md) |
| 10 | 07-23 周四 3h | M2 门禁 | [Day 10](./Day10.md) |
| 11 | 07-24 周五 3h | Tool Registry | [Day 11](./Day11.md) |
| 12 | 07-25 周六 6h | Agent Loop | [Day 12](./Day12.md) |
| 13 | 07-26 周日 6h | 持久化/幂等 | [Day 13](./Day13.md) |
| 14 | 07-27 周一 3h | SSE 合同演进 | [Day 14](./Day14.md) |
| 15 | 07-28 周二 3h | Agent 时间线 | [Day 15](./Day15.md) |
| 16 | 07-29 周三 3h | 证据与 XSS | [Day 16](./Day16.md) |
| 17 | 07-30 周四 3h | Human-in-the-loop | [Day 17](./Day17.md) |
| 18 | 07-31 周五 3h | Trace/性能 | [Day 18](./Day18.md) |
| 19 | 08-01 周六 6h | 生产演练 | [Day 19](./Day19.md) |
| 20 | 08-02 周日 6h | 项目毕业考 | [Day 20](./Day20.md) |
| 21 | 08-03 周一 3h | NestJS 架构深化 | [Day 21](./Day21.md) |
| 22 | 08-04 周二 3h | API 合同 | [Day 22](./Day22.md) |
| 23 | 08-05 周三 3h | 数据建模 | [Day 23](./Day23.md) |
| 24 | 08-06 周四 3h | 鉴权/权限 | [Day 24](./Day24.md) |
| 25 | 08-07 周五 3h | 后端测试 | [Day 25](./Day25.md) |
| 26 | 08-08 周六 6h | 流式 BFF | [Day 26](./Day26.md) |
| 27 | 08-09 周日 6h | Postgres 持久化 | [Day 27](./Day27.md) |
| 28 | 08-10 周一 3h | Redis | [Day 28](./Day28.md) |
| 29 | 08-11 周二 3h | 队列/BullMQ | [Day 29](./Day29.md) |
| 30 | 08-12 周三 3h | 月度门禁 | [Day 30](./Day30.md) |
| 31 | 08-13 周四 3h | Tool Registry v2 | [Day 31](./Day31.md) |
| 32 | 08-14 周五 3h | Orchestrator | [Day 32](./Day32.md) |
| 33 | 08-15 周六 6h | Durable HITL | [Day 33](./Day33.md) |
| 34 | 08-16 周日 6h | 失败恢复 | [Day 34](./Day34.md) |
| 35 | 08-17 周一 3h | 可观测性 | [Day 35](./Day35.md) |
| 36 | 08-18 周二 3h | API 安全 | [Day 36](./Day36.md) |
| 37 | 08-19 周三 3h | 性能 | [Day 37](./Day37.md) |
| 38 | 08-20 周四 3h | 稳定性 | [Day 38](./Day38.md) |
| 39 | 08-21 周五 3h | Agent 指标 | [Day 39](./Day39.md) |
| 40 | 08-22 周六 6h | Node 全栈门禁 | [Day 40](./Day40.md) |
| 41 | 08-23 周日 6h | Python 工程边界 | [Day 41](./Day41.md) |
| 42 | 08-24 周一 3h | FastAPI | [Day 42](./Day42.md) |
| 43 | 08-25 周二 3h | 模型网关 | [Day 43](./Day43.md) |
| 44 | 08-26 周三 3h | 结构化输出 | [Day 44](./Day44.md) |
| 45 | 08-27 周四 3h | Prompt 版本 | [Day 45](./Day45.md) |
| 46 | 08-28 周五 3h | RAG 摄取 | [Day 46](./Day46.md) |
| 47 | 08-29 周六 6h | Embedding/pgvector | [Day 47](./Day47.md) |
| 48 | 08-30 周日 6h | Hybrid/Rerank | [Day 48](./Day48.md) |
| 49 | 08-31 周一 3h | RAG 引用闭环 | [Day 49](./Day49.md) |
| 50 | 09-01 周二 3h | 五十日门禁 | [Day 50](./Day50.md) |
| 51 | 09-02 周三 3h | RAG Eval | [Day 51](./Day51.md) |
| 52 | 09-03 周四 3h | LLM Eval | [Day 52](./Day52.md) |
| 53 | 09-04 周五 3h | LangChain 适用边界 | [Day 53](./Day53.md) |
| 54 | 09-05 周六 6h | 多租户/权限 | [Day 54](./Day54.md) |
| 55 | 09-06 周日 6h | Docker Compose | [Day 55](./Day55.md) |
| 56 | 09-07 周一 3h | CI/CD | [Day 56](./Day56.md) |
| 57 | 09-08 周二 3h | 监控/Trace | [Day 57](./Day57.md) |
| 58 | 09-09 周三 3h | 事故演练 | [Day 58](./Day58.md) |
| 59 | 09-10 周四 3h | 求职证据 | [Day 59](./Day59.md) |
| 60 | 09-11 周五 3h | AI 全栈毕业考 | [Day 60](./Day60.md) |
| 61 | 09-12 周六 6h | Agent 系统分层 | [Day 61](./Day61.md) |
| 62 | 09-13 周日 6h | 双 Agent/Event Sourcing | [Day 62](./Day62.md) |
| 63 | 09-14 周一 3h | 双 CLI Runtime | [Day 63](./Day63.md) |
| 64 | 09-15 周二 3h | 双 CLI 流协议 | [Day 64](./Day64.md) |
| 65 | 09-16 周三 3h | 协同 Context | [Day 65](./Day65.md) |
| 66 | 09-17 周四 3h | 角色/CLI 权限 | [Day 66](./Day66.md) |
| 67 | 09-18 周五 3h | Tool Loop/Validator | [Day 67](./Day67.md) |
| 68 | 09-19 周六 6h | 协同 Memory/RAG | [Day 68](./Day68.md) |
| 69 | 09-20 周日 6h | Worktree/DAG 并行 | [Day 69](./Day69.md) |
| 70 | 09-21 周一 3h | 多 Agent 主链路门禁 | [Day 70](./Day70.md) |
| 71 | 09-22 周二 3h | MCP 设计 | [Day 71](./Day71.md) |
| 72 | 09-23 周三 3h | MCP Server | [Day 72](./Day72.md) |
| 73 | 09-24 周四 3h | MCP Runtime Adapter | [Day 73](./Day73.md) |
| 74 | 09-25 周五 3h | MCP 权限治理 | [Day 74](./Day74.md) |
| 75 | 09-26 周六 6h | Human Runtime | [Day 75](./Day75.md) |
| 76 | 09-27 周日 6h | Agent 审批 UX | [Day 76](./Day76.md) |
| 77 | 09-28 周一 3h | Durable 恢复 | [Day 77](./Day77.md) |
| 78 | 09-29 周二 3h | RAG Eval | [Day 78](./Day78.md) |
| 79 | 09-30 周三 3h | Hybrid RAG | [Day 79](./Day79.md) |
| 80 | 10-01 周四 3h | MCP/Human/RAG 门禁 | [Day 80](./Day80.md) |
| 81 | 10-02 周五 3h | 动态委派语义 | [Day 81](./Day81.md) |
| 82 | 10-03 周六 6h | 自主委派调度 | [Day 82](./Day82.md) |
| 83 | 10-04 周日 6h | 并行冲突/Handoff | [Day 83](./Day83.md) |
| 84 | 10-05 周一 3h | 对抗 Validation Agent | [Day 84](./Day84.md) |
| 85 | 10-06 周二 3h | Agent Eval | [Day 85](./Day85.md) |
| 86 | 10-07 周三 3h | Trace/Replay/A-B | [Day 86](./Day86.md) |
| 87 | 10-08 周四 3h | SLO/成本/告警 | [Day 87](./Day87.md) |
| 88 | 10-09 周五 3h | Chaos/可靠性 | [Day 88](./Day88.md) |
| 89 | 10-10 周六 6h | 生产就绪/求职 | [Day 89](./Day89.md) |
| 90 | 10-11 周日 6h | 最终答辩 | [Day 90](./Day90.md) |
