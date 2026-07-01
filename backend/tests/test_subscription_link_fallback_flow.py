from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.link_fallback_flow import (
    LinkFallbackDependencies,
    auto_save_records_with_link_fallback,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(media_type: MediaType = MediaType.MOVIE) -> SimpleNamespace:
    return SimpleNamespace(
        id=101,
        title="Fallback Movie",
        media_type=media_type,
    )


def _record(record_id: int, url: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=record_id,
        resource_name=f"Resource {record_id}",
        resource_url=url,
    )


def _stats(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "saved": 0,
        "failed": 0,
        "errors": [],
        "subscription_completed": False,
        "cleanup_step": "",
        "cleanup_message": "",
        "cleanup_payload": {},
        "remaining_missing_count": None,
        "link_fallback_rounds": 0,
    }
    values.update(overrides)
    return values


def _dependencies(**overrides: Any) -> LinkFallbackDependencies:
    values: dict[str, Any] = {
        "create_step_log": _unexpected_step_log,
        "auto_save_resources": _unexpected_auto_save,
        "load_subscription_resource_urls": _unexpected_load_urls,
        "fetch_resources": _unexpected_fetch,
        "store_new_resources": _unexpected_store,
    }
    values.update(overrides)
    return LinkFallbackDependencies(**values)


@pytest.mark.asyncio
async def test_link_fallback_flow_returns_default_stats_for_empty_records() -> None:
    result = await auto_save_records_with_link_fallback(
        object(),
        run_id="run-empty",
        channel="all",
        sub=_sub(),
        records=[],
        transfer_source="pansou",
        dependencies=_dependencies(),
    )

    assert result == _stats()


@pytest.mark.asyncio
async def test_link_fallback_flow_stops_after_successful_first_round() -> None:
    logs: list[dict[str, Any]] = []
    auto_save_calls: list[dict[str, Any]] = []

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    async def auto_save_resources(
        _db: Any,
        run_id: str,
        channel: str,
        sub: Any,
        records: list[Any],
        *,
        source: str,
        tv_missing_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        auto_save_calls.append(
            {
                "run_id": run_id,
                "channel": channel,
                "subscription_id": sub.id,
                "record_ids": [record.id for record in records],
                "source": source,
                "tv_missing_snapshot": tv_missing_snapshot,
            }
        )
        return _stats(saved=1)

    result = await auto_save_records_with_link_fallback(
        object(),
        run_id="run-1",
        channel="priority",
        sub=_sub(),
        records=[_record(1, "https://115.com/s/ok")],
        transfer_source="pansou",
        tv_missing_snapshot={"status": "ok"},
        dependencies=_dependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
        ),
    )

    assert result == _stats(saved=1)
    assert auto_save_calls == [
        {
            "run_id": "run-1",
            "channel": "priority",
            "subscription_id": 101,
            "record_ids": [1],
            "source": "pansou",
            "tv_missing_snapshot": {"status": "ok"},
        }
    ]
    assert logs == [
        {
            "run_id": "run-1",
            "channel": "priority",
            "subscription_id": 101,
            "subscription_title": "Fallback Movie",
            "step": "auto_transfer_batch_start",
            "status": "info",
            "message": "开始转存 1 个资源",
            "payload": {
                "transfer_source": "pansou",
                "round": 0,
                "count": 1,
            },
        }
    ]


@pytest.mark.asyncio
async def test_link_fallback_flow_fetches_and_saves_replacement_records() -> None:
    logs: list[dict[str, Any]] = []
    auto_save_calls: list[dict[str, Any]] = []
    store_calls: list[list[dict[str, Any]]] = []
    replacement = _record(2, "https://115.com/s/new")
    responses = [
        _stats(saved=0, failed=1),
        _stats(
            saved=1,
            subscription_completed=True,
            cleanup_step="auto_transfer_completed",
            cleanup_message="done",
            cleanup_payload={"deleted": True},
        ),
    ]

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    async def auto_save_resources(
        _db: Any,
        _run_id: str,
        _channel: str,
        _sub: Any,
        records: list[Any],
        *,
        source: str,
        tv_missing_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        auto_save_calls.append(
            {
                "source": source,
                "record_ids": [record.id for record in records],
                "tv_missing_snapshot": tv_missing_snapshot,
            }
        )
        return responses.pop(0)

    async def load_urls(_db: Any, subscription_id: int) -> set[str]:
        assert subscription_id == 101
        return {"https://115.com/s/old"}

    async def fetch_resources(
        channel: str,
        sub: Any,
        hdhive_unlock_context: dict[str, Any] | None,
        *,
        source_order: list[str] | None = None,
        exclude_urls: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        assert channel == "priority"
        assert sub.id == 101
        assert hdhive_unlock_context == {"unlock": True}
        assert source_order == ["pansou", "hdhive"]
        assert exclude_urls == {"https://115.com/s/old"}
        return (
            [
                {"share_link": "https://115.com/s/old", "name": "old"},
                {"share_link": "https://115.com/s/new", "name": "new"},
            ],
            [
                {
                    "step": "resolver_trace",
                    "status": "info",
                    "message": "resolver detail",
                    "payload": {"source": "pansou"},
                }
            ],
            {"summary": "PanSou 命中 1 条"},
        )

    async def store_new_resources(
        _db: Any,
        subscription_id: int,
        resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        assert subscription_id == 101
        store_calls.append(resources)
        return {"created_records": [replacement]}

    result = await auto_save_records_with_link_fallback(
        object(),
        run_id="run-2",
        channel="priority",
        sub=_sub(),
        records=[_record(1, "https://115.com/s/old")],
        transfer_source="pansou",
        tv_missing_snapshot={"status": "ok"},
        hdhive_unlock_context={"unlock": True},
        source_order=["pansou", "hdhive"],
        dependencies=_dependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
            load_subscription_resource_urls=load_urls,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
        ),
    )

    assert result == _stats(
        saved=1,
        failed=1,
        subscription_completed=True,
        cleanup_step="auto_transfer_completed",
        cleanup_message="done",
        cleanup_payload={"deleted": True},
        link_fallback_rounds=1,
    )
    assert auto_save_calls == [
        {
            "source": "pansou",
            "record_ids": [1],
            "tv_missing_snapshot": {"status": "ok"},
        },
        {
            "source": "pansou_fallback",
            "record_ids": [2],
            "tv_missing_snapshot": {"status": "ok"},
        },
    ]
    assert store_calls == [[{"share_link": "https://115.com/s/new", "name": "new"}]]
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_batch_start",
        "auto_transfer_link_fallback_fetch",
        "resolver_trace",
        "auto_transfer_link_fallback_stored",
        "auto_transfer_batch_start",
    ]
    assert logs[3]["payload"] == {
        "round": 1,
        "new_count": 1,
        "fetched_count": 1,
        "summary": "PanSou 命中 1 条",
    }


@pytest.mark.asyncio
async def test_link_fallback_flow_logs_limit_without_fetching() -> None:
    logs: list[dict[str, Any]] = []

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    async def auto_save_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return _stats(failed=1)

    result = await auto_save_records_with_link_fallback(
        object(),
        run_id="run-limit",
        channel="all",
        sub=_sub(),
        records=[_record(1, "https://115.com/s/dead")],
        transfer_source="pansou",
        dependencies=_dependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
        ),
        max_rounds=1,
    )

    assert result == _stats(failed=1)
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_batch_start",
        "auto_transfer_link_fallback_limit",
    ]
    assert logs[1]["message"] == "已达链接回退上限（1 轮），停止继续搜索"


