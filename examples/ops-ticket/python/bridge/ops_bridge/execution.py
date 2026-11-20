"""区分整批失败与逐项保留结果；取消始终向上传播。"""
import asyncio
from dataclasses import dataclass
from typing import Literal

from ops_bridge.contracts import TicketWorker
from ops_bridge.models import TicketSnapshot


@dataclass(frozen=True, slots=True)
class ItemResult:
    ticket_no: str
    status: Literal["ok", "error"]
    text: str | None = None
    error: str | None = None


async def run_all(tickets: tuple[TicketSnapshot, ...], worker: TicketWorker) -> tuple[str, ...]:
    async with asyncio.TaskGroup() as group:
        tasks = [group.create_task(worker(ticket)) for ticket in tickets]
    return tuple(task.result() for task in tasks)


async def run_partial(
    tickets: tuple[TicketSnapshot, ...], worker: TicketWorker
) -> tuple[ItemResult, ...]:
    async def one(ticket: TicketSnapshot) -> ItemResult:
        try:
            text = await worker(ticket)
            return ItemResult(ticket.ticket_no, "ok", text=text)
        except Exception as error:
            # 只记录错误类名，不把可能含敏感数据的异常正文带入报告。
            return ItemResult(ticket.ticket_no, "error", error=type(error).__name__)

    async with asyncio.TaskGroup() as group:
        tasks = [group.create_task(one(ticket)) for ticket in tickets]
    return tuple(task.result() for task in tasks)
