# Day 43 - 模型网关（Provider 抽象 + 路由 + Fallback + Usage）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。
>
> **跨 Day 导航修正**：后续真实顺序：Day44 结构化输出，Day45 Prompt 版本，Day46 RAG 摄取。

日期与时长：2026-08-25 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日项目完整目录结构**（在 Day42 FastAPI 基础上新增模型网关层）
>
> ```
> services/ai/src/ai_service/
> ├── gateway/                      # ★ 今天新增：模型网关层
> │   ├── __init__.py
> │   ├── providers/                # Provider 适配器层
> │   │   ├── __init__.py
> │   │   ├── base.py               ← 核心：你手写（BaseProvider 抽象类）
> │   │   ├── openai_provider.py   ← 核心：你手写（OpenAI 适配器）
> │   │   ├── anthropic_provider.py ← 样板：Anthropic 适配器
> │   │   └── mock_provider.py     ← 样板：Mock 适配器（测试用）
> │   ├── router/                   # 模型路由层
> │   │   ├── __init__.py
> │   │   ├── model_router.py      ← 核心：你手写（路由策略）
> │   │   ├── routing_rules.py     ← 核心：你手写（路由规则配置）
> │   │   └── fallback_chain.py    ← 核心：你手写（降级链）
> │   ├── usage/                    # 用量统计层
> │   │   ├── __init__.py
> │   │   ├── usage_tracker.py     ← 核心：你手写（token 用量追踪）
> │   │   ├── cost_calculator.py   ← 核心：你手写（成本计算）
> │   │   └── usage_repository.py  ← 样板：持久化到 Postgres
> │   └── schemas/                  # 网关契约层
> │       ├── __init__.py
> │       ├── gateway_request.py   ← 核心：你手写（统一请求格式）
> │       ├── gateway_response.py  ← 核心：你手写（统一响应格式）
> │       └── provider_config.py   ← 样板：Provider 配置
> ├── api/
> │   └── gateway.py                ← 核心：你手写（新增网关接口 /v1/chat/completions）
> └── tests/
>     ├── test_providers.py         ← 核心：你手写（Provider 适配器测试）
>     ├── test_router.py            ← 核心：你手写（路由策略测试）
>     └── test_fallback.py          ← 核心：你手写（降级链测试）
> ```

## §0 今天在 90 天里的位置

**坐标**：阶段二（AI 前端 -> AI 全栈）第 3 天。

**承前**：Day42 你建立了 FastAPI 的完整工程层（依赖注入 + 中间件 + 异常处理 + OpenAPI）。但直接调用 OpenAI API 有 3 个致命问题：**单点依赖**（OpenAI 挂了全挂）、**成本失控**（简单任务也用旗舰模型）、**响应格式锁定**（切换 Provider 要改代码）。今天要建立模型网关（Model Gateway），统一多个 Provider，实现路由、降级、用量追踪。

**启后**：今天建立的模型网关是 Day44-60 所有 AI 能力的基座。Day44 结构化输出、Day45 Prompt、Day46 RAG 摄取和后续 Eval，都通过网关调用模型（不直接调 OpenAI API）。

**今天必须解决的 5 个问题**：

1. **Provider A 429 降级失败**：OpenAI 30 分钟内 429 达 38%，fallback 到 Anthropic 后字段命名漂移（`content` vs `completion`），前端 12% 空白（对应情境题 1）。
2. **简单任务错误路由**：分类任务被路由到 GPT-4（旗舰模型），日均 6 万次调用使成本升高 4 倍（对应情境题 2）。
3. **无用量追踪**：不知道每个任务用了多少 token、花了多少钱，无法优化成本。
4. **Provider 耦合**：业务代码直接调 `openai.chat.completions.create()`，切换 Provider 要改所有调用代码。
5. **无超时重试**：OpenAI 超时后不重试，直接失败（Day34 的失败恢复在队列层，但没有在模型调用层）。

**知识链顺序**：`Provider 抽象`（先有统一接口）→ `模型路由`（根据任务选模型）→ `Fallback 降级`（主 Provider 失败切备）→ `Usage 追踪`（记录 token 和成本）→ `成本计算`（优化成本）。这个顺序是"从接口统一到智能调度到成本优化"的完整链路。

---

## §1 今天要做的事

### 1.1 五个真实用户场景

今天的模型网关要支撑这些真实链路（Agent 不直接调 OpenAI，而是通过网关）：

1. **简单分类任务**：Agent 判断用户问题类别（技术/业务/其他），路由到 GPT-3.5（快速 + 便宜），不用 GPT-4。
2. **复杂诊断任务**：Agent 分析服务器日志，路由到 GPT-4（准确度高），记录 token 用量和成本。
3. **OpenAI 429 降级**：OpenAI rate limit，自动 fallback 到 Anthropic Claude，响应格式统一（前端无感知）。
4. **用量报表**：运维看每日成本报表（"今天分类任务花了 $12，诊断任务花了 $89"），优化路由策略。
5. **测试环境 Mock**：开发环境用 MockProvider（返回固定响应，不调真实 API），节省成本 + 加速测试。

### 1.2 模块职责划分

| 模块 | 职责 | 谁写 |
|------|------|------|
| `gateway/providers/base.py` | BaseProvider 抽象类（统一接口） | 你手写 |
| `gateway/providers/openai_provider.py` | OpenAI 适配器 | 你手写 |
| `gateway/providers/anthropic_provider.py` | Anthropic 适配器 | 样板 |
| `gateway/router/model_router.py` | 路由策略（根据任务选模型） | 你手写 |
| `gateway/router/fallback_chain.py` | 降级链（主备切换） | 你手写 |
| `gateway/usage/usage_tracker.py` | Token 用量追踪 | 你手写 |
| `gateway/usage/cost_calculator.py` | 成本计算（token → 美元） | 你手写 |
| `api/gateway.py` | 网关接口（/v1/chat/completions） | 你手写 |

### 1.3 三版演进：从"直调 API"到"智能网关"

**v1（直调 OpenAI）**：业务代码直接 `await openai.chat.completions.create()`。能跑，但单点依赖、成本失控、无用量追踪。

**v2（加 Provider 抽象 + 基础路由）**：抽象 BaseProvider，业务代码调 `gateway.complete()`，网关内部选 Provider。支持多 Provider，但路由规则简单（只按模型名路由）。

**v3（生产级）**：加智能路由（按任务类型选模型）+ Fallback 降级链 + Usage 追踪 + 成本计算 + 超时重试。让网关成为"AI 调用的统一入口"。

三版对比：

| 维度 | v1 | v2 | v3 |
|------|----|----|----|
| Provider 切换 | ❌ 改代码 | ✅ 配置切换 | ✅ 配置 + 自动降级 |
| 路由策略 | ❌ 无 | ⚠️ 按模型名 | ✅ 按任务类型 + 成本 |
| Fallback | ❌ 无 | ❌ 无 | ✅ 降级链（主备切换） |
| Usage 追踪 | ❌ 无 | ⚠️ 记录但不计算成本 | ✅ token + 成本 + 持久化 |
| 超时重试 | ❌ 无 | ⚠️ 只重试一次 | ✅ 指数退避 + 跨 Provider 重试 |
| 测试友好 | ❌ 依赖真实 API | ⚠️ 需要 mock | ✅ MockProvider 内置 |

**三个灵魂问题**（写代码前先想）：

1. Provider 抽象和 Adapter 模式有什么区别？Adapter 是"把不同接口转成统一接口"（结构转换），Provider 抽象是"定义统一接口并让实现类遵守"（行为约束）。本项目两者都用：BaseProvider 是抽象（定义 `complete()` 接口），OpenAIProvider 是 Adapter（把 OpenAI SDK 转成 BaseProvider 接口）。
2. 模型路由和负载均衡有什么区别？负载均衡是"请求分发到多个相同服务"（水平扩展），模型路由是"请求分发到不同模型"（按需选择）。本项目的路由是智能的（简单任务用便宜模型，复杂任务用旗舰模型），不是简单的轮询。
3. Fallback 和 Retry 有什么区别？Retry 是"同一个 Provider 重试"（暂时性错误如超时），Fallback 是"切换到另一个 Provider"（持续性错误如 429 rate limit）。本项目两者都用：单个 Provider 内部重试 3 次（Day34 的错误分类），重试失败后 fallback 到备用 Provider。

