from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.subscriptions.run_completion import (
    apply_hdhive_unlock_stats,
    build_run_finish_event_extra,
    build_run_finish_event_message,
    build_run_finish_step_payload,
    complete_run_result,
)


ROOT = Path(__file__).resolve().parents[2]


def _result() -> dict[str, Any]:
    return {
        "checked_count": 4,
        "resource_checked_count": 9,
        "new_resource_count": 3,
        "resource_duplicate_count": 2,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "failed_count": 1,
        "cleanup_deleted_count": 1,
        "cleanup_movie_deleted_count": 1,
        "cleanup_tv_deleted_count": 0,
        "hdhive_unlock_attempted_count": 5,
        "hdhive_unlock_success_count": 3,
        "hdhive_unlock_failed_count": 1,
        "hdhive_unlock_skipped_count": 1,
        "hdhive_unlock_points_spent": 9,
    }


def test_apply_hdhive_unlock_stats_casts_values_and_defaults_missing() -> None:
    result = _result()

    apply_hdhive_unlock_stats(
        result,
        {
            "attempted": "6",
            "success": 4,
            "failed": None,
            "points_spent": "12",
        },
    )

    assert result["hdhive_unlock_attempted_count"] == 6
    assert result["hdhive_unlock_success_count"] == 4
    assert result["hdhive_unlock_failed_count"] == 0
    assert result["hdhive_unlock_skipped_count"] == 0
    assert result["hdhive_unlock_points_spent"] == 12


def test_complete_run_result_writes_finish_status_and_message() -> None:
    result = _result()
    finished_at = datetime(2026, 7, 2, 10, 15, 30)

    complete_run_result(
        result,
        status_value="partial",
        message="共 4 个订阅，发现 3 个新资源",
        finished_at=finished_at,
    )

    assert result["finished_at"] == "2026-07-02T10:15:30"
    assert result["status"] == "partial"
    assert result["message"] == "共 4 个订阅，发现 3 个新资源"


def test_build_run_finish_event_message_matches_existing_format() -> None:
    assert build_run_finish_event_message("all", _result()) == (
        "订阅检查任务完成（频道：all）：检查 4 项，"
        "新增资源 3 条，"
        "转存成功 2 条，转存失败 1 条，"
        "自动清理 1 项，"
        "失败 1 项"
    )


def test_build_run_finish_event_extra_matches_existing_shape() -> None:
    assert build_run_finish_event_extra("all", _result()) == {
        "channel": "all",
        "checked_count": 4,
        "new_resource_count": 3,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "cleanup_deleted_count": 1,
        "failed_count": 1,
        "hdhive_unlock_attempted_count": 5,
        "hdhive_unlock_success_count": 3,
        "hdhive_unlock_points_spent": 9,
    }


def test_build_run_finish_step_payload_matches_existing_shape() -> None:
    assert build_run_finish_step_payload(_result()) == {
        "checked_count": 4,
        "resource_checked_count": 9,
        "new_resource_count": 3,
        "resource_duplicate_count": 2,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "failed_count": 1,
        "cleanup_deleted_count": 1,
        "cleanup_movie_deleted_count": 1,
        "cleanup_tv_deleted_count": 0,
        "hdhive_unlock_attempted_count": 5,
        "hdhive_unlock_success_count": 3,
        "hdhive_unlock_failed_count": 1,
        "hdhive_unlock_skipped_count": 1,
        "hdhive_unlock_points_spent": 9,
    }


def test_run_completion_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_completion.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
