"""本地批处理练习：只生成标签摘要，不调用模型或执行工单操作。"""
import asyncio
from dataclasses import dataclass
from typing import Literal

from ops_bridge.bounded import run_bounded
from ops_bridge.contracts import parse_request
from ops_bridge.models import TicketSnapshot


@dataclass(frozen=True, slots=True)
class ReportItem:
    ticket_no: str
    text: str


@dataclass(frozen=True, slots=True)
class BatchReport:
    mode: Literal["local_mock"]
    count: int
    items: tuple[ReportItem, ...]


async def mock_worker(ticket: TicketSnapshot) -> str:
    await asyncio.sleep(0)  # 让出循环，展示异步接口；不是模型推理耗时。
    return f"{ticket.ticket_no}：{len(ticket.tags)}个标签"


async def build_report(value: object) -> BatchReport:
    request = parse_request(value)
    texts = await run_bounded(request.tickets, mock_worker,
                              concurrency=request.concurrency, timeout=2)
    items = tuple(ReportItem(ticket.ticket_no, text)
                  for ticket, text in zip(request.tickets, texts, strict=True))
    return BatchReport("local_mock", len(items), items)
