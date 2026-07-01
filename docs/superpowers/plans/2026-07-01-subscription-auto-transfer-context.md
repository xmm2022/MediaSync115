# Subscription Auto Transfer Context Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract TV missing-episode context preparation from `_auto_save_resources()`.

**Architecture:** Add `backend/app/services/subscriptions/auto_transfer_context.py` with a callback-based context builder. Keep `SubscriptionService._auto_save_resources()` responsible for runtime service callbacks and actual transfer execution.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Auto Transfer Context Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_transfer_context.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `AutoTransferTvMissingContext` and `build_auto_transfer_tv_missing_context()` from `app.services.subscriptions.auto_transfer_context`. Use `types.SimpleNamespace` for subscription-like objects and fake async callbacks for missing-status fetch and step logging.

Required assertions:

```python
assert context.is_tv_subscription is True
assert context.tv_missing_enabled is True
assert context.missing_episodes == {(1, 2), (1, 3)}
assert [row["step"] for row in logs] == ["tv_missing_fetch_start", "tv_missing_fetch_done"]
```

Add a snapshot reuse test that proves no fetch/log callbacks run. Add a failed fresh-fetch test that proves `tv_missing_fetch_failed` is logged and the context remains disabled. Add a dependency-boundary test that rejects direct imports of service/runtime/database/API/model layers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_context.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_transfer_context'`.

### Task 2: Extract Context Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_transfer_context.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement `AutoTransferTvMissingContext`, `build_auto_transfer_tv_missing_context()`, media-type detection without importing `MediaType`, and missing-pair normalization.

- [ ] **Step 2: Delegate service logic**

Replace the TV missing-context block at the top of `_auto_save_resources()` with callbacks passed to `build_auto_transfer_tv_missing_context()`. Reuse returned `is_tv_subscription`, `tv_missing_enabled`, and `missing_episodes` variables for the rest of the method.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_context.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_link_fallback.py
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
git add docs/superpowers/specs/2026-07-01-subscription-auto-transfer-context-design.md docs/superpowers/plans/2026-07-01-subscription-auto-transfer-context.md backend/app/services/subscriptions/auto_transfer_context.py backend/app/services/subscription_service.py backend/tests/test_subscription_auto_transfer_context.py
git commit -m "refactor: 抽离订阅自动转存缺集上下文"
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
