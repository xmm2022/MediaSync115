# Subscription Auto Save Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `SubscriptionService._auto_save_resources()` runtime wiring into a dedicated subscriptions runtime adapter.

**Architecture:** Keep `auto_transfer_batch.py` and `auto_save_resources_adapter.py` unchanged. Add `auto_save_resources_runtime_adapter.py` as the service-layer wiring boundary that builds statuses, lower adapter dependencies, and the transfer success event callback.

**Tech Stack:** Python 3.12/3.13 test environment, pytest async tests, existing subscription auto-transfer modules.

---

### Task 1: Add Runtime Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_save_resources_runtime_adapter.py`

- [ ] **Step 1: Write the failing test file**

Create tests for the future module:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaStatus
from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    AutoSaveResourcesRuntimeDependencies,
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
    emit_transfer_success_event,
)
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 7, 2, 7, 0, 0)
```

Add tests that assert:

- `auto_save_resources_with_runtime_adapter(...)` calls the injected `run_adapter` with:
  - `db`, `run_id`, `channel`, `sub`, `records`, `source`, `tv_missing_snapshot`
  - the exact `AutoTransferBatchStatuses`
  - an `AutoSaveResourcesAdapterDependencies` instance
- The generated lower dependencies call the injected runtime callbacks, including `emit_transfer_success_event(subscription_id, data)`.
- `build_default_auto_save_resources_runtime_dependencies(...)` uses existing `MediaStatus` values and existing core runner functions.
- `emit_transfer_success_event(...)` sends Kafka only when `_enabled` is truthy, using event type `transfer_success` and `key=str(subscription_id)`.
- The runtime adapter module does not import `subscription_service` or `app.api`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_save_resources_runtime_adapter'`.

### Task 2: Implement Runtime Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py`

- [ ] **Step 1: Define runtime dependency type**

Implement:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.timezone_utils import beijing_now
from app.models.models import MediaStatus
from app.services.media_postprocess_service import media_postprocess_service
from app.services.operation_log_service import operation_log_service
from app.services.pan115_service import Pan115Service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    RunAutoSaveResourcesBatch,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
from app.services.subscriptions.resource_metadata import is_video_filename
from app.services.subscriptions.tv_episode_selection import (
    select_missing_episode_files as select_tv_missing_episode_files,
)
from app.services.tv_missing_service import tv_missing_service

RunAutoSaveResourcesAdapter = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class AutoSaveResourcesRuntimeDependencies:
    get_pan115_cookie: Callable[[], str]
    create_pan_service: Callable[[str], Any]
    get_pan115_default_folder: Callable[[], dict[str, Any]]
    get_pan115_offline_folder: Callable[[], dict[str, Any]]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    emit_transfer_success_event: Callable[[int, dict[str, Any]], None]
    select_tv_missing_episode_files: Callable[..., Any]
    apply_precise_postprocess_status: Callable[[Any], Awaitable[dict[str, Any]]]
    notify_transfer_success: Callable[..., Awaitable[None]]
    trigger_archive_after_transfer: Callable[..., Awaitable[dict[str, Any] | None]]
    log_operation: Callable[..., Awaitable[None]]
    now: Callable[[], datetime]
    is_video_file: Callable[[str], bool]
    statuses: AutoTransferBatchStatuses
    run_adapter: RunAutoSaveResourcesAdapter
    run_batch: RunAutoSaveResourcesBatch
```

- [ ] **Step 2: Add default transfer event emitter**

```python
def emit_transfer_success_event(subscription_id: int, data: dict[str, Any]) -> None:
    from app.analytics import kafka_producer

    if kafka_producer._enabled:
        kafka_producer.send(
            event_type="transfer_success",
            data=data,
            key=str(subscription_id),
        )
