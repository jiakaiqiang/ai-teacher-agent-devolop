# D101（周三）：pymilvus与向量存取

第 15 周 · 120 分钟。回忆 10、推导 35、手写 55、自检与提交 20。前置阅读见[上一讲](D100-异步Embedding客户端.md)。

## 今天要做出什么

把手册、已发布案例分别写入本地向量集合，再读取已知条目和不存在的条目。

## 今天的目录结构

- `python/bridge/ops_bridge/http_app.py`
- `python/bridge/ops_bridge/http_contracts.py`
- `python/bridge/ops_bridge/vector_store.py`
- `python/bridge/pyproject.toml`
- `python/bridge/requirements-lock.txt`
- `python/bridge/requirements-runtime.txt`
- `python/bridge/tests/test_vector_store.py`

## 零、闭卷回忆

**D100**　服务返回的向量少一项可以继续配对吗？

<details><summary>核对</summary>

校验批次数量、位置和维度。缺项要拒绝该批，避免把他人材料的向量贴错来源。

</details>

**D98**　怎样用一个小用例复现自己的薄弱项？

<details><summary>核对</summary>

记录触发输入和失败断言，隔天从空文件重做。

</details>

**D94**　静态标注能阻止 HTTP 请求传错类型吗？

<details><summary>核对</summary>

在输入边界做运行时校验，内部函数使用明确类型，保留具体错误字段。

</details>

## 一、知识点与推导

向量空间、条目标识和资料版本共同决定查询目标，先验证空间再比较距离。

## 二、动手开发

1. 把手册、已发布案例分别写入本地向量集合，再读取已知条目和不存在的条目。
2. 从 `http_app.py`、`http_contracts.py`、`vector_store.py` 的公开入口开始，把断言写在调用方。先保存失败结果，再修改实现并重跑同一输入。
3. 改了模型版本还可以复用原集合吗？ 对照运行记录回答，补一个相邻状态或不同身份的样例。

在 `python/bridge` 运行 `python -m pytest tests/test_vector_store.py -q`。

<details><summary>提示一 · 先找观察点</summary>

把手册、已发布案例分别写入本地向量集合，再读取已知条目和不存在的条目。

</details>

<details><summary>提示二 · 切换一个条件</summary>

改了模型版本还可以复用原集合吗？

</details>

<details><summary>提示三 · 对照判定</summary>

向量空间、条目标识和资料版本共同决定查询目标，先验证空间再比较距离。

</details>

## 三、自检与提交

用第一次失败和修复后的实际输出回答上一题，保留运行环境、输入、预期和实际结果。若超出当天时间，先交必做路径和一个反例。

## 四、本章完整源码

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
from ops_bridge.http_contracts import (
    CandidateOut,
    ChunkSearch,
    ChunkUpsert,
    EmbedPlan,
    EmbedRequest,
    EmbedResult,
    SearchResult,
)
from ops_bridge.vector_store import ChunkRow, VectorStore, VectorStoreError, milvus_store


def create_app(token: str,
               make_client: Callable[[], httpx2.AsyncClient] = local_client,
               make_store: Callable[[], VectorStore] = milvus_store) -> FastAPI:
    if len(token) < 32 or not token.isascii():
        raise ValueError("OPS_BRIDGE_TOKEN必须为至少32字符的ASCII随机令牌")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 整个进程复用一个连接池；退出时关闭，不留悬挂连接。
        async with make_client() as client:
            app.state.embedder = EmbeddingClient(client)
            store = make_store()
            app.state.store = store
            try:
                yield
            finally:
                await store.close()

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

    @app.exception_handler(VectorStoreError)
    async def store_failed(request: Request, error: VectorStoreError) -> JSONResponse:
        status = 504 if error.code == "MILVUS_TIMEOUT" else 502
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

    @app.post("/v1/chunks/upsert", dependencies=[Depends(authenticate)])
    async def upsert(body: ChunkUpsert, request: Request) -> dict[str, int]:
        # 只写坐标、版本与向量；正文不进Milvus，读侧回权威库取原文。
        vectors = await request.app.state.embedder.encode([r.text for r in body.rows], "passage")
        rows = [ChunkRow(r.source_key, r.group_id, r.version, r.start, r.end, vector)
                for r, vector in zip(body.rows, vectors, strict=True)]
        store: VectorStore = request.app.state.store
        return {"written": await store.upsert(rows)}

    @app.post("/v1/chunks/search", response_model=SearchResult,
              dependencies=[Depends(authenticate)])
    async def search(body: ChunkSearch, request: Request) -> SearchResult:
        # 返回的只是候选；权限、状态与版本由NestJS在权威库复核。
        (vector,) = await request.app.state.embedder.encode([body.query], "query")
        store: VectorStore = request.app.state.store
        hits = await store.search(vector, body.group_id, body.limit)
        return SearchResult(candidates=[CandidateOut(source_key=h.source_key, version=h.version,
                                                     start=h.start, end=h.end,
                                                     distance=h.distance) for h in hits])

    return app


