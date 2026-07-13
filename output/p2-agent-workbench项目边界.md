# p2-agent-workbench 项目边界

项目路径：`D:\demo\ai-techer\p2-agent-workbench`  
启动时间：Day 61  
定位：从零构建的轻量 Agent 任务工作台，用于完成 Agent 工程阶段的学习、作品集和答辩，不依赖现有大型多 Agent 平台。

## 1. 用户主链路

```text
创建任务 -> coordinator 规划 -> executor 执行 -> validator 验证
        -> SSE 事件时间线 -> 必要时人工审批 -> Artifact -> Eval/Trace/Replay
```

所有 Day 61-90 增量都必须进入这条链路，不创建互不相关的 Demo。

## 2. 技术栈与目录

```text
p2-agent-workbench/
  frontend/                 Vue 3 + TypeScript + Pinia
  backend/                  FastAPI 模块化单体
    app/api/                Session、Run、Approval、Artifact API
    app/domain/             合同、状态机与领域规则
    app/orchestrator/       固定角色协同、受限 DAG 与委派
    app/runtimes/           Stub、Codex CLI、Claude Code CLI、MCP、Human Adapter
    app/tools/              Tool Registry、Capability 与审计
    app/memory/             Context、Memory、RAG
    app/eval/               数据集、Replay 与指标
    app/observability/      日志、Trace、SLI/SLO
  infra/                    PostgreSQL、Redis、Docker Compose
  tests/                    合同、集成、E2E、Eval 与故障注入
  docs/                     C4、时序、ADR、Threat Model、Runbook
```

后端保持一个部署单元；worker 在需要队列前作为同一代码库中的进程入口，不提前拆成微服务。

## 3. 三阶段成果

| 阶段 | 项目结果 | 规模边界 |
|---|---|---|
| Day 61 | 从零打通单 Agent Run、事件流和 Stub Runtime | 只建立可测试的最小基线 |
| Day 62-70 | 用本地 CLI 建立固定角色协同、事件投影、Context、Capability、Tool Loop、验证和受限 DAG | Day 62 两角色顺序协同；Day 67 增加 validator；Day 69 才允许最多两个 executor 并行 |
| Day 71-80 | 加入 1 个 MCP Server、Human Approval、可恢复等待、Memory/RAG 和 Eval | 只做项目搜索等受控工具，不做通用插件市场 |
| Day 81-90 | 将固定协同升级为受控动态委派、Trace/Replay、SLO 和故障恢复 | 仍然最多 3 个角色；先证明多 Agent 收益再保留 |

## 4. Local CLI Runtime 合同

本项目不直接调用模型 HTTP API。后端通过受控子进程适配本机已经登录的 CLI：

```text
codex_local  -> codex exec --json --ephemeral -C <workspace> -s <sandbox>
claude_local -> claude -p --output-format stream-json --no-session-persistence
```

两个 Adapter 必须归一化为统一事件合同：`started`、`message`、`tool_started`、`tool_completed`、`artifact`、`usage`、`failed`、`cancelled`。

`InvocationPlan` 至少包含 `runtime`、`role`、`taskContractId`、`workspacePath`、`permissionProfile`、`timeoutMs`、`maxOutputBytes` 和 `traceId`。命令模板由服务端维护，用户或模型不得提交原始可执行文件、参数或环境变量。

安全边界：

- coordinator 和 validator 默认只读；executor 只能写入分配的仓库或 worktree。
- 禁止 `--dangerously-bypass-approvals-and-sandbox`、`--dangerously-skip-permissions` 及等价绕过选项。
- 可执行文件路径、工作目录、工具、环境变量和并发数都使用 allowlist；密钥和无关用户环境不得进入子进程。
- 每个 Invocation 有首帧、idle、总时长和最大输出限制；取消时必须终止完整进程树，晚到输出不能写 Artifact。
- Day 62-68 顺序执行，避免共享工作区冲突；Day 69 后并行 executor 必须使用独立 git worktree 和 base hash。

## 5. 明确不做

- 不建设通用 Agent 平台、租户计费、插件市场或低代码编排器。
- 不拆微服务，不引入 Kubernetes，不做跨地域高可用。
- 不同时接入大量模型供应商；只保留 1 个真实 Provider Adapter 和可重复 Stub。
- 不追求任意 Agent 自主组队；角色最多 3 个，委派深度和预算必须受控。
- 不复制 `muti-agent-plat` 的代码、目录或复杂度，也不把该项目已有能力计入学习成果。

## 6. 毕业验收

- 新环境可通过 Docker Compose 启动前端、后端、PostgreSQL 和 Redis。
- 一次 Run 能从 Vue 创建，依次经过 coordinator、executor、validator，经 SSE 展示 Runtime/Tool/Approval 状态，最终生成可追踪 Artifact。
- Codex CLI 与 Claude Code CLI 均通过同一 Runtime 合同运行；取消、超时、非法工作目录和 CLI 缺失都有确定终态。
- 重复事件、断线、取消、进程重启和重复任务不会产生静默成功或重复副作用。
- MCP、Human、Memory/RAG、委派和验证均有权限、审计、测试与失败可见性。
- Eval、Trace、Replay、SLO、成本和 Runbook 能支撑最终答辩，但不虚构生产流量或线上经验。
