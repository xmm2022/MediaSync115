# 订阅完成后清理 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move completed-cleanup runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.completed_cleanup_runtime_adapter` to bind operation logging, Emby, TV missing, upcoming-policy helper, retry sleep, and the existing completed-cleanup core runners. Keep `cleanup_completed_subscriptions()` and `cleanup_single_subscription()` on `SubscriptionService` as compatibility wrappers that pass service-local deletion and Feiniu status callbacks.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder for runtime services, sleep, and core runners.
  - Runtime wrappers for batch completed cleanup and single-subscription cleanup.
- Create: `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
  - Red/green tests for dependency translation, default bindings, batch/single forwarding, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `cleanup_completed_subscriptions()` and `cleanup_single_subscription()` to the runtime adapter.
  - Remove `_completed_cleanup_dependencies()`.
  - Remove direct imports of completed-cleanup core dependency/runners and no-longer-used runtime services.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`:

```python
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
    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
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
        await dependencies.delete_subscription_with_records(current_db, 11)
        await dependencies.log_background_event(action="cleanup")
        movie_status = await dependencies.get_movie_status_by_tmdb(1001)
        feiniu_status = await dependencies.check_feiniu_movie_status(1001)
        tv_status = await dependencies.get_tv_missing_status(1001, scope="all")
        upcoming = await dependencies.has_upcoming_episodes(1001, "sub")
        await dependencies.sleep(1.5)
        return {
            "movie_status": movie_status,
            "feiniu_status": feiniu_status,
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
        "feiniu_status": {"checked": True, "exists": False},
        "tv_status": {"status": "ok"},
        "upcoming": True,
    }
    assert calls[0] == ("runner", db, calls[0][2])
    assert isinstance(calls[0][2], CompletedCleanupDependencies)
    assert calls[1:] == [
        ("delete", db, 11),
        ("event", {"action": "cleanup"}),
        ("emby", 1001),
        ("feiniu", 1001),
        ("tv_missing", 1001, {"scope": "all"}),
        ("upcoming", 1001, "sub"),
        ("sleep", 1.5),
    ]


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
        calls.append((current_db, subscription_id, dependencies))
        return {"deleted": True, "reason": "movie completed"}

    result = await cleanup_single_subscription_with_runtime_adapter(
        db,
        77,
        dependencies=_dependencies(
            run_cleanup_single_subscription=run_cleanup_single_subscription,
        ),
    )

    assert result == {"deleted": True, "reason": "movie completed"}
    assert len(calls) == 1
    assert calls[0][0] is db
    assert calls[0][1] == 77
    assert isinstance(calls[0][2], CompletedCleanupDependencies)


def test_build_completed_cleanup_dependencies_exposes_runtime_callbacks() -> None:
    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
        return None

    dependencies = _dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
    )

    lower = build_completed_cleanup_dependencies(dependencies)

    assert lower.delete_subscription_with_records is delete_subscription_with_records
    assert lower.check_feiniu_movie_status is dependencies.check_feiniu_movie_status
    assert lower.log_background_event is dependencies.log_background_event
    assert lower.get_movie_status_by_tmdb is dependencies.get_movie_status_by_tmdb
    assert lower.get_tv_missing_status is dependencies.get_tv_missing_status
    assert lower.has_upcoming_episodes is dependencies.has_upcoming_episodes
    assert lower.sleep is dependencies.sleep


def test_default_runtime_dependencies_bind_existing_services_sleep_and_runners() -> None:
    async def delete_subscription_with_records(_db: Any, _subscription_id: int) -> None:
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
    assert (
        dependencies.run_cleanup_completed_subscriptions
        is cleanup_completed_subscriptions_flow
    )
    assert (
        dependencies.run_cleanup_single_subscription
        is cleanup_single_subscription_flow
    )


def test_completed_cleanup_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_completed_cleanup_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.completed_cleanup_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`:

```python
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

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
from app.services.tv_missing_service import tv_missing_service


DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[Any]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
Sleep = Callable[[float], Awaitable[None]]
RunCleanupCompletedSubscriptions = Callable[..., Awaitable[dict[str, Any]]]
RunCleanupSingleSubscription = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class CompletedCleanupRuntimeDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes
    sleep: Sleep
    run_cleanup_completed_subscriptions: RunCleanupCompletedSubscriptions
    run_cleanup_single_subscription: RunCleanupSingleSubscription


def build_default_completed_cleanup_runtime_dependencies(
    *,
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
    check_feiniu_movie_status: CheckFeiniuMovieStatus,
) -> CompletedCleanupRuntimeDependencies:
    return CompletedCleanupRuntimeDependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        check_feiniu_movie_status=check_feiniu_movie_status,
        log_background_event=operation_log_service.log_background_event,
        get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
        sleep=asyncio.sleep,
        run_cleanup_completed_subscriptions=cleanup_completed_subscriptions_flow,
        run_cleanup_single_subscription=cleanup_single_subscription_flow,
    )


def build_completed_cleanup_dependencies(
    dependencies: CompletedCleanupRuntimeDependencies,
) -> CompletedCleanupDependencies:
    return CompletedCleanupDependencies(
        delete_subscription_with_records=(
            dependencies.delete_subscription_with_records
        ),
        log_background_event=dependencies.log_background_event,
        get_movie_status_by_tmdb=dependencies.get_movie_status_by_tmdb,
        check_feiniu_movie_status=dependencies.check_feiniu_movie_status,
        get_tv_missing_status=dependencies.get_tv_missing_status,
        has_upcoming_episodes=dependencies.has_upcoming_episodes,
        sleep=dependencies.sleep,
    )


async def cleanup_completed_subscriptions_with_runtime_adapter(
    db: Any,
    *,
    dependencies: CompletedCleanupRuntimeDependencies,
) -> dict[str, Any]:
    return await dependencies.run_cleanup_completed_subscriptions(
        db,
        dependencies=build_completed_cleanup_dependencies(dependencies),
    )


async def cleanup_single_subscription_with_runtime_adapter(
    db: Any,
    subscription_id: int,
    *,
    dependencies: CompletedCleanupRuntimeDependencies,
) -> dict[str, Any]:
    return await dependencies.run_cleanup_single_subscription(
        db,
        subscription_id,
        dependencies=build_completed_cleanup_dependencies(dependencies),
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_completed_cleanup_runtime_adapter.py
```

