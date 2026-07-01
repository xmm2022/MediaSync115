# Subscription Pre-Scan Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription pre-scan cleanup decisions from `SubscriptionService` into a focused helper module while preserving current deletion, step log, operation log, and TV missing snapshot behavior.

**Architecture:** Add `app.services.subscriptions.pre_scan_cleanup` as a pure orchestration helper with explicit async dependencies for deletion, service lookups, and logs. Keep `SubscriptionService._evaluate_pre_scan_cleanup()` as a compatibility wrapper that injects existing runtime services. Cover the extracted helper with direct unit tests and one integration boundary test.

**Tech Stack:** Python 3.11, async helpers, pytest, SQLAlchemy async session type hints, existing subscription cleanup policy functions.

---

### Task 1: Add Pre-Scan Cleanup Unit Tests

**Files:**
- Create: `backend/tests/test_pre_scan_cleanup.py`

- [ ] **Step 1: Write failing tests for movie cleanup branches**

Add a new test module with simple fake dependencies and three movie tests:

```python
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup,
)


class FakeDeps:
    def __init__(self, *, movie_status=None, feiniu_status=None, tv_status=None):
        self.deleted: list[int] = []
        self.step_logs: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.movie_status = movie_status or {"status": "not_found", "exists": False}
        self.feiniu_status = feiniu_status or {"checked": False, "exists": False}
        self.tv_status = tv_status or {"status": "error", "message": "not configured"}
        self.upcoming_calls = 0

    async def delete_subscription_with_records(self, db, subscription_id: int) -> None:
        self.deleted.append(subscription_id)

    async def create_step_log(self, db, **kwargs: Any) -> None:
        self.step_logs.append(kwargs)

    async def log_background_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)

    async def get_movie_status_by_tmdb(self, tmdb_id: int) -> dict[str, Any]:
        return self.movie_status

    async def check_feiniu_movie_status(self, tmdb_id: int) -> dict[str, Any]:
        return self.feiniu_status

    async def get_tv_missing_status(self, tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
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
        "tv_air_date": None,
        "tv_season": None,
        "tv_episode": None,
        "tv_year": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.anyio
async def test_deletes_movie_with_successful_transfer_before_library_checks():
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


@pytest.mark.anyio
async def test_deletes_movie_when_emby_reports_existing_item():
    fake = FakeDeps(movie_status={"status": "ok", "exists": True, "item_ids": ["emby-1"]})
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


@pytest.mark.anyio
async def test_movie_emby_failure_logs_warning_then_checks_feiniu():
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
```

- [ ] **Step 2: Write failing tests for TV cleanup branches and module boundary**

Extend the same file with TV and boundary tests:

```python
@pytest.mark.anyio
async def test_tv_missing_ok_returns_snapshot_without_cleanup_when_missing_remains():
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


@pytest.mark.anyio
async def test_tv_missing_ok_deletes_subscription_when_cleanup_policy_allows_it():
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


@pytest.mark.anyio
async def test_tv_missing_failure_logs_warning_without_cleanup():
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


def test_pre_scan_cleanup_module_keeps_runtime_dependencies_injected():
    import app.services.subscriptions.pre_scan_cleanup as module

    imported_names = set(module.__dict__)

    assert "subscription_service" not in imported_names
    assert "runtime_settings_service" not in imported_names
    assert "emby_service" not in imported_names
    assert "tv_missing_service" not in imported_names
    assert "AsyncSession" not in imported_names
```

- [ ] **Step 3: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_pre_scan_cleanup.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.pre_scan_cleanup'`.

### Task 2: Implement Extracted Helper

**Files:**
- Create: `backend/app/services/subscriptions/pre_scan_cleanup.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add the helper module**

Create `backend/app/services/subscriptions/pre_scan_cleanup.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.services.subscription_cleanup_policy import (
    build_tv_missing_status_kwargs,
    evaluate_tv_cleanup,
    normalize_tv_follow_mode,
)

DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]


@dataclass(frozen=True)
class PreScanCleanupDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    create_step_log: CreateStepLog
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes


def _media_type_value(sub: Any) -> str | None:
    media_type = getattr(sub, "media_type", None)
    value = getattr(media_type, "value", media_type)
    return str(value) if value is not None else None


def _empty_result() -> dict[str, Any]:
    return {"deleted": False, "tv_missing_snapshot": None}


async def evaluate_pre_scan_cleanup(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupDependencies,
) -> dict[str, Any]:
    if _media_type_value(sub) == "movie":
        return await _evaluate_movie_cleanup(
            db, run_id=run_id, channel=channel, sub=sub, dependencies=dependencies
        )

    if _media_type_value(sub) != "tv" or getattr(sub, "tmdb_id", None) is None:
        return _empty_result()

    return await _evaluate_tv_cleanup(
        db, run_id=run_id, channel=channel, sub=sub, dependencies=dependencies
    )
```

Then add private `_evaluate_movie_cleanup()` and `_evaluate_tv_cleanup()` by moving the exact branch bodies out of `SubscriptionService._evaluate_pre_scan_cleanup()`, replacing `self._create_step_log` with `dependencies.create_step_log`, `self._delete_subscription_with_records` with `dependencies.delete_subscription_with_records`, `operation_log_service.log_background_event` with `dependencies.log_background_event`, `emby_service.get_movie_status_by_tmdb` with `dependencies.get_movie_status_by_tmdb`, `self._check_feiniu_movie_status` with `dependencies.check_feiniu_movie_status`, `tv_missing_service.get_tv_missing_status` with `dependencies.get_tv_missing_status`, and `has_upcoming_episodes_in_subscription_scope` with `dependencies.has_upcoming_episodes`.

- [ ] **Step 2: Replace service method body with dependency injection wrapper**

In `backend/app/services/subscription_service.py`, import the helper:

```python
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
```

Replace `_evaluate_pre_scan_cleanup()` with a wrapper:

```python
    async def _evaluate_pre_scan_cleanup(
        self,
        db: AsyncSession,
        *,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
    ) -> dict[str, Any]:
        dependencies = PreScanCleanupDependencies(
            delete_subscription_with_records=self._delete_subscription_with_records,
            create_step_log=self._create_step_log,
            log_background_event=operation_log_service.log_background_event,
            get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
            check_feiniu_movie_status=self._check_feiniu_movie_status,
            get_tv_missing_status=tv_missing_service.get_tv_missing_status,
            has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
        )
        return await evaluate_pre_scan_cleanup_flow(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=dependencies,
        )
```

- [ ] **Step 3: Run focused green tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_pre_scan_cleanup.py
```

Expected: PASS.

### Task 3: Verify Integration and Commit

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Create: `backend/app/services/subscriptions/pre_scan_cleanup.py`
- Create: `backend/tests/test_pre_scan_cleanup.py`

- [ ] **Step 1: Run targeted regression tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_pre_scan_cleanup.py tests/test_subscription_cleanup_policy.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py tests/test_health.py
```

Expected: PASS.

- [ ] **Step 2: Confirm line count reduction**

Run:

```bash
wc -l backend/app/services/subscription_service.py backend/app/services/subscriptions/pre_scan_cleanup.py
```

Expected: `subscription_service.py` is substantially below 2835 lines, with pre-scan cleanup logic isolated in the new helper.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/pre_scan_cleanup.py backend/tests/test_pre_scan_cleanup.py
git commit -m "refactor: 抽离订阅预扫描清理"
```

Expected: commit succeeds and does not include unrelated untracked files.

- [ ] **Step 4: Run final verification before completion**

Run:

```bash
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
```

Expected: all commands exit 0. If the frontend build reports only the existing Vite chunk-size warning, treat it as a warning and continue.
