from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any


SaveShareDirectly = Callable[..., Awaitable[dict[str, Any]]]
NotifyTransferSuccess = Callable[[str, str, str, str, str | None], Awaitable[None]]
TriggerArchiveAfterTransfer = Callable[..., Awaitable[dict[str, Any] | None]]
LogOperation = Callable[..., Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
EmitTransferSuccess = Callable[[dict[str, Any]], None]
Now = Callable[[], datetime]


@dataclass(frozen=True)
class ShareTransferSubmissionResult:
    saved_increment: int
    should_stop: bool
    subscription_completed: bool
    cleanup_step: str
    cleanup_message: str
    cleanup_payload: dict[str, Any]


async def submit_share_transfer_record(
    *,
    sub: Any,
    record: Any,
    source: str,
    share_link: str,
    receive_code: str,
    parent_folder_id: str,
    quality_filter: dict[str, Any],
    completed_status: Any,
    now: Now,
    save_share_directly: SaveShareDirectly,
    notify_transfer_success: NotifyTransferSuccess,
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer,
    log_operation: LogOperation,
    create_step_log: CreateStepLog,
    emit_transfer_success: EmitTransferSuccess,
    trace_id: str = "",
) -> ShareTransferSubmissionResult:
    await save_share_directly(
        share_url=share_link,
        parent_id=parent_folder_id,
        receive_code=receive_code,
        quality_filter=quality_filter,
    )
    record.status = completed_status
    record.completed_at = now()
    record.error_message = None
    record.file_id = parent_folder_id

    await notify_transfer_success(
        sub.title,
        record.resource_name,
        source,
        "分享转存",
        getattr(sub, "poster_path", None),
    )
    await trigger_archive_after_transfer(trigger="subscription_transfer")
    await create_step_log(
        step="auto_transfer_item_done",
        status="success",
        message=f"转存成功：{record.resource_name}",
        payload={
            "source": source,
            "record_id": record.id,
            "target_parent_id": parent_folder_id,
            "save_mode": "direct",
        },
    )
    await log_operation(
        source_type="background_task",
        module="subscriptions",
        action="subscription.record.transfer_ok",
        status="success",
        message=f"[{sub.title}] [{source}] 分享转存成功：{record.resource_name}",
        trace_id=trace_id,
        extra={
            "subscription_id": sub.id,
            "record_id": record.id,
            "source": source,
            "save_mode": "direct",
        },
    )
    try:
        emit_transfer_success(
            {
                "subscription_id": sub.id,
                "title": sub.title,
                "source": source,
                "resource_name": record.resource_name,
                "transfer_type": "share",
                "status": "success",
            }
        )
    except Exception:
        pass

    return ShareTransferSubmissionResult(
        saved_increment=1,
        should_stop=True,
        subscription_completed=True,
        cleanup_step="subscription_cleanup_transferred",
        cleanup_message="转存成功，已自动删除订阅",
        cleanup_payload={
            "source": source,
            "record_id": record.id,
            "target_parent_id": parent_folder_id,
            "save_mode": "direct",
        },
    )
