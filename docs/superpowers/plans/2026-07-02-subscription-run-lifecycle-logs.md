# Subscription Run Lifecycle Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract subscription item lifecycle log kwargs construction from `SubscriptionService.run_channel_check()` into pure helper functions.

**Architecture:** Add `app.services.subscriptions.run_lifecycle_logs` with dict builders only. Keep session ownership, rollback/commit, result counter updates, progress callbacks, and async log writes in `run_channel_check()`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run Lifecycle Log Tests

**Files:**
- Create: `backend/tests/test_subscription_run_lifecycle_logs.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `build_subscription_start_step(title)` returns current `subscription_start` step kwargs.
- `build_subscription_auto_cleaned_step()` returns current auto-cleaned `subscription_done` step kwargs.
- `build_subscription_auto_cleaned_event_kwargs(...)` returns current pre-scan cleaned `subscription.item.done` event kwargs.
- `build_subscription_done_step()` returns current normal `subscription_done` step kwargs.
- `build_subscription_done_event_kwargs(...)` returns current normal done event kwargs:
  - auto-download enabled message includes new resource count, saved count, and failed count
  - auto-download disabled message includes `"（未启用自动转存）"`
  - `auto_saved` and `auto_failed` are `None` when auto-download is disabled
  - status is `warning` when `sub_failed_transfer_count > 0`, otherwise `success`
- `build_subscription_failed_step(error)` truncates `str(error)[:200]`.
- `build_subscription_failed_event_kwargs(...)` truncates message at 200 and extra error at 500.
- module boundary stays free of runtime settings, DB sessions, models, external service clients, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_lifecycle_logs.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_lifecycle_logs'`.

### Task 2: Implement Helper Module

**Files:**
- Create: `backend/app/services/subscriptions/run_lifecycle_logs.py`

- [ ] **Step 1: Add start and cleaned builders**

Implement:

- `build_subscription_start_step(subscription_title)`
- `build_subscription_auto_cleaned_step()`
- `build_subscription_auto_cleaned_event_kwargs(subscription_id, subscription_title, channel, trace_id)`

- [ ] **Step 2: Add done and failed builders**

Implement:

- `build_subscription_done_step()`
- `build_subscription_done_event_kwargs(subscription_id, subscription_title, channel, trace_id, new_record_count, should_auto_download, sub_saved_count, sub_failed_transfer_count)`
- `build_subscription_failed_step(error)`
- `build_subscription_failed_event_kwargs(subscription_id, subscription_title, channel, trace_id, error)`

Keep all strings and truncation lengths exactly.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper functions**

Import the seven builders from `app.services.subscriptions.run_lifecycle_logs`.

- [ ] **Step 2: Replace inline lifecycle log kwargs**

Replace only:

- `subscription_start` step kwargs
- pre-scan cleaned `subscription_done` step kwargs
- pre-scan cleaned `subscription.item.done` event kwargs
- normal `subscription_done` step kwargs
- normal `subscription.item.done` event kwargs
- `subscription_failed` step kwargs
- `subscription.item.failed` event kwargs

Remove only now-unused local message helper variables from this block. Do not change branch conditions, exception handling, rollback/commit, result counters, or progress callbacks.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_cleanup_logs.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm the service change only replaces lifecycle log dict construction with helper calls.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_lifecycle_logs.py backend/tests/test_subscription_run_lifecycle_logs.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅单项生命周期日志"
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
