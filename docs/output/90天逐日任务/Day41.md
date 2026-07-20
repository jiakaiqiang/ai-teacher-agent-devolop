# Day 41 - Python 工程边界

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。

日期与时长：2026-08-23 周日，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日项目完整目录结构**（新建 `services/ai` 前先看清全景，再动手）
>
> ```
> p1-monitor/
> ├── apps/
> │   ├── api/                        # Day01-40 已建的 NestJS 主服务
> │   │   └── src/
> │   │       └── diagnosis/          # 今天新增：Node 侧调用 Python 的客户端
> │   │           ├── diagnosis.module.ts
> │   │           ├── diagnosis.service.ts       ← 核心：你手写（HTTP 客户端 + 超时 + 错误映射）
> │   │           ├── diagnosis.controller.ts    ← 核心：你手写（暴露给前端的路由）
> │   │           └── dto/
> │   │               ├── diagnose-request.dto.ts   ← 样板：请求契约
> │   │               └── diagnose-response.dto.ts  ← 样板：响应契约
> │   └── web/                        # Vue3 前端（今天不动）
> │
> ├── services/
> │   └── ai/                         # ★ 今天新建的 Python 诊断服务
> │       ├── pyproject.toml          ← 样板：项目配置（ruff + pytest + 依赖）
> │       ├── ruff.toml               ← 样板：lint 规则
> │       ├── README.md               ← 样板：服务说明
> │       ├── .python-version         ← 样板：Python 版本锁定
> │       ├── src/
> │       │   └── ai_service/
> │       │       ├── __init__.py
> │       │       ├── main.py                 ← 样板：FastAPI 应用入口
> │       │       ├── config.py               ← 样板：环境变量类型化配置
> │       │       ├── boundary/               # ★ Node/Python 边界层（今天的灵魂）
> │       │       │   ├── __init__.py
> │       │       │   ├── models.py           ← 核心：你手写（Pydantic 边界模型）
> │       │       │   ├── contract.py         ← 核心：你手写（契约版本 + 兼容读取）
> │       │       │   └── errors.py           ← 核心：你手写（跨服务错误码）
> │       │       ├── diagnosis/              # 诊断业务
> │       │       │   ├── __init__.py
> │       │       │   ├── router.py           ← 核心：你手写（async 路由 + 边界校验）
> │       │       │   ├── service.py          ← 核心：你手写（业务逻辑）
> │       │       │   └── pdf_parser.py       ← 核心：你手写（同步重任务 → 线程池）
> │       │       └── infra/
> │       │           ├── __init__.py
> │       │           ├── thread_pool.py      ← 核心：你手写（sync→async 桥接）
> │       │           └── health.py           ← 样板：健康检查
> │       └── tests/
> │           ├── __init__.py
> │           ├── conftest.py                 ← 样板：pytest fixture
> │           ├── test_boundary.py            ← 核心：你手写（契约测试）
> │           ├── test_diagnosis.py           ← 核心：你手写（业务测试）
> │           └── test_async_boundary.py      ← 核心：你手写（阻塞反证测试）
> │
> ├── docs/
> │   └── architecture/
> │       └── node-python-boundary.adr.md    ← 核心：你手写（边界决策记录）
> │
> └── docker-compose.yml              # 今天新增 services/ai 的编排条目
> ```

## §0 今天在 90 天里的位置

**坐标**：阶段二（AI 前端 -> AI 全栈）第 1 天。

**承前**：Day01-40 你用 NestJS 把后端从裸奔做到了生产级门禁——路由、状态机、权限、可观测、韧性、性能全部有据可查。但所有能力都压在 Node 单线程上。Day40 门禁里那个"event-loop lag 600ms 但 CPU 45%"的悖论，根因就是**把 CPU 密集型任务（PDF 解析、向量计算）塞进了 Node 事件循环**。

**启后**：从今天起，你要把重计算迁到 Python。这不是"学一门新语言"，而是**建立跨语言服务边界**——Node 当 BFF 管鉴权/限流/协议转换，Python 管重计算/AI 推理。这条边界是阶段三（Day41-60）所有 RAG、Agent 编排的地基。

**今天必须解决的 5 个问题**：

1. **async/sync 边界混乱**：把同步 PDF 解析直接写进 FastAPI 的 async 路由，一个慢请求阻塞整个事件循环，连健康检查都超时（对应情境题 1）。
2. **跨服务契约漂移**：Nest 的 DTO 加了字段，Python 端类型没跟上，运行期 KeyError（对应情境题 2）。
3. **无类型防护**：Python 动态类型，非法输入直到运行时才炸，且错误信息模糊。
4. **无工程门禁**：没有 ruff/mypy/pytest，代码质量靠自觉，PR 无法自动拦截问题。
5. **孤立 Demo 陷阱**：新建的 Python 服务不接入主链路，变成"学完就扔"的玩具（本日强制：Nest 当天必须真实调用成功）。

**知识链顺序**：`Python typing`（先有类型，才能谈契约）→ `边界模型`（Pydantic 把类型变成运行时校验）→ `asyncio`（理解事件循环，才知道什么能进 async）→ `pytest`（用测试锁住边界行为）→ `ruff`（用工具自动化门禁）。这个顺序是"从数据契约到运行时到测试到工程化"，每一层都为下一层提供保障。

---

## §1 今天要做的事

### 1.1 五个真实用户场景

今天的 `services/ai` 不是空壳，它要支撑这些真实链路：

