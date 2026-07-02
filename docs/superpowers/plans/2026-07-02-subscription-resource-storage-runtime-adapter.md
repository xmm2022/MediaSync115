# 订阅资源入库 Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move resource storage runtime wiring out of `SubscriptionService`.

**Architecture:** Add `app.services.subscriptions.resource_storage_runtime_adapter` to bind the offline-transfer runtime switch, matched record status, core storage runner, and existing DB adapter runner. Keep `resource_storage.py` pure and keep `resource_storage_db_adapter.py` focused on DB/model adaptation.

**Tech Stack:** Python 3.13, pytest, async callbacks, dataclass dependency injection, existing backend verification scripts.

---

## File Structure

- Create: `backend/app/services/subscriptions/resource_storage_runtime_adapter.py`
  - Runtime dependency dataclass.
  - Default dependency builder for runtime settings, matched status, core storage runner, and DB adapter runner.
  - Runtime wrapper that translates runtime dependencies into `ResourceStorageDbAdapterDependencies`.
- Create: `backend/tests/test_subscription_resource_storage_runtime_adapter.py`
  - Red/green tests for wrapper dependency translation, default bindings, and module boundary.
- Modify: `backend/app/services/subscription_service.py`
  - Delegate `_store_new_resources()` to the runtime adapter.
  - Remove direct use of `ResourceStorageDbAdapterDependencies`, `store_new_resources_flow`, and `MediaStatus` when no longer needed.

## Task 1: Write Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_storage_runtime_adapter.py`

- [ ] **Step 1: Add failing tests**

Create `backend/tests/test_subscription_resource_storage_runtime_adapter.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.resource_storage import (
    store_new_resources as store_new_resources_flow,
)
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    ResourceStorageRuntimeDependencies,
    build_default_resource_storage_runtime_dependencies,
    store_new_resources_with_runtime_adapter,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> ResourceStorageRuntimeDependencies:
    async def run_store_new_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"stored": True}

    async def run_store_new_resources_with_db_adapter(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"db": True}

    values: dict[str, Any] = {
        "offline_transfer_enabled": lambda: False,
        "record_status_matched": "MATCHED",
        "run_store_new_resources": run_store_new_resources,
        "run_store_new_resources_with_db_adapter": (
            run_store_new_resources_with_db_adapter
        ),
    }
    values.update(overrides)
    return ResourceStorageRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_db_adapter_dependencies_and_forwards_arguments() -> None:
    db = object()
    resources = [{"name": "资源", "share_url": "https://115.com/s/new"}]
    core_runner_marker = object()
    captured: dict[str, Any] = {}

    async def run_store_new_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"core": core_runner_marker}

    async def run_store_new_resources_with_db_adapter(
        current_db: Any,
        subscription_id: int,
        current_resources: list[dict[str, Any]],
        *,
        dependencies: ResourceStorageDbAdapterDependencies,
    ) -> dict[str, Any]:
        captured["db"] = current_db
        captured["subscription_id"] = subscription_id
        captured["resources"] = current_resources
        captured["dependencies"] = dependencies
        return {
            "offline_enabled": dependencies.offline_transfer_enabled(),
            "matched_status": dependencies.record_status_matched,
            "core_runner": dependencies.run_store_new_resources,
        }

    result = await store_new_resources_with_runtime_adapter(
        db,
        42,
        resources,
        dependencies=_dependencies(
            offline_transfer_enabled=lambda: True,
            record_status_matched="CUSTOM_MATCHED",
            run_store_new_resources=run_store_new_resources,
            run_store_new_resources_with_db_adapter=(
                run_store_new_resources_with_db_adapter
            ),
        ),
    )

    assert result == {
        "offline_enabled": True,
        "matched_status": "CUSTOM_MATCHED",
        "core_runner": run_store_new_resources,
    }
    assert captured["db"] is db
    assert captured["subscription_id"] == 42
    assert captured["resources"] is resources
    assert isinstance(
        captured["dependencies"],
        ResourceStorageDbAdapterDependencies,
    )


def test_default_runtime_dependencies_bind_existing_helpers_and_status() -> None:
    dependencies = build_default_resource_storage_runtime_dependencies()

    assert dependencies.offline_transfer_enabled.__self__ is runtime_settings_service
    assert (
        dependencies.offline_transfer_enabled.__func__
        is type(runtime_settings_service).get_subscription_offline_transfer_enabled
    )
    assert dependencies.record_status_matched == MediaStatus.MATCHED
    assert dependencies.run_store_new_resources is store_new_resources_flow
    assert (
        dependencies.run_store_new_resources_with_db_adapter
        is store_new_resources_with_db_adapter
    )


def test_resource_storage_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_storage_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "DownloadRecord" not in source
```

- [ ] **Step 2: Run red test**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_storage_runtime_adapter'`.

## Task 2: Implement Runtime Adapter

**Files:**
- Create: `backend/app/services/subscriptions/resource_storage_runtime_adapter.py`

