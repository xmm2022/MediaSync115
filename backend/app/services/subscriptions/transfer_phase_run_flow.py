from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.auto_transfer_retry_records import (
    AutoTransferRetryRecordDependencies,
    select_auto_transfer_retry_records,
)
from app.services.subscriptions.auto_transfer_run_flow import (
    AutoTransferRunDependencies,
    AutoTransferRunResult,
    run_auto_transfer_for_subscription,
)
from app.services.subscriptions.fixed_source_run_flow import (
    FixedSourceRunDependencies,
    FixedSourceRunResult,
    run_fixed_source_for_subscription,
)


@dataclass(frozen=True, slots=True)
class SubscriptionTransferPhaseResult:
    should_auto_download: bool
    sub_saved_count: int
    sub_failed_transfer_count: int
    auto_transfer_result: AutoTransferRunResult
    fixed_source_result: FixedSourceRunResult


@dataclass(frozen=True, slots=True)
class SubscriptionTransferPhaseDependencies:
    load_retryable_records: Callable[[Any, int], Awaitable[list[Any]]]
    load_force_retry_records: Callable[[Any, int, list[str]], Awaitable[list[Any]]]
    auto_save_records_with_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
    should_scan_fixed_sources: Callable[..., bool]
    scan_fixed_sources_for_subscription: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
    apply_auto_transfer_stats: Callable[[dict[str, Any], str], Awaitable[None]]
    apply_fixed_source_transfer_stats: Callable[[int, int], Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]


async def run_subscription_transfer_phase(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    force_auto_download: bool,
    duplicate_urls: Iterable[str],
    created_records: Iterable[Any],
    tv_missing_snapshot: Any,
    hdhive_unlock_context: dict[str, Any],
    source_order: list[str],
    dependencies: SubscriptionTransferPhaseDependencies,
) -> SubscriptionTransferPhaseResult:
    created_records_list = list(created_records or [])
    duplicate_url_list = list(duplicate_urls or [])
    should_auto_download = force_auto_download or bool(sub.auto_download)

    async def select_retry_records(
        *,
        db: Any,
        subscription_id: int,
        auto_download: bool,
        force_auto_download: bool,
        duplicate_urls: list[str],
        created_records: list[Any],
    ) -> list[Any]:
        return await select_auto_transfer_retry_records(
            db=db,
            subscription_id=subscription_id,
            auto_download=auto_download,
            force_auto_download=force_auto_download,
            duplicate_urls=duplicate_urls,
            created_records=created_records,
            dependencies=AutoTransferRetryRecordDependencies(
                load_retryable_records=dependencies.load_retryable_records,
                load_force_retry_records=dependencies.load_force_retry_records,
            ),
        )

    auto_transfer_result = await run_auto_transfer_for_subscription(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        should_auto_download=should_auto_download,
        force_auto_download=force_auto_download,
        duplicate_urls=duplicate_url_list,
        created_records=created_records_list,
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        dependencies=AutoTransferRunDependencies(
            select_retry_records=select_retry_records,
            auto_save_records_with_link_fallback=(
                dependencies.auto_save_records_with_link_fallback
            ),
            create_step_log=dependencies.create_step_log,
            log_background_event=dependencies.log_background_event,
            delete_subscription_with_records=(
                dependencies.delete_subscription_with_records
            ),
            apply_auto_transfer_stats=dependencies.apply_auto_transfer_stats,
            apply_cleanup_stats=dependencies.apply_cleanup_stats,
        ),
    )

    fixed_source_result = await run_fixed_source_for_subscription(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        cleanup_after_auto=auto_transfer_result.cleanup_after_auto,
        force_auto_download=force_auto_download,
        tv_missing_snapshot=tv_missing_snapshot,
        dependencies=FixedSourceRunDependencies(
            should_scan_fixed_sources=dependencies.should_scan_fixed_sources,
            scan_fixed_sources_for_subscription=(
                dependencies.scan_fixed_sources_for_subscription
            ),
            create_step_log=dependencies.create_step_log,
            log_background_event=dependencies.log_background_event,
            delete_subscription_with_records=(
                dependencies.delete_subscription_with_records
            ),
            apply_fixed_source_transfer_stats=(
                dependencies.apply_fixed_source_transfer_stats
            ),
            apply_cleanup_stats=dependencies.apply_cleanup_stats,
        ),
    )

    return SubscriptionTransferPhaseResult(
        should_auto_download=should_auto_download,
        sub_saved_count=(
            auto_transfer_result.sub_saved_count
            + fixed_source_result.sub_saved_count_delta
        ),
        sub_failed_transfer_count=(
            auto_transfer_result.sub_failed_transfer_count
            + fixed_source_result.sub_failed_transfer_count_delta
        ),
        auto_transfer_result=auto_transfer_result,
        fixed_source_result=fixed_source_result,
    )