1. **前端上传 PDF 报告 → 诊断**：用户在 p1-monitor 前端上传一份服务器诊断报告 PDF，Nest 接收后转发给 Python，Python 解析并返回结构化诊断结果。
2. **Nest 调用诊断接口**：Nest 的 `DiagnosisService` 通过 HTTP 调用 Python 的 `/diagnose`，带超时和错误映射（Python 挂了 Nest 要优雅降级）。
3. **高并发健康检查**：监控系统每秒探测 Python 的 `/health`，即使有慢诊断请求在跑，健康检查也必须秒回（这就是 async/sync 边界的意义）。
4. **契约演进**：Nest 侧 DTO 新增可空字段 `severity`，Python 端必须兼容读取旧版和新版请求，不能因为字段缺失就 KeyError。
5. **非法输入防护**：前端传了空 PDF 或超大文件，Python 边界层要在入口就拒绝，返回确定的错误码而非 500 堆栈。

### 1.2 模块职责划分

| 模块 | 职责 | 谁写 |
|------|------|------|
| `boundary/models.py` | Pydantic 边界模型，把跨服务 JSON 变成类型安全的对象 | 你手写 |
| `boundary/contract.py` | 契约版本管理 + 兼容读取（新旧字段共存） | 你手写 |
| `boundary/errors.py` | 跨服务统一错误码（Node 和 Python 约定同一套） | 你手写 |
| `diagnosis/router.py` | FastAPI async 路由，只做校验和编排，不做重计算 | 你手写 |
| `diagnosis/service.py` | 诊断业务逻辑 | 你手写 |
| `diagnosis/pdf_parser.py` | 同步 PDF 解析（CPU 密集），必须放线程池 | 你手写 |
| `infra/thread_pool.py` | sync→async 桥接（`run_in_executor`） | 你手写 |
| `apps/api/src/diagnosis/*` | Node 侧 HTTP 客户端 + 超时 + 错误映射 | 你手写 |
| `pyproject.toml` / `ruff.toml` | 工程配置 | 样板（可 AI 生成） |
| `main.py` / `config.py` / `health.py` | 应用骨架 | 样板（可 AI 生成） |

### 1.3 三版演进：从"能跑"到"边界清晰"

**v1（最小可用）**：FastAPI 起一个 `/diagnose`，同步解析 PDF 直接写进 async 路由。能返回结果，但——一个慢请求阻塞所有请求，无类型校验，无契约管理。这是情境题 1 的病根，故意让你先踩坑。

**v2（加边界层）**：引入 Pydantic 边界模型（类型安全的输入输出）+ 把同步 PDF 解析移到线程池（`run_in_executor`），async 路由不再被阻塞。加 pytest 锁住行为，加 ruff/mypy 门禁。

**v3（生产级）**：加契约版本管理（兼容新旧字段）+ 跨服务统一错误码 + Node 侧完整接入（超时/重试/错误映射）+ Node/Python 边界 ADR 文档。让整条 Node→Python 链路可验证、可演进、不会因契约漂移而运行期崩溃。

三版对比：

| 维度 | v1 | v2 | v3 |
|------|----|----|----|
| async/sync 边界 | ❌ 同步塞进 async | ✅ 重任务进线程池 | ✅ 线程池 + 并发限制 |
| 类型安全 | ❌ 裸 dict | ✅ Pydantic 模型 | ✅ Pydantic + 契约版本 |
| 契约演进 | ❌ 字段变就崩 | ⚠️ 有模型但不兼容旧版 | ✅ 版本管理 + 兼容读取 |
| 错误处理 | ❌ 500 堆栈 | ⚠️ 有校验错误 | ✅ 跨服务统一错误码 |
| 工程门禁 | ❌ 无 | ✅ ruff + pytest | ✅ ruff + mypy + pytest 全绿 |
| Node 接入 | ❌ 未接入 | ⚠️ 能调用 | ✅ 超时 + 重试 + 降级 |

**三个灵魂问题**（写代码前先想）：

1. 为什么 PDF 解析不能直接写进 async 路由？事件循环单线程，同步阻塞调用会卡住所有协程——包括健康检查。这和 Node 的 event-loop 是同一个道理，只是换了语言。
2. Pydantic 模型和 TypeScript 的 DTO 有什么区别？DTO 只在编译期检查，运行时是裸 JS 对象；Pydantic 在运行时校验，非法数据在入口就被拒绝。跨服务边界必须用运行时校验。
3. 为什么契约要版本管理？Node 和 Python 是两个独立部署的服务，不可能同时升级。总有一段时间新旧版本共存，边界必须容忍这种不一致。

### 1.4 目录结构（5 个维度完整展示）

今天新建 `services/ai`，目录结构见文件头部。这里补充 5 个设计维度的说明：

**维度 1：为什么 `boundary/` 独立成层？**

跨服务边界是最容易出问题的地方（情境题 2 就是边界漂移）。把它独立成层，所有跨服务的类型、契约、错误码集中管理，改契约时只改一个地方。这和 Day02 你把"合同"独立成 DTO 层是同一个思想。

**维度 2：为什么 `pdf_parser.py` 和 `service.py` 分开？**

`pdf_parser.py` 是同步的 CPU 密集任务，`service.py` 是 async 的编排逻辑。分开是为了让"什么是阻塞的、什么是非阻塞的"一目了然。混在一起你就分不清哪行代码会卡事件循环。

**维度 3：为什么 `thread_pool.py` 在 `infra/`？**

sync→async 桥接是基础设施，不是业务。业务代码只管调用 `await run_in_thread(parse_pdf, file)`，不用关心线程池怎么管理。这是关注点分离。

**维度 4：Node 侧的 `diagnosis/` 和 Python 侧对称吗？**

