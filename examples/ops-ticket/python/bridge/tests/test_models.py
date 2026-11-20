from dataclasses import FrozenInstanceError, dataclass

import pytest

from ops_bridge.models import TicketDraft, TicketSnapshot


def test_drafts_do_not_share_tags() -> None:
    first, second = TicketDraft("A"), TicketDraft("B")
    first.add_tag(" 网络 ")
    assert first.tags == ["网络"]
    assert second.tags == []


def test_tags_are_normalized_and_deduplicated() -> None:
    draft = TicketDraft("A")
    draft.add_tag(" 网络 ")
    draft.add_tag("网络")
    assert draft.tags == ["网络"]
    with pytest.raises(ValueError, match="标签"):
        draft.add_tag("  ")


def test_snapshot_is_detached() -> None:
    draft = TicketDraft("A")
    draft.add_tag("网络")
    saved = draft.snapshot()
    draft.add_tag("升级")
    assert saved == TicketSnapshot("A", ("网络",))
    assert draft.tags == ["网络", "升级"]


def test_frozen_blocks_field_reassignment() -> None:
    saved = TicketDraft("A").snapshot()
    with pytest.raises(FrozenInstanceError):
        setattr(saved, "ticket_no", "B")


def test_frozen_alone_is_shallow() -> None:
    @dataclass(frozen=True)
    class Shallow:
        tags: list[str]

    value = Shallow([])
    value.tags.append("仍可变")
    assert value.tags == ["仍可变"]


def test_blank_ticket_rejected() -> None:
    with pytest.raises(ValueError, match="工单号"):
        TicketDraft("  ")
