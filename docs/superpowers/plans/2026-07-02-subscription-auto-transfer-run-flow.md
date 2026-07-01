# Subscription Auto Transfer Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-subscription auto-transfer run branch from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper.

**Architecture:** Add `app.services.subscriptions.auto_transfer_run_flow` to orchestrate new/retry auto-transfer, transfer logs, transfer summary, and cleanup-after-transfer. Keep database sessions, concrete service methods, operation logging, and run result locking injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription helper modules, SQLAlchemy sessions only at service boundary.

---

### Task 1: Add Auto Transfer Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.auto_transfer_run_flow import (
    AutoTransferRunDependencies,
    run_auto_transfer_for_subscription,
)

ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 101,
        "title": "示例影片",
        "auto_download": True,
        "media_type": MediaType.MOVIE,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _deps(events: list[Any], **overrides: Any) -> AutoTransferRunDependencies:
    async def select_retry_records(**_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"saved": 0, "failed": 0}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def delete_subscription_with_records(_db: Any, subscription_id: int) -> None:
        events.append(("delete", subscription_id))

    async def apply_auto_transfer_stats(stats: dict[str, Any], transfer_source: str) -> None:
        events.append(("apply_auto", transfer_source, stats))

    async def apply_cleanup_stats(media_type: Any) -> None:
        events.append(("apply_cleanup", media_type))

    values: dict[str, Any] = {
        "select_retry_records": select_retry_records,
        "auto_save_records_with_link_fallback": auto_save_records_with_link_fallback,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "delete_subscription_with_records": delete_subscription_with_records,
        "apply_auto_transfer_stats": apply_auto_transfer_stats,
        "apply_cleanup_stats": apply_cleanup_stats,
    }
    values.update(overrides)
    return AutoTransferRunDependencies(**values)
```

Add tests that assert:

- disabled auto-transfer writes only `auto_transfer_skip`, returns zero counts, and does not select retry records.
- new transfer completion skips retry, deletes the subscription, writes cleanup logs, applies new stats, and applies cleanup stats.
- new then retry transfer accumulates saved/failed counts, applies separate new/retry stats, and passes `enable_link_refetch=False` to retry.
- module boundary does not import `subscription_service`, runtime settings, external services, API, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_run_flow'`.

### Task 2: Implement Auto Transfer Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_run_flow.py`

- [ ] **Step 1: Define result and dependency types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class AutoTransferRunResult:
    sub_saved_count: int
    sub_failed_transfer_count: int
    cleanup_after_auto: dict[str, Any] | None
    retry_records: list[Any]


@dataclass(frozen=True, slots=True)
class AutoTransferRunDependencies:
    select_retry_records: Callable[..., Awaitable[list[Any]]]
    auto_save_records_with_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
    apply_auto_transfer_stats: Callable[[dict[str, Any], str], Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]
```

- [ ] **Step 2: Implement source runner helper**

Implement an internal helper that:

- writes start step and background event using `run_transfer_logs`.
- calls `auto_save_records_with_link_fallback(...)` with positional arguments matching the current service method.
- passes `enable_link_refetch=False` only for retry.
- writes done step and background event.
- returns stats.

- [ ] **Step 3: Implement `run_auto_transfer_for_subscription(...)`**

Required behavior:

- If `should_auto_download` is false, write `build_auto_transfer_skip_step()` and return zero counts.
- Select retry records only when auto-transfer is enabled.
- Execute new records when `created_records` is non-empty.
- Execute retry records only when present and no previous transfer returned `subscription_completed`.
- Always write `build_auto_transfer_summary_step(...)` for enabled auto-transfer.
- Cleanup completed subscriptions by calling `delete_subscription_with_records`, logging cleanup event/step, and applying cleanup stats.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.auto_transfer_run_flow import (
    AutoTransferRunDependencies,
    run_auto_transfer_for_subscription,
)
```

- [ ] **Step 2: Replace inline auto-transfer branch**

Replace the existing `if should_auto_download: ... else: ...` block with:

```python
auto_transfer_result = await run_auto_transfer_for_subscription(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    sub=sub,
    should_auto_download=should_auto_download,
    force_auto_download=force_auto_download,
    duplicate_urls=duplicate_urls,
    created_records=created_records,
    tv_missing_snapshot=tv_missing_snapshot,
    hdhive_unlock_context=hdhive_unlock_context,
    source_order=source_order,
    dependencies=AutoTransferRunDependencies(...),
)
sub_saved_count = auto_transfer_result.sub_saved_count
sub_failed_transfer_count = auto_transfer_result.sub_failed_transfer_count
cleanup_after_auto = auto_transfer_result.cleanup_after_auto
```

The injected callbacks should wrap `result_lock` around `apply_auto_transfer_stats(...)` and `apply_cleanup_stats(...)` to preserve current synchronization.

- [ ] **Step 3: Remove imports no longer used directly by service**

Remove direct imports for auto-transfer log and cleanup-after-transfer builders if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_run_transfer_logs.py tests/test_subscription_run_cleanup_logs.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` keeps only orchestration and injected callbacks for this branch.
- `auto_transfer_run_flow.py` has no runtime service or SQLAlchemy session imports.
- Existing retry selection and link fallback helpers remain unchanged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/auto_transfer_run_flow.py backend/tests/test_subscription_auto_transfer_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅自动转存运行 flow"
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
