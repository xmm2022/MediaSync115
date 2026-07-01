from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(
    *,
    send_error: Exception | None = None,
) -> tuple[
    TransferNotificationDependencies,
    list[tuple[str, str | None]],
    list[tuple[str, dict[str, Any]]],
]:
    sent: list[tuple[str, str | None]] = []
    warnings: list[tuple[str, dict[str, Any]]] = []

    async def notify(message: str, *, poster_path: str | None = None) -> None:
        if send_error is not None:
            raise send_error
        sent.append((message, poster_path))

    def log_warning(message: str, **kwargs: Any) -> None:
        warnings.append((message, kwargs))

    return (
        TransferNotificationDependencies(
            notify=notify,
            log_warning=log_warning,
        ),
        sent,
        warnings,
    )


@pytest.mark.asyncio
async def test_notify_transfer_success_sends_escaped_html_message_with_poster() -> None:
    dependencies, sent, warnings = _dependencies()

    await notify_transfer_success(
        "A&B <剧>",
        "资源 <一>",
        "hdhive&tg",
        "分享<转存>",
        poster_path="/poster.jpg",
        dependencies=dependencies,
    )

    assert warnings == []
    assert sent == [
        (
            "\n".join(
                [
                    "<b>订阅 · 转存成功</b>",
                    "订阅：A&amp;B &lt;剧&gt;",
                    "资源：资源 &lt;一&gt;",
                    "来源：hdhive&amp;tg　方式：分享&lt;转存&gt;",
                ]
            ),
            "/poster.jpg",
        )
    ]


@pytest.mark.asyncio
async def test_notify_transfer_success_swallows_sender_errors_and_logs_warning() -> None:
    dependencies, sent, warnings = _dependencies(send_error=RuntimeError("boom"))

    await notify_transfer_success(
        "测试订阅",
        "资源 A",
        "pansou",
        "分享转存",
        dependencies=dependencies,
    )

    assert sent == []
    assert warnings == [
        (
            "订阅转存 TG 通知发送失败",
            {"exc_info": True},
        )
    ]


def test_transfer_notifications_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/transfer_notifications.py"
    ).read_text(encoding="utf-8")

    forbidden_tokens = [
        "subscription_service",
        "runtime_settings_service",
        "tg_bot",
        "AsyncSession",
        "app.models",
        "app.api",
    ]
    for token in forbidden_tokens:
        assert token not in source
