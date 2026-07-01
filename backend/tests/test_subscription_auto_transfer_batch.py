from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchDependencies,
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)


ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 7, 2, 2, 30, 0)


def _statuses() -> AutoTransferBatchStatuses:
    return AutoTransferBatchStatuses(
        transferring="transferring",
        downloading="downloading",
        offline_submitted="offline_submitted",
        matched="matched",
        completed="completed",
        failed="failed",
    )


def _sub(media_type: MediaType = MediaType.MOVIE, **overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "id": 41,
        "title": "测试订阅",
        "poster_path": "/poster.jpg",
        "media_type": media_type,
        "tmdb_id": 1101,
        "tv_scope": "all",
        "tv_season_number": None,
        "tv_episode_start": None,
        "tv_episode_end": None,
        "tv_follow_mode": "missing",
        "tv_include_specials": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _record(
    record_id: int = 51,
    *,
    resource_url: str = "https://115.com/s/share?password=abcd",
    resource_type: str = "pan115",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=record_id,
        resource_name=f"资源 {record_id}",
        resource_url=resource_url,
        resource_type=resource_type,
        status="matched",
        completed_at=None,
        error_message="old error",
        file_id=None,
        offline_submitted_at=None,
        offline_status=None,
        offline_info_hash=None,
        offline_task_id=None,
    )


def _dependencies(**overrides: Any) -> AutoTransferBatchDependencies:
    values: dict[str, Any] = {
        "fetch_tv_missing_status": _unexpected_async,
        "create_step_log": _unexpected_async,
        "get_offline_folder_id": _unexpected_sync,
        "submit_offline_task": _unexpected_async,
        "emit_transfer_success": _unexpected_sync,
        "select_precise_missing_episode_files": _unexpected_sync,
        "extract_share_code": _unexpected_sync,
        "get_share_all_files_recursive": _unexpected_async,
        "save_share_files_directly": _unexpected_async,
        "save_share_directly": _unexpected_async,
        "apply_precise_postprocess_status": _unexpected_async,
        "notify_transfer_success": _unexpected_async,
        "trigger_archive_after_transfer": _unexpected_async,
        "log_operation": _unexpected_async,
        "now": lambda: NOW,
        "is_video_file": lambda filename: str(filename).endswith(".mkv"),
    }
    values.update(overrides)
    return AutoTransferBatchDependencies(**values)


@pytest.mark.asyncio
async def test_auto_transfer_batch_submits_share_record_and_returns_cleanup() -> None:
    logs: list[dict[str, Any]] = []
    save_calls: list[dict[str, Any]] = []
    operation_logs: list[dict[str, Any]] = []
    notifications: list[tuple[str, str, str, str, str | None]] = []
    archive_triggers: list[str] = []
    events: list[dict[str, Any]] = []
    record = _record()

    async def create_step_log(**kwargs: Any) -> None:
        logs.append(kwargs)

    async def save_share_directly(**kwargs: Any) -> dict[str, Any]:
        save_calls.append(kwargs)
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

    def emit_transfer_success(data: dict[str, Any]) -> None:
        events.append(data)

    result = await auto_save_resources_batch(
        sub=_sub(),
        records=[record],
        source="hdhive",
        parent_folder_id="parent-folder",
        quality_filter={"preferred_resolutions": ["1080p"]},
        statuses=_statuses(),
        dependencies=_dependencies(
            create_step_log=create_step_log,
            save_share_directly=save_share_directly,
            notify_transfer_success=notify_transfer_success,
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            log_operation=log_operation,
            emit_transfer_success=emit_transfer_success,
        ),
        trace_id="run-batch",
    )

    assert record.status == "completed"
    assert record.completed_at == NOW
    assert record.error_message is None
    assert record.file_id == "parent-folder"
    assert result == {
        "saved": 1,
        "failed": 0,
        "errors": [],
        "subscription_completed": True,
        "cleanup_step": "subscription_cleanup_transferred",
        "cleanup_message": "转存成功，已自动删除订阅",
        "cleanup_payload": {
            "source": "hdhive",
            "record_id": 51,
            "target_parent_id": "parent-folder",
            "save_mode": "direct",
        },
        "remaining_missing_count": None,
    }
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_item_start",
        "auto_transfer_item_done",
    ]
    assert logs[0]["payload"] == {
        "source": "hdhive",
        "record_id": 51,
        "resource_url": "https://115.com/s/share?password=abcd",
    }
    assert save_calls == [
        {
            "share_url": "https://115.com/s/share?password=abcd",
            "parent_id": "parent-folder",
            "receive_code": "abcd",
            "quality_filter": {"preferred_resolutions": ["1080p"]},
        }
    ]
    assert notifications == [
        ("测试订阅", "资源 51", "hdhive", "分享转存", "/poster.jpg")
    ]
    assert archive_triggers == ["subscription_transfer"]
    assert operation_logs[0]["trace_id"] == "run-batch"
    assert events == [
        {
            "subscription_id": 41,
            "title": "测试订阅",
            "source": "hdhive",
            "resource_name": "资源 51",
            "transfer_type": "share",
            "status": "success",
        }
    ]


