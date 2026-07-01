# Subscription Postprocess Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract precise-transfer postprocess status updates from `subscription_service.py` into a dependency-injected helper module.

**Architecture:** Add `app.services.subscriptions.postprocess_status` with a dependency dataclass and one async status mutator. Keep `SubscriptionService` as the adapter that injects archive triggering, status enum values, and the current-time function.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper modules.

---

### Task 1: Add Postprocess Status Tests

**Files:**
- Create: `backend/tests/test_subscription_postprocess_status.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status,
)
```

Use dependency factories inside each test:

```python
archive_calls: list[str] = []

async def trigger_archive_after_transfer(*, trigger: str) -> dict[str, Any]:
    archive_calls.append(trigger)
    return {"triggered": True}
```

Test cases:

- `test_apply_postprocess_status_marks_archiving_when_archive_is_triggered()`
- `test_apply_postprocess_status_marks_completed_when_archive_is_not_triggered()`
- `test_postprocess_status_module_stays_dependency_injected()`

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.postprocess_status'`.

### Task 2: Implement Postprocess Status Helper

**Files:**
- Create: `backend/app/services/subscriptions/postprocess_status.py`

- [ ] **Step 1: Add dependency dataclass**

Create the helper shell:

```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any


TriggerArchiveAfterTransfer = Callable[..., Awaitable[dict[str, Any]]]
Now = Callable[[], datetime]


@dataclass(frozen=True)
class PostprocessStatusDependencies:
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer
    archiving_status: Any
    completed_status: Any
    now: Now
```

- [ ] **Step 2: Implement `apply_precise_transfer_postprocess_status()`**

Add the extracted behavior:

```python
async def apply_precise_transfer_postprocess_status(
    record: Any,
    *,
    dependencies: PostprocessStatusDependencies,
) -> dict[str, Any]:
    archive_result = await dependencies.trigger_archive_after_transfer(
        trigger="subscription_transfer"
    )
    if archive_result.get("triggered"):
        record.status = dependencies.archiving_status
        record.completed_at = None
    else:
        record.status = dependencies.completed_status
        record.completed_at = dependencies.now()
    record.error_message = None
    return archive_result
```

- [ ] **Step 3: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status.py
```

Expected: PASS.

### Task 3: Replace Service Postprocess Status with Adapter

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper**

```python
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status as apply_precise_transfer_postprocess_status_flow,
)
```

- [ ] **Step 2: Replace `_apply_precise_transfer_postprocess_status()` body**

Preserve the existing method signature:

```python
async def _apply_precise_transfer_postprocess_status(
    self,
    record: DownloadRecord,
) -> dict[str, Any]:
    return await apply_precise_transfer_postprocess_status_flow(
        record,
        dependencies=PostprocessStatusDependencies(
            trigger_archive_after_transfer=(
                media_postprocess_service.trigger_archive_after_transfer
            ),
            archiving_status=MediaStatus.ARCHIVING,
            completed_status=MediaStatus.COMPLETED,
            now=beijing_now,
        ),
    )
```

- [ ] **Step 3: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

```bash
git add backend/app/services/subscriptions/postprocess_status.py backend/app/services/subscription_service.py backend/tests/test_subscription_postprocess_status.py
git commit -m "refactor: 抽离订阅转存后处理状态"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_postprocess_status.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py
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

- Spec coverage: the plan covers archive-triggered status, non-triggered completed status, trigger string, error clearing, dependency boundary, service adapter wiring, targeted regressions, full verification, Docker health, and final worktree state.
- 占位符扫描：没有未完成实现步骤。
- Type consistency: `PostprocessStatusDependencies`, `apply_precise_transfer_postprocess_status()`, and `apply_precise_transfer_postprocess_status_flow` names match tests, helper, and service imports.
