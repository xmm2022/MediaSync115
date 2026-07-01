# Subscription Run Finalize Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the run-level finalization branch from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper.

**Architecture:** Add `app.services.subscriptions.run_finalize_flow` for status resolution, unlock stat application, finish event logging, execution log persistence, finish step logging, pruning, and finalize-error fallback. Keep the existing pure helpers in `run_summary.py` and `run_completion.py`; keep concrete service methods and database object injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription helper modules, SQLAlchemy session methods only through the passed `db` object.

---

### Task 1: Add Run Finalize Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_run_finalize_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
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
```

Add tests that assert:

- successful finalize applies unlock stats, completes result, logs finish event, writes execution log, writes run_finish step, prunes logs, and commits once.
- execution log failure rolls back, applies finalize error to result, writes `run_finalize_failed` step, and commits the fallback.
- fallback step failure rolls back a second time and still returns the original finalize error.
- module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_finalize_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_finalize_flow'`.

### Task 2: Implement Run Finalize Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/run_finalize_flow.py`

- [ ] **Step 1: Define result and dependency types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class RunFinalizeResult:
    status: Any
    message: str
    finished_at: datetime
    finalize_error: str


@dataclass(frozen=True, slots=True)
class RunFinalizeDependencies:
    log_background_event: Callable[..., Awaitable[None]]
    create_execution_log: Callable[..., Awaitable[None]]
    create_step_log: Callable[..., Awaitable[None]]
    prune_step_logs: Callable[[Any], Awaitable[None]]
    now: Callable[[], datetime]
```

- [ ] **Step 2: Implement `finalize_subscription_run(...)`**

Required behavior:

- Resolve status with `resolve_run_status(...)` and the provided status enum-like objects.
- Apply `apply_hdhive_unlock_stats(result, hdhive_unlock_context.get("stats", {}))`.
- Build message with `build_run_message(result)`.
- Set `finished_at = dependencies.now()`.
- Complete result with `complete_run_result(...)`.
- Log finish event using `build_run_finish_event_message(...)` and `build_run_finish_event_extra(...)`.
- Try to create execution log, create run_finish step, prune step logs, and `await db.commit()`.
- On failure, rollback, apply `apply_run_finalize_error(...)`, try to create run_finalize_failed step and commit.
- If fallback step fails, rollback again.
- Return `RunFinalizeResult`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
```

- [ ] **Step 2: Replace inline finalization branch**

Replace the block after `await asyncio.gather(...)` with:

```python
await finalize_subscription_run(
    db=db,
    channel=normalized_channel,
    run_id=run_id,
    result=result,
    started_at=started_at,
    hdhive_unlock_context=hdhive_unlock_context,
    success_status=ExecutionStatus.SUCCESS,
    failed_status=ExecutionStatus.FAILED,
    partial_status=ExecutionStatus.PARTIAL,
    dependencies=RunFinalizeDependencies(
        log_background_event=operation_log_service.log_background_event,
        create_execution_log=self._create_execution_log,
        create_step_log=self._create_step_log,
        prune_step_logs=self._prune_step_logs,
        now=beijing_now,
    ),
)
return result
```

- [ ] **Step 3: Remove imports no longer used directly by service**

Remove direct imports for run finalize helper functions if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_finalize_flow.py tests/test_subscription_run_completion.py tests/test_subscription_run_summary.py tests/test_subscription_execution_logs.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains inline run finish/finalize failure handling.
- `run_finalize_flow.py` has no runtime service, ORM model, or session imports.
- `run_summary.py` and `run_completion.py` remain unchanged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_finalize_flow.py backend/tests/test_subscription_run_finalize_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅运行收尾 flow"
```

### Task 5: Full Completion Standard

- [ ] **Step 1: Backend full verification**

```bash
scripts/verify-backend.sh
```

- [ ] **Step 2: Frontend build**

```bash
npm --prefix frontend run build
```

- [ ] **Step 3: Quick repository verification**

```bash
scripts/verify.sh --quick
```

- [ ] **Step 4: Docker rebuild and health**

```bash
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected final status: only the two known untracked files remain:

- `backend/scripts/export_hdhive_189_links.py`
- `docs/next-session-prompt.md`

This session will execute inline without asking for an execution-mode choice because the user explicitly requested continuous progress between blocks.
