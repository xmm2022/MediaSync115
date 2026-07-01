# Subscription Item Lifecycle Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract per-subscription start logging and processed/progress publication from `SubscriptionService.run_channel_check()` into a dependency-injected lifecycle helper.

**Architecture:** Add `app.services.subscriptions.item_lifecycle_run_flow` for start step logging and finally progress updates. Keep the run-level result object, async lock, and progress callback owned by `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription lifecycle log/state/counter helpers, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Item Lifecycle Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_item_lifecycle_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.item_lifecycle_run_flow import (
    SubscriptionItemLifecycleDependencies,
    publish_subscription_item_progress,
    start_subscription_item_processing,
)

ROOT = Path(__file__).resolve().parents[2]
```

Add tests that assert:

- start flow writes the current `subscription_start` step shape.
- progress flow increments `processed_count`, builds payload after increment, and invokes callback outside the lock.
- progress flow still increments and returns payload when callback is `None`.
- module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_item_lifecycle_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.item_lifecycle_run_flow'`.

### Task 2: Implement Item Lifecycle Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/item_lifecycle_run_flow.py`

- [ ] **Step 1: Define dependency type**

Implement:

```python
@dataclass(frozen=True, slots=True)
class SubscriptionItemLifecycleDependencies:
    create_step_log: Callable[..., Awaitable[None]]
```

- [ ] **Step 2: Implement `start_subscription_item_processing(...)`**

Required behavior:

- Call `dependencies.create_step_log(...)` with `run_id`, `channel`, subscription id/title, and `build_subscription_start_step(subscription_title)`.

- [ ] **Step 3: Implement `publish_subscription_item_progress(...)`**

Required behavior:

- Enter the passed async lock.
- Call `increment_processed_count(result)`.
- Build `progress_payload = build_processing_progress_payload(result)`.
- Exit the lock.
- If `progress_callback` is provided, await it with `progress_payload`.
- Return `progress_payload`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.item_lifecycle_run_flow import (
    SubscriptionItemLifecycleDependencies,
    publish_subscription_item_progress,
    start_subscription_item_processing,
)
```

- [ ] **Step 2: Replace start step**

Replace the inline `_create_step_log(... **build_subscription_start_step(...))` block with:

```python
await start_subscription_item_processing(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    subscription_id=sub_id,
    subscription_title=sub_title,
    dependencies=SubscriptionItemLifecycleDependencies(
        create_step_log=self._create_step_log,
    ),
)
```

- [ ] **Step 3: Replace finally progress block**

Replace the `finally` block body with:

```python
await publish_subscription_item_progress(
    result=result,
    result_lock=result_lock,
    progress_callback=progress_callback,
)
```

- [ ] **Step 4: Remove imports no longer used directly by service**

Remove direct imports for `build_subscription_start_step` and `increment_processed_count` if unused.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_item_lifecycle_run_flow.py tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_state.py tests/test_subscription_run_counters.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer directly builds item start step or progress callback payload in `_process_subscription()`.
- `item_lifecycle_run_flow.py` has no runtime service, ORM model, or session imports.
- Success/failure outcome flow remains unchanged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/item_lifecycle_run_flow.py backend/tests/test_subscription_item_lifecycle_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅单项生命周期 flow"
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
