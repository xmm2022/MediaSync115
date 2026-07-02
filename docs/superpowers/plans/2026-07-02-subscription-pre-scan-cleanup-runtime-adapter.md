# 订阅预扫描清理 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pre-scan cleanup runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.pre_scan_cleanup_runtime_adapter` to bind Emby, TV missing, operation log, upcoming-policy helper, and the existing pure `pre_scan_cleanup.evaluate_pre_scan_cleanup()` runner. Keep `SubscriptionService._evaluate_pre_scan_cleanup()` as a compatibility wrapper that passes service-local callbacks for deletion, step logging, and Feiniu movie status.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder for runtime services and core runner.
  - Runtime wrapper that translates runtime dependencies into `PreScanCleanupDependencies`.
- Create: `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`
  - Red/green tests for wrapper dependency translation, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_evaluate_pre_scan_cleanup()` to the runtime adapter.
  - Remove direct use of `PreScanCleanupDependencies` and `evaluate_pre_scan_cleanup_flow`.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`:

```python
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

    async def check_feiniu_movie_status(_tmdb_id: int) -> dict[str, Any]:
        return {"checked": False}

    dependencies = build_default_pre_scan_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
        check_feiniu_movie_status=check_feiniu_movie_status,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )
    assert dependencies.create_step_log is create_step_log
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
    assert dependencies.run_evaluate_pre_scan_cleanup is evaluate_pre_scan_cleanup_flow


def test_pre_scan_cleanup_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.pre_scan_cleanup_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.emby_service import emby_service
from app.services.operation_log_service import operation_log_service
from app.services.subscription_cleanup_policy import (
    has_upcoming_episodes_in_subscription_scope,
)
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
from app.services.tv_missing_service import tv_missing_service


DeleteSubscriptionWithRecords = Callable[[Any, int], Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
CheckFeiniuMovieStatus = Callable[[int], Awaitable[dict[str, Any]]]
LogBackgroundEvent = Callable[..., Awaitable[None]]
GetMovieStatusByTmdb = Callable[[int], Awaitable[dict[str, Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
RunEvaluatePreScanCleanup = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class PreScanCleanupRuntimeDependencies:
    delete_subscription_with_records: DeleteSubscriptionWithRecords
    create_step_log: CreateStepLog
    check_feiniu_movie_status: CheckFeiniuMovieStatus
    log_background_event: LogBackgroundEvent
    get_movie_status_by_tmdb: GetMovieStatusByTmdb
    get_tv_missing_status: GetTvMissingStatus
    has_upcoming_episodes: HasUpcomingEpisodes
    run_evaluate_pre_scan_cleanup: RunEvaluatePreScanCleanup


def build_default_pre_scan_cleanup_runtime_dependencies(
    *,
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
    create_step_log: CreateStepLog,
    check_feiniu_movie_status: CheckFeiniuMovieStatus,
) -> PreScanCleanupRuntimeDependencies:
    return PreScanCleanupRuntimeDependencies(
        delete_subscription_with_records=delete_subscription_with_records,
        create_step_log=create_step_log,
        check_feiniu_movie_status=check_feiniu_movie_status,
        log_background_event=operation_log_service.log_background_event,
        get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
        run_evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup_flow,
    )


async def evaluate_pre_scan_cleanup_with_runtime_adapter(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: PreScanCleanupRuntimeDependencies,
) -> dict[str, Any]:
    return await dependencies.run_evaluate_pre_scan_cleanup(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        dependencies=PreScanCleanupDependencies(
            delete_subscription_with_records=(
                dependencies.delete_subscription_with_records
            ),
            create_step_log=dependencies.create_step_log,
            log_background_event=dependencies.log_background_event,
            get_movie_status_by_tmdb=dependencies.get_movie_status_by_tmdb,
            check_feiniu_movie_status=dependencies.check_feiniu_movie_status,
            get_tv_missing_status=dependencies.get_tv_missing_status,
            has_upcoming_episodes=dependencies.has_upcoming_episodes,
        ),
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py
```

Expected: PASS.

## Task 3: Connect SubscriptionService Wrapper

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add imports and replace method body**

In `backend/app/services/subscription_service.py`, add:

```python
from app.services.subscriptions.pre_scan_cleanup_runtime_adapter import (
    build_default_pre_scan_cleanup_runtime_dependencies,
    evaluate_pre_scan_cleanup_with_runtime_adapter,
)
```

Remove:

```python
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
```

Replace `_evaluate_pre_scan_cleanup()` with:

```python
    async def _evaluate_pre_scan_cleanup(
        self,
        db: AsyncSession,
        *,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
    ) -> dict[str, Any]:
        return await evaluate_pre_scan_cleanup_with_runtime_adapter(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_pre_scan_cleanup_runtime_dependencies(
                delete_subscription_with_records=(
                    self._delete_subscription_with_records
                ),
                create_step_log=self._create_step_log,
                check_feiniu_movie_status=self._check_feiniu_movie_status,
            ),
        )
```

- [ ] **Step 2: Run related targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_subscription_pre_scan_cleanup_run_flow.py tests/test_subscription_item_processing_run_flow.py
```

Expected: PASS.

- [ ] **Step 3: Inspect direct pre-scan imports**

Run:

```bash
rg -n "PreScanCleanupDependencies|evaluate_pre_scan_cleanup_flow|pre_scan_cleanup_runtime_adapter" backend/app/services/subscription_service.py backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py
```

Expected: core dependency type and runner appear only in `pre_scan_cleanup_runtime_adapter.py`; `subscription_service.py` only references the runtime adapter helpers.

## Task 4: Commit and Verify

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Create: `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`
- Create: `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`

- [ ] **Step 1: Check status**

Run:

```bash
git status --short
```

Expected: implementation files plus the two allowed pre-existing untracked files.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py
git commit -m "refactor: 抽离订阅预扫描清理 runtime adapter"
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
- Type consistency: test dependency names match `PreScanCleanupRuntimeDependencies`; implementation and service wrapper names match the planned imports.
