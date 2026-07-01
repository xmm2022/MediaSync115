# Subscription Run Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `run_channel_check()` finish-state, finish-log, and finish-step payload construction into a pure helper module.

**Architecture:** Add `app.services.subscriptions.run_completion` with mutating result helpers and pure payload builders. Keep `SubscriptionService` responsible for status resolution, message resolution, timestamps, database writes, operation logging calls, and finalize error handling.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run Completion Tests

**Files:**
- Create: `backend/tests/test_subscription_run_completion.py`

- [ ] **Step 1: Write the failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.subscriptions.run_completion import (
    apply_hdhive_unlock_stats,
    build_run_finish_event_extra,
    build_run_finish_event_message,
    build_run_finish_step_payload,
    complete_run_result,
)


ROOT = Path(__file__).resolve().parents[2]
```

Add a fixture helper used by payload tests:

```python
def _result() -> dict[str, Any]:
    return {
        "checked_count": 4,
        "resource_checked_count": 9,
        "new_resource_count": 3,
        "resource_duplicate_count": 2,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "failed_count": 1,
        "cleanup_deleted_count": 1,
        "cleanup_movie_deleted_count": 1,
        "cleanup_tv_deleted_count": 0,
        "hdhive_unlock_attempted_count": 5,
        "hdhive_unlock_success_count": 3,
        "hdhive_unlock_failed_count": 1,
        "hdhive_unlock_skipped_count": 1,
        "hdhive_unlock_points_spent": 9,
    }
```

Use these test cases:

```python
def test_apply_hdhive_unlock_stats_casts_values_and_defaults_missing() -> None:
    result = _result()

    apply_hdhive_unlock_stats(
        result,
        {
            "attempted": "6",
            "success": 4,
            "failed": None,
            "points_spent": "12",
        },
    )

    assert result["hdhive_unlock_attempted_count"] == 6
    assert result["hdhive_unlock_success_count"] == 4
    assert result["hdhive_unlock_failed_count"] == 0
    assert result["hdhive_unlock_skipped_count"] == 0
    assert result["hdhive_unlock_points_spent"] == 12


def test_complete_run_result_writes_finish_status_and_message() -> None:
    result = _result()
    finished_at = datetime(2026, 7, 2, 10, 15, 30)

    complete_run_result(
        result,
        status_value="partial",
        message="共 4 个订阅，发现 3 个新资源",
        finished_at=finished_at,
    )

    assert result["finished_at"] == "2026-07-02T10:15:30"
    assert result["status"] == "partial"
    assert result["message"] == "共 4 个订阅，发现 3 个新资源"


def test_build_run_finish_event_message_matches_existing_format() -> None:
    assert build_run_finish_event_message("all", _result()) == (
        "订阅检查任务完成（频道：all）：检查 4 项，"
        "新增资源 3 条，"
        "转存成功 2 条，转存失败 1 条，"
        "自动清理 1 项，"
        "失败 1 项"
    )


def test_build_run_finish_event_extra_matches_existing_shape() -> None:
    assert build_run_finish_event_extra("all", _result()) == {
        "channel": "all",
        "checked_count": 4,
        "new_resource_count": 3,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "cleanup_deleted_count": 1,
        "failed_count": 1,
        "hdhive_unlock_attempted_count": 5,
        "hdhive_unlock_success_count": 3,
        "hdhive_unlock_points_spent": 9,
    }


def test_build_run_finish_step_payload_matches_existing_shape() -> None:
    assert build_run_finish_step_payload(_result()) == {
        "checked_count": 4,
        "resource_checked_count": 9,
        "new_resource_count": 3,
        "resource_duplicate_count": 2,
        "auto_saved_count": 2,
        "auto_failed_count": 1,
        "failed_count": 1,
        "cleanup_deleted_count": 1,
        "cleanup_movie_deleted_count": 1,
        "cleanup_tv_deleted_count": 0,
        "hdhive_unlock_attempted_count": 5,
        "hdhive_unlock_success_count": 3,
        "hdhive_unlock_failed_count": 1,
        "hdhive_unlock_skipped_count": 1,
        "hdhive_unlock_points_spent": 9,
    }


def test_run_completion_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_completion.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_completion'`.

### Task 2: Implement Run Completion Helper

**Files:**
- Create: `backend/app/services/subscriptions/run_completion.py`

- [ ] **Step 1: Add helper functions**

