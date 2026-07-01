# Subscription Completed Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract completed/manual subscription cleanup flows from `SubscriptionService` into a focused helper module without changing cleanup behavior.

**Architecture:** Add `app.services.subscriptions.completed_cleanup` with database cleanup orchestration and injected runtime dependencies. Keep `SubscriptionService.cleanup_completed_subscriptions()` and `cleanup_single_subscription()` as public compatibility wrappers. Cover policy orchestration and one real database single-cleanup flow with tests.

**Tech Stack:** Python 3.11, async SQLAlchemy, pytest, existing subscription cleanup policy helpers.

---

### Task 1: Add Completed Cleanup Tests

**Files:**
- Create: `backend/tests/test_completed_cleanup.py`

- [ ] **Step 1: Write failing helper and integration tests**

Create `backend/tests/test_completed_cleanup.py`:

```python
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select

from app.core.database import async_session_maker, ensure_tables_exist
from app.core.timezone_utils import beijing_now
from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
from app.services.subscription_delete_service import subscription_delete_service
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
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
        delete_with_records=None,
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

    async def get_tv_missing_status(self, tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
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
```

Then add the tests:

```python
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
async def test_tv_new_follow_mode_keeps_subscription_when_upcoming_exists() -> None:
    fake = FakeDeps(
        tv_status={"status": "ok", "counts": {"aired": 10, "existing": 10, "missing": 0}},
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
```

- [ ] **Step 2: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_completed_cleanup.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.completed_cleanup'`.

### Task 2: Implement Completed Cleanup Helper

**Files:**
- Create: `backend/app/services/subscriptions/completed_cleanup.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Create helper module with injected dependencies**

Create `backend/app/services/subscriptions/completed_cleanup.py` with the dataclass, type aliases, and extracted functions:

```python
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import or_, select
from sqlalchemy.exc import OperationalError

from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
from app.services.subscription_cleanup_policy import (
    build_tv_missing_status_kwargs,
    evaluate_movie_cleanup,
    evaluate_tv_cleanup,
    normalize_tv_follow_mode,
)

logger = logging.getLogger(__name__)

DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[Any]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class CompletedCleanupDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes
    sleep: Sleep = asyncio.sleep
```

Move the current bodies of `cleanup_completed_subscriptions()`, `_subscription_has_successful_transfer()`, `_evaluate_subscription_cleanup_eligibility()`, and `cleanup_single_subscription()` into this module. Replace service-instance calls as follows:

- `self._delete_subscription_with_records(...)` -> `dependencies.delete_subscription_with_records(...)`
- `operation_log_service.log_background_event(...)` -> `dependencies.log_background_event(...)`
- `emby_service.get_movie_status_by_tmdb(...)` -> `dependencies.get_movie_status_by_tmdb(...)`
- `self._check_feiniu_movie_status(...)` -> `dependencies.check_feiniu_movie_status(...)`
- `tv_missing_service.get_tv_missing_status(...)` -> `dependencies.get_tv_missing_status(...)`
- `has_upcoming_episodes_in_subscription_scope(...)` -> `dependencies.has_upcoming_episodes(...)`
- `asyncio.sleep(delay)` -> `dependencies.sleep(delay)`

Add `_media_type_value()` so tests and production snapshots both support `MediaType` enums and strings:

```python
def _media_type_value(sub: Any) -> str | None:
    media_type = getattr(sub, "media_type", None)
    value = getattr(media_type, "value", media_type)
    return str(value) if value is not None else None
```

- [ ] **Step 2: Replace service methods with wrappers**

In `backend/app/services/subscription_service.py`, import:

```python
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
    cleanup_completed_subscriptions as cleanup_completed_subscriptions_flow,
    cleanup_single_subscription as cleanup_single_subscription_flow,
)
```

Add a small dependency builder inside `SubscriptionService`:

```python
    def _completed_cleanup_dependencies(self) -> CompletedCleanupDependencies:
        return CompletedCleanupDependencies(
            delete_subscription_with_records=self._delete_subscription_with_records,
            log_background_event=operation_log_service.log_background_event,
            get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
            check_feiniu_movie_status=self._check_feiniu_movie_status,
            get_tv_missing_status=tv_missing_service.get_tv_missing_status,
            has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
            sleep=asyncio.sleep,
        )
```

Replace the two public methods with wrappers:

```python
    async def cleanup_completed_subscriptions(
        self, db: AsyncSession
    ) -> dict[str, Any]:
        return await cleanup_completed_subscriptions_flow(
            db,
            dependencies=self._completed_cleanup_dependencies(),
        )

    async def cleanup_single_subscription(
        self, db: AsyncSession, subscription_id: int
    ) -> dict[str, Any]:
        return await cleanup_single_subscription_flow(
            db,
            subscription_id,
            dependencies=self._completed_cleanup_dependencies(),
        )
```

Delete the old private `_subscription_has_successful_transfer()` and `_evaluate_subscription_cleanup_eligibility()` methods from `SubscriptionService`.

- [ ] **Step 3: Run focused green tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_completed_cleanup.py
```

Expected: PASS.

### Task 3: Verify Regressions and Commit

**Files:**
- Create: `backend/app/services/subscriptions/completed_cleanup.py`
- Modify: `backend/app/services/subscription_service.py`
- Create: `backend/tests/test_completed_cleanup.py`

- [ ] **Step 1: Run targeted regression tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_completed_cleanup.py tests/test_subscription_cleanup_policy.py tests/test_subscription_delete_service.py tests/test_pre_scan_cleanup.py tests/test_subscriptions.py tests/test_health.py
```

Expected: PASS.

- [ ] **Step 2: Confirm line count reduction**

Run:

```bash
wc -l backend/app/services/subscription_service.py backend/app/services/subscriptions/completed_cleanup.py
```

Expected: `subscription_service.py` is below 2500 lines, with completed cleanup logic isolated in the new helper.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/completed_cleanup.py backend/tests/test_completed_cleanup.py
git commit -m "refactor: 抽离订阅完成后清理"
```

Expected: commit succeeds and does not include unrelated untracked files.

- [ ] **Step 4: Run final verification before completion**

Run:

```bash
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
```

Expected: all commands exit 0. The existing Vite chunk-size warning may still appear during frontend build.
