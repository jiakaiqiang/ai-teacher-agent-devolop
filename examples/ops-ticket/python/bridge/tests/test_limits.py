import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from ops_bridge.http_app import create_app
from ops_bridge.limits import MAX_BODY

TOKEN = "fixture-bridge-token-not-a-real-secret"
HEADERS = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}
URL = "/v1/embedding/validate"


def client() -> TestClient:
    return TestClient(create_app(TOKEN))


def test_largest_legal_request_fits_the_limit() -> None:
    # 16条、每条2048个表情：默认ensure_ascii转义后每个12字节，是最长的合法写法。
    body = json.dumps({"role": "passage", "texts": ["😀" * 2048] * 16}).encode()
    assert 390_000 < len(body) <= MAX_BODY
    with client() as http:
        result = http.post(URL, headers=HEADERS, content=body)
    assert result.status_code == 200 and result.json()["count"] == 16


def test_declared_length_over_limit_is_rejected_before_parsing() -> None:
    with client() as http:
        result = http.post(URL, headers=HEADERS, content=b"x" * (MAX_BODY + 1))
    assert result.status_code == 413
    assert result.json() == {"error": {"code": "BRIDGE_TOO_LARGE"}}


def test_chunked_body_is_counted_without_content_length() -> None:
    def stream() -> Iterator[bytes]:
        for _ in range(MAX_BODY // 4096 + 2):
            yield b" " * 4096

    with client() as http:
        result = http.post(URL, headers=HEADERS, content=stream())
    assert result.request.headers.get("transfer-encoding") == "chunked"
    assert "content-length" not in result.request.headers
    assert result.status_code == 413


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer incorrect"}],
                         ids=["missing", "wrong"])
def test_unauthorized_uses_fixed_error_body(headers: dict[str, str]) -> None:
    with client() as http:
        result = http.post(URL, headers=headers, json={"role": "query", "texts": ["甲"]})
    assert result.status_code == 401
    assert result.json() == {"error": {"code": "BRIDGE_UNAUTHORIZED"}}