```python
from __future__ import annotations

from datetime import datetime
from typing import Any


def apply_hdhive_unlock_stats(
    result: dict[str, Any],
    unlock_stats: dict[str, Any],
) -> None:
    result["hdhive_unlock_attempted_count"] = int(
        unlock_stats.get("attempted") or 0
    )
    result["hdhive_unlock_success_count"] = int(unlock_stats.get("success") or 0)
    result["hdhive_unlock_failed_count"] = int(unlock_stats.get("failed") or 0)
    result["hdhive_unlock_skipped_count"] = int(unlock_stats.get("skipped") or 0)
    result["hdhive_unlock_points_spent"] = int(
        unlock_stats.get("points_spent") or 0
    )


def complete_run_result(
    result: dict[str, Any],
    *,
    status_value: str,
    message: str,
    finished_at: datetime,
) -> None:
    result["finished_at"] = finished_at.isoformat()
    result["status"] = status_value
    result["message"] = message


def build_run_finish_event_message(channel: str, result: dict[str, Any]) -> str:
    return (
        f"订阅检查任务完成（频道：{channel}）：检查 {result['checked_count']} 项，"
        f"新增资源 {result['new_resource_count']} 条，"
        f"转存成功 {result['auto_saved_count']} 条，转存失败 {result['auto_failed_count']} 条，"
        f"自动清理 {result['cleanup_deleted_count']} 项，"
        f"失败 {result['failed_count']} 项"
    )


def build_run_finish_event_extra(
    channel: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "channel": channel,
        "checked_count": result["checked_count"],
        "new_resource_count": result["new_resource_count"],
        "auto_saved_count": result["auto_saved_count"],
        "auto_failed_count": result["auto_failed_count"],
        "cleanup_deleted_count": result["cleanup_deleted_count"],
        "failed_count": result["failed_count"],
        "hdhive_unlock_attempted_count": result[
            "hdhive_unlock_attempted_count"
        ],
        "hdhive_unlock_success_count": result["hdhive_unlock_success_count"],
        "hdhive_unlock_points_spent": result["hdhive_unlock_points_spent"],
    }


def build_run_finish_step_payload(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "checked_count": result["checked_count"],
        "resource_checked_count": result["resource_checked_count"],
        "new_resource_count": result["new_resource_count"],
        "resource_duplicate_count": result["resource_duplicate_count"],
        "auto_saved_count": result["auto_saved_count"],
        "auto_failed_count": result["auto_failed_count"],
        "failed_count": result["failed_count"],
        "cleanup_deleted_count": result["cleanup_deleted_count"],
        "cleanup_movie_deleted_count": result["cleanup_movie_deleted_count"],
        "cleanup_tv_deleted_count": result["cleanup_tv_deleted_count"],
        "hdhive_unlock_attempted_count": result[
            "hdhive_unlock_attempted_count"
        ],
        "hdhive_unlock_success_count": result[
            "hdhive_unlock_success_count"
        ],
        "hdhive_unlock_failed_count": result["hdhive_unlock_failed_count"],
        "hdhive_unlock_skipped_count": result["hdhive_unlock_skipped_count"],
        "hdhive_unlock_points_spent": result["hdhive_unlock_points_spent"],
    }
```

- [ ] **Step 2: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py
```

Expected: PASS.

### Task 3: Replace Service Completion Builders with Adapter Calls

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper**

```python
from app.services.subscriptions.run_completion import (
    apply_hdhive_unlock_stats,
    build_run_finish_event_extra,
    build_run_finish_event_message,
    build_run_finish_step_payload,
    complete_run_result,
)
```

- [ ] **Step 2: Replace HDHive unlock stat assignment**

Use:

```python
unlock_stats = hdhive_unlock_context.get("stats", {})
apply_hdhive_unlock_stats(result, unlock_stats)
```

- [ ] **Step 3: Replace finished result assignment**

Use:

```python
message = build_run_message(result)
finished_at = beijing_now()
complete_run_result(
    result,
    status_value=status.value,
    message=message,
    finished_at=finished_at,
)
```

- [ ] **Step 4: Replace finish background event message and extra**

Use:

```python
await operation_log_service.log_background_event(
    source_type="background_task",
    module="subscriptions",
    action="subscription.check.finish",
    status=status.value,
    message=build_run_finish_event_message(normalized_channel, result),
    trace_id=run_id,
    extra=build_run_finish_event_extra(normalized_channel, result),
)
```

- [ ] **Step 5: Replace run_finish step payload**

Use:

```python
payload=build_run_finish_step_payload(result),
```

- [ ] **Step 6: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py tests/test_subscription_run_state.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 7: Commit implementation**

```bash
git add backend/app/services/subscriptions/run_completion.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_completion.py
git commit -m "refactor: 抽离订阅运行收尾"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py tests/test_subscription_run_state.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
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

Then verify:

```bash
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
```

Expected: `/healthz` returns `{"status":"healthy"}` and Docker health is `healthy`.

- [ ] **Step 7: Confirm final working tree boundary**

```bash
git status --short
```

Expected output only:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```