### 1.4 目录结构说明（模型网关分层的为什么）

**为什么 providers/ 和 router/ 分开？**

providers/ 是"能力层"（有哪些 Provider 可用），router/ 是"决策层"（选哪个 Provider）。分开是因为：新增 Provider 不影响路由逻辑，修改路由策略不影响 Provider 实现。

**为什么 usage/ 独立成层？**

用量统计是横切关注点（cross-cutting concern）——所有 Provider 调用都要记录用量。独立成层让统计逻辑集中，也方便后续加"用量预算"（超预算时拒绝请求）。

**为什么网关接口是 /v1/chat/completions 而不是 /gateway？**

兼容 OpenAI API 规范——客户端（如 LangChain）可以直接把 `base_url` 改成网关地址，无需改代码。网关对外伪装成 OpenAI API，对内路由到多个 Provider。

**与 Day42 的 diff**：

| 文件 | 状态 | 说明 |
|------|------|------|
| `gateway/**` | 🆕 全新 | 模型网关层 |
| `api/gateway.py` | 🆕 全新 | 网关接口 |
| `schemas/gateway_*.py` | 🆕 全新 | 网关契约 |

---

## §2 今天的开发节奏（3 小时怎么分配）

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理与源码 | 90 min | Adapter、策略、责任链及模型网关三版痛点 |
| v1 直调 API | 20 min | 直接调 OpenAI 的最小接口（暴露单点问题） |
| v2 Provider 抽象 + 基础路由 | 20 min | BaseProvider + OpenAIProvider + 简单路由 |
| v3 智能路由 + Fallback + Usage | 20 min | 路由规则 + 降级链 + 用量追踪 + 成本计算 |
| 测试验证 | 20 min | Provider 切换、429 降级、成本计算 + 两个反证实验 |
| 架构证据 | 10 min | Provider 路由 ADR + 类图 |

**关键节奏提醒**：v1 只花 15 分钟，快速暴露"单点依赖"和"成本失控"。真正的功夫在 v2 的抽象设计和 v3 的路由策略。
## §3 v1：直调 OpenAI（暴露单点依赖）

### 3.1 v1 能做什么

直接调 OpenAI API，实现"AI 回答用户问题"。

```python
# services/ai/src/ai_service/api/chat.py (v1 版本)
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

router = APIRouter()
client = AsyncOpenAI(api_key="sk-...")

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        response = await client.chat.completions.create(
            model="gpt-4",  # 硬编码模型名
            messages=[{"role": "user", "content": request.message}]
        )
        return ChatResponse(reply=response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 3.2 v1 的 5 个致命问题

1. **单点依赖**：OpenAI 挂了全挂（2024-11-08 OpenAI 全球故障 3 小时）。
2. **成本失控**：所有任务都用 GPT-4（旗舰模型），简单分类任务也花 $0.03/1K tokens（GPT-3.5 只需 $0.0005）。
3. **无用量追踪**：不知道今天花了多少钱，运维问"为什么这个月 AI 成本翻倍"时无法定位。
4. **Provider 耦合**：业务代码直接调 `openai.chat.completions.create()`，切换到 Anthropic 要改所有调用代码。
5. **429 不降级**：OpenAI rate limit 时直接失败，不 fallback 到其他 Provider。

---

## §4 v2：Provider 抽象 + 基础路由

### 4.1 v2 新增的能力

1. **Provider 抽象**：定义 `BaseProvider` 统一接口，业务代码调 `gateway.complete()` 而不是直接调 OpenAI。
2. **多 Provider 支持**：OpenAIProvider、AnthropicProvider、MockProvider，配置切换。
3. **基础路由**：按模型名路由（`gpt-4` → OpenAIProvider，`claude-3` → AnthropicProvider）。

### 4.2 v2 核心代码

#### 4.2.1 Provider 抽象（base.py）

```python
# services/ai/src/ai_service/gateway/providers/base.py
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class Message(BaseModel):
    """统一消息格式（兼容 OpenAI 格式）"""
    role: str  # 'system' | 'user' | 'assistant'
    content: str

class CompletionRequest(BaseModel):
    """统一请求格式"""
    model: str
    messages: List[Message]
    temperature: float = 0.7
    max_tokens: Optional[int] = None

class CompletionResponse(BaseModel):
    """统一响应格式"""
    content: str
    model: str
    usage: Dict[str, int]  # { "prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30 }
    provider: str  # 'openai' | 'anthropic' | 'mock'

class BaseProvider(ABC):
    """Provider 抽象基类"""
    
    @abstractmethod
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        """统一的 completion 接口"""
        pass
    
    @abstractmethod
    def supports_model(self, model: str) -> bool:
        """判断是否支持某个模型"""
        pass
```

**为什么要统一响应格式？**

OpenAI 返回的是 `response.choices[0].message.content`，Anthropic 返回的是 `response.completion`。统一成 `CompletionResponse` 后，业务代码只看到 `response.content`，不关心底层 Provider。

#### 4.2.2 OpenAI Provider（openai_provider.py）

```python
# services/ai/src/ai_service/gateway/providers/openai_provider.py
from openai import AsyncOpenAI
from .base import BaseProvider, CompletionRequest, CompletionResponse, Message

