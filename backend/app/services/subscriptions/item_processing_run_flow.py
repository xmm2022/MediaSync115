from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.item_lifecycle_run_flow import (
    SubscriptionItemLifecycleDependencies,
    publish_subscription_item_progress,
    start_subscription_item_processing,
)
from app.services.subscriptions.item_outcome_run_flow import (
    SubscriptionItemOutcomeDependencies,
    complete_subscription_item_success,
    handle_subscription_item_failure,
)
from app.services.subscriptions.pre_scan_cleanup_run_flow import (
    PreScanCleanupRunDependencies,
    run_pre_scan_cleanup_for_subscription,
)
from app.services.subscriptions.resource_ingest_run_flow import (
    ResourceIngestRunDependencies,
    run_resource_ingest_for_subscription,
)
from app.services.subscriptions.run_counters import (
    apply_auto_transfer_stats,
    apply_cleanup_stats,
    apply_fixed_source_transfer_stats,
    apply_resource_store_stats,
    apply_subscription_failure,
)
from app.services.subscriptions.transfer_phase_run_flow import (
    SubscriptionTransferPhaseDependencies,
    run_subscription_transfer_phase,
)


FetchResources = Callable[
    ...,
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]


@dataclass(frozen=True, slots=True)
class SubscriptionItemProcessingDependencies:
    session_factory: Callable[[], Any]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    evaluate_pre_scan_cleanup: Callable[..., Awaitable[dict[str, Any]]]
    fetch_resources: FetchResources
    store_new_resources: Callable[
        [Any, int, list[dict[str, Any]]],
        Awaitable[dict[str, Any]],
    ]
    load_retryable_records: Callable[[Any, int], Awaitable[list[Any]]]
    load_force_retry_records: Callable[[Any, int, list[str]], Awaitable[list[Any]]]
    auto_save_records_with_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
    should_scan_fixed_sources: Callable[..., bool]
    scan_fixed_sources_for_subscription: Callable[..., Awaitable[dict[str, Any]]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]


