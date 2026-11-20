import asyncio

import pytest

from ops_bridge.diagnostics import format_ticket, gather_in_order, pending_titles


def test_fstring_has_no_dollar() -> None:
    assert format_ticket("T001", 2) == "T001：尝试2次"


def test_pending_filter_does_not_mutate() -> None:
    rows = [
        {"title": "甲", "status": "pending"},
        {"title": "乙", "status": "closed"},
        {"title": "丙", "status": "pending"},
    ]
    assert pending_titles(rows) == ["甲", "丙"]
    assert len(rows) == 3


def test_gather_returns_input_order() -> None:
    async def scenario() -> None:
        second_done = asyncio.Event()
        finished: list[str] = []

        async def first() -> str:
            await second_done.wait()
            finished.append("A")
            return "A"

        async def second() -> str:
            finished.append("B")
            second_done.set()
            return "B"

        result = await gather_in_order([first(), second()])
        assert finished == ["B", "A"]
        assert result == ["A", "B"]

    asyncio.run(scenario())


def test_coroutine_does_not_start_on_call() -> None:
    calls: list[str] = []

    async def job() -> str:
        calls.append("started")
        return "ok"

    coroutine = job()
    assert calls == []
    assert asyncio.run(coroutine) == "ok"
    assert calls == ["started"]


def test_unexpected_indentation_is_rejected() -> None:
    with pytest.raises(IndentationError):
        compile(" value = 1\n", "<诊断片段>", "exec")


def test_semicolon_is_legal_syntax() -> None:
    # 分号不是语法错误；项目风格由Ruff的E702单独检查。
    compile("left = 1; right = 2\n", "<诊断片段>", "exec")
