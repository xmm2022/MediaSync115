# Subscription Run Cleanup Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract cleanup-after-transfer and fixed-source movie cleanup log kwargs construction from `SubscriptionService.run_channel_check()` into pure helper functions.

**Architecture:** Add `app.services.subscriptions.run_cleanup_logs` with dict builders only. Keep delete calls, cleanup counter updates, branch decisions, DB sessions, and async log writes in `run_channel_check()`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run Cleanup Log Tests

**Files:**
- Create: `backend/tests/test_subscription_run_cleanup_logs.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `build_cleanup_after_transfer_event_kwargs(...)`:
  - returns current `subscription.item.cleanup_after_transfer` event kwargs
  - default message suffix is `"订阅已自动清理"` when cleanup message is missing
  - extra reason comes from `cleanup_step`
- `build_cleanup_after_transfer_step(cleanup_stats)`:
  - returns current cleanup step kwargs
  - default step is `"subscription_cleanup_after_transfer"`
  - default message is `"订阅已自动清理"`
  - payload is kept only when `cleanup_payload` is a dict, otherwise `None`
- `build_fixed_source_movie_cleanup_event_kwargs(...)`:
  - returns current `subscription.item.cleanup_after_fixed_source` event kwargs
  - reason is `"movie_fixed_source_transferred"`
- `build_fixed_source_movie_cleanup_step(fixed_saved)`:
  - returns current fixed-source cleanup step kwargs
  - payload is `{"fixed_saved": fixed_saved}`
- module boundary stays free of runtime settings, DB sessions, models, external service clients, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_cleanup_logs.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_cleanup_logs'`.

### Task 2: Implement Helper Module

**Files:**
- Create: `backend/app/services/subscriptions/run_cleanup_logs.py`

- [ ] **Step 1: Add transfer cleanup builders**

Implement:

- `build_cleanup_after_transfer_event_kwargs(subscription_id, subscription_title, trace_id, cleanup_stats)`
- `build_cleanup_after_transfer_step(cleanup_stats)`

Keep current `str(...)` conversions and dict-only payload behavior.

- [ ] **Step 2: Add fixed-source cleanup builders**

Implement:

- `build_fixed_source_movie_cleanup_event_kwargs(subscription_id, subscription_title, trace_id)`
- `build_fixed_source_movie_cleanup_step(fixed_saved)`

Keep current message and reason strings exactly.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper functions**

Import the four builders from `app.services.subscriptions.run_cleanup_logs`.

- [ ] **Step 2: Replace inline cleanup log kwargs**

Replace only:

- `subscription.item.cleanup_after_transfer` event kwargs
- transfer cleanup step kwargs
- `subscription.item.cleanup_after_fixed_source` event kwargs
- fixed-source movie cleanup step kwargs

Do not change `_delete_subscription_with_records()`, `apply_cleanup_stats()`, fixed-source branch conditions, commits, rollbacks, or progress callbacks.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_cleanup_logs.py tests/test_subscription_run_transfer_logs.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm the service change only replaces cleanup log dict construction with helper calls.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_cleanup_logs.py backend/tests/test_subscription_run_cleanup_logs.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅运行清理日志"
```

### Task 5: Full Completion Standard

- [ ] **Step 1: Backend full verification**

```bash
scripts/verify-backend.sh
```

- [ ] **Step 2: Frontend build**

```bash
npm --prefix frontend run build
```

- [ ] **Step 3: Quick repository verification**

```bash
scripts/verify.sh --quick
```

- [ ] **Step 4: Docker rebuild and health**

```bash
docker compose up -d --build mediasync115
for i in $(seq 1 60); do status=$(docker inspect --format '{{.State.Health.Status}}' mediasync115 2>/dev/null || true); echo "health=$status"; if [ "$status" = healthy ]; then exit 0; fi; sleep 2; done; exit 1
curl -fsS http://localhost:5173/healthz
docker compose ps mediasync115
docker inspect --format '{{.State.Health.Status}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected final status: only the two known untracked files remain:

- `backend/scripts/export_hdhive_189_links.py`
- `docs/next-session-prompt.md`
