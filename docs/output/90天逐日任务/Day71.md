# Day 71 - MCP 设计

> **《90 天拆分规则说明》校正口径（Day 71 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师）。MCP、Human Runtime 与 RAG 都是多 Agent 主链路的受控能力，不是独立 Demo。
> - 完整模块：MCP Host/Client/Server 边界合同与可运行探针；代码落点为 backend/app/mcp/contracts.py、probe.py、docs/adr/ADR-071-mcp-boundary.md、tests/day71，必须能运行、能测试、能观察结果。
> - v1：Host 通过内存 Client 调用一个 Stub Server 工具；v2：增加发现、Schema 校验、取消与统一错误；v3：接入 Runtime 事件、权限决策、审计和 transport 边界。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day70 的 Runtime、权限、事件和独立门禁；本日输出直接交给 Day72 的受控只读 MCP Server。
> - 时间盒：本日固定 90 分钟阅读 + 90 分钟动手；阅读先建立因果模型，动手按 v1 -> v2 -> v3 完成运行、测试和证据。
> - 硬门槛：完成 发现、正常调用、Schema 不匹配、取消、Server 消失和审计；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：Host 通过内存 Client 调用一个 Stub Server 工具。先写失败测试，再完成最短用户链路；checkpoint 是一次调用或 Run 有确定终态和 traceId。
2. **v2 关键加层**：增加发现、Schema 校验、取消与统一错误。复用 v1 合同；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：接入 Runtime 事件、权限决策、审计和 transport 边界。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后无静默成功、越权和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day71 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day71。实际命令和输出写入 evidence/day71/。

## 必做测试与两个反证

- 测试范围：发现、正常调用、Schema 不匹配、取消、Server 消失和审计；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：调用中关闭 Server，Client 必须得到确定错误并终止 Run。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：让业务层直接依赖 transport 细节，合同替换测试必须暴露耦合并拒绝合并。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day70 的 Runtime、权限、事件和独立门禁。
- 本日交付：MCP Host/Client/Server 边界合同与可运行探针。
- 后续消费：Day72 的受控只读 MCP Server。

日期与时长：09-22 周二 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

先完成 Host/Client/Server、transport、发现、调用、取消、审计、权限和现有 Runtime 对接 ADR。

## 必须掌握的知识

MCP 生命周期、transport、tools/list、tools/call、错误模型

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

先设计 MCP 与现有 Runtime/Capability 的边界

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

对接 ADR；MCP Server 消失

## 人与 AI 分工

人做边界/威胁建模；AI 对照协议查漏

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日固定为 90 分钟阅读 + 90 分钟动手。阅读覆盖原理、源码和边界；动手覆盖 v1/v2/v3、测试、反证、架构证据与复盘。

## 通过标准

连接、发现、调用、取消、审计、权限六边界明确

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 请从今天项目的真实入口到最终输出，解释“MCP 设计”的数据流或控制流；当天知识链“MCP 生命周期、transport、tools/list、tools/call、错误模型”分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：客户端支持 MCP 2025-06-18，老 Server 只支持旧协议；初始化后 capability negotiation 不一致，客户端仍展示 tools/list 返回的 26 个工具。请按五段式给出握手、版本和能力证据，止损错误曝光、修复协商与降级、验证兼容矩阵，并演进 MCP 边界。
   依据：[MCP Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
2. 教学模拟：MCP Server 在 tools/call 执行 40 秒时断开，客户端把 transport error 映射为业务成功，用户又重复调用。请按五段式说明如何关联 request id 和调用状态、阻断副作用、修复错误模型与取消、验证断连重连，并演进调用审计。
   依据：[MCP Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
知识映射：Day 71：MCP 生命周期、transport、能力协商与错误模型。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 解释 Function Calling 原理，前端如何配合模型完成一次完整工具调用？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 1 页。
2. 从零设计 AI Agent 工作流可视化编辑器时，如何选型和设计架构？  
   来源：[《2026MiNiMax前端AI开发》](<../../资源/2026MiNiMax前端AI开发.pdf>)，第 1 页。
题目说明：近似题/资源缺口：本地中国 PDF 未发现直接考 MCP 生命周期、transport、tools/list、tools/call 或 MCP 错误模型的题。
