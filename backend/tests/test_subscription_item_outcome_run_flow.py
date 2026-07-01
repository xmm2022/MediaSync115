from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.item_outcome_run_flow import (
    SubscriptionItemOutcomeDependencies,
    complete_subscription_item_success,
    handle_subscription_item_failure,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeDb:
    def __init__(self, events: list[Any]) -> None:
        self._events = events

    async def commit(self) -> None:
        self._events.append(("db", "commit"))

    async def rollback(self) -> None:
        self._events.append(("db", "rollback"))


def _deps(events: list[Any], **overrides: Any) -> SubscriptionItemOutcomeDependencies:
    async def create_step_log(db: Any, **kwargs: Any) -> None:
        events.append(("step", db, kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def apply_subscription_failure(
        subscription_id: int,
        title: str,
        error: BaseException,
    ) -> None:
        events.append(("failure", subscription_id, title, error))

    values: dict[str, Any] = {
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "apply_subscription_failure": apply_subscription_failure,
    }
    values.update(overrides)
    return SubscriptionItemOutcomeDependencies(**values)


@pytest.mark.asyncio
async def test_item_success_outcome_writes_done_logs_and_commits() -> None:
    events: list[Any] = []
    db = FakeDb(events)

    async def fail_on_failure_stats(
        _subscription_id: int,
        _title: str,
        _error: BaseException,
    ) -> None:
        raise AssertionError("success path must not apply failure stats")

    await complete_subscription_item_success(
        db=db,
        run_id="run-1",
        channel="all",
        subscription_id=42,
        subscription_title="示例影片",
        new_record_count=3,
        should_auto_download=True,
        sub_saved_count=2,
        sub_failed_transfer_count=1,
        dependencies=_deps(
            events,
            apply_subscription_failure=fail_on_failure_stats,
        ),
    )

    assert events == [
        (
            "step",
            db,
            {
                "run_id": "run-1",
                "channel": "all",
                "subscription_id": 42,
                "subscription_title": "示例影片",
                "step": "subscription_done",
                "status": "success",
                "message": "订阅处理完成",
            },
        ),
        (
            "event",
            {
                "source_type": "background_task",
                "module": "subscriptions",
                "action": "subscription.item.done",
                "status": "warning",
                "message": "[示例影片]，新资源 3 条，转存成功 2 条，失败 1 条",
                "trace_id": "run-1",
                "extra": {
                    "subscription_id": 42,
                    "title": "示例影片",
                    "channel": "all",
                    "new_resources": 3,
                    "auto_saved": 2,
                    "auto_failed": 1,
                },
            },
        ),
        ("db", "commit"),
    ]


@pytest.mark.asyncio
async def test_item_failure_outcome_rolls_back_applies_stats_logs_and_commits() -> None:
    events: list[Any] = []
    db = FakeDb(events)
    error = RuntimeError("boom")

    await handle_subscription_item_failure(
        db=db,
        run_id="run-2",
        channel="tg",
        subscription_id=43,
        subscription_title="失败影片",
        error=error,
        dependencies=_deps(events),
    )

    assert events == [
        ("db", "rollback"),
        ("failure", 43, "失败影片", error),
        (
            "step",
            db,
            {
                "run_id": "run-2",
                "channel": "tg",
                "subscription_id": 43,
                "subscription_title": "失败影片",
                "step": "subscription_failed",
                "status": "failed",
                "message": "处理出错：boom",
            },
        ),
        (
            "event",
            {
                "source_type": "background_task",
                "module": "subscriptions",
                "action": "subscription.item.failed",
                "status": "failed",
                "message": "[失败影片] 订阅处理失败: boom",
                "trace_id": "run-2",
                "extra": {
                    "subscription_id": 43,
                    "title": "失败影片",
                    "channel": "tg",
                    "error": "boom",
                },
            },
        ),
        ("db", "commit"),
    ]


def test_item_outcome_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/item_outcome_run_flow.py"
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
