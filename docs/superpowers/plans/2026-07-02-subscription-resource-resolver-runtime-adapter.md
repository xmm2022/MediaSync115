# Subscription Resource Resolver Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `SubscriptionService._fetch_resources()` runtime wiring into a dedicated resource resolver runtime adapter.

**Architecture:** Keep `resource_resolver.py` and `resource_resolver_adapter.py` unchanged. Add `resource_resolver_runtime_adapter.py` as the service-layer wiring boundary that builds lower adapter dependencies and the source-attempt event callback.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription resource resolver modules.

---

### Task 1: Add Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_resolver_runtime_adapter.py`

- [ ] **Step 1: Write the failing test file**

Create tests for the future module:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_candidates import filter_resources_excluding_urls
from app.services.subscriptions.resource_resolver import resolve_subscription_resources
from app.services.subscriptions.resource_resolver_adapter import (
    ResourceResolverAdapterDependencies,
    fetch_subscription_resources_with_adapter,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    ResourceResolverRuntimeDependencies,
    build_default_resource_resolver_runtime_dependencies,
    emit_source_attempt_event,
    fetch_subscription_resources_with_runtime_adapter,
)

ROOT = Path(__file__).resolve().parents[2]
```

Add tests that assert:

- `fetch_subscription_resources_with_runtime_adapter(...)` calls injected `run_adapter` with:
  - `channel`, `sub`, `hdhive_unlock_context`, `source_order`, `exclude_urls`
  - a `ResourceResolverAdapterDependencies` instance
- The generated lower dependencies call every injected runtime callback:
  - `fetch_from_hdhive`
  - `fetch_from_tg`
  - `fetch_from_pansou`
  - `fetch_offline_magnets`
  - `resolve_source_order`
  - `resolve_subscription_resolutions`
  - `resolve_subscription_quality_filter`
  - `prepare_hdhive_locked_resources`
  - `build_hdhive_unlock_context`
  - `filter_resources_excluding_urls`
  - `log_background_event`
  - `emit_source_attempt_event`
- `build_default_resource_resolver_runtime_dependencies(...)` uses existing runner functions and preserves service-method callbacks.
- `emit_source_attempt_event(...)` sends Kafka only when `_enabled` is truthy, using event type `source_attempt` and `key=str(subscription_id)`.
- The runtime adapter module does not import `subscription_service` or `app.api`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_resolver_runtime_adapter'`.

### Task 2: Implement Runtime Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_resolver_runtime_adapter.py`

- [ ] **Step 1: Define runtime dependency type**

Implement:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.operation_log_service import operation_log_service
from app.services.subscriptions.resource_candidates import (
    filter_resources_excluding_urls,
)
from app.services.subscriptions.resource_resolver import (
    resolve_subscription_resources,
)
from app.services.subscriptions.resource_resolver_adapter import (
    FetchResources,
    ResourceResolverAdapterDependencies,
    RunResourceResolver,
    fetch_subscription_resources_with_adapter,
)

RunResourceResolverAdapter = Callable[
    ...,
    Awaitable[
        tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
    ],
]


