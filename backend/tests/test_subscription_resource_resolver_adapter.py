from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_resolver_adapter import (
    ResourceResolverAdapterDependencies,
    fetch_subscription_resources_with_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub() -> SimpleNamespace:
    return SimpleNamespace(id=41, title="测试订阅")


def _dependencies(**overrides: Any) -> ResourceResolverAdapterDependencies:
    async def run_resolver(**_kwargs: Any) -> tuple[list[Any], list[Any], dict[str, Any]]:
        return [], [], {}

    values: dict[str, Any] = {
        "fetch_from_hdhive": _unexpected_async,
        "fetch_from_tg": _unexpected_async,
        "fetch_from_pansou": _unexpected_async,
        "fetch_offline_magnets": _unexpected_async,
        "resolve_source_order": _unexpected_sync,
        "resolve_subscription_resolutions": _unexpected_sync,
        "resolve_subscription_quality_filter": _unexpected_sync,
        "prepare_hdhive_locked_resources": _unexpected_async,
        "build_hdhive_unlock_context": _unexpected_sync,
        "filter_resources_excluding_urls": _unexpected_sync,
        "log_background_event": _unexpected_async,
        "emit_source_attempt_event": _unexpected_sync,
        "run_resolver": run_resolver,
    }
    values.update(overrides)
    return ResourceResolverAdapterDependencies(**values)


@pytest.mark.asyncio
async def test_resource_resolver_adapter_builds_resolver_dependencies_and_observability() -> None:
    sub = _sub()
    logs: list[dict[str, Any]] = []
    events: list[tuple[int, dict[str, Any]]] = []
    run_calls: list[dict[str, Any]] = []
    fetch_calls: list[tuple[str, Any]] = []
    hdhive_context = {"budget": 10}
    source_order = ["hdhive", "pansou"]
    exclude_urls = {"https://115.com/s/old"}

    async def fetch_from_hdhive(current_sub: Any) -> tuple[list[Any], list[Any]]:
        fetch_calls.append(("hdhive", current_sub))
        return [{"source": "hdhive"}], [{"trace": "hdhive"}]

    async def fetch_from_tg(current_sub: Any) -> tuple[list[Any], list[Any]]:
        fetch_calls.append(("tg", current_sub))
        return [], []

    async def fetch_from_pansou(current_sub: Any) -> tuple[list[Any], list[Any]]:
        fetch_calls.append(("pansou", current_sub))
        return [], []

    async def fetch_offline_magnets(current_sub: Any) -> tuple[list[Any], list[Any]]:
        fetch_calls.append(("offline", current_sub))
        return [], []

    async def prepare_hdhive_locked_resources(
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return [{"resources": resources, "context": context, "traces": traces}]

    def filter_resources_excluding_urls(
        resources: list[dict[str, Any]], excluded: set[str]
    ) -> list[dict[str, Any]]:
        return [{"filtered": resources, "excluded": excluded}]

    async def log_background_event(**kwargs: Any) -> None:
        logs.append(kwargs)

    def emit_source_attempt_event(
        subscription_id: int, data: dict[str, Any]
    ) -> None:
        events.append((subscription_id, data))

    async def run_resolver(**kwargs: Any) -> tuple[list[Any], list[Any], dict[str, Any]]:
        run_calls.append(kwargs)
        resolver_deps = kwargs["dependencies"]

        assert await resolver_deps.fetch_from_hdhive(sub) == (
            [{"source": "hdhive"}],
            [{"trace": "hdhive"}],
        )
        assert await resolver_deps.fetch_from_tg(sub) == ([], [])
        assert await resolver_deps.fetch_from_pansou(sub) == ([], [])
        assert await resolver_deps.fetch_offline_magnets(sub) == ([], [])
        assert resolver_deps.resolve_source_order("all") == source_order
        assert resolver_deps.resolve_subscription_resolutions(sub) == ["1080p"]
        assert resolver_deps.resolve_subscription_quality_filter(sub) == {
            "preferred_resolutions": ["1080p"]
        }
        assert await resolver_deps.prepare_hdhive_locked_resources(
            [{"name": "locked"}],
            {"budget": 1},
            [{"step": "trace"}],
        ) == [
            {
                "resources": [{"name": "locked"}],
                "context": {"budget": 1},
                "traces": [{"step": "trace"}],
            }
        ]
        assert resolver_deps.build_hdhive_unlock_context() == hdhive_context
        assert resolver_deps.filter_resources_excluding_urls(
            [{"url": "https://115.com/s/old"}],
            exclude_urls,
        ) == [
            {
                "filtered": [{"url": "https://115.com/s/old"}],
                "excluded": exclude_urls,
            }
        ]

        await resolver_deps.log_source_fetch(sub, "hdhive", 2)
        await resolver_deps.log_source_fetch(sub, "tg", 0)
        resolver_deps.emit_source_attempt(
            sub,
            {"source": "hdhive", "status": "success", "count": 2},
        )
        resolver_deps.emit_source_attempt(sub, {"source": "pansou"})
        return [{"result": "resource"}], [{"trace": "done"}], {"summary": "ok"}

    result = await fetch_subscription_resources_with_adapter(
        channel="all",
        sub=sub,
        dependencies=_dependencies(
            fetch_from_hdhive=fetch_from_hdhive,
            fetch_from_tg=fetch_from_tg,
            fetch_from_pansou=fetch_from_pansou,
            fetch_offline_magnets=fetch_offline_magnets,
            resolve_source_order=lambda _channel: source_order,
            resolve_subscription_resolutions=lambda _sub: ["1080p"],
            resolve_subscription_quality_filter=lambda _sub: {
                "preferred_resolutions": ["1080p"]
            },
            prepare_hdhive_locked_resources=prepare_hdhive_locked_resources,
            build_hdhive_unlock_context=lambda: hdhive_context,
            filter_resources_excluding_urls=filter_resources_excluding_urls,
            log_background_event=log_background_event,
            emit_source_attempt_event=emit_source_attempt_event,
            run_resolver=run_resolver,
        ),
        hdhive_unlock_context=hdhive_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )

    assert result == ([{"result": "resource"}], [{"trace": "done"}], {"summary": "ok"})
    assert fetch_calls == [
        ("hdhive", sub),
        ("tg", sub),
        ("pansou", sub),
        ("offline", sub),
    ]
    assert len(run_calls) == 1
    assert run_calls[0]["channel"] == "all"
    assert run_calls[0]["sub"] == sub
    assert run_calls[0]["hdhive_unlock_context"] == hdhive_context
    assert run_calls[0]["source_order"] == source_order
    assert run_calls[0]["exclude_urls"] == exclude_urls
    assert logs == [
        {
            "source_type": "background_task",
            "module": "subscriptions",
            "action": "subscription.item.fetch_source",
            "status": "success",
            "message": "[测试订阅] 来源 hdhive 返回 2 条资源",
            "extra": {
                "subscription_id": 41,
                "title": "测试订阅",
                "source": "hdhive",
                "count": 2,
            },
        },
        {
            "source_type": "background_task",
            "module": "subscriptions",
            "action": "subscription.item.fetch_source",
            "status": "info",
            "message": "[测试订阅] 来源 tg 返回 0 条资源",
            "extra": {
                "subscription_id": 41,
                "title": "测试订阅",
                "source": "tg",
                "count": 0,
            },
        },
    ]
    assert events == [
        (
            41,
            {
                "subscription_id": 41,
                "title": "测试订阅",
                "source": "hdhive",
                "status": "success",
                "resource_count": 2,
            },
        ),
        (
            41,
            {
                "subscription_id": 41,
                "title": "测试订阅",
                "source": "pansou",
                "status": "empty",
                "resource_count": 0,
            },
        ),
    ]


def test_resource_resolver_adapter_module_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_resolver_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "kafka_producer" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source


async def _unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected async dependency call")


def _unexpected_sync(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected sync dependency call")