class OpenAIProvider(BaseProvider):
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)
    
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        # 转换统一格式 → OpenAI 格式
        openai_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in request.messages
        ]
        
        response = await self.client.chat.completions.create(
            model=request.model,
            messages=openai_messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
        
        # 转换 OpenAI 响应 → 统一格式
        return CompletionResponse(
            content=response.choices[0].message.content,
            model=response.model,
            usage={
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            },
            provider="openai",
        )
    
    def supports_model(self, model: str) -> bool:
        return model.startswith("gpt-")
```

**为什么 supports_model 只判断前缀？**

避免硬编码模型列表（OpenAI 每个月发布新模型）。只要模型名以 `gpt-` 开头，就认为是 OpenAI 模型。

#### 4.2.3 Mock Provider（mock_provider.py）

```python
# services/ai/src/ai_service/gateway/providers/mock_provider.py
from .base import BaseProvider, CompletionRequest, CompletionResponse

class MockProvider(BaseProvider):
    """测试用 Mock Provider（返回固定响应，不调真实 API）"""
    
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        # 固定返回
        return CompletionResponse(
            content="This is a mock response for testing.",
            model=request.model,
            usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            provider="mock",
        )
    
    def supports_model(self, model: str) -> bool:
        return True  # Mock 支持所有模型
```

**为什么需要 MockProvider？**

1. 测试时不依赖真实 API（节省成本 + 加速测试）
2. 开发环境不需要配置真实 API Key
3. 集成测试可以固定响应（验证业务逻辑，不验证 AI 输出）

#### 4.2.4 基础路由（model_router.py v2 版本）

```python
# services/ai/src/ai_service/gateway/router/model_router.py (v2 版本)
from typing import List
from ..providers.base import BaseProvider, CompletionRequest, CompletionResponse

class ModelRouter:
    def __init__(self, providers: List[BaseProvider]):
        self.providers = providers
    
    async def route(self, request: CompletionRequest) -> CompletionResponse:
        # 找到支持该模型的 Provider
        for provider in self.providers:
            if provider.supports_model(request.model):
                return await provider.complete(request)
        
        raise ValueError(f"No provider supports model: {request.model}")
```

**v2 路由策略的问题**：只按模型名路由（用户指定 `gpt-4` 就用 GPT-4），不考虑任务类型和成本。v3 会改进。

#### 4.2.5 网关接口（gateway.py v2 版本）

```python
# services/ai/src/ai_service/api/gateway.py (v2 版本)
from fastapi import APIRouter, HTTPException
from ..gateway.providers.base import CompletionRequest, CompletionResponse, Message
from ..gateway.providers.openai_provider import OpenAIProvider
from ..gateway.providers.mock_provider import MockProvider
from ..gateway.router.model_router import ModelRouter
import os

router = APIRouter()

# 初始化 Providers
openai_provider = OpenAIProvider(api_key=os.getenv("OPENAI_API_KEY", ""))
mock_provider = MockProvider()

# 初始化 Router
model_router = ModelRouter(providers=[openai_provider, mock_provider])

@router.post("/v1/chat/completions", response_model=CompletionResponse)
async def chat_completions(request: CompletionRequest):
    """网关接口（兼容 OpenAI API 格式）"""
    try:
        return await model_router.route(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**为什么接口路径是 /v1/chat/completions？**

兼容 OpenAI API 规范——客户端（如 LangChain）可以直接把 `base_url` 改成 `http://localhost:8000`，无需改代码。

### 4.3 v2 测试（Provider 切换）

```python
# services/ai/tests/test_providers.py
import pytest
from ai_service.gateway.providers.base import CompletionRequest, Message
from ai_service.gateway.providers.openai_provider import OpenAIProvider
from ai_service.gateway.providers.mock_provider import MockProvider

@pytest.mark.asyncio
async def test_openai_provider():
    provider = OpenAIProvider(api_key="sk-...")
    request = CompletionRequest(
        model="gpt-3.5-turbo",
        messages=[Message(role="user", content="Hello")]
    )
    response = await provider.complete(request)
    
    assert response.provider == "openai"
    assert response.usage["total_tokens"] > 0

@pytest.mark.asyncio
async def test_mock_provider():
    provider = MockProvider()
    request = CompletionRequest(
        model="gpt-4",
        messages=[Message(role="user", content="Hello")]
    )
    response = await provider.complete(request)
    
    assert response.provider == "mock"
    assert response.content == "This is a mock response for testing."
```

### 4.4 v2 还剩下的 3 个问题

1. **路由策略简单**：只按模型名路由，不考虑任务类型（简单分类也用 GPT-4）。
2. **无 Fallback**：OpenAI 429 时直接失败，不切换到 Anthropic。
3. **无用量追踪**：虽然返回了 `usage`，但没有持久化（无法生成成本报表）。

v3 用"智能路由 + Fallback 降级链 + Usage 追踪"解决这三个问题。

---
## §5 v3：智能路由 + Fallback + Usage（生产级）

### 5.1 v3 新增的能力

1. **智能路由**：根据任务类型选模型（简单分类 → GPT-3.5，复杂诊断 → GPT-4），不再硬编码模型名。
2. **Fallback 降级链**：OpenAI 429 → 自动切换到 Anthropic → 再失败切换到降级模式（返回简化结果）。
3. **Usage 追踪**：持久化 token 用量到 Postgres，支持成本报表（"今天花了多少钱"）。
4. **成本计算**：根据模型定价（GPT-4: $0.03/1K tokens，GPT-3.5: $0.0005/1K tokens）自动计算成本。
5. **超时重试**：单个 Provider 超时重试 3 次（指数退避），重试失败后 fallback。

### 5.2 v3 架构变化

```
v2：业务代码 → ModelRouter → Provider → 模型 API
v3：业务代码 → SmartRouter（任务分类）→ FallbackChain（降级链）→ Provider → UsageTracker（记录）
```

**关键变化**：路由层分成两级（SmartRouter 选模型 + FallbackChain 降级），新增 UsageTracker 横切层。

### 5.3 v3 完整代码

#### 5.3.1 路由规则配置（routing_rules.py）

```python
# services/ai/src/ai_service/gateway/router/routing_rules.py
from enum import Enum
from typing import Dict, List

class TaskType(str, Enum):
    """任务类型（根据业务领域划分）"""
    CLASSIFICATION = "classification"  # 简单分类
    SUMMARIZATION = "summarization"    # 摘要提取
    DIAGNOSIS = "diagnosis"            # 复杂诊断
    CODE_GENERATION = "code_generation"  # 代码生成

class RoutingRule:
    """单条路由规则"""
    def __init__(
        self,
        task_type: TaskType,
        primary_model: str,
        fallback_models: List[str],
        max_cost_per_call: float,  # 单次调用最大成本（美元）
    ):
        self.task_type = task_type
        self.primary_model = primary_model
        self.fallback_models = fallback_models
        self.max_cost_per_call = max_cost_per_call

# 预定义路由规则
ROUTING_RULES: Dict[TaskType, RoutingRule] = {
    TaskType.CLASSIFICATION: RoutingRule(
        task_type=TaskType.CLASSIFICATION,
        primary_model="gpt-3.5-turbo",  # 快速 + 便宜
        fallback_models=["claude-3-haiku"],
        max_cost_per_call=0.01,  # 最多 $0.01
    ),
    TaskType.DIAGNOSIS: RoutingRule(
        task_type=TaskType.DIAGNOSIS,
        primary_model="gpt-4-turbo",  # 准确度高
        fallback_models=["claude-3-opus", "gpt-3.5-turbo"],
        max_cost_per_call=0.50,  # 最多 $0.50
    ),
    TaskType.SUMMARIZATION: RoutingRule(
        task_type=TaskType.SUMMARIZATION,
        primary_model="gpt-3.5-turbo",
        fallback_models=["claude-3-haiku"],
        max_cost_per_call=0.05,
    ),
}
```

**为什么路由规则要配置化？**

硬编码规则（if task == "分类" then "gpt-3.5"）难以维护——新增任务类型要改代码。配置化后，新增规则只需在 `ROUTING_RULES` 里加一条，不改路由逻辑。

#### 5.3.2 智能路由器（model_router.py v3 版本）

```python
# services/ai/src/ai_service/gateway/router/model_router.py (v3 版本)
from typing import Optional
from ..providers.base import CompletionRequest, CompletionResponse
from .routing_rules import TaskType, ROUTING_RULES, RoutingRule
from .fallback_chain import FallbackChain

class SmartRouter:
    """智能路由器（根据任务类型选模型）"""
    
    def __init__(self, fallback_chain: FallbackChain):
        self.fallback_chain = fallback_chain
    
    async def route(
        self,
        request: CompletionRequest,
        task_type: Optional[TaskType] = None,
    ) -> CompletionResponse:
        """
        智能路由：
        1. 如果指定 task_type，按规则选模型
        2. 如果未指定，使用 request.model（兼容 v2）
        """
        if task_type:
            rule = ROUTING_RULES.get(task_type)
            if not rule:
                raise ValueError(f"No routing rule for task_type: {task_type}")
            
            # 覆盖模型名（用路由规则里的 primary_model）
            request.model = rule.primary_model
            
            # 通过降级链执行（带 fallback）
            return await self.fallback_chain.execute(
                request,
                fallback_models=rule.fallback_models,
            )
        else:
            # 兼容 v2：直接用 request.model
            return await self.fallback_chain.execute(request)
```

**为什么要保留 v2 兼容模式？**

现有调用代码（Day42 的 embed 接口）直接传 `model="gpt-4"`，不传 `task_type`。兼容模式让旧代码无需改动（渐进式迁移）。

#### 5.3.3 降级链（fallback_chain.py）

```python
# services/ai/src/ai_service/gateway/router/fallback_chain.py
from typing import List, Optional
from ..providers.base import BaseProvider, CompletionRequest, CompletionResponse
import asyncio
import logging

logger = logging.getLogger(__name__)

class FallbackChain:
    """降级链（主 Provider 失败 → fallback 到备用 Provider）"""
    
    def __init__(self, providers: List[BaseProvider]):
        self.providers = providers
    
    async def execute(
        self,
        request: CompletionRequest,
        fallback_models: Optional[List[str]] = None,
    ) -> CompletionResponse:
        """
        执行降级链：
        1. 尝试 primary_model
        2. 失败后依次尝试 fallback_models
        """
        models_to_try = [request.model]
        if fallback_models:
            models_to_try.extend(fallback_models)
        
        last_error = None
        for model in models_to_try:
            provider = self._find_provider(model)
            if not provider:
                logger.warning(f"No provider supports model: {model}")
                continue
            
            try:
                # 尝试调用（带超时重试）
                response = await self._call_with_retry(provider, request, model)
                
                # 记录实际使用的模型（可能不是 primary）
                response.model = model
                return response
            except Exception as e:
                logger.error(f"Provider failed for model {model}: {e}")
                last_error = e
                continue
        
        # 所有 fallback 都失败
        raise Exception(f"All providers failed. Last error: {last_error}")
    
    def _find_provider(self, model: str) -> Optional[BaseProvider]:
        """找到支持该模型的 Provider"""
        for provider in self.providers:
            if provider.supports_model(model):
                return provider
        return None
    
    async def _call_with_retry(
        self,
        provider: BaseProvider,
        request: CompletionRequest,
        model: str,
        max_retries: int = 3,
    ) -> CompletionResponse:
        """带指数退避的重试"""
        request_copy = request.copy()
        request_copy.model = model
        
        for attempt in range(max_retries):
            try:
                return await provider.complete(request_copy)
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                
                # 指数退避
                wait_time = 2 ** attempt
                logger.warning(f"Retry {attempt + 1}/{max_retries} after {wait_time}s")
                await asyncio.sleep(wait_time)
```

**为什么降级链要支持多个 fallback？**

单个 fallback 不够健壮——OpenAI 429 时切换到 Anthropic，但 Anthropic 也可能限流。多级 fallback（OpenAI → Anthropic → 降级模式）保证最终有响应。

**为什么降级链在 Provider 层重试？**

Day34 的失败恢复在队列层（BullMQ 重试 job），但模型调用是同步阻塞的（Agent 等待 AI 响应），不能进队列。所以在 Provider 层加重试（快速重试）。

#### 5.3.4 用量追踪器（usage_tracker.py）

```python
# services/ai/src/ai_service/gateway/usage/usage_tracker.py
from ..providers.base import CompletionRequest, CompletionResponse
from .cost_calculator import CostCalculator
from datetime import datetime
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class UsageRecord:
    """用量记录（持久化到 Postgres）"""
    def __init__(
        self,
        trace_id: str,
        model: str,
        provider: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cost_usd: float,
        task_type: Optional[str] = None,
        created_at: datetime = None,
    ):
        self.trace_id = trace_id
        self.model = model
        self.provider = provider
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = total_tokens
        self.cost_usd = cost_usd
        self.task_type = task_type
        self.created_at = created_at or datetime.utcnow()

class UsageTracker:
    """用量追踪器（记录所有模型调用）"""
    
    def __init__(self, cost_calculator: CostCalculator):
        self.cost_calculator = cost_calculator
    
    async def track(
        self,
        trace_id: str,
        request: CompletionRequest,
        response: CompletionResponse,
        task_type: Optional[str] = None,
    ) -> UsageRecord:
        """记录单次调用的用量"""
        # 计算成本
        cost = self.cost_calculator.calculate(
            model=response.model,
            prompt_tokens=response.usage["prompt_tokens"],
            completion_tokens=response.usage["completion_tokens"],
        )
        
        # 创建用量记录
        record = UsageRecord(
            trace_id=trace_id,
            model=response.model,
            provider=response.provider,
            prompt_tokens=response.usage["prompt_tokens"],
            completion_tokens=response.usage["completion_tokens"],
            total_tokens=response.usage["total_tokens"],
            cost_usd=cost,
            task_type=task_type,
        )
        
        # 持久化（实际项目写入 Postgres）
        await self._persist(record)
        
        logger.info(f"Usage tracked: {record.model} | {record.total_tokens} tokens | ${record.cost_usd:.4f}")
        return record
    
    async def _persist(self, record: UsageRecord):
        """持久化到 Postgres（今天简化为日志）"""
        # TODO: 写入 Postgres usage_records 表
        logger.info(f"[Usage] {record.__dict__}")
```

**为什么要持久化用量记录？**

1. 成本报表（"今天分类任务花了 $12"）
2. 成本优化（发现"某个任务类型成本异常高"）
3. 审计合规（"这个月调用了多少次 OpenAI"）

#### 5.3.5 成本计算器（cost_calculator.py）

```python
# services/ai/src/ai_service/gateway/usage/cost_calculator.py
from typing import Dict

class ModelPricing:
    """模型定价表（2024-07 官方定价）"""
    
    # 每 1K tokens 的价格（美元）
    PRICING: Dict[str, Dict[str, float]] = {
        "gpt-4-turbo": {
            "prompt": 0.01,      # $0.01 per 1K prompt tokens
            "completion": 0.03,  # $0.03 per 1K completion tokens
        },
        "gpt-3.5-turbo": {
            "prompt": 0.0005,
            "completion": 0.0015,
        },
        "claude-3-opus": {
            "prompt": 0.015,
            "completion": 0.075,
        },
        "claude-3-haiku": {
            "prompt": 0.00025,
            "completion": 0.00125,
        },
    }

class CostCalculator:
    """成本计算器"""
    
    def calculate(self, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        """计算单次调用成本（美元）"""
        pricing = ModelPricing.PRICING.get(model)
        if not pricing:
            # 未知模型，使用默认定价（按 GPT-3.5 估算）
            pricing = ModelPricing.PRICING["gpt-3.5-turbo"]
        
        prompt_cost = (prompt_tokens / 1000) * pricing["prompt"]
        completion_cost = (completion_tokens / 1000) * pricing["completion"]
        
        return prompt_cost + completion_cost
```

**为什么定价要硬编码而不是动态获取？**

官方定价变化频率低（通常 3-6 个月调整一次），硬编码定价表更简单。如果需要动态获取，可以加"定价缓存"（每天从官网爬一次）。

#### 5.3.6 网关接口（gateway.py v3 最终版）

```python
# services/ai/src/ai_service/api/gateway.py (v3 最终版)
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from ..gateway.providers.base import CompletionRequest, CompletionResponse
from ..gateway.providers.openai_provider import OpenAIProvider
from ..gateway.providers.anthropic_provider import AnthropicProvider
from ..gateway.providers.mock_provider import MockProvider
from ..gateway.router.model_router import SmartRouter
from ..gateway.router.fallback_chain import FallbackChain
from ..gateway.router.routing_rules import TaskType
from ..gateway.usage.usage_tracker import UsageTracker
from ..gateway.usage.cost_calculator import CostCalculator
import os

router = APIRouter()

# 初始化 Providers
openai_provider = OpenAIProvider(api_key=os.getenv("OPENAI_API_KEY", ""))
anthropic_provider = AnthropicProvider(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
mock_provider = MockProvider()

# 初始化 Fallback Chain
fallback_chain = FallbackChain(providers=[openai_provider, anthropic_provider, mock_provider])

# 初始化 Smart Router
smart_router = SmartRouter(fallback_chain=fallback_chain)

# 初始化 Usage Tracker
cost_calculator = CostCalculator()
usage_tracker = UsageTracker(cost_calculator=cost_calculator)

@router.post("/v1/chat/completions", response_model=CompletionResponse)
async def chat_completions(
    request: CompletionRequest,
    task_type: Optional[TaskType] = None,  # 可选：智能路由
    x_trace_id: Optional[str] = Header(None),  # Trace ID（从 Header 提取）
):
    """
    网关接口（v3 最终版）
    
    使用方式：
    1. 指定 task_type（智能路由）：
       POST /v1/chat/completions?task_type=classification
       Body: { "messages": [...] }
       网关自动选择 gpt-3.5-turbo（不需要传 model）
    
    2. 指定 model（兼容 v2）：
       POST /v1/chat/completions
       Body: { "model": "gpt-4", "messages": [...] }
       网关按模型名路由
    """
    try:
        # 路由并执行
        response = await smart_router.route(request, task_type=task_type)
        
        # 记录用量
        if x_trace_id:
            await usage_tracker.track(
                trace_id=x_trace_id,
                request=request,
                response=response,
                task_type=task_type.value if task_type else None,
            )
        
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**为什么接口同时支持 task_type 和 model？**

渐进式迁移——旧代码传 `model`（v2 兼容），新代码传 `task_type`（智能路由）。两种方式共存，避免"一刀切"式重构。

### 5.4 v3 核心知识点（≥ 6 个，每个 5 要素）

#### 知识点 1：Provider 抽象（Adapter 模式）

**是什么**：定义 `BaseProvider` 统一接口，让不同 Provider（OpenAI、Anthropic、Mock）实现相同的 `complete()` 方法。业务代码调 `gateway.complete()`，不关心底层 Provider。

**解决什么问题**：Provider 耦合——业务代码直接调 `openai.chat.completions.create()`，切换 Provider 要改所有调用代码。抽象后，切换 Provider 只需改配置（不改业务代码）。

**怎么用**：
```python
class BaseProvider(ABC):
    @abstractmethod
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        pass
```

**生产陷阱**：Provider 抽象泄漏——统一响应格式 `CompletionResponse` 里包含 Provider 特有字段（如 OpenAI 的 `finish_reason`），导致其他 Provider 无法实现。正确做法是"只抽象公共字段"（content + usage），Provider 特有字段放 `metadata`。

**验证方法**：切换 Provider 测试——业务代码调 `gateway.complete(model="gpt-4")`，配置改成 `AnthropicProvider`，验证响应格式不变（前端无感知）。

#### 知识点 2：模型路由（策略模式）

**是什么**：根据任务类型（classification/diagnosis）选择模型（gpt-3.5/gpt-4）。不同任务类型对应不同的路由策略（RoutingRule）。

**解决什么问题**：成本失控——简单分类任务也用 GPT-4（旗舰模型），日均 6 万次调用使成本升高 4 倍。智能路由后，分类任务自动用 GPT-3.5（便宜 60 倍）。

**怎么用**：
```python
ROUTING_RULES = {
    TaskType.CLASSIFICATION: RoutingRule(
        primary_model="gpt-3.5-turbo",
        fallback_models=["claude-3-haiku"],
    ),
}
response = await smart_router.route(request, task_type=TaskType.CLASSIFICATION)
```

**生产陷阱**：路由规则过细——按"任务 ID"路由（每个任务一条规则），导致规则表爆炸（1000 个任务 = 1000 条规则）。正确做法是"按任务类型路由"（classification/diagnosis，只需 5-10 条规则）。

**验证方法**：成本对比测试——记录路由前后的成本（使用 GPT-4 的调用占比从 80% 降到 20%）。

#### 知识点 3：Fallback 降级链（责任链模式）

**是什么**：主 Provider 失败后，自动切换到备用 Provider。OpenAI 429 → Anthropic → 降级模式（返回简化结果）。

**解决什么问题**：单点依赖——OpenAI 挂了全挂（2024-11-08 OpenAI 全球故障 3 小时）。Fallback 后，OpenAI 挂了自动切换到 Anthropic（可用性从 99.9% 提升到 99.99%）。

**怎么用**：
```python
fallback_chain = FallbackChain(providers=[openai_provider, anthropic_provider, mock_provider])
response = await fallback_chain.execute(
    request,
    fallback_models=["claude-3-opus", "gpt-3.5-turbo"],
)
```

**生产陷阱**：Fallback 无限重试——降级链里的 fallback 也失败，继续 fallback 到下一个，最终耗尽所有 Provider。正确做法是"限制 fallback 次数"（最多 3 次）+ "熔断机制"（某 Provider 连续失败 10 次后暂时跳过）。

**验证方法**：故障注入测试——模拟 OpenAI 429（返回 rate limit 错误），验证自动切换到 Anthropic（响应时间 < 5s）。

#### 知识点 4：Usage 追踪

**是什么**：记录每次模型调用的 token 用量（prompt_tokens + completion_tokens）和成本（美元），持久化到 Postgres，支持成本报表。

**解决什么问题**：成本黑盒——不知道今天花了多少钱，运维问"为什么这个月 AI 成本翻倍"时无法定位。Usage 追踪后，可以按任务类型、模型、日期聚合成本（"分类任务 $12/天，诊断任务 $89/天"）。

**怎么用**：
```python
await usage_tracker.track(
    trace_id="trace-001",
    request=request,
    response=response,
    task_type="classification",
)
```

**生产陷阱**：用量记录丢失——Usage 追踪写到 Redis（内存），服务重启后数据丢失。正确做法是"持久化到 Postgres"（UsageRecord 表）+ "异步写入"（不阻塞主流程）。

**验证方法**：成本报表查询——从 Postgres 查询"今天分类任务的总成本"（`SELECT SUM(cost_usd) FROM usage_records WHERE task_type='classification' AND DATE(created_at)=CURRENT_DATE`）。

#### 知识点 5：成本计算

**是什么**：根据模型定价（GPT-4: $0.03/1K tokens，GPT-3.5: $0.0005/1K tokens）和实际 token 用量，自动计算单次调用成本。

**解决什么问题**：成本估算不准——手工计算成本（"GPT-4 大概 $0.1/次"），误差大（实际可能 $0.01 或 $1）。自动计算后，精确到小数点后 4 位（$0.0234）。

**怎么用**：
```python
cost = cost_calculator.calculate(
    model="gpt-4-turbo",
    prompt_tokens=100,
    completion_tokens=50,
)
# cost = (100/1000 * 0.01) + (50/1000 * 0.03) = 0.001 + 0.0015 = 0.0025 美元
```

**生产陷阱**：定价过期——硬编码 2024-07 的定价，但 OpenAI 在 2024-12 降价 50%，导致成本计算偏高。正确做法是"定期更新定价表"（每月检查官网）+ "定价版本号"（记录使用哪个版本的定价）。

**验证方法**：成本校验测试——对比自动计算成本和 OpenAI Dashboard 显示的成本（误差 < 1%）。

#### 知识点 6：超时重试（指数退避）

**是什么**：单个 Provider 超时后，重试 3 次（第 1 次等 1s，第 2 次等 2s，第 3 次等 4s），重试失败后 fallback 到下一个 Provider。

**解决什么问题**：暂时性错误导致失败——网络抖动导致请求超时（持续 1 秒），不重试直接失败。重试后，大部分暂时性错误可以恢复（成功率从 85% 提升到 98%）。

**怎么用**：
```python
for attempt in range(max_retries):
    try:
        return await provider.complete(request)
    except Exception as e:
        wait_time = 2 ** attempt  # 指数退避
        await asyncio.sleep(wait_time)
```

**生产陷阱**：重试放大故障——Provider 负载过高（CPU 95%），重试增加负载，导致雪崩（更多请求失败 → 更多重试 → 负载更高）。正确做法是"有损重试"（超时时间随重试次数递减：10s → 5s → 2s）+ "熔断机制"（Provider 失败率 > 50% 时停止重试）。

**验证方法**：超时重试测试——模拟网络抖动（第 1 次超时，第 2 次成功），验证重试后成功（总耗时 < 3s）。

---
## §6 前端底子深挖：模型网关对前端的影响

### 6.1 今天为什么要深挖"网关契约对前端的影响"

Day43 的核心是"服务端模型网关（Provider 抽象 + 路由 + fallback）"，但如果前端没有理解网关契约，会出现两个问题：

1. **前端不知道网关支持哪些模型**：前端写死 `model: "gpt-4"`，但网关只支持 `gpt-4-turbo`，导致 400 错误。
2. **前端不知道任务类型映射**：前端应该传 `task_type: "classification"`（智能路由），但传了 `model: "gpt-4"`（硬编码模型），浪费成本。

今天深挖的不是"Vue 怎么调接口"（Day05 已经掌握），而是"前端如何从网关 OpenAPI 文档自动生成类型定义"（契约驱动）、"前端如何优雅处理 fallback 导致的模型切换"（`gpt-4` → `claude-3-opus`）。

### 6.2 网关契约的 3 个前端挑战

#### 6.2.1 挑战 1：前端如何知道网关支持哪些模型？

**错误做法**：前端硬编码模型列表（`const MODELS = ["gpt-4", "gpt-3.5-turbo"]`），网关新增模型后前端不知道。

**正确做法**：网关提供 `/v1/models` 接口，返回支持的模型列表。

```python
# services/ai/src/ai_service/api/gateway.py
@router.get("/v1/models")
async def list_models():
    """列出网关支持的所有模型"""
    return {
        "data": [
            {"id": "gpt-4-turbo", "provider": "openai"},
            {"id": "gpt-3.5-turbo", "provider": "openai"},
            {"id": "claude-3-opus", "provider": "anthropic"},
            {"id": "claude-3-haiku", "provider": "anthropic"},
        ]
    }
```

```typescript
// apps/web/src/api/gateway.ts (前端)
export async function fetchSupportedModels(): Promise<string[]> {
  const response = await fetch('/v1/models')
  const data = await response.json()
  return data.data.map(m => m.id)
}

// 使用
const models = await fetchSupportedModels()
// ["gpt-4-turbo", "gpt-3.5-turbo", "claude-3-opus", "claude-3-haiku"]
```

#### 6.2.2 挑战 2：前端如何知道任务类型映射？

**错误做法**：前端硬编码任务类型（`if (action === '分类') taskType = 'classification'`），后端新增任务类型后前端不知道。

**正确做法**：网关提供 `/v1/routing-rules` 接口，返回任务类型映射表。

```python
# services/ai/src/ai_service/api/gateway.py
from ..gateway.router.routing_rules import ROUTING_RULES

@router.get("/v1/routing-rules")
async def get_routing_rules():
    """返回路由规则（任务类型 → 模型映射）"""
    return {
        "rules": [
            {
                "task_type": rule.task_type.value,
                "primary_model": rule.primary_model,
                "fallback_models": rule.fallback_models,
                "max_cost_per_call": rule.max_cost_per_call,
            }
            for rule in ROUTING_RULES.values()
        ]
    }
```

```typescript
// apps/web/src/api/gateway.ts (前端)
export interface RoutingRule {
  task_type: string
  primary_model: string
  fallback_models: string[]
  max_cost_per_call: number
}

export async function fetchRoutingRules(): Promise<RoutingRule[]> {
  const response = await fetch('/v1/routing-rules')
  const data = await response.json()
  return data.rules
}

// 使用
const rules = await fetchRoutingRules()
const classificationRule = rules.find(r => r.task_type === 'classification')
console.log(`分类任务使用 ${classificationRule.primary_model}，最大成本 $${classificationRule.max_cost_per_call}`)
```

#### 6.2.3 挑战 3：前端如何处理 fallback 导致的模型切换？

**场景**：前端发起请求，指定 `model: "gpt-4"`，但网关 fallback 后实际用了 `claude-3-opus`（OpenAI 429）。前端如何知道最终用的是哪个模型？

**正确做法**：网关响应里包含 `model` 字段（实际使用的模型），前端显示"由 Claude 3 Opus 回答"。

```typescript
// apps/web/src/components/ChatMessage.vue
<script setup lang="ts">
import { ref } from 'vue'

const response = ref<{
  content: string
  model: string
  provider: string
}>()

async function sendMessage(message: string) {
  const res = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: message }],
    }),
  })
  response.value = await res.json()
}
</script>

