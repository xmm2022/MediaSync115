from __future__ import annotations

from typing import Any


def build_fetch_trace_step_log(trace: dict[str, Any]) -> dict[str, Any]:
    payload = trace.get("payload")
    return {
        "step": str(trace.get("step") or "fetch_trace"),
        "status": str(trace.get("status") or "info"),
        "message": str(trace.get("message") or ""),
        "payload": payload if isinstance(payload, dict) else None,
    }


def build_fetch_resources_summary_step(
    resources: list[dict[str, Any]],
    source_attempt_info: dict[str, Any],
) -> dict[str, Any]:
    resource_count = len(resources)
    source_summary = source_attempt_info.get("summary", "")
    return {
        "step": "fetch_resources_summary",
        "status": "success" if resources else "warning",
        "message": (
            f"搜索完成，找到 {resource_count} 个可用资源"
            if resources
            else "本轮未找到新资源"
        ),
        "payload": {
            "resource_count": resource_count,
            "source_order": source_attempt_info.get("source_order", []),
            "attempts": source_attempt_info.get("attempts", []),
            "summary": source_summary,
        },
    }


def build_fetch_done_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    channel: str,
    trace_id: str,
    resources: list[dict[str, Any]],
    fetch_trace: list[dict[str, Any]],
    source_attempt_info: dict[str, Any],
) -> dict[str, Any]:
    _ = channel
    source_summary = source_attempt_info.get("summary", "")
    fetch_sources_tried = [
        trace.get("payload", {}).get("source", trace.get("step", ""))
        for trace in fetch_trace
        if trace.get("step") == "fetch_source_selected"
    ]
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.fetch_done",
        "status": "success" if resources else "warning",
        "message": f"[{subscription_title}] {source_summary}",
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "resource_count": len(resources),
            "sources_hit": fetch_sources_tried,
            "source_attempt_summary": source_summary,
        },
    }


def build_store_new_resources_step(
    store_stats: dict[str, Any],
    created_records: list[Any],
) -> dict[str, Any]:
    created_count = len(created_records)
    return {
        "step": "store_new_resources",
        "status": "info",
        "message": (
            f"发现 {created_count} 个新资源待处理"
            if created_records
            else "未发现新资源"
        ),
        "payload": {
            "checked_count": store_stats["checked_count"],
            "new_count": created_count,
            "duplicate_count": store_stats["duplicate_count"],
            "invalid_count": store_stats["invalid_count"],
        },
    }


def build_store_done_event_kwargs(
    *,
    subscription_id: int,
    subscription_title: str,
    trace_id: str,
    created_records: list[Any],
    store_stats: dict[str, Any],
) -> dict[str, Any]:
    created_count = len(created_records)
    duplicate_count = store_stats["duplicate_count"]
    invalid_count = store_stats["invalid_count"]
    return {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.store_done",
        "status": "success" if created_records else "info",
        "message": (
            f"[{subscription_title}] 资源入库：新增 {created_count} 条，"
            f"重复 {duplicate_count} 条，无效 {invalid_count} 条"
        ),
        "trace_id": trace_id,
        "extra": {
            "subscription_id": subscription_id,
            "title": subscription_title,
            "new": created_count,
            "dup": duplicate_count,
        },
    }
