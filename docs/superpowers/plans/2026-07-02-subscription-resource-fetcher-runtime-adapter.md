# Subscription Resource Fetcher Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract concrete source fetcher dependency wiring and wrapper calls from `SubscriptionService`.

**Architecture:** Keep `resource_fetchers.py` and `resource_fetcher_adapter.py` unchanged. Add `resource_fetcher_runtime_adapter.py` to build the default `ResourceFetcherAdapterDependencies` from runtime services and expose four wrapper functions.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription resource fetcher modules.

---

### Task 1: Add Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_fetcher_runtime_adapter.py`

- [ ] **Step 1: Write the failing test file**

Create tests for the future module:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.resource_search import (
    normalize_pansou_pan115_list as _normalize_pansou_pan115_list,
    search_pansou_pan115_resources as _search_pansou_pan115_resources,
)
from app.services.subscriptions.resource_fetcher_adapter import (
    ResourceFetcherAdapterDependencies,
)
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    build_default_resource_fetcher_runtime_dependencies,
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
from app.services.subscriptions.resource_fetchers import (
    ResourceFetcherDependencies,
    fetch_from_hdhive as fetch_from_hdhive_flow,
    fetch_from_pansou as fetch_from_pansou_flow,
    fetch_from_tg as fetch_from_tg_flow,
    fetch_offline_magnets as fetch_offline_magnets_flow,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)

ROOT = Path(__file__).resolve().parents[2]
```

Add tests that assert:

- Four runtime wrapper functions use the provided `ResourceFetcherAdapterDependencies`.
- Each wrapper calls the matching runner:
  - `run_fetch_from_pansou`
  - `run_fetch_from_hdhive`
  - `run_fetch_from_tg`
  - `run_fetch_offline_magnets`
- Default dependency builder binds existing helper and runner functions:
  - `_search_pansou_pan115_resources`
  - `_normalize_pansou_pan115_list`
  - `normalize_hdhive_subscription_items`
  - `fetch_from_*_flow`
- Runtime adapter module does not import `subscription_service`, `app.api`, `AsyncSession`, or `app.models`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetcher_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_fetcher_runtime_adapter'`.

### Task 2: Implement Runtime Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_fetcher_runtime_adapter.py`

- [ ] **Step 1: Add imports and default dependency builder**

Implement:

```python
from __future__ import annotations

from typing import Any

from app.services.butailing_service import butailing_service
from app.services.hdhive_service import hdhive_service
from app.services.operation_log_service import operation_log_service
from app.services.pansou_service import pansou_service
from app.services.resource_search import (
    normalize_pansou_pan115_list as _normalize_pansou_pan115_list,
    search_pansou_pan115_resources as _search_pansou_pan115_resources,
)
from app.services.runtime_settings_service import runtime_settings_service
from app.services.seedhub_service import seedhub_service
from app.services.subscriptions.resource_fetcher_adapter import (
    ResourceFetcherAdapterDependencies,
    fetch_from_hdhive_with_adapter,
    fetch_from_pansou_with_adapter,
    fetch_from_tg_with_adapter,
    fetch_offline_magnets_with_adapter,
)
from app.services.subscriptions.resource_fetchers import (
    fetch_from_hdhive as fetch_from_hdhive_flow,
    fetch_from_pansou as fetch_from_pansou_flow,
    fetch_from_tg as fetch_from_tg_flow,
    fetch_offline_magnets as fetch_offline_magnets_flow,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)
from app.services.tg_service import tg_service


def build_default_resource_fetcher_runtime_dependencies() -> ResourceFetcherAdapterDependencies:
    return ResourceFetcherAdapterDependencies(
        search_pansou_by_tmdb=_search_pansou_pan115_resources,
        search_pansou_keyword=pansou_service.search_115,
        normalize_pansou_resources=_normalize_pansou_pan115_list,
        get_hdhive_tv_pan115=hdhive_service.get_tv_pan115,
        get_hdhive_movie_pan115=hdhive_service.get_movie_pan115,
        get_hdhive_by_keyword=hdhive_service.get_pan115_by_keyword,
        normalize_hdhive_items=normalize_hdhive_subscription_items,
        prefer_hdhive_free=runtime_settings_service.get_subscription_hdhive_prefer_free,
        sort_hdhive_free_first=hdhive_service.sort_free_first,
        search_tg_by_keyword=tg_service.search_115_by_keyword,
        offline_transfer_enabled=(
            runtime_settings_service.get_subscription_offline_transfer_enabled
        ),
        search_seedhub_magnets=seedhub_service.search_magnets_by_keyword,
        search_butailing_magnets=butailing_service.search_magnets,
        log_background_event=operation_log_service.log_background_event,
        run_fetch_from_pansou=fetch_from_pansou_flow,
        run_fetch_from_hdhive=fetch_from_hdhive_flow,
        run_fetch_from_tg=fetch_from_tg_flow,
        run_fetch_offline_magnets=fetch_offline_magnets_flow,
    )
```

