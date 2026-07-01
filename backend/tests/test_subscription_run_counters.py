from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.subscriptions.run_counters import (
    apply_auto_transfer_stats,
    apply_fixed_source_transfer_stats,
    apply_resource_store_stats,
    apply_subscription_failure,
    increment_processed_count,
    set_checked_count,
)


ROOT = Path(__file__).resolve().parents[2]


def _result() -> dict[str, Any]:
    return {
        "checked_count": 0,
        "processed_count": 0,
        "new_resource_count": 0,
        "resource_checked_count": 0,
        "resource_duplicate_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "failed_count": 0,
        "errors": [],
    }


def test_checked_and_processed_counters_update_existing_fields() -> None:
    result = _result()

    set_checked_count(result, 3)
    increment_processed_count(result)
    increment_processed_count(result)

    assert result["checked_count"] == 3
    assert result["processed_count"] == 2


def test_apply_resource_store_stats_accumulates_current_store_shape() -> None:
    result = _result()

    apply_resource_store_stats(
        result,
        {
            "created_records": [object(), object()],
            "checked_count": "5",
            "duplicate_count": "2",
        },
    )

    assert result["new_resource_count"] == 2
    assert result["resource_checked_count"] == 5
    assert result["resource_duplicate_count"] == 2


def test_apply_auto_transfer_stats_tracks_new_source_and_errors() -> None:
    result = _result()
    errors = [{"record_id": 1, "error": "failed"}]

    apply_auto_transfer_stats(
        result,
        {"saved": 2, "failed": 1, "errors": errors},
        transfer_source="new",
    )

    assert result["auto_saved_count"] == 2
    assert result["auto_failed_count"] == 1
    assert result["auto_new_saved_count"] == 2
    assert result["auto_new_failed_count"] == 1
    assert result["auto_retry_saved_count"] == 0
    assert result["auto_retry_failed_count"] == 0
    assert result["errors"] == errors


def test_apply_auto_transfer_stats_tracks_retry_source() -> None:
    result = _result()

    apply_auto_transfer_stats(
        result,
        {"saved": 1, "failed": 2, "errors": []},
        transfer_source="retry",
    )

    assert result["auto_saved_count"] == 1
    assert result["auto_failed_count"] == 2
    assert result["auto_new_saved_count"] == 0
    assert result["auto_new_failed_count"] == 0
    assert result["auto_retry_saved_count"] == 1
    assert result["auto_retry_failed_count"] == 2
    assert result["errors"] == []


def test_apply_fixed_source_transfer_stats_updates_total_transfer_counts() -> None:
    result = _result()

    apply_fixed_source_transfer_stats(result, saved=3, failed=1)

    assert result["auto_saved_count"] == 3
    assert result["auto_failed_count"] == 1
    assert result["auto_new_saved_count"] == 0
    assert result["auto_retry_saved_count"] == 0


def test_apply_subscription_failure_records_existing_error_shape() -> None:
    result = _result()

    apply_subscription_failure(
        result,
        subscription_id=12,
        title="测试订阅",
        error=RuntimeError("boom"),
    )

    assert result["failed_count"] == 1
    assert result["errors"] == [
        {
            "subscription_id": 12,
            "title": "测试订阅",
            "error": "boom",
        }
    ]


def test_run_counters_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_counters.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