@pytest.mark.asyncio
async def test_auto_transfer_batch_submits_offline_movie_and_stops() -> None:
    logs: list[dict[str, Any]] = []
    offline_calls: list[tuple[str, str]] = []
    events: list[dict[str, Any]] = []
    record = _record(
        resource_url="magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        resource_type="magnet",
    )
    skipped = _record(52)

    async def create_step_log(**kwargs: Any) -> None:
        logs.append(kwargs)

    async def submit_offline_task(url: str, folder_id: str) -> dict[str, Any]:
        offline_calls.append((url, folder_id))
        return {"data": {"task_id": "task-1"}}

    async def log_operation(**_kwargs: Any) -> None:
        return None

    def emit_transfer_success(data: dict[str, Any]) -> None:
        events.append(data)

    result = await auto_save_resources_batch(
        sub=_sub(),
        records=[record, skipped],
        source="pansou",
        parent_folder_id="parent-folder",
        quality_filter={},
        statuses=_statuses(),
        dependencies=_dependencies(
            create_step_log=create_step_log,
            get_offline_folder_id=lambda: "offline-folder",
            submit_offline_task=submit_offline_task,
            log_operation=log_operation,
            emit_transfer_success=emit_transfer_success,
        ),
        trace_id="run-offline",
    )

    assert result["saved"] == 1
    assert result["failed"] == 0
    assert result["subscription_completed"] is False
    assert result["remaining_missing_count"] is None
    assert record.status == "offline_submitted"
    assert record.offline_task_id == "task-1"
    assert skipped.status == "matched"
    assert offline_calls == [(record.resource_url, "offline-folder")]
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_item_start",
        "auto_transfer_offline_done",
    ]
    assert events[0]["transfer_type"] == "offline"


@pytest.mark.asyncio
async def test_auto_transfer_batch_records_ordinary_transfer_failure() -> None:
    logs: list[dict[str, Any]] = []
    operation_logs: list[dict[str, Any]] = []
    record = _record()

    async def create_step_log(**kwargs: Any) -> None:
        logs.append(kwargs)

    async def save_share_directly(**_kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("share expired")

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    result = await auto_save_resources_batch(
        sub=_sub(),
        records=[record],
        source="pansou",
        parent_folder_id="parent-folder",
        quality_filter={},
        statuses=_statuses(),
        dependencies=_dependencies(
            create_step_log=create_step_log,
            save_share_directly=save_share_directly,
            log_operation=log_operation,
        ),
        trace_id="run-failure",
    )

    assert result["saved"] == 0
    assert result["failed"] == 1
    assert result["errors"] == [
        {
            "source": "pansou",
            "subscription_id": 41,
            "title": "测试订阅",
            "resource": "资源 51",
            "error": "share expired",
        }
    ]
    assert record.status == "failed"
    assert record.error_message == "share expired"
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_item_start",
        "auto_transfer_try_next_link",
        "auto_transfer_item_failed",
    ]
    assert operation_logs[0]["action"] == "subscription.record.transfer_fail"
    assert operation_logs[0]["trace_id"] == "run-failure"


