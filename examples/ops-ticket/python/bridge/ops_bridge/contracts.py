"""未知输入先校验，再进入有类型的内部逻辑。"""
from dataclasses import dataclass
from typing import Protocol

from ops_bridge.models import TicketDraft, TicketSnapshot


class TicketWorker(Protocol):
    async def __call__(self, ticket: TicketSnapshot) -> str: ...


@dataclass(frozen=True, slots=True)
class BatchRequest:
    tickets: tuple[TicketSnapshot, ...]
    concurrency: int


def parse_request(value: object) -> BatchRequest:
    if not isinstance(value, dict) or set(value) != {"tickets", "concurrency"}:
        raise ValueError("请求字段必须为tickets和concurrency")
    concurrency = value["concurrency"]
    # bool是int的子类；业务整数明确排除bool。
    if type(concurrency) is not int or not 1 <= concurrency <= 8:
        raise ValueError("concurrency必须为1到8的整数")
    rows = value["tickets"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise ValueError("tickets必须为1到100项列表")
    tickets: list[TicketSnapshot] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"ticket_no", "tags"}:
            raise ValueError("工单字段不合法")
        ticket_no, tags = row["ticket_no"], row["tags"]
        if not isinstance(ticket_no, str) or not 1 <= len(ticket_no.strip()) <= 64:
            raise ValueError("工单号长度必须为1到64")
        ticket_no = ticket_no.strip()
        if ticket_no in seen:
            raise ValueError("工单号重复")
        seen.add(ticket_no)
        if not isinstance(tags, list) or len(tags) > 10:
            raise ValueError("tags必须为至多10项列表")
        draft = TicketDraft(ticket_no)
        for tag in tags:
            if not isinstance(tag, str) or not 1 <= len(tag.strip()) <= 64:
                raise ValueError("标签长度必须为1到64")
            draft.add_tag(tag)
        tickets.append(draft.snapshot())
    return BatchRequest(tuple(tickets), concurrency)
