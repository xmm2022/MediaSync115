from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_resolver import (
    ResourceResolverDependencies,
)


FetchResources = Callable[
    [Any], Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]]]]
]
RunResourceResolver = Callable[
    ..., Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]]
]


@dataclass(frozen=True, slots=True)
class ResourceResolverAdapterDependencies:
    fetch_from_hdhive: FetchResources
    fetch_from_tg: FetchResources
    fetch_from_pansou: FetchResources
    fetch_offline_magnets: FetchResources
    resolve_source_order: Callable[[str], list[str]]
    resolve_subscription_resolutions: Callable[[Any], list[str]]
    resolve_subscription_quality_filter: Callable[[Any], dict[str, Any]]
    prepare_hdhive_locked_resources: Callable[
        [list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Awaitable[list[dict[str, Any]]],
    ]
    build_hdhive_unlock_context: Callable[[], dict[str, Any]]
    filter_resources_excluding_urls: Callable[
        [list[dict[str, Any]], set[str]], list[dict[str, Any]]
    ]
    log_background_event: Callable[..., Awaitable[None]]
    emit_source_attempt_event: Callable[[int, dict[str, Any]], None]
    run_resolver: RunResourceResolver


async def fetch_subscription_resources_with_adapter(
    *,
    channel: str,
    sub: Any,
    dependencies: ResourceResolverAdapterDependencies,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    async def log_source_fetch(
        current_sub: Any,
        source: str,
        count: int,
    ) -> None:
        await dependencies.log_background_event(
            source_type="background_task",
            module="subscriptions",
            action="subscription.item.fetch_source",
            status="success" if count else "info",
            message=f"[{current_sub.title}] 来源 {source} 返回 {count} 条资源",
            extra={
                "subscription_id": current_sub.id,
                "title": current_sub.title,
                "source": source,
                "count": count,
            },
        )

    def emit_source_attempt(current_sub: Any, attempt_info: dict[str, Any]) -> None:
        dependencies.emit_source_attempt_event(
            int(current_sub.id),
            {
                "subscription_id": current_sub.id,
                "title": current_sub.title,
                "source": attempt_info.get("source"),
                "status": attempt_info.get("status", "empty"),
                "resource_count": attempt_info.get("count", 0),
            },
        )

    resolver_dependencies = ResourceResolverDependencies(
        fetch_from_hdhive=dependencies.fetch_from_hdhive,
        fetch_from_tg=dependencies.fetch_from_tg,
        fetch_from_pansou=dependencies.fetch_from_pansou,
        fetch_offline_magnets=dependencies.fetch_offline_magnets,
        resolve_source_order=dependencies.resolve_source_order,
        resolve_subscription_resolutions=(
            dependencies.resolve_subscription_resolutions
        ),
        resolve_subscription_quality_filter=(
            dependencies.resolve_subscription_quality_filter
        ),
        prepare_hdhive_locked_resources=(
            dependencies.prepare_hdhive_locked_resources
        ),
        build_hdhive_unlock_context=dependencies.build_hdhive_unlock_context,
        filter_resources_excluding_urls=(
            dependencies.filter_resources_excluding_urls
        ),
        log_source_fetch=log_source_fetch,
        emit_source_attempt=emit_source_attempt,
    )
    return await dependencies.run_resolver(
        channel=channel,
        sub=sub,
        dependencies=resolver_dependencies,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )
