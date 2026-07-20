# Day 42 - FastAPI 核心机制

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **跨 Day 导航修正**：后续真实顺序：Day43 模型网关，Day44 结构化输出，Day45 Prompt 版本，Day46 RAG 摄取，Day47 向量检索。

日期与时长：2026-08-24 周一，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日项目完整目录结构**（在 Day41 的 `services/ai` 基础上补充 FastAPI 核心机制）
>
> ```
> services/ai/src/ai_service/
> ├── main.py                       # 修改：注册中间件、异常处理、依赖
> ├── dependencies/                 # ★ 今天新增：依赖注入层
> │   ├── __init__.py
> │   ├── trace.py                  ← 核心：你手写（Trace 透传依赖）
> │   ├── auth.py                   ← 样板：鉴权依赖（内部服务，简化版）
> │   └── rate_limit.py             ← 核心：你手写（请求限流依赖）
> ├── middleware/                   # ★ 今天新增：中间件层
> │   ├── __init__.py
> │   ├── trace_middleware.py       ← 核心：你手写（注入 traceId）
> │   ├── timeout_middleware.py     ← 核心：你手写（请求超时）
> │   └── logging_middleware.py     ← 样板：请求日志
> ├── exceptions/                   # ★ 今天新增：异常处理层
> │   ├── __init__.py
> │   ├── handlers.py               ← 核心：你手写（全局异常处理器）
> │   └── custom_errors.py          ← 样板：业务异常定义
> ├── api/                          # ★ 今天新增：路由层（Day41 的 diagnosis/ 重组织）
> │   ├── __init__.py
> │   ├── health.py                 ← 样板：健康检查
> │   ├── diagnose.py               ← 修改：接入依赖注入
> │   └── embed.py                  ← 核心：你手写（新增 Embedding 接口）
> ├── schemas/                      # Day41 的 boundary/models.py 改名
> │   ├── __init__.py
> │   ├── diagnose.py               ← 已有（Day41）
> │   └── embed.py                  ← 核心：你手写（Embedding 请求/响应契约）
> └── tests/
>     ├── test_middleware.py        ← 核心：你手写（中间件测试）
>     ├── test_dependencies.py      ← 核心：你手写（依赖注入测试）
>     └── test_openapi.py           ← 核心：你手写（OpenAPI 契约测试）
> ```

## §0 今天在 90 天里的位置

**坐标**：阶段二（AI 前端 -> AI 全栈）第 2 天。

**承前**：Day41 你建立了 Python 服务的骨架（typing + asyncio + 边界模型 + 线程池桥接）。但只实现了一个 `/diagnose` 接口，缺少完整的 FastAPI 工程层（依赖注入、中间件、异常处理、OpenAPI 文档）。今天要把 FastAPI 从"能跑"做到"工程化"。

**启后**：今天建立的 FastAPI 工程模板（DI + middleware + exception）是 Day43-47 Python/AI 接口的地基。Day43 模型网关、Day44 结构化输出、Day46 RAG 摄取和 Day47 向量检索，都复用今天的依赖注入和中间件。

**今天必须解决的 5 个问题**：

1. **非法请求返回 500 堆栈**：`/embed` 接口收到非法 body 返回 500 和完整堆栈，过去 24h 有 860 次（对应情境题 1）。
2. **请求取消未传播**：用户取消请求后 FastAPI 仍计算 embedding 10 分钟，50 次取消占满 worker（对应情境题 2）。
3. **Trace 断链**：Day41 建立的 Trace 透传在 FastAPI 依赖里没有正确传递，部分请求 traceId 丢失。
4. **无 OpenAPI 契约**：Node 侧不知道 Python 接口的完整契约（哪些字段必填、类型是什么），只能靠文档和口头约定。
5. **依赖重复初始化**：每个路由都手写 `get_trace_id()`，代码重复且难维护。

**知识链顺序**：`Pydantic 校验`（先有类型安全的入口）→ `依赖注入`（复用逻辑，不重复初始化）→ `中间件`（统一前置处理，如 Trace 注入）→ `异常处理`（统一错误响应）→ `OpenAPI`（生成契约文档，供 Node 对齐）。这个顺序是"从请求入口到出口"的完整生命周期。

---

## §1 今天要做的事

### 1.1 五个真实用户场景

今天的 FastAPI 工程层要支撑这些真实链路（Day41 的 `/diagnose` 加上新增的 `/embed`）：

