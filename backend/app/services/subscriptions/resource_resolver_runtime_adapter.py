from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.operation_log_service import operation_log_service
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_candidates import (
    filter_resources_excluding_urls,
)
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
from app.services.subscriptions.resource_resolver import (
    resolve_subscription_resources,
)
from app.services.subscriptions.resource_resolver_adapter import (
    FetchResources,
    ResourceResolverAdapterDependencies,
    RunResourceResolver,
    fetch_subscription_resources_with_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
    resolve_subscription_resolutions_with_runtime_adapter,
)


RunResourceResolverAdapter = Callable[
    ...,
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]


@dataclass(frozen=True, slots=True)
class ResourceResolverRuntimeDependencies:
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
    run_adapter: RunResourceResolverAdapter
    run_resolver: RunResourceResolver


def emit_source_attempt_event(subscription_id: int, data: dict[str, Any]) -> None:
    from app.analytics import kafka_producer

    if kafka_producer._enabled:
        kafka_producer.send(
            event_type="source_attempt",
            data=data,
            key=str(subscription_id),
        )


def build_default_resource_resolver_runtime_dependencies(
    *,
    fetch_from_hdhive: FetchResources | None = None,
    fetch_from_tg: FetchResources | None = None,
    fetch_from_pansou: FetchResources | None = None,
    fetch_offline_magnets: FetchResources | None = None,
    resolve_source_order: Callable[[str], list[str]] | None = None,
    resolve_subscription_resolutions: Callable[[Any], list[str]] | None = None,
    resolve_subscription_quality_filter: (
        Callable[[Any], dict[str, Any]] | None
    ) = None,
    prepare_hdhive_locked_resources: Callable[
        [list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Awaitable[list[dict[str, Any]]],
    ]
    | None = None,
    build_hdhive_unlock_context: Callable[[], dict[str, Any]] | None = None,
) -> ResourceResolverRuntimeDependencies:
    return ResourceResolverRuntimeDependencies(
        fetch_from_hdhive=(
            fetch_from_hdhive
            if fetch_from_hdhive is not None
            else fetch_from_hdhive_with_runtime_adapter
        ),
        fetch_from_tg=(
            fetch_from_tg
            if fetch_from_tg is not None
            else fetch_from_tg_with_runtime_adapter
        ),
        fetch_from_pansou=(
            fetch_from_pansou
            if fetch_from_pansou is not None
            else fetch_from_pansou_with_runtime_adapter
        ),
        fetch_offline_magnets=(
            fetch_offline_magnets
            if fetch_offline_magnets is not None
            else fetch_offline_magnets_with_runtime_adapter
        ),
        resolve_source_order=(
            resolve_source_order
            if resolve_source_order is not None
            else resolve_source_order_with_runtime_adapter
        ),
        resolve_subscription_resolutions=(
            resolve_subscription_resolutions
            if resolve_subscription_resolutions is not None
            else resolve_subscription_resolutions_with_runtime_adapter
        ),
        resolve_subscription_quality_filter=(
            resolve_subscription_quality_filter
            if resolve_subscription_quality_filter is not None
            else resolve_subscription_quality_filter_with_runtime_adapter
        ),
        prepare_hdhive_locked_resources=(
            prepare_hdhive_locked_resources
            if prepare_hdhive_locked_resources is not None
            else prepare_hdhive_locked_resources_with_runtime_adapter
        ),
        build_hdhive_unlock_context=(
            build_hdhive_unlock_context
            if build_hdhive_unlock_context is not None
            else build_hdhive_unlock_context_with_runtime_adapter
        ),
        filter_resources_excluding_urls=filter_resources_excluding_urls,
        log_background_event=operation_log_service.log_background_event,
        emit_source_attempt_event=emit_source_attempt_event,
        run_adapter=fetch_subscription_resources_with_adapter,
        run_resolver=resolve_subscription_resources,
    )


async def fetch_subscription_resources_with_runtime_adapter(
    *,
    channel: str,
    sub: Any,
    dependencies: ResourceResolverRuntimeDependencies,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await dependencies.run_adapter(
        channel=channel,
        sub=sub,
        dependencies=ResourceResolverAdapterDependencies(
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
            log_background_event=dependencies.log_background_event,
            emit_source_attempt_event=dependencies.emit_source_attempt_event,
            run_resolver=dependencies.run_resolver,
        ),
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )
