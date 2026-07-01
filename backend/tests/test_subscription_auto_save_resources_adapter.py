from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_transfer_batch import AutoTransferBatchStatuses


ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 7, 2, 4, 40, 0)


class FakePanService:
    def __init__(self) -> None:
        self.offline_calls: list[dict[str, str]] = []
        self.recursive_calls: list[tuple[str, str]] = []
        self.save_files_calls: list[dict[str, Any]] = []
        self.save_share_calls: list[dict[str, Any]] = []

    async def offline_task_add(self, *, url: str, wp_path_id: str) -> dict[str, Any]:
        self.offline_calls.append({"url": url, "wp_path_id": wp_path_id})
        return {"task_id": "offline-task"}

    def pick_best_video_file(self, files: list[dict[str, Any]]) -> dict[str, Any]:
        return {"picked": files[0]["name"]}

    def _extract_share_code(self, url: str) -> str:
        return f"share:{url}"

    async def get_share_all_files_recursive(
        self, share_code: str, receive_code: str
    ) -> list[dict[str, Any]]:
        self.recursive_calls.append((share_code, receive_code))
        return [{"name": "episode.mkv"}]

    async def save_share_files_directly(self, **kwargs: Any) -> Any:
        self.save_files_calls.append(kwargs)
        return SimpleNamespace(saved=True)

    async def save_share_directly(self, **kwargs: Any) -> dict[str, Any]:
        self.save_share_calls.append(kwargs)
        return {"saved": True}


def _statuses() -> AutoTransferBatchStatuses:
    return AutoTransferBatchStatuses(
        transferring="transferring",
        downloading="downloading",
        offline_submitted="offline_submitted",
        matched="matched",
        completed="completed",
        failed="failed",
    )


def _sub() -> SimpleNamespace:
    return SimpleNamespace(id=41, title="测试订阅", tmdb_id=1101)


def _dependencies(**overrides: Any) -> AutoSaveResourcesAdapterDependencies:
    async def run_batch(**kwargs: Any) -> dict[str, Any]:
        return {"batch": kwargs}

    values: dict[str, Any] = {
        "get_pan115_cookie": lambda: "cookie-value",
        "create_pan_service": lambda _cookie: FakePanService(),
        "get_pan115_default_folder": lambda: {"folder_id": "parent-folder"},
        "get_pan115_offline_folder": lambda: {"folder_id": "offline-folder"},
        "resolve_quality_filter": lambda _sub: {"preferred_resolutions": ["1080p"]},
        "get_tv_missing_status": _unexpected_async,
        "create_step_log": _unexpected_async,
        "emit_transfer_success": _unexpected_sync,
        "select_tv_missing_episode_files": _unexpected_sync,
        "apply_precise_postprocess_status": _unexpected_async,
        "notify_transfer_success": _unexpected_async,
        "trigger_archive_after_transfer": _unexpected_async,
        "log_operation": _unexpected_async,
        "now": lambda: NOW,
        "is_video_file": lambda filename: str(filename).endswith(".mkv"),
        "run_batch": run_batch,
    }
    values.update(overrides)
    return AutoSaveResourcesAdapterDependencies(**values)


