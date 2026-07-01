from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)


ROOT = Path(__file__).resolve().parents[2]


def _status(value: str) -> SimpleNamespace:
    return SimpleNamespace(value=value)


def _result(**overrides: Any) -> dict[str, Any]:
    values = {
        "checked_count": 2,
        "resource_checked_count": 5,
        "new_resource_count": 3,
        "resource_duplicate_count": 1,
        "auto_saved_count": 2,
        "auto_failed_count": 0,
        "failed_count": 0,
        "cleanup_deleted_count": 1,
        "cleanup_movie_deleted_count": 1,
        "cleanup_tv_deleted_count": 0,
        "errors": [],
    }
    values.update(overrides)
    return values


class FakeDb:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


def _deps(events: list[Any], **overrides: Any) -> RunFinalizeDependencies:
    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def create_execution_log(_db: Any, **kwargs: Any) -> None:
        events.append(("execution", kwargs))

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def prune_step_logs(_db: Any) -> None:
        events.append(("prune", _db))

    values: dict[str, Any] = {
        "log_background_event": log_background_event,
        "create_execution_log": create_execution_log,
        "create_step_log": create_step_log,
        "prune_step_logs": prune_step_logs,
        "now": lambda: datetime(2026, 7, 2, 10, 15, 30),
    }
    values.update(overrides)
    return RunFinalizeDependencies(**values)


@pytest.mark.asyncio
async def test_finalize_subscription_run_persists_successful_finish() -> None:
    events: list[Any] = []
    db = FakeDb()
    result = _result()
    started_at = datetime(2026, 7, 2, 10, 0, 0)
    success_status = _status("success")
    failed_status = _status("failed")
    partial_status = _status("partial")

    finalize_result = await finalize_subscription_run(
        db=db,
        channel="all",
        run_id="run-1",
        result=result,
        started_at=started_at,
        hdhive_unlock_context={
            "stats": {
                "attempted": "4",
                "success": 3,
                "failed": 1,
                "skipped": 2,
                "points_spent": "12",
            }
        },
        success_status=success_status,
        failed_status=failed_status,
        partial_status=partial_status,
        dependencies=_deps(events),
    )

    assert finalize_result.status is success_status
    assert finalize_result.message == (
        "共 2 个订阅，发现 3 个新资源，转存成功 2 个，自动完成 1 个订阅"
    )
    assert finalize_result.finished_at == datetime(2026, 7, 2, 10, 15, 30)
    assert finalize_result.finalize_error == ""
    assert result["status"] == "success"
    assert result["finished_at"] == "2026-07-02T10:15:30"
    assert result["hdhive_unlock_attempted_count"] == 4
    assert result["hdhive_unlock_success_count"] == 3
    assert result["hdhive_unlock_failed_count"] == 1
    assert result["hdhive_unlock_skipped_count"] == 2
    assert result["hdhive_unlock_points_spent"] == 12
    assert db.commits == 1
    assert db.rollbacks == 0

    assert events[0] == (
        "event",
        {
            "source_type": "background_task",
            "module": "subscriptions",
            "action": "subscription.check.finish",
            "status": "success",
            "message": (
                "订阅检查任务完成（频道：all）：检查 2 项，"
                "新增资源 3 条，转存成功 2 条，转存失败 0 条，"
                "自动清理 1 项，失败 0 项"
            ),
            "trace_id": "run-1",
            "extra": {
                "channel": "all",
                "checked_count": 2,
                "new_resource_count": 3,
                "auto_saved_count": 2,
                "auto_failed_count": 0,
                "cleanup_deleted_count": 1,
                "failed_count": 0,
                "hdhive_unlock_attempted_count": 4,
                "hdhive_unlock_success_count": 3,
                "hdhive_unlock_points_spent": 12,
            },
        },
    )

    execution_event = events[1]
    assert execution_event[0] == "execution"
    assert execution_event[1] == {
        "channel": "all",
        "status": success_status,
        "message": finalize_result.message,
        "checked_count": 2,
        "new_resource_count": 3,
        "failed_count": 0,
        "details": [],
        "started_at": started_at,
        "finished_at": datetime(2026, 7, 2, 10, 15, 30),
    }
    assert events[2][0] == "step"
    assert events[2][1]["step"] == "run_finish"
    assert events[2][1]["status"] == "success"
    assert events[2][1]["payload"]["hdhive_unlock_points_spent"] == 12
    assert events[3] == ("prune", db)


@pytest.mark.asyncio
async def test_finalize_subscription_run_records_finalize_failure_step() -> None:
    events: list[Any] = []
    db = FakeDb()
    result = _result()

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        raise RuntimeError("write failed")

    finalize_result = await finalize_subscription_run(
        db=db,
        channel="all",
        run_id="run-2",
        result=result,
        started_at=datetime(2026, 7, 2, 10, 0, 0),
        hdhive_unlock_context={"stats": {}},
        success_status=_status("success"),
        failed_status=_status("failed"),
        partial_status=_status("partial"),
        dependencies=_deps(
            events,
            create_execution_log=create_execution_log,
        ),
    )

    assert finalize_result.finalize_error == "write failed"
    assert result["status"] == "partial"
    assert result["finalize_error"] == "write failed"
    assert result["errors"] == [{"stage": "run_finalize", "error": "write failed"}]
    assert result["message"].endswith("；收尾阶段异常: write failed")
    assert db.rollbacks == 1
    assert db.commits == 1
    assert events[0][0] == "event"
    assert events[1] == (
        "step",
        {
            "run_id": "run-2",
            "channel": "all",
            "step": "run_finalize_failed",
            "status": "warning",
            "message": "写入执行日志失败：write failed",
            "payload": {
                "error": "write failed",
                "status_before_finalize": "success",
            },
        },
    )


@pytest.mark.asyncio
async def test_finalize_subscription_run_rolls_back_when_failure_step_fails() -> None:
    events: list[Any] = []
    db = FakeDb()
    result = _result()

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        raise RuntimeError("write failed")

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))
        raise RuntimeError("step failed")

    finalize_result = await finalize_subscription_run(
        db=db,
        channel="all",
        run_id="run-3",
        result=result,
        started_at=datetime(2026, 7, 2, 10, 0, 0),
        hdhive_unlock_context={"stats": {}},
        success_status=_status("success"),
        failed_status=_status("failed"),
        partial_status=_status("partial"),
        dependencies=_deps(
            events,
            create_execution_log=create_execution_log,
            create_step_log=create_step_log,
        ),
    )

    assert finalize_result.finalize_error == "write failed"
    assert result["status"] == "partial"
    assert db.rollbacks == 2
    assert db.commits == 0
    assert events[0][0] == "event"
    assert events[1][0] == "step"
    assert events[1][1]["step"] == "run_finalize_failed"


def test_run_finalize_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_finalize_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
