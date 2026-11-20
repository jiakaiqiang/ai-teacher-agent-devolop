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
