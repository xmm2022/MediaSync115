from __future__ import annotations

from datetime import datetime
from typing import Any


def apply_hdhive_unlock_stats(
    result: dict[str, Any],
    unlock_stats: dict[str, Any],
) -> None:
    result["hdhive_unlock_attempted_count"] = int(
        unlock_stats.get("attempted") or 0
    )
    result["hdhive_unlock_success_count"] = int(unlock_stats.get("success") or 0)
    result["hdhive_unlock_failed_count"] = int(unlock_stats.get("failed") or 0)
    result["hdhive_unlock_skipped_count"] = int(unlock_stats.get("skipped") or 0)
    result["hdhive_unlock_points_spent"] = int(
        unlock_stats.get("points_spent") or 0
    )


def complete_run_result(
    result: dict[str, Any],
    *,
    status_value: str,
    message: str,
    finished_at: datetime,
) -> None:
    result["finished_at"] = finished_at.isoformat()
    result["status"] = status_value
    result["message"] = message


def build_run_finish_event_message(channel: str, result: dict[str, Any]) -> str:
    return (
        f"订阅检查任务完成（频道：{channel}）：检查 {result['checked_count']} 项，"
        f"新增资源 {result['new_resource_count']} 条，"
        f"转存成功 {result['auto_saved_count']} 条，转存失败 {result['auto_failed_count']} 条，"
        f"自动清理 {result['cleanup_deleted_count']} 项，"
        f"失败 {result['failed_count']} 项"
    )


def build_run_finish_event_extra(
    channel: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "channel": channel,
        "checked_count": result["checked_count"],
        "new_resource_count": result["new_resource_count"],
        "auto_saved_count": result["auto_saved_count"],
        "auto_failed_count": result["auto_failed_count"],
        "cleanup_deleted_count": result["cleanup_deleted_count"],
        "failed_count": result["failed_count"],
        "hdhive_unlock_attempted_count": result[
            "hdhive_unlock_attempted_count"
        ],
        "hdhive_unlock_success_count": result["hdhive_unlock_success_count"],
        "hdhive_unlock_points_spent": result["hdhive_unlock_points_spent"],
    }


def build_run_finish_step_payload(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "checked_count": result["checked_count"],
        "resource_checked_count": result["resource_checked_count"],
        "new_resource_count": result["new_resource_count"],
        "resource_duplicate_count": result["resource_duplicate_count"],
        "auto_saved_count": result["auto_saved_count"],
        "auto_failed_count": result["auto_failed_count"],
        "failed_count": result["failed_count"],
        "cleanup_deleted_count": result["cleanup_deleted_count"],
        "cleanup_movie_deleted_count": result["cleanup_movie_deleted_count"],
        "cleanup_tv_deleted_count": result["cleanup_tv_deleted_count"],
        "hdhive_unlock_attempted_count": result[
            "hdhive_unlock_attempted_count"
        ],
        "hdhive_unlock_success_count": result["hdhive_unlock_success_count"],
        "hdhive_unlock_failed_count": result["hdhive_unlock_failed_count"],
        "hdhive_unlock_skipped_count": result["hdhive_unlock_skipped_count"],
        "hdhive_unlock_points_spent": result["hdhive_unlock_points_spent"],
    }


def apply_run_finalize_error(
    result: dict[str, Any],
    *,
    summary_message: str,
    finalize_error: str,
    success_status_value: str,
    partial_status_value: str,
) -> None:
    result["errors"].append({"stage": "run_finalize", "error": finalize_error})
    result["finalize_error"] = finalize_error
    result["message"] = f"{summary_message}；收尾阶段异常: {finalize_error[:200]}"
    if result["status"] == success_status_value:
        result["status"] = partial_status_value


def build_run_finalize_failed_message(finalize_error: str) -> str:
    return f"写入执行日志失败：{finalize_error[:200]}"


def build_run_finalize_failed_payload(
    finalize_error: str,
    *,
    status_before_finalize: str,
) -> dict[str, Any]:
    return {
        "error": finalize_error[:500],
        "status_before_finalize": status_before_finalize,
    }