```

- [ ] **Step 3: Add default dependency builder**

```python
def build_default_auto_save_resources_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]],
    create_step_log: Callable[..., Awaitable[None]],
    apply_precise_postprocess_status: Callable[[Any], Awaitable[dict[str, Any]]],
    notify_transfer_success: Callable[..., Awaitable[None]],
) -> AutoSaveResourcesRuntimeDependencies:
    return AutoSaveResourcesRuntimeDependencies(
        get_pan115_cookie=runtime_settings_service.get_pan115_cookie,
        create_pan_service=Pan115Service,
        get_pan115_default_folder=runtime_settings_service.get_pan115_default_folder,
        get_pan115_offline_folder=runtime_settings_service.get_pan115_offline_folder,
        resolve_quality_filter=resolve_quality_filter,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        create_step_log=create_step_log,
        emit_transfer_success_event=emit_transfer_success_event,
        select_tv_missing_episode_files=select_tv_missing_episode_files,
        apply_precise_postprocess_status=apply_precise_postprocess_status,
        notify_transfer_success=notify_transfer_success,
        trigger_archive_after_transfer=media_postprocess_service.trigger_archive_after_transfer,
        log_operation=operation_log_service.log_background_event,
        now=beijing_now,
        is_video_file=is_video_filename,
        statuses=AutoTransferBatchStatuses(
            transferring=MediaStatus.TRANSFERRING,
            downloading=MediaStatus.DOWNLOADING,
            offline_submitted=MediaStatus.OFFLINE_SUBMITTED,
            matched=MediaStatus.MATCHED,
            completed=MediaStatus.COMPLETED,
            failed=MediaStatus.FAILED,
        ),
        run_adapter=auto_save_resources_with_adapter,
        run_batch=auto_save_resources_batch,
    )
```

- [ ] **Step 4: Add adapter entrypoint**

```python
async def auto_save_resources_with_runtime_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    source: str,
    dependencies: AutoSaveResourcesRuntimeDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await dependencies.run_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        source=source,
        statuses=dependencies.statuses,
        dependencies=AutoSaveResourcesAdapterDependencies(
            get_pan115_cookie=dependencies.get_pan115_cookie,
            create_pan_service=dependencies.create_pan_service,
            get_pan115_default_folder=dependencies.get_pan115_default_folder,
            get_pan115_offline_folder=dependencies.get_pan115_offline_folder,
            resolve_quality_filter=dependencies.resolve_quality_filter,
            get_tv_missing_status=dependencies.get_tv_missing_status,
            create_step_log=dependencies.create_step_log,
            emit_transfer_success=dependencies.emit_transfer_success_event,
            select_tv_missing_episode_files=dependencies.select_tv_missing_episode_files,
            apply_precise_postprocess_status=dependencies.apply_precise_postprocess_status,
            notify_transfer_success=dependencies.notify_transfer_success,
            trigger_archive_after_transfer=dependencies.trigger_archive_after_transfer,
            log_operation=dependencies.log_operation,
            now=dependencies.now,
            is_video_file=dependencies.is_video_file,
            run_batch=dependencies.run_batch,
        ),
        tv_missing_snapshot=tv_missing_snapshot,
    )
```

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Replace imports**

Remove direct imports that become unused:

```python
from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
```

Add:

```python
from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
)
```

- [ ] **Step 2: Replace `_auto_save_resources()` body**

Replace the body with:

```python
return await auto_save_resources_with_runtime_adapter(
    db=db,
    run_id=run_id,
    channel=channel,
    sub=sub,
    records=records,
    source=source,
    dependencies=build_default_auto_save_resources_runtime_dependencies(
        resolve_quality_filter=self._resolve_subscription_quality_filter,
        create_step_log=self._create_step_log,
        apply_precise_postprocess_status=(
            self._apply_precise_transfer_postprocess_status
        ),
        notify_transfer_success=self._notify_transfer_success,
    ),
    tv_missing_snapshot=tv_missing_snapshot,
)
```

- [ ] **Step 3: Confirm removed local wiring**

Confirm `_auto_save_resources()` no longer contains:

- `def emit_transfer_success`
- `AutoTransferBatchStatuses(`
- `AutoSaveResourcesAdapterDependencies(`

### Task 4: Green Targeted Tests and Commit

- [ ] **Step 1: Run targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py
```

- [ ] **Step 2: Inspect diff**

Confirm:

- `subscription_service.py` removed `_auto_save_resources()` local runtime wiring.
- New runtime adapter is the only new production module.
- `auto_save_resources_adapter.py` and `auto_transfer_batch.py` are unchanged.
- The two existing untracked files are not staged.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py backend/tests/test_subscription_auto_save_resources_runtime_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅自动转存 runtime adapter"
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
