from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.run_lifecycle_logs import (
    build_subscription_auto_cleaned_event_kwargs,
    build_subscription_auto_cleaned_step,
    build_subscription_done_event_kwargs,
    build_subscription_done_step,
    build_subscription_failed_event_kwargs,
    build_subscription_failed_step,
    build_subscription_start_step,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_subscription_start_and_done_steps_match_current_shape() -> None:
    assert build_subscription_start_step("示例影片") == {
        "step": "subscription_start",
        "status": "info",
        "message": "正在检查「示例影片」的资源和入库状态",
    }
    assert build_subscription_auto_cleaned_step() == {
        "step": "subscription_done",
        "status": "success",
        "message": "订阅已自动清理",
    }
    assert build_subscription_done_step() == {
        "step": "subscription_done",
        "status": "success",
        "message": "订阅处理完成",
    }


def test_build_subscription_auto_cleaned_event_kwargs_matches_current_shape() -> None:
    assert build_subscription_auto_cleaned_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        channel="all",
        trace_id="run-1",
    ) == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.done",
        "status": "success",
        "message": "[示例影片] 订阅已自动清理（转存完成或已入库）",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "channel": "all",
        },
    }


def test_build_subscription_done_event_kwargs_matches_auto_download_shape() -> None:
    assert build_subscription_done_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        channel="all",
        trace_id="run-1",
        new_record_count=3,
        should_auto_download=True,
        sub_saved_count=2,
        sub_failed_transfer_count=1,
    ) == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.done",
        "status": "warning",
        "message": "[示例影片]，新资源 3 条，转存成功 2 条，失败 1 条",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "channel": "all",
            "new_resources": 3,
            "auto_saved": 2,
            "auto_failed": 1,
        },
    }


def test_build_subscription_done_event_kwargs_matches_manual_shape() -> None:
    event = build_subscription_done_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        channel="tg",
        trace_id="run-2",
        new_record_count=3,
        should_auto_download=False,
        sub_saved_count=0,
        sub_failed_transfer_count=0,
    )

    assert event["status"] == "success"
    assert event["message"] == "[示例影片]，新资源 3 条（未启用自动转存）"
    assert event["extra"] == {
        "subscription_id": 42,
        "title": "示例影片",
        "channel": "tg",
        "new_resources": 3,
        "auto_saved": None,
        "auto_failed": None,
    }


def test_build_subscription_failed_logs_truncate_errors() -> None:
    error = RuntimeError("x" * 600)
    error_text = str(error)

    assert build_subscription_failed_step(error) == {
        "step": "subscription_failed",
        "status": "failed",
        "message": f"处理出错：{error_text[:200]}",
    }

    event = build_subscription_failed_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        channel="all",
        trace_id="run-1",
        error=error,
    )
    assert event["source_type"] == "background_task"
    assert event["module"] == "subscriptions"
    assert event["action"] == "subscription.item.failed"
    assert event["status"] == "failed"
    assert event["message"] == f"[示例影片] 订阅处理失败: {error_text[:200]}"
    assert event["trace_id"] == "run-1"
    assert event["extra"] == {
        "subscription_id": 42,
        "title": "示例影片",
        "channel": "all",
        "error": error_text[:500],
    }


def test_run_lifecycle_logs_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_lifecycle_logs.py"
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