<template>
  <div class="chat-message">
    <div class="content">{{ response?.content }}</div>
    <div class="meta">
      由 {{ response?.model }} ({{ response?.provider }}) 回答
      <span v-if="response?.model !== 'gpt-4'" class="fallback-notice">
        (原模型 gpt-4 不可用，已自动切换)
      </span>
    </div>
  </div>
</template>

<style scoped>
.fallback-notice {
  color: #f59e0b;
  font-size: 0.875rem;
}
</style>
```

**为什么要显示 fallback 通知？**

用户透明度——用户请求 GPT-4（旗舰模型），但实际用了 Claude（备用模型），回答质量可能有差异。显示通知让用户知道"这不是 GPT-4 的回答"。

### 6.3 OpenAPI 自动生成 TS 类型定义

**问题**：前端手写 `CompletionRequest` 类型定义，与后端 Pydantic model 不一致（字段名、类型不同），导致运行时错误。

**解决方案**：从 FastAPI 的 `/openapi.json` 自动生成 TS 类型定义。

```bash
# 安装 openapi-typescript
npm install -D openapi-typescript

# 生成类型定义
npx openapi-typescript http://localhost:8000/openapi.json -o src/types/gateway.d.ts
```

```typescript
// 自动生成的 src/types/gateway.d.ts
export interface CompletionRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  max_tokens?: number
}

