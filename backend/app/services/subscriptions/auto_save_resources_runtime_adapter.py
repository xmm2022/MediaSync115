from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.timezone_utils import beijing_now
from app.models.models import MediaStatus
from app.services.media_postprocess_service import media_postprocess_service
from app.services.operation_log_service import operation_log_service
from app.services.pan115_service import Pan115Service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    RunAutoSaveResourcesBatch,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
from app.services.subscriptions.resource_metadata import is_video_filename
from app.services.subscriptions.tv_episode_selection import (
    select_missing_episode_files as select_tv_missing_episode_files,
)
from app.services.tv_missing_service import tv_missing_service


RunAutoSaveResourcesAdapter = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class AutoSaveResourcesRuntimeDependencies:
    get_pan115_cookie: Callable[[], str]
    create_pan_service: Callable[[str], Any]
    get_pan115_default_folder: Callable[[], dict[str, Any]]
    get_pan115_offline_folder: Callable[[], dict[str, Any]]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    emit_transfer_success_event: Callable[[int, dict[str, Any]], None]
    select_tv_missing_episode_files: Callable[..., Any]
    apply_precise_postprocess_status: Callable[[Any], Awaitable[dict[str, Any]]]
    notify_transfer_success: Callable[..., Awaitable[None]]
    trigger_archive_after_transfer: Callable[..., Awaitable[dict[str, Any] | None]]
    log_operation: Callable[..., Awaitable[None]]
    now: Callable[[], datetime]
    is_video_file: Callable[[str], bool]
    statuses: AutoTransferBatchStatuses
    run_adapter: RunAutoSaveResourcesAdapter
    run_batch: RunAutoSaveResourcesBatch


def emit_transfer_success_event(subscription_id: int, data: dict[str, Any]) -> None:
    from app.analytics import kafka_producer

    if kafka_producer._enabled:
        kafka_producer.send(
            event_type="transfer_success",
            data=data,
            key=str(subscription_id),
        )


def build_default_auto_save_resources_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]],
    create_step_log: Callable[..., Awaitable[None]],
    apply_precise_postprocess_status: Callable[[Any], Awaitable[dict[str, Any]]],
    notify_transfer_success: Callable[..., Awaitable[None]],
) -> AutoSaveResourcesRuntimeDependencies:
    return AutoSaveResourcesRuntimeDependencies(
        get_pan115_cookie=runtime_settings_service.get_pan115_cookie,
        create_pan_service=Pan115Service,
        get_pan115_default_folder=runtime_settings_service.get_pan115_default_folder,
        get_pan115_offline_folder=runtime_settings_service.get_pan115_offline_folder,
        resolve_quality_filter=resolve_quality_filter,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        create_step_log=create_step_log,
        emit_transfer_success_event=emit_transfer_success_event,
        select_tv_missing_episode_files=select_tv_missing_episode_files,
        apply_precise_postprocess_status=apply_precise_postprocess_status,
        notify_transfer_success=notify_transfer_success,
        trigger_archive_after_transfer=(
            media_postprocess_service.trigger_archive_after_transfer
        ),
        log_operation=operation_log_service.log_background_event,
        now=beijing_now,
        is_video_file=is_video_filename,
        statuses=AutoTransferBatchStatuses(
            transferring=MediaStatus.TRANSFERRING,
            downloading=MediaStatus.DOWNLOADING,
            offline_submitted=MediaStatus.OFFLINE_SUBMITTED,
            matched=MediaStatus.MATCHED,
            completed=MediaStatus.COMPLETED,
            failed=MediaStatus.FAILED,
        ),
        run_adapter=auto_save_resources_with_adapter,
        run_batch=auto_save_resources_batch,
    )


async def auto_save_resources_with_runtime_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    source: str,
    dependencies: AutoSaveResourcesRuntimeDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await dependencies.run_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        source=source,
        statuses=dependencies.statuses,
        dependencies=AutoSaveResourcesAdapterDependencies(
            get_pan115_cookie=dependencies.get_pan115_cookie,
            create_pan_service=dependencies.create_pan_service,
            get_pan115_default_folder=dependencies.get_pan115_default_folder,
            get_pan115_offline_folder=dependencies.get_pan115_offline_folder,
            resolve_quality_filter=dependencies.resolve_quality_filter,
            get_tv_missing_status=dependencies.get_tv_missing_status,
            create_step_log=dependencies.create_step_log,
            emit_transfer_success=dependencies.emit_transfer_success_event,
            select_tv_missing_episode_files=(
                dependencies.select_tv_missing_episode_files
            ),
            apply_precise_postprocess_status=(
                dependencies.apply_precise_postprocess_status
            ),
            notify_transfer_success=dependencies.notify_transfer_success,
            trigger_archive_after_transfer=(
                dependencies.trigger_archive_after_transfer
            ),
            log_operation=dependencies.log_operation,
            now=dependencies.now,
            is_video_file=dependencies.is_video_file,
            run_batch=dependencies.run_batch,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
    )
