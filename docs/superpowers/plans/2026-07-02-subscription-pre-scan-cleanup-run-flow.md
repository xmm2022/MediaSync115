# Subscription Pre-Scan Cleanup Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-subscription pre-scan cleanup run branch from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper.

**Architecture:** Add `app.services.subscriptions.pre_scan_cleanup_run_flow` to orchestrate cleanup evaluation, deleted early-return logging, cleanup stat application, and commit. Keep the existing cleanup decision in `_evaluate_pre_scan_cleanup()` and inject result-lock-protected stat mutation from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription lifecycle log helpers, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Pre-Scan Cleanup Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_pre_scan_cleanup_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.pre_scan_cleanup_run_flow import (
    PreScanCleanupRunDependencies,
    run_pre_scan_cleanup_for_subscription,
)

ROOT = Path(__file__).resolve().parents[2]


class FakeDb:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {"id": 101, "title": "示例影片", "media_type": "movie"}
    values.update(overrides)
    return SimpleNamespace(**values)
```

Add tests that assert:

- not-deleted cleanup returns `tv_missing_snapshot`, writes no logs, applies no cleanup stats, and does not commit.
- deleted cleanup applies cleanup stats, writes auto-cleaned step and background event, commits once, and returns `deleted=True`.
- evaluate callback receives `db`, `run_id`, `channel`, and `sub`.
- module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.pre_scan_cleanup_run_flow'`.

### Task 2: Implement Pre-Scan Cleanup Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/pre_scan_cleanup_run_flow.py`

- [ ] **Step 1: Define result and dependency types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class PreScanCleanupRunResult:
    deleted: bool
    tv_missing_snapshot: Any | None
    cleanup_result: dict[str, Any]


@dataclass(frozen=True, slots=True)
class PreScanCleanupRunDependencies:
    evaluate_pre_scan_cleanup: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]
```

- [ ] **Step 2: Implement `run_pre_scan_cleanup_for_subscription(...)`**

Required behavior:

- Call `evaluate_pre_scan_cleanup(db, run_id=run_id, channel=channel, sub=sub)`.
- If `cleanup_result.get("deleted")` is false, return `deleted=False` with `tv_missing_snapshot`.
- If deleted:
  - call `apply_cleanup_stats(sub.media_type)`;
  - write auto-cleaned step using `build_subscription_auto_cleaned_step()`;
  - write auto-cleaned event using `build_subscription_auto_cleaned_event_kwargs(...)`;
  - commit the passed `db`;
  - return `deleted=True`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.pre_scan_cleanup_run_flow import (
    PreScanCleanupRunDependencies,
    run_pre_scan_cleanup_for_subscription,
)
```

- [ ] **Step 2: Replace inline cleanup branch**

Replace the `_evaluate_pre_scan_cleanup()` call and deleted early-return branch with:

```python
async def apply_pre_scan_cleanup_stats_for_run(media_type: Any) -> None:
    async with result_lock:
        apply_cleanup_stats(result, media_type, tv_media_type=MediaType.TV)

pre_scan_cleanup_result = await run_pre_scan_cleanup_for_subscription(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    sub=sub,
    dependencies=PreScanCleanupRunDependencies(
        evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup,
        create_step_log=self._create_step_log,
        log_background_event=operation_log_service.log_background_event,
        apply_cleanup_stats=apply_pre_scan_cleanup_stats_for_run,
    ),
)
if pre_scan_cleanup_result.deleted:
    return
tv_missing_snapshot = pre_scan_cleanup_result.tv_missing_snapshot
```

- [ ] **Step 3: Remove imports no longer used directly by service**

Remove direct imports for auto-cleaned lifecycle log builders if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_run_flow.py tests/test_pre_scan_cleanup.py tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_counters.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains inline pre-scan cleanup deleted orchestration.
- `pre_scan_cleanup_run_flow.py` has no runtime service, ORM model, or session imports.
- `_evaluate_pre_scan_cleanup()` and `pre_scan_cleanup.py` remain behavior-compatible.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/pre_scan_cleanup_run_flow.py backend/tests/test_subscription_pre_scan_cleanup_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅预扫描清理运行 flow"
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
