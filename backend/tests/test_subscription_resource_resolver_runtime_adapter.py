from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_candidates import (
    filter_resources_excluding_urls,
)
from app.services.subscriptions.resource_resolver import (
    resolve_subscription_resources,
)
from app.services.subscriptions.resource_resolver_adapter import (
    ResourceResolverAdapterDependencies,
    fetch_subscription_resources_with_adapter,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    ResourceResolverRuntimeDependencies,
    build_default_resource_resolver_runtime_dependencies,
    emit_source_attempt_event,
    fetch_subscription_resources_with_runtime_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> ResourceResolverRuntimeDependencies:
    async def fetch_resources(
        _sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return [], []

    async def prepare_hdhive_locked_resources(
        resources: list[dict[str, Any]],
        _context: dict[str, Any],
        _traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return resources

    async def log_background_event(**_kwargs: Any) -> None:
        return None

    async def run_adapter(
        **_kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return [], [], {}

    async def run_resolver(
        **_kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return [], [], {}

    values: dict[str, Any] = {
        "fetch_from_hdhive": fetch_resources,
        "fetch_from_tg": fetch_resources,
        "fetch_from_pansou": fetch_resources,
        "fetch_offline_magnets": fetch_resources,
        "resolve_source_order": lambda _channel: ["pansou"],
        "resolve_subscription_resolutions": lambda _sub: ["1080p"],
        "resolve_subscription_quality_filter": lambda _sub: {
            "preferred_resolutions": ["1080p"]
        },
        "prepare_hdhive_locked_resources": prepare_hdhive_locked_resources,
        "build_hdhive_unlock_context": lambda: {"enabled": True},
        "filter_resources_excluding_urls": lambda resources, _excluded: resources,
        "log_background_event": log_background_event,
        "emit_source_attempt_event": lambda _subscription_id, _data: None,
        "run_adapter": run_adapter,
        "run_resolver": run_resolver,
    }
    values.update(overrides)
    return ResourceResolverRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_lower_adapter_dependencies_and_forwards_arguments() -> None:
    sub = SimpleNamespace(id=41, title="测试订阅")
    hdhive_unlock_context = {"budget": 10}
    source_order = ["hdhive", "pansou"]
    exclude_urls = {"https://115.com/s/old"}
    events: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
    adapter_calls: list[dict[str, Any]] = []

    async def fetch_from_hdhive(
        current_sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        events.append(("fetch_from_hdhive", (current_sub,), {}))
        return [{"source": "hdhive"}], [{"trace": "hdhive"}]

    async def fetch_from_tg(
        current_sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        events.append(("fetch_from_tg", (current_sub,), {}))
        return [{"source": "tg"}], []

    async def fetch_from_pansou(
        current_sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        events.append(("fetch_from_pansou", (current_sub,), {}))
        return [{"source": "pansou"}], []

    async def fetch_offline_magnets(
        current_sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        events.append(("fetch_offline_magnets", (current_sub,), {}))
        return [{"source": "offline"}], []

    async def prepare_hdhive_locked_resources(
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        events.append(("prepare_hdhive_locked_resources", (resources, context, traces), {}))
        return [{"prepared": resources}]

    def filter_excluding_urls(
        resources: list[dict[str, Any]],
        excluded: set[str],
    ) -> list[dict[str, Any]]:
        events.append(("filter_resources_excluding_urls", (resources, excluded), {}))
        return [{"filtered": resources}]

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("log_background_event", (), kwargs))

    def emit_source_attempt_event(
        subscription_id: int,
        data: dict[str, Any],
    ) -> None:
        events.append(("emit_source_attempt_event", (subscription_id, data), {}))

    async def run_resolver(**kwargs: Any) -> tuple[list[Any], list[Any], dict[str, Any]]:
        events.append(("run_resolver", (), kwargs))
        return [{"resource": "core"}], [{"trace": "core"}], {"summary": "core"}

    async def run_adapter(
        **kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        adapter_calls.append(kwargs)

        assert kwargs["channel"] == "all"
        assert kwargs["sub"] is sub
        assert kwargs["hdhive_unlock_context"] is hdhive_unlock_context
        assert kwargs["source_order"] is source_order
        assert kwargs["exclude_urls"] is exclude_urls

        lower_dependencies = kwargs["dependencies"]
        assert isinstance(lower_dependencies, ResourceResolverAdapterDependencies)
        assert await lower_dependencies.fetch_from_hdhive(sub) == (
            [{"source": "hdhive"}],
            [{"trace": "hdhive"}],
        )
        assert await lower_dependencies.fetch_from_tg(sub) == (
            [{"source": "tg"}],
            [],
        )
        assert await lower_dependencies.fetch_from_pansou(sub) == (
            [{"source": "pansou"}],
            [],
        )
        assert await lower_dependencies.fetch_offline_magnets(sub) == (
            [{"source": "offline"}],
            [],
        )
        assert lower_dependencies.resolve_source_order("all") == source_order
        assert lower_dependencies.resolve_subscription_resolutions(sub) == ["1080p"]
        assert lower_dependencies.resolve_subscription_quality_filter(sub) == {
            "preferred_resolutions": ["1080p"]
        }
        assert await lower_dependencies.prepare_hdhive_locked_resources(
            [{"name": "locked"}],
            hdhive_unlock_context,
            [{"step": "trace"}],
        ) == [{"prepared": [{"name": "locked"}]}]
        assert lower_dependencies.build_hdhive_unlock_context() == {
            "enabled": True
        }
        assert lower_dependencies.filter_resources_excluding_urls(
            [{"url": "https://115.com/s/old"}],
            exclude_urls,
        ) == [{"filtered": [{"url": "https://115.com/s/old"}]}]
        await lower_dependencies.log_background_event(action="fetch")
        lower_dependencies.emit_source_attempt_event(41, {"source": "hdhive"})
        assert await lower_dependencies.run_resolver(channel="all", sub=sub) == (
            [{"resource": "core"}],
            [{"trace": "core"}],
            {"summary": "core"},
        )

        return [{"resource": "adapter"}], [{"trace": "adapter"}], {"summary": "ok"}

    result = await fetch_subscription_resources_with_runtime_adapter(
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
            build_hdhive_unlock_context=lambda: {"enabled": True},
            filter_resources_excluding_urls=filter_excluding_urls,
            log_background_event=log_background_event,
            emit_source_attempt_event=emit_source_attempt_event,
            run_adapter=run_adapter,
            run_resolver=run_resolver,
        ),
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )

    assert result == (
        [{"resource": "adapter"}],
        [{"trace": "adapter"}],
        {"summary": "ok"},
    )
    assert len(adapter_calls) == 1
    assert events == [
        ("fetch_from_hdhive", (sub,), {}),
        ("fetch_from_tg", (sub,), {}),
        ("fetch_from_pansou", (sub,), {}),
        ("fetch_offline_magnets", (sub,), {}),
        (
            "prepare_hdhive_locked_resources",
            ([{"name": "locked"}], hdhive_unlock_context, [{"step": "trace"}]),
            {},
        ),
        (
            "filter_resources_excluding_urls",
            ([{"url": "https://115.com/s/old"}], exclude_urls),
            {},
        ),
        ("log_background_event", (), {"action": "fetch"}),
        ("emit_source_attempt_event", (41, {"source": "hdhive"}), {}),
        ("run_resolver", (), {"channel": "all", "sub": sub}),
    ]


def test_default_runtime_dependencies_use_existing_helpers_and_runners() -> None:
    async def fetch_resources(
        _sub: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return [], []

    async def prepare_hdhive_locked_resources(
        resources: list[dict[str, Any]],
        _context: dict[str, Any],
        _traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return resources

    def resolve_source_order(_channel: str) -> list[str]:
        return ["pansou"]

    def resolve_subscription_resolutions(_sub: Any) -> list[str]:
        return ["1080p"]

    def resolve_subscription_quality_filter(_sub: Any) -> dict[str, Any]:
        return {}

    def build_hdhive_unlock_context() -> dict[str, Any]:
        return {"enabled": False}

    dependencies = build_default_resource_resolver_runtime_dependencies(
        fetch_from_hdhive=fetch_resources,
        fetch_from_tg=fetch_resources,
        fetch_from_pansou=fetch_resources,
        fetch_offline_magnets=fetch_resources,
        resolve_source_order=resolve_source_order,
        resolve_subscription_resolutions=resolve_subscription_resolutions,
        resolve_subscription_quality_filter=resolve_subscription_quality_filter,
        prepare_hdhive_locked_resources=prepare_hdhive_locked_resources,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
    )

    assert dependencies.fetch_from_hdhive is fetch_resources
    assert dependencies.fetch_from_tg is fetch_resources
    assert dependencies.fetch_from_pansou is fetch_resources
    assert dependencies.fetch_offline_magnets is fetch_resources
    assert dependencies.resolve_source_order is resolve_source_order
    assert dependencies.resolve_subscription_resolutions is (
        resolve_subscription_resolutions
    )
    assert dependencies.resolve_subscription_quality_filter is (
        resolve_subscription_quality_filter
    )
    assert dependencies.prepare_hdhive_locked_resources is (
        prepare_hdhive_locked_resources
    )
    assert dependencies.build_hdhive_unlock_context is build_hdhive_unlock_context
    assert dependencies.filter_resources_excluding_urls is filter_resources_excluding_urls
    assert dependencies.run_adapter is fetch_subscription_resources_with_adapter
    assert dependencies.run_resolver is resolve_subscription_resources


def test_emit_source_attempt_event_respects_kafka_enabled(monkeypatch: Any) -> None:
    import app.analytics as analytics

    calls: list[dict[str, Any]] = []

    class FakeKafkaProducer:
        _enabled = True

        def send(self, **kwargs: Any) -> None:
            calls.append(kwargs)

    fake_kafka_producer = FakeKafkaProducer()
    monkeypatch.setattr(analytics, "kafka_producer", fake_kafka_producer)

    emit_source_attempt_event(41, {"source": "hdhive"})
    fake_kafka_producer._enabled = False
    emit_source_attempt_event(42, {"source": "pansou"})

    assert calls == [
        {
            "event_type": "source_attempt",
            "data": {"source": "hdhive"},
            "key": "41",
        }
    ]


def test_runtime_adapter_module_does_not_import_subscription_service_or_api() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_resolver_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
