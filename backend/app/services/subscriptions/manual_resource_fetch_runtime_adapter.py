from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.models.models import MediaType
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot


FetchResources = Callable[
    [str, Any],
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]


@dataclass(frozen=True, slots=True)
class ManualResourceFetchRuntimeDependencies:
    snapshot_class: type[SubscriptionSnapshot]
    tv_media_type: Any
    movie_media_type: Any
    fetch_resources: FetchResources


async def fetch_resources_with_default_runtime_dependencies(
    channel: str,
    sub: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await fetch_subscription_resources_with_runtime_adapter(
        channel=channel,
        sub=sub,
        dependencies=build_default_resource_resolver_runtime_dependencies(),
        hdhive_unlock_context=None,
        source_order=None,
        exclude_urls=None,
    )


def build_default_manual_resource_fetch_runtime_dependencies(
    *,
    fetch_resources: FetchResources | None = None,
) -> ManualResourceFetchRuntimeDependencies:
    return ManualResourceFetchRuntimeDependencies(
        snapshot_class=SubscriptionSnapshot,
        tv_media_type=MediaType.TV,
        movie_media_type=MediaType.MOVIE,
        fetch_resources=(
            fetch_resources
            if fetch_resources is not None
            else fetch_resources_with_default_runtime_dependencies
        ),
    )


async def fetch_resources_for_media_with_runtime_adapter(
    *,
    media_type: str,
    tmdb_id: int | None = None,
    douban_id: str | None = None,
    title: str = "",
    year: str | None = None,
    season_number: int | None = None,
    dependencies: ManualResourceFetchRuntimeDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    resolved_media_type = (
        dependencies.tv_media_type
        if media_type == "tv"
        else dependencies.movie_media_type
    )
    snapshot = dependencies.snapshot_class(
        id=0,
        tmdb_id=tmdb_id,
        douban_id=douban_id,
        title=title or "",
        media_type=resolved_media_type,
        year=year,
        auto_download=False,
        tv_scope="all",
        tv_season_number=season_number,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_follow_mode="missing",
        tv_include_specials=False,
        has_successful_transfer=False,
    )
    return await dependencies.fetch_resources("all", snapshot)
