# Subscription Run Counters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract direct `run_channel_check()` result counter updates into a pure helper module.

**Architecture:** Add `app.services.subscriptions.run_counters` with small mutating functions for checked/processed/resource/transfer/failure counters. Keep lock ownership, logging, database work, cleanup stats, and business branching in `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run Counter Tests

**Files:**
- Create: `backend/tests/test_subscription_run_counters.py`

- [ ] **Step 1: Write failing tests**

Create direct tests for the future helper API:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.subscriptions.run_counters import (
    apply_auto_transfer_stats,
    apply_fixed_source_transfer_stats,
    apply_resource_store_stats,
    apply_subscription_failure,
    increment_processed_count,
    set_checked_count,
)


ROOT = Path(__file__).resolve().parents[2]
```

Add a result factory:

```python
def _result() -> dict[str, Any]:
    return {
        "checked_count": 0,
        "processed_count": 0,
        "new_resource_count": 0,
        "resource_checked_count": 0,
        "resource_duplicate_count": 0,
        "auto_saved_count": 0,
        "auto_failed_count": 0,
        "auto_new_saved_count": 0,
        "auto_new_failed_count": 0,
        "auto_retry_saved_count": 0,
        "auto_retry_failed_count": 0,
        "failed_count": 0,
        "errors": [],
    }
```

Use these test cases:

```python
def test_checked_and_processed_counters_update_existing_fields() -> None:
    result = _result()

    set_checked_count(result, 3)
    increment_processed_count(result)
    increment_processed_count(result)

    assert result["checked_count"] == 3
    assert result["processed_count"] == 2


def test_apply_resource_store_stats_accumulates_current_store_shape() -> None:
    result = _result()

    apply_resource_store_stats(
        result,
        {
            "created_records": [object(), object()],
            "checked_count": "5",
            "duplicate_count": "2",
        },
    )

    assert result["new_resource_count"] == 2
    assert result["resource_checked_count"] == 5
    assert result["resource_duplicate_count"] == 2


def test_apply_auto_transfer_stats_tracks_new_source_and_errors() -> None:
    result = _result()
    errors = [{"record_id": 1, "error": "failed"}]

    apply_auto_transfer_stats(
        result,
        {"saved": 2, "failed": 1, "errors": errors},
        transfer_source="new",
    )

    assert result["auto_saved_count"] == 2
    assert result["auto_failed_count"] == 1
    assert result["auto_new_saved_count"] == 2
    assert result["auto_new_failed_count"] == 1
    assert result["auto_retry_saved_count"] == 0
    assert result["auto_retry_failed_count"] == 0
    assert result["errors"] == errors


def test_apply_auto_transfer_stats_tracks_retry_source() -> None:
    result = _result()

    apply_auto_transfer_stats(
        result,
        {"saved": 1, "failed": 2, "errors": []},
        transfer_source="retry",
    )

    assert result["auto_saved_count"] == 1
    assert result["auto_failed_count"] == 2
    assert result["auto_new_saved_count"] == 0
    assert result["auto_new_failed_count"] == 0
    assert result["auto_retry_saved_count"] == 1
    assert result["auto_retry_failed_count"] == 2
    assert result["errors"] == []


def test_apply_fixed_source_transfer_stats_updates_total_transfer_counts() -> None:
    result = _result()

    apply_fixed_source_transfer_stats(result, saved=3, failed=1)

    assert result["auto_saved_count"] == 3
    assert result["auto_failed_count"] == 1
    assert result["auto_new_saved_count"] == 0
    assert result["auto_retry_saved_count"] == 0


def test_apply_subscription_failure_records_existing_error_shape() -> None:
    result = _result()

    apply_subscription_failure(
        result,
        subscription_id=12,
        title="测试订阅",
        error=RuntimeError("boom"),
    )

    assert result["failed_count"] == 1
    assert result["errors"] == [
        {
            "subscription_id": 12,
            "title": "测试订阅",
            "error": "boom",
        }
    ]


def test_run_counters_module_stays_independent_from_runtime_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_counters.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source
```

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_counters'`.

