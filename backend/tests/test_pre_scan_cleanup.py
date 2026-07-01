from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
import app.services.subscription_service as subscription_module
from app.services.subscription_service import SubscriptionService
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup,
)


class FakeDeps:
    def __init__(
        self,
        *,
        movie_status: dict[str, Any] | None = None,
        feiniu_status: dict[str, Any] | None = None,
        tv_status: dict[str, Any] | None = None,
    ) -> None:
        self.deleted: list[int] = []
        self.step_logs: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.movie_status = movie_status or {"status": "not_found", "exists": False}
        self.feiniu_status = feiniu_status or {"checked": False, "exists": False}
        self.tv_status = tv_status or {"status": "error", "message": "not configured"}
        self.upcoming_calls = 0

    async def delete_subscription_with_records(
        self, db: object, subscription_id: int
    ) -> None:
        self.deleted.append(subscription_id)

    async def create_step_log(self, db: object, **kwargs: Any) -> None:
        self.step_logs.append(kwargs)

    async def log_background_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)

    async def get_movie_status_by_tmdb(self, tmdb_id: int) -> dict[str, Any]:
        return self.movie_status

    async def check_feiniu_movie_status(self, tmdb_id: int) -> dict[str, Any]:
        return self.feiniu_status

    async def get_tv_missing_status(
        self, tmdb_id: int, **kwargs: Any
    ) -> dict[str, Any]:
        return self.tv_status

    async def has_upcoming_episodes(self, tmdb_id: int, sub: Any) -> bool:
        self.upcoming_calls += 1
        return False

    def as_dependencies(self) -> PreScanCleanupDependencies:
        return PreScanCleanupDependencies(
            delete_subscription_with_records=self.delete_subscription_with_records,
            create_step_log=self.create_step_log,
            log_background_event=self.log_background_event,
            get_movie_status_by_tmdb=self.get_movie_status_by_tmdb,
            check_feiniu_movie_status=self.check_feiniu_movie_status,
            get_tv_missing_status=self.get_tv_missing_status,
            has_upcoming_episodes=self.has_upcoming_episodes,
        )


def make_sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 42,
        "title": "测试订阅",
        "media_type": "movie",
        "tmdb_id": 1001,
        "has_successful_transfer": False,
        "tv_follow_mode": None,
        "tv_scope": "all",
        "tv_include_specials": False,
        "tv_season_number": None,
        "tv_episode_start": None,
        "tv_episode_end": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_deletes_movie_with_successful_transfer_before_library_checks() -> None:
    fake = FakeDeps()
    sub = make_sub(has_successful_transfer=True)

    result = await evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=fake.as_dependencies(),
    )

    assert result == {"deleted": True}
    assert fake.deleted == [42]
    assert [entry["step"] for entry in fake.step_logs] == [
        "subscription_cleanup_movie_transferred"
    ]
    assert fake.events[0]["action"] == "subscription.item.cleanup_pre_scan"
    assert fake.events[0]["extra"]["reason"] == "successful_transfer"


@pytest.mark.asyncio
async def test_deletes_movie_when_emby_reports_existing_item() -> None:
    fake = FakeDeps(
        movie_status={"status": "ok", "exists": True, "item_ids": ["emby-1"]}
    )
    sub = make_sub()

    result = await evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=fake.as_dependencies(),
    )

    assert result == {"deleted": True}
    assert fake.deleted == [42]
    assert [entry["step"] for entry in fake.step_logs] == [
        "movie_emby_check_done",
        "subscription_cleanup_movie_emby_exists",
    ]
    assert fake.step_logs[1]["payload"] == {
        "tmdb_id": 1001,
        "matched_item_ids": ["emby-1"],
    }
    assert fake.events[0]["extra"]["reason"] == "emby_exists"


@pytest.mark.asyncio
async def test_movie_emby_failure_logs_warning_then_checks_feiniu() -> None:
    fake = FakeDeps(
        movie_status={"status": "error", "message": "Emby down"},
        feiniu_status={"checked": True, "exists": True, "item_ids": ["fn-1"]},
    )
    sub = make_sub()

    result = await evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=fake.as_dependencies(),
    )

    assert result == {"deleted": True}
    assert fake.deleted == [42]
    assert [entry["step"] for entry in fake.step_logs] == [
        "movie_emby_check_failed",
        "subscription_cleanup_movie_feiniu_exists",
    ]
    assert fake.step_logs[0]["status"] == "warning"
    assert fake.events[0]["extra"]["reason"] == "feiniu_exists"