对称。Node 侧有 `dto/`（契约），Python 侧有 `boundary/models.py`（契约）。两边的契约必须一致，这就是"合同"的双向约束。差异点：Node 侧多了 HTTP 客户端逻辑（超时、重试），Python 侧多了线程池逻辑。

**维度 5：为什么 ADR 文档要写？**

Node/Python 边界是一个重大架构决策（为什么用 Python 不用 Node worker？为什么用 HTTP 不用 gRPC？）。ADR（Architecture Decision Record）记录"为什么这么选"，半年后你或队友回来看，不用重新推理。

**依赖方向**（谁依赖谁）：

```
前端 Vue → Nest DiagnosisController → Nest DiagnosisService
  → [HTTP] → Python router.py → service.py
    → pdf_parser.py（通过 thread_pool 桥接）
  ↑ 两侧都依赖 boundary（契约）
```

**与昨天的 diff**：

| 文件 | 状态 | 说明 |
|------|------|------|
| `services/ai/**` | 🆕 全新 | 今天新建的 Python 服务 |
| `apps/api/src/diagnosis/**` | 🆕 全新 | Node 侧调用客户端 |
| `docker-compose.yml` | ✏️ 修改 | 新增 Python 服务编排 |
| `docs/architecture/node-python-boundary.adr.md` | 🆕 全新 | 边界决策记录 |

### 1.5 今天动手前的脚手架检查

在写业务逻辑前，先把 Python 工程骨架搭好。以下是**样板代码，可以直接用**：

```bash
# 1. 创建 services/ai 目录并初始化
cd D:/demo/ai-techer/p1-monitor
mkdir -p services/ai/src/ai_service tests
cd services/ai

# 2. 锁定 Python 版本（用 3.12）
echo "3.12" > .python-version

# 3. 用 uv 或 pip 创建虚拟环境
python -m venv .venv
source .venv/Scripts/activate  # Windows Git Bash

# 4. 安装依赖
pip install fastapi uvicorn pydantic pytest pytest-asyncio httpx ruff mypy pypdf
```

**`pyproject.toml`（样板）**：

```toml
[project]
name = "ai-service"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.109",
    "uvicorn>=0.27",
    "pydantic>=2.5",
    "pypdf>=4.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "httpx>=0.26", "ruff>=0.2", "mypy>=1.8"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.mypy]
strict = true
python_version = "3.12"
```

**`ruff.toml`（样板）**：

```toml
line-length = 100
target-version = "py312"

[lint]
select = ["E", "F", "I", "N", "UP", "B", "ASYNC"]
# ASYNC 规则会检测 async 函数里的阻塞调用——正好帮你抓今天的 bug
```

> ✅ 上面这些是样板代码，可以直接使用。建议：快速浏览一遍确保格式正确，重点看 `ruff.toml` 里的 `ASYNC` 规则——它会自动帮你抓 async 里的阻塞调用。

**脚手架自检清单**：

- [ ] `ruff check .` 能跑（哪怕报 0 错误）
- [ ] `mypy src/` 能跑
- [ ] `pytest` 能跑（哪怕 0 测试）
- [ ] `uvicorn ai_service.main:app --reload` 能起服务
- [ ] `curl localhost:8000/health` 返回 200

---

## §2 今天的开发节奏（6 小时怎么分配）

今天是 6h 扩展日（阶段二 Python 工程边界），按 90 分钟阅读 + 270 分钟项目深化执行：

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理与源码 | 90 min | asyncio 事件循环原理、Pydantic 校验机制、run_in_executor 源码与三版痛点 |
| 真实项目增量 | 180 min | v1 暴露阻塞 → v2 边界层+线程池 → v3 契约+Node 接入 |
| 测试/故障注入 | 60 min | 阻塞反证实验 + 契约漂移测试 + 高并发健康检查验证 |
| 架构证据/复盘 | 30 min | 边界 ADR + 依赖图 + AI Review 记录 |

**关键节奏提醒**：v1 只花 40 分钟——目的是快速踩坑（看到阻塞现象），不要在 v1 上打磨。真正的功夫在 v2 的边界层和线程池。

---

## §3 v1：同步塞进 async 路由（最小可用，故意踩坑）

v1 的目标是**快速跑通 + 暴露问题**。我们故意把同步 PDF 解析直接写进 async 路由，重现情境题 1 的病根。

### 3.1 v1 代码（能跑但有致命问题）

```python
# src/ai_service/main.py（v1 版本）
from fastapi import FastAPI
from pypdf import PdfReader
import io

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/diagnose")
async def diagnose(pdf_bytes: bytes):
    # ❌ 致命问题：同步 PDF 解析直接写进 async 路由
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text()  # 同步阻塞调用，卡住事件循环
    # ❌ 裸 dict，无类型校验
    return {"pageCount": len(reader.pages), "textLength": len(text)}
```

### 3.2 v1 的 5 个致命问题

1. **阻塞事件循环**：`page.extract_text()` 是同步 CPU 密集调用。在 async 路由里直接调用，会卡住整个事件循环。一个大 PDF 在解析时，所有其他请求（包括 `/health`）都得排队等待。
2. **无类型校验**：`pdf_bytes: bytes` 直接收原始字节，没有大小限制、没有格式校验。空文件、超大文件、非 PDF 都会进到解析逻辑才炸。
3. **裸 dict 返回**：返回 `{"pageCount": ..., "textLength": ...}` 是裸 dict，没有契约。Node 侧不知道字段名会不会变，也没有类型保证。
4. **无错误处理**：PDF 损坏时 `PdfReader` 抛异常，直接变成 500 堆栈返回给 Node，泄漏内部信息（违反 Day36 的错误脱敏原则）。
5. **无契约版本**：Node 传什么、Python 返回什么，全靠口头约定。字段一变就运行期崩溃。