@pytest.mark.asyncio
async def test_auto_transfer_batch_uses_precise_tv_transfer_and_remaining_count() -> None:
    logs: list[dict[str, Any]] = []
    save_calls: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    record = _record()

    async def create_step_log(**kwargs: Any) -> None:
        logs.append(kwargs)

    def extract_share_code(share_link: str) -> str:
        assert share_link == "https://115.com/s/share?password=abcd"
        return "share"

    async def get_share_all_files_recursive(
        share_code: str,
        receive_code: str,
    ) -> list[dict[str, Any]]:
        assert (share_code, receive_code) == ("share", "abcd")
        return [{"fid": "f1", "name": "Show.S01E02.1080p.mkv"}]

    def select_precise_missing_episode_files(
        files: list[dict[str, Any]],
        *,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any],
        is_video_file: Any,
    ) -> SimpleNamespace:
        assert files == [{"fid": "f1", "name": "Show.S01E02.1080p.mkv"}]
        assert missing_episodes == {(1, 2), (1, 3)}
        assert quality_filter == {"preferred_resolutions": ["1080p"]}
        assert is_video_file("Show.S01E02.1080p.mkv") is True
        return SimpleNamespace(
            selected_items=[{"fid": "f1"}],
            selected_file_ids=["f1"],
            matched_pairs={(1, 2)},
            matched_missing_count=1,
            parsed_count=1,
            unparsed_video_count=0,
        )

    async def save_share_files_directly(**kwargs: Any) -> dict[str, Any]:
        save_calls.append(kwargs)
        return {"saved": True}

    async def apply_precise_postprocess_status(target: Any) -> dict[str, Any]:
        target.status = "completed"
        target.completed_at = NOW
        target.error_message = None
        return {"triggered": False, "reason": "archive_disabled"}

    async def notify_transfer_success(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def log_operation(**_kwargs: Any) -> None:
        return None

    def emit_transfer_success(data: dict[str, Any]) -> None:
        events.append(data)

    result = await auto_save_resources_batch(
        sub=_sub(MediaType.TV),
        records=[record],
        source="hdhive",
        parent_folder_id="parent-folder",
        quality_filter={"preferred_resolutions": ["1080p"]},
        statuses=_statuses(),
        dependencies=_dependencies(
            create_step_log=create_step_log,
            extract_share_code=extract_share_code,
            get_share_all_files_recursive=get_share_all_files_recursive,
            select_precise_missing_episode_files=select_precise_missing_episode_files,
            save_share_files_directly=save_share_files_directly,
            apply_precise_postprocess_status=apply_precise_postprocess_status,
            notify_transfer_success=notify_transfer_success,
            log_operation=log_operation,
            emit_transfer_success=emit_transfer_success,
            is_video_file=lambda filename: str(filename).endswith(".mkv"),
        ),
        tv_missing_snapshot={
            "status": "ok",
            "missing_episodes": [[1, 2], [1, 3]],
            "counts": {"aired": 3, "existing": 1},
        },
        trace_id="run-precise",
    )

    assert result["saved"] == 1
    assert result["failed"] == 0
    assert result["subscription_completed"] is False
    assert result["remaining_missing_count"] == 1
    assert record.status == "completed"
    assert save_calls == [
        {
            "share_url": "https://115.com/s/share?password=abcd",
            "file_ids": ["f1"],
            "parent_id": "parent-folder",
            "receive_code": "abcd",
        }
    ]
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_item_start",
        "tv_record_files_parsed",
        "tv_transfer_selected_done",
    ]
    assert events[0]["transfer_type"] == "precise"
    assert events[0]["selected_count"] == 1


@pytest.mark.asyncio
async def test_auto_transfer_batch_handles_already_received_without_failure() -> None:
    logs: list[dict[str, Any]] = []
    operation_logs: list[dict[str, Any]] = []
    record = _record()

    async def create_step_log(**kwargs: Any) -> None:
        logs.append(kwargs)

    async def save_share_directly(**_kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("already received")

    async def notify_transfer_success(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    result = await auto_save_resources_batch(
        sub=_sub(),
        records=[record],
        source="hdhive",
        parent_folder_id="parent-folder",
        quality_filter={},
        statuses=_statuses(),
        dependencies=_dependencies(
            create_step_log=create_step_log,
            save_share_directly=save_share_directly,
            notify_transfer_success=notify_transfer_success,
            log_operation=log_operation,
        ),
        trace_id="run-already",
    )

    assert result["saved"] == 1
    assert result["failed"] == 0
    assert result["errors"] == []
    assert result["subscription_completed"] is True
    assert result["cleanup_step"] == "subscription_cleanup_transferred"
    assert result["cleanup_message"] == "资源已在网盘中，已自动删除订阅"
    assert record.status == "completed"
    assert record.completed_at == NOW
    assert record.error_message is None
    assert [entry["step"] for entry in logs] == [
        "auto_transfer_item_start",
        "auto_transfer_item_done",
    ]
    assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
    assert operation_logs[0]["extra"]["reason"] == "already_received"


def test_auto_transfer_batch_module_stays_dependency_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_batch.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "Pan115Service" not in source
    assert "pan115_service" not in source
    assert "operation_log_service" not in source
    assert "media_postprocess_service" not in source
    assert "kafka_producer" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source


async def _unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected async dependency call")


def _unexpected_sync(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected sync dependency call")