@dataclass(frozen=True, slots=True)
class ResourceResolverRuntimeDependencies:
    fetch_from_hdhive: FetchResources
    fetch_from_tg: FetchResources
    fetch_from_pansou: FetchResources
    fetch_offline_magnets: FetchResources
    resolve_source_order: Callable[[str], list[str]]
    resolve_subscription_resolutions: Callable[[Any], list[str]]
    resolve_subscription_quality_filter: Callable[[Any], dict[str, Any]]
    prepare_hdhive_locked_resources: Callable[
        [list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Awaitable[list[dict[str, Any]]],
    ]
    build_hdhive_unlock_context: Callable[[], dict[str, Any]]
    filter_resources_excluding_urls: Callable[
        [list[dict[str, Any]], set[str]], list[dict[str, Any]]
    ]
    log_background_event: Callable[..., Awaitable[None]]
    emit_source_attempt_event: Callable[[int, dict[str, Any]], None]
    run_adapter: RunResourceResolverAdapter
    run_resolver: RunResourceResolver
```

- [ ] **Step 2: Add default source-attempt event emitter**

```python
def emit_source_attempt_event(subscription_id: int, data: dict[str, Any]) -> None:
    from app.analytics import kafka_producer

    if kafka_producer._enabled:
        kafka_producer.send(
            event_type="source_attempt",
            data=data,
            key=str(subscription_id),
        )
```

- [ ] **Step 3: Add default dependency builder**

```python
def build_default_resource_resolver_runtime_dependencies(
    *,
    fetch_from_hdhive: FetchResources,
    fetch_from_tg: FetchResources,
    fetch_from_pansou: FetchResources,
    fetch_offline_magnets: FetchResources,
    resolve_source_order: Callable[[str], list[str]],
    resolve_subscription_resolutions: Callable[[Any], list[str]],
    resolve_subscription_quality_filter: Callable[[Any], dict[str, Any]],
    prepare_hdhive_locked_resources: Callable[
        [list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Awaitable[list[dict[str, Any]]],
    ],
    build_hdhive_unlock_context: Callable[[], dict[str, Any]],
) -> ResourceResolverRuntimeDependencies:
    return ResourceResolverRuntimeDependencies(
        fetch_from_hdhive=fetch_from_hdhive,
        fetch_from_tg=fetch_from_tg,
        fetch_from_pansou=fetch_from_pansou,
        fetch_offline_magnets=fetch_offline_magnets,
        resolve_source_order=resolve_source_order,
        resolve_subscription_resolutions=resolve_subscription_resolutions,
        resolve_subscription_quality_filter=resolve_subscription_quality_filter,
        prepare_hdhive_locked_resources=prepare_hdhive_locked_resources,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        filter_resources_excluding_urls=filter_resources_excluding_urls,
        log_background_event=operation_log_service.log_background_event,
        emit_source_attempt_event=emit_source_attempt_event,
        run_adapter=fetch_subscription_resources_with_adapter,
        run_resolver=resolve_subscription_resources,
    )
```

- [ ] **Step 4: Add adapter entrypoint**

```python
async def fetch_subscription_resources_with_runtime_adapter(
    *,
    channel: str,
    sub: Any,
    dependencies: ResourceResolverRuntimeDependencies,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    return await dependencies.run_adapter(
        channel=channel,
        sub=sub,
        dependencies=ResourceResolverAdapterDependencies(
            fetch_from_hdhive=dependencies.fetch_from_hdhive,
            fetch_from_tg=dependencies.fetch_from_tg,
            fetch_from_pansou=dependencies.fetch_from_pansou,
            fetch_offline_magnets=dependencies.fetch_offline_magnets,
            resolve_source_order=dependencies.resolve_source_order,
            resolve_subscription_resolutions=(
                dependencies.resolve_subscription_resolutions
            ),
            resolve_subscription_quality_filter=(
                dependencies.resolve_subscription_quality_filter
            ),
            prepare_hdhive_locked_resources=(
                dependencies.prepare_hdhive_locked_resources
            ),
            build_hdhive_unlock_context=dependencies.build_hdhive_unlock_context,
            filter_resources_excluding_urls=(
                dependencies.filter_resources_excluding_urls
            ),
            log_background_event=dependencies.log_background_event,
            emit_source_attempt_event=dependencies.emit_source_attempt_event,
            run_resolver=dependencies.run_resolver,
        ),
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        exclude_urls=exclude_urls,
    )
```

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace imports**

Remove imports that become unused:

```python
from app.services.subscriptions.resource_candidates import (
    extract_resource_url,
    filter_resources_excluding_urls,
    normalize_share_url,
)
from app.services.subscriptions.resource_resolver import (
    resolve_subscription_resources,
)
from app.services.subscriptions.resource_resolver_adapter import (
    ResourceResolverAdapterDependencies,
    fetch_subscription_resources_with_adapter,
)
```

Keep `extract_resource_url` and `normalize_share_url`, and add:

```python
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
```

- [ ] **Step 2: Replace `_fetch_resources()` body**

Replace the body with:

```python
return await fetch_subscription_resources_with_runtime_adapter(
    channel=channel,
    sub=sub,
    dependencies=build_default_resource_resolver_runtime_dependencies(
        fetch_from_hdhive=self._fetch_from_hdhive,
        fetch_from_tg=self._fetch_from_tg,
        fetch_from_pansou=self._fetch_from_pansou,
        fetch_offline_magnets=self._fetch_offline_magnets,
        resolve_source_order=self._resolve_source_order,
        resolve_subscription_resolutions=self._resolve_subscription_resolutions,
        resolve_subscription_quality_filter=(
            self._resolve_subscription_quality_filter
        ),
        prepare_hdhive_locked_resources=self._prepare_hdhive_locked_resources,
        build_hdhive_unlock_context=self._build_hdhive_unlock_context,
    ),
    hdhive_unlock_context=hdhive_unlock_context,
    source_order=source_order,
    exclude_urls=exclude_urls,
)
```

- [ ] **Step 3: Confirm removed local wiring**

Confirm `_fetch_resources()` no longer contains:

- `def emit_source_attempt_event`
- `ResourceResolverAdapterDependencies(`
- `fetch_subscription_resources_with_adapter(`

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_resolver_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_fetcher_adapter.py tests/test_subscription_resource_fetchers.py tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_item_processing_run_flow.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` removed `_fetch_resources()` local runtime wiring.
- New runtime adapter is the only new production module.
- `resource_resolver.py` and `resource_resolver_adapter.py` are unchanged.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/resource_resolver_runtime_adapter.py backend/tests/test_subscription_resource_resolver_runtime_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅资源解析 runtime adapter"
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
