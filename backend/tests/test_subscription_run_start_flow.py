from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)


ROOT = Path(__file__).resolve().parents[2]


def _deps(
    events: list[Any],
    *,
    subscriptions: list[Any] | None = None,
    source_order: list[str] | None = None,
    started_at: datetime | None = None,
    run_id: str = "run-1",
) -> SubscriptionRunStartDependencies:
    loaded_subscriptions = subscriptions or []
    resolved_source_order = source_order or []
    started_at = started_at or datetime(2026, 7, 2, 9, 30, 0)

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def create_step_log(db: Any, **kwargs: Any) -> None:
        events.append(("step", db, kwargs))

    async def load_active_subscriptions(db: Any) -> list[Any]:
        events.append(("load", db))
        return loaded_subscriptions

    def build_hdhive_unlock_context() -> dict[str, Any]:
        events.append(("unlock",))
        return {"enabled": True, "stats": {"attempts": 0}}

    def resolve_source_order(channel: str) -> list[str]:
        events.append(("source_order", channel))
        return resolved_source_order

    def now() -> datetime:
        events.append(("now",))
        return started_at

    def make_run_id() -> str:
        events.append(("run_id",))
        return run_id

    return SubscriptionRunStartDependencies(
        log_background_event=log_background_event,
        create_step_log=create_step_log,
        load_active_subscriptions=load_active_subscriptions,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        resolve_source_order=resolve_source_order,
        now=now,
        make_run_id=make_run_id,
    )


def _event_names(events: list[Any]) -> list[str]:
    names: list[str] = []
    for event in events:
        if event[0] in {"run_id", "now", "event", "unlock", "load", "step", "progress"}:
            names.append(event[0])
        elif event[0] == "source_order":
            names.append("source_order")
    return names


@pytest.mark.asyncio
async def test_start_subscription_run_builds_context_logs_and_progress() -> None:
    events: list[Any] = []
    subscriptions = [
        SimpleNamespace(id=1, title="A"),
        SimpleNamespace(id=2, title="B"),
    ]

    async def progress_callback(payload: dict[str, Any]) -> None:
        events.append(("progress", payload))

    run_start = await start_subscription_run(
        db="db",
        channel="all",
        force_auto_download=True,
        progress_callback=progress_callback,
        dependencies=_deps(
            events,
            subscriptions=subscriptions,
            source_order=["hdhive", "pansou"],
            run_id="run-fixed",
        ),
    )

    assert _event_names(events) == [
        "run_id",
        "now",
        "event",
        "unlock",
        "source_order",
        "load",
        "step",
        "progress",
    ]
    assert run_start.run_id == "run-fixed"
    assert run_start.started_at == datetime(2026, 7, 2, 9, 30, 0)
    assert run_start.subscriptions == subscriptions
    assert run_start.source_order == ["hdhive", "pansou"]
    assert run_start.hdhive_unlock_context == {
        "enabled": True,
        "stats": {"attempts": 0},
    }
    assert run_start.result["run_id"] == "run-fixed"
    assert run_start.result["channel"] == "all"
    assert run_start.result["checked_count"] == 2
    assert run_start.result["processed_count"] == 0
    assert run_start.result["started_at"] == "2026-07-02T09:30:00"

    assert events[2] == (
        "event",
        {
            "source_type": "background_task",
            "module": "subscriptions",
            "action": "subscription.check.start",
            "status": "info",
            "message": "订阅检查任务启动（频道：all）",
            "trace_id": "run-fixed",
            "extra": {
                "channel": "all",
                "force_auto_download": True,
            },
        },
    )
    assert events[6] == (
        "step",
        "db",
        {
            "run_id": "run-fixed",
            "channel": "all",
            "step": "run_start",
            "status": "info",
            "message": "开始本轮检查，共有 2 个订阅需要处理",
            "payload": {
                "checked_count": 2,
                "source_order": ["hdhive", "pansou"],
                "scope": {
                    "is_active": True,
                    "exclude_transferred_success": False,
                    "cleanup_enabled": True,
                },
            },
        },
    )
    assert events[7] == (
        "progress",
        {
            "channel": "all",
            "status": "running",
            "processed_count": 0,
            "checked_count": 2,
            "new_resource_count": 0,
            "auto_saved_count": 0,
            "auto_failed_count": 0,
            "auto_new_saved_count": 0,
            "auto_new_failed_count": 0,
            "auto_retry_saved_count": 0,
            "auto_retry_failed_count": 0,
            "failed_count": 0,
            "message": "任务开始执行",
        },
    )


@pytest.mark.asyncio
async def test_start_subscription_run_without_progress_callback_returns_context() -> None:
    events: list[Any] = []

    run_start = await start_subscription_run(
        db="db",
        channel="hdhive",
        force_auto_download=False,
        progress_callback=None,
        dependencies=_deps(
            events,
            subscriptions=[],
            source_order=["hdhive"],
            run_id="run-no-progress",
        ),
    )

    assert _event_names(events) == [
        "run_id",
        "now",
        "event",
        "unlock",
        "source_order",
        "load",
        "step",
    ]
    assert run_start.result["checked_count"] == 0
    assert run_start.source_order == ["hdhive"]
    assert not any(event[0] == "progress" for event in events)
    assert events[2][1]["extra"] == {
        "channel": "hdhive",
        "force_auto_download": False,
    }
    assert events[6][2]["message"] == "开始本轮检查，共有 0 个订阅需要处理"


def test_run_start_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_start_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "operation_log_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