@pytest.mark.asyncio
async def test_tv_missing_ok_returns_snapshot_without_cleanup_when_missing_remains() -> None:
    tv_status = {
        "status": "ok",
        "counts": {"aired": 10, "existing": 8, "missing": 2},
    }
    fake = FakeDeps(tv_status=tv_status)
    sub = make_sub(media_type="tv", tv_follow_mode="missing")

    result = await evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=fake.as_dependencies(),
    )

    assert result == {"deleted": False, "tv_missing_snapshot": tv_status}
    assert fake.deleted == []
    assert [entry["step"] for entry in fake.step_logs] == [
        "tv_missing_fetch_start",
        "tv_missing_fetch_done",
    ]
    assert fake.step_logs[1]["payload"]["missing_count"] == 2


@pytest.mark.asyncio
async def test_tv_missing_ok_deletes_subscription_when_cleanup_policy_allows_it() -> None:
    tv_status = {
        "status": "ok",
        "counts": {"aired": 10, "existing": 10, "missing": 0},
    }
    fake = FakeDeps(tv_status=tv_status)
    sub = make_sub(media_type="tv", tv_follow_mode="missing")

    result = await evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=fake.as_dependencies(),
    )

    assert result == {"deleted": True, "tv_missing_snapshot": tv_status}
    assert fake.deleted == [42]
    assert [entry["step"] for entry in fake.step_logs] == [
        "tv_missing_fetch_start",
        "tv_missing_fetch_done",
        "subscription_cleanup_tv_no_missing",
    ]
    assert fake.events[0]["extra"]["tmdb_id"] == 1001


@pytest.mark.asyncio
async def test_tv_missing_failure_logs_warning_without_cleanup() -> None:
    fake = FakeDeps(tv_status={"status": "error", "message": "timeout"})
    sub = make_sub(media_type="tv", tv_follow_mode="missing")

    result = await evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=sub,
        dependencies=fake.as_dependencies(),
    )

    assert result == {"deleted": False, "tv_missing_snapshot": None}
    assert fake.deleted == []
    assert [entry["step"] for entry in fake.step_logs] == [
        "tv_missing_fetch_start",
        "tv_missing_fetch_failed",
    ]
    assert fake.step_logs[1]["payload"] == {"tmdb_id": 1001, "status": "error"}


def test_pre_scan_cleanup_module_keeps_runtime_dependencies_injected() -> None:
    import app.services.subscriptions.pre_scan_cleanup as module

    imported_names = set(module.__dict__)

    assert "subscription_service" not in imported_names
    assert "runtime_settings_service" not in imported_names
    assert "emby_service" not in imported_names
    assert "tv_missing_service" not in imported_names
    assert "AsyncSession" not in imported_names


@pytest.mark.asyncio
async def test_subscription_service_wrapper_injects_dependencies_for_snapshots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = SubscriptionService()
    deleted: list[int] = []
    step_logs: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    async def fake_delete_subscription_with_records(
        db: object, subscription_id: int
    ) -> None:
        deleted.append(subscription_id)

    async def fake_create_step_log(db: object, **kwargs: Any) -> None:
        step_logs.append(kwargs)

    async def fake_log_background_event(**kwargs: Any) -> None:
        events.append(kwargs)

    monkeypatch.setattr(
        service,
        "_delete_subscription_with_records",
        fake_delete_subscription_with_records,
    )
    monkeypatch.setattr(service, "_create_step_log", fake_create_step_log)
    monkeypatch.setattr(
        subscription_module.operation_log_service,
        "log_background_event",
        fake_log_background_event,
    )

    result = await service._evaluate_pre_scan_cleanup(
        object(),
        run_id="run-1",
        channel="rss",
        sub=make_sub(media_type=MediaType.MOVIE, has_successful_transfer=True),
    )

    assert result == {"deleted": True}
    assert deleted == [42]
    assert step_logs[0]["step"] == "subscription_cleanup_movie_transferred"
    assert events[0]["extra"]["reason"] == "successful_transfer"
