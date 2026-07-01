from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


CreateStepLog = Callable[..., Awaitable[None]]
LogOperation = Callable[..., Awaitable[None]]


@dataclass(frozen=True)
class TransferFailureHandlingResult:
    failed_increment: int
    error_entry: dict[str, Any]


async def handle_transfer_failure(
    *,
    sub: Any,
    record: Any,
    source: str,
    exc: Exception,
    failed_status: Any,
    create_step_log: CreateStepLog,
    log_operation: LogOperation,
    trace_id: str = "",
) -> TransferFailureHandlingResult:
    error_text = str(exc)
    record.status = failed_status
    record.error_message = error_text[:1000]
    await create_step_log(
        step="auto_transfer_try_next_link",
        status="info",
        message=f"链接转存失败，将尝试下一条资源：{error_text[:120]}",
        payload={
            "source": source,
            "record_id": record.id,
            "error": error_text[:300],
        },
    )
    await create_step_log(
        step="auto_transfer_item_failed",
        status="failed",
        message=f"转存失败：{record.resource_name}（{error_text[:100]}）",
        payload={
            "source": source,
            "record_id": record.id,
            "error": error_text[:500],
        },
    )
    await log_operation(
        source_type="background_task",
        module="subscriptions",
        action="subscription.record.transfer_fail",
        status="failed",
        message=f"[{sub.title}] [{source}] 转存失败：{record.resource_name}（{error_text[:200]}）",
        trace_id=trace_id,
        extra={
            "subscription_id": sub.id,
            "record_id": record.id,
            "source": source,
            "error": error_text[:300],
        },
    )
    return TransferFailureHandlingResult(
        failed_increment=1,
        error_entry={
            "source": source,
            "subscription_id": sub.id,
            "title": sub.title,
            "resource": record.resource_name,
            "error": error_text,
        },
    )
