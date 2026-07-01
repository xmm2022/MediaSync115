# Subscription Resource Fetchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract provider-specific subscription resource fetchers from `subscription_service.py` into a dependency-injected helper module.

**Architecture:** Add `app.services.subscriptions.resource_fetchers` with one dependency dataclass and four async functions for PanSou, HDHive, Telegram, and offline magnet sources. Keep `SubscriptionService` as the adapter that wires runtime services, settings, normalizers, and operation logs.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing MediaSync115 subscription helper modules.

---

### Task 1: Add Resource Fetcher Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_fetchers.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_fetchers import (
    ResourceFetcherDependencies,
    fetch_from_hdhive,
    fetch_from_pansou,
    fetch_from_tg,
    fetch_offline_magnets,
)
```

Test cases:

- `test_fetch_from_pansou_returns_tmdb_hits_without_keyword_fallback()`
- `test_fetch_from_pansou_falls_back_to_keyword_when_tmdb_empty()`
- `test_fetch_from_hdhive_normalizes_and_sorts_tmdb_hits()`
- `test_fetch_from_tg_skips_when_keyword_is_empty()`
- `test_fetch_offline_magnets_skips_when_disabled()`
- `test_fetch_offline_magnets_merges_success_and_logs_failures()`
- `test_resource_fetchers_module_stays_dependency_injected()`

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetchers.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_fetchers'`.

### Task 2: Implement Resource Fetcher Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_fetchers.py`

- [ ] **Step 1: Add dependency dataclass**

Create `ResourceFetcherDependencies` with callbacks for:

- PanSou TMDB search, keyword search, and result normalization
- HDHive movie/TV TMDB search, keyword search, result normalization, free-preference flag, and free sorting
- Telegram keyword search
- offline transfer enabled flag
- SeedHub magnet search
- Butailing magnet search
- offline source operation logging

- [ ] **Step 2: Implement four helper functions**

Move the current logic from:

- `_fetch_from_pansou()`
- `_fetch_from_hdhive()`
- `_fetch_from_tg()`
- `_fetch_offline_magnets()`

Replace direct global service calls with `dependencies.*`. Keep trace step names, statuses, messages, payload shapes, exception handling, and offline source log payloads unchanged.

- [ ] **Step 3: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetchers.py
```

Expected: PASS.

### Task 3: Replace Service Fetchers with Adapters

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helpers**

```python
from app.services.subscriptions.resource_fetchers import (
    ResourceFetcherDependencies,
    fetch_from_hdhive as fetch_from_hdhive_flow,
    fetch_from_pansou as fetch_from_pansou_flow,
    fetch_from_tg as fetch_from_tg_flow,
    fetch_offline_magnets as fetch_offline_magnets_flow,
)
```

- [ ] **Step 2: Add a dependency builder**

Add a private helper on `SubscriptionService`:

```python
def _resource_fetcher_dependencies(self) -> ResourceFetcherDependencies:
    ...
```

This builder should wire existing runtime services and helpers without changing their behavior.

- [ ] **Step 3: Replace four method bodies**

Each method should preserve its signature and call the new helper:

```python
return await fetch_from_pansou_flow(
    sub,
    dependencies=self._resource_fetcher_dependencies(),
)
```

Use the matching helper for HDHive, Telegram, and offline magnets.

- [ ] **Step 4: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetchers.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_metadata.py tests/test_subscription_source_attempts.py
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add backend/app/services/subscriptions/resource_fetchers.py backend/app/services/subscription_service.py backend/tests/test_subscription_resource_fetchers.py
git commit -m "refactor: 抽离订阅资源来源抓取"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend full verification**

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
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
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

- Spec coverage: the plan covers direct tests, new helper module, service adapters, targeted regressions, full verification, Docker health, and final worktree state.
- 占位符扫描：没有未完成实现步骤。
- Type consistency: `ResourceFetcherDependencies` and the four helper function names match tests, implementation, and service imports.
