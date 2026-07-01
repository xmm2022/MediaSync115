# Subscription Auto Transfer Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `_auto_save_resources()` batch orchestration into a dependency-injected helper while preserving automatic transfer behavior.

**Architecture:** Add `app.services.subscriptions.auto_transfer_batch` with statuses/dependencies dataclasses and an async batch flow. Keep `SubscriptionService._auto_save_resources()` responsible for runtime service construction and callbacks, then delegate record-loop orchestration to the new helper.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing MediaSync115 subscription helper modules.

---

### Task 1: Add Auto Transfer Batch Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_batch.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.models import MediaType
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchDependencies,
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
```

Test cases:

- `test_auto_transfer_batch_submits_share_record_and_returns_cleanup()`
- `test_auto_transfer_batch_submits_offline_movie_and_stops()`
- `test_auto_transfer_batch_records_ordinary_transfer_failure()`
- `test_auto_transfer_batch_uses_precise_tv_transfer_and_remaining_count()`
- `test_auto_transfer_batch_handles_already_received_without_failure()`
- `test_auto_transfer_batch_module_stays_dependency_injected()`

Use simple `SimpleNamespace` subscriptions and records, string statuses, fake Pan115 callbacks, fake operation log callbacks, and `datetime(2026, 7, 2, 2, 30, 0)` as the deterministic `now`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_batch.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_batch'`.

### Task 2: Implement Batch Helper

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_batch.py`

- [ ] **Step 1: Add dataclasses and callback types**

Create:

```python
@dataclass(frozen=True)
class AutoTransferBatchStatuses:
    transferring: Any
    downloading: Any
    offline_submitted: Any
    matched: Any
    completed: Any
    failed: Any


@dataclass(frozen=True)
class AutoTransferBatchDependencies:
    fetch_tv_missing_status: FetchTvMissingStatus
    create_step_log: CreateStepLog
    get_offline_folder_id: Callable[[], str]
    submit_offline_task: SubmitOfflineTask
    emit_transfer_success: EmitTransferSuccess
    select_precise_missing_episode_files: SelectPreciseMissingEpisodeFiles
    extract_share_code: Callable[[str], str]
    get_share_all_files_recursive: GetShareAllFilesRecursive
    save_share_files_directly: SaveShareFilesDirectly
    save_share_directly: SaveShareDirectly
    apply_precise_postprocess_status: ApplyPostprocessStatus
    notify_transfer_success: NotifyTransferSuccess
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer
    log_operation: LogOperation
    now: Callable[[], datetime]
    is_video_file: Callable[[str], bool]
```

- [ ] **Step 2: Move orchestration into helper**

Implement:

```python
async def auto_save_resources_batch(
    *,
    sub: Any,
    records: list[Any],
    source: str,
    parent_folder_id: str,
    quality_filter: dict[str, Any],
    statuses: AutoTransferBatchStatuses,
    dependencies: AutoTransferBatchDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    trace_id: str = "",
) -> dict[str, Any]:
    ...
```

Move the existing `_auto_save_resources()` loop into the helper, replacing direct runtime calls with `dependencies.*`. Import and reuse existing sibling helpers: `build_auto_transfer_tv_missing_context`, `submit_offline_transfer_record`, `submit_precise_transfer_record`, `submit_share_transfer_record`, `handle_already_received_transfer`, `handle_transfer_failure`, `is_offline_transfer_record`, `split_share_link_and_receive_code`, `is_already_received_error`, and pure cleanup policies.

- [ ] **Step 3: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_batch.py
```

Expected: PASS.

### Task 3: Replace Service Method Body with Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import the batch helper**

```python
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchDependencies,
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
```

- [ ] **Step 2: Keep runtime setup in `_auto_save_resources()`**

Keep:

- `runtime_settings_service.get_pan115_cookie()`
- `Pan115Service(runtime_cookie)`
- default parent folder lookup
- quality filter lookup
- step log callback closure
- TV missing status callback closure
- offline task callback closure
- Kafka emit callback closure
- precise missing episode selector closure

- [ ] **Step 3: Delegate to `auto_save_resources_batch()`**

Build statuses from `MediaStatus`, build dependencies from current callbacks and services, then return the helper result.

- [ ] **Step 4: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_context.py tests/test_subscription_auto_transfer_offline.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_already_received.py tests/test_subscription_auto_transfer_failure.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_link_fallback.py
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add backend/app/services/subscriptions/auto_transfer_batch.py backend/app/services/subscription_service.py backend/tests/test_subscription_auto_transfer_batch.py
git commit -m "refactor: 抽离订阅自动转存批处理"
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

- Spec coverage: the plan covers tests, new helper module, service adapter, targeted regressions, full verification, Docker health, and final worktree state.
- 占位符扫描：没有未完成实现步骤。
- Type consistency: `AutoTransferBatchDependencies`, `AutoTransferBatchStatuses`, and `auto_save_resources_batch()` are named consistently across tests, implementation, and service imports.
