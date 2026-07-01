from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.subscriptions.offline_transfer import (
    build_submitted_offline_metadata,
)


SubmitOfflineTask = Callable[[str, str], Awaitable[dict[str, Any]]]
LogOperation = Callable[..., Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
EmitTransferSuccess = Callable[[dict[str, Any]], None]
Now = Callable[[], datetime]


@dataclass(frozen=True)
class OfflineTransferSubmissionResult:
    saved_increment: int
    should_stop: bool


def is_offline_transfer_record(record: Any) -> bool:
    return str(getattr(record, "resource_type", "") or "") in {"magnet", "ed2k"}


async def submit_offline_transfer_record(
    *,
    sub: Any,
    record: Any,
    source: str,
    offline_folder_id: str,
    downloading_status: Any,
    offline_submitted_status: Any,
    now: Now,
    submit_offline_task: SubmitOfflineTask,
    log_operation: LogOperation,
    create_step_log: CreateStepLog,
    emit_transfer_success: EmitTransferSuccess,
) -> OfflineTransferSubmissionResult:
    record.status = downloading_status
    offline_result = await submit_offline_task(record.resource_url, offline_folder_id)
    offline_metadata = build_submitted_offline_metadata(
        offline_result, record.resource_url
    )
    record.status = offline_submitted_status
    record.offline_submitted_at = now()
    record.offline_status = "submitted"
    record.offline_info_hash = offline_metadata.info_hash
    record.offline_task_id = offline_metadata.task_id
    record.completed_at = None
    record.error_message = None
    record.file_id = offline_folder_id

    await log_operation(
        source_type="background_task",
        module="subscriptions",
        action="subscription.offline_transfer",
        status="success",
        message=(
            f"[{sub.title}] 离线下载已提交："
            f"{record.resource_name}（{record.resource_type}）"
        ),
        extra={
            "subscription_id": sub.id,
            "resource_type": record.resource_type,
            "source": source,
            "record_id": record.id,
            "offline_info_hash": record.offline_info_hash,
            "offline_task_id": record.offline_task_id,
        },
    )
    try:
        emit_transfer_success(
            {
                "subscription_id": sub.id,
                "title": sub.title,
                "source": source,
                "resource_name": record.resource_name,
                "transfer_type": "offline",
                "status": "offline_submitted",
            }
        )
    except Exception:
        pass
    await create_step_log(
        step="auto_transfer_offline_done",
        status="success",
        message=f"已提交离线下载，等待完成后自动入库：{record.resource_name}",
        payload={
            "source": source,
            "record_id": record.id,
            "resource_type": record.resource_type,
            "target_folder_id": offline_folder_id,
            "offline_info_hash": record.offline_info_hash,
            "offline_task_id": record.offline_task_id,
        },
    )
    return OfflineTransferSubmissionResult(
        saved_increment=1,
        should_stop=not _is_tv_subscription(sub),
    )


def _is_tv_subscription(sub: Any) -> bool:
    media_type = getattr(sub, "media_type", None)
    return str(getattr(media_type, "value", media_type) or "").lower() == "tv"
