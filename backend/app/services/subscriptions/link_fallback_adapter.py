from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.link_fallback_flow import LinkFallbackDependencies


RunLinkFallback = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class LinkFallbackAdapterDependencies:
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
    run_link_fallback: RunLinkFallback


async def auto_save_records_with_link_fallback_with_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    transfer_source: str,
    dependencies: LinkFallbackAdapterDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    enable_link_refetch: bool = True,
    max_rounds: int = 6,
) -> dict[str, Any]:
    return await dependencies.run_link_fallback(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        transfer_source=transfer_source,
        dependencies=LinkFallbackDependencies(
            create_step_log=dependencies.create_step_log,
            auto_save_resources=dependencies.auto_save_resources,
            load_subscription_resource_urls=dependencies.load_subscription_resource_urls,
            fetch_resources=dependencies.fetch_resources,
            store_new_resources=dependencies.store_new_resources,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=enable_link_refetch,
        max_rounds=max_rounds,
    )
