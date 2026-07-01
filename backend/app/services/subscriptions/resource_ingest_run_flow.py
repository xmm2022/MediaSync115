from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.run_item_logs import (
    build_fetch_done_event_kwargs,
    build_fetch_resources_summary_step,
    build_fetch_trace_step_log,
    build_store_done_event_kwargs,
    build_store_new_resources_step,
)


FetchResources = Callable[
    ...,
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]


@dataclass(frozen=True, slots=True)
class ResourceIngestRunResult:
    resources: list[dict[str, Any]]
    fetch_trace: list[dict[str, Any]]
    source_attempt_info: dict[str, Any]
    store_stats: dict[str, Any]
    created_records: list[Any]
    duplicate_urls: list[str]


@dataclass(frozen=True, slots=True)
class ResourceIngestRunDependencies:
    fetch_resources: FetchResources
    store_new_resources: Callable[
        [Any, int, list[dict[str, Any]]],
        Awaitable[dict[str, Any]],
    ]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    apply_resource_store_stats: Callable[[dict[str, Any]], Awaitable[None]]


async def _create_subscription_step_log(
    *,
    db: Any,
    run_id: str,
    channel: str,
    subscription_id: int,
    subscription_title: str,
    dependencies: ResourceIngestRunDependencies,
    step_payload: dict[str, Any],
) -> None:
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        **step_payload,
    )


async def run_resource_ingest_for_subscription(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    hdhive_unlock_context: dict[str, Any],
    source_order: list[str],
    dependencies: ResourceIngestRunDependencies,
) -> ResourceIngestRunResult:
    subscription_id = int(sub.id)
    subscription_title = str(sub.title)

    resources, fetch_trace, source_attempt_info = await dependencies.fetch_resources(
        channel,
        sub,
        hdhive_unlock_context,
        source_order=source_order,
    )
    for trace in fetch_trace:
        await _create_subscription_step_log(
            db=db,
            run_id=run_id,
            channel=channel,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            dependencies=dependencies,
            step_payload=build_fetch_trace_step_log(trace),
        )

    await _create_subscription_step_log(
        db=db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        dependencies=dependencies,
        step_payload=build_fetch_resources_summary_step(
            resources,
            source_attempt_info,
        ),
    )
    await dependencies.log_background_event(
        **build_fetch_done_event_kwargs(
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            channel=channel,
            trace_id=run_id,
            resources=resources,
            fetch_trace=fetch_trace,
            source_attempt_info=source_attempt_info,
        )
    )

    store_stats = await dependencies.store_new_resources(
        db,
        subscription_id,
        resources,
    )
    created_records = store_stats["created_records"]
    duplicate_urls = store_stats["duplicate_urls"]

    await dependencies.apply_resource_store_stats(store_stats)
    await _create_subscription_step_log(
        db=db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        dependencies=dependencies,
        step_payload=build_store_new_resources_step(
            store_stats,
            created_records,
        ),
    )
    await dependencies.log_background_event(
        **build_store_done_event_kwargs(
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            trace_id=run_id,
            created_records=created_records,
            store_stats=store_stats,
        )
    )

    return ResourceIngestRunResult(
        resources=resources,
        fetch_trace=fetch_trace,
        source_attempt_info=source_attempt_info,
        store_stats=store_stats,
        created_records=created_records,
        duplicate_urls=duplicate_urls,
    )