### 3.3 v1 的反证实验（先看到病）

```bash
# 起 v1 服务
uvicorn ai_service.main:app --port 8000

# 终端 A：发一个大 PDF 诊断请求（模拟慢任务）
curl -X POST localhost:8000/diagnose --data-binary @large-report.pdf &

# 终端 B：立即狂发健康检查
for i in {1..20}; do
  time curl -s localhost:8000/health
done
```

**现象**：大 PDF 解析期间，`/health` 请求全部被阻塞，响应时间从 5ms 飙到几秒。这就是情境题 1 描述的"所有 health 请求也超时"。

**证据留存**：截图 `/health` 在有慢请求和无慢请求时的响应时间对比。这是 v2 优化的基线。

**结论**：async 路由里的同步阻塞调用是灾难。v2 必须把重任务移出事件循环。

## §4 v2：边界模型 + 线程池桥接（加工程层）

v2 解决 v1 的前两个致命问题：**阻塞事件循环**和**无类型校验**。这两块里，Pydantic 边界模型是样板（可生成），但 async/sync 边界的桥接决策是核心工程判断，我给结构和原理，桥接调用你要理解透。

### 4.1 v2 的目录增量

```
services/ai/src/ai_service/
├── boundary/
│   ├── models.py           ← 样板：Pydantic 契约模型（可生成）
│   └── errors.py           ← 样板：错误码定义
├── infra/
│   └── thread_pool.py      ← 核心：你手写（sync→async 桥接）
├── core/
│   ├── pdf_parser.py       ← 样板：同步 PDF 解析（可生成）
│   └── service.py          ← 核心：你手写（async 编排 + 边界调度）
└── main.py                 ← 修改：接入边界模型和线程池
```

### 4.2 边界模型：跨服务契约（样板，可生成）

**知识点 1：Pydantic 边界模型**

- **解决什么问题**：Node 传来的 JSON 必须在进入业务逻辑前完成校验。缺字段、类型错、超范围，都应该在边界层被 422 拦截，而不是深入业务后 KeyError。
- **运行机制**：Pydantic v2 用 Rust 核心做校验。定义 `class DiagnoseRequest(BaseModel)` 后，FastAPI 自动在路由入口校验请求体，不合法直接返回 422 带明确错误。
- **项目落点**：`boundary/models.py`，定义 Node↔Python 之间所有的请求/响应模型。
- **生产误区**：用 `dict` 或 `Any` 图方便——等于没有契约，运行期才炸。必须用严格类型。
- **验证方法**：发缺字段、类型错的请求，确认返回 422 而不是 500。

```python
# src/ai_service/boundary/models.py（样板，可直接用）
from pydantic import BaseModel, Field
from enum import Enum

class DiagnoseStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"

class DiagnoseRequest(BaseModel):
    """Node → Python 的诊断请求契约"""
    run_id: str = Field(..., min_length=1, description="关联的 run ID")
    pdf_base64: str = Field(..., description="Base64 编码的 PDF")
    max_pages: int = Field(default=50, ge=1, le=200, description="最大解析页数")
    # 可空字段必须显式声明默认值（防止情境题 2 的契约漂移）
    locale: str | None = Field(default="zh-CN")

class DiagnoseResponse(BaseModel):
    """Python → Node 的诊断响应契约"""
    run_id: str
    status: DiagnoseStatus
    page_count: int
    text_length: int
    # 契约版本号：改契约时递增，两侧对齐
    contract_version: str = "1.0"
```

> ✅ 这是样板代码，可以直接使用。重点理解 `locale: str | None = Field(default="zh-CN")` 这一行——这是防契约漂移的关键：新增可空字段必须给默认值，旧版 Node 不传也能工作。

### 4.3 线程池桥接：把阻塞移出事件循环（核心，你手写）

**知识点 2：run_in_executor 的 sync→async 桥接**

- **解决什么问题**：PDF 解析是同步 CPU 密集任务，不能直接在 async 路由调用（会卡事件循环）。需要把它丢到线程池执行，让事件循环在等待期间处理其他请求。
- **运行机制**：`loop.run_in_executor(pool, sync_func, *args)` 把同步函数丢到线程池，返回一个 awaitable。await 它时，事件循环不阻塞，可以处理其他协程。
- **项目落点**：`infra/thread_pool.py`，提供 `run_in_thread(func, *args)` 工具函数，业务代码用它包裹所有同步阻塞调用。
- **生产误区**：
  1. 每次请求都新建线程池 → 线程爆炸。要用全局单例线程池。
  2. 以为所有 IO 都要丢线程池 → 异步 IO（httpx、asyncpg）本身不阻塞，不需要。只有**同步阻塞**调用才需要。
  3. 线程池大小设太大 → CPU 密集任务开太多线程反而因 GIL 争抢变慢。CPU 密集型线程池大小 ≈ CPU 核数。
- **验证方法**：v1 的反证实验重跑——大 PDF 解析期间，`/health` 应该秒回。

**为什么是核心逻辑，需要你手写**：线程池的大小、生命周期、GIL 的影响，这些是 Python 后端工程师面试必问的。你要理解"为什么 CPU 密集型线程池不能设太大"（GIL），"为什么 IO 密集型可以设大"（IO 等待时释放 GIL）。这个判断复制代码学不会。

**ThreadPool 桥接你要实现的核心逻辑（伪代码）：**

