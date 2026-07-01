from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any


ApplyPrecisePostprocessStatus = Callable[[Any], Awaitable[dict[str, Any]]]
NotifyTransferSuccess = Callable[[str, str, str, str, str | None], Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
LogOperation = Callable[..., Awaitable[None]]
Now = Callable[[], datetime]


@dataclass(frozen=True)
class AlreadyReceivedHandlingResult:
    saved_increment: int
    should_continue: bool
    should_stop: bool
    subscription_completed: bool
    cleanup_step: str
    cleanup_message: str
    cleanup_payload: dict[str, Any]


async def handle_already_received_transfer(
    *,
    sub: Any,
    record: Any,
    source: str,
    parent_folder_id: str,
    is_tv_subscription: bool,
    tv_missing_enabled: bool,
    completed_status: Any,
    now: Now,
    apply_precise_postprocess_status: ApplyPrecisePostprocessStatus,
    notify_transfer_success: NotifyTransferSuccess,
    create_step_log: CreateStepLog,
    log_operation: LogOperation,
    trace_id: str = "",
) -> AlreadyReceivedHandlingResult:
    if tv_missing_enabled and is_tv_subscription:
        archive_result = await apply_precise_postprocess_status(record)
    else:
        archive_result = {"triggered": False, "reason": "not_tv_precise"}
        record.status = completed_status
        record.completed_at = now()

    record.error_message = None
    await notify_transfer_success(
        sub.title,
        record.resource_name,
        source,
        "已在网盘（跳过重复）",
        getattr(sub, "poster_path", None),
    )
    await create_step_log(
        step="auto_transfer_item_done",
        status="success",
        message=f"资源已在网盘中，无需重复转存：{record.resource_name}",
        payload={
            "source": source,
            "record_id": record.id,
            "reason": "already_received",
            "archive_triggered": bool(archive_result.get("triggered")),
            "archive_skip_reason": archive_result.get("reason"),
        },
    )
    await log_operation(
        source_type="background_task",
        module="subscriptions",
        action="subscription.record.transfer_ok",
        status="success",
        message=f"[{sub.title}] [{source}] 资源已在网盘中：{record.resource_name}",
        trace_id=trace_id,
        extra={
            "subscription_id": sub.id,
            "record_id": record.id,
            "source": source,
            "reason": "already_received",
        },
    )

    if not is_tv_subscription:
        return AlreadyReceivedHandlingResult(
            saved_increment=1,
            should_continue=False,
            should_stop=True,
            subscription_completed=True,
            cleanup_step="subscription_cleanup_transferred",
            cleanup_message="资源已在网盘中，已自动删除订阅",
            cleanup_payload={
                "source": source,
                "record_id": record.id,
                "reason": "already_received",
                "target_parent_id": parent_folder_id,
                "save_mode": "direct",
            },
        )

    return AlreadyReceivedHandlingResult(
        saved_increment=1,
        should_continue=True,
        should_stop=False,
        subscription_completed=False,
        cleanup_step="",
        cleanup_message="",
        cleanup_payload={},
    )
