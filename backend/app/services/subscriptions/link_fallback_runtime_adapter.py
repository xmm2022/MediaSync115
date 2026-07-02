from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
)
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_subscription_resource_urls_with_db_adapter,
)
from app.services.subscriptions.execution_logs import (
    create_step_log as create_subscription_step_log,
)
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.link_fallback_flow import (
    auto_save_records_with_link_fallback,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)


DEFAULT_MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS = 6
RunLinkFallbackAdapter = Callable[..., Awaitable[dict[str, Any]]]
RunLinkFallback = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class LinkFallbackRuntimeDependencies:
    create_step_log: Callable[..., Awaitable[None]]
    auto_save_resources: Callable[..., Awaitable[dict[str, Any]]]
    load_subscription_resource_urls: Callable[[Any, int], Awaitable[set[str]]]
    fetch_resources: Callable[
        ...,
        Awaitable[
            tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
        ],
    ]
    store_new_resources: Callable[
        [Any, int, list[dict[str, Any]]],
        Awaitable[dict[str, Any]],
    ]
    run_adapter: RunLinkFallbackAdapter
    run_link_fallback: RunLinkFallback


async def auto_save_resources_with_default_runtime_dependencies(
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    *,
    source: str,
    tv_missing_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await auto_save_resources_with_runtime_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        source=source,
        dependencies=build_default_auto_save_resources_runtime_dependencies(
            resolve_quality_filter=resolve_subscription_quality_filter_with_runtime_adapter,
            create_step_log=create_subscription_step_log,
            apply_precise_postprocess_status=(
                apply_precise_transfer_postprocess_status_with_runtime_adapter
            ),
            notify_transfer_success=notify_transfer_success_with_runtime_adapter,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
    )


async def fetch_resources_with_default_runtime_dependencies(
    channel: str,
    sub: Any,
    hdhive_unlock_context: dict[str, Any] | None = None,
    *,
    source_order: list[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await fetch_subscription_resources_with_runtime_adapter(
        channel=channel,
        sub=sub,
        dependencies=build_default_resource_resolver_runtime_dependencies(),
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )


def build_default_link_fallback_runtime_dependencies() -> (
    LinkFallbackRuntimeDependencies
):
    return LinkFallbackRuntimeDependencies(
        create_step_log=create_subscription_step_log,
        auto_save_resources=auto_save_resources_with_default_runtime_dependencies,
        load_subscription_resource_urls=(
            load_subscription_resource_urls_with_db_adapter
        ),
        fetch_resources=fetch_resources_with_default_runtime_dependencies,
        store_new_resources=store_new_resources_with_runtime_adapter,
        run_adapter=auto_save_records_with_link_fallback_with_adapter,
        run_link_fallback=auto_save_records_with_link_fallback,
    )


async def auto_save_records_with_link_fallback_with_runtime_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    transfer_source: str,
    dependencies: LinkFallbackRuntimeDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    enable_link_refetch: bool = True,
    max_rounds: int = DEFAULT_MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS,
) -> dict[str, Any]:
    return await dependencies.run_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        transfer_source=transfer_source,
        dependencies=LinkFallbackAdapterDependencies(
            create_step_log=dependencies.create_step_log,
            auto_save_resources=dependencies.auto_save_resources,
            load_subscription_resource_urls=(
                dependencies.load_subscription_resource_urls
            ),
            fetch_resources=dependencies.fetch_resources,
            store_new_resources=dependencies.store_new_resources,
            run_link_fallback=dependencies.run_link_fallback,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=enable_link_refetch,
        max_rounds=max_rounds,
    )
