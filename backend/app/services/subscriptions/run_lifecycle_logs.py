from __future__ import annotations

from typing import Any


def build_subscription_start_step(subscription_title: str) -> dict[str, Any]:
    return {
        "step": "subscription_start",
        "status": "info",
        "message": f"正在检查「{subscription_title}」的资源和入库状态",
    }


def build_subscription_auto_cleaned_step() -> dict[str, Any]:
    return {
        "step": "subscription_done",
        "status": "success",
        "message": "订阅已自动清理",
    }


def build_subscription_auto_cleaned_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    channel: str,
    trace_id: str,
) -> dict[str, Any]:
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.done",
        "status": "success",
        "message": f"[{subscription_title}] 订阅已自动清理（转存完成或已入库）",
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "channel": channel,
        },
    }


def build_subscription_done_step() -> dict[str, Any]:
    return {
        "step": "subscription_done",
        "status": "success",
        "message": "订阅处理完成",
    }


def build_subscription_done_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    channel: str,
    trace_id: str,
    new_record_count: int,
    should_auto_download: bool,
    sub_saved_count: int,
    sub_failed_transfer_count: int,
) -> dict[str, Any]:
    item_parts = [f"[{subscription_title}]"]
    if should_auto_download:
        item_parts.append(
            f"新资源 {new_record_count} 条，"
            f"转存成功 {sub_saved_count} 条，失败 {sub_failed_transfer_count} 条"
        )
    else:
        item_parts.append(f"新资源 {new_record_count} 条（未启用自动转存）")
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.done",
        "status": "success" if sub_failed_transfer_count == 0 else "warning",
        "message": "，".join(item_parts),
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "channel": channel,
            "new_resources": new_record_count,
            "auto_saved": sub_saved_count if should_auto_download else None,
            "auto_failed": (
                sub_failed_transfer_count if should_auto_download else None
            ),
        },
    }


def build_subscription_failed_step(error: BaseException) -> dict[str, Any]:
    error_text = str(error)
    return {
        "step": "subscription_failed",
        "status": "failed",
        "message": f"处理出错：{error_text[:200]}",
    }


def build_subscription_failed_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    channel: str,
    trace_id: str,
    error: BaseException,
) -> dict[str, Any]:
    error_text = str(error)
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.failed",
        "status": "failed",
        "message": f"[{subscription_title}] 订阅处理失败: {error_text[:200]}",
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "channel": channel,
            "error": error_text[:500],
        },
    }