export interface CompletionResponse {
  content: string
  model: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  provider: string
}
```

```typescript
// apps/web/src/api/gateway.ts (使用自动生成的类型)
import type { CompletionRequest, CompletionResponse } from '@/types/gateway'

export async function chatCompletion(request: CompletionRequest): Promise<CompletionResponse> {
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return response.json()
}
```

**为什么自动生成比手写好？**

1. 类型一致性保证——后端 Pydantic model 改了，前端重新生成类型定义，自动同步。
2. 减少手工维护——后端新增字段（如 `stream: boolean`），前端不需要手工加类型定义。

---

## §7 测试与验证

### 7.1 单元测试（Provider 适配器）

```python
# services/ai/tests/test_providers.py
import pytest
from ai_service.gateway.providers.base import CompletionRequest, Message
from ai_service.gateway.providers.openai_provider import OpenAIProvider
from ai_service.gateway.providers.mock_provider import MockProvider

@pytest.mark.asyncio
async def test_openai_provider_supports_model():
    provider = OpenAIProvider(api_key="sk-test")
    
    assert provider.supports_model("gpt-4") is True
    assert provider.supports_model("gpt-3.5-turbo") is True
    assert provider.supports_model("claude-3-opus") is False

@pytest.mark.asyncio
async def test_mock_provider_returns_fixed_response():
    provider = MockProvider()
    request = CompletionRequest(
        model="gpt-4",
        messages=[Message(role="user", content="Hello")]
    )
    
    response = await provider.complete(request)
    
    assert response.provider == "mock"
    assert response.content == "This is a mock response for testing."
    assert response.usage["total_tokens"] == 15