### Task 2: Implement Run Counter Helper

**Files:**
- Create: `backend/app/services/subscriptions/run_counters.py`

- [ ] **Step 1: Add helper functions**

```python
from __future__ import annotations

from typing import Any


def set_checked_count(result: dict[str, Any], checked_count: int) -> None:
    result["checked_count"] = checked_count


def increment_processed_count(result: dict[str, Any]) -> None:
    result["processed_count"] += 1


def apply_resource_store_stats(
    result: dict[str, Any],
    store_stats: dict[str, Any],
) -> None:
    result["new_resource_count"] += len(store_stats["created_records"])
    result["resource_checked_count"] += int(store_stats["checked_count"])
    result["resource_duplicate_count"] += int(store_stats["duplicate_count"])


def apply_auto_transfer_stats(
    result: dict[str, Any],
    auto_stats: dict[str, Any],
    *,
    transfer_source: str,
) -> None:
    saved = auto_stats["saved"]
    failed = auto_stats["failed"]
    result["auto_saved_count"] += saved
    result["auto_failed_count"] += failed
    if transfer_source == "new":
        result["auto_new_saved_count"] += saved
        result["auto_new_failed_count"] += failed
    elif transfer_source == "retry":
        result["auto_retry_saved_count"] += saved
        result["auto_retry_failed_count"] += failed
    else:
        raise ValueError("unsupported transfer source")
    if auto_stats["errors"]:
        result["errors"].extend(auto_stats["errors"])


def apply_fixed_source_transfer_stats(
    result: dict[str, Any],
    *,
    saved: int,
    failed: int,
) -> None:
    result["auto_saved_count"] += saved
    result["auto_failed_count"] += failed


def apply_subscription_failure(
    result: dict[str, Any],
    *,
    subscription_id: int,
    title: str,
    error: Exception,
) -> None:
    result["failed_count"] += 1
    result["errors"].append(
        {
            "subscription_id": subscription_id,
            "title": title,
            "error": str(error),
        }
    )
```

- [ ] **Step 2: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py
```

Expected: PASS.

### Task 3: Replace Service Counter Mutations

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper functions**

```python
from app.services.subscriptions.run_counters import (
    apply_auto_transfer_stats,
    apply_fixed_source_transfer_stats,
    apply_resource_store_stats,
    apply_subscription_failure,
    increment_processed_count,
    set_checked_count,
)
```

- [ ] **Step 2: Replace checked count assignment**

Use:

```python
set_checked_count(result, len(subscriptions))
```

- [ ] **Step 3: Replace resource store stats mutation**

Inside the existing `result_lock` block, use:

```python
apply_resource_store_stats(result, store_stats)
```

- [ ] **Step 4: Replace new auto-transfer stats mutation**

Inside the existing `result_lock` block, use:

```python
apply_auto_transfer_stats(
    result,
    new_auto_stats,
    transfer_source="new",
)
```

- [ ] **Step 5: Replace retry auto-transfer stats mutation**

Inside the existing `result_lock` block, use:

```python
apply_auto_transfer_stats(
    result,
    retry_auto_stats,
    transfer_source="retry",
)
```

- [ ] **Step 6: Replace fixed-source transfer stats mutation**

Inside the existing `result_lock` block, use:

```python
apply_fixed_source_transfer_stats(
    result,
    saved=fixed_saved,
    failed=fixed_failed,
)
```

- [ ] **Step 7: Replace subscription failure mutation**

Inside the existing `result_lock` block, use:

```python
apply_subscription_failure(
    result,
    subscription_id=sub_id,
    title=sub_title,
    error=exc,
)
```

- [ ] **Step 8: Replace processed count mutation**

Inside the existing `result_lock` block, use:

```python
increment_processed_count(result)
```

- [ ] **Step 9: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py tests/test_subscription_run_completion.py tests/test_subscription_run_state.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 10: Commit implementation**

```bash
git add backend/app/services/subscriptions/run_counters.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_counters.py
git commit -m "refactor: 抽离订阅运行计数器"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_counters.py tests/test_subscription_run_completion.py tests/test_subscription_run_state.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
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
