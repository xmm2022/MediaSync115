from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.run_cleanup_logs import (
    build_cleanup_after_transfer_event_kwargs,
    build_cleanup_after_transfer_step,
    build_fixed_source_movie_cleanup_event_kwargs,
    build_fixed_source_movie_cleanup_step,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_cleanup_after_transfer_event_kwargs_matches_current_shape() -> None:
    event = build_cleanup_after_transfer_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-1",
        cleanup_stats={
            "cleanup_step": "subscription_cleanup_movie",
            "cleanup_message": "电影已转存完成",
        },
    )

    assert event == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.cleanup_after_transfer",
        "status": "success",
        "message": "[示例影片] 转存完成后自动清理订阅：电影已转存完成",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "reason": "subscription_cleanup_movie",
        },
    }

    default_event = build_cleanup_after_transfer_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-2",
        cleanup_stats={},
    )
    assert default_event["message"] == "[示例影片] 转存完成后自动清理订阅：订阅已自动清理"
    assert default_event["extra"]["reason"] is None


def test_build_cleanup_after_transfer_step_keeps_defaults_and_payload_policy() -> None:
    assert build_cleanup_after_transfer_step(
        {
            "cleanup_step": "subscription_cleanup_tv",
            "cleanup_message": "剧集已补齐",
            "cleanup_payload": {"missing_count": 0},
        }
    ) == {
        "step": "subscription_cleanup_tv",
        "status": "success",
        "message": "剧集已补齐",
        "payload": {"missing_count": 0},
    }

    assert build_cleanup_after_transfer_step(
        {"cleanup_payload": ["not", "a", "dict"]}
    ) == {
        "step": "subscription_cleanup_after_transfer",
        "status": "success",
        "message": "订阅已自动清理",
        "payload": None,
    }


def test_build_fixed_source_movie_cleanup_event_kwargs_matches_current_shape() -> None:
    assert build_fixed_source_movie_cleanup_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-1",
    ) == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.cleanup_after_fixed_source",
        "status": "success",
        "message": "[示例影片] 电影固定来源转存完成，自动删除订阅",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "reason": "movie_fixed_source_transferred",
        },
    }


def test_build_fixed_source_movie_cleanup_step_matches_current_shape() -> None:
    assert build_fixed_source_movie_cleanup_step(3) == {
        "step": "subscription_cleanup_movie_fixed_source",
        "status": "success",
        "message": "电影固定来源转存完成，订阅已自动清理",
        "payload": {"fixed_saved": 3},
    }


def test_run_cleanup_logs_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_cleanup_logs.py"
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
