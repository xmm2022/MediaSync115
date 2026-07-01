from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.database import async_session_maker, ensure_tables_exist
from app.core.timezone_utils import beijing_now
from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
from app.services.subscription_delete_service import subscription_delete_service
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
    cleanup_completed_subscriptions,
    cleanup_single_subscription,
    evaluate_subscription_cleanup_eligibility,
)


class FakeDeps:
    def __init__(
        self,
        *,
        movie_status: dict[str, Any] | BaseException | None = None,
        feiniu_status: dict[str, Any] | None = None,
        tv_status: dict[str, Any] | None = None,
        has_upcoming: bool = False,
        delete_with_records: Any = None,
    ) -> None:
        self.movie_status = movie_status or {"status": "not_found", "exists": False}
        self.feiniu_status = feiniu_status or {"checked": False, "exists": False}
        self.tv_status = tv_status or {"status": "error", "message": "not configured"}
        self.has_upcoming = has_upcoming
        self.delete_with_records = delete_with_records
        self.deleted: list[int] = []
        self.events: list[dict[str, Any]] = []
        self.tv_kwargs: dict[str, Any] | None = None
        self.sleep_delays: list[float] = []

    async def delete_subscription_with_records(
        self, db: object, subscription_id: int
    ) -> None:
        self.deleted.append(subscription_id)
        if self.delete_with_records is not None:
            await self.delete_with_records(db, [subscription_id])

    async def log_background_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)

    async def get_movie_status_by_tmdb(self, tmdb_id: int) -> dict[str, Any]:
        if isinstance(self.movie_status, BaseException):
            raise self.movie_status
        return self.movie_status

    async def check_feiniu_movie_status(self, tmdb_id: int) -> dict[str, Any]:
        return self.feiniu_status

    async def get_tv_missing_status(
        self, tmdb_id: int, **kwargs: Any
    ) -> dict[str, Any]:
        self.tv_kwargs = kwargs
        return self.tv_status

    async def has_upcoming_episodes(self, tmdb_id: int, sub: Any) -> bool:
        return self.has_upcoming

    async def sleep(self, delay: float) -> None:
        self.sleep_delays.append(delay)

    def as_dependencies(self) -> CompletedCleanupDependencies:
        return CompletedCleanupDependencies(
            delete_subscription_with_records=self.delete_subscription_with_records,
            log_background_event=self.log_background_event,
            get_movie_status_by_tmdb=self.get_movie_status_by_tmdb,
            check_feiniu_movie_status=self.check_feiniu_movie_status,
            get_tv_missing_status=self.get_tv_missing_status,
            has_upcoming_episodes=self.has_upcoming_episodes,
            sleep=self.sleep,
        )


def make_sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 42,
        "title": "测试订阅",
        "media_type": MediaType.MOVIE,
        "tmdb_id": 1001,
        "tv_follow_mode": None,
        "tv_scope": "all",
        "tv_include_specials": False,
        "tv_season_number": None,
        "tv_episode_start": None,
        "tv_episode_end": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


async def _remove_subscription_by_tmdb(tmdb_id: int) -> None:
    async with async_session_maker() as db:
        ids = list(
            (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id == tmdb_id)
                )
            ).scalars()
        )
        await subscription_delete_service.delete_local_subscriptions(db, ids)
        await db.commit()


class FakeRowsResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return list(self._rows)


class FakeBatchDb:
    def __init__(self, rows: list[Any], *, fail_first_commit: bool = False) -> None:
        self.rows = rows
        self.fail_first_commit = fail_first_commit
        self.execute_calls = 0
        self.commit_calls = 0
        self.rollback_calls = 0

    async def execute(self, statement: object) -> FakeRowsResult:
        self.execute_calls += 1
        return FakeRowsResult(self.rows)

    async def commit(self) -> None:
        self.commit_calls += 1
        if self.fail_first_commit and self.commit_calls == 1:
            raise OperationalError("commit", {}, Exception("deadlock detected"))

    async def rollback(self) -> None:
        self.rollback_calls += 1


@pytest.mark.asyncio
async def test_movie_cleanup_continues_to_feiniu_when_emby_lookup_fails() -> None:
    fake = FakeDeps(
        movie_status=RuntimeError("Emby down"),
        feiniu_status={"checked": True, "exists": True, "item_ids": ["fn-1"]},
    )

    result = await evaluate_subscription_cleanup_eligibility(
        make_sub(),
        has_successful_transfer=False,
        dependencies=fake.as_dependencies(),
    )

    assert result == (True, "电影已存在于飞牛")


