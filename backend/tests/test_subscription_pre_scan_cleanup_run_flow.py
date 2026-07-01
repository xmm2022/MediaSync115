from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.pre_scan_cleanup_run_flow import (
    PreScanCleanupRunDependencies,
    run_pre_scan_cleanup_for_subscription,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeDb:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {"id": 101, "title": "示例影片", "media_type": "movie"}
    values.update(overrides)
    return SimpleNamespace(**values)


def _deps(
    events: list[Any],
    *,
    cleanup_result: dict[str, Any] | None = None,
    **overrides: Any,
) -> PreScanCleanupRunDependencies:
    async def evaluate_pre_scan_cleanup(
        _db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
    ) -> dict[str, Any]:
        events.append(("evaluate", run_id, channel, sub))
        return cleanup_result or {"deleted": False}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def apply_cleanup_stats(media_type: Any) -> None:
        events.append(("apply_cleanup", media_type))

    values: dict[str, Any] = {
        "evaluate_pre_scan_cleanup": evaluate_pre_scan_cleanup,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "apply_cleanup_stats": apply_cleanup_stats,
    }
    values.update(overrides)
    return PreScanCleanupRunDependencies(**values)


@pytest.mark.asyncio
async def test_pre_scan_cleanup_not_deleted_returns_snapshot_without_side_effects() -> None:
    events: list[Any] = []
    db = FakeDb()
    sub = _sub()
    snapshot = {"status": "missing", "count": 2}
    cleanup_result = {
        "deleted": False,
        "tv_missing_snapshot": snapshot,
        "reason": "not_complete",
    }

    result = await run_pre_scan_cleanup_for_subscription(
        db=db,
        run_id="run-1",
        channel="all",
        sub=sub,
        dependencies=_deps(events, cleanup_result=cleanup_result),
    )

    assert result.deleted is False
    assert result.tv_missing_snapshot is snapshot
    assert result.cleanup_result == cleanup_result
    assert events == [("evaluate", "run-1", "all", sub)]
    assert db.commits == 0


@pytest.mark.asyncio
async def test_pre_scan_cleanup_deleted_logs_applies_stats_and_commits() -> None:
    events: list[Any] = []
    db = FakeDb()
    sub = _sub(media_type="tv")
    cleanup_result = {"deleted": True}

    result = await run_pre_scan_cleanup_for_subscription(
        db=db,
        run_id="run-2",
        channel="tg",
        sub=sub,
        dependencies=_deps(events, cleanup_result=cleanup_result),
    )

    assert result.deleted is True
    assert result.tv_missing_snapshot is None
    assert result.cleanup_result == cleanup_result
    assert db.commits == 1
    assert events == [
        ("evaluate", "run-2", "tg", sub),
        ("apply_cleanup", "tv"),
        (
            "step",
            {
                "run_id": "run-2",
                "channel": "tg",
                "subscription_id": 101,
                "subscription_title": "示例影片",
                "step": "subscription_done",
                "status": "success",
                "message": "订阅已自动清理",
            },
        ),
        (
            "event",
            {
                "source_type": "background_task",
                "module": "subscriptions",
                "action": "subscription.item.done",
                "status": "success",
                "message": "[示例影片] 订阅已自动清理（转存完成或已入库）",
                "trace_id": "run-2",
                "extra": {
                    "subscription_id": 101,
                    "title": "示例影片",
                    "channel": "tg",
                },
            },
        ),
    ]


@pytest.mark.asyncio
async def test_pre_scan_cleanup_passes_runtime_inputs_to_evaluate_callback() -> None:
    calls: list[Any] = []
    db = FakeDb()
    sub = _sub(id=202)

    async def evaluate_pre_scan_cleanup(
        current_db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
    ) -> dict[str, Any]:
        calls.append((current_db, run_id, channel, sub))
        return {"deleted": False, "tv_missing_snapshot": {"status": "ok"}}

    result = await run_pre_scan_cleanup_for_subscription(
        db=db,
        run_id="run-3",
        channel="hdhive",
        sub=sub,
        dependencies=_deps(
            [],
            evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        ),
    )

    assert result.deleted is False
    assert result.tv_missing_snapshot == {"status": "ok"}
    assert calls == [(db, "run-3", "hdhive", sub)]


def test_pre_scan_cleanup_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/pre_scan_cleanup_run_flow.py"
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
