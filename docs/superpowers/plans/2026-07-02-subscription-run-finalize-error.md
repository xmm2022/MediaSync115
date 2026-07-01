# Subscription Run Finalize Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract finalize-error result mutation and failed-step payload construction from `run_channel_check()`.

**Architecture:** Extend `app.services.subscriptions.run_completion` with three helper functions for the finalize failure branch. Keep rollback, step-log persistence, commit, and secondary rollback inside `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Finalize Error Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_completion.py`

- [ ] **Step 1: Extend imports**

Add the new helper imports:

```python
from app.services.subscriptions.run_completion import (
    apply_hdhive_unlock_stats,
    apply_run_finalize_error,
    build_run_finalize_failed_message,
    build_run_finalize_failed_payload,
    build_run_finish_event_extra,
    build_run_finish_event_message,
    build_run_finish_step_payload,
    complete_run_result,
)
```

- [ ] **Step 2: Add failing tests**

Add these tests before the module-boundary test:

```python
def test_apply_run_finalize_error_downgrades_success_and_records_error() -> None:
    result = {
        "status": "success",
        "message": "old",
        "errors": [],
    }
    finalize_error = "x" * 205

    apply_run_finalize_error(
        result,
        summary_message="共 4 个订阅",
        finalize_error=finalize_error,
        success_status_value="success",
        partial_status_value="partial",
    )

    assert result["status"] == "partial"
    assert result["finalize_error"] == finalize_error
    assert result["errors"] == [
        {"stage": "run_finalize", "error": finalize_error}
    ]
    assert result["message"] == f"共 4 个订阅；收尾阶段异常: {'x' * 200}"


def test_apply_run_finalize_error_keeps_non_success_status() -> None:
    result = {
        "status": "partial",
        "message": "old",
        "errors": [],
    }

    apply_run_finalize_error(
        result,
        summary_message="共 4 个订阅",
        finalize_error="write failed",
        success_status_value="success",
        partial_status_value="partial",
    )

    assert result["status"] == "partial"
    assert result["message"] == "共 4 个订阅；收尾阶段异常: write failed"


def test_build_run_finalize_failed_message_truncates_error() -> None:
    assert build_run_finalize_failed_message("e" * 205) == (
        f"写入执行日志失败：{'e' * 200}"
    )


def test_build_run_finalize_failed_payload_truncates_error() -> None:
    assert build_run_finalize_failed_payload(
        "e" * 505,
        status_before_finalize="success",
    ) == {
        "error": "e" * 500,
        "status_before_finalize": "success",
    }
```

- [ ] **Step 3: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py
```

Expected: FAIL during collection with `ImportError` for the missing `apply_run_finalize_error` symbol.

### Task 2: Implement Finalize Error Helpers

**Files:**
- Modify: `backend/app/services/subscriptions/run_completion.py`

- [ ] **Step 1: Add helper functions**

Append these functions after `build_run_finish_step_payload()`:

```python
def apply_run_finalize_error(
    result: dict[str, Any],
    *,
    summary_message: str,
    finalize_error: str,
    success_status_value: str,
    partial_status_value: str,
) -> None:
    result["errors"].append({"stage": "run_finalize", "error": finalize_error})
    result["finalize_error"] = finalize_error
    result["message"] = f"{summary_message}；收尾阶段异常: {finalize_error[:200]}"
    if result["status"] == success_status_value:
        result["status"] = partial_status_value


def build_run_finalize_failed_message(finalize_error: str) -> str:
    return f"写入执行日志失败：{finalize_error[:200]}"


def build_run_finalize_failed_payload(
    finalize_error: str,
    *,
    status_before_finalize: str,
) -> dict[str, Any]:
    return {
        "error": finalize_error[:500],
        "status_before_finalize": status_before_finalize,
    }
```

- [ ] **Step 2: Run helper tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py
```

Expected: PASS.

### Task 3: Replace Service Finalize Error Builders

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import new helper functions**

Add these names to the existing `run_completion` import:

```python
apply_run_finalize_error,
build_run_finalize_failed_message,
build_run_finalize_failed_payload,
```

- [ ] **Step 2: Replace result mutation in finalize except**

Replace direct result writes with:

```python
apply_run_finalize_error(
    result,
    summary_message=message,
    finalize_error=finalize_error,
    success_status_value=ExecutionStatus.SUCCESS.value,
    partial_status_value=ExecutionStatus.PARTIAL.value,
)
```

- [ ] **Step 3: Replace failed step message and payload**

Use:

```python
message=build_run_finalize_failed_message(finalize_error),
payload=build_run_finalize_failed_payload(
    finalize_error,
    status_before_finalize=status.value,
),
```

- [ ] **Step 4: Run targeted regression tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py tests/test_subscription_run_summary.py tests/test_subscriptions.py
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add backend/app/services/subscriptions/run_completion.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_completion.py
git commit -m "refactor: 抽离订阅收尾失败状态"
```

### Task 4: Required Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run backend targeted tests after commit**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_completion.py tests/test_subscription_run_summary.py tests/test_subscriptions.py
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
