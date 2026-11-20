import asyncio
import os
import uuid
from typing import Any

import grpc
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


class MilvusDown(grpc.RpcError):
    """模拟Milvus进程停止时pymilvus直接抛出的gRPC错误（实测类型为grpc.aio.AioRpcError）。"""


def test_grpc_failure_maps_to_unavailable() -> None:
    with pytest.raises(VectorStoreError, match="MILVUS_UNAVAILABLE"):
        run(VectorStore(FakeMilvus(error=MilvusDown())).search(unit(0), None))  # type: ignore[arg-type]
    with app_with(FakeMilvus(error=MilvusDown())) as client:
        result = client.post("/v1/chunks/search", headers=HEADERS, json={"query": "甲", "group_id": None})
    assert result.status_code == 502
    assert result.json() == {"error": {"code": "MILVUS_UNAVAILABLE"}}


def test_unexpected_error_has_fixed_body() -> None:
    fake = FakeMilvus(error=RuntimeError("private-detail"))
    app = create_app(TOKEN, lambda: httpx2.AsyncClient(transport=embed_transport(), base_url="http://e.test"),
                     lambda: VectorStore(fake))  # type: ignore[arg-type]
    with TestClient(app, raise_server_exceptions=False) as client:
        result = client.post("/v1/chunks/search", headers=HEADERS, json={"query": "甲", "group_id": None})
    assert result.status_code == 500
    assert result.json() == {"error": {"code": "BRIDGE_INTERNAL"}}
