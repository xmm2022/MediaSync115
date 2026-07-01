from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.subscriptions.run_state import (
    build_initial_run_result,
    build_processing_progress_payload,
    build_start_progress_payload,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_initial_run_result_uses_existing_defaults() -> None:
    started_at = datetime(2026, 7, 2, 9, 30, 0)

    result = build_initial_run_result("hdhive", "run-1", started_at)

    assert result == {
        "channel": "hdhive",
        "run_id": "run-1",
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
        "started_at": "2026-07-02T09:30:00",
    }


def test_build_start_progress_payload_matches_existing_callback_shape() -> None:
    result: dict[str, Any] = {
        "channel": "all",
        "checked_count": 5,
        "processed_count": 2,
        "new_resource_count": 3,
        "auto_saved_count": 4,
        "auto_failed_count": 1,
        "auto_new_saved_count": 2,
        "auto_new_failed_count": 1,
        "auto_retry_saved_count": 2,
        "auto_retry_failed_count": 0,
        "failed_count": 1,
    }

    assert build_start_progress_payload(result) == {
        "channel": "all",
        "status": "running",
        "processed_count": 0,
        "checked_count": 5,
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


def test_build_processing_progress_payload_uses_current_result_counts() -> None:
    result: dict[str, Any] = {
        "channel": "tg",
        "checked_count": 8,
        "processed_count": 3,
        "new_resource_count": 6,
        "auto_saved_count": 4,
        "auto_failed_count": 2,
        "auto_new_saved_count": 3,
        "auto_new_failed_count": 1,
        "auto_retry_saved_count": 1,
        "auto_retry_failed_count": 1,
        "failed_count": 1,
    }

    assert build_processing_progress_payload(result) == {
        "channel": "tg",
        "status": "running",
        "processed_count": 3,
        "checked_count": 8,
        "new_resource_count": 6,
        "auto_saved_count": 4,
        "auto_failed_count": 2,
        "auto_new_saved_count": 3,
        "auto_new_failed_count": 1,
        "auto_retry_saved_count": 1,
        "auto_retry_failed_count": 1,
        "failed_count": 1,
        "message": "已处理 3/8 项订阅",
    }


def test_run_state_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_state.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
