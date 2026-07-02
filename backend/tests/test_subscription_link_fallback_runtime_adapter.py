from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions import (
    link_fallback_runtime_adapter as runtime_module,
)
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_subscription_resource_urls_with_db_adapter,
)
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.link_fallback_flow import (
    auto_save_records_with_link_fallback,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_runtime_adapter_builds_adapter_dependencies_and_forwards_arguments() -> None:
    sub = SimpleNamespace(id=101, title="测试订阅")
    records = [SimpleNamespace(id=201)]
    tv_missing_snapshot = {"missing": True}
    hdhive_unlock_context = {"enabled": True}
    source_order = ["pansou"]
    events: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
    adapter_calls: list[dict[str, Any]] = []

    async def create_step_log(*args: Any, **kwargs: Any) -> None:
        events.append(("create_step_log", args, kwargs))

    async def auto_save_resources(*args: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("auto_save_resources", args, kwargs))
        return {"saved": 1, "failed": 0}

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
        events.append(("run_link_fallback", (db,), kwargs))
        return {"saved": 2, "failed": 0}

    async def run_adapter(**kwargs: Any) -> dict[str, Any]:
        adapter_calls.append(kwargs)

        assert kwargs["db"] == "runtime-db"
        assert kwargs["run_id"] == "run-1"
        assert kwargs["channel"] == "all"
        assert kwargs["sub"] is sub
        assert kwargs["records"] is records
        assert kwargs["transfer_source"] == "new"
        assert kwargs["tv_missing_snapshot"] is tv_missing_snapshot
        assert kwargs["hdhive_unlock_context"] is hdhive_unlock_context
        assert kwargs["source_order"] is source_order
        assert kwargs["enable_link_refetch"] is False
        assert kwargs["max_rounds"] == 4

        adapter_dependencies = kwargs["dependencies"]
        assert isinstance(adapter_dependencies, LinkFallbackAdapterDependencies)
        await adapter_dependencies.create_step_log("core-db", step="x")
        assert await adapter_dependencies.auto_save_resources(
            "core-db",
            "run-core",
            "all",
            sub,
            records,
            source="new_fallback",
        ) == {"saved": 1, "failed": 0}
        assert await adapter_dependencies.load_subscription_resource_urls(
            "core-db",
            101,
        ) == {"https://115.com/s/old"}
        assert await adapter_dependencies.fetch_resources(
            "all",
            sub,
            hdhive_unlock_context,
            source_order=source_order,
        ) == ([{"url": "https://115.com/s/new"}], [], {"summary": "ok"})
        assert await adapter_dependencies.store_new_resources(
            "core-db",
            101,
            [{"url": "https://115.com/s/new"}],
        ) == {"created_records": [SimpleNamespace(id=301)]}
        assert await adapter_dependencies.run_link_fallback("flow-db") == {
            "saved": 2,
            "failed": 0,
        }

        return {"saved": 3, "failed": 0}

    result = await runtime_module.auto_save_records_with_link_fallback_with_runtime_adapter(
        db="runtime-db",
        run_id="run-1",
        channel="all",
        sub=sub,
        records=records,
        transfer_source="new",
        dependencies=runtime_module.LinkFallbackRuntimeDependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
            load_subscription_resource_urls=load_subscription_resource_urls,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
            run_adapter=run_adapter,
            run_link_fallback=run_link_fallback,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=False,
        max_rounds=4,
    )

    assert result == {"saved": 3, "failed": 0}
    assert len(adapter_calls) == 1
    assert [event[0] for event in events] == [
        "create_step_log",
        "auto_save_resources",
        "load_subscription_resource_urls",
        "fetch_resources",
        "store_new_resources",
        "run_link_fallback",
    ]


def test_default_runtime_dependencies_bind_existing_helpers_and_runners() -> None:
    dependencies = runtime_module.build_default_link_fallback_runtime_dependencies()

    assert dependencies.create_step_log is runtime_module.create_subscription_step_log
    assert dependencies.auto_save_resources is (
        runtime_module.auto_save_resources_with_default_runtime_dependencies
    )
    assert dependencies.load_subscription_resource_urls is (
        load_subscription_resource_urls_with_db_adapter
    )
    assert dependencies.fetch_resources is (
        runtime_module.fetch_resources_with_default_runtime_dependencies
    )
    assert dependencies.store_new_resources is store_new_resources_with_runtime_adapter
    assert dependencies.run_adapter is auto_save_records_with_link_fallback_with_adapter
    assert dependencies.run_link_fallback is auto_save_records_with_link_fallback


@pytest.mark.asyncio
async def test_default_auto_save_helper_builds_auto_save_runtime_dependencies(
    monkeypatch: Any,
) -> None:
    calls: list[dict[str, Any]] = []
    dependencies_marker = object()

    def build_dependencies(**kwargs: Any) -> object:
        calls.append({"builder": kwargs})
        return dependencies_marker

    async def run_auto_save(**kwargs: Any) -> dict[str, Any]:
        calls.append({"runner": kwargs})
        return {"saved": 1}

    monkeypatch.setattr(
        runtime_module,
        "build_default_auto_save_resources_runtime_dependencies",
        build_dependencies,
    )
    monkeypatch.setattr(
        runtime_module,
        "auto_save_resources_with_runtime_adapter",
        run_auto_save,
    )

    result = await runtime_module.auto_save_resources_with_default_runtime_dependencies(
        "db",
        "run-1",
        "all",
        SimpleNamespace(id=1),
        [],
        source="new",
        tv_missing_snapshot={"missing": True},
    )

    assert result == {"saved": 1}
    assert calls[0]["builder"] == {}
    assert calls[1]["runner"]["dependencies"] is dependencies_marker


@pytest.mark.asyncio
async def test_default_fetch_helper_builds_resource_resolver_runtime_dependencies(
    monkeypatch: Any,
) -> None:
    calls: list[dict[str, Any]] = []
    dependencies_marker = object()

    def build_dependencies() -> object:
        calls.append({"builder": {}})
        return dependencies_marker

    async def run_fetch(
        **kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        calls.append({"runner": kwargs})
        return [], [], {"summary": "ok"}

    monkeypatch.setattr(
        runtime_module,
        "build_default_resource_resolver_runtime_dependencies",
        build_dependencies,
    )
    monkeypatch.setattr(
        runtime_module,
        "fetch_subscription_resources_with_runtime_adapter",
        run_fetch,
    )

    result = await runtime_module.fetch_resources_with_default_runtime_dependencies(
        "all",
        SimpleNamespace(id=1),
        {"unlock": True},
        source_order=["pansou"],
        exclude_urls={"https://115.com/s/old"},
    )

    assert result == ([], [], {"summary": "ok"})
    assert calls[1]["runner"]["dependencies"] is dependencies_marker
    assert calls[1]["runner"]["channel"] == "all"
    assert calls[1]["runner"]["hdhive_unlock_context"] == {"unlock": True}
    assert calls[1]["runner"]["source_order"] == ["pansou"]
    assert calls[1]["runner"]["exclude_urls"] == {"https://115.com/s/old"}


def test_link_fallback_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/link_fallback_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