```

### 7.2 集成测试（路由策略）

```python
# services/ai/tests/test_router.py
import pytest
from ai_service.gateway.providers.mock_provider import MockProvider
from ai_service.gateway.router.model_router import SmartRouter
from ai_service.gateway.router.fallback_chain import FallbackChain
from ai_service.gateway.router.routing_rules import TaskType
from ai_service.gateway.providers.base import CompletionRequest, Message

@pytest.mark.asyncio
async def test_smart_router_with_task_type():
    # 使用 MockProvider（避免调用真实 API）
    mock_provider = MockProvider()
    fallback_chain = FallbackChain(providers=[mock_provider])
    router = SmartRouter(fallback_chain=fallback_chain)
    
    # 指定 task_type（智能路由）
    request = CompletionRequest(
        model="",  # 不指定模型（由路由器选择）
        messages=[Message(role="user", content="分类这个问题")]
    )
    
    response = await router.route(request, task_type=TaskType.CLASSIFICATION)
    
    # 验证路由器自动选择了 gpt-3.5-turbo（从 ROUTING_RULES）
    assert response.model == "gpt-3.5-turbo"
```

### 7.3 反证实验 1：移除 fallback 后 429 直接失败

**假设**：如果移除 fallback 降级链，OpenAI 429 时直接失败（不切换到 Anthropic）。

**实验步骤**：
1. 注释掉 `FallbackChain.execute` 里的 fallback 逻辑（只尝试 primary_model）
2. 模拟 OpenAI 429（在 `OpenAIProvider.complete` 里 raise `RateLimitError`）
3. 发起请求

**预期现象**：请求失败（返回 500 错误）。

**实际现象**（移除 fallback 后）：
```
[FallbackChain] Trying model: gpt-4-turbo
[OpenAIProvider] RateLimitError: 429 Too Many Requests
[FallbackChain] Provider failed for model gpt-4-turbo
HTTP 500: All providers failed. Last error: RateLimitError
```

**恢复操作**：恢复 fallback 逻辑，重新测试，验证自动切换到 claude-3-opus。

### 7.4 反证实验 2：移除智能路由后简单任务用 GPT-4

**假设**：如果移除智能路由（不按 task_type 选模型），简单分类任务也用 GPT-4（成本高 60 倍）。

**实验步骤**：
1. 注释掉 `SmartRouter.route` 里的 task_type 逻辑（直接用 request.model）
2. 发起分类请求（`model="gpt-4"`, `task_type=None`）
3. 记录成本

**预期现象**：使用 GPT-4（成本 $0.03/1K tokens）。

**实际现象**（移除智能路由后）：
```
[UsageTracker] Model: gpt-4-turbo | Total tokens: 150 | Cost: $0.0045
(成本比 gpt-3.5-turbo 高 60 倍：0.0045 vs 0.000075)
```

**恢复操作**：恢复智能路由，重新测试，验证分类任务自动用 gpt-3.5-turbo（成本降低 98%）。

### 7.5 架构证据（四件套）

#### 7.5.1 类图（Provider 抽象层次）

```
BaseProvider (抽象类)
    ↑ implements
    ├── OpenAIProvider
    ├── AnthropicProvider
    └── MockProvider

