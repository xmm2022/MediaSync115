import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

from app.models.models import MediaType
from app.services.subscriptions.resource_resolver import (
    ResourceResolverDependencies,
    resolve_subscription_resources,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot
from app.services.subscriptions import (
    resource_resolver_runtime_adapter as resolver_runtime_module,
)


ROOT = Path(__file__).resolve().parents[2]


def _test_subscription() -> SimpleNamespace:
    return SimpleNamespace(id=101, title="测试订阅")


def _resource_url(item: dict[str, Any]) -> str:
    return str(item.get("share_link") or item.get("pan115_share_link") or "").strip()


def _resolver_dependencies(
    source_results: dict[str, tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    *,
    resolved_order: list[str] | None = None,
    offline_result: tuple[list[dict[str, Any]], list[dict[str, Any]]] | None = None,
    source_calls: list[str] | None = None,
    log_calls: list[tuple[str, int]] | None = None,
    event_calls: list[tuple[str, str, int]] | None = None,
) -> ResourceResolverDependencies:
    async def fetch_from_source(source: str, sub: Any):
        _ = sub
        if source_calls is not None:
            source_calls.append(source)
        return source_results.get(source, ([], []))

    async def fetch_from_hdhive(sub: Any):
        return await fetch_from_source("hdhive", sub)

    async def fetch_from_tg(sub: Any):
        return await fetch_from_source("tg", sub)

    async def fetch_from_pansou(sub: Any):
        return await fetch_from_source("pansou", sub)

    async def fetch_offline_magnets(sub: Any):
        _ = sub
        return offline_result or ([], [])

    async def prepare_hdhive_locked_resources(
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        _ = context
        traces.append({"step": "hdhive_prepare_called", "status": "info"})
        return resources

    def filter_excluding_urls(
        resources: list[dict[str, Any]], exclude_urls: set[str]
    ) -> list[dict[str, Any]]:
        return [item for item in resources if _resource_url(item) not in exclude_urls]

    async def log_source_fetch(sub: Any, source: str, count: int) -> None:
        _ = sub
        if log_calls is not None:
            log_calls.append((source, count))

    def emit_source_attempt(sub: Any, attempt: dict[str, Any]) -> None:
        _ = sub
        if event_calls is not None:
            event_calls.append(
                (
                    str(attempt.get("source") or ""),
                    str(attempt.get("status") or ""),
                    int(attempt.get("count") or 0),
                )
            )

    return ResourceResolverDependencies(
        fetch_from_hdhive=fetch_from_hdhive,
        fetch_from_tg=fetch_from_tg,
        fetch_from_pansou=fetch_from_pansou,
        fetch_offline_magnets=fetch_offline_magnets,
        resolve_source_order=lambda channel: list(resolved_order or []),
        resolve_subscription_resolutions=lambda sub: [],
        resolve_subscription_quality_filter=lambda sub: {},
        prepare_hdhive_locked_resources=prepare_hdhive_locked_resources,
        build_hdhive_unlock_context=lambda: {"enabled": True},
        filter_resources_excluding_urls=filter_excluding_urls,
        log_source_fetch=log_source_fetch,
        emit_source_attempt=emit_source_attempt,
    )


class TestFetchResourcesWaterfall:
    def test_resource_resolver_stops_after_first_source_hit(self) -> None:
        source_calls: list[str] = []
        log_calls: list[tuple[str, int]] = []
        event_calls: list[tuple[str, str, int]] = []
        dependencies = _resolver_dependencies(
            {
                "pansou": (
                    [
                        {
                            "source_service": "pansou",
                            "share_link": "https://115.com/s/pansou1",
                            "resource_name": "Pansou 资源",
                        }
                    ],
                    [],
                ),
                "hdhive": (
                    [
                        {
                            "source_service": "hdhive",
                            "share_link": "https://115.com/s/hdhive1",
                        }
                    ],
                    [],
                ),
            },
            source_calls=source_calls,
            log_calls=log_calls,
            event_calls=event_calls,
        )

        resources, _traces, meta = asyncio.run(
            resolve_subscription_resources(
                channel="all",
                sub=_test_subscription(),
                dependencies=dependencies,
                source_order=["pansou", "hdhive"],
            )
        )

        assert source_calls == ["pansou"]
        assert log_calls == [("pansou", 1)]
        assert event_calls == [("pansou", "success", 1)]
        assert resources[0]["share_link"] == "https://115.com/s/pansou1"
        assert meta["source_order"] == ["pansou", "hdhive"]
        assert meta["attempts"] == [
            {"source": "pansou", "status": "success", "count": 1}
        ]

    def test_resource_resolver_falls_back_when_source_is_excluded(self) -> None:
        source_calls: list[str] = []
        dependencies = _resolver_dependencies(
            {
                "pansou": (
                    [
                        {
                            "source_service": "pansou",
                            "share_link": "https://115.com/s/used",
                        }
                    ],
                    [],
                ),
                "hdhive": (
                    [
                        {
                            "source_service": "hdhive",
                            "share_link": "https://115.com/s/new",
                        }
                    ],
                    [],
                ),
            },
            source_calls=source_calls,
        )

        resources, traces, meta = asyncio.run(
            resolve_subscription_resources(
                channel="all",
                sub=_test_subscription(),
                dependencies=dependencies,
                source_order=["pansou", "hdhive"],
                exclude_urls={"https://115.com/s/used"},
            )
        )

        assert source_calls == ["pansou", "hdhive"]
        assert resources[0]["share_link"] == "https://115.com/s/new"
        assert [item["source"] for item in meta["attempts"]] == ["pansou", "hdhive"]
        assert meta["attempts"][0]["status"] == "empty"
        assert meta["attempts"][1]["status"] == "success"
        assert any(trace.get("step") == "fetch_source_exhausted" for trace in traces)
        assert any(trace.get("step") == "hdhive_prepare_called" for trace in traces)

    def test_resource_resolver_empty_source_order_skips_fetchers(self) -> None:
        source_calls: list[str] = []
        dependencies = _resolver_dependencies(
            {},
            resolved_order=[],
            source_calls=source_calls,
        )

        resources, traces, meta = asyncio.run(
            resolve_subscription_resources(
                channel="all",
                sub=_test_subscription(),
                dependencies=dependencies,
            )
        )

        assert resources == []
        assert source_calls == []
        assert meta == {"source_order": [], "attempts": [], "summary": "无可用来源"}
        assert any(
            trace.get("step") == "fetch_source_order_empty" for trace in traces
        )

    def test_resource_resolver_module_does_not_import_service_runtime_or_db_layers(
        self,
    ) -> None:
        source = (
            ROOT / "backend/app/services/subscriptions/resource_resolver.py"
        ).read_text(encoding="utf-8")

        assert "subscription_service" not in source
        assert "runtime_settings_service" not in source
        assert "operation_log_service" not in source
        assert "kafka_producer" not in source
        assert "hdhive_service" not in source
        assert "AsyncSession" not in source
        assert "app.models" not in source
        assert "app.api" not in source

    def test_fetch_resources_stops_after_first_source_hit(
        self, monkeypatch: Any
    ) -> None:
        sub = SubscriptionSnapshot(
            id=0,
            tmdb_id=123,
            douban_id="",
            title="测试电影",
            media_type=MediaType.MOVIE,
            year="2024",
            auto_download=False,
            tv_scope="all",
            tv_season_number=None,
            tv_episode_start=None,
            tv_episode_end=None,
            tv_follow_mode="missing",
            tv_include_specials=False,
            has_successful_transfer=False,
        )

        async def fake_pansou(current_sub: SubscriptionSnapshot):
            return (
                [
                    {
                        "source_service": "pansou",
                        "share_link": "https://115.com/s/pansou1",
                        "resource_name": "Pansou 资源",
                    }
                ],
                [],
            )

        async def fake_hdhive(current_sub: SubscriptionSnapshot):
            raise AssertionError("不应在首个来源命中后继续请求 HDHive")

        pansou_mock = AsyncMock(side_effect=fake_pansou)
        hdhive_mock = AsyncMock(side_effect=fake_hdhive)
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_from_pansou_with_runtime_adapter",
            pansou_mock,
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_from_hdhive_with_runtime_adapter",
            hdhive_mock,
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_from_tg_with_runtime_adapter",
            AsyncMock(return_value=([], [])),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_offline_magnets_with_runtime_adapter",
            AsyncMock(return_value=([], [])),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "prepare_hdhive_locked_resources_with_runtime_adapter",
            AsyncMock(side_effect=lambda resources, *_args, **_kwargs: resources),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "build_hdhive_unlock_context_with_runtime_adapter",
            lambda: {"enabled": True},
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "resolve_subscription_resolutions_with_runtime_adapter",
            lambda _sub: [],
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "resolve_subscription_quality_filter_with_runtime_adapter",
            lambda _sub: {},
        )
        monkeypatch.setattr(
            resolver_runtime_module.operation_log_service,
            "log_background_event",
            AsyncMock(),
        )

        resources, _traces, meta = asyncio.run(
            resolver_runtime_module.fetch_subscription_resources_with_runtime_adapter(
                channel="all",
                sub=sub,
                dependencies=(
                    resolver_runtime_module.build_default_resource_resolver_runtime_dependencies()
                ),
                source_order=["pansou", "hdhive", "tg"],
            )
        )

        assert len(resources) == 1
        assert resources[0]["share_link"] == "https://115.com/s/pansou1"
        assert meta["source_order"] == ["pansou", "hdhive", "tg"]
        assert meta["attempts"] == [
            {"source": "pansou", "status": "success", "count": 1}
        ]
        hdhive_mock.assert_not_called()

    def test_fetch_resources_falls_back_when_first_source_exhausted(
        self, monkeypatch: Any
    ) -> None:
        sub = SubscriptionSnapshot(
            id=0,
            tmdb_id=456,
            douban_id="",
            title="测试电影2",
            media_type=MediaType.MOVIE,
            year="2024",
            auto_download=False,
            tv_scope="all",
            tv_season_number=None,
            tv_episode_start=None,
            tv_episode_end=None,
            tv_follow_mode="missing",
            tv_include_specials=False,
            has_successful_transfer=False,
        )

        async def fake_pansou(current_sub: SubscriptionSnapshot):
            return (
                [
                    {
                        "source_service": "pansou",
                        "share_link": "https://115.com/s/used",
                        "resource_name": "已尝试",
                    }
                ],
                [],
            )

        async def fake_hdhive(current_sub: SubscriptionSnapshot):
            return (
                [
                    {
                        "source_service": "hdhive",
                        "share_link": "https://115.com/s/new",
                        "resource_name": "HDHive 资源",
                    }
                ],
                [],
            )

        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_from_pansou_with_runtime_adapter",
            AsyncMock(side_effect=fake_pansou),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_from_hdhive_with_runtime_adapter",
            AsyncMock(side_effect=fake_hdhive),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_from_tg_with_runtime_adapter",
            AsyncMock(return_value=([], [])),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "fetch_offline_magnets_with_runtime_adapter",
            AsyncMock(return_value=([], [])),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "prepare_hdhive_locked_resources_with_runtime_adapter",
            AsyncMock(side_effect=lambda resources, *_args, **_kwargs: resources),
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "build_hdhive_unlock_context_with_runtime_adapter",
            lambda: {"enabled": True},
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "resolve_subscription_resolutions_with_runtime_adapter",
            lambda _sub: [],
        )
        monkeypatch.setattr(
            resolver_runtime_module,
            "resolve_subscription_quality_filter_with_runtime_adapter",
            lambda _sub: {},
        )
        monkeypatch.setattr(
            resolver_runtime_module.operation_log_service,
            "log_background_event",
            AsyncMock(),
        )

        resources, _traces, meta = asyncio.run(
            resolver_runtime_module.fetch_subscription_resources_with_runtime_adapter(
                channel="all",
                sub=sub,
                dependencies=(
                    resolver_runtime_module.build_default_resource_resolver_runtime_dependencies()
                ),
                source_order=["pansou", "hdhive"],
                exclude_urls={"https://115.com/s/used"},
            )
        )

        assert len(resources) == 1
        assert resources[0]["share_link"] == "https://115.com/s/new"
        assert [item["source"] for item in meta["attempts"]] == ["pansou", "hdhive"]
        assert meta["attempts"][0]["status"] == "empty"
        assert meta["attempts"][1]["status"] == "success"
