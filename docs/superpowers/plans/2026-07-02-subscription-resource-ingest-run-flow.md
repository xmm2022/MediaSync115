# Subscription Resource Ingest Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-subscription resource fetch/store run branch from `SubscriptionService.run_channel_check()` into a dependency-injected flow helper.

**Architecture:** Add `app.services.subscriptions.resource_ingest_run_flow` to orchestrate fetch logs, fetch completion event, resource storage, resource store stats, and store logs. Keep actual fetching in `_fetch_resources()`, storage in `_store_new_resources()`, and run result locking injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription helper modules, no ORM/runtime service imports in the new flow.

---

### Task 1: Add Resource Ingest Run Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_ingest_run_flow.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_ingest_run_flow import (
    ResourceIngestRunDependencies,
    run_resource_ingest_for_subscription,
)

ROOT = Path(__file__).resolve().parents[2]


def _sub(**overrides: Any) -> SimpleNamespace:
    values = {"id": 101, "title": "示例影片"}
    values.update(overrides)
    return SimpleNamespace(**values)


def _deps(events: list[Any], **overrides: Any) -> ResourceIngestRunDependencies:
    async def fetch_resources(_channel: str, _sub: Any, _ctx: dict[str, Any], *, source_order: list[str]):
        return [], [], {"summary": ""}

    async def store_new_resources(_db: Any, _subscription_id: int, _resources: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "checked_count": 0,
            "duplicate_count": 0,
            "invalid_count": 0,
            "created_records": [],
            "duplicate_urls": [],
        }

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        events.append(("step", kwargs))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def apply_resource_store_stats(store_stats: dict[str, Any]) -> None:
        events.append(("apply_store", store_stats))

    values: dict[str, Any] = {
        "fetch_resources": fetch_resources,
        "store_new_resources": store_new_resources,
        "create_step_log": create_step_log,
        "log_background_event": log_background_event,
        "apply_resource_store_stats": apply_resource_store_stats,
    }
    values.update(overrides)
    return ResourceIngestRunDependencies(**values)
```

Add tests that assert:

- successful fetch/store writes trace steps, summary step, fetch event, applies store stats, writes store step/event, and returns created records plus duplicate URLs.
- empty resource path still writes warning fetch summary/event and info store event.
- fetch callback receives `channel`, `sub`, `hdhive_unlock_context`, and keyword `source_order`.
- module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_ingest_run_flow.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_ingest_run_flow'`.

### Task 2: Implement Resource Ingest Run Flow Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_ingest_run_flow.py`

- [ ] **Step 1: Define result and dependency types**

Implement:

```python
@dataclass(frozen=True, slots=True)
class ResourceIngestRunResult:
    resources: list[dict[str, Any]]
    fetch_trace: list[dict[str, Any]]
    source_attempt_info: dict[str, Any]
    store_stats: dict[str, Any]
    created_records: list[Any]
    duplicate_urls: list[str]


@dataclass(frozen=True, slots=True)
class ResourceIngestRunDependencies:
    fetch_resources: Callable[..., Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]]]
    store_new_resources: Callable[[Any, int, list[dict[str, Any]]], Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    apply_resource_store_stats: Callable[[dict[str, Any]], Awaitable[None]]
```

- [ ] **Step 2: Implement `run_resource_ingest_for_subscription(...)`**

Required behavior:

- Call fetch with `channel`, `sub`, `hdhive_unlock_context`, and `source_order=source_order`.
- Write every fetch trace step using `build_fetch_trace_step_log(trace)`.
- Write fetch summary step using `build_fetch_resources_summary_step(...)`.
- Write fetch done event using `build_fetch_done_event_kwargs(...)`.
- Call store with `db`, `subscription_id`, and `resources`.
- Read `created_records = store_stats["created_records"]`.
- Read `duplicate_urls = store_stats["duplicate_urls"]`.
- Apply store stats through dependency callback.
- Write store step and store done event.
- Return `ResourceIngestRunResult`.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new flow**

Import:

```python
from app.services.subscriptions.resource_ingest_run_flow import (
    ResourceIngestRunDependencies,
    run_resource_ingest_for_subscription,
)
```

- [ ] **Step 2: Replace inline fetch/store branch**

Replace the block after `tv_missing_snapshot = cleanup_before.get(...)` through `store_done` event with:

```python
async def apply_resource_store_stats_for_run(store_stats: dict[str, Any]) -> None:
    async with result_lock:
        apply_resource_store_stats(result, store_stats)

resource_ingest_result = await run_resource_ingest_for_subscription(
    db=inner_db,
    run_id=run_id,
    channel=normalized_channel,
    sub=sub,
    hdhive_unlock_context=hdhive_unlock_context,
    source_order=source_order,
    dependencies=ResourceIngestRunDependencies(...),
)
created_records = resource_ingest_result.created_records
duplicate_urls = resource_ingest_result.duplicate_urls
```

- [ ] **Step 3: Remove imports no longer used directly by service**

Remove direct imports for fetch/store item log builders if `subscription_service.py` no longer references them.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_run_item_logs.py tests/test_subscription_run_counters.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_storage.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer contains inline fetch trace/store log orchestration.
- `resource_ingest_run_flow.py` has no runtime service, ORM model, or session imports.
- Fetch/store helper modules remain unchanged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/resource_ingest_run_flow.py backend/tests/test_subscription_resource_ingest_run_flow.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅资源抓取入库运行 flow"
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
