# Subscription Auto Transfer Share Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ordinary direct share-transfer branch from `_auto_save_resources()`.

**Architecture:** Add `backend/app/services/subscriptions/auto_transfer_share.py` with a callback-based single-record transfer helper. Keep `SubscriptionService._auto_save_resources()` responsible for runtime dependencies and branch selection.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Share Submission Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_share.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `submit_share_transfer_record()` from `app.services.subscriptions.auto_transfer_share`. Use `types.SimpleNamespace` for subscription and record-like objects, fake async callbacks for save/notification/archive/logging, and fixed timestamp callbacks.

Required assertions:

```python
assert record.status == "completed"
assert record.completed_at == datetime(2026, 7, 1, 23, 0, 0)
assert result.saved_increment == 1
assert result.should_stop is True
assert result.subscription_completed is True
assert result.cleanup_step == "subscription_cleanup_transferred"
assert step_logs[0]["step"] == "auto_transfer_item_done"
assert operation_logs[0]["action"] == "subscription.record.transfer_ok"
```

Add an event best-effort test that makes the event callback raise and still verifies the helper returns success. Add a dependency-boundary test that rejects direct imports of service/runtime/database/API/model layers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_share.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_share'`.

### Task 2: Extract Share Submission Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_share.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement `ShareTransferSubmissionResult` and `submit_share_transfer_record()` with the same record mutations, notification text, archive trigger, log payloads, event data, and cleanup metadata used by the current inline branch.

- [ ] **Step 2: Delegate service logic**

Replace the ordinary direct-share branch inside `_auto_save_resources()` with callbacks passed to `submit_share_transfer_record()`. Merge the returned saved count and cleanup metadata, then break based on `should_stop`.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_offline.py tests/test_subscription_auto_transfer_context.py tests/test_subscription_link_fallback.py
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
git add docs/superpowers/specs/2026-07-01-subscription-auto-transfer-share-design.md docs/superpowers/plans/2026-07-01-subscription-auto-transfer-share.md backend/app/services/subscriptions/auto_transfer_share.py backend/app/services/subscription_service.py backend/tests/test_subscription_auto_transfer_share.py
git commit -m "refactor: 抽离订阅自动转存分享提交"
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
