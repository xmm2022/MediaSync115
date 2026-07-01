# Subscription Resource Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription resource candidate storage from `subscription_service.py` into a dependency-injected helper module.

**Architecture:** Add `app.services.subscriptions.resource_storage` with a small dependency dataclass and one async `store_new_resources()` function. Keep `SubscriptionService` as the DB/runtime adapter that loads existing URLs, constructs `DownloadRecord`, and injects `MediaStatus.MATCHED`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, SQLAlchemy async session in the service wrapper, existing subscription helper modules.

---

### Task 1: Add Resource Storage Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_storage.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.resource_storage import (
    ResourceStorageDependencies,
    store_new_resources,
)
```

Add a dependency factory used by the tests:

```python
def _dependencies(
    *,
    existing_urls: set[str] | None = None,
    offline_enabled: bool = False,
):
    records: list[Any] = []
    load_calls: list[int] = []

    async def load_existing_resource_urls(subscription_id: int) -> set[str]:
        load_calls.append(subscription_id)
        return set(existing_urls or set())

    def add_record(
        subscription_id: int,
        resource_name: str,
        resource_url: str,
        resource_type: str,
        status: Any,
    ) -> Any:
        record = SimpleNamespace(
            subscription_id=subscription_id,
            resource_name=resource_name,
            resource_url=resource_url,
            resource_type=resource_type,
            status=status,
        )
        records.append(record)
        return record

    dependencies = ResourceStorageDependencies(
        load_existing_resource_urls=load_existing_resource_urls,
        add_record=add_record,
        offline_transfer_enabled=lambda: offline_enabled,
        record_status_matched="MATCHED",
    )
    return dependencies, records, load_calls
```

Test cases:

- `test_store_new_resources_returns_default_stats_without_loading_empty_input()`
- `test_store_new_resources_creates_pan115_records_and_tracks_checked_count()`
- `test_store_new_resources_counts_existing_url_duplicates()`
- `test_store_new_resources_counts_same_batch_duplicates()`
- `test_store_new_resources_rejects_offline_url_when_offline_disabled()`
- `test_store_new_resources_accepts_magnet_when_offline_enabled()`
- `test_resource_storage_module_stays_dependency_injected()`

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_storage'`.

### Task 2: Implement Resource Storage Helper

**Files:**
- Create: `backend/app/services/subscriptions/resource_storage.py`

- [ ] **Step 1: Add dependency dataclass**

Create the helper shell:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.resource_candidates import (
    extract_offline_url,
    extract_resource_url,
)
from app.services.subscriptions.resource_metadata import (
    determine_resource_type,
    extract_resource_name,
)

LoadExistingResourceUrls = Callable[[int], Awaitable[set[str]]]
AddRecord = Callable[[int, str, str, str, Any], Any]
OfflineTransferEnabled = Callable[[], bool]


@dataclass(frozen=True)
class ResourceStorageDependencies:
    load_existing_resource_urls: LoadExistingResourceUrls
    add_record: AddRecord
    offline_transfer_enabled: OfflineTransferEnabled
    record_status_matched: Any
```

- [ ] **Step 2: Implement `store_new_resources()`**

Add the extracted logic:

```python
async def store_new_resources(
    subscription_id: int,
    resources: list[dict[str, Any]],
    *,
    dependencies: ResourceStorageDependencies,
) -> dict[str, Any]:
    if not resources:
        return {
            "created_records": [],
            "checked_count": 0,
            "duplicate_count": 0,
            "duplicate_urls": [],
            "invalid_count": 0,
        }

    existing_urls = set(
        await dependencies.load_existing_resource_urls(subscription_id)
    )
    offline_enabled = dependencies.offline_transfer_enabled()
    created_records: list[Any] = []
    duplicate_urls: set[str] = set()
    duplicate_count = 0
    invalid_count = 0

    for item in resources:
        resource_url = extract_resource_url(item)
        resource_type = "pan115"
        if not resource_url and offline_enabled:
            resource_url = extract_offline_url(item)
            if resource_url:
                resource_type = determine_resource_type(resource_url)
        if not resource_url:
            invalid_count += 1
            continue
        if resource_url in existing_urls:
            duplicate_count += 1
            duplicate_urls.add(resource_url)
            continue

        record = dependencies.add_record(
            subscription_id,
            extract_resource_name(item),
            resource_url,
            resource_type,
            dependencies.record_status_matched,
        )
        existing_urls.add(resource_url)
        created_records.append(record)

    return {
        "created_records": created_records,
        "checked_count": len(resources),
        "duplicate_count": duplicate_count,
        "duplicate_urls": list(duplicate_urls),
        "invalid_count": invalid_count,
    }
