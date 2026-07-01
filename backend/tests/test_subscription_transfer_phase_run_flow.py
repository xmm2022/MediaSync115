from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.transfer_phase_run_flow import (
    SubscriptionTransferPhaseDependencies,
    run_subscription_transfer_phase,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 101,
        "title": "示例影片",
        "auto_download": True,
        "media_type": "tv",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _record(record_id: int, url: str) -> SimpleNamespace:
    return SimpleNamespace(id=record_id, resource_url=url)


def _deps(events: list[Any], **overrides: Any) -> SubscriptionTransferPhaseDependencies:
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
        return {"saved": 0, "failed": 0}

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return False

    async def scan_fixed_sources_for_subscription(
        _db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("scan", kwargs))
        return {"saved": 0, "failed": 0}

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def log_background_event(**_kwargs: Any) -> None:
        return None

    async def delete_subscription_with_records(
        _db: Any,
        subscription_id: int,
    ) -> None:
        events.append(("delete", subscription_id))

    async def apply_auto_transfer_stats(
        stats: dict[str, Any],
        transfer_source: str,
    ) -> None:
        events.append(("apply_auto", transfer_source, stats))

    async def apply_fixed_source_transfer_stats(saved: int, failed: int) -> None:
        events.append(("apply_fixed", saved, failed))

    async def apply_cleanup_stats(media_type: Any) -> None:
        events.append(("apply_cleanup", media_type))

    values: dict[str, Any] = {
        "load_retryable_records": load_retryable_records,
        "load_force_retry_records": load_force_retry_records,
        "auto_save_records_with_link_fallback": auto_save_records_with_link_fallback,
        "should_scan_fixed_sources": should_scan_fixed_sources,
        "scan_fixed_sources_for_subscription": scan_fixed_sources_for_subscription,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "delete_subscription_with_records": delete_subscription_with_records,
        "apply_auto_transfer_stats": apply_auto_transfer_stats,
        "apply_fixed_source_transfer_stats": apply_fixed_source_transfer_stats,
        "apply_cleanup_stats": apply_cleanup_stats,
    }
    values.update(overrides)
    return SubscriptionTransferPhaseDependencies(**values)


@pytest.mark.asyncio
async def test_transfer_phase_runs_auto_retry_then_fixed_source_and_aggregates() -> None:
    events: list[Any] = []
    retry_record = _record(2, "https://115.com/s/retry")
    created_records = [_record(1, "https://115.com/s/new")]
    tv_missing_snapshot = {"status": "ok", "missing": [[1, 2]]}

    async def load_retryable_records(_db: Any, subscription_id: int) -> list[Any]:
        events.append(("load_retry", subscription_id))
        return [retry_record]

    async def auto_save_records_with_link_fallback(
        _db: Any,
        _run_id: str,
        _channel: str,
        _sub: Any,
        records: list[Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("auto_save", kwargs["transfer_source"], records))
        if kwargs["transfer_source"] == "new":
            assert kwargs["tv_missing_snapshot"] is tv_missing_snapshot
            assert kwargs["source_order"] == ["pansou", "hdhive"]
            return {"saved": 1, "failed": 1}
        assert kwargs["enable_link_refetch"] is False
        return {"saved": 2, "failed": 0}

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return True

    async def scan_fixed_sources_for_subscription(
        db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        assert db == "db"
        events.append(("scan", kwargs))
        return {"saved": "3", "failed": "1"}

    result = await run_subscription_transfer_phase(
        db="db",
        run_id="run-1",
        channel="all",
        sub=_sub(),
        force_auto_download=True,
        duplicate_urls=[],
        created_records=created_records,
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context={"stats": {"attempts": 1}},
        source_order=["pansou", "hdhive"],
        dependencies=_deps(
            events,
            load_retryable_records=load_retryable_records,
            auto_save_records_with_link_fallback=(
                auto_save_records_with_link_fallback
            ),
            should_scan_fixed_sources=should_scan_fixed_sources,
            scan_fixed_sources_for_subscription=(
                scan_fixed_sources_for_subscription
            ),
        ),
    )

    assert result.should_auto_download is True
    assert result.sub_saved_count == 6
    assert result.sub_failed_transfer_count == 2
    assert result.auto_transfer_result.sub_saved_count == 3
    assert result.fixed_source_result.sub_saved_count_delta == 3
    assert result.fixed_source_result.sub_failed_transfer_count_delta == 1
    assert [
        event
        for event in events
        if event[0]
        in {"load_retry", "auto_save", "apply_auto", "policy", "scan", "apply_fixed"}
    ] == [
        ("load_retry", 101),
        ("auto_save", "new", created_records),
        ("apply_auto", "new", {"saved": 1, "failed": 1}),
        ("auto_save", "retry", [retry_record]),
        ("apply_auto", "retry", {"saved": 2, "failed": 0}),
        ("policy", True),
        (
            "scan",
            {
                "run_id": "run-1",
                "channel": "all",
                "sub": _sub(),
                "tv_missing_snapshot": tv_missing_snapshot,
                "force_auto_download": True,
            },
        ),
        ("apply_fixed", 3, 1),
    ]


@pytest.mark.asyncio
async def test_transfer_phase_auto_cleanup_skips_fixed_source_scan() -> None:
    events: list[Any] = []

    async def auto_save_records_with_link_fallback(
        _db: Any,
        _run_id: str,
        _channel: str,
        _sub: Any,
        _records: list[Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        events.append(("auto_save", kwargs["transfer_source"]))
        return {
            "saved": 1,
            "failed": 0,
            "subscription_completed": True,
            "cleanup_step": "subscription_cleanup_after_transfer",
            "cleanup_message": "订阅已自动清理",
            "cleanup_payload": {"reason": "done"},
        }

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        raise AssertionError("fixed source policy should not run after auto cleanup")

    result = await run_subscription_transfer_phase(
        db="db",
        run_id="run-2",
        channel="all",
        sub=_sub(media_type="movie"),
        force_auto_download=False,
        duplicate_urls=[],
        created_records=[_record(1, "https://115.com/s/new")],
        tv_missing_snapshot=None,
        hdhive_unlock_context={"stats": {}},
        source_order=["pansou"],
        dependencies=_deps(
            events,
            auto_save_records_with_link_fallback=(
                auto_save_records_with_link_fallback
            ),
            should_scan_fixed_sources=should_scan_fixed_sources,
        ),
    )

    assert result.should_auto_download is True
    assert result.sub_saved_count == 1
    assert result.sub_failed_transfer_count == 0
    assert result.fixed_source_result.fixed_source_stats is None
    assert ("delete", 101) in events
    assert ("apply_cleanup", "movie") in events
    assert not any(event[0] == "policy" for event in events)


@pytest.mark.asyncio
async def test_transfer_phase_disabled_auto_skips_retry_and_keeps_fixed_policy() -> None:
    events: list[Any] = []

    async def load_retryable_records(_db: Any, _subscription_id: int) -> list[Any]:
        raise AssertionError("retry records should not load when auto is disabled")

    async def load_force_retry_records(
        _db: Any,
        _subscription_id: int,
        _duplicate_urls: list[str],
    ) -> list[Any]:
        raise AssertionError("force retry records should not load when disabled")

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        raise AssertionError("auto save should not run when auto is disabled")

    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return False

    result = await run_subscription_transfer_phase(
        db="db",
        run_id="run-3",
        channel="all",
        sub=_sub(auto_download=False),
        force_auto_download=False,
        duplicate_urls=["https://115.com/s/dup"],
        created_records=[_record(1, "https://115.com/s/new")],
        tv_missing_snapshot=None,
        hdhive_unlock_context={"stats": {}},
        source_order=["pansou"],
        dependencies=_deps(
            events,
            load_retryable_records=load_retryable_records,
            load_force_retry_records=load_force_retry_records,
            auto_save_records_with_link_fallback=(
                auto_save_records_with_link_fallback
            ),
            should_scan_fixed_sources=should_scan_fixed_sources,
        ),
    )

    assert result.should_auto_download is False
    assert result.sub_saved_count == 0
    assert result.sub_failed_transfer_count == 0
    assert result.auto_transfer_result.retry_records == []
    assert events == [("policy", False)]


def test_transfer_phase_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/transfer_phase_run_flow.py"
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
