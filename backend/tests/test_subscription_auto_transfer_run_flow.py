from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.auto_transfer_run_flow import (
    AutoTransferRunDependencies,
    run_auto_transfer_for_subscription,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 101,
        "title": "示例影片",
        "auto_download": True,
        "media_type": MediaType.MOVIE,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _deps(events: list[Any], **overrides: Any) -> AutoTransferRunDependencies:
    async def select_retry_records(**_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"saved": 0, "failed": 0}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

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

    async def apply_cleanup_stats(media_type: Any) -> None:
        events.append(("apply_cleanup", media_type))

    values: dict[str, Any] = {
        "select_retry_records": select_retry_records,
        "auto_save_records_with_link_fallback": auto_save_records_with_link_fallback,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "delete_subscription_with_records": delete_subscription_with_records,
        "apply_auto_transfer_stats": apply_auto_transfer_stats,
        "apply_cleanup_stats": apply_cleanup_stats,
    }
    values.update(overrides)
    return AutoTransferRunDependencies(**values)


@pytest.mark.asyncio
async def test_run_auto_transfer_writes_skip_step_when_disabled() -> None:
    events: list[Any] = []

    async def select_retry_records(**_kwargs: Any) -> list[Any]:
        raise AssertionError("retry records should not be selected")

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        raise AssertionError("auto transfer should not run")

    result = await run_auto_transfer_for_subscription(
        db="db",
        run_id="run-1",
        channel="电影",
        sub=_sub(auto_download=False),
        should_auto_download=False,
        force_auto_download=False,
        duplicate_urls=["https://115.com/s/duplicate"],
        created_records=[SimpleNamespace(id=1)],
        tv_missing_snapshot=None,
        hdhive_unlock_context={"stats": {}},
        source_order=["pansou"],
        dependencies=_deps(
            events,
            select_retry_records=select_retry_records,
            auto_save_records_with_link_fallback=auto_save_records_with_link_fallback,
        ),
    )

    assert result.sub_saved_count == 0
    assert result.sub_failed_transfer_count == 0
    assert result.cleanup_after_auto is None
    assert result.retry_records == []
    assert events == [
        (
            "step",
            {
                "run_id": "run-1",
                "channel": "电影",
                "subscription_id": 101,
                "subscription_title": "示例影片",
                "step": "auto_transfer_skip",
                "status": "info",
                "message": "未开启自动转存，已记录资源供手动处理",
            },
        )
    ]


@pytest.mark.asyncio
async def test_run_auto_transfer_cleans_up_after_new_transfer_completion() -> None:
    events: list[Any] = []
    calls: list[tuple[str, list[Any], dict[str, Any]]] = []
    cleanup_stats = {
        "saved": 2,
        "failed": 0,
        "subscription_completed": True,
        "cleanup_step": "subscription_cleanup_after_transfer",
        "cleanup_message": "订阅已自动清理",
        "cleanup_payload": {"reason": "all_done"},
    }

    async def select_retry_records(**_kwargs: Any) -> list[Any]:
        return [SimpleNamespace(id=9, resource_url="https://115.com/s/retry")]

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        calls.append((kwargs["transfer_source"], list(_args[4]), kwargs))
        if kwargs["transfer_source"] == "retry":
            raise AssertionError("retry should not run after cleanup is selected")
        return cleanup_stats

    result = await run_auto_transfer_for_subscription(
        db="db",
        run_id="run-2",
        channel="电影",
        sub=_sub(),
        should_auto_download=True,
        force_auto_download=False,
        duplicate_urls=[],
        created_records=[SimpleNamespace(id=1, resource_url="https://115.com/s/new")],
        tv_missing_snapshot={"missing": []},
        hdhive_unlock_context={"stats": {}},
        source_order=["pansou", "hdhive"],
        dependencies=_deps(
            events,
            select_retry_records=select_retry_records,
            auto_save_records_with_link_fallback=auto_save_records_with_link_fallback,
        ),
    )

    assert result.sub_saved_count == 2
    assert result.sub_failed_transfer_count == 0
    assert result.cleanup_after_auto == cleanup_stats
    assert [call[0] for call in calls] == ["new"]
    assert "enable_link_refetch" not in calls[0][2]
    assert ("apply_auto", "new", cleanup_stats) in events
    assert ("delete", 101) in events
    assert ("apply_cleanup", MediaType.MOVIE) in events

    step_names = [event[1]["step"] for event in events if event[0] == "step"]
    assert step_names == [
        "auto_transfer_new_start",
        "auto_transfer_new_done",
        "auto_transfer_summary",
        "subscription_cleanup_after_transfer",
    ]
    event_actions = [event[1]["action"] for event in events if event[0] == "event"]
    assert event_actions == [
        "subscription.item.transfer_new_start",
        "subscription.item.transfer_new_done",
        "subscription.item.cleanup_after_transfer",
    ]


@pytest.mark.asyncio
async def test_run_auto_transfer_executes_retry_after_new_transfer_without_cleanup() -> None:
    events: list[Any] = []
    calls: list[tuple[str, list[Any], dict[str, Any]]] = []
    new_stats = {"saved": 1, "failed": 1}
    retry_stats = {"saved": 2, "failed": 0}
    retry_record = SimpleNamespace(id=2, resource_url="https://115.com/s/retry")

    async def select_retry_records(**kwargs: Any) -> list[Any]:
        assert kwargs["db"] == "db"
        assert kwargs["subscription_id"] == 101
        assert kwargs["auto_download"] is True
        assert kwargs["force_auto_download"] is True
        assert kwargs["duplicate_urls"] == ["https://115.com/s/duplicate"]
        assert len(kwargs["created_records"]) == 1
        return [retry_record]

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        calls.append((kwargs["transfer_source"], list(_args[4]), kwargs))
        if kwargs["transfer_source"] == "new":
            return new_stats
        return retry_stats

    result = await run_auto_transfer_for_subscription(
        db="db",
        run_id="run-3",
        channel="电影",
        sub=_sub(),
        should_auto_download=True,
        force_auto_download=True,
        duplicate_urls=["https://115.com/s/duplicate"],
        created_records=[SimpleNamespace(id=1, resource_url="https://115.com/s/new")],
        tv_missing_snapshot={"missing": [1]},
        hdhive_unlock_context={"stats": {"unlock_attempts": 1}},
        source_order=["hdhive", "pansou"],
        dependencies=_deps(
            events,
            select_retry_records=select_retry_records,
            auto_save_records_with_link_fallback=auto_save_records_with_link_fallback,
        ),
    )

    assert result.sub_saved_count == 3
    assert result.sub_failed_transfer_count == 1
    assert result.cleanup_after_auto is None
    assert result.retry_records == [retry_record]
    assert [call[0] for call in calls] == ["new", "retry"]
    assert "enable_link_refetch" not in calls[0][2]
    assert calls[1][2]["enable_link_refetch"] is False
    assert calls[0][1][0].resource_url == "https://115.com/s/new"
    assert calls[1][1] == [retry_record]
    assert ("apply_auto", "new", new_stats) in events
    assert ("apply_auto", "retry", retry_stats) in events

    summary_steps = [
        event[1]
        for event in events
        if event[0] == "step" and event[1]["step"] == "auto_transfer_summary"
    ]
    assert summary_steps == [
        {
            "run_id": "run-3",
            "channel": "电影",
            "subscription_id": 101,
            "subscription_title": "示例影片",
            "step": "auto_transfer_summary",
            "status": "partial",
            "message": "本轮转存汇总：成功 3 条，失败 1 条（新资源 1 个，重试 1 个）",
        }
    ]


def test_auto_transfer_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_run_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.api" not in source
