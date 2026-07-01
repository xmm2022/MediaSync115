from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_fetchers import (
    ResourceFetcherDependencies,
)


RunResourceFetcher = Callable[
    ..., Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]]]]
]


@dataclass(frozen=True, slots=True)
class ResourceFetcherAdapterDependencies:
    search_pansou_by_tmdb: Callable[
        [int, str, int | None], Awaitable[dict[str, Any]]
    ]
    search_pansou_keyword: Callable[..., Awaitable[Any]]
    normalize_pansou_resources: Callable[[Any], list[dict[str, Any]]]
    get_hdhive_tv_pan115: Callable[[int], Awaitable[list[dict[str, Any]]]]
    get_hdhive_movie_pan115: Callable[[int], Awaitable[list[dict[str, Any]]]]
    get_hdhive_by_keyword: Callable[..., Awaitable[list[dict[str, Any]]]]
    normalize_hdhive_items: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    prefer_hdhive_free: Callable[[], bool]
    sort_hdhive_free_first: Callable[
        [list[dict[str, Any]]], list[dict[str, Any]]
    ]
    search_tg_by_keyword: Callable[..., Awaitable[list[dict[str, Any]]]]
    offline_transfer_enabled: Callable[[], bool]
    search_seedhub_magnets: Callable[..., Awaitable[list[dict[str, Any]]]]
    search_butailing_magnets: Callable[..., Awaitable[list[dict[str, Any]]]]
    log_background_event: Callable[..., Awaitable[None]]
    run_fetch_from_pansou: RunResourceFetcher
    run_fetch_from_hdhive: RunResourceFetcher
    run_fetch_from_tg: RunResourceFetcher
    run_fetch_offline_magnets: RunResourceFetcher


def build_resource_fetcher_dependencies(
    dependencies: ResourceFetcherAdapterDependencies,
) -> ResourceFetcherDependencies:
    async def search_pansou_by_keyword(keyword: str) -> Any:
        return await dependencies.search_pansou_keyword(keyword, res="results")

    async def log_offline_source_fetch(**kwargs: Any) -> None:
        await dependencies.log_background_event(**kwargs)

    return ResourceFetcherDependencies(
        search_pansou_by_tmdb=dependencies.search_pansou_by_tmdb,
        search_pansou_by_keyword=search_pansou_by_keyword,
        normalize_pansou_resources=dependencies.normalize_pansou_resources,
        get_hdhive_tv_pan115=dependencies.get_hdhive_tv_pan115,
        get_hdhive_movie_pan115=dependencies.get_hdhive_movie_pan115,
        get_hdhive_by_keyword=dependencies.get_hdhive_by_keyword,
        normalize_hdhive_items=dependencies.normalize_hdhive_items,
        prefer_hdhive_free=dependencies.prefer_hdhive_free,
        sort_hdhive_free_first=dependencies.sort_hdhive_free_first,
        search_tg_by_keyword=dependencies.search_tg_by_keyword,
        offline_transfer_enabled=dependencies.offline_transfer_enabled,
        search_seedhub_magnets=dependencies.search_seedhub_magnets,
        search_butailing_magnets=dependencies.search_butailing_magnets,
        log_offline_source_fetch=log_offline_source_fetch,
    )


async def fetch_from_pansou_with_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await dependencies.run_fetch_from_pansou(
        sub,
        dependencies=build_resource_fetcher_dependencies(dependencies),
    )


async def fetch_from_hdhive_with_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await dependencies.run_fetch_from_hdhive(
        sub,
        dependencies=build_resource_fetcher_dependencies(dependencies),
    )


async def fetch_from_tg_with_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await dependencies.run_fetch_from_tg(
        sub,
        dependencies=build_resource_fetcher_dependencies(dependencies),
    )


async def fetch_offline_magnets_with_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await dependencies.run_fetch_offline_magnets(
        sub,
        dependencies=build_resource_fetcher_dependencies(dependencies),
    )
