import asyncio
import json
import os
import subprocess
import sys

import pytest

from ops_bridge.batch import build_report


def test_report_preserves_identity_and_normalizes_tags() -> None:
    result = asyncio.run(build_report({"tickets": [
        {"ticket_no": " B ", "tags": [" 网络 ", "网络"]},
        {"ticket_no": "A", "tags": []}], "concurrency": 2}))
    assert result.mode == "local_mock"
    assert result.count == 2
    assert [(item.ticket_no, item.text) for item in result.items] == [
        ("B", "B：1个标签"), ("A", "A：0个标签")]


def test_report_rejects_invalid_before_execution() -> None:
    with pytest.raises(ValueError):
        asyncio.run(build_report({"tickets": [], "concurrency": True}))


def invoke(raw: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", "ops_bridge", *args], input=raw,
                          capture_output=True, encoding="utf8", timeout=5,
                          env={**os.environ, "PYTHONIOENCODING": "utf-8"})


def test_cli_demo_is_explicit_mock() -> None:
    result = invoke("", "--demo")
    assert result.returncode == 0
    assert result.stderr == ""
    value = json.loads(result.stdout)
    assert value == {"mode": "local_mock", "count": 2, "items": [
        {"ticket_no": "T001", "text": "T001：1个标签"},
        {"ticket_no": "T002", "text": "T002：0个标签"}]}


def test_cli_stdin_round_trip() -> None:
    result = invoke(json.dumps({"tickets": [{"ticket_no": "甲", "tags": ["修复"]}],
                                "concurrency": 1}))
    assert result.returncode == 0
    assert json.loads(result.stdout)["items"] == [{"ticket_no": "甲", "text": "甲：1个标签"}]


@pytest.mark.parametrize("raw", ['{"private-example":', '[]', 'x' * 65_537,
                                '[' * 2000 + ']' * 2000],
                         ids=["invalid-json", "invalid-shape", "oversize", "too-deep"])
def test_cli_invalid_input_has_safe_error(raw: str) -> None:
    result = invoke(raw)
    assert result.returncode == 2
    assert result.stdout == ""
    assert json.loads(result.stderr) == {"error": "invalid_request"}