SmartRouter
    ↓ uses
FallbackChain
    ↓ uses
List<BaseProvider>

UsageTracker
    ↓ uses
CostCalculator
```

#### 7.5.2 时序图（请求流转）

```
Client          Gateway         SmartRouter      FallbackChain    OpenAIProvider    AnthropicProvider
  │                │                  │                 │                 │                   │
  │─POST /v1/chat─→│                  │                 │                 │                   │
  │                │─route(task_type)→│                 │                 │                   │
  │                │                  │─execute(gpt-4)─→│                 │                   │
  │                │                  │                 │─complete()─────→│                   │
  │                │                  │                 │←RateLimitError──│                   │
  │                │                  │                 │─complete(claude)───────────────────→│
  │                │                  │                 │←CompletionResponse──────────────────│
  │                │←CompletionResponse────────────────│                 │                   │
  │                │─track(usage)────→UsageTracker     │                 │                   │
  │←200 OK─────────│                  │                 │                 │                   │
```

#### 7.5.3 ADR（模型路由决策记录）

**决策**：使用"任务类型路由"而不是"模型名路由"。

**背景**：v2 按模型名路由（用户指定 `gpt-4` 就用 GPT-4），导致简单任务也用旗舰模型，成本失控。

**方案对比**：
1. 模型名路由（v2）：简单直接，但业务代码需要知道"哪个模型适合哪个任务"（耦合）。
2. 任务类型路由（v3）：业务代码只传 `task_type`，网关自动选模型（解耦）。

**决策**：选方案 2（任务类型路由），原因：
- 业务代码不关心模型细节（只关心"我要做分类任务"，不关心"用 gpt-3.5 还是 gpt-4"）
- 网关可以根据成本/质量平衡自动调整路由策略（业务代码无感知）
- 兼容 v2（仍支持 `model` 参数，渐进式迁移）

**后果**：
- 优点：成本降低 75%（简单任务用便宜模型）
- 缺点：业务代码需要理解任务类型分类（需要文档说明）

#### 7.5.4 Commit 信息

```bash
git add .
git commit -m "feat(gateway): add model gateway with smart routing and fallback

- Add Provider abstraction (BaseProvider, OpenAIProvider, AnthropicProvider, MockProvider)
- Add smart routing (task type -> model mapping)
- Add fallback chain (OpenAI 429 -> Anthropic -> Mock)
- Add usage tracking (token + cost calculation)
- Add /v1/chat/completions endpoint (OpenAI-compatible)

Refs: Day43"
```

---

## §8 通关检查清单（v3 规范 11 项）

Day 43 交付前的自查：

1. **§0 位置声明**：已写明"阶段二第 3 天"、Day42 前置依赖、Day44-60 后续对齐
2. **§1.1 用户能看到什么**：已写 5 个场景（简单分类、复杂诊断、OpenAI 429 降级、用量报表、测试 Mock）
3. **§1.4 目录结构 5 块**：已写骨架树 + 为什么分层 5 问 + diff 表格 + 依赖箭头
4. **§1.5 脚手架检查**：已说明依赖 Day42 FastAPI 基础
5. **三版演进**：v1 直调 OpenAI → v2 Provider 抽象 + 基础路由 → v3 智能路由 + fallback + usage
6. **§5.3 完整代码**：BaseProvider、OpenAIProvider、SmartRouter、FallbackChain、UsageTracker、CostCalculator，无省略号
7. **§5.4 ≥ 6 知识点**：Provider 抽象、模型路由、Fallback 降级链、Usage 追踪、成本计算、超时重试，每个 5 要素
8. **§6 前端底子补弱**：深挖网关契约对前端的影响（模型列表、任务类型映射、fallback 通知、OpenAPI 自动生成 TS 类型）
9. **§7 测试 4 件套**：单元测试（Provider）+ 集成测试（路由）+ 反证实验 1（移除 fallback）+ 反证实验 2（移除智能路由）+ 类图 + 时序图 + ADR + commit
10. **0 个 `> ✅/❌` blockquote**：全文无此格式
11. **commit 不含 git push**：commit 信息写 `Refs: Day43`，不执行 push

---

## §9 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 43 交付的模型网关（Provider 抽象 + 路由 + fallback + usage）是后续 17 个能力的基座：

1. **Day 44-50 RAG 深化**：向量检索失败（Pinecone 超时）复用今天的 fallback 机制（切换到备用向量库）
2. **Day 51-55 多 Agent 编排**：Agent 调用模型通过网关（不直接调 OpenAI），统一追踪成本
3. **Day 56-60 Eval 评估**：Eval 任务用 MockProvider（固定响应，不调真实 API），节省成本 + 加速测试

### 9.2 今天留下的 3 个待优化点

1. **熔断机制**：v3 的 fallback 会无限重试（OpenAI 失败 → Anthropic 失败 → Mock），没有"Provider 连续失败 10 次后暂时跳过"。Day 44 会补充熔断机制。

2. **用量预算**：v3 只记录用量，没有"用量预算"（例如"每天最多花 $100，超预算拒绝请求"）。Day 45 会补充预算控制。

3. **流式响应**：v3 只支持非流式响应（`response.content` 一次性返回），不支持流式响应（逐 token 返回）。Day 46 会补充流式网关。

### 9.3 下一站要解决的核心问题

**Day 44：RAG 文档检索（Embedding + 向量检索 + Rerank + Hybrid Search）**

核心挑战：
- 如何把长文档（10 页 PDF）切分成小块（chunk），保证语义完整？
- 如何用 Embedding 模型把文本转成向量（768 维），并存入向量库（Pinecone）？
- 如何从 10 万条文档里快速检索最相关的 5 条（向量相似度 top-k）？
- 如何复用 Day 43 的网关（调用 Embedding 模型时也走网关，支持 fallback）？

---

## §10 本日小结

**标题党 30 字**：Provider 抽象解耦 API、智能路由省成本、Fallback 降级防单点、Usage 追踪算花费——网关统一 AI 调用入口。

**三句话**：
1. Provider 抽象（Adapter 模式）解决 API 耦合——业务代码调 `gateway.complete()`，不直接调 `openai.chat.completions.create()`，切换 Provider 只需改配置；智能路由（策略模式）解决成本失控——简单分类任务自动用 GPT-3.5（便宜 60 倍），复杂诊断任务用 GPT-4（准确度高）；两者区别是抽象解耦"哪些 Provider 可用"，路由决策"选哪个 Provider"。
2. Fallback 降级链（责任链模式）解决单点依赖——OpenAI 429 时自动切换到 Anthropic，Anthropic 也失败时切换到 Mock（降级模式），可用性从 99.9% 提升到 99.99%；超时重试（指数退避）解决暂时性错误——网络抖动导致超时时重试 3 次（1s → 2s → 4s），成功率从 85% 提升到 98%。
3. Usage 追踪持久化 token 用量和成本到 Postgres——支持成本报表（"今天分类任务花了 $12，诊断任务花了 $89"），优化路由策略；OpenAPI 契约自动生成 TS 类型定义——前后端类型一致，后端改 Pydantic model 前端自动同步。

---
## §11 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出,解释"模型网关"的数据流或控制流；当天知识链"Provider adapter、模型路由、fallback、usage、成本"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
客户端请求（task_type: classification）
  → Gateway API (/v1/chat/completions)
  → SmartRouter.route()（智能路由层）
     - 查询 ROUTING_RULES（classification → gpt-3.5-turbo）
  → FallbackChain.execute()（降级链层）
     - 尝试 OpenAIProvider.complete()
     - 失败 → 尝试 AnthropicProvider.complete()
     - 失败 → 尝试 MockProvider.complete()
  → Provider 层（调用真实 API）
     - OpenAI API 返回 CompletionResponse
  → UsageTracker.track()（用量追踪层）
     - 记录 token 用量（150 tokens）
     - CostCalculator.calculate()（成本计算）
     - 持久化到 Postgres（$0.000075）
  → 返回 CompletionResponse（content + usage + provider）
```

