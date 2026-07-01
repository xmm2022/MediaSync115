# Subscription Transfer Phase Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-subscription transfer phase from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper that composes retry selection, auto-transfer, and fixed-source transfer.

**Architecture:** Add `app.services.subscriptions.transfer_phase_run_flow` as a thin orchestration layer over existing local flow modules: `auto_transfer_retry_records`, `auto_transfer_run_flow`, and `fixed_source_run_flow`. Keep concrete database/service methods and run result locking injected by `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription transfer flow modules, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Transfer Phase Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_transfer_phase_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.transfer_phase_run_flow import (
    SubscriptionTransferPhaseDependencies,
    run_subscription_transfer_phase,
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
```

Add tests that assert:

- auto-transfer enabled path uses retry loaders, transfers new and retry records, runs fixed-source scan afterward, and returns aggregated saved/failed counts.
- auto-transfer cleanup path skips fixed-source scan through existing fixed-source flow behavior and applies cleanup stats.
- disabled auto-transfer path returns `should_auto_download=False`, does not load retry records, and still delegates fixed-source policy to the fixed-source flow.
- module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_phase_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.transfer_phase_run_flow'`.

### Task 2: Implement Transfer Phase Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/transfer_phase_run_flow.py`

- [ ] **Step 1: Define result and dependency types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class SubscriptionTransferPhaseResult:
    should_auto_download: bool
    sub_saved_count: int
    sub_failed_transfer_count: int
    auto_transfer_result: AutoTransferRunResult
    fixed_source_result: FixedSourceRunResult


@dataclass(frozen=True, slots=True)
class SubscriptionTransferPhaseDependencies:
    load_retryable_records: Callable[[Any, int], Awaitable[list[Any]]]
    load_force_retry_records: Callable[[Any, int, list[str]], Awaitable[list[Any]]]
    auto_save_records_with_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
    should_scan_fixed_sources: Callable[..., bool]
    scan_fixed_sources_for_subscription: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    delete_subscription_with_records: Callable[[Any, int], Awaitable[None]]
    apply_auto_transfer_stats: Callable[[dict[str, Any], str], Awaitable[None]]
    apply_fixed_source_transfer_stats: Callable[[int, int], Awaitable[None]]
    apply_cleanup_stats: Callable[[Any], Awaitable[None]]
```

- [ ] **Step 2: Implement `run_subscription_transfer_phase(...)`**

Required behavior:

- Compute `should_auto_download = force_auto_download or bool(sub.auto_download)`.
- Build retry selection callback with `select_auto_transfer_retry_records(...)` and `AutoTransferRetryRecordDependencies(...)`.
- Call `run_auto_transfer_for_subscription(...)`.
- Call `run_fixed_source_for_subscription(...)` with `cleanup_after_auto=auto_transfer_result.cleanup_after_auto`.
- Add fixed-source saved/failed deltas to the auto-transfer saved/failed counts.
- Return `SubscriptionTransferPhaseResult`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.transfer_phase_run_flow import (
    SubscriptionTransferPhaseDependencies,
    run_subscription_transfer_phase,
)
```

- [ ] **Step 2: Replace inline transfer phase**

Replace the block from `should_auto_download = ...` through fixed-source delta accumulation with:

```python
async def apply_auto_transfer_stats_for_run(
    stats: dict[str, Any],
    transfer_source: str,
) -> None:
    async with result_lock:
        apply_auto_transfer_stats(
            result,
            stats,
            transfer_source=transfer_source,
        )

async def apply_fixed_source_stats_for_run(saved: int, failed: int) -> None:
    async with result_lock:
        apply_fixed_source_transfer_stats(result, saved=saved, failed=failed)

async def apply_transfer_cleanup_stats_for_run(media_type: Any) -> None:
    async with result_lock:
        apply_cleanup_stats(result, media_type, tv_media_type=MediaType.TV)

transfer_phase_result = await run_subscription_transfer_phase(...)
should_auto_download = transfer_phase_result.should_auto_download
sub_saved_count = transfer_phase_result.sub_saved_count
sub_failed_transfer_count = transfer_phase_result.sub_failed_transfer_count
```

- [ ] **Step 3: Remove imports no longer used directly by service**

Remove direct imports for auto-transfer run flow, fixed-source run flow, and auto-transfer retry selection if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_run_counters.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains inline transfer phase dependency construction or fixed-source delta accumulation.
- `transfer_phase_run_flow.py` has no runtime service, ORM model, or session imports.
- Resource ingest and item outcome flow wiring remain unchanged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/transfer_phase_run_flow.py backend/tests/test_subscription_transfer_phase_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅转存阶段组合 flow"
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