```
# infra/thread_pool.py
全局单例:
  _executor = ThreadPoolExecutor(max_workers = CPU核数)
  # CPU 密集型：max_workers ≈ os.cpu_count()
  # 如果是 IO 密集型才设大（但本项目 PDF 解析是 CPU 密集）

async def run_in_thread(func, *args):
    loop = asyncio.get_running_loop()
    # 关键：把同步 func 丢到线程池，await 时不阻塞事件循环
    return await loop.run_in_executor(_executor, func, *args)

应用关闭时:
    _executor.shutdown(wait=True)  # 等待在途任务完成
```

### 4.4 async 编排层（核心，你手写）

**知识点 3：async 服务编排**

- **解决什么问题**：把"接收请求 → 解码 → 调用线程池解析 → 组装响应"的流程编排起来，明确哪一步是 async（不阻塞）、哪一步走线程池（阻塞）。
- **运行机制**：service 层是 async 函数，内部对阻塞调用用 `await run_in_thread(...)`，对异步 IO 直接 `await`。
- **项目落点**：`core/service.py`。
- **生产误区**：在 async 函数里忘记 await 直接调用同步函数——静默阻塞，最难查。ruff 的 ASYNC 规则能帮你抓。
- **验证方法**：并发压测，事件循环 lag 稳定。

**DiagnoseService 你要实现的核心逻辑（伪代码）：**

```
# core/service.py
async def diagnose(request: DiagnoseRequest) -> DiagnoseResponse:
    # 1. 解码 base64（快，不阻塞）
    pdf_bytes = base64.b64decode(request.pdf_base64)

    # 2. PDF 解析（慢，CPU 密集）→ 必须走线程池
    try:
        result = await run_in_thread(parse_pdf, pdf_bytes, request.max_pages)
        status = SUCCESS
    except PdfParseError:
        # 3. 错误处理：不泄漏堆栈（Day36 原则）
        return DiagnoseResponse(run_id=request.run_id, status=FAILED, ...)

    # 4. 组装契约响应
    return DiagnoseResponse(
        run_id=request.run_id,
        status=status,
        page_count=result.page_count,
        text_length=len(result.text),
    )
```

### 4.5 v2 完整验证

```bash
# 起 v2 服务
uvicorn ai_service.main:app --port 8000

# 重跑 v1 的反证实验
curl -X POST localhost:8000/diagnose -d '{"run_id":"r1","pdf_base64":"...","max_pages":50}' &
for i in {1..20}; do time curl -s localhost:8000/health; done
# 期望：/health 全部秒回（不再被阻塞）

# 契约校验测试
curl -X POST localhost:8000/diagnose -d '{"run_id":""}'
# 期望：422，明确指出 run_id 太短、pdf_base64 缺失
```

**证据留存**：对比 v1/v2 的 `/health` 响应时间。v2 应该在慢请求期间保持稳定。

## §5 v3：合同测试 + 全局异常 + Node 实际接入（生产级）

v3 是今天的灵魂，解决 v1 的后三个致命问题：**契约漂移**、**异常泄漏堆栈**、**Node 无法调用**。契约测试和跨服务边界一致性是核心工程判断，我给结构和验收标准，测试用例和边界处理你要手写。

### 5.1 v3 的目录增量

```
services/ai/src/ai_service/
├── boundary/
│   ├── exception_handler.py  ← 核心：你手写（全局异常 → 安全响应）
│   └── contract_version.py   ← 样板：契约版本常量
├── main.py                   ← 修改：注册全局异常处理
└── tests/
    ├── test_contract.py      ← 核心：你手写（契约测试）
    ├── test_boundary.py      ← 核心：你手写（边界输入测试）
    └── conftest.py           ← 样板：pytest fixture

apps/api/src/diagnose/         ← Node 侧（修改）
├── diagnose.client.ts        ← 核心：你手写（调用 Python 服务）
└── diagnose.dto.ts           ← 样板：与 Python 契约对齐的 DTO
```

### 5.2 契约测试：防止跨服务漂移

**知识点 1：契约测试（Contract Testing）**

- **解决什么问题**：情境题 2 的核心——Node 加了字段但 Python 没同步，2% 请求 KeyError。契约测试在 CI 阶段就抓住这种不一致，而不是等到线上。
- **运行机制**：双方共享一份契约定义（字段、类型、可空性）。Python 侧写测试断言"给定合法/非法/旧版本输入，响应符合契约"。任何一方改契约不同步，测试就红。
- **项目落点**：`tests/test_contract.py`，覆盖三类输入：合法、非法、旧版本（缺新字段）。
- **生产误区**：只测 happy path——契约测试的价值恰恰在边界（缺字段、多字段、类型错、旧版本）。
- **验证方法**：故意让 Python 契约与 Node DTO 不一致，确认测试失败。

**为什么是核心逻辑，需要你手写**：契约测试的用例设计（该测哪些边界组合）是工程判断的体现。面试官问"你怎么保证微服务间的兼容性"，你要能说出"合法/非法/向前兼容/向后兼容"四类测试。

**test_contract.py 你要实现的核心逻辑（伪代码）：**

```
# tests/test_contract.py
def test_合法请求返回契约响应():
    req = DiagnoseRequest(run_id="r1", pdf_base64=VALID_PDF)
    resp = client.post("/diagnose", json=req.model_dump())
    assert resp.status_code == 200
    # 响应必须符合契约结构
    DiagnoseResponse.model_validate(resp.json())  # 不抛异常即通过

def test_缺必填字段返回422():
    resp = client.post("/diagnose", json={"run_id": "r1"})  # 缺 pdf_base64
    assert resp.status_code == 422

def test_旧版本请求向前兼容():
    # 模拟旧 Node 不传 locale（可空字段）
    resp = client.post("/diagnose", json={"run_id":"r1","pdf_base64":VALID_PDF})
    assert resp.status_code == 200  # 必须兼容，不能 KeyError

def test_类型错误返回422():
    resp = client.post("/diagnose", json={"run_id":"r1","max_pages":"abc"})
    assert resp.status_code == 422
```