def from_environment() -> FastAPI:
    return create_app(os.environ.get("OPS_BRIDGE_TOKEN", ""))
```

**python/bridge/ops_bridge/http_contracts.py**

```python
"""桥接协议v1；向量空间沿用Node端既有常量。"""
import uuid
from typing import Annotated, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


# 严格模型里单独放宽UUID：JSON里只有字符串，解析后才是uuid.UUID。
GroupId = Annotated[uuid.UUID, Field(strict=False)]


class ChunkIn(StrictModel):
    source_key: Annotated[str, Field(pattern=r"^(solution|manual):[^/]{1,200}$")]
    group_id: GroupId | Literal["shared"]
    version: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(gt=0)]
    text: Text

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.end <= self.start or not self.text.strip():
            raise ValueError("切片坐标或正文不合法")
        return self


class ChunkUpsert(StrictModel):
    rows: Annotated[list[ChunkIn], Field(min_length=1, max_length=16)]


class ChunkSearch(StrictModel):
    query: Text
    # 必填但可为null：null只查共享知识，缺字段则422。
    group_id: GroupId | None
    limit: Annotated[int, Field(ge=1, le=24)] = 24


class CandidateOut(StrictModel):
    source_key: str
    version: str
    start: int
    end: int
    distance: float


class SearchResult(StrictModel):
    schema_version: Literal[1] = 1
    space: Literal["qwen3_06b_q8_06507c7b_chunks_v1"] = SPACE
    candidates: list[CandidateOut]
```

**python/bridge/ops_bridge/vector_store.py**

```python
"""Milvus存取；集合结构、字段名与Node端vector-index.ts/projection.ts一致。"""
import asyncio
import json
import uuid
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Annotated, Any, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pymilvus import AsyncMilvusClient, DataType, MilvusException

from ops_bridge.http_contracts import DIMENSION, SPACE

COLLECTION = "service_knowledge_" + SPACE
T = TypeVar("T")


class VectorStoreError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class ChunkRow:
    """内部写入行；外部输入先经HTTP契约校验，再与编码结果组装成它。"""
    source_key: str
    group_id: uuid.UUID | str
    version: str
    start: int
    end: int
    vector: tuple[float, ...]


class Candidate(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    source_key: str = Field(alias="sourceKey")
    version: str
    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(gt=0)]
    distance: float


def group_filter(group_id: uuid.UUID | None) -> str:
    # 只接受已解析的UUID，再按JSON转义拼进表达式；None表示调用方明确要求不过滤。
    return 'audience == "shared"' if group_id is None else 'audience in ["shared",' + json.dumps(str(group_id)) + ']'


def entity(row: ChunkRow) -> dict[str, Any]:
    if len(row.vector) != DIMENSION or row.end <= row.start:
        raise VectorStoreError("VECTOR_ROW")
    # 主键与Node端projection.ts相同：来源/内容版本/起点。
    return {"id": f"{row.source_key}/{row.version}/{row.start}", "sourceKey": row.source_key,
            "audience": str(row.group_id), "version": row.version, "start": row.start,
            "end": row.end, "vector": list(row.vector)}


