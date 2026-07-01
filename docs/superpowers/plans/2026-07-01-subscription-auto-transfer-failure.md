# Subscription Auto Transfer Failure Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ordinary auto-transfer failure logging branch from `_auto_save_resources()`.

**Architecture:** Add `backend/app/services/subscriptions/auto_transfer_failure.py` with a callback-based helper for transfer failure logging. Keep `SubscriptionService._auto_save_resources()` responsible for exception classification and merging the returned failed counter/error entry.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Failure Handling Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_failure.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `handle_transfer_failure()` from `app.services.subscriptions.auto_transfer_failure`. Use `types.SimpleNamespace` for subscription and record-like objects, fake async callbacks for step logging and operation logging, and a long exception message to verify truncation boundaries.

Required behavior assertions:

```python
assert record.status == "failed"
assert record.error_message == error_text[:1000]
assert result.failed_increment == 1
assert result.error_entry == {
    "source": "hdhive",
    "subscription_id": 91,
    "title": "测试订阅",
    "resource": "资源 E",
    "error": error_text,
}
assert step_logs[0]["step"] == "auto_transfer_try_next_link"
assert step_logs[0]["payload"]["error"] == error_text[:300]
assert step_logs[1]["step"] == "auto_transfer_item_failed"
assert step_logs[1]["payload"]["error"] == error_text[:500]
assert operation_logs[0]["action"] == "subscription.record.transfer_fail"
assert operation_logs[0]["extra"]["error"] == error_text[:300]
```

Add a dependency-boundary test that reads `backend/app/services/subscriptions/auto_transfer_failure.py` and asserts it does not import `subscription_service`, `runtime_settings_service`, `pan115_service`, `operation_log_service`, `media_postprocess_service`, `kafka_producer`, `AsyncSession`, `app.models`, or `app.api`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_failure.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_failure'`.

### Task 2: Extract Failure Helper

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_failure.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement `TransferFailureHandlingResult` with:

```python
@dataclass(frozen=True)
class TransferFailureHandlingResult:
    failed_increment: int
    error_entry: dict[str, Any]
```

Implement `handle_transfer_failure()` with injected callbacks for:

```python
create_step_log
log_operation
```

Preserve the existing inline branch behavior, including exact step names, statuses, message text, operation action name, trace id forwarding, and truncation lengths.

- [ ] **Step 2: Delegate service logic**

Import `handle_transfer_failure()` in `backend/app/services/subscription_service.py`. Replace only the ordinary failure body after already-received handling with:

```python
failure_result = await handle_transfer_failure(
    sub=sub,
    record=record,
    source=source,
    exc=exc,
    failed_status=MediaStatus.FAILED,
    create_step_log=create_auto_transfer_step_log,
    log_operation=operation_log_service.log_background_event,
    trace_id=run_id,
)
failed += failure_result.failed_increment
errors.append(failure_result.error_entry)
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_failure.py tests/test_subscription_auto_transfer_already_received.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_offline.py tests/test_subscription_auto_transfer_context.py tests/test_subscription_link_fallback.py
```

Expected: all selected tests pass.

### Task 3: Verification, Commit, Deploy

- [ ] **Step 1: Verify**

Run:

```bash
scripts/verify-backend.sh --quick
scripts/verify-backend.sh
scripts/verify-frontend.sh --build
scripts/verify.sh --quick
git diff --check
```

Expected: all commands exit 0. The existing Vite chunk-size warning may remain.

- [ ] **Step 2: Commit**

Run:

```bash
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/auto_transfer_failure.py backend/tests/test_subscription_auto_transfer_failure.py
git commit -m "refactor: 抽离订阅自动转存失败处理"
```

- [ ] **Step 3: Rebuild and health check**

Run:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:5173/healthz
docker inspect -f '{{.State.Health.Status}}' mediasync115
docker logs --tail 80 mediasync115
```

Expected: health endpoint returns `{"status":"healthy"}` and Docker health is `healthy`.
