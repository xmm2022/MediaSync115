from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
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


class FakeDb:
    def __init__(self, events: list[Any]) -> None:
        self.events = events

    async def commit(self) -> None:
        self.events.append(("commit",))

    async def rollback(self) -> None:
        self.events.append(("rollback",))


class FakeSessionFactory:
    def __init__(self, events: list[Any]) -> None:
        self.events = events
        self.db = FakeDb(events)

    def __call__(self) -> "FakeSessionFactory":
        return self

    async def __aenter__(self) -> FakeDb:
        self.events.append(("session", "enter"))
        return self.db

    async def __aexit__(
        self,
        exc_type: Any,
        exc: Any,
        tb: Any,
    ) -> None:
        _ = (exc_type, exc, tb)
        self.events.append(("session", "exit"))


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 101,
        "title": "示例影片",
        "media_type": "tv",
        "auto_download": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _record(record_id: int, url: str) -> SimpleNamespace:
    return SimpleNamespace(id=record_id, resource_url=url)


def _result(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "channel": "all",
        "checked_count": 1,
        "processed_count": 0,
        "new_resource_count": 0,
        "resource_checked_count": 0,
        "resource_duplicate_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "failed_count": 0,
        "cleanup_deleted_count": 0,
        "cleanup_movie_deleted_count": 0,
        "cleanup_tv_deleted_count": 0,
        "errors": [],
    }
    values.update(overrides)
    return values


def _markers(events: list[Any]) -> list[str]:
    markers: list[str] = []
    for event in events:
        if event[0] == "session":
            markers.append(f"session:{event[1]}")
        elif event[0] == "step":
            markers.append(f"step:{event[1]}")
        elif event[0] == "event":
            markers.append(f"event:{event[1]}")
        elif event[0] == "auto_save":
            markers.append(f"auto_save:{event[1]}")
        elif event[0] in {
            "cleanup",
            "fetch",
            "store",
            "load_retry",
            "policy",
            "commit",
            "rollback",
            "progress",
        }:
            markers.append(event[0])
    return markers


def _assert_in_order(markers: list[str], expected: list[str]) -> None:
    position = 0
    for marker in markers:
        if marker == expected[position]:
            position += 1
            if position == len(expected):
                return
    raise AssertionError(f"{expected!r} not found in order within {markers!r}")