### 5.3 全局异常处理：不泄漏堆栈

**知识点 2：FastAPI 全局异常处理器**

- **解决什么问题**：未捕获异常默认返回 500 带完整堆栈，暴露文件路径、依赖版本（Day36 的错误脱敏原则在 Python 侧的落地）。
- **运行机制**：`@app.exception_handler(Exception)` 注册全局处理器，捕获所有未处理异常，对外只返回 `{code, message, trace_id}`，堆栈只写日志。
- **项目落点**：`boundary/exception_handler.py`。
- **生产误区**：只处理了自定义异常，`ValueError`/`KeyError` 这类系统异常还是漏堆栈。必须兜底 `Exception`。
- **验证方法**：触发未捕获异常，确认响应不含 traceback、文件路径。

**exception_handler.py 你要实现的核心逻辑（伪代码）：**

```
# boundary/exception_handler.py
@app.exception_handler(Exception)
async def global_handler(request, exc):
    trace_id = request.headers.get("x-trace-id", "unknown")  # 关联 Day35
    # 服务端：记录完整堆栈
    logger.error(f"trace_id={trace_id}", exc_info=exc)
    # 对外：只返回安全结构
    return JSONResponse(
        status_code=500,
        content={"code": "INTERNAL_ERROR", "message": "服务内部错误", "trace_id": trace_id}
    )
```

### 5.4 Node 实际接入（今日通过标准的硬指标）

**知识点 3：跨服务调用与 Trace 透传**

- **解决什么问题**：今天的通过标准明确要求"Nest 实际调用成功"。不能是孤立的 Python Demo，必须进入真实用户链路。
- **运行机制**：Node 侧用 httpx/fetch 调用 Python 服务，透传 traceId（Day35 的链路延续到 Python）。
- **项目落点**：`apps/api/src/diagnose/diagnose.client.ts`（Node 侧，你手写）。
- **生产误区**：Node 和 Python 的 DTO 各写各的、不对齐——这就是契约漂移的根源。要以 Python 的 Pydantic 契约为准，Node DTO 对齐它。
- **验证方法**：从 Node 发起真实诊断请求，确认 Python 返回、traceId 贯穿两个服务。

**DiagnoseClient 你要实现的核心逻辑（伪代码）：**

```
# apps/api/src/diagnose/diagnose.client.ts（Node 侧）
async diagnose(runId, pdfBase64, traceId):
    response = await fetch(`${PYTHON_SERVICE_URL}/diagnose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trace-id': traceId,   # 透传 Trace（Day35）
      },
      body: JSON.stringify({ run_id: runId, pdf_base64: pdfBase64 }),
    })
    if (!response.ok):
        throw new DiagnoseServiceError(...)  # 分类错误（Day34）
    return await response.json()
```

> ⚠️ **安全提醒**：Node↔Python 之间若走内网 HTTP，确保：(1) Python 服务不暴露公网；(2) 若传敏感数据（如含 PII 的 PDF），考虑内网加密或脱敏；(3) `PYTHON_SERVICE_URL` 等配置走环境变量，不硬编码。

### 5.5 ruff 严格模式 + 类型检查

**知识点 4：ruff + mypy/pyright 静态门禁**

- **解决什么问题**：Python 是动态语言，类型错误运行期才暴露。静态检查在提交前就抓住。
- **运行机制**：ruff 做 lint（含 ASYNC 规则，抓 async 里的同步阻塞调用）；mypy/pyright 做类型检查。
- **项目落点**：`pyproject.toml` 配置 ruff 规则集，CI 跑 `ruff check` + `mypy`。
- **生产误区**：ruff 规则开太松（只开 E/F）——错过 ASYNC、B（bugbear）等关键规则。今天要开 ASYNC 规则抓阻塞。
- **验证方法**：`ruff check . && mypy src/` 全绿。

```bash
# v3 完整验证（今日通过标准）
cd services/ai
ruff check .            # 期望：全绿（含 ASYNC 规则）
mypy src/               # 期望：无类型错误
pytest -v               # 期望：契约测试 + 边界测试全绿

# Node 实际调用（硬指标）
cd apps/api
pnpm test:e2e diagnose  # 期望：Node → Python 调用成功，traceId 贯穿
```

**证据留存**：三个命令全绿的输出 + Node e2e 调用成功的 traceId 链路截图。

## §6 前端底子深挖：多服务架构下的前端认知

今天新增了 Python 服务，前端看似不变，但一个全栈工程师必须理解"请求为什么变慢""诊断为什么失败"背后的多服务拓扑。今天前端底子深挖的是：**跨服务调用如何影响前端的加载状态设计**。

### 6.1 前端不该知道后端拓扑，但要为它设计状态

**深挖点 1：诊断是慢操作，前端必须异步化**

- Python 诊断服务解析 PDF、跑分析，是秒级甚至十秒级操作。前端不能同步等。
- **运行机制**：前端发起诊断 → 立即拿到 `runId` → 轮询或 WebSocket 订阅结果（Day35 的 Trace 让你能追这个 run）。
- **项目落点**：诊断按钮点击后进入 `pending` 状态，展示进度而非转圈。
- **生产误区**：前端同步 `await diagnose()` 卡 14 秒（正是情境题 1 的现象在前端的表现），用户以为卡死。
- **验证方法**：并发发起多个诊断，确认前端 UI 不阻塞、各自独立展示状态。

**深挖点 2：多服务的失败要区分展示**

- 诊断失败可能是：Node BFF 挂了、Python 服务挂了、Python 内部解析失败。前端要给用户不同的反馈。
- **运行机制**：Node 把 Python 的错误分类（Day34 的错误分类）透传给前端，前端按类型展示"服务暂时不可用（可重试）"vs"文档格式不支持（不可重试）"。
- **生产误区**：所有错误都显示"系统错误"，用户不知道该重试还是换文档。

### 6.2 加载状态的三态设计

**深挖点 3：pending / success / error 的完整状态机**

```typescript
// apps/web/src/composables/useDiagnose.ts（结构示意，你手写）
type DiagnoseState =
  | { status: 'idle' }
  | { status: 'pending'; runId: string; startedAt: number }
  | { status: 'success'; result: DiagnoseResult }
  | { status: 'error'; retryable: boolean; message: string }
