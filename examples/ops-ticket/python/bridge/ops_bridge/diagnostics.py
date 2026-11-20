"""D92：用少量业务输入暴露从JS迁移时容易混淆的语义。"""

import asyncio
from collections.abc import Awaitable


def format_ticket(ticket_no: str, attempts: int) -> str:
    return f"{ticket_no}：尝试{attempts}次"


def pending_titles(rows: list[dict[str, str]]) -> list[str]:
    # 生成新列表，保留原始输入顺序。
    return [row["title"] for row in rows if row["status"] == "pending"]


async def gather_in_order(jobs: list[Awaitable[str]]) -> list[str]:
    # gather按传入位置组织结果；D95再讨论异常时兄弟任务的生命周期。
    return list(await asyncio.gather(*jobs))
