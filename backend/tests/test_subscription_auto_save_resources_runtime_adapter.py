from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    AutoSaveResourcesRuntimeDependencies,
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
    emit_transfer_success_event,
)
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
from app.services.subscriptions.execution_logs import (
    create_step_log as create_subscription_step_log,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    TransferNotificationRuntimeDependencies,
    notify_transfer_success_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
)


ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 7, 2, 7, 0, 0)


def _statuses() -> AutoTransferBatchStatuses:
    return AutoTransferBatchStatuses(
        transferring="transferring",
        downloading="downloading",
        offline_submitted="offline_submitted",
        matched="matched",
        completed="completed",
        failed="failed",
    )


def _dependencies(**overrides: Any) -> AutoSaveResourcesRuntimeDependencies:
    async def run_adapter(**kwargs: Any) -> dict[str, Any]:
        return {"adapter": kwargs}

    async def run_batch(**kwargs: Any) -> dict[str, Any]:
        return {"batch": kwargs}

    async def async_dependency(*_args: Any, **_kwargs: Any) -> Any:
        return {"ok": True}

    def sync_dependency(*_args: Any, **_kwargs: Any) -> Any:
        return {"ok": True}

    values: dict[str, Any] = {
        "get_pan115_cookie": lambda: "cookie-value",
        "create_pan_service": lambda cookie: {"cookie": cookie},
        "get_pan115_default_folder": lambda: {"folder_id": "parent-folder"},
        "get_pan115_offline_folder": lambda: {"folder_id": "offline-folder"},
        "resolve_quality_filter": lambda sub: {"title": sub.title},
        "get_tv_missing_status": async_dependency,
        "create_step_log": async_dependency,
        "emit_transfer_success_event": sync_dependency,
        "select_tv_missing_episode_files": sync_dependency,
        "apply_precise_postprocess_status": async_dependency,
        "notify_transfer_success": async_dependency,
        "trigger_archive_after_transfer": async_dependency,
        "log_operation": async_dependency,
        "now": lambda: NOW,
        "is_video_file": lambda filename: str(filename).endswith(".mkv"),
        "statuses": _statuses(),
        "run_adapter": run_adapter,
        "run_batch": run_batch,
    }
    values.update(overrides)
    return AutoSaveResourcesRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_lower_adapter_dependencies_and_forwards_arguments() -> None:
    sub = SimpleNamespace(id=41, title="测试订阅")
    records = [SimpleNamespace(id=51, resource_url="https://115.com/s/a")]
    tv_missing_snapshot = {"cached": True}
    statuses = _statuses()
    events: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
    adapter_calls: list[dict[str, Any]] = []

    async def get_tv_missing_status(*args: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("get_tv_missing_status", args, kwargs))
        return {"missing": False}

    async def create_step_log(*args: Any, **kwargs: Any) -> None:
        events.append(("create_step_log", args, kwargs))

    def emit_transfer_success_event(
        subscription_id: int,
        data: dict[str, Any],
    ) -> None:
        events.append(("emit_transfer_success_event", (subscription_id, data), {}))

    def select_tv_missing_episode_files(
        *args: Any,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        events.append(
            (
                "select_tv_missing_episode_files",
                args,
                {
                    "missing_episodes": kwargs["missing_episodes"],
                    "quality_filter": kwargs["quality_filter"],
                    "best_picker_result": kwargs["best_picker"](
                        [{"name": "episode.mkv"}]
                    ),
                    "is_video_file_result": kwargs["is_video_file"](
                        "episode.mkv"
                    ),
                },
            )
        )
        return [{"name": "picked.mkv"}]

    async def apply_precise_postprocess_status(record: Any) -> dict[str, Any]:
        events.append(("apply_precise_postprocess_status", (record,), {}))
        return {"postprocessed": True}

    async def notify_transfer_success(*args: Any) -> None:
        events.append(("notify_transfer_success", args, {}))

    async def trigger_archive_after_transfer(*args: Any) -> dict[str, Any]:
        events.append(("trigger_archive_after_transfer", args, {}))
        return {"triggered": False}

    async def log_operation(**kwargs: Any) -> None:
        events.append(("log_operation", (), kwargs))

    async def run_batch(**kwargs: Any) -> dict[str, Any]:
        events.append(("run_batch", (), kwargs))
        return {"saved": 0, "failed": 0}

    async def run_adapter(**kwargs: Any) -> dict[str, Any]:
        adapter_calls.append(kwargs)

        assert kwargs["db"] == "db"
        assert kwargs["run_id"] == "run-1"
        assert kwargs["channel"] == "all"
        assert kwargs["sub"] is sub
        assert kwargs["records"] is records
        assert kwargs["source"] == "new"
        assert kwargs["statuses"] is statuses
        assert kwargs["tv_missing_snapshot"] is tv_missing_snapshot

        lower_dependencies = kwargs["dependencies"]
        assert isinstance(lower_dependencies, AutoSaveResourcesAdapterDependencies)
        assert lower_dependencies.get_pan115_cookie() == "cookie-value"
        assert lower_dependencies.create_pan_service("cookie-value") == {
            "cookie": "cookie-value"
        }
        assert lower_dependencies.get_pan115_default_folder() == {
            "folder_id": "parent-folder"
        }
        assert lower_dependencies.get_pan115_offline_folder() == {
            "folder_id": "offline-folder"
        }
        assert lower_dependencies.resolve_quality_filter(sub) == {
            "preferred_resolutions": ["1080p"]
        }
        assert await lower_dependencies.get_tv_missing_status(
            1101,
            include_unaired=True,
        ) == {"missing": False}
        await lower_dependencies.create_step_log("db", step="auto_transfer")
        lower_dependencies.emit_transfer_success(41, {"resource_name": "资源 51"})
        assert lower_dependencies.select_tv_missing_episode_files(
            [{"name": "episode.mkv"}],
            missing_episodes={(1, 1)},
            quality_filter={"preferred_resolutions": ["2160p"]},
            best_picker=lambda files: files[0],
            is_video_file=lambda filename: True,
        ) == [{"name": "picked.mkv"}]
        record = SimpleNamespace(id=7)
        assert await lower_dependencies.apply_precise_postprocess_status(record) == {
            "postprocessed": True
        }
        await lower_dependencies.notify_transfer_success(
            "title",
            "resource",
            "source",
            "method",
            "/poster.jpg",
        )
        assert await lower_dependencies.trigger_archive_after_transfer(
            "subscription_transfer"
        ) == {"triggered": False}
        await lower_dependencies.log_operation(action="transfer.success")
        assert lower_dependencies.now() == NOW
        assert lower_dependencies.is_video_file("episode.mkv")
        assert not lower_dependencies.is_video_file("cover.jpg")
        assert await lower_dependencies.run_batch(sub=sub, records=records) == {
            "saved": 0,
            "failed": 0,
        }

        return {"saved": 1, "failed": 0}

    result = await auto_save_resources_with_runtime_adapter(
        db="db",
        run_id="run-1",
        channel="all",
        sub=sub,
        records=records,
        source="new",
        dependencies=_dependencies(
            get_pan115_default_folder=lambda: {"folder_id": "parent-folder"},
            get_pan115_offline_folder=lambda: {"folder_id": "offline-folder"},
            resolve_quality_filter=lambda _sub: {
                "preferred_resolutions": ["1080p"]
            },
            get_tv_missing_status=get_tv_missing_status,
            create_step_log=create_step_log,
            emit_transfer_success_event=emit_transfer_success_event,
            select_tv_missing_episode_files=select_tv_missing_episode_files,
            apply_precise_postprocess_status=apply_precise_postprocess_status,
            notify_transfer_success=notify_transfer_success,
            trigger_archive_after_transfer=trigger_archive_after_transfer,
            log_operation=log_operation,
            statuses=statuses,
            run_adapter=run_adapter,
            run_batch=run_batch,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
    )

    assert result == {"saved": 1, "failed": 0}
    assert len(adapter_calls) == 1
    assert events == [
        (
            "get_tv_missing_status",
            (1101,),
            {"include_unaired": True},
        ),
        ("create_step_log", ("db",), {"step": "auto_transfer"}),
        (
            "emit_transfer_success_event",
            (41, {"resource_name": "资源 51"}),
            {},
        ),
        (
            "select_tv_missing_episode_files",
            ([{"name": "episode.mkv"}],),
            {
                "missing_episodes": {(1, 1)},
                "quality_filter": {"preferred_resolutions": ["2160p"]},
                "best_picker_result": {"name": "episode.mkv"},
                "is_video_file_result": True,
            },
        ),
        ("apply_precise_postprocess_status", (SimpleNamespace(id=7),), {}),
        (
            "notify_transfer_success",
            ("title", "resource", "source", "method", "/poster.jpg"),
            {},
        ),
        ("trigger_archive_after_transfer", ("subscription_transfer",), {}),
        ("log_operation", (), {"action": "transfer.success"}),
        ("run_batch", (), {"sub": sub, "records": records}),
    ]


def test_default_runtime_dependencies_use_existing_statuses_and_runners() -> None:
    async def create_step_log(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def apply_precise_postprocess_status(_record: Any) -> dict[str, Any]:
        return {}

    async def notify_transfer_success(*_args: Any, **_kwargs: Any) -> None:
        return None

    def resolve_quality_filter(_sub: Any) -> dict[str, Any]:
        return {}

    dependencies = build_default_auto_save_resources_runtime_dependencies(
        resolve_quality_filter=resolve_quality_filter,
        create_step_log=create_step_log,
        apply_precise_postprocess_status=apply_precise_postprocess_status,
        notify_transfer_success=notify_transfer_success,
    )

    assert dependencies.statuses == AutoTransferBatchStatuses(
        transferring=MediaStatus.TRANSFERRING,
        downloading=MediaStatus.DOWNLOADING,
        offline_submitted=MediaStatus.OFFLINE_SUBMITTED,
        matched=MediaStatus.MATCHED,
        completed=MediaStatus.COMPLETED,
        failed=MediaStatus.FAILED,
    )
    assert dependencies.run_adapter is auto_save_resources_with_adapter
    assert dependencies.run_batch is auto_save_resources_batch
    assert dependencies.resolve_quality_filter is resolve_quality_filter
    assert dependencies.create_step_log is create_step_log
    assert (
        dependencies.apply_precise_postprocess_status
        is apply_precise_postprocess_status
    )
    assert dependencies.notify_transfer_success is notify_transfer_success


def test_default_runtime_dependencies_bind_runtime_helpers_without_service_callbacks() -> None:
    dependencies = build_default_auto_save_resources_runtime_dependencies()

    assert dependencies.resolve_quality_filter is (
        resolve_subscription_quality_filter_with_runtime_adapter
    )
    assert dependencies.create_step_log is create_subscription_step_log
    assert dependencies.apply_precise_postprocess_status is (
        apply_precise_transfer_postprocess_status_with_runtime_adapter
    )
    assert dependencies.notify_transfer_success is (
        notify_transfer_success_with_runtime_adapter
    )
    assert dependencies.run_adapter is auto_save_resources_with_adapter
    assert dependencies.run_batch is auto_save_resources_batch


@pytest.mark.asyncio
async def test_default_runtime_notify_callback_accepts_downstream_positional_poster() -> None:
    calls: list[dict[str, Any]] = []

    async def notify(message: str, *, poster_path: str | None = None) -> None:
        calls.append({"message": message, "poster_path": poster_path})

    def log_warning(message: str, **kwargs: Any) -> None:
        calls.append({"warning": message, "kwargs": kwargs})

    async def run_notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        *,
        poster_path: str | None = None,
        dependencies: Any,
    ) -> None:
        calls.append(
            {
                "sub_title": sub_title,
                "resource_name": resource_name,
                "source": source,
                "method": method,
                "poster_path": poster_path,
                "dependencies": dependencies,
            }
        )

    dependencies = build_default_auto_save_resources_runtime_dependencies()

    await dependencies.notify_transfer_success(
        "订阅 A",
        "资源 B",
        "hdhive",
        "分享转存",
        "/poster.jpg",
        dependencies=TransferNotificationRuntimeDependencies(
            notify=notify,
            log_warning=log_warning,
            run_notify_transfer_success=run_notify_transfer_success,
        ),
    )

    assert len(calls) == 1
    assert calls[0]["sub_title"] == "订阅 A"
    assert calls[0]["resource_name"] == "资源 B"
    assert calls[0]["source"] == "hdhive"
    assert calls[0]["method"] == "分享转存"
    assert calls[0]["poster_path"] == "/poster.jpg"
    assert isinstance(calls[0]["dependencies"], TransferNotificationDependencies)
    assert calls[0]["dependencies"].notify is notify
    assert calls[0]["dependencies"].log_warning is log_warning


def test_default_runtime_dependencies_preserve_falsy_explicit_injections() -> None:
    class FalsyCallable:
        def __bool__(self) -> bool:
            return False

        def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {}

    resolve_quality_filter = FalsyCallable()

    dependencies = build_default_auto_save_resources_runtime_dependencies(
        resolve_quality_filter=resolve_quality_filter,
    )

    assert dependencies.resolve_quality_filter is resolve_quality_filter


def test_emit_transfer_success_event_respects_kafka_enabled(monkeypatch: Any) -> None:
    import app.analytics as analytics

    calls: list[dict[str, Any]] = []

    class FakeKafkaProducer:
        _enabled = True

        def send(self, **kwargs: Any) -> None:
            calls.append(kwargs)

    fake_kafka_producer = FakeKafkaProducer()
    monkeypatch.setattr(analytics, "kafka_producer", fake_kafka_producer)

    emit_transfer_success_event(41, {"resource_name": "资源 51"})
    fake_kafka_producer._enabled = False
    emit_transfer_success_event(42, {"resource_name": "资源 52"})

    assert calls == [
        {
            "event_type": "transfer_success",
            "data": {"resource_name": "资源 51"},
            "key": "41",
        }
    ]


def test_runtime_adapter_module_does_not_import_subscription_service_or_api() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
