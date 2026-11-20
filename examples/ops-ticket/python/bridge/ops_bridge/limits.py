"""请求体字节上限：FastAPI没有内置限制，在最外层ASGI先读满上限再交给应用。"""
import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

# 最大合法请求是16条×2048码点。UTF-8直传每码点最多4字节；调用方若把非ASCII转义，
# 表情类字符要12字节，约393KB。上限取512KiB，合法请求不会被误拒。
MAX_BODY = 524_288
TOO_LARGE = json.dumps({"error": {"code": "BRIDGE_TOO_LARGE"}}).encode()


class BodyLimit:
    def __init__(self, app: ASGIApp, limit: int = MAX_BODY) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.limit):
            await self.reject(send)
            return
        # 分块传输没有Content-Length，或声明值偏小时，按实际收到的字节累计。
        parts: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            part = message.get("body", b"")
            size += len(part)
            if size > self.limit:
                await self.reject(send)
                return
            parts.append(part)
            if not message.get("more_body", False):
                break
        body = b"".join(parts)
        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def reject(send: Send) -> None:
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(TOO_LARGE)).encode())]})
        await send({"type": "http.response.body", "body": TOO_LARGE})
