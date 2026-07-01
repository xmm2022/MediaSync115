# Subscription Auto Transfer Already-Received Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Pan115 already-received recovery branch from `_auto_save_resources()`.

**Architecture:** Add `backend/app/services/subscriptions/auto_transfer_already_received.py` with a callback-based helper for duplicate receive handling. Keep `SubscriptionService._auto_save_resources()` responsible for exception classification and outer loop control.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Already-Received Handling Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_already_received.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `handle_already_received_transfer()` from `app.services.subscriptions.auto_transfer_already_received`. Use `types.SimpleNamespace` for subscription and record-like objects, fake async callbacks for precise post-processing, notifications, step logging, and operation logging, plus a fixed timestamp callback.

Required non-TV assertions:

```python
assert record.status == "completed"
assert record.completed_at == datetime(2026, 7, 1, 23, 45, 0)
assert record.error_message is None
assert result.saved_increment == 1
assert result.should_stop is True
assert result.should_continue is False
assert result.subscription_completed is True
assert result.cleanup_step == "subscription_cleanup_transferred"
assert result.cleanup_message == "资源已在网盘中，已自动删除订阅"
assert result.cleanup_payload == {
    "source": "hdhive",
    "record_id": 81,
    "reason": "already_received",
    "target_parent_id": "parent-folder",
    "save_mode": "direct",
}
assert step_logs[0]["step"] == "auto_transfer_item_done"
assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
```

Required TV assertions:

```python
assert record.status == "archiving"
assert record.error_message is None
assert result.saved_increment == 1
assert result.should_continue is True
assert result.should_stop is False
assert result.subscription_completed is False
assert result.cleanup_step == ""
assert postprocess_calls == [record]
```

Add a dependency-boundary test that reads `backend/app/services/subscriptions/auto_transfer_already_received.py` and asserts it does not import `subscription_service`, `runtime_settings_service`, `pan115_service`, `operation_log_service`, `media_postprocess_service`, `kafka_producer`, `AsyncSession`, `app.models`, or `app.api`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_already_received.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_already_received'`.

### Task 2: Extract Already-Received Helper

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_already_received.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement `AlreadyReceivedHandlingResult` with:

```python
@dataclass(frozen=True)
class AlreadyReceivedHandlingResult:
    saved_increment: int
    should_continue: bool
    should_stop: bool
    subscription_completed: bool
    cleanup_step: str
    cleanup_message: str
    cleanup_payload: dict[str, Any]
```

Implement `handle_already_received_transfer()` with injected callbacks for:

```python
apply_precise_postprocess_status
notify_transfer_success
log_operation
create_step_log
now
```

Preserve the existing inline branch behavior, including exact step names, operation action names, notification method text, archive metadata, and non-TV cleanup metadata. Do not emit Kafka events.

- [ ] **Step 2: Delegate service logic**

Import `handle_already_received_transfer()` in `backend/app/services/subscription_service.py`. Replace only the body of the `if self._is_already_received_error(str(exc)):` branch with a helper call. Pass:

```python
sub=sub
record=record
source=source
parent_folder_id=parent_folder_id
is_tv_subscription=is_tv_subscription
tv_missing_enabled=tv_missing_enabled
completed_status=MediaStatus.COMPLETED
now=beijing_now
apply_precise_postprocess_status=self._apply_precise_transfer_postprocess_status
notify_transfer_success=self._notify_transfer_success
log_operation=operation_log_service.log_background_event
create_step_log=create_auto_transfer_step_log
trace_id=run_id
```

Then merge returned saved count and cleanup metadata. `continue` when `should_continue` is true and `break` when `should_stop` is true.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_already_received.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_offline.py tests/test_subscription_auto_transfer_context.py tests/test_subscription_link_fallback.py
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
git add backend/app/services/subscription_service.py backend/app/services/subscriptions/auto_transfer_already_received.py backend/tests/test_subscription_auto_transfer_already_received.py
git commit -m "refactor: 抽离订阅自动转存重复接收处理"
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