1. **Embedding 生成**：Node 调用 Python 的 `/embed`，传文本列表，返回 OpenAI Embedding 向量。这是 Day47 向量检索的前置接口。
2. **非法输入脱敏**：前端传了空文本或超长文本，FastAPI 边界层拦截并返回 422（而非 500 堆栈），错误信息不泄漏内部路径。
3. **请求取消传播**：用户关闭浏览器，Node 侧取消请求，FastAPI 收到 `CancelledError` 后立即停止 Embedding 计算，释放资源。
4. **Trace 贯穿依赖**：一个请求从 Node → FastAPI → OpenAI API，traceId 贯穿三层，任意环节失败都能通过 traceId 回溯。
5. **OpenAPI 契约对齐**：Node 开发者访问 `http://python-service:8000/docs`，看到 `/embed` 的完整契约（字段、类型、示例），生成 TypeScript 类型定义。

### 1.2 模块职责划分

| 模块 | 职责 | 谁写 |
|------|------|------|
| `dependencies/trace.py` | 依赖注入：从请求头提取 traceId | 你手写 |
| `dependencies/rate_limit.py` | 依赖注入：请求限流（内存版简化） | 你手写 |
| `middleware/trace_middleware.py` | 中间件：注入 traceId 到 context | 你手写 |
| `middleware/timeout_middleware.py` | 中间件：请求超时控制 | 你手写 |
| `exceptions/handlers.py` | 全局异常处理器：脱敏 + 统一格式 | 你手写 |
| `api/embed.py` | 路由：Embedding 生成接口 | 你手写 |
| `schemas/embed.py` | Pydantic 契约：EmbedRequest/Response | 样板 |
| `tests/test_openapi.py` | OpenAPI 契约测试 | 你手写 |
| `middleware/logging_middleware.py` | 请求日志（结构化） | 样板 |

### 1.3 三版演进：从"裸路由"到"工程化"

**v1（裸路由）**：直接在路由函数里写所有逻辑（提取 traceId、校验、调用 OpenAI、异常处理）。能跑，但代码重复、难维护、异常泄漏堆栈。

**v2（加依赖注入 + 中间件）**：用 FastAPI 的 `Depends()` 提取公共逻辑（traceId、限流），用中间件统一注入 context。路由函数只关心业务逻辑。

**v3（生产级）**：加全局异常处理（脱敏）+ 请求取消传播 + OpenAPI 契约测试 + 超时控制。让整个服务可验证、可观测、不泄密、能优雅降级。

三版对比：

| 维度 | v1 | v2 | v3 |
|------|----|----|----|
| Trace 透传 | ❌ 每个路由手写 | ✅ 依赖注入 | ✅ 依赖 + 中间件 |
| 限流 | ❌ 无 | ✅ 依赖注入 | ✅ 依赖 + 内存计数器 |
| 异常处理 | ❌ 500 堆栈泄漏 | ⚠️ 部分捕获 | ✅ 全局处理 + 脱敏 |
| 请求取消 | ❌ 不传播 | ⚠️ 能取消但不回收 | ✅ 取消 + 资源回收 |
| OpenAPI | ⚠️ 自动生成但不测试 | ⚠️ 有文档 | ✅ 契约测试锁住 |
| 超时控制 | ❌ 无 | ❌ 无 | ✅ 中间件超时 |

**三个灵魂问题**（写代码前先想）：

1. 依赖注入和中间件有什么区别？中间件在**每个请求**前后执行（全局），依赖注入在**特定路由**需要时才执行（局部）。Trace 注入用中间件（所有请求都要），限流用依赖（只有特定路由要）。
2. FastAPI 的异常处理器和 try-catch 有什么区别？异常处理器是**全局兜底**，捕获所有未处理异常并统一格式；try-catch 是**局部处理**，处理已知异常。两者配合：业务异常用 try-catch，未知异常交给全局处理器。
3. 请求取消为什么需要传播？asyncio 的协程取消是协作式的（cooperative），不是抢占式（preemptive）。如果不主动检查 `asyncio.current_task().cancelled()`，取消信号不会传播到子任务（如 OpenAI API 调用），导致资源泄漏。

### 1.4 目录结构说明（FastAPI 分层的为什么）

**为什么 dependencies/ 独立成层？**

FastAPI 的依赖注入是可组合的——一个路由可以依赖多个依赖（`Depends(get_trace), Depends(check_rate_limit)`），依赖之间也可以互相依赖。独立成层让依赖关系一目了然，也方便测试（mock 某个依赖）。

