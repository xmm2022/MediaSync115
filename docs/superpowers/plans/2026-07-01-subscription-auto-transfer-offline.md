# Subscription Auto Transfer Offline Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the magnet/ED2K offline submission branch from `_auto_save_resources()`.

**Architecture:** Add `backend/app/services/subscriptions/auto_transfer_offline.py` with a callback-based single-record submission helper. Keep `SubscriptionService._auto_save_resources()` responsible for runtime dependencies and the outer record loop.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Offline Submission Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_offline.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `is_offline_transfer_record()` and `submit_offline_transfer_record()` from `app.services.subscriptions.auto_transfer_offline`. Use `types.SimpleNamespace` for subscription and record-like objects, fake async callbacks for task submission/logging, and fixed timestamp callbacks.

Required assertions:

```python
assert record.status == "offline_submitted"
assert record.offline_status == "submitted"
assert record.offline_info_hash == "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
assert operation_logs[0]["action"] == "subscription.offline_transfer"
assert step_logs[0]["step"] == "auto_transfer_offline_done"
assert result.saved_increment == 1
assert result.should_stop is True
```

Add a TV subscription test that proves `should_stop` is false. Add detection tests for `magnet`, `ed2k`, and `pan115`. Add a dependency-boundary test that rejects direct imports of service/runtime/database/API/model layers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_offline.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_offline'`.

### Task 2: Extract Offline Submission Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_offline.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement offline type detection, `OfflineTransferSubmissionResult`, and `submit_offline_transfer_record()` with the same record mutations, log payloads, and event data used by the current inline branch.

- [ ] **Step 2: Delegate service logic**

Replace the magnet/ED2K branch inside `_auto_save_resources()` with callbacks passed to `submit_offline_transfer_record()`. Increment `saved` from the helper result, then `break` or `continue` based on `should_stop`.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_offline.py tests/test_subscription_offline_transfer.py tests/test_subscription_link_fallback.py tests/test_subscription_auto_transfer_context.py
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
git add docs/superpowers/specs/2026-07-01-subscription-auto-transfer-offline-design.md docs/superpowers/plans/2026-07-01-subscription-auto-transfer-offline.md backend/app/services/subscriptions/auto_transfer_offline.py backend/app/services/subscription_service.py backend/tests/test_subscription_auto_transfer_offline.py
git commit -m "refactor: 抽离订阅自动转存离线提交"
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