@pytest.mark.asyncio
async def test_cleanup_completed_subscriptions_deletes_batch_and_logs_detail() -> None:
    row = make_sub(tmdb_id=None)
    row.has_successful_transfer = True
    db = FakeBatchDb([row])
    fake = FakeDeps()

    result = await cleanup_completed_subscriptions(
        db,
        dependencies=fake.as_dependencies(),
    )

    assert result == {
        "deleted_count": 1,
        "details": [
            {
                "subscription_id": 42,
                "title": "测试订阅",
                "media_type": "movie",
                "reason": "电影已有成功转存记录",
            }
        ],
    }
    assert db.execute_calls == 1
    assert db.commit_calls == 1
    assert db.rollback_calls == 0
    assert fake.deleted == [42]
    assert fake.events[0]["action"] == "subscription.item.cleanup_offline_completed"


@pytest.mark.asyncio
async def test_cleanup_completed_subscriptions_retries_by_rolling_back_and_replaying_batch() -> None:
    row = make_sub(tmdb_id=None)
    row.has_successful_transfer = True
    db = FakeBatchDb([row], fail_first_commit=True)
    fake = FakeDeps()

    result = await cleanup_completed_subscriptions(
        db,
        dependencies=fake.as_dependencies(),
    )

    assert result["deleted_count"] == 1
    assert db.execute_calls == 2
    assert db.commit_calls == 2
    assert db.rollback_calls == 1
    assert fake.deleted == [42, 42]
    assert fake.sleep_delays == [1.0]
    assert len(fake.events) == 1


@pytest.mark.asyncio
async def test_tv_new_follow_mode_keeps_subscription_when_upcoming_exists() -> None:
    fake = FakeDeps(
        tv_status={
            "status": "ok",
            "counts": {"aired": 10, "existing": 10, "missing": 0},
        },
        has_upcoming=True,
    )

    result = await evaluate_subscription_cleanup_eligibility(
        make_sub(media_type=MediaType.TV, tv_follow_mode="new"),
        has_successful_transfer=False,
        dependencies=fake.as_dependencies(),
    )

    assert result == (False, "")
    assert fake.tv_kwargs is not None
    assert fake.tv_kwargs["aired_only"] is True


@pytest.mark.asyncio
async def test_cleanup_single_subscription_deletes_completed_local_movie_and_logs() -> None:
    tmdb_id = 930101
    await ensure_tables_exist()
    await _remove_subscription_by_tmdb(tmdb_id)
    fake = FakeDeps(
        delete_with_records=subscription_delete_service.delete_local_subscriptions,
    )

    async with async_session_maker() as db:
        sub = Subscription(
            tmdb_id=tmdb_id,
            title="Completed Cleanup Movie",
            media_type=MediaType.MOVIE,
            provider="mediasync115",
            external_system="mediasync115",
            is_active=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        db.add(
            DownloadRecord(
                subscription_id=sub.id,
                resource_name="Completed.Cleanup.Movie.mkv",
                resource_url="https://115.com/s/completed-cleanup",
                resource_type="pan115",
                status=MediaStatus.COMPLETED,
                completed_at=beijing_now(),
            )
        )
        await db.commit()

        result = await cleanup_single_subscription(
            db,
            sub.id,
            dependencies=fake.as_dependencies(),
        )

        assert result == {"deleted": True, "reason": "电影已有成功转存记录"}
        remaining = (
            await db.execute(select(Subscription.id).where(Subscription.id == sub.id))
        ).scalar_one_or_none()
        assert remaining is None

    assert fake.deleted == [sub.id]
    assert fake.events[0]["action"] == "subscription.item.cleanup_manual"
    assert fake.events[0]["extra"]["reason"] == "电影已有成功转存记录"


@pytest.mark.asyncio
async def test_cleanup_single_subscription_skips_external_provider() -> None:
    tmdb_id = 930102
    await ensure_tables_exist()
    await _remove_subscription_by_tmdb(tmdb_id)
    fake = FakeDeps(
        delete_with_records=subscription_delete_service.delete_local_subscriptions,
    )

    async with async_session_maker() as db:
        sub = Subscription(
            tmdb_id=tmdb_id,
            title="External Cleanup Movie",
            media_type=MediaType.MOVIE,
            provider="moviepilot",
            external_system="moviepilot",
            external_subscription_id="mp-cleanup",
            is_active=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)

        result = await cleanup_single_subscription(
            db,
            sub.id,
            dependencies=fake.as_dependencies(),
        )

        assert result == {
            "deleted": False,
            "reason": "外部渠道订阅不参与 MediaSync115 自动清理",
        }
        remaining = (
            await db.execute(select(Subscription.id).where(Subscription.id == sub.id))
        ).scalar_one_or_none()
        assert remaining == sub.id

    assert fake.deleted == []
    assert fake.events == []


def test_completed_cleanup_module_keeps_runtime_dependencies_injected() -> None:
    import app.services.subscriptions.completed_cleanup as module

    imported_names = set(module.__dict__)

    assert "subscription_service" not in imported_names
    assert "runtime_settings_service" not in imported_names
    assert "emby_service" not in imported_names
    assert "feiniu_service" not in imported_names
    assert "tv_missing_service" not in imported_names
    assert "operation_log_service" not in imported_names
