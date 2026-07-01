from __future__ import annotations

from typing import Any


SUPPORTED_SUBSCRIPTION_CHANNELS = frozenset(
    {"pansou", "hdhive", "tg", "priority", "all"}
)


def normalize_subscription_channel(channel: str) -> str:
    normalized = str(channel or "").strip().lower()
    if normalized not in SUPPORTED_SUBSCRIPTION_CHANNELS:
        raise ValueError("unsupported channel")
    return normalized


def resolve_run_status(
    failed_count: int,
    checked_count: int,
    auto_failed_count: int,
    *,
    success_status: Any,
    failed_status: Any,
    partial_status: Any,
) -> Any:
    total_failed = failed_count + auto_failed_count
    if total_failed <= 0:
        return success_status
    if failed_count >= max(checked_count, 1):
        return failed_status
    return partial_status


def build_run_message(result: dict[str, Any]) -> str:
    parts = [
        f"共 {result['checked_count']} 个订阅",
    ]
    if result["new_resource_count"] > 0:
        parts.append(f"发现 {result['new_resource_count']} 个新资源")
    else:
        parts.append("未发现新资源")
    if result["auto_saved_count"] > 0:
        parts.append(f"转存成功 {result['auto_saved_count']} 个")
    if result["auto_failed_count"] > 0:
        parts.append(f"转存失败 {result['auto_failed_count']} 个")
    if result["cleanup_deleted_count"] > 0:
        parts.append(f"自动完成 {result['cleanup_deleted_count']} 个订阅")
    if result["failed_count"] > 0:
        parts.append(f"处理出错 {result['failed_count']} 个")
    return "，".join(parts)
