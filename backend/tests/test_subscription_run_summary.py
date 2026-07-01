from __future__ import annotations

from pathlib import Path

import pytest

from app.services.subscriptions.run_summary import (
    build_run_message,
    normalize_subscription_channel,
    resolve_run_status,
)


ROOT = Path(__file__).resolve().parents[2]


def test_normalize_subscription_channel_trims_lowercases_and_validates() -> None:
    assert normalize_subscription_channel(" HDHive ") == "hdhive"
    assert normalize_subscription_channel("ALL") == "all"

    with pytest.raises(ValueError, match="unsupported channel"):
        normalize_subscription_channel("bad")


def test_resolve_run_status_uses_processing_and_auto_transfer_failures() -> None:
    statuses = {
        "success_status": "success",
        "failed_status": "failed",
        "partial_status": "partial",
    }

    assert resolve_run_status(0, 3, 0, **statuses) == "success"
    assert resolve_run_status(3, 3, 0, **statuses) == "failed"
    assert resolve_run_status(1, 3, 0, **statuses) == "partial"
    assert resolve_run_status(0, 3, 1, **statuses) == "partial"


def test_build_run_message_reports_no_new_resources() -> None:
    assert (
        build_run_message(
            {
                "checked_count": 2,
                "new_resource_count": 0,
                "auto_saved_count": 0,
                "auto_failed_count": 0,
                "cleanup_deleted_count": 0,
                "failed_count": 0,
            }
        )
        == "共 2 个订阅，未发现新资源"
    )


def test_build_run_message_reports_all_optional_counts_in_order() -> None:
    assert (
        build_run_message(
            {
                "checked_count": 4,
                "new_resource_count": 3,
                "auto_saved_count": 2,
                "auto_failed_count": 1,
                "cleanup_deleted_count": 1,
                "failed_count": 1,
            }
        )
        == "共 4 个订阅，发现 3 个新资源，转存成功 2 个，转存失败 1 个，自动完成 1 个订阅，处理出错 1 个"
    )


def test_run_summary_module_does_not_import_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_summary.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
