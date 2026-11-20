import asyncio

import pytest

from ops_bridge.execution import run_all, run_partial
from ops_bridge.models import TicketSnapshot

TICKETS = (TicketSnapshot("A", ()), TicketSnapshot("B", ()))


def test_group_keeps_input_order() -> None:
    async def scenario() -> None:
        second = asyncio.Event()
        done: list[str] = []

        async def worker(ticket: TicketSnapshot) -> str:
            if ticket.ticket_no == "A":
                await second.wait()
            done.append(ticket.ticket_no)
            second.set()
            return ticket.ticket_no

        assert await run_all(TICKETS, worker) == ("A", "B")
        assert done == ["B", "A"]

    asyncio.run(scenario())


def test_group_failure_waits_for_sibling_cleanup() -> None:
    async def scenario() -> None:
        started = asyncio.Event()
        cleaned: list[str] = []

        async def worker(ticket: TicketSnapshot) -> str:
            if ticket.ticket_no == "B":
                await started.wait()
                raise ValueError("模拟失败")
            try:
                started.set()
                await asyncio.Event().wait()
                return "不可到达"
            finally:
                cleaned.append("A")

        with pytest.raises(ExceptionGroup) as caught:
            await run_all(TICKETS, worker)
        assert any(isinstance(error, ValueError) for error in caught.value.exceptions)
        assert cleaned == ["A"]

    asyncio.run(scenario())


def test_partial_retains_success_and_redacts_error_message() -> None:
    async def worker(ticket: TicketSnapshot) -> str:
        if ticket.ticket_no == "B":
            raise ValueError("此正文不应进入报告")
        return "成功"

    result = asyncio.run(run_partial(TICKETS, worker))
    assert [(row.ticket_no, row.status) for row in result] == [("A", "ok"), ("B", "error")]
    assert result[0].text == "成功"
    assert result[1].error == "ValueError"
    assert result[1].text is None


def test_worker_cancellation_is_not_item_error() -> None:
    async def worker(ticket: TicketSnapshot) -> str:
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run_partial(TICKETS, worker))


def test_parent_cancellation_cleans_children() -> None:
    async def scenario() -> None:
        started = asyncio.Event()
        cleaned: list[str] = []

        async def worker(ticket: TicketSnapshot) -> str:
            try:
                started.set()
                await asyncio.Event().wait()
                return "不可到达"
            finally:
                cleaned.append(ticket.ticket_no)

        task = asyncio.create_task(run_partial(TICKETS, worker))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert sorted(cleaned) == ["A", "B"]

    asyncio.run(scenario())


def test_empty_utility_does_not_call_worker() -> None:
    async def worker(ticket: TicketSnapshot) -> str:
        raise AssertionError("不应调用")

    assert asyncio.run(run_all((), worker)) == ()
    assert asyncio.run(run_partial((), worker)) == ()
