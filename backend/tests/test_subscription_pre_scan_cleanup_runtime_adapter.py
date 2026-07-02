from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.emby_service import emby_service
from app.services.operation_log_service import operation_log_service
from app.services.subscription_cleanup_policy import (
    has_upcoming_episodes_in_subscription_scope,
)
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
)
from app.services.subscriptions.pre_scan_cleanup_runtime_adapter import (
    PreScanCleanupRuntimeDependencies,
    build_default_pre_scan_cleanup_runtime_dependencies,
    evaluate_pre_scan_cleanup_with_runtime_adapter,
)
from app.services.tv_missing_service import tv_missing_service


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> PreScanCleanupRuntimeDependencies:
    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def check_feiniu_movie_status(_tmdb_id: int) -> dict[str, Any]:
        return {"checked": False}

    async def log_background_event(**_kwargs: Any) -> None:
        return None

    async def get_movie_status_by_tmdb(_tmdb_id: int) -> dict[str, Any]:
        return {"status": "not_found"}

    async def get_tv_missing_status(_tmdb_id: int, **_kwargs: Any) -> dict[str, Any]:
        return {"status": "error"}

    async def has_upcoming_episodes(_tmdb_id: int, _sub: Any) -> bool:
        return False

    async def run_evaluate_pre_scan_cleanup(
        _db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
        dependencies: PreScanCleanupDependencies,
    ) -> dict[str, Any]:
        _ = (run_id, channel, sub, dependencies)
        return {"deleted": False, "tv_missing_snapshot": None}

    values: dict[str, Any] = {
        "delete_subscription_with_records": delete_subscription_with_records,
        "create_step_log": create_step_log,
        "check_feiniu_movie_status": check_feiniu_movie_status,
        "log_background_event": log_background_event,
        "get_movie_status_by_tmdb": get_movie_status_by_tmdb,
        "get_tv_missing_status": get_tv_missing_status,
        "has_upcoming_episodes": has_upcoming_episodes,
        "run_evaluate_pre_scan_cleanup": run_evaluate_pre_scan_cleanup,
    }
    values.update(overrides)
    return PreScanCleanupRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_arguments() -> None:
    db = object()
    sub = SimpleNamespace(id=77, title="示例订阅")
    calls: list[Any] = []

    async def delete_subscription_with_records(
        current_db: Any,
        subscription_id: int,
    ) -> None:
        calls.append(("delete", current_db, subscription_id))

    async def create_step_log(current_db: Any, **kwargs: Any) -> None:
        calls.append(("step", current_db, kwargs))

    async def check_feiniu_movie_status(tmdb_id: int) -> dict[str, Any]:
        calls.append(("feiniu", tmdb_id))
        return {"checked": True, "exists": False}

    async def log_background_event(**kwargs: Any) -> None:
        calls.append(("event", kwargs))

    async def get_movie_status_by_tmdb(tmdb_id: int) -> dict[str, Any]:
        calls.append(("emby", tmdb_id))
        return {"status": "ok", "exists": False}

    async def get_tv_missing_status(tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
        calls.append(("tv_missing", tmdb_id, kwargs))
        return {"status": "ok"}

    async def has_upcoming_episodes(tmdb_id: int, current_sub: Any) -> bool:
        calls.append(("upcoming", tmdb_id, current_sub))
        return True

    async def run_evaluate_pre_scan_cleanup(
        current_db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
        dependencies: PreScanCleanupDependencies,
    ) -> dict[str, Any]:
        calls.append(("runner", current_db, run_id, channel, sub, dependencies))
        await dependencies.delete_subscription_with_records(current_db, 77)
        await dependencies.create_step_log(current_db, step="cleanup")
        await dependencies.log_background_event(action="cleanup")
        movie_status = await dependencies.get_movie_status_by_tmdb(1001)
        feiniu_status = await dependencies.check_feiniu_movie_status(1001)
        tv_status = await dependencies.get_tv_missing_status(1001, scope="all")
        upcoming = await dependencies.has_upcoming_episodes(1001, sub)
        return {
            "movie_status": movie_status,
            "feiniu_status": feiniu_status,
            "tv_status": tv_status,
            "upcoming": upcoming,
        }

    result = await evaluate_pre_scan_cleanup_with_runtime_adapter(
        db,
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=_dependencies(
            delete_subscription_with_records=delete_subscription_with_records,
            create_step_log=create_step_log,
            check_feiniu_movie_status=check_feiniu_movie_status,
            log_background_event=log_background_event,
            get_movie_status_by_tmdb=get_movie_status_by_tmdb,
            get_tv_missing_status=get_tv_missing_status,
            has_upcoming_episodes=has_upcoming_episodes,
            run_evaluate_pre_scan_cleanup=run_evaluate_pre_scan_cleanup,
        ),
    )

    assert result == {
        "movie_status": {"status": "ok", "exists": False},
        "feiniu_status": {"checked": True, "exists": False},
        "tv_status": {"status": "ok"},
        "upcoming": True,
    }
    assert calls[0] == ("runner", db, "run-1", "rss", sub, calls[0][5])
    assert isinstance(calls[0][5], PreScanCleanupDependencies)
    assert calls[1:] == [
        ("delete", db, 77),
        ("step", db, {"step": "cleanup"}),
        ("event", {"action": "cleanup"}),
        ("emby", 1001),
        ("feiniu", 1001),
        ("tv_missing", 1001, {"scope": "all"}),
        ("upcoming", 1001, sub),
    ]


def test_default_runtime_dependencies_bind_existing_services_and_runner() -> None:
    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    dependencies = build_default_pre_scan_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )
    assert dependencies.create_step_log is create_step_log
    assert (
        dependencies.check_feiniu_movie_status
        is check_feiniu_movie_status_with_runtime_adapter
    )
    assert dependencies.log_background_event.__self__ is operation_log_service
    assert (
        dependencies.log_background_event.__func__
        is type(operation_log_service).log_background_event
    )
    assert dependencies.get_movie_status_by_tmdb.__self__ is emby_service
    assert (
        dependencies.get_movie_status_by_tmdb.__func__
        is type(emby_service).get_movie_status_by_tmdb
    )
    assert dependencies.get_tv_missing_status.__self__ is tv_missing_service
    assert (
        dependencies.get_tv_missing_status.__func__
        is type(tv_missing_service).get_tv_missing_status
    )
    assert (
        dependencies.has_upcoming_episodes
        is has_upcoming_episodes_in_subscription_scope
    )
    assert dependencies.run_evaluate_pre_scan_cleanup is evaluate_pre_scan_cleanup_flow


def test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, _tmdb_id: int) -> dict[str, Any]:
            return {"checked": True}

    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    check_feiniu_movie_status = FalsyAsyncCallable()

    dependencies = build_default_pre_scan_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )

    assert dependencies.check_feiniu_movie_status is check_feiniu_movie_status


def test_pre_scan_cleanup_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
