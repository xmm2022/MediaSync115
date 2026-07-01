# Subscription Link Fallback Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `_auto_save_records_with_link_fallback()` into a focused dependency-injected flow helper while preserving runtime behavior.

**Architecture:** Add `app.services.subscriptions.link_fallback_flow` with a dependency dataclass and an async flow function. Keep `SubscriptionService` as the integration adapter that wires current instance methods and global runtime dependencies into the extracted helper.

**Tech Stack:** Python 3.12, pytest, existing MediaSync115 subscription service helpers.

---

### Task 1: Add Link Fallback Flow Tests

**Files:**
- Create: `backend/tests/test_subscription_link_fallback_flow.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_subscription_link_fallback_flow.py` with direct tests for the new helper API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.link_fallback_flow import (
    LinkFallbackDependencies,
    auto_save_records_with_link_fallback,
)


ROOT = Path(__file__).resolve().parents[2]


def _sub(media_type: MediaType = MediaType.MOVIE) -> SimpleNamespace:
    return SimpleNamespace(id=101, title="Fallback Movie", media_type=media_type)


def _record(record_id: int, url: str) -> SimpleNamespace:
    return SimpleNamespace(id=record_id, resource_name=f"Resource {record_id}", resource_url=url)
```

Add tests for:

- empty records returning the default stats and not calling dependencies
- one successful round writing `auto_transfer_batch_start` and stopping
- failed first round fetching a replacement link, storing it, and succeeding on the fallback round
- max-round limit logging without fetching again
- `enable_link_refetch=False` stopping after the first failed round
- dependency-boundary strings absent from `link_fallback_flow.py`

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_flow.py
```

Expected: FAIL because `app.services.subscriptions.link_fallback_flow` does not exist.

### Task 2: Implement Extracted Flow and Thin Adapter

**Files:**
- Create: `backend/app/services/subscriptions/link_fallback_flow.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add the helper module**

Create `backend/app/services/subscriptions/link_fallback_flow.py` with:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_candidates import (
    filter_resources_excluding_urls,
    merge_auto_save_stats,
    should_continue_link_fallback,
)


CreateStepLog = Callable[..., Awaitable[None]]
AutoSaveResources = Callable[..., Awaitable[dict[str, Any]]]
LoadSubscriptionResourceUrls = Callable[[Any, int], Awaitable[set[str]]]
FetchResources = Callable[..., Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]]]
StoreNewResources = Callable[[Any, int, list[dict[str, Any]]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class LinkFallbackDependencies:
    create_step_log: CreateStepLog
    auto_save_resources: AutoSaveResources
    load_subscription_resource_urls: LoadSubscriptionResourceUrls
    fetch_resources: FetchResources
    store_new_resources: StoreNewResources
```

Implement `auto_save_records_with_link_fallback(...)` by moving the current loop body unchanged, replacing `self.*` calls with dependency callbacks and making `max_rounds` an explicit parameter.

- [ ] **Step 2: Update `SubscriptionService` imports**

Add:

```python
from app.services.subscriptions.link_fallback_flow import (
    LinkFallbackDependencies,
    auto_save_records_with_link_fallback as auto_save_records_with_link_fallback_flow,
)
```

- [ ] **Step 3: Replace `_auto_save_records_with_link_fallback()` body**

Keep the method signature intact. Build callbacks:

```python
async def create_step_log(current_db: AsyncSession, **kwargs: Any) -> None:
    await self._create_step_log(current_db, **kwargs)

async def auto_save_resources(current_db: AsyncSession, *args: Any, **kwargs: Any) -> dict[str, Any]:
    return await self._auto_save_resources(current_db, *args, **kwargs)

async def load_resource_urls(current_db: AsyncSession, subscription_id: int) -> set[str]:
    return await self._load_subscription_resource_urls(current_db, subscription_id)

async def fetch_resources(*args: Any, **kwargs: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await self._fetch_resources(*args, **kwargs)

async def store_new_resources(current_db: AsyncSession, subscription_id: int, resources: list[dict[str, Any]]) -> dict[str, Any]:
    return await self._store_new_resources(current_db, subscription_id, resources)
```

Pass those into `LinkFallbackDependencies` and call the new helper with `max_rounds=MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS`.

- [ ] **Step 4: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_link_fallback_flow.py tests/test_subscription_link_fallback.py tests/test_subscription_auto_transfer_failure.py tests/test_subscription_auto_transfer_share.py
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/link_fallback_flow.py backend/app/services/subscription_service.py backend/tests/test_subscription_link_fallback_flow.py
git commit -m "refactor: 抽离订阅链接回退转存"
```

### Task 3: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run full backend verification**

```bash
scripts/verify-backend.sh
```

Expected: exit 0.

- [ ] **Step 2: Run frontend build**

```bash
npm --prefix frontend run build
```

Expected: exit 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Run quick verification**

```bash
scripts/verify.sh --quick
```

Expected: exit 0.

- [ ] **Step 4: Build and start Docker service**

```bash
docker compose up -d --build mediasync115
```

Expected: exit 0.

- [ ] **Step 5: Check health**

```bash
curl -fsS http://localhost:8000/healthz
docker compose ps mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and the service health is `healthy`.

- [ ] **Step 6: Confirm worktree state**

```bash
git status --short
```

Expected: only these existing untracked files remain:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: the plan covers new flow module, service adapter, direct tests, targeted regression tests, full verification, Docker build, health check, and final worktree check.
- 占位符扫描：没有未完成的实现占位步骤。
- Type consistency: the dependency dataclass and adapter callback names match the module API used by tests and `SubscriptionService`.
