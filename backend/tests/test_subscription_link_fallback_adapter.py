from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.link_fallback_flow import LinkFallbackDependencies


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_link_fallback_adapter_builds_core_dependencies_and_forwards_arguments() -> None:
    sub = SimpleNamespace(id=101, title="测试订阅")
    records = [SimpleNamespace(id=201, resource_url="https://115.com/s/a")]
    tv_missing_snapshot = {"missing": True}
    hdhive_unlock_context = {"unlock": True}
    source_order = ["pansou"]
    events: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
    runner_calls: list[dict[str, Any]] = []

    async def create_step_log(*args: Any, **kwargs: Any) -> None:
        events.append(("create_step_log", args, kwargs))

    async def auto_save_resources(*args: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("auto_save_resources", args, kwargs))
        return {"saved": 2, "failed": 0}

    async def load_subscription_resource_urls(
        db: Any,
        subscription_id: int,
    ) -> set[str]:
        events.append(("load_subscription_resource_urls", (db, subscription_id), {}))
        return {"https://115.com/s/old"}

    async def fetch_resources(
        *args: Any,
        **kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        events.append(("fetch_resources", args, kwargs))
        return ([{"url": "https://115.com/s/new"}], [], {"summary": "ok"})

    async def store_new_resources(
        db: Any,
        subscription_id: int,
        resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        events.append(("store_new_resources", (db, subscription_id, resources), {}))
        return {"created_records": [SimpleNamespace(id=301)]}

    async def run_link_fallback(db: Any, **kwargs: Any) -> dict[str, Any]:
        runner_calls.append({"db": db, **kwargs})

        assert db == "runtime-db"
        assert kwargs["run_id"] == "run-1"
        assert kwargs["channel"] == "all"
        assert kwargs["sub"] is sub
        assert kwargs["records"] is records
        assert kwargs["transfer_source"] == "new"
        assert kwargs["tv_missing_snapshot"] is tv_missing_snapshot
        assert kwargs["hdhive_unlock_context"] is hdhive_unlock_context
        assert kwargs["source_order"] is source_order
        assert kwargs["enable_link_refetch"] is False
        assert kwargs["max_rounds"] == 3

        core_dependencies = kwargs["dependencies"]
        assert isinstance(core_dependencies, LinkFallbackDependencies)

        await core_dependencies.create_step_log(
            "core-db",
            step="fallback_step",
            payload={"round": 1},
        )
        assert await core_dependencies.auto_save_resources(
            "core-db",
            "run-core",
            "all",
            sub,
            records,
            source="new_fallback",
            tv_missing_snapshot=tv_missing_snapshot,
        ) == {"saved": 2, "failed": 0}
        assert await core_dependencies.load_subscription_resource_urls(
            "core-db",
            101,
        ) == {"https://115.com/s/old"}
        assert await core_dependencies.fetch_resources(
            "all",
            sub,
            hdhive_unlock_context,
            source_order=source_order,
            exclude_urls={"https://115.com/s/old"},
        ) == ([{"url": "https://115.com/s/new"}], [], {"summary": "ok"})
        assert await core_dependencies.store_new_resources(
            "core-db",
            101,
            [{"url": "https://115.com/s/new"}],
        ) == {"created_records": [SimpleNamespace(id=301)]}

        return {"saved": 1, "failed": 0}

    result = await auto_save_records_with_link_fallback_with_adapter(
        db="runtime-db",
        run_id="run-1",
        channel="all",
        sub=sub,
        records=records,
        transfer_source="new",
        dependencies=LinkFallbackAdapterDependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
            load_subscription_resource_urls=load_subscription_resource_urls,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
            run_link_fallback=run_link_fallback,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=False,
        max_rounds=3,
    )

    assert result == {"saved": 1, "failed": 0}
    assert len(runner_calls) == 1
    assert events == [
        (
            "create_step_log",
            ("core-db",),
            {"step": "fallback_step", "payload": {"round": 1}},
        ),
        (
            "auto_save_resources",
            ("core-db", "run-core", "all", sub, records),
            {"source": "new_fallback", "tv_missing_snapshot": tv_missing_snapshot},
        ),
        ("load_subscription_resource_urls", ("core-db", 101), {}),
        (
            "fetch_resources",
            ("all", sub, hdhive_unlock_context),
            {
                "source_order": source_order,
                "exclude_urls": {"https://115.com/s/old"},
            },
        ),
        (
            "store_new_resources",
            ("core-db", 101, [{"url": "https://115.com/s/new"}]),
            {},
        ),
    ]


def test_link_fallback_adapter_module_does_not_import_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/link_fallback_adapter.py"
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
