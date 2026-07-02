from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

from app.core.database import async_session_maker
from app.core.timezone_utils import beijing_now
from app.models.models import ExecutionStatus, MediaType
from app.services.operation_log_service import operation_log_service
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
)
from app.services.subscriptions.fixed_source_scan import (
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)
from app.services.subscriptions.link_fallback_runtime_adapter import (
    auto_save_records_with_link_fallback_with_runtime_adapter,
    build_default_link_fallback_runtime_dependencies,
)
from app.services.subscriptions.pre_scan_cleanup_runtime_adapter import (
    build_default_pre_scan_cleanup_runtime_dependencies,
    evaluate_pre_scan_cleanup_with_runtime_adapter,
)
from app.services.subscriptions.execution_logs import (
    create_execution_log as create_subscription_execution_log,
    create_step_log as create_subscription_step_log,
    prune_step_logs as prune_subscription_step_logs,
)
from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
from app.services.subscriptions.run_loader import load_active_subscription_snapshots
from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)
from app.services.subscriptions.run_summary import normalize_subscription_channel
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
)


LogBackgroundEvent = Callable[..., Awaitable[None]]
CreateExecutionLog = Callable[..., Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
PruneStepLogs = Callable[[Any], Awaitable[None]]
LoadActiveSubscriptions = Callable[[Any], Awaitable[list[Any]]]
BuildHdhiveUnlockContext = Callable[[], dict[str, Any]]
ResolveSourceOrder = Callable[[str], list[str]]
SessionFactory = Callable[[], Any]
EvaluatePreScanCleanup = Callable[..., Awaitable[dict[str, Any]]]
FetchResources = Callable[
    ...,
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]
StoreNewResources = Callable[
    [Any, int, list[dict[str, Any]]],
    Awaitable[dict[str, Any]],
]
LoadRetryableRecords = Callable[[Any, int], Awaitable[list[Any]]]
LoadForceRetryRecords = Callable[[Any, int, list[str]], Awaitable[list[Any]]]
AutoSaveRecordsWithLinkFallback = Callable[..., Awaitable[dict[str, Any]]]
ShouldScanFixedSources = Callable[..., bool]
ScanFixedSourcesForSubscription = Callable[..., Awaitable[dict[str, Any]]]
DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[None]]
Now = Callable[[], datetime]
MakeRunId = Callable[[], str]
MakeResultLock = Callable[[], Any]
RunStart = Callable[..., Awaitable[Any]]
DispatchChecks = Callable[..., Awaitable[None]]
ProcessItem = Callable[..., Awaitable[None]]
FinalizeRun = Callable[..., Awaitable[Any]]


@dataclass(frozen=True, slots=True)
class RunChannelRuntimeDependencies:
    log_background_event: LogBackgroundEvent
    create_execution_log: CreateExecutionLog
    create_step_log: CreateStepLog
    prune_step_logs: PruneStepLogs
    load_active_subscriptions: LoadActiveSubscriptions
    build_hdhive_unlock_context: BuildHdhiveUnlockContext
    resolve_source_order: ResolveSourceOrder
    session_factory: SessionFactory
    evaluate_pre_scan_cleanup: EvaluatePreScanCleanup
    fetch_resources: FetchResources
    store_new_resources: StoreNewResources
    load_retryable_records: LoadRetryableRecords
    load_force_retry_records: LoadForceRetryRecords
    auto_save_records_with_link_fallback: AutoSaveRecordsWithLinkFallback
    should_scan_fixed_sources: ShouldScanFixedSources
    scan_fixed_sources_for_subscription: ScanFixedSourcesForSubscription
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    now: Now
    make_run_id: MakeRunId
    make_result_lock: MakeResultLock
    success_status: Any
    failed_status: Any
    partial_status: Any
    tv_media_type: Any
    run_start: RunStart
    dispatch_checks: DispatchChecks
    process_item: ProcessItem
    finalize_run: FinalizeRun


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


async def auto_save_records_with_link_fallback_with_default_runtime_dependencies(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    transfer_source: str,
    tv_missing_snapshot: dict[str, Any] | None = None,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    enable_link_refetch: bool = True,
) -> dict[str, Any]:
    return await auto_save_records_with_link_fallback_with_runtime_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        transfer_source=transfer_source,
        dependencies=build_default_link_fallback_runtime_dependencies(),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=enable_link_refetch,
    )