- [ ] **Step 2: Add four runtime wrapper functions**

Implement:

```python
async def fetch_from_pansou_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_from_pansou_with_adapter(
        sub,
        dependencies=dependencies or build_default_resource_fetcher_runtime_dependencies(),
    )


async def fetch_from_hdhive_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_from_hdhive_with_adapter(
        sub,
        dependencies=dependencies or build_default_resource_fetcher_runtime_dependencies(),
    )


async def fetch_from_tg_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_from_tg_with_adapter(
        sub,
        dependencies=dependencies or build_default_resource_fetcher_runtime_dependencies(),
    )


async def fetch_offline_magnets_with_runtime_adapter(
    sub: Any,
    *,
    dependencies: ResourceFetcherAdapterDependencies | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_offline_magnets_with_adapter(
        sub,
        dependencies=dependencies or build_default_resource_fetcher_runtime_dependencies(),
    )
```

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace imports**

Remove imports that become unused:

```python
from app.services.butailing_service import butailing_service
from app.services.pansou_service import pansou_service
from app.services.resource_search import (
    normalize_pansou_pan115_list as _normalize_pansou_pan115_list,
    search_pansou_pan115_resources as _search_pansou_pan115_resources,
)
from app.services.subscriptions.resource_fetchers import (
    fetch_from_hdhive as fetch_from_hdhive_flow,
    fetch_from_pansou as fetch_from_pansou_flow,
    fetch_from_tg as fetch_from_tg_flow,
    fetch_offline_magnets as fetch_offline_magnets_flow,
)
from app.services.subscriptions.resource_fetcher_adapter import (
    ResourceFetcherAdapterDependencies,
    fetch_from_hdhive_with_adapter,
    fetch_from_pansou_with_adapter,
    fetch_from_tg_with_adapter,
    fetch_offline_magnets_with_adapter,
)
from app.services.seedhub_service import seedhub_service
from app.services.tg_service import tg_service
```

Add:

```python
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
```

- [ ] **Step 2: Remove `_resource_fetcher_adapter_dependencies()`**

Delete the whole method:

```python
def _resource_fetcher_adapter_dependencies(self) -> ResourceFetcherAdapterDependencies:
    ...
```

- [ ] **Step 3: Replace four service wrappers**

Use:

```python
async def _fetch_from_pansou(
    self, sub: "SubscriptionSnapshot"
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_from_pansou_with_runtime_adapter(sub)


async def _fetch_from_hdhive(
    self, sub: "SubscriptionSnapshot"
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_from_hdhive_with_runtime_adapter(sub)


async def _fetch_from_tg(
    self, sub: "SubscriptionSnapshot"
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_from_tg_with_runtime_adapter(sub)


async def _fetch_offline_magnets(
    self,
    sub: "SubscriptionSnapshot",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return await fetch_offline_magnets_with_runtime_adapter(sub)
```

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetcher_runtime_adapter.py tests/test_subscription_resource_fetcher_adapter.py tests/test_subscription_resource_fetchers.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_resolver_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_item_processing_run_flow.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` no longer defines `_resource_fetcher_adapter_dependencies()`.
- Four service fetch wrappers call `*_with_runtime_adapter(...)`.
- New runtime adapter is the only new production module.
- `resource_fetchers.py` and `resource_fetcher_adapter.py` are unchanged.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/resource_fetcher_runtime_adapter.py backend/tests/test_subscription_resource_fetcher_runtime_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅资源来源 fetcher runtime adapter"
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
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

- [ ] **Step 5: Final worktree check**

```bash
git status --short
wc -l backend/app/services/subscription_service.py
```

Only these untracked files may remain:

- `backend/scripts/export_hdhive_189_links.py`
- `docs/next-session-prompt.md`
