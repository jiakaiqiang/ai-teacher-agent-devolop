import pytest
from fastapi.testclient import TestClient

from ops_bridge.http_app import create_app
from ops_bridge.http_contracts import SPACE

TOKEN = "fixture-bridge-token-not-a-real-secret"
HEADERS = {"Authorization": "Bearer " + TOKEN}


def test_valid_http_contract_has_no_fake_vectors() -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": ["网络故障"]})
        assert result.status_code == 200
        assert result.json() == {"schema_version": 1, "space": SPACE, "dimension": 1024, "count": 1}
        assert client.get("/healthz").json() == {"status": "ok"}


def test_service_requires_its_own_token() -> None:
    with TestClient(create_app(TOKEN)) as client:
        for headers in [{}, {"Authorization": "Bearer incorrect"}]:
            result = client.post("/v1/embedding/validate", headers=headers,
                                 json={"role": "query", "texts": ["网络故障"]})
            assert result.status_code == 401


def test_unknown_fields_fail_without_echoing_input() -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": ["private-fixture"], "admin": True})
        assert result.status_code == 422
        assert result.json() == {"error": {"code": "BRIDGE_INPUT"}}


@pytest.mark.parametrize("texts", [[], [True], [" "], ["x"] * 17, ["x" * 2049]],
                         ids=["empty", "boolean", "blank", "batch-limit", "text-limit"])
def test_text_budget_and_type(texts: object) -> None:
    with TestClient(create_app(TOKEN)) as client:
        result = client.post("/v1/embedding/validate", headers=HEADERS,
                             json={"role": "query", "texts": texts})
        assert result.status_code == 422


def test_invalid_role_and_json() -> None:
    with TestClient(create_app(TOKEN)) as client:
        assert client.post("/v1/embedding/validate", headers=HEADERS,
                           json={"role": "admin", "texts": ["甲"]}).status_code == 422
        assert client.post("/v1/embedding/validate", headers=HEADERS, content="{").status_code == 422


def test_missing_startup_token_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    from ops_bridge.http_app import from_environment

    monkeypatch.delenv("OPS_BRIDGE_TOKEN", raising=False)
    with pytest.raises(ValueError, match="OPS_BRIDGE_TOKEN"):
        from_environment()


def test_real_uvicorn_loopback_process() -> None:
    import os
    import socket
    import subprocess
    import sys
    import time

    import httpx2

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "ops_bridge.http_app:from_environment", "--factory",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        env={**os.environ, "OPS_BRIDGE_TOKEN": TOKEN}, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE)
    try:
        base = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 10
        while True:
            try:
                assert httpx2.get(base + "/healthz", timeout=1).json() == {"status": "ok"}
                break
            except httpx2.TransportError:
                assert server.poll() is None and time.monotonic() < deadline
                time.sleep(0.1)
        result = httpx2.post(base + "/v1/embedding/validate", headers=HEADERS, timeout=2,
                             json={"role": "passage", "texts": ["甲", "乙"]})
        assert result.status_code == 200 and result.json()["count"] == 2
        assert httpx2.post(base + "/v1/embedding/validate", timeout=2,
                           json={"role": "passage", "texts": ["甲"]}).status_code == 401
    finally:
        server.terminate()
        server.communicate(timeout=10)