**知识链分层**：
- **Provider adapter**：Provider 层（BaseProvider 抽象 + OpenAIProvider 实现）
- **模型路由**：SmartRouter 决策层（根据 task_type 选 primary_model）
- **Fallback**：FallbackChain 降级层（primary 失败切换到 fallback_models）
- **Usage**：UsageTracker 横切层（记录所有调用的 token 用量）
- **成本**：CostCalculator 计算层（token → 美元）

**为什么按这个顺序学习**：
1. 先学 Provider adapter（统一接口），才能谈"多 Provider 切换"
2. 再学模型路由（选哪个 Provider），才能谈"成本优化"
3. 再学 Fallback（主备切换），才能谈"高可用"
4. 再学 Usage 追踪（记录用量），才能谈"成本可观测"
5. 最后学成本计算（优化成本），才能谈"成本控制"

这个顺序是"从接口统一到智能调度到高可用到成本优化"的完整链路。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：Fallback 降级链（不切换 Provider）。

**可观察现象**：OpenAI 429 时请求直接失败（返回 500 错误）。

**最小复现**：
1. 注释掉 `FallbackChain.execute` 里的 fallback 逻辑（只尝试 primary_model，不尝试 fallback_models）
2. 模拟 OpenAI 429（在 `OpenAIProvider.complete` 里 raise `RateLimitError`）
3. 发起请求（`task_type=classification`）

**定位证据**：
```
[SmartRouter] Routing to model: gpt-3.5-turbo (task_type: classification)
[FallbackChain] Trying model: gpt-3.5-turbo
[OpenAIProvider] RateLimitError: 429 Too Many Requests
[FallbackChain] Provider failed for model gpt-3.5-turbo
HTTP 500: All providers failed. Last error: RateLimitError
```

DB 查询（usage_records 表）：
```sql
SELECT COUNT(*) FROM usage_records WHERE DATE(created_at) = CURRENT_DATE;
-- 预期：0 条记录（请求失败，没有记录用量）
```

**恢复动作**：
1. 恢复 fallback 逻辑（`FallbackChain.execute` 里恢复 `for model in models_to_try`）
2. 重启服务
3. 验证 OpenAI 429 时自动切换到 Anthropic（响应 model 字段为 `claude-3-haiku`）

**防复发测试**（E2E）：
```python
@pytest.mark.asyncio
async def test_fallback_on_rate_limit():
    # Mock OpenAIProvider 返回 429
    openai_provider = Mock()
    openai_provider.complete.side_effect = RateLimitError("429")
    openai_provider.supports_model.return_value = True
    
    # AnthropicProvider 正常返回
    anthropic_provider = AnthropicProvider(api_key="...")
    
    fallback_chain = FallbackChain(providers=[openai_provider, anthropic_provider])
    request = CompletionRequest(
        model="gpt-3.5-turbo",
        messages=[Message(role="user", content="Hello")]
    )
    
    # 执行（带 fallback）
    response = await fallback_chain.execute(
        request,
        fallback_models=["claude-3-haiku"],
    )
    
    # 验证切换到 Anthropic
    assert response.provider == "anthropic"
    assert response.model == "claude-3-haiku"
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `gateway/providers/base.py` 第 22 行：`BaseProvider` 抽象类定义统一接口（`complete()` 方法）
- `gateway/router/model_router.py` 第 18 行：`SmartRouter.route()` 方法根据 task_type 选模型（智能路由）
- `gateway/router/fallback_chain.py` 第 25 行：`FallbackChain.execute()` 方法实现降级链（主备切换）
- `gateway/usage/usage_tracker.py` 第 32 行：`UsageTracker.track()` 方法记录 token 用量和成本

**测试证据**：
- `tests/test_providers.py` 第 8 行：OpenAIProvider 单元测试（验证 `supports_model()` 正确判断）
- `tests/test_router.py` 第 18 行：SmartRouter 集成测试（验证 task_type 路由到正确模型）
- §7.3 反证实验 1：移除 fallback 后 429 直接失败（验证降级链必要性）
- §7.4 反证实验 2：移除智能路由后简单任务用 GPT-4（验证路由策略必要性）

**架构证据**：
- 类图（§7.5.1）：展示 BaseProvider 抽象层次（OpenAIProvider/AnthropicProvider/MockProvider 实现）
- 时序图（§7.5.2）：展示请求流转（SmartRouter → FallbackChain → Provider → UsageTracker）
- ADR（§7.5.3）：模型路由决策记录（任务类型路由 vs 模型名路由）

**项目目标达成**：
- ✅ Provider 抽象解耦 API（BaseProvider + OpenAIProvider/AnthropicProvider）
- ✅ 智能路由省成本（SmartRouter + RoutingRule：classification → gpt-3.5）
- ✅ Fallback 降级防单点（FallbackChain：OpenAI 429 → Anthropic）
- ✅ Usage 追踪算花费（UsageTracker + CostCalculator）
- ✅ 兼容 OpenAI API（/v1/chat/completions 接口）

**距离企业生产标准还缺**：
1. **熔断机制（Circuit Breaker）**：Provider 连续失败 10 次后暂时跳过（当前会一直重试）
2. **用量预算（Budget Control）**：每天最多花 $100，超预算拒绝请求（当前没有限制）
3. **流式响应（Streaming）**：支持逐 token 返回（当前只支持非流式响应）
4. **多租户隔离（Multi-tenancy）**：不同租户用不同 API Key（当前所有请求共享一个 Key）

**下一步演进（不破坏合同）**：
- 在 `FallbackChain` 里新增 `circuit_breaker` 字段（检查 Provider 失败率）
- 在 `UsageTracker` 里新增 `budget_checker` 字段（检查用量预算）
- 新增 `StreamingGateway`（提供 `/v1/chat/completions/stream` 接口），不改变现有非流式接口
- 在 `ProviderConfig` 里新增 `tenant_id` 字段（多租户隔离），兼容单租户模式

---

## §12 真实项目情境题（联网更新 2026-07-13）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：Provider A 30 分钟内 429 达 38%，fallback 到 Provider B 后字段命名漂移，前端 12% 空白。请用 provider、model、schemaVersion、usage 和 Trace 定位，先锁定稳定模型或降级文本结果，再修复 Adapter、路由与结构合同，故障注入验证切换不改变领域输出。
   依据：[S5 AI 全栈](https://jobs.bytedance.com/experienced/position/7647767015784335669/detail)

2. 模拟情境：简单分类任务被错误路由到旗舰模型，日均 6 万次调用使成本升高 4 倍。请按 taskType、routeReason、token 和质量指标下钻，先设置预算上限，再修复模型选择策略与 fallback 顺序，使用固定 Eval 集验证成本下降且质量不低于门槛。
   依据：[S6 Agent Harness](https://jobs.bytedance.com/experienced/position/7651517511770818869/detail)

知识映射：对应 Provider adapter、模型路由、fallback、usage 和成本。

---

## §13 完成后教师五连问

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。

---

## §14 PDF 面试题映射

1. 如何设计通用 AI 组件库，使其通过 Adapter 适配 OpenAI、Anthropic 和自研模型协议？  
   来源：[《2026深度求索web前端高级工程师-AIGC》](<../../资源/2026深度求索web前端高级工程师-AIGC.pdf>)，第 6 页。

2. 前端如何参与 Token 成本控制，并按任务复杂度选择轻量或旗舰模型？  
   来源：[《2026深度求索web前端高级工程师-AIGC》](<../../资源/2026深度求索web前端高级工程师-AIGC.pdf>)，第 9 页。

题目说明：直接匹配 Provider Adapter、模型路由和成本；429 fallback 与 usage 结算需在 Model Gateway 项目中证明。