def build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
    create_step_log: CreateStepLog,
) -> EvaluatePreScanCleanup:
    async def evaluate_pre_scan_cleanup(
        db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
    ) -> dict[str, Any]:
        return await evaluate_pre_scan_cleanup_with_runtime_adapter(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_pre_scan_cleanup_runtime_dependencies(
                delete_subscription_with_records=delete_subscription_with_records,
                create_step_log=create_step_log,
            ),
        )

    return evaluate_pre_scan_cleanup


def build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
    create_step_log: CreateStepLog,
) -> ScanFixedSourcesForSubscription:
    async def scan_fixed_sources_for_subscription(
        db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
        tv_missing_snapshot: dict[str, Any] | None = None,
        force_auto_download: bool = False,
    ) -> dict[str, Any]:
        return await scan_fixed_sources_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_fixed_source_scan_runtime_dependencies(
                create_step_log=create_step_log,
            ),
            tv_missing_snapshot=tv_missing_snapshot,
            force_auto_download=force_auto_download,
        )

    return scan_fixed_sources_for_subscription


def build_default_run_channel_runtime_dependencies(
    *,
    create_execution_log: CreateExecutionLog | None = None,
    create_step_log: CreateStepLog | None = None,
    prune_step_logs: PruneStepLogs | None = None,
    evaluate_pre_scan_cleanup: EvaluatePreScanCleanup | None = None,
    fetch_resources: FetchResources | None = None,
    store_new_resources: StoreNewResources | None = None,
    build_hdhive_unlock_context: BuildHdhiveUnlockContext | None = None,
    resolve_source_order: ResolveSourceOrder | None = None,
    load_retryable_records: LoadRetryableRecords | None = None,
    load_force_retry_records: LoadForceRetryRecords | None = None,
    auto_save_records_with_link_fallback: (
        AutoSaveRecordsWithLinkFallback | None
    ) = None,
    should_scan_fixed_sources: ShouldScanFixedSources | None = None,
    scan_fixed_sources_for_subscription: (
        ScanFixedSourcesForSubscription | None
    ) = None,
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
) -> RunChannelRuntimeDependencies:
    resolved_create_execution_log = (
        create_execution_log
        if create_execution_log is not None
        else create_subscription_execution_log
    )
    resolved_create_step_log = (
        create_step_log
        if create_step_log is not None
        else create_subscription_step_log
    )
    resolved_prune_step_logs = (
        prune_step_logs
        if prune_step_logs is not None
        else prune_subscription_step_logs
    )

    return RunChannelRuntimeDependencies(
        log_background_event=operation_log_service.log_background_event,
        create_execution_log=resolved_create_execution_log,
        create_step_log=resolved_create_step_log,
        prune_step_logs=resolved_prune_step_logs,
        load_active_subscriptions=load_active_subscription_snapshots,
        build_hdhive_unlock_context=(
            build_hdhive_unlock_context
            if build_hdhive_unlock_context is not None
            else build_hdhive_unlock_context_with_runtime_adapter
        ),
        resolve_source_order=(
            resolve_source_order
            if resolve_source_order is not None
            else resolve_source_order_with_runtime_adapter
        ),
        session_factory=async_session_maker,
        evaluate_pre_scan_cleanup=(
            evaluate_pre_scan_cleanup
            if evaluate_pre_scan_cleanup is not None
            else build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
                delete_subscription_with_records,
                resolved_create_step_log,
            )
        ),
        fetch_resources=(
            fetch_resources
            if fetch_resources is not None
            else fetch_resources_with_default_runtime_dependencies
        ),
        store_new_resources=(
            store_new_resources
            if store_new_resources is not None
            else store_new_resources_with_runtime_adapter
        ),
        load_retryable_records=(
            load_retryable_records
            if load_retryable_records is not None
            else load_retryable_records_with_db_adapter
        ),
        load_force_retry_records=(
            load_force_retry_records
            if load_force_retry_records is not None
            else load_force_retry_records_with_db_adapter
        ),
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
            if auto_save_records_with_link_fallback is not None
            else auto_save_records_with_link_fallback_with_default_runtime_dependencies
        ),
        should_scan_fixed_sources=(
            should_scan_fixed_sources
            if should_scan_fixed_sources is not None
            else should_scan_fixed_sources_policy
        ),
        scan_fixed_sources_for_subscription=(
            scan_fixed_sources_for_subscription
            if scan_fixed_sources_for_subscription is not None
            else build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
                resolved_create_step_log
            )
        ),
        delete_subscription_with_records=delete_subscription_with_records,
        now=beijing_now,
        make_run_id=lambda: uuid4().hex,
        make_result_lock=asyncio.Lock,
        success_status=ExecutionStatus.SUCCESS,
        failed_status=ExecutionStatus.FAILED,
        partial_status=ExecutionStatus.PARTIAL,
        tv_media_type=MediaType.TV,
        run_start=start_subscription_run,
        dispatch_checks=dispatch_subscription_checks,
        process_item=process_subscription_item,
        finalize_run=finalize_subscription_run,
    )


