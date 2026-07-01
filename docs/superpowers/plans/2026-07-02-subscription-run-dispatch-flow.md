# Subscription Run Dispatch Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the semaphore/gather subscription dispatch loop from `SubscriptionService.run_channel_check()` into a dependency-injected helper without moving per-subscription business orchestration.

**Architecture:** Add `app.services.subscriptions.run_dispatch_flow` for bounded concurrent dispatch. Keep `_process_subscription()` in `SubscriptionService` so existing session creation, result locking, progress callbacks, and stage dependency wiring remain unchanged.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, standard-library `asyncio`, existing subscription service wiring.

---

### Task 1: Add Run Dispatch Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_run_dispatch_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)

ROOT = Path(__file__).resolve().parents[2]
```

Add tests that assert:

- Empty subscriptions do not call `process_subscription`.
- Multiple subscriptions are each processed once while `max_active` never exceeds the passed concurrency limit.
- Exceptions raised by `process_subscription` propagate out of `dispatch_subscription_checks()`.
- Module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_dispatch_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_dispatch_flow'`.

### Task 2: Implement Run Dispatch Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/run_dispatch_flow.py`

- [ ] **Step 1: Define dependency type**

Implement:

```python
@dataclass(frozen=True, slots=True)
class SubscriptionRunDispatchDependencies:
    process_subscription: Callable[[Any], Awaitable[None]]
```

- [ ] **Step 2: Implement `dispatch_subscription_checks(...)`**

Required behavior:

- Accept `subscriptions`, `concurrency`, and `dependencies`.
- Create `asyncio.Semaphore(concurrency)`.
- Define an internal bounded coroutine that awaits `dependencies.process_subscription(sub)` inside the semaphore.
- If the subscriptions list is non-empty, await `asyncio.gather(...)` over all bounded coroutines.
- Return `None`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)
```

- [ ] **Step 2: Replace inline dispatch**

Remove:

```python
scan_semaphore = asyncio.Semaphore(_SUBSCRIPTION_SCAN_CONCURRENCY)
```

and the `_bounded_subscription()` helper plus inline `asyncio.gather(...)`.

Replace it with:

```python
await dispatch_subscription_checks(
    subscriptions=subscriptions,
    concurrency=_SUBSCRIPTION_SCAN_CONCURRENCY,
    dependencies=SubscriptionRunDispatchDependencies(
        process_subscription=_process_subscription,
    ),
)
```

- [ ] **Step 3: Remove unused import**

If `subscription_service.py` no longer directly uses `asyncio`, remove `import asyncio`.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_lifecycle_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer creates the scan semaphore or calls `asyncio.gather()` directly.
- `_process_subscription()` remains in `run_channel_check()`.
- `run_dispatch_flow.py` has no runtime service, ORM model, session, or `subscription_service` imports.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_dispatch_flow.py backend/tests/test_subscription_run_dispatch_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅运行派发 flow"
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
