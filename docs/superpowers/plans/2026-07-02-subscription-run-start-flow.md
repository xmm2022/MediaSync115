# Subscription Run Start Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the run startup/context preparation block from `SubscriptionService.run_channel_check()` into a dependency-injected helper.

**Architecture:** Add `app.services.subscriptions.run_start_flow` for run id/time creation, start event logging, initial result creation, shared run context construction, subscription loading, checked count, `run_start` step log, and optional start progress callback. Keep channel normalization, dispatch, item processing, and finalize in `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing run state/counter/loader helpers, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Run Start Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_run_start_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)

ROOT = Path(__file__).resolve().parents[2]
```

Add tests that assert:

- Start flow writes the current `subscription.check.start` event shape.
- Start flow builds result with checked count equal to loaded subscriptions.
- Start flow writes the current `run_start` step shape and scope payload.
- Start progress callback receives `build_start_progress_payload(result)`.
- Without callback, flow still returns full context and does not publish progress.
- Dependency call order remains run id/time -> start event -> unlock/source context -> load subscriptions -> run_start step -> progress.
- Module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_start_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_start_flow'`.

### Task 2: Implement Run Start Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/run_start_flow.py`

- [ ] **Step 1: Define dependency and result types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class SubscriptionRunStartDependencies:
    log_background_event: Callable[..., Awaitable[None]]
    create_step_log: Callable[..., Awaitable[None]]
    load_active_subscriptions: Callable[[Any], Awaitable[list[Any]]]
    build_hdhive_unlock_context: Callable[[], dict[str, Any]]
    resolve_source_order: Callable[[str], list[str]]
    now: Callable[[], datetime]
    make_run_id: Callable[[], str]

@dataclass(frozen=True, slots=True)
class SubscriptionRunStartResult:
    run_id: str
    started_at: datetime
    result: dict[str, Any]
    hdhive_unlock_context: dict[str, Any]
    source_order: list[str]
    subscriptions: list[Any]
```

- [ ] **Step 2: Implement `start_subscription_run(...)`**

Required behavior:

- Accept `db`, `channel`, `force_auto_download`, `progress_callback`, and `dependencies`.
- Call `dependencies.make_run_id()` and `dependencies.now()`.
- Write start event with the existing action/status/message/trace/extra shape.
- Build result via `build_initial_run_result(channel, run_id, started_at)`.
- Build `hdhive_unlock_context` and `source_order`.
- Load subscriptions via `dependencies.load_active_subscriptions(db)`.
- Apply `set_checked_count(result, len(subscriptions))`.
- Write `run_start` step with current message and payload shape.
- If callback exists, await it with `build_start_progress_payload(result)`.
- Return `SubscriptionRunStartResult`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)
```

- [ ] **Step 2: Replace inline startup block**

After `normalized_channel = normalize_subscription_channel(channel)`, call:

```python
run_start = await start_subscription_run(
    db=db,
    channel=normalized_channel,
    force_auto_download=force_auto_download,
    progress_callback=progress_callback,
    dependencies=SubscriptionRunStartDependencies(
        log_background_event=operation_log_service.log_background_event,
        create_step_log=self._create_step_log,
        load_active_subscriptions=load_active_subscription_snapshots,
        build_hdhive_unlock_context=self._build_hdhive_unlock_context,
        resolve_source_order=self._resolve_source_order,
        now=beijing_now,
        make_run_id=lambda: uuid4().hex,
    ),
)
```

Then assign:

```python
run_id = run_start.run_id
started_at = run_start.started_at
result = run_start.result
hdhive_unlock_context = run_start.hdhive_unlock_context
source_order = run_start.source_order
subscriptions = run_start.subscriptions
```

- [ ] **Step 3: Remove unused imports if possible**

Remove `build_initial_run_result`, `build_start_progress_payload`, and `set_checked_count` from `subscription_service.py` if they are no longer used directly. Keep `uuid4`, `beijing_now`, and `load_active_subscription_snapshots` if passed into dependencies.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_start_flow.py tests/test_subscription_run_state.py tests/test_subscription_run_loader.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `run_channel_check()` starts by normalizing channel, then calling `start_subscription_run(...)`.
- `run_channel_check()` still owns dispatch and finalize.
- `run_start_flow.py` has no runtime service, ORM model, session, or `subscription_service` imports.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_start_flow.py backend/tests/test_subscription_run_start_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅运行启动 flow"
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
