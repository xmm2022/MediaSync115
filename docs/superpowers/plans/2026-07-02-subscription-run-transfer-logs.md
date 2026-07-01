# Subscription Run Transfer Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract automatic transfer new/retry/summary/skip log kwargs construction from `SubscriptionService.run_channel_check()` into pure helper functions.

**Architecture:** Add `app.services.subscriptions.run_transfer_logs` with dict builders only. Keep branch decisions, auto transfer calls, counter updates, cleanup decisions, and async log writes in `run_channel_check()`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run Transfer Log Tests

**Files:**
- Create: `backend/tests/test_subscription_run_transfer_logs.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `build_auto_transfer_start_step("new", count)`:
  - returns `auto_transfer_new_start`
  - status `info`
  - message `"开始转存 {count} 个新资源"`
- `build_auto_transfer_start_step("retry", count)`:
  - returns `auto_transfer_retry_start`
  - status `info`
  - message `"开始重试之前失败的 {count} 个资源"`
- `build_auto_transfer_start_event_kwargs(...)`:
  - returns current `subscription.item.transfer_new_start` or `subscription.item.transfer_retry_start` event kwargs
- `build_auto_transfer_done_step(source, stats)`:
  - returns current done step kwargs for new/retry
  - status `success` when `stats["failed"] == 0`, otherwise `partial`
- `build_auto_transfer_done_event_kwargs(...)`:
  - returns current done event kwargs for new/retry
  - status `success` when `stats["failed"] == 0`, otherwise `warning`
- `build_auto_transfer_summary_step(...)`:
  - keeps current summary message format with optional retry count
- `build_auto_transfer_skip_step()`:
  - returns current skip step kwargs
- module boundary stays free of runtime settings, DB sessions, models, external service clients, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_transfer_logs.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_transfer_logs'`.

### Task 2: Implement Helper Module

**Files:**
- Create: `backend/app/services/subscriptions/run_transfer_logs.py`

- [ ] **Step 1: Add source metadata helper**

Internally map `transfer_source == "new"` to:

- step suffix `new`
- start step message `"开始转存 {count} 个新资源"`
- start action `subscription.item.transfer_new_start`
- start event message `"[{title}] 开始自动转存新资源 {count} 条"`
- done step message prefix `"新资源转存完成"`
- done event action `subscription.item.transfer_new_done`
- done event message prefix `"[{title}] 新资源转存完成"`

Map `transfer_source == "retry"` to the existing retry strings. Keep unknown sources explicit with `ValueError` to avoid silently inventing log names.

- [ ] **Step 2: Add public builders**

Implement:

- `build_auto_transfer_start_step(transfer_source, record_count)`
- `build_auto_transfer_start_event_kwargs(...)`
- `build_auto_transfer_done_step(transfer_source, stats)`
- `build_auto_transfer_done_event_kwargs(...)`
- `build_auto_transfer_summary_step(sub_saved_count, sub_failed_transfer_count, new_record_count, retry_record_count)`
- `build_auto_transfer_skip_step()`

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper functions**

Import the six builders from `app.services.subscriptions.run_transfer_logs`.

- [ ] **Step 2: Replace inline transfer log kwargs**

Replace only these inline dict/message constructions:

- new start step/event
- new done step/event
- retry start step/event
- retry done step/event
- auto transfer summary step
- auto transfer skip step

Do not change `_auto_save_records_with_link_fallback()` calls, `sub_saved_count`, `sub_failed_transfer_count`, `apply_auto_transfer_stats()`, `cleanup_after_auto`, fixed source scan, commits, rollbacks, or progress callbacks.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_transfer_logs.py tests/test_subscription_run_item_logs.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm the service change only replaces auto transfer log dict construction with helper calls.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_transfer_logs.py backend/tests/test_subscription_run_transfer_logs.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅自动转存日志"
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
