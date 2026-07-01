from __future__ import annotations

from typing import Any


def set_checked_count(result: dict[str, Any], checked_count: int) -> None:
    result["checked_count"] = checked_count


def increment_processed_count(result: dict[str, Any]) -> None:
    result["processed_count"] += 1


def apply_resource_store_stats(
    result: dict[str, Any],
    store_stats: dict[str, Any],
) -> None:
    result["new_resource_count"] += len(store_stats["created_records"])
    result["resource_checked_count"] += int(store_stats["checked_count"])
    result["resource_duplicate_count"] += int(store_stats["duplicate_count"])


def apply_auto_transfer_stats(
    result: dict[str, Any],
    auto_stats: dict[str, Any],
    *,
    transfer_source: str,
) -> None:
    saved = auto_stats["saved"]
    failed = auto_stats["failed"]
    result["auto_saved_count"] += saved
    result["auto_failed_count"] += failed
    if transfer_source == "new":
        result["auto_new_saved_count"] += saved
        result["auto_new_failed_count"] += failed
    elif transfer_source == "retry":
        result["auto_retry_saved_count"] += saved
        result["auto_retry_failed_count"] += failed
    else:
        raise ValueError("unsupported transfer source")
    if auto_stats["errors"]:
        result["errors"].extend(auto_stats["errors"])


def apply_fixed_source_transfer_stats(
    result: dict[str, Any],
    *,
    saved: int,
    failed: int,
) -> None:
    result["auto_saved_count"] += saved
    result["auto_failed_count"] += failed


def apply_subscription_failure(
    result: dict[str, Any],
    *,
    subscription_id: int,
    title: str,
    error: Exception,
) -> None:
    result["failed_count"] += 1
    result["errors"].append(
        {
            "subscription_id": subscription_id,
            "title": title,
            "error": str(error),
        }
    )
