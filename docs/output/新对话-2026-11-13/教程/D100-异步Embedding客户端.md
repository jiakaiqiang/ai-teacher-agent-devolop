# D100（周二）：异步Embedding客户端

第 15 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D99-FastAPI与服务契约.md)。

## 今天要做出什么

用重复片段和不同长度的文本调用异步编码客户端，保存每批向量的维度与对应位置。

## 今天的目录结构

- `python/bridge/ops_bridge/embedding.py`
- `python/bridge/ops_bridge/http_app.py`
- `python/bridge/ops_bridge/http_contracts.py`
- `python/bridge/tests/test_embedding.py`

## 零、闭卷回忆

**D99**　Node 与 Python 对空数组和缺字段的解释一致吗？

<details><summary>核对</summary>

在 HTTP 边界固定版本、必填字段和状态码，用同一份夹具检查两侧解释。

</details>

**D97**　若失败材料排在第一位会怎样？

<details><summary>核对</summary>

保持每份材料的编号，结果分别携带成功值或错误；检查输入交换后仍可定位。

</details>

**D93**　为什么第二张单的日志列表也可能变化？

<details><summary>核对</summary>

可变默认值要在每个实例创建时分配；比较构造、相等判断及序列化结果。

</details>

## 一、知识点与推导

校验批次数量、位置和维度。缺项要拒绝该批，避免把他人材料的向量贴错来源。

示例按语法树从当天通过的测试提取。保留完整文件中的导入和辅助函数，使用所列命令运行，不要只复制函数体。

### 1.1 与Node端同一个向量空间