```

- **为什么重要**：这个状态机直接对应后端的 run 生命周期。前端状态是后端状态的镜像，理解了后端才能设计对的前端状态。
- **验证方法**：模拟 Python 服务超时，确认前端进入 `error` 且 `retryable=true`，展示重试按钮。

### 6.3 前端认知小结

| 后端事实 | 前端设计后果 |
|---------|-------------|
| Python 诊断是慢操作 | 异步化 + 进度展示 |
| 跨服务调用可能部分失败 | 错误分类展示 |
| Trace 贯穿 Node/Python | 前端展示 traceId 供报障 |
| 契约可能演进 | 前端容错处理可空字段 |

## §7 测试与验证：Python 工程测试四件套

Python 服务的测试标准和 Node 一样严格：类型、契约、边界、异步都要覆盖。

### 7.1 单元测试：边界模型

```python
# tests/test_boundary.py
import pytest
from ai_service.models import DiagnoseRequest
from pydantic import ValidationError

def test_合法请求通过校验():
    req = DiagnoseRequest(run_id="r1", pdf_base64="dGVzdA==")
    assert req.run_id == "r1"

def test_缺必填字段抛校验错误():
    with pytest.raises(ValidationError):
        DiagnoseRequest(run_id="r1")  # 缺 pdf_base64

def test_可空字段默认值():
    req = DiagnoseRequest(run_id="r1", pdf_base64="dGVzdA==")
    assert req.locale is None  # 可空字段向前兼容
```

### 7.2 集成测试：async 边界不阻塞

```python
# tests/test_async_boundary.py
import asyncio
import time

async def test_重任务不阻塞健康检查():
    # 同时发起：1 个慢诊断 + 10 个健康检查
    async def health(): 
        return await client.get("/health")
    
    diagnose_task = asyncio.create_task(client.post("/diagnose", json=HEAVY_PDF))
    start = time.monotonic()
    health_results = await asyncio.gather(*[health() for _ in range(10)])
    health_elapsed = time.monotonic() - start
    
    # 健康检查必须秒回，不被诊断阻塞
    assert health_elapsed < 1.0, f"健康检查被阻塞 {health_elapsed}s"
    assert all(r.status_code == 200 for r in health_results)
    await diagnose_task