**为什么 middleware/ 和 dependencies/ 分开？**

中间件是**顺序执行**的管道（request → middleware1 → middleware2 → 路由 → middleware2 → middleware1 → response），依赖是**按需注入**的树（路由声明用哪些依赖，FastAPI 自动解析依赖树）。分开是因为它们的执行模型不同。

**为什么 schemas/ 不叫 models/？**

避免和 Pydantic 的 `BaseModel` 混淆。`schemas/` 强调"契约"语义——这是跨服务边界的数据结构定义，不是 ORM 的 model。

**与 Day41 的 diff**：

| 文件 | 状态 | 说明 |
|------|------|------|
| `dependencies/**` | 🆕 全新 | 依赖注入层 |
| `middleware/**` | 🆕 全新 | 中间件层 |
| `exceptions/**` | 🆕 全新 | 异常处理层 |
| `api/embed.py` | 🆕 全新 | Embedding 接口 |
| `schemas/embed.py` | 🆕 全新 | Embedding 契约 |
| `main.py` | ✏️ 修改 | 注册中间件和异常处理器 |

---

## §2 今天的开发节奏（3 小时怎么分配）

这是 3h 小版本，节奏要紧凑：

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理与源码 | 90 min | FastAPI 请求生命周期、依赖注入原理、中间件执行顺序与三版痛点 |
| v1 裸路由 | 20 min | 快速写一个 `/embed` 路由（无依赖、无中间件） |
| v2 依赖 + 中间件 | 20 min | 提取 Trace/限流依赖，加 Trace/超时中间件 |
| v3 异常 + OpenAPI | 20 min | 全局异常处理 + 契约测试 |
| 测试验证 | 20 min | 非法输入、取消传播、OpenAPI 契约 + 两个反证实验 |
| 架构证据 | 10 min | 请求生命周期图 + 依赖图 |

**关键节奏提醒**：v1 只花 20 分钟，目的是快速看到"代码重复"的痛点。真正的功夫在 v2 的依赖提取。

---

## §3 v1：裸路由（快速看到痛点）

v1 的目标是快速实现 `/embed` 接口，但故意不用依赖注入和中间件，暴露"代码重复"和"异常泄漏"的问题。

### 3.1 v1 代码（能跑但有问题）

```python
# api/embed.py（v1 版本）
from fastapi import APIRouter, Request
from openai import AsyncOpenAI
import os

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

@router.post("/embed")
async def embed(request: Request):
    # ❌ 问题 1：手动提取 traceId（每个路由都要写一遍）
    trace_id = request.headers.get("x-trace-id", "unknown")
    
    # ❌ 问题 2：手动解析 body（没用 Pydantic）
    body = await request.json()
    texts = body.get("texts", [])
    
    # ❌ 问题 3：没有限流
    # ❌ 问题 4：没有超时控制
    
    # 调用 OpenAI
    try:
        response = await client.embeddings.create(
            input=texts,
            model="text-embedding-3-small"
        )
        embeddings = [item.embedding for item in response.data]
        
        # ❌ 问题 5：裸 dict 返回（没有契约）
        return {
            "trace_id": trace_id,
            "embeddings": embeddings,
            "model": "text-embedding-3-small"
        }
    except Exception as e:
        # ❌ 问题 6：异常堆栈泄漏
        raise e
```

### 3.2 v1 的 6 个致命问题

1. **traceId 提取重复**：每个路由都写 `request.headers.get("x-trace-id")`，有 10 个路由就写 10 遍。
2. **无 Pydantic 校验**：直接 `body.get("texts")`，非法输入（如 `texts` 是字符串不是列表）运行期才炸。
3. **无限流**：恶意用户狂发请求，打爆 OpenAI quota。
4. **无超时**：OpenAI API 卡住，请求无限等待。
5. **裸 dict 返回**：没有契约，Node 侧不知道字段会不会变。
6. **异常堆栈泄漏**：OpenAI API 报错时，完整堆栈（含 API key 路径、依赖版本）返回给 Node。

### 3.3 v1 反证实验

```bash
# 发非法请求
curl -X POST localhost:8000/embed -d '{"texts": "not-a-list"}'
# 期望问题：返回 500 + 堆栈（含文件路径）

# 同时发 50 个请求（无限流）
for i in {1..50}; do
  curl -X POST localhost:8000/embed -d '{"texts":["test"]}' &
done
# 期望问题：无限流，全部发到 OpenAI（可能触发 rate limit）
```

