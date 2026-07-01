from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_ingest_run_flow import (
    ResourceIngestRunDependencies,
    run_resource_ingest_for_subscription,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {"id": 101, "title": "示例影片"}
    values.update(overrides)
    return SimpleNamespace(**values)


def _empty_store_stats() -> dict[str, Any]:
    return {
        "checked_count": 0,
        "duplicate_count": 0,
        "invalid_count": 0,
        "created_records": [],
        "duplicate_urls": [],
    }


def _deps(events: list[Any], **overrides: Any) -> ResourceIngestRunDependencies:
    async def fetch_resources(
        _channel: str,
        _sub: Any,
        _ctx: dict[str, Any],
        *,
        source_order: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        _ = source_order
        return [], [], {"summary": ""}

    async def store_new_resources(
        _db: Any,
        _subscription_id: int,
        _resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return _empty_store_stats()

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def apply_resource_store_stats(store_stats: dict[str, Any]) -> None:
        events.append(("apply_store", store_stats))

    values: dict[str, Any] = {
        "fetch_resources": fetch_resources,
        "store_new_resources": store_new_resources,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "apply_resource_store_stats": apply_resource_store_stats,
    }
    values.update(overrides)
    return ResourceIngestRunDependencies(**values)


@pytest.mark.asyncio
async def test_resource_ingest_fetches_stores_logs_and_returns_records() -> None:
    events: list[Any] = []
    sub = _sub()
    hdhive_unlock_context = {"stats": {"attempted": 1}}
    resources = [{"name": "资源 A", "share_url": "https://115.com/s/a"}]
    fetch_trace = [
        {
            "step": "fetch_source_selected",
            "status": "success",
            "message": "pansou 命中",
            "payload": {"source": "pansou"},
        },
        {
            "step": "fetch_source_done",
            "status": "info",
            "message": "结束",
            "payload": {"count": 1},
        },
    ]
    source_attempt_info = {
        "summary": "pansou 命中",
        "source_order": ["pansou", "hdhive"],
        "attempts": [{"source": "pansou", "status": "hit"}],
    }
    created_record = SimpleNamespace(id=7, resource_url="https://115.com/s/a")
    store_stats = {
        "checked_count": 2,
        "duplicate_count": 1,
        "invalid_count": 0,
        "created_records": [created_record],
        "duplicate_urls": ["https://115.com/s/dup"],
    }

    async def fetch_resources(
        channel: str,
        current_sub: Any,
        ctx: dict[str, Any],
        *,
        source_order: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        assert channel == "all"
        assert current_sub is sub
        assert ctx is hdhive_unlock_context
        assert source_order == ["pansou", "hdhive"]
        return resources, fetch_trace, source_attempt_info

    async def store_new_resources(
        db: Any,
        subscription_id: int,
        current_resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        assert db == "db"
        assert subscription_id == 101
        assert current_resources == resources
        return store_stats

    result = await run_resource_ingest_for_subscription(
        db="db",
        run_id="run-1",
        channel="all",
        sub=sub,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=["pansou", "hdhive"],
        dependencies=_deps(
            events,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
        ),
    )

    assert result.resources == resources
    assert result.fetch_trace == fetch_trace
    assert result.source_attempt_info == source_attempt_info
    assert result.store_stats == store_stats
    assert result.created_records == [created_record]
    assert result.duplicate_urls == ["https://115.com/s/dup"]

    assert [event[1]["step"] for event in events if event[0] == "step"] == [
        "fetch_source_selected",
        "fetch_source_done",
        "fetch_resources_summary",
        "store_new_resources",
    ]
    assert events[3][0] == "event"
    assert events[3][1]["action"] == "subscription.item.fetch_done"
    assert events[3][1]["status"] == "success"
    assert events[4] == ("apply_store", store_stats)
    assert events[5][1]["payload"] == {
        "checked_count": 2,
        "new_count": 1,
        "duplicate_count": 1,
        "invalid_count": 0,
    }
    assert events[6][0] == "event"
    assert events[6][1]["action"] == "subscription.item.store_done"
    assert events[6][1]["status"] == "success"


@pytest.mark.asyncio
async def test_resource_ingest_keeps_empty_resource_log_shapes() -> None:
    events: list[Any] = []

    async def fetch_resources(
        _channel: str,
        _sub: Any,
        _ctx: dict[str, Any],
        *,
        source_order: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        assert source_order == ["tg"]
        return [], [], {"summary": "没有命中"}

    result = await run_resource_ingest_for_subscription(
        db="db",
        run_id="run-2",
        channel="tg",
        sub=_sub(),
        hdhive_unlock_context={"stats": {}},
        source_order=["tg"],
        dependencies=_deps(events, fetch_resources=fetch_resources),
    )

    assert result.resources == []
    assert result.created_records == []
    assert result.duplicate_urls == []
    assert result.store_stats == _empty_store_stats()

    step_payloads = [event[1] for event in events if event[0] == "step"]
    assert step_payloads == [
        {
            "run_id": "run-2",
            "channel": "tg",
            "subscription_id": 101,
            "subscription_title": "示例影片",
            "step": "fetch_resources_summary",
            "status": "warning",
            "message": "本轮未找到新资源",
            "payload": {
                "resource_count": 0,
                "source_order": [],
                "attempts": [],
                "summary": "没有命中",
            },
        },
        {
            "run_id": "run-2",
            "channel": "tg",
            "subscription_id": 101,
            "subscription_title": "示例影片",
            "step": "store_new_resources",
            "status": "info",
            "message": "未发现新资源",
            "payload": {
                "checked_count": 0,
                "new_count": 0,
                "duplicate_count": 0,
                "invalid_count": 0,
            },
        },
    ]
    event_payloads = [event[1] for event in events if event[0] == "event"]
    assert event_payloads[0]["action"] == "subscription.item.fetch_done"
    assert event_payloads[0]["status"] == "warning"
    assert event_payloads[1]["action"] == "subscription.item.store_done"
    assert event_payloads[1]["status"] == "info"
    assert ("apply_store", _empty_store_stats()) in events


def test_resource_ingest_run_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_ingest_run_flow.py"
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