```

### 7.3 反证实验（两个）

**反证 1：把同步 PDF 解析放进 async 路由会怎样？**

- 操作：在 `async def diagnose` 里直接调用同步的 `parse_pdf()`（不走线程池）。
- 现象：20 并发时 P99 从 900ms 升到 14s，健康检查也超时（正是情境题 1）。
- 证据：event-loop lag 指标飙升，所有请求排队。
- 结论：async 路由里的同步阻塞会卡死整个事件循环。重任务必须 `run_in_executor` 或移到 worker。

**反证 2：移除契约测试，Node 加字段会怎样？**

- 操作：删掉 `test_contract.py`，Node DTO 加一个 Python 没有的必填字段。
- 现象：CI 全绿，但线上 2% 请求 KeyError（正是情境题 2）。
- 证据：Python 异常日志出现 KeyError，跨服务 Trace 显示 Node 传了 Python 不认的字段。
- 结论：契约测试是跨服务兼容性的唯一自动化防线。

### 7.4 架构证据四件套

1. **依赖图**：
   ```
   前端 → Node BFF → (HTTP + traceId) → Python FastAPI
                                          → 线程池（重任务）
                                          → 全局异常处理
   ```
2. **时序图**：一个诊断请求从前端 → Node → Python → 线程池解析 → 返回的完整链路，标注 traceId 透传点。
3. **Node/Python 边界 ADR**：为什么把诊断放 Python（PDF/AI 生态）而非 Node，边界如何划分，契约如何维护。
4. **测试全绿证据**：ruff + mypy + pytest 三命令输出 + Node e2e 调用成功截图。

## §8 通关检查清单（v3 规范 11 项）

- [ ] §0 本日在 90 天路线图的坐标已说明（阶段二第 1 天，承接 Day40 门禁，启 Python + 多语言架构）
- [ ] §1 五个用户场景 + 模块职责 + 三版演进 + 完整目录结构 + 脚手架检查齐全
- [ ] §2 6 小时开发节奏已列出（原理 60 / v1 40 / v2 90 / v3 80 / 测试 60 / 架构证据 30）
- [ ] §3 v1 暴露阻塞问题：同步 PDF 解析直接写进 async 路由，健康检查被阻塞
- [ ] §4 v2 边界模型 + 线程池：Pydantic 边界 + run_in_executor 移出阻塞
- [ ] §5 v3 契约测试 + 全局异常 + Node 接入：防契约漂移 + 异常脱敏 + 实际调用成功
- [ ] §6 前端底子深挖（多服务架构下的加载状态设计 + 三态状态机）
- [ ] §7 测试四件套（边界模型单元测试 + async 不阻塞集成测试 + 2 个反证实验 + 架构证据）
- [ ] §8 本清单
- [ ] §9 增量到下一站的伏笔
- [ ] §10-14 收尾章节 + 原文情境题/PDF 映射/五连问原样保留

## §9 从今天的增量到下一站

今天你建立了 Node/Python 跨服务边界——不只是"起了个 Python 服务"，而是建立了一套**边界契约 + 类型安全 + 异步正确性 + 测试保障**的完整工程体系。这条边界是阶段三所有 AI 能力的地基。

**今天建立的能力地基**：

1. **Python 工程模板**：typing + asyncio + pytest + ruff 全套工程化，Day42-60 的所有 Python 模块（RAG、向量检索、Embedding）都复用这套模板。
2. **Node/Python 边界契约**：Pydantic + DTO 双向对齐，Day42 的"向量检索服务"会沿用这套契约管理机制（新增字段兼容旧版）。
3. **async/sync 桥接模式**：run_in_executor 把阻塞移出事件循环，Day43 的"Embedding 生成"（CPU 密集）会用同一套桥接。
4. **跨服务 Trace 透传**：Day35 的 traceId 今天延续到 Python，Day42-45 的多服务调用链（Node → Python 诊断 → Python 向量检索）都沿用这条链路。

**今天留下的 3 个待优化点**：

1. **Python 侧无限流保护**：v3 只在 Node 侧做了限流（RateLimitGuard），Python 侧没有并发限制。如果 Node 侧被绕过（直接调 Python），Python 会被打爆。Day42 会补充 Python 侧的并发限流（starlette-context + semaphore）。
2. **契约版本号未强制校验**：v3 的 `contract_version: "1.0"` 只是字段，Node 侧没有校验（发现版本不匹配时不会拒绝）。Day43 会补充版本校验（不兼容版本返回 426 Upgrade Required）。
3. **线程池大小未动态调整**：v3 的线程池大小固定为 `os.cpu_count()`，无法根据负载动态调整。Day44 会补充自适应线程池（监控队列积压，动态扩缩容）。

**下一站要解决的核心问题**：

**Day42：向量检索服务（Embedding + Pinecone + Hybrid Search）**

核心挑战：
- Python 服务如何生成 Embedding（OpenAI API）而不阻塞事件循环？复用 Day41 的 run_in_executor。
- 向量检索失败（Pinecone 超时）如何分类重试？复用 Day34 的错误分类。
- Node 和 Python 之间如何传递向量查询结果（可能几百 KB）？用流式响应（Server-Sent Events）分块传输。

---

## §10 本日小结

**标题党 30 字**：Python 工程边界不只是起服务，而是 typing 防类型错、Pydantic 防契约漂移、run_in_executor 防阻塞、ruff 防工程腐化，加 Node 实际接入成真实链路。

**三句话**：
1. async/sync 边界混乱是 Python 后端最常见的坑——同步 PDF 解析直接写进 async 路由会卡住整个事件循环，健康检查都超时，正确做法是 run_in_executor 把阻塞移到线程池，线程池大小 ≈ CPU 核数（CPU 密集型）或更大（IO 密集型）。
2. 跨服务契约漂移是微服务最常见的故障——Node 加字段但 Python 没同步导致 2% 请求 KeyError，正确做法是契约测试覆盖合法/非法/旧版本三类输入，可空字段必须给默认值，Pydantic 在运行时校验而非编译期。
3. Python 工程门禁是 ruff + mypy + pytest 三件套——ruff 的 ASYNC 规则自动抓 async 里的阻塞调用，mypy 静态检查类型错误，pytest 的 asyncio_mode="auto" 让异步测试无缝运行，今天的通过标准是三命令全绿 + Node e2e 调用成功。

## §11 课后三道核心问题（必答，先于教师五连问）

1. 请从今天项目的真实入口到最终输出，解释"Python 工程边界"的数据流或控制流；当天知识链"Python typing、asyncio、pytest、ruff、边界模型"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

## §12 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：FastAPI 的 diagnose 接口把同步 PDF 解析直接写进 async 路由，20 并发时 P99 从 900 ms 升到 14 s，所有 health 请求也超时。请用 event-loop lag、线程池和请求 Trace 定位阻塞，先限并发并旁路重任务，再修复 async/sync 边界或移入 worker，验证 100 并发下健康检查不受影响。
   依据：[FastAPI Async](https://fastapi.tiangolo.com/async/)
2. 模拟情境：Nest 发送的诊断 DTO 新增可空字段，Python 端未更新类型，2% 请求在运行期 KeyError。请从合同版本、异常日志和跨服务 Trace 定位，先回滚或兼容读取，再补 typing、边界模型与合同测试，验证非法、缺失和旧版本输入均有确定响应。
   依据：[S5 AI 全栈](https://jobs.bytedance.com/experienced/position/7647767015784335669/detail)
知识映射：对应 Python typing、asyncio、测试与 Node/Python 边界。

## §13 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

## §14 PDF 面试题映射

1. Node.js 作为 BFF 处理鉴权、限流、协议转换，并把重计算交给 Python 或 Go，如何划分边界？  
   来源：[《2026淘宝前端开发_AI全栈开发》](<../../资源/2026淘宝前端开发_AI全栈开发.pdf>)，第 14 页。
2. Node.js 如何利用事件循环、非阻塞 I/O 和多进程处理高并发？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 8 页。
题目说明：近似题/资源缺口：资料没有 Python typing、asyncio、pytest、ruff 的直接题，只能用于对比 Node/Python 边界与异步模型。
