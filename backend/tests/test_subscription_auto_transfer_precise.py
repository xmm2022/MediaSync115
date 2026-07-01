from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.auto_transfer_precise import (
    submit_precise_transfer_record,
)


ROOT = Path(__file__).resolve().parents[2]


def _subscription() -> SimpleNamespace:
    return SimpleNamespace(
        id=61,
        title="测试剧集",
        poster_path="/tv.jpg",
        tv_follow_mode="missing",
        tmdb_id=1101,
    )


def _record() -> SimpleNamespace:
    return SimpleNamespace(
        id=71,
        resource_name="资源 C",
        resource_url="https://115.com/s/share",
        resource_type="pan115",
        status="transferring",
        completed_at=None,
        error_message="old error",
        file_id=None,
    )


def _selection(
    *,
    selected_file_ids: list[str],
    matched_pairs: set[tuple[int, int]],
) -> SimpleNamespace:
    return SimpleNamespace(
        selected_items=[{"fid": item} for item in selected_file_ids],
        selected_file_ids=selected_file_ids,
        matched_pairs=matched_pairs,
        matched_missing_count=len(matched_pairs),
        parsed_count=len(matched_pairs),
        unparsed_video_count=1,
    )


async def _submit(
    *,
    selected_file_ids: list[str] | None = None,
    matched_pairs: set[tuple[int, int]] | None = None,
    extracted_share_code: str = "abc123",
    event_raises: bool = False,
) -> tuple[
    Any,
    SimpleNamespace,
    set[tuple[int, int]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[tuple[str, str, str, str | None]],
    list[dict[str, Any]],
    list[tuple[int, Any]],
]:
    selected_file_ids = selected_file_ids if selected_file_ids is not None else ["f1"]
    matched_pairs = matched_pairs if matched_pairs is not None else {(1, 2)}
    missing_episodes = {(1, 2)}
    all_files = [
        {"fid": "f1", "name": "Show.S01E02.1080p.mkv"},
        {"fid": "f2", "name": "Show.Special.mkv"},
    ]
    save_calls: list[dict[str, Any]] = []
    operation_logs: list[dict[str, Any]] = []
    step_logs: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    notifications: list[tuple[str, str, str, str | None]] = []
    cleanup_calls: list[tuple[str, bool]] = []
    upcoming_calls: list[tuple[int, Any]] = []
    record = _record()

    def extract_share_code(share_link: str) -> str:
        assert share_link == "https://115.com/s/share"
        return extracted_share_code

    async def get_share_all_files_recursive(
        share_code: str, receive_code: str
    ) -> list[dict[str, Any]]:
        assert share_code == extracted_share_code
        assert receive_code == "abcd"
        return all_files

    def select_missing_episode_files(
        files: list[dict[str, Any]],
        *,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any],
        is_video_file: Any,
    ) -> SimpleNamespace:
        assert files == all_files
        assert missing_episodes == {(1, 2)}
        assert quality_filter == {"preferred_resolutions": ["1080p"]}
        assert is_video_file("Show.S01E02.mkv") is True
        return _selection(
            selected_file_ids=selected_file_ids,
            matched_pairs=matched_pairs,
        )

    async def save_share_files_directly(**kwargs: Any) -> dict[str, Any]:
        save_calls.append(kwargs)
        return {"state": True}

    async def apply_postprocess_status(target: Any) -> dict[str, Any]:
        assert target is record
        target.status = "completed"
        target.completed_at = datetime(2026, 7, 1, 23, 30, 0)
        target.error_message = None
        return {"triggered": False, "reason": "archive_disabled"}

    async def notify_transfer_success(
        title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None,
    ) -> None:
        notifications.append((title, resource_name, source, method, poster_path))

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    async def create_step_log(**kwargs: Any) -> None:
        step_logs.append(kwargs)

    def emit_transfer_success(data: dict[str, Any]) -> None:
        if event_raises:
            raise RuntimeError("event failed")
        events.append(data)

    def normalize_follow_mode(value: str) -> str:
        return value

    async def has_upcoming_episodes(tmdb_id: int, sub: Any) -> bool:
        upcoming_calls.append((tmdb_id, sub))
        return False

    def evaluate_cleanup(
        tv_missing_result: dict[str, Any],
        *,
        follow_mode: str,
        has_upcoming_episodes: bool,
    ) -> tuple[bool, str]:
        cleanup_calls.append((follow_mode, has_upcoming_episodes))
        assert tv_missing_result == {"status": "ok", "counts": {"missing": 0}}
        return True, "剧集缺集已补齐，已自动删除订阅"

    def is_video_file(filename: str) -> bool:
        return str(filename).endswith(".mkv")

    result = await submit_precise_transfer_record(
        sub=_subscription(),
        record=record,
        source="hdhive",
        share_link="https://115.com/s/share",
        receive_code="abcd",
        parent_folder_id="parent-folder",
        quality_filter={"preferred_resolutions": ["1080p"]},
        missing_episodes=missing_episodes,
        matched_status="matched",
        extract_share_code=extract_share_code,
        get_share_all_files_recursive=get_share_all_files_recursive,
        select_missing_episode_files=select_missing_episode_files,
        save_share_files_directly=save_share_files_directly,
        apply_postprocess_status=apply_postprocess_status,
        notify_transfer_success=notify_transfer_success,
        log_operation=log_operation,
        create_step_log=create_step_log,
        emit_transfer_success=emit_transfer_success,
        normalize_follow_mode=normalize_follow_mode,
        has_upcoming_episodes=has_upcoming_episodes,
        evaluate_cleanup=evaluate_cleanup,
        is_video_file=is_video_file,
        trace_id="run-precise",
    )
    return (
        result,
        record,
        missing_episodes,
        save_calls,
        operation_logs,
        step_logs,
        events,
        notifications,
        cleanup_calls,
        upcoming_calls,
    )


