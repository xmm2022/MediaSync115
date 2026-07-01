from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.subscription_cleanup_policy import (
    evaluate_tv_cleanup,
    has_upcoming_episodes_in_subscription_scope,
    normalize_tv_follow_mode,
)
from app.services.subscriptions.auto_transfer_already_received import (
    handle_already_received_transfer,
)
from app.services.subscriptions.auto_transfer_context import (
    build_auto_transfer_tv_missing_context,
)
from app.services.subscriptions.auto_transfer_failure import (
    handle_transfer_failure,
)
from app.services.subscriptions.auto_transfer_offline import (
    is_offline_transfer_record,
    submit_offline_transfer_record,
)
from app.services.subscriptions.auto_transfer_precise import (
    submit_precise_transfer_record,
)
from app.services.subscriptions.auto_transfer_share import (
    submit_share_transfer_record,
)
from app.services.subscriptions.resource_metadata import (
    is_already_received_error,
    split_share_link_and_receive_code,
)


FetchTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
CreateStepLog = Callable[..., Awaitable[None]]
SubmitOfflineTask = Callable[[str, str], Awaitable[dict[str, Any]]]
EmitTransferSuccess = Callable[[dict[str, Any]], None]
SelectPreciseMissingEpisodeFiles = Callable[..., Any]
GetShareAllFilesRecursive = Callable[[str, str], Awaitable[list[dict[str, Any]]]]
SaveShareFilesDirectly = Callable[..., Awaitable[Any]]
SaveShareDirectly = Callable[..., Awaitable[dict[str, Any]]]
ApplyPostprocessStatus = Callable[[Any], Awaitable[dict[str, Any]]]
NotifyTransferSuccess = Callable[[str, str, str, str, str | None], Awaitable[None]]
TriggerArchiveAfterTransfer = Callable[..., Awaitable[dict[str, Any] | None]]
LogOperation = Callable[..., Awaitable[None]]
Now = Callable[[], datetime]
VideoPredicate = Callable[[str], bool]


@dataclass(frozen=True)
class AutoTransferBatchStatuses:
    transferring: Any
    downloading: Any
    offline_submitted: Any
    matched: Any
    completed: Any
    failed: Any


@dataclass(frozen=True)
class AutoTransferBatchDependencies:
    fetch_tv_missing_status: FetchTvMissingStatus
    create_step_log: CreateStepLog
    get_offline_folder_id: Callable[[], str]
    submit_offline_task: SubmitOfflineTask
    emit_transfer_success: EmitTransferSuccess
    select_precise_missing_episode_files: SelectPreciseMissingEpisodeFiles
    extract_share_code: Callable[[str], str]
    get_share_all_files_recursive: GetShareAllFilesRecursive
    save_share_files_directly: SaveShareFilesDirectly
    save_share_directly: SaveShareDirectly
    apply_precise_postprocess_status: ApplyPostprocessStatus
    notify_transfer_success: NotifyTransferSuccess
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer
    log_operation: LogOperation
    now: Now
    is_video_file: VideoPredicate


