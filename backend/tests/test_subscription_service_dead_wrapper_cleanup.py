from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_unreferenced_private_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_build_source_attempt_summary",
        "_allow_unlock_by_threshold",
        "_safe_int",
        "_should_stop_unlocking_on_message",
        "build_source_attempt_summary",
        "allow_unlock_by_threshold",
        "safe_int",
        "should_stop_unlocking_on_message",
    ):
        assert name not in source


def test_subscription_service_drops_run_start_default_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "_build_hdhive_unlock_context" not in source
    assert "_resolve_source_order" not in source
    assert "_prepare_hdhive_locked_resources" not in source
    assert "build_hdhive_unlock_context_with_runtime_adapter" not in source
    assert "resolve_source_order_with_runtime_adapter" not in source
    assert "prepare_hdhive_locked_resources_with_runtime_adapter" not in source


def test_subscription_service_drops_record_loader_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_load_retryable_records",
        "_load_force_retry_records",
        "_load_subscription_resource_urls",
        "load_retryable_records_with_db_adapter",
        "load_force_retry_records_with_db_adapter",
        "load_subscription_resource_urls_with_db_adapter",
    ):
        assert name not in source


def test_subscription_service_drops_link_fallback_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_auto_save_records_with_link_fallback",
        "auto_save_records_with_link_fallback_with_runtime_adapter",
        "build_default_link_fallback_runtime_dependencies",
    ):
        assert name not in source


def test_subscription_service_drops_auto_save_resources_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_auto_save_resources",
        "auto_save_resources_with_runtime_adapter",
        "build_default_auto_save_resources_runtime_dependencies",
        "DownloadRecord",
    ):
        assert name not in source


def test_subscription_service_drops_quality_filter_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_resolve_subscription_quality_filter",
        "resolve_subscription_quality_filter_with_runtime_adapter",
    ):
        assert name not in source


def test_subscription_service_drops_fixed_source_policy_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_should_scan_fixed_sources",
        "should_scan_fixed_sources_policy",
    ):
        assert name not in source


def test_subscription_service_drops_fixed_source_scan_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_scan_fixed_sources_for_subscription",
        "scan_fixed_sources_with_runtime_adapter",
        "build_default_fixed_source_scan_runtime_dependencies",
    ):
        assert name not in source


def test_subscription_service_drops_feiniu_status_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_check_feiniu_movie_status",
        "_check_feiniu_tv_missing_status",
        "check_feiniu_movie_status_with_runtime_adapter",
        "check_feiniu_tv_missing_status_with_runtime_adapter",
    ):
        assert name not in source
