"""草稿可编辑，提交快照只持有不可变字段。"""
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class TicketSnapshot:
    ticket_no: str
    tags: tuple[str, ...]


@dataclass(slots=True)
class TicketDraft:
    ticket_no: str
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.ticket_no.strip():
            raise ValueError("工单号不能为空")

    def add_tag(self, tag: str) -> None:
        cleaned = tag.strip()
        if not cleaned:
            raise ValueError("标签不能为空")
        if cleaned not in self.tags:
            self.tags.append(cleaned)

    def snapshot(self) -> TicketSnapshot:
        # 复制成tuple，后续草稿修改不影响已有快照。
        return TicketSnapshot(self.ticket_no, tuple(self.tags))
