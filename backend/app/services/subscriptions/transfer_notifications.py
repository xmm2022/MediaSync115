from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import escape


Notify = Callable[..., Awaitable[None]]
LogWarning = Callable[..., None]


@dataclass(frozen=True)
class TransferNotificationDependencies:
    notify: Notify
    log_warning: LogWarning


async def notify_transfer_success(
    sub_title: str,
    resource_name: str,
    source: str,
    method: str,
    *,
    poster_path: str | None = None,
    dependencies: TransferNotificationDependencies,
) -> None:
    try:
        lines = [
            "<b>订阅 · 转存成功</b>",
            f"订阅：{escape(sub_title)}",
            f"资源：{escape(resource_name)}",
            f"来源：{escape(source)}　方式：{escape(method)}",
        ]
        await dependencies.notify("\n".join(lines), poster_path=poster_path)
    except Exception:
        dependencies.log_warning("订阅转存 TG 通知发送失败", exc_info=True)
