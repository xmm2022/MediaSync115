# 订阅 HDHive 解锁 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `SubscriptionService` HDHive unlock runtime wiring into a dedicated runtime adapter while keeping the core unlock policy unchanged.

**Architecture:** Add `app.services.subscriptions.hdhive_unlock_runtime_adapter` as the only new production module. It binds runtime settings, HDHive service, URL helpers, and core `hdhive_unlock.py` functions behind an injectable dataclass; `SubscriptionService` keeps compatibility wrappers that delegate to this adapter.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder binding concrete runtime services.
  - Context and locked-resource wrapper functions.
- Create: `backend/tests/test_subscription_hdhive_unlock_runtime_adapter.py`
  - Red/green tests for injected dependencies, default bindings, and boundary constraints.
- Modify: `backend/app/services/subscription_service.py`
  - Replace direct runtime wiring in `_build_hdhive_unlock_context()` and `_prepare_hdhive_locked_resources()` with runtime adapter calls.
  - Remove now-unused imports from the service module.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_hdhive_unlock_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_hdhive_unlock_runtime_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.hdhive_unlock import (
    build_hdhive_unlock_context,
    prepare_hdhive_locked_resources,
)
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    HDHiveUnlockRuntimeDependencies,
    build_default_hdhive_unlock_runtime_dependencies,
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_candidates import (
    extract_resource_url,
    normalize_share_url,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> HDHiveUnlockRuntimeDependencies:
    async def unlock_resource(slug: str) -> dict[str, Any]:
        return {
            "success": True,
            "message": "ok",
            "share_link": f"https://115.com/s/{slug}?password=abcd",
        }

    async def prepare_locked_resources(
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
        *,
        normalize_items: Any,
        extract_resource_url: Any,
        normalize_share_url: Any,
        unlock_resource: Any,
    ) -> list[dict[str, Any]]:
        normalized = normalize_items(resources)
        for item in normalized:
            item["share_link"] = normalize_share_url(
                (await unlock_resource(item["slug"]))["share_link"]
            )
        traces.append({"step": "prepared", "status": "success"})
        context["prepared"] = True
        return normalized

    values: dict[str, Any] = {
        "get_auto_unlock_enabled": lambda: True,
        "get_max_points_per_item": lambda: 8,
        "get_budget_points_per_run": lambda: 20,
        "get_threshold_inclusive": lambda: False,
        "normalize_items": lambda items: [dict(item) for item in items],
        "extract_resource_url": lambda item: str(item.get("share_link") or ""),
        "normalize_share_url": lambda url: url.strip(),
        "unlock_resource": unlock_resource,
        "build_context": build_hdhive_unlock_context,
        "prepare_locked_resources": prepare_locked_resources,
    }
    values.update(overrides)
    return HDHiveUnlockRuntimeDependencies(**values)


def test_runtime_adapter_builds_context_from_injected_settings() -> None:
    context = build_hdhive_unlock_context_with_runtime_adapter(
        dependencies=_dependencies(
            get_auto_unlock_enabled=lambda: True,
            get_max_points_per_item=lambda: 6,
            get_budget_points_per_run=lambda: 18,
            get_threshold_inclusive=lambda: True,
        )
    )

    assert context["enabled"] is True
    assert context["max_points_per_item"] == 6
    assert context["budget_total"] == 18
    assert context["budget_left"] == 18
    assert context["threshold_inclusive"] is True
    assert context["stats"] == {
        "attempted": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "points_spent": 0,
    }


@pytest.mark.asyncio
async def test_runtime_adapter_prepares_locked_resources_with_injected_helpers() -> None:
    events: list[tuple[str, Any]] = []

    def normalize_items(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        events.append(("normalize_items", resources))
        return [dict(item, normalized=True) for item in resources]

    def normalize_url(url: str) -> str:
        events.append(("normalize_share_url", url))
        return url.strip()

    async def unlock_resource(slug: str) -> dict[str, Any]:
        events.append(("unlock_resource", slug))
        return {
            "success": True,
            "message": "ok",
            "share_link": f" https://115.com/s/{slug}?password=abcd ",
        }

    resources = [{"source_service": "hdhive", "slug": "slug-a"}]
    context: dict[str, Any] = {}
    traces: list[dict[str, Any]] = []

    result = await prepare_hdhive_locked_resources_with_runtime_adapter(
        resources,
        context,
        traces,
        dependencies=_dependencies(
            normalize_items=normalize_items,
            normalize_share_url=normalize_url,
            unlock_resource=unlock_resource,
        ),
    )

    assert result == [
        {
            "source_service": "hdhive",
            "slug": "slug-a",
            "normalized": True,
            "share_link": "https://115.com/s/slug-a?password=abcd",
        }
    ]
    assert context == {"prepared": True}
    assert traces == [{"step": "prepared", "status": "success"}]
    assert events == [
        ("normalize_items", resources),
        ("unlock_resource", "slug-a"),
        ("normalize_share_url", " https://115.com/s/slug-a?password=abcd "),
    ]


def test_default_runtime_dependencies_bind_existing_helpers_and_runners() -> None:
    dependencies = build_default_hdhive_unlock_runtime_dependencies()

    assert dependencies.build_context is build_hdhive_unlock_context
    assert dependencies.prepare_locked_resources is prepare_hdhive_locked_resources
    assert dependencies.normalize_items is normalize_hdhive_subscription_items
    assert dependencies.extract_resource_url is extract_resource_url
    assert dependencies.normalize_share_url is normalize_share_url
    assert callable(dependencies.unlock_resource)
    assert isinstance(dependencies.get_auto_unlock_enabled(), bool)
    assert isinstance(dependencies.get_max_points_per_item(), int)
    assert isinstance(dependencies.get_budget_points_per_run(), int)
    assert isinstance(dependencies.get_threshold_inclusive(), bool)


def test_hdhive_unlock_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_hdhive_unlock_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.hdhive_unlock_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.hdhive_service import hdhive_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.hdhive_unlock import (
    build_hdhive_unlock_context,
    prepare_hdhive_locked_resources,
)
from app.services.subscriptions.resource_candidates import (
    extract_resource_url,
    normalize_share_url,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)


BuildContext = Callable[..., dict[str, Any]]
PrepareLockedResources = Callable[..., Awaitable[list[dict[str, Any]]]]


@dataclass(frozen=True, slots=True)
class HDHiveUnlockRuntimeDependencies:
    get_auto_unlock_enabled: Callable[[], bool]
    get_max_points_per_item: Callable[[], int]
    get_budget_points_per_run: Callable[[], int]
    get_threshold_inclusive: Callable[[], bool]
    normalize_items: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    extract_resource_url: Callable[[dict[str, Any]], str]
    normalize_share_url: Callable[[str], str]
    unlock_resource: Callable[[str], Awaitable[dict[str, Any]]]
    build_context: BuildContext
    prepare_locked_resources: PrepareLockedResources


def build_default_hdhive_unlock_runtime_dependencies() -> (
    HDHiveUnlockRuntimeDependencies
):
    return HDHiveUnlockRuntimeDependencies(
        get_auto_unlock_enabled=(
            runtime_settings_service.get_subscription_hdhive_auto_unlock_enabled
        ),
        get_max_points_per_item=(
            runtime_settings_service.get_subscription_hdhive_unlock_max_points_per_item
        ),
        get_budget_points_per_run=(
            runtime_settings_service.get_subscription_hdhive_unlock_budget_points_per_run
        ),
        get_threshold_inclusive=(
            runtime_settings_service.get_subscription_hdhive_unlock_threshold_inclusive
        ),
        normalize_items=normalize_hdhive_subscription_items,
        extract_resource_url=extract_resource_url,
        normalize_share_url=normalize_share_url,
        unlock_resource=hdhive_service.unlock_resource,
        build_context=build_hdhive_unlock_context,
        prepare_locked_resources=prepare_hdhive_locked_resources,
    )


def build_hdhive_unlock_context_with_runtime_adapter(
    *,
    dependencies: HDHiveUnlockRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_hdhive_unlock_runtime_dependencies()
    )
    budget_total = current_dependencies.get_budget_points_per_run()
    return current_dependencies.build_context(
        enabled=current_dependencies.get_auto_unlock_enabled(),
        max_points_per_item=current_dependencies.get_max_points_per_item(),
        budget_total=budget_total,
        threshold_inclusive=current_dependencies.get_threshold_inclusive(),
    )


async def prepare_hdhive_locked_resources_with_runtime_adapter(
    resources: list[dict[str, Any]],
    context: dict[str, Any],
    traces: list[dict[str, Any]],
    *,
    dependencies: HDHiveUnlockRuntimeDependencies | None = None,
) -> list[dict[str, Any]]:
    current_dependencies = (
        dependencies or build_default_hdhive_unlock_runtime_dependencies()
    )
    return await current_dependencies.prepare_locked_resources(
        resources,
        context,
        traces,
        normalize_items=current_dependencies.normalize_items,
        extract_resource_url=current_dependencies.extract_resource_url,
        normalize_share_url=current_dependencies.normalize_share_url,
        unlock_resource=current_dependencies.unlock_resource,
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_hdhive_unlock_runtime_adapter.py
```

Expected: PASS.

## Task 3: Wire SubscriptionService to Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace imports**

In `backend/app/services/subscription_service.py`, replace the HDHive unlock imports so the service imports runtime wrappers and keeps only pure helper functions it still exposes:

```python
from app.services.subscriptions.hdhive_unlock import (
    allow_unlock_by_threshold,
    safe_int,
    should_stop_unlocking_on_message,
)
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
```

Remove no-longer-used direct imports:

```python
from app.services.hdhive_service import hdhive_service
```

and remove `normalize_hdhive_subscription_items` from the service imports if it is no longer referenced elsewhere.

- [ ] **Step 2: Simplify service wrappers**

Change `_build_hdhive_unlock_context()` and `_prepare_hdhive_locked_resources()` to:

```python
    def _build_hdhive_unlock_context(self) -> dict[str, Any]:
        return build_hdhive_unlock_context_with_runtime_adapter()

    async def _prepare_hdhive_locked_resources(
        self,
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return await prepare_hdhive_locked_resources_with_runtime_adapter(
            resources,
            context,
            traces,
        )
```

- [ ] **Step 3: Run targeted regression**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_hdhive_unlock_policy.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_fetcher_runtime_adapter.py tests/test_subscription_resource_ingest_run_flow.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py backend/tests/test_subscription_hdhive_unlock_runtime_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅 HDHive 解锁 runtime adapter"
```

## Task 4: Full Verification

**Files:**
- No edits.

- [ ] **Step 1: Backend full verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: all backend tests pass.

- [ ] **Step 2: Frontend production build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build exits 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Project quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: command exits 0.

- [ ] **Step 4: Docker build and health check**

Run:

```bash
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: container is healthy and `/healthz` returns `{"status":"healthy"}`.

- [ ] **Step 5: Final workspace check**

Run:

```bash
git status --short
wc -l backend/app/services/subscription_service.py
git log --oneline -10
```

Expected: `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: plan covers new runtime adapter, service wiring, tests, targeted verification, full verification, Docker health, and workspace check.
- 占位扫描：没有未决步骤；代码片段和命令都是明确的。
- Type consistency: `HDHiveUnlockRuntimeDependencies`, `build_hdhive_unlock_context_with_runtime_adapter()`, and `prepare_hdhive_locked_resources_with_runtime_adapter()` names match across tests, implementation, and service wiring.