async def process_subscription_item(
    *,
    sub: Any,
    run_id: str,
    channel: str,
    force_auto_download: bool,
    hdhive_unlock_context: dict[str, Any],
    source_order: list[str],
    result: dict[str, Any],
    result_lock: Any,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None,
    tv_media_type: Any,
    dependencies: SubscriptionItemProcessingDependencies,
) -> None:
    subscription_id = sub.id
    subscription_title = sub.title

    async with dependencies.session_factory() as inner_db:
        async def apply_subscription_failure_for_run(
            subscription_id: int,
            title: str,
            error: BaseException,
        ) -> None:
            async with result_lock:
                apply_subscription_failure(
                    result,
                    subscription_id=subscription_id,
                    title=title,
                    error=error,
                )

        item_outcome_dependencies = SubscriptionItemOutcomeDependencies(
            create_step_log=dependencies.create_step_log,
            log_background_event=dependencies.log_background_event,
            apply_subscription_failure=apply_subscription_failure_for_run,
        )

        try:
            await start_subscription_item_processing(
                db=inner_db,
                run_id=run_id,
                channel=channel,
                subscription_id=subscription_id,
                subscription_title=subscription_title,
                dependencies=SubscriptionItemLifecycleDependencies(
                    create_step_log=dependencies.create_step_log,
                ),
            )

            async def apply_pre_scan_cleanup_stats_for_run(
                media_type: Any,
            ) -> None:
                async with result_lock:
                    apply_cleanup_stats(
                        result,
                        media_type,
                        tv_media_type=tv_media_type,
                    )

            pre_scan_cleanup_result = await run_pre_scan_cleanup_for_subscription(
                db=inner_db,
                run_id=run_id,
                channel=channel,
                sub=sub,
                dependencies=PreScanCleanupRunDependencies(
                    evaluate_pre_scan_cleanup=(
                        dependencies.evaluate_pre_scan_cleanup
                    ),
                    create_step_log=dependencies.create_step_log,
                    log_background_event=dependencies.log_background_event,
                    apply_cleanup_stats=apply_pre_scan_cleanup_stats_for_run,
                ),
            )
            if pre_scan_cleanup_result.deleted:
                return

            tv_missing_snapshot = pre_scan_cleanup_result.tv_missing_snapshot

            async def apply_resource_store_stats_for_run(
                store_stats: dict[str, Any],
            ) -> None:
                async with result_lock:
                    apply_resource_store_stats(result, store_stats)

            resource_ingest_result = await run_resource_ingest_for_subscription(
                db=inner_db,
                run_id=run_id,
                channel=channel,
                sub=sub,
                hdhive_unlock_context=hdhive_unlock_context,
                source_order=source_order,
                dependencies=ResourceIngestRunDependencies(
                    fetch_resources=dependencies.fetch_resources,
                    store_new_resources=dependencies.store_new_resources,
                    create_step_log=dependencies.create_step_log,
                    log_background_event=dependencies.log_background_event,
                    apply_resource_store_stats=apply_resource_store_stats_for_run,
                ),
            )
            created_records = resource_ingest_result.created_records
            duplicate_urls = resource_ingest_result.duplicate_urls

            async def apply_auto_transfer_stats_for_run(
                stats: dict[str, Any],
                transfer_source: str,
            ) -> None:
                async with result_lock:
                    apply_auto_transfer_stats(
                        result,
                        stats,
                        transfer_source=transfer_source,
                    )

            async def apply_transfer_cleanup_stats_for_run(
                media_type: Any,
            ) -> None:
                async with result_lock:
                    apply_cleanup_stats(
                        result,
                        media_type,
                        tv_media_type=tv_media_type,
                    )

            async def apply_fixed_source_stats_for_run(
                saved: int,
                failed: int,
            ) -> None:
                async with result_lock:
                    apply_fixed_source_transfer_stats(
                        result,
                        saved=saved,
                        failed=failed,
                    )

            transfer_phase_result = await run_subscription_transfer_phase(
                db=inner_db,
                run_id=run_id,
                channel=channel,
                sub=sub,
                force_auto_download=force_auto_download,
                duplicate_urls=duplicate_urls,
                created_records=created_records,
                tv_missing_snapshot=tv_missing_snapshot,
                hdhive_unlock_context=hdhive_unlock_context,
                source_order=source_order,
                dependencies=SubscriptionTransferPhaseDependencies(
                    load_retryable_records=dependencies.load_retryable_records,
                    load_force_retry_records=(
                        dependencies.load_force_retry_records
                    ),
                    auto_save_records_with_link_fallback=(
                        dependencies.auto_save_records_with_link_fallback
                    ),
                    should_scan_fixed_sources=(
                        dependencies.should_scan_fixed_sources
                    ),
                    scan_fixed_sources_for_subscription=(
                        dependencies.scan_fixed_sources_for_subscription
                    ),
                    create_step_log=dependencies.create_step_log,
                    log_background_event=dependencies.log_background_event,
                    delete_subscription_with_records=(
                        dependencies.delete_subscription_with_records
                    ),
                    apply_auto_transfer_stats=apply_auto_transfer_stats_for_run,
                    apply_fixed_source_transfer_stats=(
                        apply_fixed_source_stats_for_run
                    ),
                    apply_cleanup_stats=apply_transfer_cleanup_stats_for_run,
                ),
            )

            await complete_subscription_item_success(
                db=inner_db,
                run_id=run_id,
                channel=channel,
                subscription_id=subscription_id,
                subscription_title=subscription_title,
                new_record_count=len(created_records),
                should_auto_download=transfer_phase_result.should_auto_download,
                sub_saved_count=transfer_phase_result.sub_saved_count,
                sub_failed_transfer_count=(
                    transfer_phase_result.sub_failed_transfer_count
                ),
                dependencies=item_outcome_dependencies,
            )
        except Exception as exc:
            await handle_subscription_item_failure(
                db=inner_db,
                run_id=run_id,
                channel=channel,
                subscription_id=subscription_id,
                subscription_title=subscription_title,
                error=exc,
                dependencies=item_outcome_dependencies,
            )
        finally:
            await publish_subscription_item_progress(
                result=result,
                result_lock=result_lock,
                progress_callback=progress_callback,
            )
