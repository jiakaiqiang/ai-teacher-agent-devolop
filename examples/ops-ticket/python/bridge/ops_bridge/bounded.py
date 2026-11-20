"""有限批次、有限并发、整批截止时间；不强行终止不合作的代码。"""
import asyncio
import math

from ops_bridge.contracts import TicketWorker
from ops_bridge.models import TicketSnapshot


async def run_bounded(
    tickets: tuple[TicketSnapshot, ...], worker: TicketWorker,
    *, concurrency: int, timeout: float,
) -> tuple[str, ...]:
    # 创建协程前先拒绝无效预算，避免未等待协程和无限等待。
    if type(concurrency) is not int or not 1 <= concurrency <= 8:
        raise ValueError("并发必须为1到8的整数")
    if isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("超时必须为有限正数")
    if len(tickets) > 100:
        raise ValueError("批次不能超过100项")
    semaphore = asyncio.Semaphore(concurrency)

    async def one(ticket: TicketSnapshot) -> str:
        async with semaphore:
            return await worker(ticket)

    # 超时包含排队与执行；退出TaskGroup时等待子任务的finally完成。
    async with asyncio.timeout(timeout):
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(one(ticket)) for ticket in tickets]
    return tuple(task.result() for task in tasks)
