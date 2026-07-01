# Subscription Item Outcome Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-subscription success and failure outcome branch from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper.

**Architecture:** Add `app.services.subscriptions.item_outcome_run_flow` to orchestrate done/failed lifecycle logs, failure stat application, rollback, and commit. Keep resource fetching, transfer execution, fixed-source scanning, and progress updates in `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription lifecycle log helpers, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Item Outcome Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_item_outcome_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.item_outcome_run_flow import (
    SubscriptionItemOutcomeDependencies,
    complete_subscription_item_success,
    handle_subscription_item_failure,
)

ROOT = Path(__file__).resolve().parents[2]


class FakeDb:
    def __init__(self) -> None:
        self.events: list[str] = []

    async def commit(self) -> None:
        self.events.append("commit")

    async def rollback(self) -> None:
        self.events.append("rollback")
```

Add tests that assert:

- success outcome writes done step/event with current helper shape and commits once.
- success outcome does not call failure stat callback.
- failure outcome rolls back, applies failure stats with the original error object, writes failed step/event, and commits once.
- module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_item_outcome_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.item_outcome_run_flow'`.

### Task 2: Implement Item Outcome Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/item_outcome_run_flow.py`

- [ ] **Step 1: Define dependency type**

Implement:

```python
@dataclass(frozen=True, slots=True)
class SubscriptionItemOutcomeDependencies:
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    apply_subscription_failure: Callable[[int, str, BaseException], Awaitable[None]]
```

- [ ] **Step 2: Implement `complete_subscription_item_success(...)`**

Required behavior:

- Write done step with `build_subscription_done_step()`.
- Write done event with `build_subscription_done_event_kwargs(...)`.
- Commit the passed `db`.

- [ ] **Step 3: Implement `handle_subscription_item_failure(...)`**

Required behavior:

- Roll back the passed `db`.
- Call `apply_subscription_failure(subscription_id, subscription_title, error)`.
- Write failed step with `build_subscription_failed_step(error)`.
- Write failed event with `build_subscription_failed_event_kwargs(...)`.
- Commit the passed `db`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.item_outcome_run_flow import (
    SubscriptionItemOutcomeDependencies,
    complete_subscription_item_success,
    handle_subscription_item_failure,
)
```

- [ ] **Step 2: Replace success outcome branch**

Replace the success done step/event/commit block with:

```python
await complete_subscription_item_success(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    subscription_id=sub_id,
    subscription_title=sub_title,
    new_record_count=len(created_records),
    should_auto_download=should_auto_download,
    sub_saved_count=sub_saved_count,
    sub_failed_transfer_count=sub_failed_transfer_count,
    dependencies=SubscriptionItemOutcomeDependencies(...),
)
```

- [ ] **Step 3: Replace failure outcome branch**

Replace the `except` branch body with:

```python
async def apply_subscription_failure_for_run(
    subscription_id: int,
    title: str,
    error: BaseException,
) -> None:
    async with result_lock:
        apply_subscription_failure(
            result,
            subscription_id=subscription_id,
            title=title,
            error=error,
        )

await handle_subscription_item_failure(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    subscription_id=sub_id,
    subscription_title=sub_title,
    error=exc,
    dependencies=SubscriptionItemOutcomeDependencies(...),
)
```

- [ ] **Step 4: Remove imports no longer used directly by service**

Remove direct imports for done/failed lifecycle log builders if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_item_outcome_run_flow.py tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_counters.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains inline done/failed outcome log orchestration.
- `item_outcome_run_flow.py` has no runtime service, ORM model, or session imports.
- `finally` progress handling remains in `run_channel_check()`.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/item_outcome_run_flow.py backend/tests/test_subscription_item_outcome_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅单项收尾 flow"
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

- [ ] **Step 4: Docker build and health check**

```bash
docker compose up -d --build mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
```

- [ ] **Step 5: Final worktree check**

```bash
git status --short
wc -l backend/app/services/subscription_service.py
```

Only these untracked files may remain:

- `backend/scripts/export_hdhive_189_links.py`
- `docs/next-session-prompt.md`