**结论**：v1 能跑但不可维护、不安全、不可观测。v2 必须引入依赖注入和中间件。

---

## §4 v2：依赖注入 + 中间件（工程化重构）

v2 解决 v1 的前 4 个问题：**代码重复**、**无校验**、**无限流**、**无超时**。

### 4.1 依赖注入：提取公共逻辑

**知识点 1：FastAPI 依赖注入（Dependency Injection）**

- **解决什么问题**：路由间的公共逻辑（traceId 提取、鉴权、限流）不用每次手写，声明依赖即可。
- **运行机制**：`Depends(func)` 告诉 FastAPI"调用这个路由前先执行 func，把结果注入到路由参数"。依赖可以嵌套（依赖 A 依赖 B）。
- **项目落点**：`dependencies/trace.py`（提取 traceId）、`dependencies/rate_limit.py`（限流检查）。
- **生产误区**：依赖函数里做阻塞调用（如同步 DB 查询）——依赖和路由一样会阻塞事件循环，必须用 async。
- **验证方法**：路由里不写 traceId 提取代码，确认依赖注入生效。

```python
# dependencies/trace.py（你手写）
from fastapi import Header

async def get_trace_id(x_trace_id: str = Header(None)) -> str:
    """依赖：从请求头提取 traceId"""
    return x_trace_id or "unknown"
```

```python
# dependencies/rate_limit.py（你手写，简化版内存限流）
from fastapi import HTTPException
from collections import defaultdict
import time

# 内存计数器：{ip: [(timestamp, count)]}
_rate_limits = defaultdict(list)
MAX_REQUESTS = 10  # 每分钟最多 10 次

async def check_rate_limit(request: Request):
    """依赖：简单限流（生产应该用 Redis）"""
    ip = request.client.host
    now = time.time()
    
    # 清理 1 分钟前的记录
    _rate_limits[ip] = [(t, c) for t, c in _rate_limits[ip] if now - t < 60]
    
    # 检查是否超限
    count = sum(c for _, c in _rate_limits[ip])
    if count >= MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    _rate_limits[ip].append((now, 1))
```

### 4.2 中间件：统一前置处理

**知识点 2：FastAPI 中间件（Middleware）**

- **解决什么问题**：所有请求都要做的事（注入 traceId 到 context、记录日志、超时控制）放中间件，不在每个路由重复。
- **运行机制**：中间件是管道模式，request 按顺序经过所有中间件到路由，response 逆序经过中间件返回。
- **项目落点**：`middleware/trace_middleware.py`（注入 traceId 到 contextvars）、`middleware/timeout_middleware.py`（超时控制）。
- **生产误区**：中间件里做重计算——中间件会拖慢所有请求。应该只做轻量级操作（提取header、写日志）。
- **验证方法**：不同路由都能拿到 traceId，确认中间件全局生效。

```python
# middleware/trace_middleware.py（你手写）
from starlette.middleware.base import BaseHTTPMiddleware
from contextvars import ContextVar
import uuid

trace_context: ContextVar[str] = ContextVar("trace_id", default="unknown")

class TraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())
        trace_context.set(trace_id)  # 注入到 context（全局可用）
        
        response = await call_next(request)
        response.headers["x-trace-id"] = trace_id  # 透传给响应
        return response
```

```python
# middleware/timeout_middleware.py（你手写）
import asyncio
from fastapi import HTTPException

class TimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            # 30 秒超时
            return await asyncio.wait_for(call_next(request), timeout=30.0)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Request timeout")
```

### 4.3 v2 重构后的路由（干净）

```python
# api/embed.py（v2 版本）
from fastapi import APIRouter, Depends
from schemas.embed import EmbedRequest, EmbedResponse
from dependencies.trace import get_trace_id
from dependencies.rate_limit import check_rate_limit

router = APIRouter(dependencies=[Depends(check_rate_limit)])  # 路由级依赖

@router.post("/embed", response_model=EmbedResponse)
async def embed(
    req: EmbedRequest,  # ✅ Pydantic 自动校验
    trace_id: str = Depends(get_trace_id),  # ✅ 依赖注入
):
    # 路由函数只关心业务逻辑
    response = await client.embeddings.create(input=req.texts, model=req.model)
    return EmbedResponse(
        trace_id=trace_id,
        embeddings=[item.embedding for item in response.data],
        model=req.model
    )
```

