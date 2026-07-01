# Subscription HDHive Unlock Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract HDHive locked-resource auto-unlock policy and execution from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/hdhive_unlock.py` with injected dependencies for normalization, URL handling, unlock calls, and sleep. Keep `SubscriptionService` wrapper methods as the runtime integration layer.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: HDHive Unlock Helper Tests

**Files:**
- Modify: `backend/tests/test_hdhive_unlock_policy.py`

- [ ] **Step 1: Write failing tests**

Add direct tests that import `app.services.subscriptions.hdhive_unlock`, call `build_hdhive_unlock_context()`, call `prepare_hdhive_locked_resources()` with fake callbacks, assert stop-after-first-success behavior, assert stop-message policy, and assert the module does not import service/runtime/database layers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.hdhive_unlock'`.

### Task 2: Extract HDHive Unlock Module

**Files:**
- Create: `backend/app/services/subscriptions/hdhive_unlock.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Move `build_hdhive_unlock_context()`, `prepare_hdhive_locked_resources()`, `allow_unlock_by_threshold()`, `safe_int()`, and `should_stop_unlocking_on_message()` into the new helper module. Use callback parameters instead of importing `SubscriptionService`, `runtime_settings_service`, or `hdhive_service`.

- [ ] **Step 2: Delegate service wrappers**

Update `SubscriptionService._build_hdhive_unlock_context()`, `_prepare_hdhive_locked_resources()`, `_allow_unlock_by_threshold()`, `_safe_int()`, and `_should_stop_unlocking_on_message()` to call the new helper functions.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py tests/test_fetch_resources_waterfall.py
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
git add docs/superpowers/specs/2026-07-01-subscription-hdhive-unlock-design.md docs/superpowers/plans/2026-07-01-subscription-hdhive-unlock.md backend/app/services/subscriptions/hdhive_unlock.py backend/app/services/subscription_service.py backend/tests/test_hdhive_unlock_policy.py
git commit -m "refactor: 抽离订阅 HDHive 解锁流程"
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