@pytest.mark.asyncio
async def test_auto_save_resources_adapter_builds_batch_call_and_context_dependencies() -> None:
    pan_service = FakePanService()
    created_cookies: list[str] = []
    batch_calls: list[dict[str, Any]] = []
    step_logs: list[dict[str, Any]] = []
    tv_calls: list[tuple[int, dict[str, Any]]] = []
    event_calls: list[tuple[int, dict[str, Any]]] = []
    selection_calls: list[dict[str, Any]] = []

    def create_pan_service(cookie: str) -> FakePanService:
        created_cookies.append(cookie)
        return pan_service

    async def run_batch(**kwargs: Any) -> dict[str, Any]:
        batch_calls.append(kwargs)
        return {"saved": 1, "failed": 0}

    async def create_step_log(db: Any, **kwargs: Any) -> None:
        step_logs.append({"db": db, **kwargs})

    async def get_tv_missing_status(tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
        tv_calls.append((tmdb_id, kwargs))
        return {"ok": True}

    def emit_transfer_success(subscription_id: int, data: dict[str, Any]) -> None:
        event_calls.append((subscription_id, data))

    def select_tv_missing_episode_files(
        files: list[dict[str, Any]], **kwargs: Any
    ) -> list[dict[str, Any]]:
        selection_calls.append({"files": files, **kwargs})
        return [{"name": "picked.mkv"}]

    result = await auto_save_resources_with_adapter(
        db="db",
        run_id="run-1",
        channel="all",
        sub=_sub(),
        records=[SimpleNamespace(id=51, resource_url="https://115.com/s/a")],
        source="new",
        statuses=_statuses(),
        dependencies=_dependencies(
            create_pan_service=create_pan_service,
            run_batch=run_batch,
            create_step_log=create_step_log,
            get_tv_missing_status=get_tv_missing_status,
            emit_transfer_success=emit_transfer_success,
            select_tv_missing_episode_files=select_tv_missing_episode_files,
        ),
        tv_missing_snapshot={"cached": True},
    )

    assert result == {"saved": 1, "failed": 0}
    assert created_cookies == ["cookie-value"]
    assert len(batch_calls) == 1

    batch_call = batch_calls[0]
    assert batch_call["sub"] == _sub()
    assert batch_call["source"] == "new"
    assert batch_call["parent_folder_id"] == "parent-folder"
    assert batch_call["quality_filter"] == {"preferred_resolutions": ["1080p"]}
    assert batch_call["statuses"] == _statuses()
    assert batch_call["tv_missing_snapshot"] == {"cached": True}
    assert batch_call["trace_id"] == "run-1"

    batch_dependencies = batch_call["dependencies"]
    await batch_dependencies.create_step_log(step="auto_transfer_item_start")
    assert step_logs == [
        {
            "db": "db",
            "run_id": "run-1",
            "channel": "all",
            "subscription_id": 41,
            "subscription_title": "测试订阅",
            "step": "auto_transfer_item_start",
        }
    ]

    await batch_dependencies.fetch_tv_missing_status(
        tmdb_id=999,
        include_unaired=True,
    )
    assert tv_calls == [(1101, {"include_unaired": True})]

    assert batch_dependencies.get_offline_folder_id() == "offline-folder"
    assert await batch_dependencies.submit_offline_task(
        "magnet:?xt=urn:btih:abc",
        "folder-2",
    ) == {"task_id": "offline-task"}
    assert pan_service.offline_calls == [
        {"url": "magnet:?xt=urn:btih:abc", "wp_path_id": "folder-2"}
    ]

    batch_dependencies.emit_transfer_success({"resource_name": "资源 51"})
    assert event_calls == [(41, {"resource_name": "资源 51"})]

    assert batch_dependencies.select_precise_missing_episode_files(
        [{"name": "episode.mkv"}],
        missing_episodes={(1, 1)},
        quality_filter={"preferred_resolutions": ["2160p"]},
        is_video_file=lambda filename: True,
    ) == [{"name": "picked.mkv"}]
    assert selection_calls[0]["best_picker"] == pan_service.pick_best_video_file

    assert batch_dependencies.extract_share_code("abc") == "share:abc"
    assert await batch_dependencies.get_share_all_files_recursive(
        "share-code",
        "receive-code",
    ) == [{"name": "episode.mkv"}]
    assert pan_service.recursive_calls == [("share-code", "receive-code")]


@pytest.mark.asyncio
async def test_auto_save_resources_adapter_wires_remaining_batch_dependencies() -> None:
    pan_service = FakePanService()
    batch_calls: list[dict[str, Any]] = []
    postprocess_calls: list[Any] = []
    notify_calls: list[tuple[Any, ...]] = []
    archive_calls: list[tuple[Any, ...]] = []
    operation_logs: list[dict[str, Any]] = []

    async def run_batch(**kwargs: Any) -> dict[str, Any]:
        batch_calls.append(kwargs)
        return {"saved": 0, "failed": 0}

    async def apply_precise_postprocess_status(record: Any) -> dict[str, Any]:
        postprocess_calls.append(record)
        return {"postprocessed": True}

    async def notify_transfer_success(*args: Any) -> None:
        notify_calls.append(args)

    async def trigger_archive_after_transfer(*args: Any) -> dict[str, Any]:
        archive_calls.append(args)
        return {"triggered": False}

    async def log_operation(**kwargs: Any) -> None:
        operation_logs.append(kwargs)

    await auto_save_resources_with_adapter(
        db=object(),
        run_id="run-2",
        channel="all",
        sub=_sub(),
        records=[],
        source="retry",
        statuses=_statuses(),
        dependencies=_dependencies(
            create_pan_service=lambda _cookie: pan_service,
            run_batch=run_batch,
            apply_precise_postprocess_status=apply_precise_postprocess_status,
            notify_transfer_success=notify_transfer_success,
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            log_operation=log_operation,
        ),
    )

    batch_dependencies = batch_calls[0]["dependencies"]
    record = SimpleNamespace(id=7)
    assert await batch_dependencies.apply_precise_postprocess_status(record) == {
        "postprocessed": True
    }
    await batch_dependencies.notify_transfer_success(
        "title",
        "resource",
        "source",
        "method",
        "/poster.jpg",
    )
    assert await batch_dependencies.trigger_archive_after_transfer(
        "subscription_transfer"
    ) == {"triggered": False}
    await batch_dependencies.log_operation(action="transfer.success")
    assert batch_dependencies.now() == NOW
    assert batch_dependencies.is_video_file("episode.mkv")
    assert not batch_dependencies.is_video_file("cover.jpg")

    assert postprocess_calls == [record]
    assert notify_calls == [
        ("title", "resource", "source", "method", "/poster.jpg")
    ]
    assert archive_calls == [("subscription_transfer",)]
    assert operation_logs == [{"action": "transfer.success"}]


def test_auto_save_resources_adapter_module_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_save_resources_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "kafka_producer" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source


async def _unexpected_async(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected async dependency call")


def _unexpected_sync(*_args: Any, **_kwargs: Any) -> Any:
    raise AssertionError("unexpected sync dependency call")