def _deps(
    events: list[Any],
    session_factory: FakeSessionFactory,
    **overrides: Any,
) -> SubscriptionItemProcessingDependencies:
    tv_missing_snapshot = {
        "status": "ok",
        "missing_episodes": [[1, 2]],
    }
    created_records = [_record(1, "https://115.com/s/new")]

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs["step"], kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs["action"], kwargs))

    async def evaluate_pre_scan_cleanup(_db: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("cleanup", kwargs["sub"].id))
        return {
            "deleted": False,
            "tv_missing_snapshot": tv_missing_snapshot,
        }

    async def fetch_resources(
        channel: str,
        sub: Any,
        hdhive_unlock_context: dict[str, Any],
        *,
        source_order: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        events.append(
            (
                "fetch",
                channel,
                sub.id,
                hdhive_unlock_context,
                source_order,
            )
        )
        return (
            [{"resource_url": "https://115.com/s/new"}],
            [],
            {
                "summary": "命中资源",
                "source_order": source_order,
                "attempts": [],
            },
        )

    async def store_new_resources(
        _db: Any,
        subscription_id: int,
        resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        events.append(("store", subscription_id, resources))
        return {
            "checked_count": 2,
            "duplicate_count": 1,
            "invalid_count": 0,
            "created_records": created_records,
            "duplicate_urls": [],
        }

    async def load_retryable_records(_db: Any, subscription_id: int) -> list[Any]:
        events.append(("load_retry", subscription_id))
        return []

    async def load_force_retry_records(
        _db: Any,
        subscription_id: int,
        duplicate_urls: list[str],
    ) -> list[Any]:
        events.append(("load_force_retry", subscription_id, duplicate_urls))
        return []

    async def auto_save_records_with_link_fallback(
        _db: Any,
        _run_id: str,
        _channel: str,
        _sub: Any,
        records: list[Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("auto_save", kwargs["transfer_source"], records))
        return {"saved": 2, "failed": 1, "errors": []}

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return False

    async def scan_fixed_sources_for_subscription(
        _db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("scan", kwargs))
        return {"saved": 0, "failed": 0}

    async def delete_subscription_with_records(
        _db: Any,
        subscription_id: int,
    ) -> None:
        events.append(("delete", subscription_id))

    values: dict[str, Any] = {
        "session_factory": session_factory,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "evaluate_pre_scan_cleanup": evaluate_pre_scan_cleanup,
        "fetch_resources": fetch_resources,
        "store_new_resources": store_new_resources,
        "load_retryable_records": load_retryable_records,
        "load_force_retry_records": load_force_retry_records,
        "auto_save_records_with_link_fallback": auto_save_records_with_link_fallback,
        "should_scan_fixed_sources": should_scan_fixed_sources,
        "scan_fixed_sources_for_subscription": scan_fixed_sources_for_subscription,
        "delete_subscription_with_records": delete_subscription_with_records,
    }
    values.update(overrides)
    return SubscriptionItemProcessingDependencies(**values)


@pytest.mark.asyncio
async def test_process_subscription_item_success_runs_stages_and_updates_stats() -> None:
    events: list[Any] = []
    session_factory = FakeSessionFactory(events)
    result = _result()
    lock = FakeAsyncLock(events)

    async def progress_callback(payload: dict[str, Any]) -> None:
        events.append(("progress", lock.locked, payload))

    await process_subscription_item(
        sub=_sub(),
        run_id="run-1",
        channel="all",
        force_auto_download=False,
        hdhive_unlock_context={"stats": {"attempts": 1}},
        source_order=["pansou"],
        result=result,
        result_lock=lock,
        progress_callback=progress_callback,
        tv_media_type="tv",
        dependencies=_deps(events, session_factory),
    )

    markers = _markers(events)
    _assert_in_order(
        markers,
        [
            "session:enter",
            "step:subscription_start",
            "cleanup",
            "fetch",
            "store",
            "load_retry",
            "step:auto_transfer_new_start",
            "auto_save:new",
            "step:auto_transfer_new_done",
            "step:auto_transfer_summary",
            "policy",
            "step:subscription_done",
            "commit",
            "progress",
            "session:exit",
        ],
    )
    assert result["new_resource_count"] == 1
    assert result["resource_checked_count"] == 2
    assert result["resource_duplicate_count"] == 1
    assert result["auto_saved_count"] == 2
    assert result["auto_failed_count"] == 1
    assert result["auto_new_saved_count"] == 2
    assert result["auto_new_failed_count"] == 1
    assert result["processed_count"] == 1
    assert result["failed_count"] == 0
    assert ("rollback",) not in events
    assert events[-2][0] == "progress"
    assert events[-2][1] is False
    assert events[-2][2]["message"] == "已处理 1/1 项订阅"


@pytest.mark.asyncio
async def test_process_subscription_item_cleanup_early_return_skips_later_stages() -> None:
    events: list[Any] = []
    session_factory = FakeSessionFactory(events)
    result = _result()

    async def evaluate_pre_scan_cleanup(_db: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("cleanup", kwargs["sub"].id))
        return {
            "deleted": True,
            "tv_missing_snapshot": {"status": "ok"},
        }

    await process_subscription_item(
        sub=_sub(),
        run_id="run-2",
        channel="all",
        force_auto_download=False,
        hdhive_unlock_context={"stats": {}},
        source_order=["pansou"],
        result=result,
        result_lock=FakeAsyncLock(events),
        progress_callback=None,
        tv_media_type="tv",
        dependencies=_deps(
            events,
            session_factory,
            evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        ),
    )

    markers = _markers(events)
    _assert_in_order(
        markers,
        [
            "session:enter",
            "step:subscription_start",
            "cleanup",
            "step:subscription_done",
            "commit",
            "session:exit",
        ],
    )
    assert "fetch" not in markers
    assert "store" not in markers
    assert not any(marker.startswith("auto_save") for marker in markers)
    assert markers.count("step:subscription_done") == 1
    assert result["cleanup_deleted_count"] == 1
    assert result["cleanup_tv_deleted_count"] == 1
    assert result["cleanup_movie_deleted_count"] == 0
    assert result["processed_count"] == 1
    assert result["failed_count"] == 0
    assert ("rollback",) not in events


@pytest.mark.asyncio
async def test_process_subscription_item_failure_rolls_back_records_failure_and_progress() -> None:
    events: list[Any] = []
    session_factory = FakeSessionFactory(events)
    result = _result()
    lock = FakeAsyncLock(events)

    async def fetch_resources(
        channel: str,
        sub: Any,
        hdhive_unlock_context: dict[str, Any],
        *,
        source_order: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        events.append(("fetch", channel, sub.id, hdhive_unlock_context, source_order))
        raise RuntimeError("fetch failed")

    async def progress_callback(payload: dict[str, Any]) -> None:
        events.append(("progress", lock.locked, payload))

    await process_subscription_item(
        sub=_sub(id=202, title="失败影片"),
        run_id="run-3",
        channel="all",
        force_auto_download=False,
        hdhive_unlock_context={"stats": {}},
        source_order=["pansou"],
        result=result,
        result_lock=lock,
        progress_callback=progress_callback,
        tv_media_type="tv",
        dependencies=_deps(
            events,
            session_factory,
            fetch_resources=fetch_resources,
        ),
    )

    markers = _markers(events)
    _assert_in_order(
        markers,
        [
            "session:enter",
            "step:subscription_start",
            "cleanup",
            "fetch",
            "rollback",
            "step:subscription_failed",
            "event:subscription.item.failed",
            "commit",
            "progress",
            "session:exit",
        ],
    )
    assert "store" not in markers
    assert result["failed_count"] == 1
    assert result["errors"] == [
        {
            "subscription_id": 202,
            "title": "失败影片",
            "error": "fetch failed",
        }
    ]
    assert result["processed_count"] == 1
    assert events[-2][0] == "progress"
    assert events[-2][1] is False
    assert events[-2][2]["failed_count"] == 1


def test_item_processing_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/item_processing_run_flow.py"
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
