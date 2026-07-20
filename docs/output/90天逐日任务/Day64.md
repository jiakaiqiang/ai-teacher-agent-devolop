# Day 64 - 双 CLI 统一流协议

> **《90 天拆分规则说明》校正口径（Day 64 权威执行口径）**
>
> - 阶段定位：阶段三（Day61-90，AI 全栈 -> AI Agent 工程师），所有增量进入 p2-agent-workbench 用户主链路。
> - 完整模块：双 CLI 流帧归一化与进程监督；代码落点为 backend/app/runtimes/streaming.py、process_supervisor.py、tests/day64，必须能运行、能测试、能观察结果。
> - v1：按完整行解析一种 JSONL 输出；v2：支持半包、粘包、噪声和两种 CLI 事件映射；v3：加入首帧/idle/总超时、session fence、进程树取消和晚到输出隔离。三版都要保留真实运行证据，并说明后一版修复的具体痛点。
> - 累积复用：输入是 Day63 的 Adapter、InvocationPlan 和统一事件合同；本日输出直接交给 Day65 的 ContextEnvelope 与 Handoff 引用，禁止新建无关 Demo。
> - 时间盒：本日固定 90 分钟阅读 + 90 分钟动手；阅读先建立因果模型，动手按 v1 -> v2 -> v3 完成运行、测试和证据。
> - 硬门槛：完成 碎帧、超大帧、错误 JSON、取消竞态、晚到 Artifact；提交真实 diff、命令输出、架构证据、学习日志和 AI Review，未运行或无证据的内容不得标记完成。
>
## v1 -> v2 -> v3 执行步骤

1. **v1 最小闭环**：按完整行解析一种 JSONL 输出。先写失败测试，再实现最短用户链路；checkpoint 是一次 Run 有确定终态和 traceId。
2. **v2 关键加层**：支持半包、粘包、噪声和两种 CLI 事件映射。复用 v1 合同，不复制旁路实现；checkpoint 是正常、边界和权限/重放测试可重复。
3. **v3 生产约束**：加入首帧/idle/总超时、session fence、进程树取消和晚到输出隔离。补取消、超时、审计、恢复或发布门禁；checkpoint 是故障后没有静默成功和重复副作用。
4. **运行命令**：在 D:\demo\ai-techer\p2-agent-workbench 执行 uv run pytest tests/day64 -q；涉及前端时再执行 pnpm --dir frontend test -- --run day64。实际命令和输出写入 evidence/day64/。

## 必做测试与两个反证

- 测试范围：碎帧、超大帧、错误 JSON、取消竞态、晚到 Artifact；至少覆盖正常、边界、权限或并发/重放、恢复中的三类。
- 反证 1：移除增量缓冲后拆分一个 JSON 帧，解析器必须显式失败而非丢事件。记录复现步骤、可观察信号、恢复动作和恢复后测试。
- 反证 2：取消时只杀父进程，测试必须观察到子进程存活并阻止 Run 终态。记录复现步骤、可观察信号、恢复动作和恢复后测试。

## 跨 Day 导航

- 前置复用：Day63 的 Adapter、InvocationPlan 和统一事件合同。
- 本日交付：双 CLI 流帧归一化与进程监督。
- 后续消费：Day65 的 ContextEnvelope 与 Handoff 引用。

日期与时长：09-15 周二 3h  
项目：`D:\demo\ai-techer\p2-agent-workbench`  
Runtime 基线：Agent 角色通过本机 Codex CLI / Claude Code CLI 执行；后端只调用服务端 allowlist 命令模板，不直接调用模型 HTTP API，不使用危险权限绕过参数。  
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

## 今日目标

将 Codex JSONL 与 Claude Code stream-json 归一化为统一事件，验证增量解码、碎帧、首帧/idle watchdog、session mismatch、完整进程树取消和晚到输出。

## 必须掌握的知识

Codex JSONL、Claude stream-json、增量解码、进程生命周期、cancel/resume、watchdog

学习时必须讲清每个概念解决的问题、运行机制、项目落点、生产误区和验证方法，不能只记 API。

## 真实项目任务

实现双 CLI 统一事件映射与 ProcessSupervisor

禁止新建与主项目无关的 Demo；当天改动必须进入真实用户链路或真实平台合同。

## 原理反证与架构证据

双 CLI 流式时序；碎帧、无首帧、idle、session mismatch、取消后的晚到输出

## 人与 AI 分工

人写 parser、终态和进程树不变量；AI 生成两个 CLI 的异常帧 fixture

任何 AI 生成内容都要记录接受、修改或拒绝理由。核心合同、状态机、权限、Eval 标签和最终验收由人负责。

## 时间盒

本日固定为 90 分钟阅读 + 90 分钟动手。阅读覆盖原理、源码和边界；动手覆盖 v1/v2/v3、测试、反证、架构证据与复盘。

## 通过标准

5 类故障有确定结果；cancel 会终止完整进程树且任何晚到输出不能进入 completed/Artifact

完成后提交 commit、测试输出、学习日志、架构证据和 AI Review 记录，先回答本文件的三道课末核心问题；项目初检通过后再进入教师五连问。

## 课末 3 个核心问题

1. 从子进程 stdout 原始字节到统一 AgentEvent，解释 Codex JSONL、Claude stream-json、增量解码、watchdog、session fence 和终态归约的顺序；其中哪一层负责保证取消后不能生成 Artifact？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 教学模拟：20 个本地 CLI Run 混合使用 Codex JSONL 和 Claude stream-json；中文 UTF-8 被拆帧时解析失败，watchdog 又把慢首帧误判为空闲。请按五段式给出原始字节、runtime 类型、parser 状态、首帧与 idle span 证据，完成止损、增量解码修复、双协议 fixture 验证和统一事件演进。
   依据：[S6 Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)
2. 教学模拟：用户取消 executor 后父 CLI 退出，但其子进程继续 90 秒并写入 worktree；另有旧 session 的晚到 `result` 被 validator 接受。请按五段式证明 cancel 传播断点，隔离副作用，修复进程树终止、session fence 与终态判定，做竞态回归并演进 Runtime watchdog。
   依据：[S4 WorkBuddy](https://careers.tencent.com/jobdesc.html?postId=2074485456237670400)
知识映射：Day 64：双 CLI 流协议、增量解码、进程树、session fence、取消与 watchdog。

## 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## PDF 面试题

1. 手写流式数据解析器，处理 Fetch 返回的 ReadableStream。  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 1 页。
2. AI 接口超时和异常重试策略应该如何设计？  
   来源：[《2026腾讯混元AIGC前端架构师》](<../../资源/2026腾讯混元AIGC前端架构师.pdf>)，第 1 页。
题目说明：流解析、超时和异常处理直接相关；CLI JSONL、碎帧、watchdog、session mismatch 没有直接原题，属于近似题/资源缺口。
