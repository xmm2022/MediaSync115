# Subscription Item Processing Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-subscription `_process_subscription(sub)` orchestration from `SubscriptionService.run_channel_check()` into a dependency-injected item processing flow.

**Architecture:** Add `app.services.subscriptions.item_processing_run_flow` to coordinate the already extracted lifecycle, pre-scan cleanup, resource ingest, transfer phase, outcome, and progress helpers. Keep run-level context creation, subscription loading, dispatch, and finalize in `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription flow helpers, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Item Processing Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_item_processing_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)

ROOT = Path(__file__).resolve().parents[2]
```

Add small fakes:

- `FakeDb` with async `commit()` and `rollback()` recording events.
- `FakeSessionFactory` returning an async context manager around `FakeDb`.
- `_result()` helper containing the same counter keys used by run state/counter helpers.
- `_deps(events, **overrides)` helper returning `SubscriptionItemProcessingDependencies`.

Add tests that assert:

- Success path:
  - Opens one inner session.
  - Runs pre-scan cleanup, resource ingest, auto transfer, success outcome, and progress.
  - Updates `new_resource_count`, `auto_saved_count`, and `processed_count`.
  - Commits success and does not rollback.
- Pre-scan cleanup deleted path:
  - Applies cleanup stats and progress.
  - Does not fetch resources, transfer, or write success outcome.
  - Commits cleanup and does not rollback.
- Failure path:
  - If resource fetching raises, flow rolls back, applies failure stats, writes failed outcome, commits, and still publishes progress.
  - Exception does not propagate to caller.
- Module boundary:
  - Does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_item_processing_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.item_processing_run_flow'`.

### Task 2: Implement Item Processing Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/item_processing_run_flow.py`

- [ ] **Step 1: Define dependency type**

Implement:

```python
@dataclass(frozen=True, slots=True)
class SubscriptionItemProcessingDependencies:
    session_factory: Callable[[], Any]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    evaluate_pre_scan_cleanup: Callable[..., Awaitable[dict[str, Any]]]
    fetch_resources: Callable[..., Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]]]
    store_new_resources: Callable[[Any, int, list[dict[str, Any]]], Awaitable[dict[str, Any]]]
    load_retryable_records: Callable[[Any, int], Awaitable[list[Any]]]
    load_force_retry_records: Callable[[Any, int, list[str]], Awaitable[list[Any]]]
    auto_save_records_with_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
    should_scan_fixed_sources: Callable[..., bool]
    scan_fixed_sources_for_subscription: Callable[..., Awaitable[dict[str, Any]]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
```

- [ ] **Step 2: Implement `process_subscription_item(...)`**

Required behavior:

- Accept `sub`, `run_id`, `channel`, `force_auto_download`, `hdhive_unlock_context`, `source_order`, `result`, `result_lock`, `progress_callback`, `tv_media_type`, and `dependencies`.
- Open a session with `async with dependencies.session_factory() as inner_db`.
- Define run-level stats callbacks that mutate `result` only inside `result_lock`:
  - subscription failure
  - cleanup stats
  - resource store stats
  - auto transfer stats
  - fixed source stats
- Build `SubscriptionItemOutcomeDependencies` using the failure stats callback.
- In `try`, run lifecycle start, pre-scan cleanup, resource ingest, transfer phase, and success outcome in the existing order.
- If pre-scan cleanup returns `deleted=True`, return from the `try` block after cleanup flow, letting `finally` publish progress.
- In `except Exception as exc`, call `handle_subscription_item_failure(...)`.
- In `finally`, call `publish_subscription_item_progress(...)`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)
```

- [ ] **Step 2: Replace `_process_subscription()` body**

Keep the nested `_process_subscription(sub)` function but replace its body with:

```python
await process_subscription_item(
    sub=sub,
    run_id=run_id,
    channel=normalized_channel,
    force_auto_download=force_auto_download,
    hdhive_unlock_context=hdhive_unlock_context,
    source_order=source_order,
    result=result,
    result_lock=result_lock,
    progress_callback=progress_callback,
    tv_media_type=MediaType.TV,
    dependencies=SubscriptionItemProcessingDependencies(
        session_factory=async_session_maker,
        create_step_log=self._create_step_log,
        log_background_event=operation_log_service.log_background_event,
        evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup,
        fetch_resources=self._fetch_resources,
        store_new_resources=self._store_new_resources,
        load_retryable_records=self._load_retryable_records,
        load_force_retry_records=self._load_force_retry_records,
        auto_save_records_with_link_fallback=(
            self._auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=self._should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=(
            self._scan_fixed_sources_for_subscription
        ),
        delete_subscription_with_records=self._delete_subscription_with_records,
    ),
)
```

- [ ] **Step 3: Remove unused imports**

Remove direct imports no longer used by `subscription_service.py`:

- `SubscriptionItemLifecycleDependencies`
- `publish_subscription_item_progress`
- `start_subscription_item_processing`
- `PreScanCleanupRunDependencies`
- `run_pre_scan_cleanup_for_subscription`
- `ResourceIngestRunDependencies`
- `run_resource_ingest_for_subscription`
- `SubscriptionTransferPhaseDependencies`
- `run_subscription_transfer_phase`
- `SubscriptionItemOutcomeDependencies`
- `complete_subscription_item_success`
- `handle_subscription_item_failure`
- run counter helpers now used only by the new flow, while keeping `set_checked_count`.

Keep `asyncio` because `result_lock = asyncio.Lock()` and `asyncio.sleep` are still used.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_item_processing_run_flow.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_lifecycle_run_flow.py tests/test_subscription_item_outcome_run_flow.py tests/test_subscription_pre_scan_cleanup_run_flow.py tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains the old long `_process_subscription()` body.
- `run_channel_check()` still owns result initialization, checked count, dispatch, and finalize.
- `item_processing_run_flow.py` has no runtime service, ORM model, session, or `subscription_service` imports.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/item_processing_run_flow.py backend/tests/test_subscription_item_processing_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅单项处理 flow"
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