Expected: PASS.

## Task 3: Connect SubscriptionService Wrappers

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add imports and replace wrappers**

In `backend/app/services/subscription_service.py`, add:

```python
from app.services.subscriptions.completed_cleanup_runtime_adapter import (
    build_default_completed_cleanup_runtime_dependencies,
    cleanup_completed_subscriptions_with_runtime_adapter,
    cleanup_single_subscription_with_runtime_adapter,
)
```

Remove:

```python
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
    cleanup_completed_subscriptions as cleanup_completed_subscriptions_flow,
    cleanup_single_subscription as cleanup_single_subscription_flow,
)
```

Remove the `_completed_cleanup_dependencies()` method.

Replace `cleanup_completed_subscriptions()` with:

```python
    async def cleanup_completed_subscriptions(
        self, db: AsyncSession
    ) -> dict[str, Any]:
        """离线下载完成后检查并清理已完成的订阅（电影已转存或剧集不缺集）"""
        return await cleanup_completed_subscriptions_with_runtime_adapter(
            db,
            dependencies=build_default_completed_cleanup_runtime_dependencies(
                delete_subscription_with_records=(
                    self._delete_subscription_with_records
                ),
                check_feiniu_movie_status=self._check_feiniu_movie_status,
            ),
        )
```

Replace `cleanup_single_subscription()` with:

```python
    async def cleanup_single_subscription(
        self, db: AsyncSession, subscription_id: int
    ) -> dict[str, Any]:
        """检查并清理单个订阅（电影已转存/已在库 或 剧集不缺集）"""
        return await cleanup_single_subscription_with_runtime_adapter(
            db,
            subscription_id,
            dependencies=build_default_completed_cleanup_runtime_dependencies(
                delete_subscription_with_records=(
                    self._delete_subscription_with_records
                ),
                check_feiniu_movie_status=self._check_feiniu_movie_status,
            ),
        )
```

If no longer used, remove direct imports of `emby_service`, `tv_missing_service`, and `has_upcoming_episodes_in_subscription_scope`.

- [ ] **Step 2: Run related targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_completed_cleanup.py tests/test_subscription_cleanup_policy.py
```

Expected: PASS.

- [ ] **Step 3: Inspect direct completed cleanup imports**

Run:

```bash
rg -n "CompletedCleanupDependencies|cleanup_completed_subscriptions_flow|cleanup_single_subscription_flow|completed_cleanup_runtime_adapter|emby_service|tv_missing_service|has_upcoming_episodes_in_subscription_scope" backend/app/services/subscription_service.py backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py
```

Expected: core dependency/runners and runtime service bindings appear only in `completed_cleanup_runtime_adapter.py`; `subscription_service.py` only references runtime adapter helpers.

## Task 4: Commit and Verify

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Create: `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
- Create: `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`

- [ ] **Step 1: Check status**

Run:

```bash
git status --short
```

Expected: implementation files plus the two allowed pre-existing untracked files.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py backend/tests/test_subscription_completed_cleanup_runtime_adapter.py
git commit -m "refactor: 抽离订阅完成后清理 runtime adapter"
```

Expected: commit succeeds.

- [ ] **Step 3: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: PASS.

- [ ] **Step 6: Rebuild and start Docker service**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: command exits 0 and starts `mediasync115`.

- [ ] **Step 7: Wait for Docker health**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
```

Expected: exits 0 after printing `health=healthy`.

- [ ] **Step 8: Final state checks**

Run:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
git log --oneline -12
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- compose status shows `mediasync115` up and healthy.
- Docker inspect prints `healthy`.
- `git status --short` only shows:
  - `?? backend/scripts/export_hdhive_189_links.py`
  - `?? docs/next-session-prompt.md`
- `subscription_service.py` line count is lower than before this block.

## Self-Review

- Spec coverage: plan covers runtime adapter creation, service wrapper connection, related regression tests, full verification, Docker health check, and final status constraints.
- Placeholder scan: no unresolved placeholder wording is present.
- Type consistency: test dependency names match `CompletedCleanupRuntimeDependencies`; implementation and service wrapper names match the planned imports.