**对比 v1**：代码量减半，逻辑清晰，依赖可复用。

## §5 v3：全局异常处理 + 请求取消 + OpenAPI 契约（生产级）

v3 解决 v1 剩下的 2 个问题 + 新增请求取消传播和 OpenAPI 契约测试。

### 5.1 全局异常处理：脱敏 + 统一格式

**知识点 3：FastAPI 异常处理器（Exception Handler）**

- **解决什么问题**：未捕获异常返回 500 堆栈泄漏内部路径、API key、依赖版本。统一处理成脱敏的 JSON 响应。
- **运行机制**：注册异常处理器 `@app.exception_handler(Exception)`，所有未捕获异常都会被这个函数接住。
- **项目落点**：`exceptions/handlers.py` 处理所有异常（RequestValidationError、HTTPException、Exception）。
- **生产误区**：所有异常都返回 500——应该区分客户端错误（4xx）和服务器错误（5xx）。Pydantic 校验失败是 422，业务逻辑错误是 400。
- **验证方法**：发非法请求，确认返回 422（不是 500）且无堆栈。

```python
# exceptions/handlers.py（你手写）
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
import logging

logger = logging.getLogger(__name__)

async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理 Pydantic 校验失败（422）"""
    logger.warning(f"Validation error: {exc.errors()}", extra={"trace_id": trace_context.get()})
    
    # 脱敏：只返回字段名和错误类型，不返回堆栈
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "validation_error",
            "message": "Invalid request format",
            "details": [
                {"field": err["loc"][-1], "type": err["type"]}
                for err in exc.errors()
            ],
            "trace_id": trace_context.get()
        }
    )

async def generic_exception_handler(request: Request, exc: Exception):
    """处理所有未捕获异常（500）"""
    # 记录完整堆栈到日志（内部可见）
    logger.error(f"Unhandled error: {exc}", exc_info=True, extra={"trace_id": trace_context.get()})
    
    # 返回脱敏响应（外部不可见堆栈）
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "internal_error",
            "message": "An unexpected error occurred",
            "trace_id": trace_context.get()  # 供用户报障
        }
    )
```

**注册到 main.py**：

```python
# main.py（修改）
from exceptions.handlers import validation_exception_handler, generic_exception_handler
from fastapi.exceptions import RequestValidationError

app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)
```

### 5.2 请求取消传播：协作式取消

**知识点 4：asyncio 请求取消传播（Cancellation Propagation）**

- **解决什么问题**：用户取消请求（关闭浏览器），FastAPI 收到 disconnect 但不传播给子任务（如 OpenAI API 调用），导致资源泄漏。
- **运行机制**：asyncio 的取消是协作式的——父任务取消不会自动杀死子任务，必须主动检查 `asyncio.current_task().cancelled()` 或捕获 `CancelledError`。
- **项目落点**：Embedding 调用包裹 try-catch，捕获 `CancelledError` 后清理资源（如关闭 OpenAI 连接）。
- **生产误区**：只 catch Exception 不 catch CancelledError——取消信号被吞掉，子任务继续跑。正确做法是 `except (Exception, asyncio.CancelledError)`。
- **验证方法**：发请求后立即取消（模拟客户端 disconnect），确认 OpenAI API 调用立即停止，CPU 使用率归零。

```python
# api/embed.py（v3 版本，加取消传播）
import asyncio

@router.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest, trace_id: str = Depends(get_trace_id)):
    try:
        response = await client.embeddings.create(input=req.texts, model=req.model)
        return EmbedResponse(
            trace_id=trace_id,
            embeddings=[item.embedding for item in response.data],
            model=req.model
        )
    except asyncio.CancelledError:
        # ✅ 捕获取消信号，清理资源
        logger.info(f"Request cancelled: {trace_id}")
        # 如果有长期资源（DB 连接、文件），这里关闭
        raise  # 重新抛出，让 FastAPI 返回 499
    except Exception as e:
        logger.error(f"Embed failed: {e}", extra={"trace_id": trace_id})
        raise
```

**验证取消传播**：

```python
# tests/test_cancellation.py（你手写）
import asyncio
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_请求取消应释放资源():
    async with AsyncClient(app=app, base_url="http://test") as client:
        # 发起请求后立即取消
        task = asyncio.create_task(
            client.post("/embed", json={"texts": ["long text"] * 100})
        )
        await asyncio.sleep(0.1)  # 等请求进入处理
        task.cancel()  # 取消
        
        with pytest.raises(asyncio.CancelledError):
            await task
        
        # 验证资源释放（如检查 OpenAI 连接数归零）
```

