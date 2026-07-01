from __future__ import annotations

from datetime import datetime
from typing import Any


def build_initial_run_result(
    channel: str,
    run_id: str,
    started_at: datetime,
) -> dict[str, Any]:
    return {
        "channel": channel,
        "run_id": run_id,
        "checked_count": 0,
        "processed_count": 0,
        "new_resource_count": 0,
        "failed_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "resource_checked_count": 0,
        "resource_duplicate_count": 0,
        "hdhive_unlock_attempted_count": 0,
        "hdhive_unlock_success_count": 0,
        "hdhive_unlock_failed_count": 0,
        "hdhive_unlock_skipped_count": 0,
        "hdhive_unlock_points_spent": 0,
        "cleanup_deleted_count": 0,
        "cleanup_movie_deleted_count": 0,
        "cleanup_tv_deleted_count": 0,
        "errors": [],
        "started_at": started_at.isoformat(),
    }


def build_start_progress_payload(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": result["channel"],
        "status": "running",
        "processed_count": 0,
        "checked_count": result["checked_count"],
        "new_resource_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "failed_count": 0,
        "message": "任务开始执行",
    }


def build_processing_progress_payload(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": result["channel"],
        "status": "running",
        "processed_count": result["processed_count"],
        "checked_count": result["checked_count"],
        "new_resource_count": result["new_resource_count"],
        "auto_saved_count": result["auto_saved_count"],
        "auto_failed_count": result["auto_failed_count"],
        "auto_new_saved_count": result["auto_new_saved_count"],
        "auto_new_failed_count": result["auto_new_failed_count"],
        "auto_retry_saved_count": result["auto_retry_saved_count"],
        "auto_retry_failed_count": result["auto_retry_failed_count"],
        "failed_count": result["failed_count"],
        "message": f"已处理 {result['processed_count']}/{result['checked_count']} 项订阅",
    }