```

- [ ] **Step 3: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage.py
```

Expected: PASS.

### Task 3: Replace Service Storage with Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper**

```python
from app.services.subscriptions.resource_storage import (
    ResourceStorageDependencies,
    store_new_resources as store_new_resources_flow,
)
```

- [ ] **Step 2: Replace `_store_new_resources()` body**

Preserve the existing method signature and move DB/runtime details into local callbacks:

```python
async def _store_new_resources(
    self,
    db: AsyncSession,
    subscription_id: int,
    resources: list[dict[str, Any]],
) -> dict[str, Any]:
    async def load_existing_resource_urls(
        current_subscription_id: int,
    ) -> set[str]:
        with db.no_autoflush:
            existing_result = await db.execute(
                select(DownloadRecord.resource_url).where(
                    DownloadRecord.subscription_id == current_subscription_id
                )
            )
        return {
            str(row[0])
            for row in existing_result.all()
            if row and row[0]
        }

    def add_record(
        current_subscription_id: int,
        resource_name: str,
        resource_url: str,
        resource_type: str,
        status: Any,
    ) -> DownloadRecord:
        record = DownloadRecord(
            subscription_id=current_subscription_id,
            resource_name=resource_name,
            resource_url=resource_url,
            resource_type=resource_type,
            status=status,
        )
        db.add(record)
        return record

    return await store_new_resources_flow(
        subscription_id,
        resources,
        dependencies=ResourceStorageDependencies(
            load_existing_resource_urls=load_existing_resource_urls,
            add_record=add_record,
            offline_transfer_enabled=(
                runtime_settings_service.get_subscription_offline_transfer_enabled
            ),
            record_status_matched=MediaStatus.MATCHED,
        ),
    )
```

- [ ] **Step 3: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

```bash
git add backend/app/services/subscriptions/resource_storage.py backend/app/services/subscription_service.py backend/tests/test_subscription_resource_storage.py
git commit -m "refactor: 抽离订阅资源入库"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: exit 0.

- [ ] **Step 2: Run backend full verification**

```bash
scripts/verify-backend.sh
```

Expected: exit 0.

- [ ] **Step 3: Run frontend build**

```bash
npm --prefix frontend run build
```

Expected: exit 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run quick verification**

```bash
scripts/verify.sh --quick
```

Expected: exit 0.

- [ ] **Step 5: Build and start Docker service**

```bash
docker compose up -d --build mediasync115
```

Expected: exit 0.

- [ ] **Step 6: Check health**

```bash
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true)
  echo "health=$status"
  if [ "$status" = healthy ]; then exit 0; fi
  sleep 2
done
exit 1
```

Then verify the HTTP endpoint and compose state:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and the service health is `healthy`.

- [ ] **Step 7: Confirm worktree state**

```bash
git status --short
```

Expected: only these existing untracked files remain:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: the plan covers empty input, pan115 storage, duplicate handling, offline URL gating, module boundaries, service adapter wiring, targeted regressions, full verification, Docker health, and final worktree state.
- 占位符扫描：没有未完成实现步骤。
- Type consistency: `ResourceStorageDependencies`, `store_new_resources()`, and `store_new_resources_flow` names match the tests, helper, and service wrapper.