- [ ] **Step 1: Add adapter module**

Create `backend/app/services/subscriptions/resource_storage_runtime_adapter.py`:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.models.models import MediaStatus
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.resource_storage import (
    store_new_resources as store_new_resources_flow,
)
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)


RunStoreNewResources = Callable[..., Awaitable[dict[str, Any]]]
RunStoreNewResourcesWithDbAdapter = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class ResourceStorageRuntimeDependencies:
    offline_transfer_enabled: Callable[[], bool]
    record_status_matched: Any
    run_store_new_resources: RunStoreNewResources
    run_store_new_resources_with_db_adapter: RunStoreNewResourcesWithDbAdapter


def build_default_resource_storage_runtime_dependencies() -> (
    ResourceStorageRuntimeDependencies
):
    return ResourceStorageRuntimeDependencies(
        offline_transfer_enabled=(
            runtime_settings_service.get_subscription_offline_transfer_enabled
        ),
        record_status_matched=MediaStatus.MATCHED,
        run_store_new_resources=store_new_resources_flow,
        run_store_new_resources_with_db_adapter=store_new_resources_with_db_adapter,
    )


async def store_new_resources_with_runtime_adapter(
    db: Any,
    subscription_id: int,
    resources: list[dict[str, Any]],
    *,
    dependencies: ResourceStorageRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_resource_storage_runtime_dependencies()
    )
    return await current_dependencies.run_store_new_resources_with_db_adapter(
        db,
        subscription_id,
        resources,
        dependencies=ResourceStorageDbAdapterDependencies(
            offline_transfer_enabled=(
                current_dependencies.offline_transfer_enabled
            ),
            record_status_matched=current_dependencies.record_status_matched,
            run_store_new_resources=current_dependencies.run_store_new_resources,
        ),
    )
```

- [ ] **Step 2: Run adapter tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage_runtime_adapter.py
```

Expected: PASS.

## Task 3: Connect SubscriptionService Wrapper

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add import and replace method body**

In `backend/app/services/subscription_service.py`, add:

```python
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
```

Remove:

```python
from app.services.subscriptions.resource_storage import (
    store_new_resources as store_new_resources_flow,
)
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)
```

If no longer used, remove `MediaStatus` from the `app.models.models` import.

Replace `_store_new_resources()` with:

```python
    async def _store_new_resources(
        self,
        db: AsyncSession,
        subscription_id: int,
        resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await store_new_resources_with_runtime_adapter(
            db,
            subscription_id,
            resources,
        )
```

- [ ] **Step 2: Run related targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage_runtime_adapter.py tests/test_subscription_resource_storage_db_adapter.py tests/test_subscription_resource_storage.py tests/test_fetch_resources_waterfall.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 3: Inspect direct resource storage runtime imports**

Run:

```bash
rg -n "ResourceStorageDbAdapterDependencies|store_new_resources_flow|MediaStatus|store_new_resources_with_runtime_adapter" backend/app/services/subscription_service.py backend/app/services/subscriptions/resource_storage_runtime_adapter.py
```

Expected: DB adapter dependency, core storage runner, and `MediaStatus` appear only in `resource_storage_runtime_adapter.py`; `subscription_service.py` only references `store_new_resources_with_runtime_adapter`.

## Task 4: Commit and Verify

**Files:**
- Modify: `backend/app/services/subscription_service.py`
- Create: `backend/app/services/subscriptions/resource_storage_runtime_adapter.py`
- Create: `backend/tests/test_subscription_resource_storage_runtime_adapter.py`

- [ ] **Step 1: Check status**

Run:

```bash
git status --short
```

Expected: implementation files plus the two allowed pre-existing untracked files.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/resource_storage_runtime_adapter.py backend/tests/test_subscription_resource_storage_runtime_adapter.py
git commit -m "refactor: 抽离订阅资源入库 runtime adapter"
```

Expected: commit succeeds.

- [ ] **Step 3: Run full backend verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: PASS.

- [ ] **Step 6: Rebuild and start Docker service**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: command exits 0 and starts `mediasync115`.

- [ ] **Step 7: Wait for Docker health**

Run:

```bash
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
```

Expected: exits 0 after printing `health=healthy`.

- [ ] **Step 8: Final state checks**

Run:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
git log --oneline -12
```

Expected:

- `/healthz` returns `{"status":"healthy"}`.
- compose status shows `mediasync115` up and healthy.
- Docker inspect prints `healthy`.
- `git status --short` only shows:
  - `?? backend/scripts/export_hdhive_189_links.py`
  - `?? docs/next-session-prompt.md`
- `subscription_service.py` line count is lower than before this block.

## Self-Review

- Spec coverage: plan covers runtime adapter creation, service wrapper connection, related regression tests, full verification, Docker health check, and final status constraints.
- Placeholder scan: no unresolved placeholder wording is present.
- Type consistency: test dependency names match `ResourceStorageRuntimeDependencies`; implementation and service wrapper names match the planned imports.