async def auto_save_resources_batch(
    *,
    sub: Any,
    records: list[Any],
    source: str,
    parent_folder_id: str,
    quality_filter: dict[str, Any],
    statuses: AutoTransferBatchStatuses,
    dependencies: AutoTransferBatchDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    trace_id: str = "",
) -> dict[str, Any]:
    saved = 0
    failed = 0
    errors: list[dict[str, Any]] = []
    subscription_completed = False
    cleanup_step = ""
    cleanup_message = ""
    cleanup_payload: dict[str, Any] = {}

    tv_missing_context = await build_auto_transfer_tv_missing_context(
        sub=sub,
        tv_missing_snapshot=tv_missing_snapshot,
        fetch_tv_missing_status=dependencies.fetch_tv_missing_status,
        create_step_log=dependencies.create_step_log,
    )
    tv_missing_enabled = tv_missing_context.tv_missing_enabled
    missing_episodes = tv_missing_context.missing_episodes
    is_tv_subscription = tv_missing_context.is_tv_subscription

    for record in records:
        await dependencies.create_step_log(
            step="auto_transfer_item_start",
            status="info",
            message=f"正在处理资源：{record.resource_name}",
            payload={
                "source": source,
                "record_id": record.id,
                "resource_url": record.resource_url,
            },
        )
        try:
            if is_offline_transfer_record(record):
                offline_submission = await submit_offline_transfer_record(
                    sub=sub,
                    record=record,
                    source=source,
                    offline_folder_id=dependencies.get_offline_folder_id(),
                    downloading_status=statuses.downloading,
                    offline_submitted_status=statuses.offline_submitted,
                    now=dependencies.now,
                    submit_offline_task=dependencies.submit_offline_task,
                    log_operation=dependencies.log_operation,
                    create_step_log=dependencies.create_step_log,
                    emit_transfer_success=dependencies.emit_transfer_success,
                )
                saved += offline_submission.saved_increment
                if offline_submission.should_stop:
                    break
                continue

            share_link, receive_code = split_share_link_and_receive_code(
                record.resource_url
            )
            record.status = statuses.transferring
            if tv_missing_enabled and is_tv_subscription:
                precise_submission = await submit_precise_transfer_record(
                    sub=sub,
                    record=record,
                    source=source,
                    share_link=share_link,
                    receive_code=receive_code,
                    parent_folder_id=parent_folder_id,
                    quality_filter=quality_filter,
                    missing_episodes=missing_episodes,
                    matched_status=statuses.matched,
                    extract_share_code=dependencies.extract_share_code,
                    get_share_all_files_recursive=(
                        dependencies.get_share_all_files_recursive
                    ),
                    select_missing_episode_files=(
                        dependencies.select_precise_missing_episode_files
                    ),
                    save_share_files_directly=dependencies.save_share_files_directly,
                    apply_postprocess_status=(
                        dependencies.apply_precise_postprocess_status
                    ),
                    notify_transfer_success=dependencies.notify_transfer_success,
                    log_operation=dependencies.log_operation,
                    create_step_log=dependencies.create_step_log,
                    emit_transfer_success=dependencies.emit_transfer_success,
                    normalize_follow_mode=normalize_tv_follow_mode,
                    has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
                    evaluate_cleanup=evaluate_tv_cleanup,
                    is_video_file=dependencies.is_video_file,
                    trace_id=trace_id,
                )
                saved += precise_submission.saved_increment
                subscription_completed = precise_submission.subscription_completed
                cleanup_step = precise_submission.cleanup_step
                cleanup_message = precise_submission.cleanup_message
                cleanup_payload = precise_submission.cleanup_payload
                if precise_submission.should_continue:
                    continue
                if precise_submission.should_stop:
                    break
            else:
                share_submission = await submit_share_transfer_record(
                    sub=sub,
                    record=record,
                    source=source,
                    share_link=share_link,
                    receive_code=receive_code,
                    parent_folder_id=parent_folder_id,
                    quality_filter=quality_filter,
                    completed_status=statuses.completed,
                    now=dependencies.now,
                    save_share_directly=dependencies.save_share_directly,
                    notify_transfer_success=dependencies.notify_transfer_success,
                    trigger_archive_after_transfer=(
                        dependencies.trigger_archive_after_transfer
                    ),
                    log_operation=dependencies.log_operation,
                    create_step_log=dependencies.create_step_log,
                    emit_transfer_success=dependencies.emit_transfer_success,
                    trace_id=trace_id,
                )
                saved += share_submission.saved_increment
                subscription_completed = share_submission.subscription_completed
                cleanup_step = share_submission.cleanup_step
                cleanup_message = share_submission.cleanup_message
                cleanup_payload = share_submission.cleanup_payload
                if share_submission.should_stop:
                    break
        except Exception as exc:
            if is_already_received_error(str(exc)):
                already_received_result = await handle_already_received_transfer(
                    sub=sub,
                    record=record,
                    source=source,
                    parent_folder_id=parent_folder_id,
                    is_tv_subscription=is_tv_subscription,
                    tv_missing_enabled=tv_missing_enabled,
                    completed_status=statuses.completed,
                    now=dependencies.now,
                    apply_precise_postprocess_status=(
                        dependencies.apply_precise_postprocess_status
                    ),
                    notify_transfer_success=dependencies.notify_transfer_success,
                    create_step_log=dependencies.create_step_log,
                    log_operation=dependencies.log_operation,
                    trace_id=trace_id,
                )
                saved += already_received_result.saved_increment
                subscription_completed = (
                    already_received_result.subscription_completed
                )
                cleanup_step = already_received_result.cleanup_step
                cleanup_message = already_received_result.cleanup_message
                cleanup_payload = already_received_result.cleanup_payload
                if already_received_result.should_stop:
                    break
                if already_received_result.should_continue:
                    continue
            failure_result = await handle_transfer_failure(
                sub=sub,
                record=record,
                source=source,
                exc=exc,
                failed_status=statuses.failed,
                create_step_log=dependencies.create_step_log,
                log_operation=dependencies.log_operation,
                trace_id=trace_id,
            )
            failed += failure_result.failed_increment
            errors.append(failure_result.error_entry)

    return {
        "saved": saved,
        "failed": failed,
        "errors": errors,
        "subscription_completed": subscription_completed,
        "cleanup_step": cleanup_step,
        "cleanup_message": cleanup_message,
        "cleanup_payload": cleanup_payload,
        "remaining_missing_count": len(missing_episodes)
        if tv_missing_enabled
        else None,
    }
