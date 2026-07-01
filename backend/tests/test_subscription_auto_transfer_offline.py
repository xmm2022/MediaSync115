from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.services.subscriptions.auto_transfer_offline import (
    is_offline_transfer_record,
    submit_offline_transfer_record,
)


ROOT = Path(__file__).resolve().parents[2]


def _subscription(media_type: str = "movie") -> SimpleNamespace:
    return SimpleNamespace(id=21, title="测试订阅", media_type=media_type)


def _record(resource_type: str = "magnet") -> SimpleNamespace:
    return SimpleNamespace(
        id=31,
        resource_name="资源 A",
        resource_url=(
            "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
        ),
        resource_type=resource_type,
        status="matched",
        offline_submitted_at=None,
        offline_status=None,
        offline_info_hash=None,
        offline_task_id=None,
        completed_at="old",
        error_message="old error",
        file_id=None,
    )


async def _submit(
    *,
    sub: SimpleNamespace | None = None,
    record: SimpleNamespace | None = None,
) -> tuple[Any, SimpleNamespace, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    operation_logs: list[dict[str, Any]] = []
    step_logs: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    current_record = record or _record()

    async def submit_offline_task(url: str, folder_id: str) -> dict[str, Any]:
        assert url == current_record.resource_url
        assert folder_id == "offline-folder"
        return {"data": {"task_id": "task-1"}}

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    async def create_step_log(**kwargs: Any) -> None:
        step_logs.append(kwargs)

    def emit_transfer_success(data: dict[str, Any]) -> None:
        events.append(data)

    result = await submit_offline_transfer_record(
        sub=sub or _subscription(),
        record=current_record,
        source="pansou",
        offline_folder_id="offline-folder",
        downloading_status="downloading",
        offline_submitted_status="offline_submitted",
        now=lambda: datetime(2026, 7, 1, 22, 0, 0),
        submit_offline_task=submit_offline_task,
        log_operation=log_operation,
        create_step_log=create_step_log,
        emit_transfer_success=emit_transfer_success,
    )
    return result, current_record, operation_logs, step_logs, events


def test_is_offline_transfer_record_detects_magnet_and_ed2k_only() -> None:
    assert is_offline_transfer_record(_record("magnet"))
    assert is_offline_transfer_record(_record("ed2k"))
    assert not is_offline_transfer_record(_record("pan115"))
    assert not is_offline_transfer_record(_record(""))


def test_submit_offline_transfer_record_updates_movie_record_and_stops() -> None:
    result, record, operation_logs, step_logs, events = asyncio.run(_submit())

    assert record.status == "offline_submitted"
    assert record.offline_submitted_at == datetime(2026, 7, 1, 22, 0, 0)
    assert record.offline_status == "submitted"
    assert record.offline_info_hash == "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
    assert record.offline_task_id == "task-1"
    assert record.completed_at is None
    assert record.error_message is None
    assert record.file_id == "offline-folder"
    assert result.saved_increment == 1
    assert result.should_stop is True

    assert operation_logs[0]["action"] == "subscription.offline_transfer"
    assert operation_logs[0]["extra"]["offline_info_hash"] == record.offline_info_hash
    assert step_logs[0]["step"] == "auto_transfer_offline_done"
    assert step_logs[0]["payload"]["target_folder_id"] == "offline-folder"
    assert events == [
        {
            "subscription_id": 21,
            "title": "测试订阅",
            "source": "pansou",
            "resource_name": "资源 A",
            "transfer_type": "offline",
            "status": "offline_submitted",
        }
    ]


def test_submit_offline_transfer_record_continues_for_tv_subscription() -> None:
    result, record, _operation_logs, _step_logs, _events = asyncio.run(
        _submit(sub=_subscription("tv"))
    )

    assert record.status == "offline_submitted"
    assert result.saved_increment == 1
    assert result.should_stop is False


def test_auto_transfer_offline_module_does_not_import_service_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_offline.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "operation_log_service" not in source
    assert "kafka_producer" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
