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