async def run_channel_check_with_runtime_adapter(
    *,
    db: Any,
    channel: str,
    force_auto_download: bool,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None,
    concurrency: int,
    dependencies: RunChannelRuntimeDependencies,
) -> dict[str, Any]:
    normalized_channel = normalize_subscription_channel(channel)
    run_start = await dependencies.run_start(
        db=db,
        channel=normalized_channel,
        force_auto_download=force_auto_download,
        progress_callback=progress_callback,
        dependencies=SubscriptionRunStartDependencies(
            log_background_event=dependencies.log_background_event,
            create_step_log=dependencies.create_step_log,
            load_active_subscriptions=dependencies.load_active_subscriptions,
            build_hdhive_unlock_context=dependencies.build_hdhive_unlock_context,
            resolve_source_order=dependencies.resolve_source_order,
            now=dependencies.now,
            make_run_id=dependencies.make_run_id,
        ),
    )

    result_lock = dependencies.make_result_lock()

    async def process_subscription(sub: Any) -> None:
        await dependencies.process_item(
            sub=sub,
            run_id=run_start.run_id,
            channel=normalized_channel,
            force_auto_download=force_auto_download,
            hdhive_unlock_context=run_start.hdhive_unlock_context,
            source_order=run_start.source_order,
            result=run_start.result,
            result_lock=result_lock,
            progress_callback=progress_callback,
            tv_media_type=dependencies.tv_media_type,
            dependencies=SubscriptionItemProcessingDependencies(
                session_factory=dependencies.session_factory,
                create_step_log=dependencies.create_step_log,
                log_background_event=dependencies.log_background_event,
                evaluate_pre_scan_cleanup=dependencies.evaluate_pre_scan_cleanup,
                fetch_resources=dependencies.fetch_resources,
                store_new_resources=dependencies.store_new_resources,
                load_retryable_records=dependencies.load_retryable_records,
                load_force_retry_records=dependencies.load_force_retry_records,
                auto_save_records_with_link_fallback=(
                    dependencies.auto_save_records_with_link_fallback
                ),
                should_scan_fixed_sources=dependencies.should_scan_fixed_sources,
                scan_fixed_sources_for_subscription=(
                    dependencies.scan_fixed_sources_for_subscription
                ),
                delete_subscription_with_records=(
                    dependencies.delete_subscription_with_records
                ),
            ),
        )

    await dependencies.dispatch_checks(
        subscriptions=run_start.subscriptions,
        concurrency=concurrency,
        dependencies=SubscriptionRunDispatchDependencies(
            process_subscription=process_subscription,
        ),
    )

    await dependencies.finalize_run(
        db=db,
        channel=normalized_channel,
        run_id=run_start.run_id,
        result=run_start.result,
        started_at=run_start.started_at,
        hdhive_unlock_context=run_start.hdhive_unlock_context,
        success_status=dependencies.success_status,
        failed_status=dependencies.failed_status,
        partial_status=dependencies.partial_status,
        dependencies=RunFinalizeDependencies(
            log_background_event=dependencies.log_background_event,
            create_execution_log=dependencies.create_execution_log,
            create_step_log=dependencies.create_step_log,
            prune_step_logs=dependencies.prune_step_logs,
            now=dependencies.now,
        ),
    )
    return run_start.result
