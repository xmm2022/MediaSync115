from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.resource_search import (
    normalize_pansou_pan115_list as _normalize_pansou_pan115_list,
    search_pansou_pan115_resources as _search_pansou_pan115_resources,
)
from app.services.subscriptions.resource_fetcher_adapter import (
    ResourceFetcherAdapterDependencies,
)
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    build_default_resource_fetcher_runtime_dependencies,
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
from app.services.subscriptions.resource_fetchers import (
    ResourceFetcherDependencies,
    fetch_from_hdhive as fetch_from_hdhive_flow,
    fetch_from_pansou as fetch_from_pansou_flow,
    fetch_from_tg as fetch_from_tg_flow,
    fetch_offline_magnets as fetch_offline_magnets_flow,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub() -> SimpleNamespace:
    return SimpleNamespace(id=41, title="测试订阅")


def _dependencies(**overrides: Any) -> ResourceFetcherAdapterDependencies:
    async def run_fetcher(
        _sub: Any,
        *,
        dependencies: ResourceFetcherDependencies,
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
async def test_runtime_fetcher_wrappers_use_injected_dependencies() -> None:
    sub = _sub()
    runner_calls: list[tuple[str, Any, ResourceFetcherDependencies]] = []

    async def run_fetch_from_pansou(
        current_sub: Any,
        *,
        dependencies: ResourceFetcherDependencies,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("pansou", current_sub, dependencies))
        return [{"source": "pansou"}], [{"trace": "pansou"}]

    async def run_fetch_from_hdhive(
        current_sub: Any,
        *,
        dependencies: ResourceFetcherDependencies,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("hdhive", current_sub, dependencies))
        return [{"source": "hdhive"}], [{"trace": "hdhive"}]

    async def run_fetch_from_tg(
        current_sub: Any,
        *,
        dependencies: ResourceFetcherDependencies,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("tg", current_sub, dependencies))
        return [{"source": "tg"}], [{"trace": "tg"}]

    async def run_fetch_offline_magnets(
        current_sub: Any,
        *,
        dependencies: ResourceFetcherDependencies,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        runner_calls.append(("offline", current_sub, dependencies))
        return [{"source": "offline"}], [{"trace": "offline"}]

    dependencies = _dependencies(
        run_fetch_from_pansou=run_fetch_from_pansou,
        run_fetch_from_hdhive=run_fetch_from_hdhive,
        run_fetch_from_tg=run_fetch_from_tg,
        run_fetch_offline_magnets=run_fetch_offline_magnets,
    )

    assert await fetch_from_pansou_with_runtime_adapter(
        sub,
        dependencies=dependencies,
    ) == ([{"source": "pansou"}], [{"trace": "pansou"}])
    assert await fetch_from_hdhive_with_runtime_adapter(
        sub,
        dependencies=dependencies,
    ) == ([{"source": "hdhive"}], [{"trace": "hdhive"}])
    assert await fetch_from_tg_with_runtime_adapter(
        sub,
        dependencies=dependencies,
    ) == ([{"source": "tg"}], [{"trace": "tg"}])
    assert await fetch_offline_magnets_with_runtime_adapter(
        sub,
        dependencies=dependencies,
    ) == ([{"source": "offline"}], [{"trace": "offline"}])

    assert [item[0] for item in runner_calls] == [
        "pansou",
        "hdhive",
        "tg",
        "offline",
    ]
    assert all(item[1] is sub for item in runner_calls)
    assert all(isinstance(item[2], ResourceFetcherDependencies) for item in runner_calls)


def test_default_runtime_dependencies_bind_existing_helpers_and_runners() -> None:
    dependencies = build_default_resource_fetcher_runtime_dependencies()

    assert dependencies.search_pansou_by_tmdb is _search_pansou_pan115_resources
    assert dependencies.normalize_pansou_resources is _normalize_pansou_pan115_list
    assert dependencies.normalize_hdhive_items is normalize_hdhive_subscription_items
    assert dependencies.run_fetch_from_pansou is fetch_from_pansou_flow
    assert dependencies.run_fetch_from_hdhive is fetch_from_hdhive_flow
    assert dependencies.run_fetch_from_tg is fetch_from_tg_flow
    assert dependencies.run_fetch_offline_magnets is fetch_offline_magnets_flow


def test_resource_fetcher_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_fetcher_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source


async def _unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected async dependency call")


def _unexpected_sync(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected sync dependency call")
