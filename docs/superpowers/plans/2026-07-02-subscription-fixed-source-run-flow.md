# Subscription Fixed Source Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the fixed-source run tail from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper.

**Architecture:** Add `app.services.subscriptions.fixed_source_run_flow` to decide whether fixed-source scan should run, apply fixed-source saved/failed deltas, and perform movie cleanup after fixed-source transfer. Keep actual fixed-source scanning in `fixed_source_scan.py`; keep concrete DB/session, operation logging, and result locking injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription helper modules, SQLAlchemy sessions only at service boundary.

---

### Task 1: Add Fixed Source Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_fixed_source_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.fixed_source_run_flow import (
    FixedSourceRunDependencies,
    run_fixed_source_for_subscription,
)

ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {
        "id": 101,
        "title": "示例影片",
        "media_type": MediaType.MOVIE,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _deps(events: list[Any], **overrides: Any) -> FixedSourceRunDependencies:
    def should_scan_fixed_sources(_sub: Any, *, force_auto_download: bool) -> bool:
        events.append(("policy", force_auto_download))
        return True

    async def scan_fixed_sources_for_subscription(_db: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("scan", kwargs))
        return {"saved": 0, "failed": 0, "checked": 0}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def delete_subscription_with_records(_db: Any, subscription_id: int) -> None:
        events.append(("delete", subscription_id))

    async def apply_fixed_source_transfer_stats(saved: int, failed: int) -> None:
        events.append(("apply_fixed", saved, failed))

    async def apply_cleanup_stats(media_type: Any) -> None:
        events.append(("apply_cleanup", media_type))

    values: dict[str, Any] = {
        "should_scan_fixed_sources": should_scan_fixed_sources,
        "scan_fixed_sources_for_subscription": scan_fixed_sources_for_subscription,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "delete_subscription_with_records": delete_subscription_with_records,
        "apply_fixed_source_transfer_stats": apply_fixed_source_transfer_stats,
        "apply_cleanup_stats": apply_cleanup_stats,
    }
    values.update(overrides)
    return FixedSourceRunDependencies(**values)
```

Add tests that assert:

- `cleanup_after_auto` skips policy, scan, and all side effects.
- policy false skips scan and returns zero deltas.
- TV scan applies fixed-source saved/failed stats but does not delete subscription.
- movie scan with saved > 0 deletes subscription, writes fixed-source cleanup event/step, and applies cleanup stats.
- module boundary does not import `subscription_service`, runtime settings, external services, API, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.fixed_source_run_flow'`.

### Task 2: Implement Fixed Source Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/fixed_source_run_flow.py`

- [ ] **Step 1: Define result and dependency types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class FixedSourceRunResult:
    sub_saved_count_delta: int
    sub_failed_transfer_count_delta: int
    fixed_source_stats: dict[str, Any] | None
    movie_cleanup_applied: bool


@dataclass(frozen=True, slots=True)
class FixedSourceRunDependencies:
    should_scan_fixed_sources: Callable[..., bool]
    scan_fixed_sources_for_subscription: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
    apply_fixed_source_transfer_stats: Callable[[int, int], Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]
```

- [ ] **Step 2: Implement `run_fixed_source_for_subscription(...)`**

Required behavior:

- Return zero deltas without calling policy when `cleanup_after_auto is not None`.
- Return zero deltas when `should_scan_fixed_sources(...)` is false.
- Call scan with `db`, `run_id`, `channel`, `sub`, `tv_missing_snapshot`, and `force_auto_download`.
- Normalize `fixed_saved` and `fixed_failed` via `int(stats.get(...) or 0)`.
- Call `apply_fixed_source_transfer_stats(fixed_saved, fixed_failed)` after scan.
- For movie subscriptions with `fixed_saved > 0`, call delete, fixed-source cleanup event, fixed-source cleanup step, and cleanup stats.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.fixed_source_run_flow import (
    FixedSourceRunDependencies,
    run_fixed_source_for_subscription,
)
```

- [ ] **Step 2: Replace inline fixed-source branch**

Replace the existing `if cleanup_after_auto is None and self._should_scan_fixed_sources(...): ...` block with:

```python
fixed_source_result = await run_fixed_source_for_subscription(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    sub=sub,
    cleanup_after_auto=cleanup_after_auto,
    force_auto_download=force_auto_download,
    tv_missing_snapshot=tv_missing_snapshot,
    dependencies=FixedSourceRunDependencies(...),
)
sub_saved_count += fixed_source_result.sub_saved_count_delta
sub_failed_transfer_count += fixed_source_result.sub_failed_transfer_count_delta
```

The injected callbacks should wrap `result_lock` around `apply_fixed_source_transfer_stats(...)` and `apply_cleanup_stats(...)` to preserve current synchronization.

- [ ] **Step 3: Remove imports no longer used directly by service**

Remove direct imports for fixed-source movie cleanup log builders if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_run_flow.py tests/test_fixed_source_scan.py tests/test_subscription_run_cleanup_logs.py tests/test_subscription_run_counters.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains inline fixed-source scan result application.
- `fixed_source_run_flow.py` has no runtime service or session imports.
- `fixed_source_scan.py` remains unchanged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/fixed_source_run_flow.py backend/tests/test_subscription_fixed_source_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅固定来源运行 flow"
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
