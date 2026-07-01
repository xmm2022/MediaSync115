# Subscription Link Fallback Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the runtime dependency wiring in `SubscriptionService._auto_save_records_with_link_fallback()` into a small adapter module.

**Architecture:** Add `app.services.subscriptions.link_fallback_adapter` to build `LinkFallbackDependencies` and invoke the existing `link_fallback_flow.auto_save_records_with_link_fallback` runner. Keep all fallback business rules in `link_fallback_flow.py`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing link fallback flow and service methods.

---

### Task 1: Add Link Fallback Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_link_fallback_adapter.py`

- [ ] **Step 1: Write the failing test file**

Create async tests for the future API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.link_fallback_flow import LinkFallbackDependencies

ROOT = Path(__file__).resolve().parents[2]
```

Add tests that assert:

- Adapter calls the injected runner with the same runtime args and a `LinkFallbackDependencies` instance.
- The generated `LinkFallbackDependencies` callbacks call the injected runtime callbacks:
  - `create_step_log`
  - `auto_save_resources`
  - `load_subscription_resource_urls`
  - `fetch_resources`
  - `store_new_resources`
- Adapter forwards `tv_missing_snapshot`, `hdhive_unlock_context`, `source_order`, `enable_link_refetch`, and `max_rounds`.
- Module boundary does not import `subscription_service`, runtime settings, external services, API, ORM models, or `AsyncSession`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.link_fallback_adapter'`.

### Task 2: Implement Link Fallback Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/link_fallback_adapter.py`

- [ ] **Step 1: Define dependency type**

Implement:

```python
@dataclass(frozen=True, slots=True)
class LinkFallbackAdapterDependencies:
    create_step_log: Callable[..., Awaitable[None]]
    auto_save_resources: Callable[..., Awaitable[dict[str, Any]]]
    load_subscription_resource_urls: Callable[[Any, int], Awaitable[set[str]]]
    fetch_resources: Callable[..., Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]]]
    store_new_resources: Callable[[Any, int, list[dict[str, Any]]], Awaitable[dict[str, Any]]]
    run_link_fallback: Callable[..., Awaitable[dict[str, Any]]]
```

- [ ] **Step 2: Implement `auto_save_records_with_link_fallback_with_adapter(...)`**

Required behavior:

- Accept the same runtime arguments currently passed by `SubscriptionService._auto_save_records_with_link_fallback()`.
- Build `LinkFallbackDependencies` from adapter dependencies.
- Call `dependencies.run_link_fallback(...)` with:
  - `db`
  - `run_id`
  - `channel`
  - `sub`
  - `records`
  - `transfer_source`
  - the generated core dependencies
  - `tv_missing_snapshot`
  - `hdhive_unlock_context`
  - `source_order`
  - `enable_link_refetch`
  - `max_rounds`

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new adapter**

Import:

```python
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
```

- [ ] **Step 2: Replace local dependency closures**

Replace the body of `_auto_save_records_with_link_fallback()` with:

```python
return await auto_save_records_with_link_fallback_with_adapter(
    db=db,
    run_id=run_id,
    channel=channel,
    sub=sub,
    records=records,
    transfer_source=transfer_source,
    dependencies=LinkFallbackAdapterDependencies(
        create_step_log=self._create_step_log,
        auto_save_resources=self._auto_save_resources,
        load_subscription_resource_urls=self._load_subscription_resource_urls,
        fetch_resources=self._fetch_resources,
        store_new_resources=self._store_new_resources,
        run_link_fallback=auto_save_records_with_link_fallback_flow,
    ),
    tv_missing_snapshot=tv_missing_snapshot,
    hdhive_unlock_context=hdhive_unlock_context,
    source_order=source_order,
    enable_link_refetch=enable_link_refetch,
    max_rounds=MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS,
)
```

- [ ] **Step 3: Remove unused imports**

Remove direct `LinkFallbackDependencies` import from `subscription_service.py` if unused.

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_source_run_integration.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `_auto_save_records_with_link_fallback()` no longer defines local forwarding closures.
- `link_fallback_adapter.py` has no runtime service, ORM model, session, or `subscription_service` imports.
- Core fallback flow is unchanged.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/link_fallback_adapter.py backend/tests/test_subscription_link_fallback_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅链接回退 adapter"
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
