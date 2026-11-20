"""只供回环访问的服务入口；业务路由要求独立服务令牌。"""
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from hmac import compare_digest
from typing import Annotated

import httpx2
from fastapi import Depends, FastAPI, Header, Request
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
from ops_bridge.limits import BodyLimit
from ops_bridge.vector_store import ChunkRow, VectorStore, VectorStoreError, milvus_store


class Unauthorized(Exception):
    pass


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
            raise Unauthorized

    # 最外层先限制请求体字节数，超限直接413，不进入JSON解析。
    app.add_middleware(BodyLimit)

    @app.exception_handler(Unauthorized)
    async def unauthorized(request: Request, error: Unauthorized) -> JSONResponse:
        # 与其他失败同一结构，调用方只需解析一种错误体。
        return JSONResponse(status_code=401, content={"error": {"code": "BRIDGE_UNAUTHORIZED"}})

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

    @app.exception_handler(Exception)
    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        # 兜底：未预期的异常也只返回固定码，不带类型名、消息或堆栈。
        return JSONResponse(status_code=500, content={"error": {"code": "BRIDGE_INTERNAL"}})

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
