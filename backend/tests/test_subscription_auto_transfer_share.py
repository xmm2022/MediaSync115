from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.subscriptions.auto_transfer_share import (
    submit_share_transfer_record,
)


ROOT = Path(__file__).resolve().parents[2]


def _subscription() -> SimpleNamespace:
    return SimpleNamespace(
        id=41,
        title="测试订阅",
        poster_path="/poster.jpg",
    )


def _record() -> SimpleNamespace:
    return SimpleNamespace(
        id=51,
        resource_name="资源 B",
        resource_url="https://115.com/s/share",
        resource_type="pan115",
        status="matched",
        completed_at=None,
        error_message="old error",
        file_id=None,
    )


async def _submit(*, event_raises: bool = False) -> tuple[
    Any,
    SimpleNamespace,
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[tuple[str, str, str, str | None]],
    list[str],
]:
    operation_logs: list[dict[str, Any]] = []
    step_logs: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    notifications: list[tuple[str, str, str, str | None]] = []
    archive_triggers: list[str] = []
    record = _record()

    async def save_share_directly(**kwargs: Any) -> dict[str, Any]:
        assert kwargs == {
            "share_url": "https://115.com/s/share",
            "parent_id": "parent-folder",
            "receive_code": "abcd",
            "quality_filter": {"preferred_resolutions": ["1080p"]},
        }
        return {"saved": True}

    async def notify_transfer_success(
        title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None,
    ) -> None:
        notifications.append((title, resource_name, source, method, poster_path))

    async def trigger_archive_after_transfer(trigger: str) -> dict[str, Any]:
        archive_triggers.append(trigger)
        return {"triggered": False}

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    async def create_step_log(**kwargs: Any) -> None:
        step_logs.append(kwargs)

    def emit_transfer_success(data: dict[str, Any]) -> None:
        if event_raises:
            raise RuntimeError("event failed")
        events.append(data)

    result = await submit_share_transfer_record(
        sub=_subscription(),
        record=record,
        source="hdhive",
        share_link="https://115.com/s/share",
        receive_code="abcd",
        parent_folder_id="parent-folder",
        quality_filter={"preferred_resolutions": ["1080p"]},
        completed_status="completed",
        now=lambda: datetime(2026, 7, 1, 23, 0, 0),
        save_share_directly=save_share_directly,
        notify_transfer_success=notify_transfer_success,
        trigger_archive_after_transfer=trigger_archive_after_transfer,
        log_operation=log_operation,
        create_step_log=create_step_log,
        emit_transfer_success=emit_transfer_success,
        trace_id="run-1",
    )
    return (
        result,
        record,
        operation_logs,
        step_logs,
        events,
        notifications,
        archive_triggers,
    )


def test_submit_share_transfer_record_updates_record_and_returns_cleanup_metadata() -> None:
    (
        result,
        record,
        operation_logs,
        step_logs,
        events,
        notifications,
        archive_triggers,
    ) = asyncio.run(_submit())

    assert record.status == "completed"
    assert record.completed_at == datetime(2026, 7, 1, 23, 0, 0)
    assert record.error_message is None
    assert record.file_id == "parent-folder"
    assert result.saved_increment == 1
    assert result.should_stop is True
    assert result.subscription_completed is True
    assert result.cleanup_step == "subscription_cleanup_transferred"
    assert result.cleanup_message == "转存成功，已自动删除订阅"
    assert result.cleanup_payload == {
        "source": "hdhive",
        "record_id": 51,
        "target_parent_id": "parent-folder",
        "save_mode": "direct",
    }

    assert notifications == [
        ("测试订阅", "资源 B", "hdhive", "分享转存", "/poster.jpg")
    ]
    assert archive_triggers == ["subscription_transfer"]
    assert step_logs[0]["step"] == "auto_transfer_item_done"
    assert step_logs[0]["payload"] == {
        "source": "hdhive",
        "record_id": 51,
        "target_parent_id": "parent-folder",
        "save_mode": "direct",
    }
    assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
    assert operation_logs[0]["trace_id"] == "run-1"
    assert operation_logs[0]["extra"] == {
        "subscription_id": 41,
        "record_id": 51,
        "source": "hdhive",
        "save_mode": "direct",
    }
    assert events == [
        {
            "subscription_id": 41,
            "title": "测试订阅",
            "source": "hdhive",
            "resource_name": "资源 B",
            "transfer_type": "share",
            "status": "success",
        }
    ]


def test_submit_share_transfer_record_ignores_event_callback_errors() -> None:
    result, record, _operation_logs, _step_logs, events, _notifications, _archive = (
        asyncio.run(_submit(event_raises=True))
    )

    assert record.status == "completed"
    assert result.saved_increment == 1
    assert result.should_stop is True
    assert events == []


def test_auto_transfer_share_module_does_not_import_service_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_share.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "operation_log_service" not in source
    assert "media_postprocess_service" not in source
    assert "kafka_producer" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
