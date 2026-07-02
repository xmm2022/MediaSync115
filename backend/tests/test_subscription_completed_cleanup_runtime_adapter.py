from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from app.services.emby_service import emby_service
from app.services.operation_log_service import operation_log_service
from app.services.subscription_cleanup_policy import (
    has_upcoming_episodes_in_subscription_scope,
)
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
    cleanup_completed_subscriptions as cleanup_completed_subscriptions_flow,
    cleanup_single_subscription as cleanup_single_subscription_flow,
)
from app.services.subscriptions.completed_cleanup_runtime_adapter import (
    CompletedCleanupRuntimeDependencies,
    build_completed_cleanup_dependencies,
    build_default_completed_cleanup_runtime_dependencies,
    cleanup_completed_subscriptions_with_runtime_adapter,
    cleanup_single_subscription_with_runtime_adapter,
)
from app.services.tv_missing_service import tv_missing_service


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> CompletedCleanupRuntimeDependencies:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
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

    async def sleep(_delay: float) -> None:
        return None

    async def run_cleanup_completed_subscriptions(
        _db: Any,
        *,
        dependencies: CompletedCleanupDependencies,
    ) -> dict[str, Any]:
        _ = dependencies
        return {"deleted_count": 0, "details": []}

    async def run_cleanup_single_subscription(
        _db: Any,
        _subscription_id: int,
        *,
        dependencies: CompletedCleanupDependencies,
    ) -> dict[str, Any]:
        _ = dependencies
        return {"deleted": False, "reason": ""}

    values: dict[str, Any] = {
        "delete_subscription_with_records": delete_subscription_with_records,
        "check_feiniu_movie_status": check_feiniu_movie_status,
        "log_background_event": log_background_event,
        "get_movie_status_by_tmdb": get_movie_status_by_tmdb,
        "get_tv_missing_status": get_tv_missing_status,
        "has_upcoming_episodes": has_upcoming_episodes,
        "sleep": sleep,
        "run_cleanup_completed_subscriptions": run_cleanup_completed_subscriptions,
        "run_cleanup_single_subscription": run_cleanup_single_subscription,
    }
    values.update(overrides)
    return CompletedCleanupRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_batch_runtime_adapter_builds_core_dependencies_and_forwards_db() -> None:
    db = object()
    calls: list[Any] = []

    async def delete_subscription_with_records(
        current_db: Any,
        subscription_id: int,
    ) -> None:
        calls.append(("delete", current_db, subscription_id))

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

    async def has_upcoming_episodes(tmdb_id: int, sub: Any) -> bool:
        calls.append(("upcoming", tmdb_id, sub))
        return True

    async def sleep(delay: float) -> None:
        calls.append(("sleep", delay))

    async def run_cleanup_completed_subscriptions(
        current_db: Any,
        *,
        dependencies: CompletedCleanupDependencies,
    ) -> dict[str, Any]:
        calls.append(("runner", current_db, dependencies))
        await dependencies.delete_subscription_with_records(current_db, 77)
        await dependencies.check_feiniu_movie_status(1001)
        await dependencies.log_background_event(action="cleanup")
        movie_status = await dependencies.get_movie_status_by_tmdb(1001)
        tv_status = await dependencies.get_tv_missing_status(1001, scope="all")
        upcoming = await dependencies.has_upcoming_episodes(1001, object())
        await dependencies.sleep(0.25)
        return {
            "movie_status": movie_status,
            "tv_status": tv_status,
            "upcoming": upcoming,
        }

    result = await cleanup_completed_subscriptions_with_runtime_adapter(
        db,
        dependencies=_dependencies(
            delete_subscription_with_records=delete_subscription_with_records,
            check_feiniu_movie_status=check_feiniu_movie_status,
            log_background_event=log_background_event,
            get_movie_status_by_tmdb=get_movie_status_by_tmdb,
            get_tv_missing_status=get_tv_missing_status,
            has_upcoming_episodes=has_upcoming_episodes,
            sleep=sleep,
            run_cleanup_completed_subscriptions=run_cleanup_completed_subscriptions,
        ),
    )

    assert result == {
        "movie_status": {"status": "ok", "exists": False},
        "tv_status": {"status": "ok"},
        "upcoming": True,
    }
    assert calls[0] == ("runner", db, calls[0][2])
    assert isinstance(calls[0][2], CompletedCleanupDependencies)
    assert calls[1:6] == [
        ("delete", db, 77),
        ("feiniu", 1001),
        ("event", {"action": "cleanup"}),
        ("emby", 1001),
        ("tv_missing", 1001, {"scope": "all"}),
    ]
    assert calls[6][0:2] == ("upcoming", 1001)
    assert calls[7] == ("sleep", 0.25)


@pytest.mark.asyncio
async def test_single_runtime_adapter_forwards_subscription_id() -> None:
    db = object()
    calls: list[Any] = []

    async def run_cleanup_single_subscription(
        current_db: Any,
        subscription_id: int,
        *,
        dependencies: CompletedCleanupDependencies,
    ) -> dict[str, Any]:
        calls.append(("runner", current_db, subscription_id, dependencies))
        return {"deleted": True, "reason": "done"}

    result = await cleanup_single_subscription_with_runtime_adapter(
        db,
        42,
        dependencies=_dependencies(
            run_cleanup_single_subscription=run_cleanup_single_subscription,
        ),
    )

    assert result == {"deleted": True, "reason": "done"}
    assert calls == [("runner", db, 42, calls[0][3])]
    assert isinstance(calls[0][3], CompletedCleanupDependencies)


def test_build_completed_cleanup_dependencies_exposes_runtime_callbacks() -> None:
    dependencies = _dependencies()
    core_dependencies = build_completed_cleanup_dependencies(dependencies)

    assert isinstance(core_dependencies, CompletedCleanupDependencies)
    assert (
        core_dependencies.delete_subscription_with_records
        is dependencies.delete_subscription_with_records
    )
    assert core_dependencies.log_background_event is dependencies.log_background_event
    assert (
        core_dependencies.get_movie_status_by_tmdb
        is dependencies.get_movie_status_by_tmdb
    )
    assert (
        core_dependencies.check_feiniu_movie_status
        is dependencies.check_feiniu_movie_status
    )
    assert core_dependencies.get_tv_missing_status is dependencies.get_tv_missing_status
    assert core_dependencies.has_upcoming_episodes is dependencies.has_upcoming_episodes
    assert core_dependencies.sleep is dependencies.sleep


def test_default_runtime_dependencies_bind_existing_services_sleep_and_runners() -> None:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def check_feiniu_movie_status(_tmdb_id: int) -> dict[str, Any]:
        return {"checked": False}

    dependencies = build_default_completed_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )
    assert dependencies.check_feiniu_movie_status is check_feiniu_movie_status
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
    assert dependencies.sleep is asyncio.sleep
    assert dependencies.run_cleanup_completed_subscriptions is (
        cleanup_completed_subscriptions_flow
    )
    assert dependencies.run_cleanup_single_subscription is (
        cleanup_single_subscription_flow
    )


def test_completed_cleanup_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