def test_submit_precise_transfer_record_transfers_selected_files_and_returns_cleanup() -> None:
    (
        result,
        record,
        missing_episodes,
        save_calls,
        operation_logs,
        step_logs,
        events,
        notifications,
        cleanup_calls,
        upcoming_calls,
    ) = asyncio.run(_submit())

    assert record.status == "completed"
    assert record.completed_at == datetime(2026, 7, 1, 23, 30, 0)
    assert record.error_message is None
    assert record.file_id == "parent-folder"
    assert missing_episodes == set()
    assert result.saved_increment == 1
    assert result.should_continue is False
    assert result.should_stop is True
    assert result.subscription_completed is True
    assert result.cleanup_step == "subscription_cleanup_tv_completed_after_transfer"
    assert result.cleanup_message == "剧集缺集已补齐，已自动删除订阅"
    assert result.cleanup_payload == {
        "source": "hdhive",
        "record_id": 71,
        "remaining_missing_count": 0,
        "target_parent_id": "parent-folder",
        "save_mode": "direct",
        "follow_mode": "missing",
    }
    assert save_calls == [
        {
            "share_url": "https://115.com/s/share",
            "file_ids": ["f1"],
            "parent_id": "parent-folder",
            "receive_code": "abcd",
        }
    ]
    assert notifications == [
        ("测试剧集", "资源 C", "hdhive", "精准转存", "/tv.jpg")
    ]
    assert step_logs[0]["step"] == "tv_record_files_parsed"
    assert step_logs[0]["payload"] == {
        "record_id": 71,
        "total_files": 2,
        "parsed_count": 1,
        "matched_missing_count": 1,
        "unparsed_video_count": 1,
        "remaining_missing_count": 1,
    }
    assert step_logs[1]["step"] == "tv_transfer_selected_done"
    assert step_logs[1]["payload"] == {
        "source": "hdhive",
        "record_id": 71,
        "selected_mode": "missing",
        "selected_count": 1,
        "remaining_missing_count": 0,
        "target_parent_id": "parent-folder",
        "save_mode": "direct",
        "archive_triggered": False,
        "archive_skip_reason": "archive_disabled",
    }
    assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
    assert operation_logs[0]["trace_id"] == "run-precise"
    assert operation_logs[0]["extra"] == {
        "subscription_id": 61,
        "record_id": 71,
        "source": "hdhive",
        "selected_count": 1,
        "remaining_missing": 0,
    }
    assert events == [
        {
            "subscription_id": 61,
            "title": "测试剧集",
            "source": "hdhive",
            "resource_name": "资源 C",
            "transfer_type": "precise",
            "status": "success",
            "selected_count": 1,
        }
    ]
    assert cleanup_calls == [("missing", False)]
    assert upcoming_calls == []


def test_submit_precise_transfer_record_skips_resource_without_missing_files() -> None:
    (
        result,
        record,
        missing_episodes,
        save_calls,
        _operation_logs,
        step_logs,
        events,
        _notifications,
        cleanup_calls,
        upcoming_calls,
    ) = asyncio.run(_submit(selected_file_ids=[], matched_pairs=set()))

    assert record.status == "matched"
    assert record.completed_at is None
    assert record.error_message is None
    assert record.file_id is None
    assert missing_episodes == {(1, 2)}
    assert result.saved_increment == 0
    assert result.should_continue is True
    assert result.should_stop is False
    assert result.subscription_completed is False
    assert result.cleanup_step == ""
    assert save_calls == []
    assert step_logs[1]["step"] == "tv_record_skip_no_missing"
    assert events == []
    assert cleanup_calls == []
    assert upcoming_calls == []


def test_submit_precise_transfer_record_rejects_invalid_share_link() -> None:
    with pytest.raises(ValueError, match="无效的分享链接，无法提取分享码"):
        asyncio.run(_submit(extracted_share_code=""))


def test_submit_precise_transfer_record_ignores_event_callback_errors() -> None:
    result, record, missing_episodes, *_rest = asyncio.run(_submit(event_raises=True))

    assert record.status == "completed"
    assert missing_episodes == set()
    assert result.saved_increment == 1
    assert result.should_stop is True


def test_auto_transfer_precise_module_does_not_import_service_runtime_or_db_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_transfer_precise.py"
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