class VectorStore:
    def __init__(self, client: AsyncMilvusClient, collection: str = COLLECTION,
                 deadline: float = 10) -> None:
        self._client = client
        self._collection = collection
        self._deadline = deadline
        self._ready = False

    async def _call(self, operation: Awaitable[T], code: str) -> T:
        # 实测连接不可达时客户端自己的timeout不生效，所以外面再套一层截止时间。
        try:
            async with asyncio.timeout(self._deadline):
                return await operation
        except TimeoutError:
            raise VectorStoreError("MILVUS_TIMEOUT") from None
        except MilvusException:
            raise VectorStoreError(code) from None

    async def ensure(self) -> None:
        schema = AsyncMilvusClient.create_schema(auto_id=False, enable_dynamic_field=True)
        schema.add_field("id", DataType.VARCHAR, is_primary=True, max_length=256)
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=DIMENSION)
        index = AsyncMilvusClient.prepare_index_params()
        index.add_index("vector", index_type="FLAT", index_name="vector_cosine", metric_type="COSINE")
        await self._call(self._client.create_collection(
            self._collection, schema=schema, index_params=index, consistency_level="Strong"),
            "MILVUS_SCHEMA")
        await self._call(self._client.load_collection(self._collection), "MILVUS_SCHEMA")

    async def upsert(self, rows: list[ChunkRow]) -> int:
        if not 1 <= len(rows) <= 16:
            raise VectorStoreError("VECTOR_ROW")
        data = [entity(row) for row in rows]
        if not self._ready:
            # 第一次写入前建集合并加载；启动时不连Milvus，避免它不可用时服务起不来。
            await self.ensure()
            self._ready = True
        result = await self._call(self._client.upsert(self._collection, data), "MILVUS_WRITE")
        return int(result["upsert_count"])

    async def search(self, vector: tuple[float, ...], group_id: uuid.UUID | None,
                     limit: int = 24) -> list[Candidate]:
        if len(vector) != DIMENSION or not 1 <= limit <= 24:
            raise VectorStoreError("VECTOR_QUERY")
        result = await self._call(self._client.search(
            self._collection, [list(vector)], filter=group_filter(group_id), limit=limit,
            output_fields=["sourceKey", "version", "start", "end"], anns_field="vector"),
            "MILVUS_SEARCH")
        try:
            return [Candidate.model_validate({**hit["entity"], "distance": hit["distance"]})
                    for hit in result[0]]
        except (ValidationError, KeyError, TypeError):
            raise VectorStoreError("MILVUS_CONTRACT") from None

    async def close(self) -> None:
        await self._client.close()


def milvus_store(uri: str = "http://127.0.0.1:19531") -> VectorStore:
    # 必须在事件循环里构造：AsyncMilvusClient创建时绑定当前循环。
    return VectorStore(AsyncMilvusClient(uri=uri, timeout=10))
