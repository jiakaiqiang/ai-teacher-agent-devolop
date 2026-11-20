"""Milvus存取；集合结构、字段名与Node端vector-index.ts/projection.ts一致。"""
import asyncio
import json
import uuid
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Annotated, Any, TypeVar

import grpc
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
        except grpc.RpcError:
            # 实测Milvus进程停止时抛的是gRPC错误，不是MilvusException。
            raise VectorStoreError("MILVUS_UNAVAILABLE") from None

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