### 5.3 OpenAPI 契约：文档 + 测试

**知识点 5：FastAPI OpenAPI 自动生成 + 契约测试**

- **解决什么问题**：Node 侧不知道 Python 接口的完整契约（哪些字段必填、类型是什么），只能靠文档和口头约定。契约漂移导致运行期错误。
- **运行机制**：FastAPI 自动从 Pydantic model 生成 OpenAPI 3.0 文档，访问 `/docs` 可以看到所有接口。
- **项目落点**：用 OpenAPI schema 生成测试用例，覆盖正常/非法/边界输入。
- **生产误区**：只看文档不测试——文档可能和实际不一致（代码改了忘更新注释）。正确做法是契约测试锁住文档和实际行为。
- **验证方法**：从 `/openapi.json` 提取 schema，生成 Pydantic model，发请求验证响应符合 schema。

```python
# tests/test_openapi.py（你手写）
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_OpenAPI文档包含embed接口():
    response = client.get("/openapi.json")
    schema = response.json()
    
    # 验证 /embed 接口存在
    assert "/embed" in schema["paths"]
    embed_schema = schema["paths"]["/embed"]["post"]
    
    # 验证请求体 schema
    assert "requestBody" in embed_schema
    request_schema = embed_schema["requestBody"]["content"]["application/json"]["schema"]
    assert "$ref" in request_schema  # 引用 EmbedRequest
    
    # 验证响应 schema
    assert "200" in embed_schema["responses"]
    response_schema = embed_schema["responses"]["200"]["content"]["application/json"]["schema"]
    assert "$ref" in response_schema  # 引用 EmbedResponse

def test_非法输入应返回422():
    # 缺必填字段
    response = client.post("/embed", json={})
    assert response.status_code == 422
    error = response.json()
    assert error["error"] == "validation_error"
    assert "texts" in str(error["details"])  # 提示缺 texts 字段

def test_边界输入应处理():
    # 空列表
    response = client.post("/embed", json={"texts": []})
    assert response.status_code == 422  # 或 200（取决于业务规则）
    
    # 超长文本（>8191 tokens）
    long_text = "a" * 10000
    response = client.post("/embed", json={"texts": [long_text]})
    # 应该返回 422（或截断处理）
```

### 5.4 v3 核心知识点小结

| 知识点 | 解决什么问题 | 项目落点 | 验证方法 |
|--------|--------------|----------|----------|
| 依赖注入 | 代码重复 | traceId/限流依赖 | 路由里不写提取代码 |
| 中间件 | 全局前置处理 | Trace/超时中间件 | 所有路由都有 traceId |
| 异常处理器 | 堆栈泄漏 | 全局脱敏处理 | 非法输入返回 422 无堆栈 |
| 请求取消 | 资源泄漏 | catch CancelledError | 取消后 CPU 归零 |
| OpenAPI 契约 | 契约漂移 | 契约测试锁住 | schema 测试全覆盖 |

---

## §6 前端底子深挖：FastAPI 对前端的影响

今天的 FastAPI 工程层对前端最大的影响是：**错误响应结构化**。

### 6.1 结构化错误响应

v1 的裸异常返回给前端的是：

```json
{
  "detail": "Traceback (most recent call last):\n  File ...\nKeyError: 'texts'"
}
```

前端无法区分错误类型，只能显示"系统错误"。

v3 的结构化错误：

```json
{
  "error": "validation_error",
  "message": "Invalid request format",
  "details": [{"field": "texts", "type": "missing"}],
  "trace_id": "abc-123"
}
```

前端可以：
1. 根据 `error` 字段区分错误类型（`validation_error` vs `internal_error`）
2. 根据 `details` 高亮具体字段（"texts 字段缺失"）
3. 用 `trace_id` 报障（客服能通过 traceId 查日志）

### 6.2 OpenAPI 生成 TypeScript 类型

FastAPI 的 `/openapi.json` 可以用工具生成 TypeScript 类型：

```bash
npx openapi-typescript http://localhost:8000/openapi.json -o types/python-api.d.ts
```

前端代码：

```typescript
import type { components } from './types/python-api'

type EmbedRequest = components['schemas']['EmbedRequest']
type EmbedResponse = components['schemas']['EmbedResponse']

// 类型安全的调用
const response = await fetch('/embed', {
  method: 'POST',
  body: JSON.stringify({ texts: ['hello'] } satisfies EmbedRequest)
})
const data: EmbedResponse = await response.json()
```

