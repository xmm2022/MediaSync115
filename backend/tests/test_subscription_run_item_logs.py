from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.run_item_logs import (
    build_fetch_done_event_kwargs,
    build_fetch_resources_summary_step,
    build_fetch_trace_step_log,
    build_store_done_event_kwargs,
    build_store_new_resources_step,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_fetch_trace_step_log_keeps_defaults_and_payload_policy() -> None:
    assert build_fetch_trace_step_log(
        {
            "step": "fetch_source_selected",
            "status": "success",
            "message": "命中来源",
            "payload": {"source": "pansou"},
        }
    ) == {
        "step": "fetch_source_selected",
        "status": "success",
        "message": "命中来源",
        "payload": {"source": "pansou"},
    }

    assert build_fetch_trace_step_log({"payload": ["not", "a", "dict"]}) == {
        "step": "fetch_trace",
        "status": "info",
        "message": "",
        "payload": None,
    }


def test_build_fetch_resources_summary_step_matches_current_shape() -> None:
    source_attempt_info = {
        "source_order": ["pansou", "tg"],
        "attempts": [{"source": "pansou", "status": "hit"}],
        "summary": "pansou 命中",
    }

    assert build_fetch_resources_summary_step(
        [{"name": "A"}, {"name": "B"}],
        source_attempt_info,
    ) == {
        "step": "fetch_resources_summary",
        "status": "success",
        "message": "搜索完成，找到 2 个可用资源",
        "payload": {
            "resource_count": 2,
            "source_order": ["pansou", "tg"],
            "attempts": [{"source": "pansou", "status": "hit"}],
            "summary": "pansou 命中",
        },
    }

    assert build_fetch_resources_summary_step([], {"summary": ""}) == {
        "step": "fetch_resources_summary",
        "status": "warning",
        "message": "本轮未找到新资源",
        "payload": {
            "resource_count": 0,
            "source_order": [],
            "attempts": [],
            "summary": "",
        },
    }


def test_build_fetch_done_event_kwargs_matches_current_shape() -> None:
    event = build_fetch_done_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        channel="all",
        trace_id="run-1",
        resources=[{"name": "A"}],
        fetch_trace=[
            {
                "step": "fetch_source_selected",
                "payload": {"source": "pansou"},
            },
            {
                "step": "fetch_source_selected",
                "payload": {},
            },
            {
                "step": "fetch_source_failed",
                "payload": {"source": "tg"},
            },
        ],
        source_attempt_info={"summary": "pansou 命中"},
    )

    assert event == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.fetch_done",
        "status": "success",
        "message": "[示例影片] pansou 命中",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "resource_count": 1,
            "sources_hit": ["pansou", "fetch_source_selected"],
            "source_attempt_summary": "pansou 命中",
        },
    }

    empty_event = build_fetch_done_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        channel="all",
        trace_id="run-2",
        resources=[],
        fetch_trace=[],
        source_attempt_info={"summary": "没有命中"},
    )
    assert empty_event["status"] == "warning"
    assert empty_event["extra"]["resource_count"] == 0
    assert empty_event["extra"]["sources_hit"] == []


def test_build_store_new_resources_step_matches_current_shape() -> None:
    store_stats = {
        "checked_count": 4,
        "duplicate_count": 2,
        "invalid_count": 1,
    }

    assert build_store_new_resources_step(store_stats, [{"id": 1}, {"id": 2}]) == {
        "step": "store_new_resources",
        "status": "info",
        "message": "发现 2 个新资源待处理",
        "payload": {
            "checked_count": 4,
            "new_count": 2,
            "duplicate_count": 2,
            "invalid_count": 1,
        },
    }

    assert build_store_new_resources_step(store_stats, [])["message"] == "未发现新资源"


def test_build_store_done_event_kwargs_matches_current_shape() -> None:
    event = build_store_done_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-1",
        created_records=[{"id": 1}, {"id": 2}],
        store_stats={"duplicate_count": 3, "invalid_count": 1},
    )

    assert event == {
        "source_type": "background_task",
        "module": "subscriptions",
        "action": "subscription.item.store_done",
        "status": "success",
        "message": "[示例影片] 资源入库：新增 2 条，重复 3 条，无效 1 条",
        "trace_id": "run-1",
        "extra": {
            "subscription_id": 42,
            "title": "示例影片",
            "new": 2,
            "dup": 3,
        },
    }

    empty_event = build_store_done_event_kwargs(
        subscription_id=42,
        subscription_title="示例影片",
        trace_id="run-2",
        created_records=[],
        store_stats={"duplicate_count": 0, "invalid_count": 0},
    )
    assert empty_event["status"] == "info"
    assert empty_event["message"] == "[示例影片] 资源入库：新增 0 条，重复 0 条，无效 0 条"


def test_run_item_logs_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_item_logs.py"
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
