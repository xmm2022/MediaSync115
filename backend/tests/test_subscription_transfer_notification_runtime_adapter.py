from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.transfer_notification_runtime_adapter import (
    TransferNotificationRuntimeDependencies,
    build_default_transfer_notification_runtime_dependencies,
    notify_transfer_success_with_runtime_adapter,
    send_tg_bot_notification,
)
from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> TransferNotificationRuntimeDependencies:
    async def notify(message: str, *, poster_path: str | None = None) -> None:
        _ = (message, poster_path)

    def log_warning(message: str, **kwargs: Any) -> None:
        _ = (message, kwargs)

    async def run_notify_transfer_success(
        *args: Any,
        **kwargs: Any,
    ) -> None:
        _ = (args, kwargs)

    values: dict[str, Any] = {
        "notify": notify,
        "log_warning": log_warning,
        "run_notify_transfer_success": run_notify_transfer_success,
    }
    values.update(overrides)
    return TransferNotificationRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_arguments() -> None:
    events: list[tuple[str, Any]] = []
    runner_calls: list[dict[str, Any]] = []

    async def notify(message: str, *, poster_path: str | None = None) -> None:
        events.append(("notify", message, poster_path))

    def log_warning(message: str, **kwargs: Any) -> None:
        events.append(("warning", message, kwargs))

    async def run_notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        *,
        poster_path: str | None = None,
        dependencies: TransferNotificationDependencies,
    ) -> None:
        runner_calls.append(
            {
                "sub_title": sub_title,
                "resource_name": resource_name,
                "source": source,
                "method": method,
                "poster_path": poster_path,
                "dependencies": dependencies,
            }
        )
        await dependencies.notify("message", poster_path=poster_path)
        dependencies.log_warning("warn", exc_info=True)

    await notify_transfer_success_with_runtime_adapter(
        "订阅 A",
        "资源 B",
        "hdhive",
        "分享转存",
        poster_path="/poster.jpg",
        dependencies=_dependencies(
            notify=notify,
            log_warning=log_warning,
            run_notify_transfer_success=run_notify_transfer_success,
        ),
    )

    assert len(runner_calls) == 1
    assert runner_calls[0]["sub_title"] == "订阅 A"
    assert runner_calls[0]["resource_name"] == "资源 B"
    assert runner_calls[0]["source"] == "hdhive"
    assert runner_calls[0]["method"] == "分享转存"
    assert runner_calls[0]["poster_path"] == "/poster.jpg"
    assert isinstance(
        runner_calls[0]["dependencies"],
        TransferNotificationDependencies,
    )
    assert events == [
        ("notify", "message", "/poster.jpg"),
        ("warning", "warn", {"exc_info": True}),
    ]


def test_default_runtime_dependencies_bind_existing_sender_and_runner() -> None:
    dependencies = build_default_transfer_notification_runtime_dependencies()

    assert dependencies.notify is send_tg_bot_notification
    assert dependencies.run_notify_transfer_success is notify_transfer_success
    assert callable(dependencies.log_warning)


def test_transfer_notification_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/transfer_notification_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