**为什么重要**：前端和后端的类型定义从同一个 source of truth（OpenAPI schema）生成，保证一致性。

---

## §7 测试与验证

### 7.1 单元测试：依赖注入

```python
# tests/test_dependencies.py
from dependencies.trace import get_trace_id
from fastapi import Header

@pytest.mark.asyncio
async def test_traceId依赖提取():
    # Mock Header
    trace_id = await get_trace_id(x_trace_id="test-123")
    assert trace_id == "test-123"
    
    # 缺失时返回 unknown
    trace_id = await get_trace_id(x_trace_id=None)
    assert trace_id == "unknown"
```

### 7.2 集成测试：中间件

```python
# tests/test_middleware.py
from fastapi.testclient import TestClient

def test_Trace中间件注入():
    response = client.get("/health")
    # 响应头应包含 x-trace-id
    assert "x-trace-id" in response.headers

def test_超时中间件():
    # Mock 慢接口
    @app.get("/slow")
    async def slow():
        await asyncio.sleep(35)  # 超过 30s
        return "ok"
    
    with pytest.raises(HTTPException) as exc_info:
        client.get("/slow")
    assert exc_info.value.status_code == 504
```

### 7.3 反证实验（两个）

**反证 1：移除异常处理器，非法输入返回什么？**

```python
# 注释掉 main.py 的异常处理器注册
# app.add_exception_handler(RequestValidationError, ...)

response = client.post("/embed", json={"texts": "not-a-list"})
assert response.status_code == 422  # 还是 422
# 但响应格式是 FastAPI 默认的（不脱敏）
error = response.json()
assert "detail" in error  # 默认格式
assert "validation_error" not in error  # 没有自定义格式
```

**结论**：FastAPI 默认会返回 422，但格式不统一、可能泄漏信息。自定义异常处理器是为了统一格式 + 脱敏。

**反证 2：不捕获 CancelledError，取消请求后资源释放吗？**

```python
# 注释掉 api/embed.py 的 except asyncio.CancelledError

# 发请求后立即取消
task = asyncio.create_task(client.post("/embed", json={"texts": ["test"]}))
await asyncio.sleep(0.1)
task.cancel()

# 检查 OpenAI 连接数（mock）
assert openai_client._connections == 0  # ❌ 失败：连接未释放
```

**结论**：不捕获 CancelledError 会导致资源泄漏（连接、文件句柄）。

### 7.4 架构证据四件套

1. **请求生命周期图**：middleware → dependencies → 路由 → exception handler → middleware（逆序）
2. **依赖注入树**：`embed` 路由依赖 `get_trace_id` 和 `check_rate_limit`
3. **OpenAPI schema 截图**：`/docs` 页面展示 `/embed` 接口完整契约
4. **测试全绿截图**：pytest 输出（覆盖率 >80%）

---

## §8 通关检查清单（v3 规范 11 项）

- [ ] §0 本日在 90 天路线图的坐标已说明（阶段二第 2 天，Day41 Python 骨架基础上补充 FastAPI 工程层）
- [ ] §1 五个用户场景 + 模块职责 + 三版演进 + 完整目录结构齐全
- [ ] §2 3 小时开发节奏已列出（原理 40 / v1 20 / v2 50 / v3 30 / 测试 25 / 架构 15）
- [ ] §3 v1 裸路由暴露 6 个问题（代码重复、无校验、无限流、无超时、裸 dict、堆栈泄漏）
- [ ] §4 v2 依赖注入 + 中间件（提取 Trace/限流依赖 + Trace/超时中间件）
- [ ] §5 v3 异常处理 + 取消传播 + OpenAPI 契约测试
- [ ] §6 前端底子深挖（结构化错误响应 + OpenAPI 生成 TS 类型）
- [ ] §7 测试四件套（依赖单元测试 + 中间件集成测试 + 2 个反证实验 + 架构证据）
- [ ] §8 本清单
- [ ] §9 增量到下一站的伏笔
- [ ] §10-14 收尾章节 + 原文情境题/PDF 映射/五连问原样保留

---

## §9 从今天的增量到下一站

今天你建立了 FastAPI 的完整工程层——不只是"写了几个路由"，而是建立了**依赖注入（复用逻辑）+ 中间件（统一前置）+ 异常处理（脱敏）+ OpenAPI（契约）**的完整体系。这套体系是 Day43-47 Python/AI 接口的模板。