@pytest.mark.asyncio
async def test_link_fallback_flow_honors_disabled_refetch() -> None:
    logs: list[dict[str, Any]] = []

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        logs.append(kwargs)

    async def auto_save_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return _stats(failed=1)

    result = await auto_save_records_with_link_fallback(
        object(),
        run_id="run-disabled",
        channel="all",
        sub=_sub(),
        records=[_record(1, "https://115.com/s/dead")],
        transfer_source="pansou",
        dependencies=_dependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
        ),
        enable_link_refetch=False,
    )

    assert result == _stats(failed=1)
    assert [entry["step"] for entry in logs] == ["auto_transfer_batch_start"]


def test_link_fallback_flow_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/link_fallback_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "Pan115Service" not in source
    assert "AsyncSession" not in source
    assert "app.api" not in source


async def _unexpected_step_log(*_args: Any, **_kwargs: Any) -> None:
    raise AssertionError("step log should not be called")


async def _unexpected_auto_save(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise AssertionError("auto save should not be called")


async def _unexpected_load_urls(*_args: Any, **_kwargs: Any) -> set[str]:
    raise AssertionError("resource URLs should not be loaded")


async def _unexpected_fetch(
    *_args: Any, **_kwargs: Any
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    raise AssertionError("resources should not be fetched")


async def _unexpected_store(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise AssertionError("resources should not be stored")
