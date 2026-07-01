from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.subscriptions.auto_transfer_already_received import (
    handle_already_received_transfer,
)


ROOT = Path(__file__).resolve().parents[2]


def _subscription() -> SimpleNamespace:
    return SimpleNamespace(
        id=71,
        title="测试订阅",
        poster_path="/poster.jpg",
    )


def _record() -> SimpleNamespace:
    return SimpleNamespace(
        id=81,
        resource_name="资源 D",
        status="transferring",
        completed_at=None,
        error_message="already received",
    )


async def _handle(
    *,
    is_tv_subscription: bool = False,
    tv_missing_enabled: bool = False,
) -> tuple[
    Any,
    SimpleNamespace,
    list[Any],
    list[tuple[str, str, str, str | None]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    record = _record()
    postprocess_calls: list[Any] = []
    notifications: list[tuple[str, str, str, str | None]] = []
    step_logs: list[dict[str, Any]] = []
    operation_logs: list[dict[str, Any]] = []

    async def apply_precise_postprocess_status(target: Any) -> dict[str, Any]:
        postprocess_calls.append(target)
        target.status = "archiving"
        target.completed_at = None
        return {"triggered": True, "reason": "archive_started"}

    async def notify_transfer_success(
        title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None,
    ) -> None:
        notifications.append((title, resource_name, source, method, poster_path))

    async def create_step_log(**kwargs: Any) -> None:
        step_logs.append(kwargs)

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    result = await handle_already_received_transfer(
        sub=_subscription(),
        record=record,
        source="hdhive",
        parent_folder_id="parent-folder",
        is_tv_subscription=is_tv_subscription,
        tv_missing_enabled=tv_missing_enabled,
        completed_status="completed",
        now=lambda: datetime(2026, 7, 1, 23, 45, 0),
        apply_precise_postprocess_status=apply_precise_postprocess_status,
        notify_transfer_success=notify_transfer_success,
        create_step_log=create_step_log,
        log_operation=log_operation,
        trace_id="run-already",
    )
    return result, record, postprocess_calls, notifications, step_logs, operation_logs


def test_handle_already_received_transfer_completes_non_tv_record_and_cleanup() -> None:
    result, record, postprocess_calls, notifications, step_logs, operation_logs = (
        asyncio.run(_handle())
    )

    assert record.status == "completed"
    assert record.completed_at == datetime(2026, 7, 1, 23, 45, 0)
    assert record.error_message is None
    assert result.saved_increment == 1
    assert result.should_stop is True
    assert result.should_continue is False
    assert result.subscription_completed is True
    assert result.cleanup_step == "subscription_cleanup_transferred"
    assert result.cleanup_message == "资源已在网盘中，已自动删除订阅"
    assert result.cleanup_payload == {
        "source": "hdhive",
        "record_id": 81,
        "reason": "already_received",
        "target_parent_id": "parent-folder",
        "save_mode": "direct",
    }
    assert postprocess_calls == []
    assert notifications == [
        ("测试订阅", "资源 D", "hdhive", "已在网盘（跳过重复）", "/poster.jpg")
    ]
    assert step_logs[0]["step"] == "auto_transfer_item_done"
    assert step_logs[0]["payload"] == {
        "source": "hdhive",
        "record_id": 81,
        "reason": "already_received",
        "archive_triggered": False,
        "archive_skip_reason": "not_tv_precise",
    }
    assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
    assert operation_logs[0]["trace_id"] == "run-already"
    assert operation_logs[0]["extra"] == {
        "subscription_id": 71,
        "record_id": 81,
        "source": "hdhive",
        "reason": "already_received",
    }


def test_handle_already_received_transfer_postprocesses_tv_precise_record() -> None:
    result, record, postprocess_calls, notifications, step_logs, operation_logs = (
        asyncio.run(_handle(is_tv_subscription=True, tv_missing_enabled=True))
    )

    assert record.status == "archiving"
    assert record.completed_at is None
    assert record.error_message is None
    assert result.saved_increment == 1
    assert result.should_continue is True
    assert result.should_stop is False
    assert result.subscription_completed is False
    assert result.cleanup_step == ""
    assert result.cleanup_message == ""
    assert result.cleanup_payload == {}
    assert postprocess_calls == [record]
    assert notifications == [
        ("测试订阅", "资源 D", "hdhive", "已在网盘（跳过重复）", "/poster.jpg")
    ]
    assert step_logs[0]["payload"] == {
        "source": "hdhive",
        "record_id": 81,
        "reason": "already_received",
        "archive_triggered": True,
        "archive_skip_reason": "archive_started",
    }
    assert operation_logs[0]["action"] == "subscription.record.transfer_ok"


def test_auto_transfer_already_received_module_does_not_import_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_already_received.py"
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
