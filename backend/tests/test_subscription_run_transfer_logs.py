from __future__ import annotations

from pathlib import Path

import pytest

from app.services.subscriptions.run_transfer_logs import (
    build_auto_transfer_done_event_kwargs,
    build_auto_transfer_done_step,
    build_auto_transfer_skip_step,
    build_auto_transfer_start_event_kwargs,
    build_auto_transfer_start_step,
    build_auto_transfer_summary_step,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_auto_transfer_start_step_matches_new_and_retry_messages() -> None:
    assert build_auto_transfer_start_step("new", 3) == {
        "step": "auto_transfer_new_start",
        "status": "info",
        "message": "开始转存 3 个新资源",
    }
    assert build_auto_transfer_start_step("retry", 2) == {
        "step": "auto_transfer_retry_start",
        "status": "info",
        "message": "开始重试之前失败的 2 个资源",
    }


def test_build_auto_transfer_start_event_kwargs_matches_current_shape() -> None:
    assert build_auto_transfer_start_event_kwargs(
        transfer_source="new",
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-1",
        record_count=3,
    ) == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.transfer_new_start",
        "status": "info",
        "message": "[示例影片] 开始自动转存新资源 3 条",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "count": 3,
        },
    }
    assert build_auto_transfer_start_event_kwargs(
        transfer_source="retry",
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-2",
        record_count=2,
    )["message"] == "[示例影片] 开始重试历史记录 2 条"


def test_build_auto_transfer_done_step_matches_status_and_messages() -> None:
    assert build_auto_transfer_done_step("new", {"saved": 3, "failed": 0}) == {
        "step": "auto_transfer_new_done",
        "status": "success",
        "message": "新资源转存完成：成功 3 条",
    }
    assert build_auto_transfer_done_step("retry", {"saved": 1, "failed": 2}) == {
        "step": "auto_transfer_retry_done",
        "status": "partial",
        "message": "重试完成：成功 1 条，失败 2 条",
    }


def test_build_auto_transfer_done_event_kwargs_matches_current_shape() -> None:
    assert build_auto_transfer_done_event_kwargs(
        transfer_source="new",
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-1",
        stats={"saved": 3, "failed": 0},
    ) == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.transfer_new_done",
        "status": "success",
        "message": "[示例影片] 新资源转存完成：成功 3 条，失败 0 条",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "saved": 3,
            "failed": 0,
        },
    }
    retry_event = build_auto_transfer_done_event_kwargs(
        transfer_source="retry",
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-2",
        stats={"saved": 1, "failed": 2},
    )
    assert retry_event["action"] == "subscription.item.transfer_retry_done"
    assert retry_event["status"] == "warning"
    assert retry_event["message"] == "[示例影片] 历史重试完成：成功 1 条，失败 2 条"


def test_build_auto_transfer_summary_step_matches_current_format() -> None:
    assert build_auto_transfer_summary_step(
        sub_saved_count=5,
        sub_failed_transfer_count=0,
        new_record_count=3,
        retry_record_count=0,
    ) == {
        "step": "auto_transfer_summary",
        "status": "success",
        "message": "本轮转存汇总：成功 5 条（新资源 3 个）",
    }
    assert build_auto_transfer_summary_step(
        sub_saved_count=5,
        sub_failed_transfer_count=2,
        new_record_count=3,
        retry_record_count=4,
    ) == {
        "step": "auto_transfer_summary",
        "status": "partial",
        "message": "本轮转存汇总：成功 5 条，失败 2 条（新资源 3 个，重试 4 个）",
    }


def test_build_auto_transfer_skip_step_matches_current_shape() -> None:
    assert build_auto_transfer_skip_step() == {
        "step": "auto_transfer_skip",
        "status": "info",
        "message": "未开启自动转存，已记录资源供手动处理",
    }


def test_build_auto_transfer_logs_reject_unknown_transfer_source() -> None:
    with pytest.raises(ValueError, match="unknown transfer source"):
        build_auto_transfer_start_step("external", 1)


def test_run_transfer_logs_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_transfer_logs.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "app.api" not in source