**今天建立的能力地基**：

1. **依赖注入模板**：Day43 的模型网关、Day46 的 RAG 摄取会复用 `get_trace_id` 和 `check_rate_limit` 依赖。
2. **中间件模板**：Day44 会补充跨服务 Trace 透传中间件。
3. **异常处理模板**：Day47 的向量检索会复用全局异常处理器。
4. **OpenAPI 契约**：Day43-47 的前端调用统一使用生成的 TS 类型。

**今天留下的 3 个待优化点**：

1. **限流用内存计数器**：v3 的限流只在单机内存里，重启就丢。Day43 会改用 Redis（跨实例共享）。
2. **超时固定 30s**：v3 的超时对所有接口统一 30s，但 Embedding 可能需要更长。Day44 会改成路由级超时配置。
3. **OpenAPI 契约未版本化**：v3 的契约没有版本号，加字段会破坏旧客户端。Day45 会补充契约版本管理。

**下一站要解决的核心问题**：

**Day43：向量检索服务（Pinecone + Hybrid Search）**

核心挑战：
- 如何把 Embedding 存到 Pinecone？复用今天的依赖注入（`Depends(get_pinecone_client)`）。
- Pinecone 超时如何分类重试？复用 Day34 的错误分类 + 今天的异常处理器。
- 向量检索结果如何流式返回？用 FastAPI 的 `StreamingResponse`。

---

## §10 本日小结

**标题党 30 字**：FastAPI 依赖注入防重复、中间件统一前置、异常处理防泄密、取消传播防资源泄漏、OpenAPI 契约防漂移——五层保障让 Python 服务工程化。

**三句话**：
1. FastAPI 依赖注入（Depends）解决代码重复——traceId 提取、限流、鉴权等公共逻辑只写一次，声明依赖即可；中间件（Middleware）解决全局前置处理——所有请求都要做的事（注入 context、记录日志、超时控制）放中间件，不在路由重复；两者区别是中间件全局、依赖局部。
2. 全局异常处理器（exception_handler）防止堆栈泄漏——非法输入返回脱敏的 422（不是 500 堆栈），内部错误只返回 traceId（堆栈写日志不返回客户端）；请求取消传播（catch CancelledError）防止资源泄漏——asyncio 取消是协作式的，不主动检查 cancelled() 会导致子任务继续跑。
3. OpenAPI 契约是跨服务边界的 source of truth——FastAPI 自动从 Pydantic model 生成 OpenAPI 3.0 文档，Node 侧用 openapi-typescript 生成 TS 类型定义，保证前后端类型一致；契约测试锁住文档和实际行为（从 /openapi.json 提取 schema 生成测试用例）。

---

## §11 课后三道核心问题（必答，先于教师五连问）

1. 请从今天项目的真实入口到最终输出，解释"FastAPI 工程层"的数据流或控制流；当天知识链"Pydantic、依赖注入、中间件、异常处理、OpenAPI"分别在哪一层起作用，为什么按这个顺序学习？
2. 如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。
3. 请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

---

## §12 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：embed 接口收到非法 body 时返回 500 和完整堆栈，过去 24 小时有 860 次同类请求。请检查 middleware、Pydantic 校验和 exception handler 日志，先统一为脱敏 4xx，再修复请求模型和错误语义，使用 OpenAPI 合同测试验证正常、非法和边界输入。
   依据：[FastAPI Async](https://fastapi.tiangolo.com/async/)
2. 模拟情境：用户取消请求后 FastAPI 仍计算 embedding 10 分钟,50 次取消占满 worker。请通过客户端断开、协程任务和资源指标定位取消未传播，先限制任务时长并回收资源，再修复 cancellation 与依赖生命周期，验证取消后 CPU、连接和任务数及时归零。
   依据：[FastAPI Async](https://fastapi.tiangolo.com/async/)
知识映射：对应 FastAPI 请求生命周期、校验、中间件、异常和取消。

---

## §13 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## §14 PDF 面试题映射

1. TypeScript 高级类型如何定义 AI 接口响应并处理不同 message 类型？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 1 页。
2. 如何通过规范、测试、类型安全、异常处理和日志追踪保证全栈项目质量？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 13 页。
题目说明：近似题/资源缺口：没有 FastAPI DI、Pydantic、middleware、exception handler 或 OpenAPI 的直接题；两题只检验接口契约和质量门禁。
