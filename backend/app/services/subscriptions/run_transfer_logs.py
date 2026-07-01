from __future__ import annotations

from typing import Any


def _transfer_labels(transfer_source: str) -> dict[str, str]:
    if transfer_source == "new":
        return {
            "suffix": "new",
            "start_step_message": "开始转存 {count} 个新资源",
            "start_action": "subscription.item.transfer_new_start",
            "start_event_message": "[{title}] 开始自动转存新资源 {count} 条",
            "done_step_message": "新资源转存完成",
            "done_action": "subscription.item.transfer_new_done",
            "done_event_message": "[{title}] 新资源转存完成",
        }
    if transfer_source == "retry":
        return {
            "suffix": "retry",
            "start_step_message": "开始重试之前失败的 {count} 个资源",
            "start_action": "subscription.item.transfer_retry_start",
            "start_event_message": "[{title}] 开始重试历史记录 {count} 条",
            "done_step_message": "重试完成",
            "done_action": "subscription.item.transfer_retry_done",
            "done_event_message": "[{title}] 历史重试完成",
        }
    raise ValueError(f"unknown transfer source: {transfer_source}")


def build_auto_transfer_start_step(
    transfer_source: str,
    record_count: int,
) -> dict[str, Any]:
    labels = _transfer_labels(transfer_source)
    return {
        "step": f"auto_transfer_{labels['suffix']}_start",
        "status": "info",
        "message": labels["start_step_message"].format(count=record_count),
    }


def build_auto_transfer_start_event_kwargs(
    *,
    transfer_source: str,
    subscription_id: int,
    subscription_title: str,
    trace_id: str,
    record_count: int,
) -> dict[str, Any]:
    labels = _transfer_labels(transfer_source)
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": labels["start_action"],
        "status": "info",
        "message": labels["start_event_message"].format(
            title=subscription_title,
            count=record_count,
        ),
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "count": record_count,
        },
    }


def build_auto_transfer_done_step(
    transfer_source: str,
    stats: dict[str, Any],
) -> dict[str, Any]:
    labels = _transfer_labels(transfer_source)
    saved = stats["saved"]
    failed = stats["failed"]
    return {
        "step": f"auto_transfer_{labels['suffix']}_done",
        "status": "success" if failed == 0 else "partial",
        "message": (
            f"{labels['done_step_message']}：成功 {saved} 条"
            + (f"，失败 {failed} 条" if failed else "")
        ),
    }


def build_auto_transfer_done_event_kwargs(
    *,
    transfer_source: str,
    subscription_id: int,
    subscription_title: str,
    trace_id: str,
    stats: dict[str, Any],
) -> dict[str, Any]:
    labels = _transfer_labels(transfer_source)
    saved = stats["saved"]
    failed = stats["failed"]
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": labels["done_action"],
        "status": "success" if failed == 0 else "warning",
        "message": (
            f"{labels['done_event_message'].format(title=subscription_title)}："
            f"成功 {saved} 条，失败 {failed} 条"
        ),
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "saved": saved,
            "failed": failed,
        },
    }


def build_auto_transfer_summary_step(
    *,
    sub_saved_count: int,
    sub_failed_transfer_count: int,
    new_record_count: int,
    retry_record_count: int,
) -> dict[str, Any]:
    return {
        "step": "auto_transfer_summary",
        "status": "success" if sub_failed_transfer_count == 0 else "partial",
        "message": (
            f"本轮转存汇总：成功 {sub_saved_count} 条"
            + (
                f"，失败 {sub_failed_transfer_count} 条"
                if sub_failed_transfer_count
                else ""
            )
            + f"（新资源 {new_record_count} 个"
            + (f"，重试 {retry_record_count} 个" if retry_record_count else "")
            + "）"
        ),
    }


def build_auto_transfer_skip_step() -> dict[str, Any]:
    return {
        "step": "auto_transfer_skip",
        "status": "info",
        "message": "未开启自动转存，已记录资源供手动处理",
    }
