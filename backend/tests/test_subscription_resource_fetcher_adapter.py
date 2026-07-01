from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_fetcher_adapter import (
    ResourceFetcherAdapterDependencies,
    build_resource_fetcher_dependencies,
    fetch_from_hdhive_with_adapter,
    fetch_from_pansou_with_adapter,
    fetch_from_tg_with_adapter,
    fetch_offline_magnets_with_adapter,
)
from app.services.subscriptions.resource_fetchers import ResourceFetcherDependencies


ROOT = Path(__file__).resolve().parents[2]


def _sub() -> SimpleNamespace:
    return SimpleNamespace(id=41, title="测试订阅")


def _dependencies(**overrides: Any) -> ResourceFetcherAdapterDependencies:
    async def run_fetcher(
        _sub: Any, *, dependencies: ResourceFetcherDependencies
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        _ = dependencies
        return [], []

    values: dict[str, Any] = {
        "search_pansou_by_tmdb": _unexpected_async,
        "search_pansou_keyword": _unexpected_async,
        "normalize_pansou_resources": _unexpected_sync,
        "get_hdhive_tv_pan115": _unexpected_async,
        "get_hdhive_movie_pan115": _unexpected_async,
        "get_hdhive_by_keyword": _unexpected_async,
        "normalize_hdhive_items": _unexpected_sync,
        "prefer_hdhive_free": _unexpected_sync,
        "sort_hdhive_free_first": _unexpected_sync,
        "search_tg_by_keyword": _unexpected_async,
        "offline_transfer_enabled": _unexpected_sync,
        "search_seedhub_magnets": _unexpected_async,
        "search_butailing_magnets": _unexpected_async,
        "log_background_event": _unexpected_async,
        "run_fetch_from_pansou": run_fetcher,
        "run_fetch_from_hdhive": run_fetcher,
        "run_fetch_from_tg": run_fetcher,
        "run_fetch_offline_magnets": run_fetcher,
    }
    values.update(overrides)
    return ResourceFetcherAdapterDependencies(**values)


@pytest.mark.asyncio
async def test_build_resource_fetcher_dependencies_preserves_service_call_shapes() -> None:
    pansou_tmdb_calls: list[tuple[int, str, int | None]] = []
    pansou_keyword_calls: list[tuple[str, dict[str, Any]]] = []
    hdhive_keyword_calls: list[tuple[str, dict[str, Any]]] = []
    tg_calls: list[tuple[str, dict[str, Any]]] = []
    seedhub_calls: list[tuple[str, dict[str, Any]]] = []
    butailing_calls: list[tuple[str, dict[str, Any]]] = []
    offline_logs: list[dict[str, Any]] = []

    async def search_pansou_by_tmdb(
        tmdb_id: int,
        media_type: str,
        season_number: int | None,
    ) -> dict[str, Any]:
        pansou_tmdb_calls.append((tmdb_id, media_type, season_number))
        return {"list": [{"name": "tmdb"}]}

    async def search_pansou_keyword(keyword: str, **kwargs: Any) -> dict[str, Any]:
        pansou_keyword_calls.append((keyword, kwargs))
        return {"results": []}

    async def get_hdhive_by_keyword(
        keyword: str, *, media_type: str
    ) -> list[dict[str, Any]]:
        hdhive_keyword_calls.append((keyword, {"media_type": media_type}))
        return [{"name": "hdhive"}]

    async def search_tg_by_keyword(
        keyword: str, *, media_type: str
    ) -> list[dict[str, Any]]:
        tg_calls.append((keyword, {"media_type": media_type}))
        return [{"name": "tg"}]

    async def search_seedhub_magnets(
        keyword: str, *, limit: int
    ) -> list[dict[str, Any]]:
        seedhub_calls.append((keyword, {"limit": limit}))
        return [{"name": "seedhub"}]

    async def search_butailing_magnets(
        keyword: str, *, media_type: str
    ) -> list[dict[str, Any]]:
        butailing_calls.append((keyword, {"media_type": media_type}))
        return [{"name": "butailing"}]

    async def log_background_event(**kwargs: Any) -> None:
        offline_logs.append(kwargs)

    core_dependencies = build_resource_fetcher_dependencies(
        _dependencies(
            search_pansou_by_tmdb=search_pansou_by_tmdb,
            search_pansou_keyword=search_pansou_keyword,
            normalize_pansou_resources=lambda payload: [{"payload": payload}],
            get_hdhive_tv_pan115=lambda tmdb_id: _async_value(
                [{"tmdb_id": tmdb_id, "type": "tv"}]
            ),
            get_hdhive_movie_pan115=lambda tmdb_id: _async_value(
                [{"tmdb_id": tmdb_id, "type": "movie"}]
            ),
            get_hdhive_by_keyword=get_hdhive_by_keyword,
            normalize_hdhive_items=lambda rows: [{"normalized": rows}],
            prefer_hdhive_free=lambda: True,
            sort_hdhive_free_first=lambda rows: [{"sorted": rows}],
            search_tg_by_keyword=search_tg_by_keyword,
            offline_transfer_enabled=lambda: True,
            search_seedhub_magnets=search_seedhub_magnets,
            search_butailing_magnets=search_butailing_magnets,
            log_background_event=log_background_event,
        )
    )

    assert await core_dependencies.search_pansou_by_tmdb(1101, "tv", 2) == {
        "list": [{"name": "tmdb"}]
    }
    assert await core_dependencies.search_pansou_by_keyword("测试") == {
        "results": []
    }
    assert core_dependencies.normalize_pansou_resources({"x": 1}) == [
        {"payload": {"x": 1}}
    ]
    assert await core_dependencies.get_hdhive_tv_pan115(1101) == [
        {"tmdb_id": 1101, "type": "tv"}
    ]
    assert await core_dependencies.get_hdhive_movie_pan115(1102) == [
        {"tmdb_id": 1102, "type": "movie"}
    ]
    assert await core_dependencies.get_hdhive_by_keyword(
        "关键词", media_type="movie"
    ) == [{"name": "hdhive"}]
    assert core_dependencies.normalize_hdhive_items([{"raw": True}]) == [
        {"normalized": [{"raw": True}]}
    ]
    assert core_dependencies.prefer_hdhive_free()
    assert core_dependencies.sort_hdhive_free_first([{"free": True}]) == [
        {"sorted": [{"free": True}]}
    ]
    assert await core_dependencies.search_tg_by_keyword(
        "关键词", media_type="tv"
    ) == [{"name": "tg"}]
    assert core_dependencies.offline_transfer_enabled()
    assert await core_dependencies.search_seedhub_magnets("关键词", limit=20) == [
        {"name": "seedhub"}
    ]
    assert await core_dependencies.search_butailing_magnets(
        "关键词", media_type="movie"
    ) == [{"name": "butailing"}]
    await core_dependencies.log_offline_source_fetch(action="subscription.fetch")

    assert pansou_tmdb_calls == [(1101, "tv", 2)]
    assert pansou_keyword_calls == [("测试", {"res": "results"})]
    assert hdhive_keyword_calls == [("关键词", {"media_type": "movie"})]
    assert tg_calls == [("关键词", {"media_type": "tv"})]
    assert seedhub_calls == [("关键词", {"limit": 20})]
    assert butailing_calls == [("关键词", {"media_type": "movie"})]
    assert offline_logs == [{"action": "subscription.fetch"}]


@pytest.mark.asyncio
async def test_fetcher_adapter_wrappers_call_matching_runner() -> None:
    sub = _sub()
    runner_calls: list[tuple[str, Any, ResourceFetcherDependencies]] = []

    async def run_fetch_from_pansou(
        current_sub: Any, *, dependencies: ResourceFetcherDependencies
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("pansou", current_sub, dependencies))
        return [{"source": "pansou"}], []

    async def run_fetch_from_hdhive(
        current_sub: Any, *, dependencies: ResourceFetcherDependencies
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("hdhive", current_sub, dependencies))
        return [{"source": "hdhive"}], []

    async def run_fetch_from_tg(
        current_sub: Any, *, dependencies: ResourceFetcherDependencies
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("tg", current_sub, dependencies))
        return [{"source": "tg"}], []

    async def run_fetch_offline_magnets(
        current_sub: Any, *, dependencies: ResourceFetcherDependencies
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("offline", current_sub, dependencies))
        return [{"source": "offline"}], []

    dependencies = _dependencies(
        run_fetch_from_pansou=run_fetch_from_pansou,
        run_fetch_from_hdhive=run_fetch_from_hdhive,
        run_fetch_from_tg=run_fetch_from_tg,
        run_fetch_offline_magnets=run_fetch_offline_magnets,
    )

    assert await fetch_from_pansou_with_adapter(sub, dependencies=dependencies) == (
        [{"source": "pansou"}],
        [],
    )
    assert await fetch_from_hdhive_with_adapter(sub, dependencies=dependencies) == (
        [{"source": "hdhive"}],
        [],
    )
    assert await fetch_from_tg_with_adapter(sub, dependencies=dependencies) == (
        [{"source": "tg"}],
        [],
    )
    assert await fetch_offline_magnets_with_adapter(
        sub, dependencies=dependencies
    ) == ([{"source": "offline"}], [])

    assert [item[0] for item in runner_calls] == [
        "pansou",
        "hdhive",
        "tg",
        "offline",
    ]
    assert all(item[1] is sub for item in runner_calls)
    assert all(isinstance(item[2], ResourceFetcherDependencies) for item in runner_calls)


def test_resource_fetcher_adapter_module_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_fetcher_adapter.py"
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


async def _async_value(value: Any) -> Any:
    return value


async def _unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected async dependency call")


def _unexpected_sync(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected sync dependency call")
