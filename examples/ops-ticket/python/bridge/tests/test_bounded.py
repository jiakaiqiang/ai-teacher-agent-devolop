import asyncio

import pytest

from ops_bridge.bounded import run_bounded
from ops_bridge.models import TicketSnapshot

TICKETS = tuple(TicketSnapshot(str(i), ()) for i in range(5))


def test_peak_concurrency_and_order() -> None:
    async def scenario() -> None:
        ready, release = asyncio.Event(), asyncio.Event()
        active = peak = 0

        async def worker(ticket: TicketSnapshot) -> str:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 2:
                ready.set()
            try:
                await release.wait()
                return ticket.ticket_no
            finally:
                active -= 1

        task = asyncio.create_task(run_bounded(TICKETS, worker, concurrency=2, timeout=2))
        await ready.wait()
        release.set()
        result = await task
        assert peak == 2
        assert active == 0
        assert result == ("0", "1", "2", "3", "4")

    asyncio.run(scenario())


def test_timeout_includes_queue_and_cleans_active_worker() -> None:
    async def scenario() -> None:
        started: list[str] = []
        cleaned: list[str] = []

        async def worker(ticket: TicketSnapshot) -> str:
            started.append(ticket.ticket_no)
            try:
                await asyncio.Event().wait()
                return "不可到达"
            finally:
                cleaned.append(ticket.ticket_no)

        with pytest.raises(TimeoutError):
            await run_bounded(TICKETS, worker, concurrency=1, timeout=0.02)
        assert started == ["0"]
        assert cleaned == ["0"]

    asyncio.run(scenario())


def test_external_cancellation_is_not_timeout() -> None:
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

        task = asyncio.create_task(run_bounded(TICKETS, worker, concurrency=1, timeout=2))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleaned == ["0"]

    asyncio.run(scenario())


def test_invalid_budgets_do_not_start_work() -> None:
    async def worker(ticket: TicketSnapshot) -> str:
        raise AssertionError("不应启动")

    for concurrency in [0, 9, True]:
        with pytest.raises(ValueError):
            asyncio.run(run_bounded(TICKETS, worker, concurrency=concurrency, timeout=1))
    for timeout in [0, -1, float("nan"), float("inf"), True]:
        with pytest.raises(ValueError):
            asyncio.run(run_bounded(TICKETS, worker, concurrency=1, timeout=timeout))
    with pytest.raises(ValueError):
        asyncio.run(run_bounded(TICKETS * 21, worker, concurrency=1, timeout=1))


def test_failure_releases_active_workers() -> None:
    async def scenario() -> None:
        started = asyncio.Event()
        cleaned: list[str] = []

        async def worker(ticket: TicketSnapshot) -> str:
            if ticket.ticket_no == "1":
                await started.wait()
                raise ValueError("失败夹具")
            try:
                started.set()
                await asyncio.Event().wait()
                return "不可到达"
            finally:
                cleaned.append(ticket.ticket_no)

        with pytest.raises(ExceptionGroup):
            await run_bounded(TICKETS[:2], worker, concurrency=2, timeout=2)
        assert cleaned == ["0"]

    asyncio.run(scenario())
