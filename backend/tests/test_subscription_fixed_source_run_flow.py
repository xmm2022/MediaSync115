from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.fixed_source_run_flow import (
    FixedSourceRunDependencies,
    run_fixed_source_for_subscription,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 101,
        "title": "示例影片",
        "media_type": MediaType.MOVIE,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _deps(events: list[Any], **overrides: Any) -> FixedSourceRunDependencies:
    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return True

    async def scan_fixed_sources_for_subscription(
        _db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("scan", kwargs))
        return {"saved": 0, "failed": 0, "checked": 0}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def delete_subscription_with_records(
        _db: Any,
        subscription_id: int,
    ) -> None:
        events.append(("delete", subscription_id))

    async def apply_fixed_source_transfer_stats(saved: int, failed: int) -> None:
        events.append(("apply_fixed", saved, failed))

    async def apply_cleanup_stats(media_type: Any) -> None:
        events.append(("apply_cleanup", media_type))

    values: dict[str, Any] = {
        "should_scan_fixed_sources": should_scan_fixed_sources,
        "scan_fixed_sources_for_subscription": scan_fixed_sources_for_subscription,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "delete_subscription_with_records": delete_subscription_with_records,
        "apply_fixed_source_transfer_stats": apply_fixed_source_transfer_stats,
        "apply_cleanup_stats": apply_cleanup_stats,
    }
    values.update(overrides)
    return FixedSourceRunDependencies(**values)


@pytest.mark.asyncio
async def test_fixed_source_run_skips_when_auto_transfer_already_cleaned() -> None:
    events: list[Any] = []

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        raise AssertionError("policy should not run after auto cleanup")

    result = await run_fixed_source_for_subscription(
        db="db",
        run_id="run-1",
        channel="电影",
        sub=_sub(),
        cleanup_after_auto={"subscription_completed": True},
        force_auto_download=True,
        tv_missing_snapshot={"status": "ok"},
        dependencies=_deps(
            events,
            should_scan_fixed_sources=should_scan_fixed_sources,
        ),
    )

    assert result.sub_saved_count_delta == 0
    assert result.sub_failed_transfer_count_delta == 0
    assert result.fixed_source_stats is None
    assert result.movie_cleanup_applied is False
    assert events == []


@pytest.mark.asyncio
async def test_fixed_source_run_skips_when_policy_is_false() -> None:
    events: list[Any] = []

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return False

    async def scan_fixed_sources_for_subscription(
        _db: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        raise AssertionError("scan should not run when policy is false")

    result = await run_fixed_source_for_subscription(
        db="db",
        run_id="run-2",
        channel="电影",
        sub=_sub(),
        cleanup_after_auto=None,
        force_auto_download=False,
        tv_missing_snapshot=None,
        dependencies=_deps(
            events,
            should_scan_fixed_sources=should_scan_fixed_sources,
            scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        ),
    )

    assert result.sub_saved_count_delta == 0
    assert result.sub_failed_transfer_count_delta == 0
    assert result.fixed_source_stats is None
    assert result.movie_cleanup_applied is False
    assert events == [("policy", False)]


@pytest.mark.asyncio
async def test_fixed_source_run_applies_tv_scan_stats_without_cleanup() -> None:
    events: list[Any] = []
    tv_missing_snapshot = {"status": "ok", "missing_episodes": [[1, 2]]}
    stats = {"saved": "2", "failed": "1", "checked": 3}

    async def scan_fixed_sources_for_subscription(
        db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        assert db == "db"
        events.append(("scan", kwargs))
        return stats

    result = await run_fixed_source_for_subscription(
        db="db",
        run_id="run-3",
        channel="剧集",
        sub=_sub(media_type=MediaType.TV),
        cleanup_after_auto=None,
        force_auto_download=True,
        tv_missing_snapshot=tv_missing_snapshot,
        dependencies=_deps(
            events,
            scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        ),
    )

    assert result.sub_saved_count_delta == 2
    assert result.sub_failed_transfer_count_delta == 1
    assert result.fixed_source_stats == stats
    assert result.movie_cleanup_applied is False
    assert ("apply_fixed", 2, 1) in events
    assert not any(event[0] == "delete" for event in events)
    assert not any(event[0] == "apply_cleanup" for event in events)

    scan_event = next(event for event in events if event[0] == "scan")
    assert scan_event[1] == {
        "run_id": "run-3",
        "channel": "剧集",
        "sub": _sub(media_type=MediaType.TV),
        "tv_missing_snapshot": tv_missing_snapshot,
        "force_auto_download": True,
    }


@pytest.mark.asyncio
async def test_fixed_source_run_cleans_movie_subscription_after_saved_files() -> None:
    events: list[Any] = []
    stats = {"saved": 3, "failed": 0, "checked": 1}

    async def scan_fixed_sources_for_subscription(
        _db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("scan", kwargs))
        return stats

    result = await run_fixed_source_for_subscription(
        db="db",
        run_id="run-4",
        channel="电影",
        sub=_sub(),
        cleanup_after_auto=None,
        force_auto_download=False,
        tv_missing_snapshot=None,
        dependencies=_deps(
            events,
            scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        ),
    )

    assert result.sub_saved_count_delta == 3
    assert result.sub_failed_transfer_count_delta == 0
    assert result.fixed_source_stats == stats
    assert result.movie_cleanup_applied is True
    assert ("apply_fixed", 3, 0) in events
    assert ("delete", 101) in events
    assert ("apply_cleanup", MediaType.MOVIE) in events

    event_payloads = [event[1] for event in events if event[0] == "event"]
    assert event_payloads == [
        {
            "source_type": "background_task",
            "module": "subscriptions",
            "action": "subscription.item.cleanup_after_fixed_source",
            "status": "success",
            "message": "[示例影片] 电影固定来源转存完成，自动删除订阅",
            "trace_id": "run-4",
            "extra": {
                "subscription_id": 101,
                "title": "示例影片",
                "reason": "movie_fixed_source_transferred",
            },
        }
    ]
    step_payloads = [event[1] for event in events if event[0] == "step"]
    assert step_payloads == [
        {
            "run_id": "run-4",
            "channel": "电影",
            "subscription_id": 101,
            "subscription_title": "示例影片",
            "step": "subscription_cleanup_movie_fixed_source",
            "status": "success",
            "message": "电影固定来源转存完成，订阅已自动清理",
            "payload": {"fixed_saved": 3},
        }
    ]


def test_fixed_source_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/fixed_source_run_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.api" not in source