向量能放进同一个Milvus集合检索的前提是：同一个模型、同一种输入处理。Python端照抄Node端的规则：只有`role=query`才加`QUERY_PREFIX`任务指令，文档原样编码；请求体固定`truncate: false`，超长输入让上游报错而不是悄悄截断；长度按码点计（Python的`len(str)`与Node的`Array.from(text).length`都按码点，`"😀"`在两边都是1）。少了任何一条，向量仍然是1024维、照样能写入，检索结果却会变差而且不报错，所以必须有对照实测：第三节用5条合成文本（含表情和中英混排）分别走两边，最大绝对差为0。官方：[Ollama embed接口](https://docs.ollama.com/api/embed)。

**可运行示例：test_query_gets_instruction_and_passage_does_not**

来源：`python/bridge/tests/test_embedding.py`。

```python
def test_query_gets_instruction_and_passage_does_not() -> None:
    seen: list[dict[str, object]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        seen.append(body)
        return httpx2.Response(200, json={"model": MODEL,
                                          "embeddings": [vector(1.0)] * len(body["input"])})

    transport = httpx2.MockTransport(handler)
    asyncio.run(encode_with(transport, ["网络故障"], "query"))
    asyncio.run(encode_with(transport, ["网络故障"], "passage"))
    assert seen == [
        {"model": MODEL, "input": [QUERY_PREFIX + "网络故障"], "truncate": False},
        {"model": MODEL, "input": ["网络故障"], "truncate": False}]
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_embedding.py::test_query_gets_instruction_and_passage_does_not
```

**推导题：如果Python端忘了给查询加指令，哪个测试或检查会发现？只看维度能发现吗？**

<details><summary>答案</summary>

只看维度发现不了，向量仍是1024维。单元测试直接断言发往上游的请求体（反证A就是删掉指令）；跨语言对照会出现差异。

</details>

### 1.2 上游返回的东西也要校验

上游是本机进程也不能直接信任：版本升级、换错模型、返回HTML错误页都可能发生。`UpstreamEmbed`只取`model`和`embeddings`两个字段（`extra="ignore"`，上游多返回的耗时、token数不影响契约）；随后检查模型名、条数与输入一致、每条1024维、全部有限且不全为0。这与D99的入参严格不同：对**调用方**严格拒绝未知字段，对**上游**只校验我们用到的字段，上游加字段不应让服务失败。

**可运行示例：test_upstream_vectors_are_checked**

来源：`python/bridge/tests/test_embedding.py`。

```python
def test_upstream_vectors_are_checked(embeddings: list[list[float]], code: str) -> None:
    with pytest.raises(EmbeddingError) as caught:
        asyncio.run(encode_with(reply(embeddings), ["甲", "乙"]))
    assert caught.value.code == code
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_embedding.py::test_upstream_vectors_are_checked
```

**推导题：为什么上游响应不用D99的`StrictModel`（extra=forbid）？**

<details><summary>答案</summary>

Ollama升级可能增加字段（例如耗时统计），forbid会让所有请求502；我们只依赖model和embeddings，对它们做完整检查即可。

</details>

### 1.3 失败要变成固定码

`httpx2.TimeoutException`变`EMBED_TIMEOUT`，其他`TransportError`（连接被拒、断开）变`EMBED_UNAVAILABLE`，非200状态变`EMBED_HTTP_<状态码>`，响应不是预期JSON变`EMBED_CONTRACT`。`raise ... from None`去掉异常链，日志和错误里不会带上上游正文或请求内容。HTTP层：超时504，其他上游问题502，响应体只有`{"error":{"code":...}}`。本章**不在Python里重试**：重试交给调用方NestJS统一决定（W9模型网关对生成调用已有重试与总预算，D102、D103按同样思路处理编码调用）。两层都重试会把一次失败放大成多次上游调用。

**可运行示例：test_transport_errors_map_to_codes**

来源：`python/bridge/tests/test_embedding.py`。

```python
def test_transport_errors_map_to_codes(error: Exception, code: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error

    with pytest.raises(EmbeddingError) as caught:
        asyncio.run(encode_with(httpx2.MockTransport(handler), ["甲"]))
    assert caught.value.code == code
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_embedding.py::test_transport_errors_map_to_codes
```

**推导题：为什么超时用504、上游500用502，而不是都返回500？**

<details><summary>答案</summary>

500表示桥接服务自己出错；502/504表示桥接正常但依赖的上游有问题，504专指上游没在时限内回应。调用方可以据此决定是否重试、是否告警到模型服务。

</details>

### 1.4 连接池生命周期与并发上限

整个进程只建一个`AsyncClient`：`lifespan`里`async with make_client()`创建，应用退出时关闭。每个请求新建客户端会丢掉连接复用，还可能留下未关闭的连接。`asyncio.Semaphore(2)`限制同时打到本机模型的请求数，超出的在客户端排队（对照D96：它限制并发，不限制QPS）。`local_client`设`trust_env=False`：httpx2默认读取`HTTP_PROXY`等环境变量，开发机上开了代理时，回环请求可能被转给代理；反证B证明打开它后请求会失败。`create_app`接收`make_client`参数，测试用`MockTransport`替换上游，不需要真的起Ollama。官方：[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)、[HTTPX客户端](https://www.python-httpx.org/advanced/clients/)（httpx2沿用同一套API）。

**可运行示例：test_concurrency_is_limited**

来源：`python/bridge/tests/test_embedding.py`。

```python
def test_concurrency_is_limited() -> None:
    active = peak = 0

    async def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        return httpx2.Response(200, json={"model": MODEL, "embeddings": [vector(1.0)]})

    async def scenario() -> int:
        async with fake(httpx2.MockTransport(handler)) as client:
            embedder = EmbeddingClient(client, max_concurrency=2)
            results = await asyncio.gather(*(embedder.encode([str(i)], "passage")
                                             for i in range(6)))
        return len(results)

    assert asyncio.run(scenario()) == 6
    assert peak == 2
```

在`python/bridge`运行：

```powershell
.venv/Scripts/python -m pytest -q tests/test_embedding.py::test_concurrency_is_limited
```

**推导题：把Semaphore放在`encode`方法里，而不是放在路由函数里，有什么区别？**

<details><summary>答案</summary>

放在客户端里，任何调用`encode`的入口（HTTP路由、以后的批量投影）都受同一上限约束；放在路由里，别的入口会绕过它。

</details>

## 二、动手开发

### 步骤1：写编码客户端

<details><summary>提示1：方向</summary>

构造函数接收已建好的AsyncClient；encode先校验输入再请求；结果逐项检查。

</details>
<details><summary>提示2：API与文档位置</summary>

httpx2.AsyncClient.post、TimeoutException、TransportError；pydantic的model_validate_json；math.isfinite；asyncio.Semaphore。

</details>
<details><summary>提示3：伪代码</summary>

encode(texts, role):
    条数/空白/长度不合法 -> EMBED_INPUT（不发请求）
    payload = 查询加前缀，文档原样
    async with 信号量: post /api/embed {model, input, truncate:false}
        超时 -> EMBED_TIMEOUT；连接错误 -> EMBED_UNAVAILABLE
    非200 -> EMBED_HTTP_xxx；解析失败或模型名不符 -> EMBED_CONTRACT
    条数不符 -> EMBED_CARDINALITY；逐条check_vector

</details>

### 步骤2：接入FastAPI

<details><summary>提示1：方向</summary>

用lifespan管理客户端；新路由复用D99的请求模型与鉴权依赖；上游错误用异常处理器映射。

</details>
<details><summary>提示2：API与文档位置</summary>

contextlib.asynccontextmanager、FastAPI(lifespan=...)、app.state、exception_handler(EmbeddingError)。

</details>
<details><summary>提示3：伪代码</summary>

lifespan: async with make_client() as c: app.state.embedder = EmbeddingClient(c); yield
POST /v1/embedding -> EmbedResult(count, vectors)
EmbeddingError -> 超时504，其余502，只带code

</details>

### 步骤3：测试与对照

<details><summary>提示1：方向</summary>

用MockTransport覆盖请求体、校验和每种失败；用本机HTTP服务器验证代理变量；最后与Node端对照真实向量。

</details>
<details><summary>提示2：API与文档位置</summary>

httpx2.MockTransport（同步或async处理函数）、http.server.ThreadingHTTPServer、pytest.MonkeyPatch.setenv、pytest.mark.skipif。

</details>
<details><summary>提示3：伪代码</summary>

断言发出的请求体逐字相等
每种上游异常 -> 断言固定码
6个请求、上限2 -> 记录同时在途峰值==2
设置HTTP_PROXY指向空端口 -> 本客户端成功、默认客户端失败
OPS_REAL_OLLAMA=1时调用真实模型

</details>

三级提示仍无法完成再看第四节，并记一次需要复测。

```powershell
pnpm build
pnpm test
# apps/server 目录
pnpm lint --max-warnings 0
pnpm test:e2e
pnpm test:e2e
pnpm test:e2e
```

也可根目录运行 `pnpm run ci` 顺序执行以上门禁。只重置已授权的隔离测试库和Redis 1号库。shared通过dist导入，改完先build。

在 `python/bridge` 运行 `python -m pytest tests/test_embedding.py -q`。

<details><summary>提示一 · 先找观察点</summary>

用重复片段和不同长度的文本调用异步编码客户端，保存每批向量的维度与对应位置。

</details>

<details><summary>提示二 · 切换一个条件</summary>

服务返回的向量少一项可以继续配对吗？

</details>

<details><summary>提示三 · 对照判定</summary>

校验批次数量、位置和维度。缺项要拒绝该批，避免把他人材料的向量贴错来源。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

**python/bridge/ops_bridge/embedding.py**

```python
"""本机Ollama的异步编码客户端；规则与Node端encoding.ts保持一致。"""
import asyncio
import math
from typing import Literal

import httpx2
from pydantic import BaseModel, ConfigDict, ValidationError

from ops_bridge.http_contracts import DIMENSION, MODEL

Role = Literal["query", "passage"]
# 与Node端逐字相同：只有查询加任务指令，文档原样编码。
QUERY_PREFIX = "Instruct: Given a Chinese helpdesk query, retrieve an applicable manual or published solution.\nQuery: "


class EmbeddingError(Exception):
    """只携带固定错误码，不携带上游正文或输入文本。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class UpstreamEmbed(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model: str
    embeddings: list[list[float]]


def check_vector(vector: list[float]) -> tuple[float, ...]:
    if len(vector) != DIMENSION:
        raise EmbeddingError("VECTOR_DIMENSION")
    if not all(math.isfinite(value) for value in vector) or not any(vector):
        raise EmbeddingError("VECTOR_DIRECTION")
    return tuple(vector)


class EmbeddingClient:
    def __init__(self, client: httpx2.AsyncClient, *, max_concurrency: int = 2) -> None:
        self._client = client
        # 限制同时打到本机模型的请求数，超出的在这里排队。
        self._slots = asyncio.Semaphore(max_concurrency)

    async def encode(self, texts: list[str], role: Role) -> tuple[tuple[float, ...], ...]:
        if not 1 <= len(texts) <= 16 or any(not t.strip() or len(t) > 2048 for t in texts):
            raise EmbeddingError("EMBED_INPUT")
        payload = texts if role == "passage" else [QUERY_PREFIX + text for text in texts]
        async with self._slots:
            try:
                response = await self._client.post(
                    "/api/embed", json={"model": MODEL, "input": payload, "truncate": False})
            except httpx2.TimeoutException:
                raise EmbeddingError("EMBED_TIMEOUT") from None
            except httpx2.TransportError:
                raise EmbeddingError("EMBED_UNAVAILABLE") from None
        if response.status_code != 200:
            raise EmbeddingError(f"EMBED_HTTP_{response.status_code}")
        try:
            result = UpstreamEmbed.model_validate_json(response.content)
        except ValidationError:
            raise EmbeddingError("EMBED_CONTRACT") from None
        if result.model != MODEL:
            raise EmbeddingError("EMBED_CONTRACT")
        if len(result.embeddings) != len(texts):
            raise EmbeddingError("EMBED_CARDINALITY")
        return tuple(check_vector(vector) for vector in result.embeddings)


def local_client(base_url: str = "http://127.0.0.1:11434", timeout: float = 20) -> httpx2.AsyncClient:
    # trust_env=False：不读取HTTP_PROXY等环境变量，回环请求不会被转给代理。
    return httpx2.AsyncClient(base_url=base_url, timeout=timeout, trust_env=False,
                              follow_redirects=False)
```

**python/bridge/ops_bridge/http_app.py**

```python
"""只供回环访问的服务入口；业务路由要求独立服务令牌。"""
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from hmac import compare_digest
from typing import Annotated

import httpx2
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ops_bridge.embedding import EmbeddingClient, EmbeddingError, local_client
from ops_bridge.http_contracts import EmbedPlan, EmbedRequest, EmbedResult


def create_app(token: str,
               make_client: Callable[[], httpx2.AsyncClient] = local_client) -> FastAPI:
    if len(token) < 32 or not token.isascii():
        raise ValueError("OPS_BRIDGE_TOKEN必须为至少32字符的ASCII随机令牌")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 整个进程复用一个连接池；退出时关闭，不留悬挂连接。
        async with make_client() as client:
            app.state.embedder = EmbeddingClient(client)
            yield

    app = FastAPI(title="本机检索桥接", version="1.0.0", docs_url=None, redoc_url=None,
                  lifespan=lifespan)

    async def authenticate(authorization: Annotated[str | None, Header()] = None) -> None:
        if not compare_digest((authorization or "").encode(), ("Bearer " + token).encode()):
            raise HTTPException(status_code=401, detail="BRIDGE_UNAUTHORIZED")

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, error: RequestValidationError) -> JSONResponse:
        # 不回显错误输入或请求头；诊断信息由独立测试保留。
        return JSONResponse(status_code=422, content={"error": {"code": "BRIDGE_INPUT"}})

    @app.exception_handler(EmbeddingError)
    async def upstream_failed(request: Request, error: EmbeddingError) -> JSONResponse:
        # 上游超时504，其余上游问题502；只返回固定码。
        status = 504 if error.code == "EMBED_TIMEOUT" else 502
        return JSONResponse(status_code=status, content={"error": {"code": error.code}})

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/embedding/validate", response_model=EmbedPlan,
              dependencies=[Depends(authenticate)])
    async def validate(body: EmbedRequest) -> EmbedPlan:
        # 只确认契约，不生成向量。
        return EmbedPlan(count=len(body.texts))

    @app.post("/v1/embedding", response_model=EmbedResult,
              dependencies=[Depends(authenticate)])
    async def embed(body: EmbedRequest, request: Request) -> EmbedResult:
        embedder: EmbeddingClient = request.app.state.embedder
        vectors = await embedder.encode(body.texts, body.role)
        return EmbedResult(count=len(vectors), vectors=[list(v) for v in vectors])

    return app


def from_environment() -> FastAPI:
    return create_app(os.environ.get("OPS_BRIDGE_TOKEN", ""))
```

**python/bridge/ops_bridge/http_contracts.py**

```python
"""桥接协议v1；向量空间沿用Node端既有常量。"""
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL: Final = "ops-teacher-qwen3-embedding:q8"
SPACE: Final = "qwen3_06b_q8_06507c7b_chunks_v1"
DIMENSION: Final = 1024
Text = Annotated[str, Field(min_length=1, max_length=2048)]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class EmbedRequest(StrictModel):
    role: Literal["query", "passage"]
    texts: Annotated[list[Text], Field(min_length=1, max_length=16)]

    @field_validator("texts")
    @classmethod
    def nonblank(cls, texts: list[str]) -> list[str]:
        if any(not text.strip() for text in texts):
            raise ValueError("文本不能为空白")
        return texts


class EmbedPlan(StrictModel):
    schema_version: Literal[1] = 1
    space: Literal["qwen3_06b_q8_06507c7b_chunks_v1"] = SPACE
    dimension: Literal[1024] = DIMENSION
    count: int


class EmbedResult(EmbedPlan):
    # 向量顺序与请求texts一致；维度由客户端在返回前逐条检查。
    vectors: list[list[float]]
```

**python/bridge/tests/test_embedding.py**

```python
import asyncio
import json
import math
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx2
import pytest
from fastapi.testclient import TestClient

from ops_bridge.embedding import (
    QUERY_PREFIX,
    EmbeddingClient,
    EmbeddingError,
    check_vector,
    local_client,
)
from ops_bridge.http_app import create_app
from ops_bridge.http_contracts import MODEL

TOKEN = "fixture-bridge-token-not-a-real-secret"
HEADERS = {"Authorization": "Bearer " + TOKEN}


def vector(seed: float) -> list[float]:
    return [seed] + [0.0] * 1023


def fake(handler: httpx2.MockTransport) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(transport=handler, base_url="http://upstream.test")


def reply(embeddings: list[list[float]], model: str = MODEL) -> httpx2.MockTransport:
    return httpx2.MockTransport(
        lambda request: httpx2.Response(200, json={"model": model, "embeddings": embeddings}))


async def encode_with(transport: httpx2.MockTransport, texts: list[str], role: str = "passage"
                      ) -> tuple[tuple[float, ...], ...]:
    async with fake(transport) as client:
        return await EmbeddingClient(client).encode(texts, role)  # type: ignore[arg-type]


def test_query_gets_instruction_and_passage_does_not() -> None:
    seen: list[dict[str, object]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        seen.append(body)
        return httpx2.Response(200, json={"model": MODEL,
                                          "embeddings": [vector(1.0)] * len(body["input"])})

    transport = httpx2.MockTransport(handler)
    asyncio.run(encode_with(transport, ["网络故障"], "query"))
    asyncio.run(encode_with(transport, ["网络故障"], "passage"))
    assert seen == [
        {"model": MODEL, "input": [QUERY_PREFIX + "网络故障"], "truncate": False},
        {"model": MODEL, "input": ["网络故障"], "truncate": False}]


def test_vectors_keep_request_order() -> None:
    result = asyncio.run(encode_with(reply([vector(1.0), vector(2.0)]), ["甲", "乙"]))
    assert [row[0] for row in result] == [1.0, 2.0]
    assert all(len(row) == 1024 for row in result)


@pytest.mark.parametrize(("embeddings", "code"), [
    ([vector(1.0)], "EMBED_CARDINALITY"),
    ([[1.0] * 1023, vector(1.0)], "VECTOR_DIMENSION"),
    ([[0.0] * 1024, vector(1.0)], "VECTOR_DIRECTION"),
], ids=["cardinality", "dimension", "zero"])
def test_upstream_vectors_are_checked(embeddings: list[list[float]], code: str) -> None:
    with pytest.raises(EmbeddingError) as caught:
        asyncio.run(encode_with(reply(embeddings), ["甲", "乙"]))
    assert caught.value.code == code


def test_non_finite_values_are_rejected() -> None:
    with pytest.raises(EmbeddingError, match="VECTOR_DIRECTION"):
        check_vector([math.nan] + [1.0] * 1023)


@pytest.mark.parametrize(("transport", "code"), [
    (httpx2.MockTransport(lambda r: httpx2.Response(500, text="private-upstream-detail")),
     "EMBED_HTTP_500"),
    (httpx2.MockTransport(lambda r: httpx2.Response(200, text="<html>")), "EMBED_CONTRACT"),
    (reply([vector(1.0)], model="other-model"), "EMBED_CONTRACT"),
], ids=["status", "not-json", "model"])
def test_upstream_failures_have_fixed_codes(transport: httpx2.MockTransport, code: str) -> None:
    with pytest.raises(EmbeddingError) as caught:
        asyncio.run(encode_with(transport, ["甲"]))
    assert caught.value.code == code
    assert str(caught.value) == code


@pytest.mark.parametrize(("error", "code"), [
    (httpx2.ReadTimeout("slow"), "EMBED_TIMEOUT"),
    (httpx2.ConnectError("refused"), "EMBED_UNAVAILABLE"),
], ids=["timeout", "connect"])
def test_transport_errors_map_to_codes(error: Exception, code: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error

    with pytest.raises(EmbeddingError) as caught:
        asyncio.run(encode_with(httpx2.MockTransport(handler), ["甲"]))
    assert caught.value.code == code


@pytest.mark.parametrize("texts", [[], [" "], ["x"] * 17, ["x" * 2049]],
                         ids=["empty", "blank", "batch", "length"])
def test_invalid_input_never_reaches_upstream(texts: list[str]) -> None:
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return httpx2.Response(500)

    with pytest.raises(EmbeddingError, match="EMBED_INPUT"):
        asyncio.run(encode_with(httpx2.MockTransport(handler), texts))
    assert calls == []


def test_concurrency_is_limited() -> None:
    active = peak = 0

    async def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        return httpx2.Response(200, json={"model": MODEL, "embeddings": [vector(1.0)]})

    async def scenario() -> int:
        async with fake(httpx2.MockTransport(handler)) as client:
            embedder = EmbeddingClient(client, max_concurrency=2)
            results = await asyncio.gather(*(embedder.encode([str(i)], "passage")
                                             for i in range(6)))
        return len(results)

    assert asyncio.run(scenario()) == 6
    assert peak == 2


class FixedEmbed(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        self.rfile.read(int(self.headers["Content-Length"]))
        body = json.dumps({"model": MODEL, "embeddings": [vector(1.0)]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


def test_local_client_ignores_proxy_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixedEmbed)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    # 指向一个没有监听的端口：凡是读取代理变量的客户端都会连接失败。
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)

    async def scenario() -> None:
        async with local_client(base, timeout=2) as client:
            assert len(await EmbeddingClient(client).encode(["甲"], "passage")) == 1
        async with httpx2.AsyncClient(base_url=base, timeout=2) as default:
            with pytest.raises(httpx2.TransportError):
                await default.post("/api/embed", json={})

    try:
        asyncio.run(scenario())
    finally:
        server.shutdown()
        server.server_close()


def app_with(transport: httpx2.MockTransport) -> TestClient:
    return TestClient(create_app(TOKEN, lambda: fake(transport)))


def test_http_route_returns_vectors() -> None:
    with app_with(reply([vector(1.0), vector(2.0)])) as client:
        result = client.post("/v1/embedding", headers=HEADERS,
                             json={"role": "passage", "texts": ["甲", "乙"]})
    assert result.status_code == 200
    body = result.json()
    assert (body["count"], body["dimension"], len(body["vectors"])) == (2, 1024, 2)
    assert [row[0] for row in body["vectors"]] == [1.0, 2.0]


def test_http_route_maps_upstream_errors() -> None:
    def slow(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("slow")

    cases = [(httpx2.MockTransport(slow), 504, "EMBED_TIMEOUT"),
             (httpx2.MockTransport(lambda r: httpx2.Response(500, text="private-upstream-detail")),
              502, "EMBED_HTTP_500")]
    for transport, status, code in cases:
        with app_with(transport) as client:
            result = client.post("/v1/embedding", headers=HEADERS,
                                 json={"role": "query", "texts": ["甲"]})
        assert result.status_code == status
        assert result.json() == {"error": {"code": code}}


def test_http_route_requires_token() -> None:
    with app_with(reply([vector(1.0)])) as client:
        assert client.post("/v1/embedding", json={"role": "query", "texts": ["甲"]}
                           ).status_code == 401


@pytest.mark.skipif(os.environ.get("OPS_REAL_OLLAMA") != "1", reason="需要本机Ollama与固定模型")
def test_real_local_ollama() -> None:
    async def scenario() -> tuple[tuple[float, ...], ...]:
        async with local_client() as client:
            embedder = EmbeddingClient(client)
            query = await embedder.encode(["换手机后VPN登不上"], "query")
            passages = await embedder.encode(["员工换机后远程登录失败，重新绑定动态口令",
                                              "打印机卡纸，清理纸道后恢复"], "passage")
        return query + passages

    q, related, unrelated = asyncio.run(scenario())
    assert len(q) == len(related) == 1024

    def cosine(a: tuple[float, ...], b: tuple[float, ...]) -> float:
        return sum(x * y for x, y in zip(a, b, strict=True)) / math.hypot(*a) / math.hypot(*b)

    assert cosine(q, related) > cosine(q, unrelated)
```

## 五、核心面试题

服务返回的向量少一项可以继续配对吗？

校验批次数量、位置和维度。缺项要拒绝该批，避免把他人材料的向量贴错来源。 [本日配套面试题](D100-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。