```

**python/bridge/pyproject.toml**

```text
[project]
name = "ops-python-bridge"
version = "0.1.0"
requires-python = ">=3.12,<3.13"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-ra --strict-markers"
filterwarnings = ["error"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I"]

[tool.mypy]
python_version = "3.12"
strict = true
files = ["ops_bridge"]

[[tool.mypy.overrides]]
# pymilvus 2.5 没有py.typed；只对它放宽缺失存根，调用结果在边界处再校验。
module = ["pymilvus", "pymilvus.*"]
ignore_missing_imports = true
```

**python/bridge/requirements-lock.txt**

```text
annotated-doc==0.0.6
annotated-types==0.8.0
anyio==4.16.0
certifi==2026.10.23
click==8.5.1
colorama==0.4.6
fastapi==0.163.2
grpcio==1.85.3
h11==0.16.0
httpcore2==2.16.2
httpx2==2.16.2
idna==3.20
iniconfig==2.3.1
librt==0.16.0
mypy==1.20.2
mypy_extensions==1.2.0
numpy==2.5.5
opentelemetry-api==1.45.2
packaging==26.3
pandas==3.1.1
pathspec==1.1.1
pluggy==1.7.0
protobuf==7.36.2
pydantic==2.14.3
pydantic_core==2.50.4
Pygments==2.21.0
pymilvus==2.5.18
pytest==9.0.3
python-dateutil==4.0.0
python-dotenv==1.2.4
ruff==0.15.11
setuptools==84.2.1
starlette==1.10.0
truststore==0.10.5
typing-inspection==0.4.5
typing_extensions==4.16.0
tzdata==2026.6
ujson==6.1.0
uvicorn==0.54.0
```

**python/bridge/requirements-runtime.txt**

```text
fastapi==0.163.2
pydantic==2.14.3
httpx2==2.16.2
uvicorn==0.54.0
pymilvus==2.5.18
```

**python/bridge/tests/test_vector_store.py**

```python
import asyncio
import os
import uuid
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from pymilvus import AsyncMilvusClient, MilvusException

from ops_bridge.http_app import create_app
from ops_bridge.http_contracts import MODEL
from ops_bridge.vector_store import (
    ChunkRow,
    VectorStore,
    VectorStoreError,
    entity,
    group_filter,
)

TOKEN = "fixture-bridge-token-not-a-real-secret"
HEADERS = {"Authorization": "Bearer " + TOKEN}
G1 = uuid.UUID("0b6a3c5e-1f2d-4a7b-9c8d-111111111111")
G2 = uuid.UUID("0b6a3c5e-1f2d-4a7b-9c8d-222222222222")
V1 = "a" * 64


def unit(index: int) -> tuple[float, ...]:
    return tuple(1.0 if i == index else 0.0 for i in range(1024))


def test_filter_only_from_parsed_uuid() -> None:
    assert group_filter(None) == 'audience == "shared"'
    assert group_filter(G1) == 'audience in ["shared","0b6a3c5e-1f2d-4a7b-9c8d-111111111111"]'


def test_entity_matches_node_projection_layout() -> None:
    row = entity(ChunkRow("solution:K1", G1, V1, 240, 480, unit(0)))
    assert row["id"] == f"solution:K1/{V1}/240"
    assert {k: row[k] for k in ["sourceKey", "audience", "version", "start", "end"]} == {
        "sourceKey": "solution:K1", "audience": str(G1), "version": V1, "start": 240, "end": 480}
    with pytest.raises(VectorStoreError, match="VECTOR_ROW"):
        entity(ChunkRow("solution:K1", G1, V1, 0, 5, (1.0,)))


class FakeMilvus:
    """只模拟本章用到的三个调用；行为由测试指定。"""

    def __init__(self, search_result: Any = None, error: Exception | None = None,
                 hang: bool = False) -> None:
        self.search_result, self.error, self.hang = search_result, error, hang
        self.calls: list[str] = []

    async def _act(self, name: str) -> None:
        self.calls.append(name)
        if self.hang:
            await asyncio.Event().wait()
        if self.error:
            raise self.error

    async def create_collection(self, *args: object, **kwargs: object) -> None:
        await self._act("create")

    async def load_collection(self, *args: object, **kwargs: object) -> None:
        await self._act("load")

    async def upsert(self, name: str, data: list[dict[str, Any]]) -> dict[str, int]:
        await self._act("upsert")
        return {"upsert_count": len(data)}

    async def search(self, *args: object, **kwargs: object) -> Any:
        await self._act("search")
        return self.search_result

    async def close(self) -> None:
        self.calls.append("close")


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_first_upsert_ensures_collection_once() -> None:
    fake = FakeMilvus()
    store = VectorStore(fake)  # type: ignore[arg-type]
    row = ChunkRow("solution:K1", G1, V1, 0, 5, unit(0))
    assert run(store.upsert([row])) == 1
    assert run(store.upsert([row, row])) == 2
    assert fake.calls == ["create", "load", "upsert", "upsert"]


def test_hanging_milvus_hits_outer_deadline() -> None:
    store = VectorStore(FakeMilvus(hang=True), deadline=0.05)  # type: ignore[arg-type]

    async def scenario() -> None:
        async with asyncio.timeout(2):  # 测试兜底：实现缺陷时失败而不是挂死
            await store.search(unit(0), None)

    with pytest.raises(VectorStoreError, match="MILVUS_TIMEOUT"):
        run(scenario())


@pytest.mark.parametrize(("fake", "code"), [
    (FakeMilvus(error=MilvusException(message="private-detail")), "MILVUS_SEARCH"),
    (FakeMilvus(search_result=[[{"distance": 0.5, "entity": {"sourceKey": "x"}}]]),
     "MILVUS_CONTRACT"),
], ids=["exception", "malformed"])
def test_search_failures_have_fixed_codes(fake: FakeMilvus, code: str) -> None:
    with pytest.raises(VectorStoreError) as caught:
        run(VectorStore(fake).search(unit(0), G1))  # type: ignore[arg-type]
    assert caught.value.code == code
    assert "private" not in str(caught.value)


def embed_transport() -> httpx2.MockTransport:
    def handler(request: httpx2.Request) -> httpx2.Response:
        count = len(httpx2.Response(200, content=request.content).json()["input"])
        return httpx2.Response(200, json={"model": MODEL,
                                          "embeddings": [list(unit(i)) for i in range(count)]})
    return httpx2.MockTransport(handler)


def app_with(fake: FakeMilvus) -> TestClient:
    return TestClient(create_app(
        TOKEN, lambda: httpx2.AsyncClient(transport=embed_transport(), base_url="http://e.test"),
        lambda: VectorStore(fake)))  # type: ignore[arg-type]


def chunk(**change: object) -> dict[str, object]:
    return {"source_key": "solution:K1", "group_id": str(G1), "version": V1, "start": 0,
            "end": 5, "text": "远程登录失败", **change}


def test_upsert_route_embeds_passages_and_writes() -> None:
    fake = FakeMilvus()
    with app_with(fake) as client:
        result = client.post("/v1/chunks/upsert", headers=HEADERS,
                             json={"rows": [chunk(), chunk(start=5, end=9)]})
    assert result.status_code == 200 and result.json() == {"written": 2}
    assert fake.calls[-1] == "close"


def test_search_route_returns_candidates_only() -> None:
    hits = [[{"id": "x", "distance": 0.9, "entity": {"sourceKey": "solution:K1", "version": V1,
                                                     "start": 0, "end": 5}}]]
    with app_with(FakeMilvus(search_result=hits)) as client:
        result = client.post("/v1/chunks/search", headers=HEADERS,
                             json={"query": "VPN登不上", "group_id": str(G1), "limit": 3})
    assert result.status_code == 200
    assert result.json()["candidates"] == [
        {"source_key": "solution:K1", "version": V1, "start": 0, "end": 5, "distance": 0.9}]


@pytest.mark.parametrize("body", [
    {"query": "甲"},
    {"query": "甲", "group_id": '" or groupId != "'},
    {"query": "甲", "group_id": None, "limit": 25},
], ids=["missing-group", "injection", "limit"])
def test_search_contract_rejects(body: dict[str, object]) -> None:
    with app_with(FakeMilvus(search_result=[[]])) as client:
        result = client.post("/v1/chunks/search", headers=HEADERS, json=body)
    assert result.status_code == 422
    assert result.json() == {"error": {"code": "BRIDGE_INPUT"}}


@pytest.mark.parametrize("row", [chunk(end=0), chunk(start=5, end=5), chunk(version="v1"),
                                 chunk(source_key="solution:K1/x"), chunk(extra=1)],
                         ids=["end", "empty-span", "version", "slash", "extra"])
def test_upsert_contract_rejects(row: dict[str, object]) -> None:
    with app_with(FakeMilvus()) as client:
        assert client.post("/v1/chunks/upsert", headers=HEADERS,
                           json={"rows": [row]}).status_code == 422


def test_store_errors_map_to_gateway_status() -> None:
    with app_with(FakeMilvus(error=MilvusException(message="private-detail"))) as client:
        result = client.post("/v1/chunks/search", headers=HEADERS,
                             json={"query": "甲", "group_id": None})
    assert result.status_code == 502
    assert result.json() == {"error": {"code": "MILVUS_SEARCH"}}


@pytest.mark.skipif(os.environ.get("OPS_REAL_MILVUS") != "1", reason="需要本机Milvus测试实例")
def test_real_milvus_round_trip() -> None:
    async def scenario() -> tuple[list[str], list[str], int]:
        client = AsyncMilvusClient(uri="http://127.0.0.1:19531", timeout=10)
        name = "verify_d101_bridge_test"
        try:
            store = VectorStore(client, name)
            rows = [ChunkRow("solution:K1", G1, V1, 0, 5, unit(0)),
                    ChunkRow("ticket:T2", G2, V1, 0, 5, unit(1))]
            await store.upsert(rows)
            await store.upsert(rows[:1])  # 同主键重复写入不产生第二条
            every = [h.source_key for h in await store.search(unit(0), None, 5)]
            own = [h.source_key for h in await store.search(unit(0), G2, 5)]
            total = (await client.query(name, filter="", output_fields=["count(*)"]))[0]["count(*)"]
            return every, own, int(total)
        finally:
            await client.drop_collection(name)
            await client.close()

    every, own, total = run(scenario())
    assert every == ["solution:K1", "ticket:T2"]
    assert own == ["ticket:T2"]
    assert total == 2
```

## 五、核心面试题

改了模型版本还可以复用原集合吗？

向量空间、条目标识和资料版本共同决定查询目标，先验证空间再比较距离。 [本日配套面试题](D101-面试题.md)。

## 六、个人建议

把输入换成同一部门服务的另一家公司，说明哪一行观测会随身份变化；技术测量同时注明夹具和样本数。

## 七、拓展练习

换一条失败输入重跑，记录第一处与预期不同的输出，并写下判断依据。

## 本文验证范围

本机 Python 桥接工程通过 100 项测试，两项外部服务专项在此轮默认配置下跳过。[Python 记录](../.cache/验证/新版验收/D105-python.log)。
