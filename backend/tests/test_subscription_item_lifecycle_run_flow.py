from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.item_lifecycle_run_flow import (
    SubscriptionItemLifecycleDependencies,
    publish_subscription_item_progress,
    start_subscription_item_processing,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeAsyncLock:
    def __init__(self, events: list[Any]) -> None:
        self.events = events
        self.locked = False

    async def __aenter__(self) -> "FakeAsyncLock":
        self.locked = True
        self.events.append(("lock", "enter"))
        return self

    async def __aexit__(
        self,
        exc_type: Any,
        exc: Any,
        tb: Any,
    ) -> None:
        _ = (exc_type, exc, tb)
        self.locked = False
        self.events.append(("lock", "exit"))


def _result(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "channel": "all",
        "checked_count": 3,
        "processed_count": 1,
        "new_resource_count": 4,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "auto_new_saved_count": 2,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 1,
        "failed_count": 0,
    }
    values.update(overrides)
    return values


def _deps(events: list[Any]) -> SubscriptionItemLifecycleDependencies:
    async def create_step_log(db: Any, **kwargs: Any) -> None:
        events.append(("step", db, kwargs))

    return SubscriptionItemLifecycleDependencies(create_step_log=create_step_log)


@pytest.mark.asyncio
async def test_start_subscription_item_processing_writes_start_step() -> None:
    events: list[Any] = []

    await start_subscription_item_processing(
        db="db",
        run_id="run-1",
        channel="all",
        subscription_id=42,
        subscription_title="示例影片",
        dependencies=_deps(events),
    )

    assert events == [
        (
            "step",
            "db",
            {
                "run_id": "run-1",
                "channel": "all",
                "subscription_id": 42,
                "subscription_title": "示例影片",
                "step": "subscription_start",
                "status": "info",
                "message": "正在检查「示例影片」的资源和入库状态",
            },
        )
    ]


@pytest.mark.asyncio
async def test_publish_subscription_item_progress_increments_inside_lock_and_callbacks_after() -> None:
    events: list[Any] = []
    lock = FakeAsyncLock(events)
    result = _result()

    async def progress_callback(payload: dict[str, Any]) -> None:
        events.append(("callback", lock.locked, payload))

    payload = await publish_subscription_item_progress(
        result=result,
        result_lock=lock,
        progress_callback=progress_callback,
    )

    expected_payload = {
        "channel": "all",
        "status": "running",
        "processed_count": 2,
        "checked_count": 3,
        "new_resource_count": 4,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "auto_new_saved_count": 2,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 1,
        "failed_count": 0,
        "message": "已处理 2/3 项订阅",
    }
    assert result["processed_count"] == 2
    assert payload == expected_payload
    assert events == [
        ("lock", "enter"),
        ("lock", "exit"),
        ("callback", False, expected_payload),
    ]


@pytest.mark.asyncio
async def test_publish_subscription_item_progress_without_callback_still_returns_payload() -> None:
    events: list[Any] = []
    result = _result(processed_count=0, checked_count=1)

    payload = await publish_subscription_item_progress(
        result=result,
        result_lock=FakeAsyncLock(events),
        progress_callback=None,
    )

    assert result["processed_count"] == 1
    assert payload["processed_count"] == 1
    assert payload["message"] == "已处理 1/1 项订阅"
    assert events == [("lock", "enter"), ("lock", "exit")]


def test_item_lifecycle_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/item_lifecycle_run_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
