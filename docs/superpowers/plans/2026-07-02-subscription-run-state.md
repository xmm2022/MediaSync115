# Subscription Run State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `run_channel_check()` run-state and progress payload construction into a small pure helper module.

**Architecture:** Add `app.services.subscriptions.run_state` with three dict builder functions. Keep `SubscriptionService.run_channel_check()` responsible for mutating result counters, locking, callback timing, persistence, and orchestration.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run State Tests

**Files:**
- Create: `backend/tests/test_subscription_run_state.py`

- [ ] **Step 1: Write the failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.subscriptions.run_state import (
    build_initial_run_result,
    build_processing_progress_payload,
    build_start_progress_payload,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_initial_run_result_uses_existing_defaults() -> None:
    started_at = datetime(2026, 7, 2, 9, 30, 0)

    result = build_initial_run_result("hdhive", "run-1", started_at)

    assert result == {
        "channel": "hdhive",
        "run_id": "run-1",
        "checked_count": 0,
        "processed_count": 0,
        "new_resource_count": 0,
        "failed_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "resource_checked_count": 0,
        "resource_duplicate_count": 0,
        "hdhive_unlock_attempted_count": 0,
        "hdhive_unlock_success_count": 0,
        "hdhive_unlock_failed_count": 0,
        "hdhive_unlock_skipped_count": 0,
        "hdhive_unlock_points_spent": 0,
        "cleanup_deleted_count": 0,
        "cleanup_movie_deleted_count": 0,
        "cleanup_tv_deleted_count": 0,
        "errors": [],
        "started_at": "2026-07-02T09:30:00",
    }


def test_build_start_progress_payload_matches_existing_callback_shape() -> None:
    result: dict[str, Any] = {
        "channel": "all",
        "checked_count": 5,
        "processed_count": 2,
        "new_resource_count": 3,
        "auto_saved_count": 4,
        "auto_failed_count": 1,
        "auto_new_saved_count": 2,
        "auto_new_failed_count": 1,
        "auto_retry_saved_count": 2,
        "auto_retry_failed_count": 0,
        "failed_count": 1,
    }

    assert build_start_progress_payload(result) == {
        "channel": "all",
        "status": "running",
        "processed_count": 0,
        "checked_count": 5,
        "new_resource_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "failed_count": 0,
        "message": "任务开始执行",
    }


def test_build_processing_progress_payload_uses_current_result_counts() -> None:
    result: dict[str, Any] = {
        "channel": "tg",
        "checked_count": 8,
        "processed_count": 3,
        "new_resource_count": 6,
        "auto_saved_count": 4,
        "auto_failed_count": 2,
        "auto_new_saved_count": 3,
        "auto_new_failed_count": 1,
        "auto_retry_saved_count": 1,
        "auto_retry_failed_count": 1,
        "failed_count": 1,
    }

    assert build_processing_progress_payload(result) == {
        "channel": "tg",
        "status": "running",
        "processed_count": 3,
        "checked_count": 8,
        "new_resource_count": 6,
        "auto_saved_count": 4,
        "auto_failed_count": 2,
        "auto_new_saved_count": 3,
        "auto_new_failed_count": 1,
        "auto_retry_saved_count": 1,
        "auto_retry_failed_count": 1,
        "failed_count": 1,
        "message": "已处理 3/8 项订阅",
    }


def test_run_state_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_state.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_state.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_state'`.

### Task 2: Implement Run State Helper

**Files:**
- Create: `backend/app/services/subscriptions/run_state.py`

- [ ] **Step 1: Add the helper module**

```python
from __future__ import annotations

from datetime import datetime
from typing import Any


def build_initial_run_result(
    channel: str,
    run_id: str,
    started_at: datetime,
) -> dict[str, Any]:
    return {
        "channel": channel,
        "run_id": run_id,
        "checked_count": 0,
        "processed_count": 0,
        "new_resource_count": 0,
        "failed_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "resource_checked_count": 0,
        "resource_duplicate_count": 0,
        "hdhive_unlock_attempted_count": 0,
        "hdhive_unlock_success_count": 0,
        "hdhive_unlock_failed_count": 0,
        "hdhive_unlock_skipped_count": 0,
        "hdhive_unlock_points_spent": 0,
        "cleanup_deleted_count": 0,
        "cleanup_movie_deleted_count": 0,
        "cleanup_tv_deleted_count": 0,
        "errors": [],
        "started_at": started_at.isoformat(),
    }


def build_start_progress_payload(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": result["channel"],
        "status": "running",
        "processed_count": 0,
        "checked_count": result["checked_count"],
        "new_resource_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "failed_count": 0,
        "message": "任务开始执行",
    }


def build_processing_progress_payload(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": result["channel"],
        "status": "running",
        "processed_count": result["processed_count"],
        "checked_count": result["checked_count"],
        "new_resource_count": result["new_resource_count"],
        "auto_saved_count": result["auto_saved_count"],
        "auto_failed_count": result["auto_failed_count"],
        "auto_new_saved_count": result["auto_new_saved_count"],
        "auto_new_failed_count": result["auto_new_failed_count"],
        "auto_retry_saved_count": result["auto_retry_saved_count"],
        "auto_retry_failed_count": result["auto_retry_failed_count"],
        "failed_count": result["failed_count"],
        "message": f"已处理 {result['processed_count']}/{result['checked_count']} 项订阅",
    }
```

- [ ] **Step 2: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_state.py
```

Expected: PASS.

### Task 3: Replace Service State Builders with Adapter Calls

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper**

```python
from app.services.subscriptions.run_state import (
    build_initial_run_result,
    build_processing_progress_payload,
    build_start_progress_payload,
)
```

- [ ] **Step 2: Replace the initial result literal**

Use:

```python
result = build_initial_run_result(normalized_channel, run_id, started_at)
```

This replaces the existing dict literal that starts with `"channel": normalized_channel` and ends with `"started_at": started_at.isoformat()`.

- [ ] **Step 3: Replace the start progress payload literal**

Use:

```python
await progress_callback(build_start_progress_payload(result))
```

This keeps the existing callback timing after `result["checked_count"]` has been set.

- [ ] **Step 4: Replace the per-item progress payload literal**

Inside the `finally` block, after incrementing `result["processed_count"]`, use:

```python
progress_payload = build_processing_progress_payload(result)
```

Keep the callback outside the `result_lock` block.

- [ ] **Step 5: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_state.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 6: Commit implementation**

```bash
git add backend/app/services/subscriptions/run_state.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_state.py
git commit -m "refactor: 抽离订阅运行状态"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_state.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
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

- [ ] **Step 6: Check Docker and HTTP health**

```bash
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true)
  echo "health=$status"
  if [ "$status" = healthy ]; then exit 0; fi
  sleep 2
done
exit 1
```

Then verify the endpoint and compose status:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and the container health is `healthy`.

- [ ] **Step 7: Confirm final working tree boundary**

```bash
git status --short
```

Expected output only:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```
