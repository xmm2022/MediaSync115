# Subscription Run Item Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract fetch/store item log kwargs construction from `SubscriptionService.run_channel_check()` into pure helper functions.

**Architecture:** Add `app.services.subscriptions.run_item_logs` with dict builders only. Keep async log writes, DB session ownership, operation log service calls, and ordering inside `run_channel_check()`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Run Item Log Tests

**Files:**
- Create: `backend/tests/test_subscription_run_item_logs.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `build_fetch_trace_step_log(trace)`:
  - keeps `step`, `status`, `message`
  - defaults to `"fetch_trace"`, `"info"`, and `""`
  - keeps dict payloads and converts non-dict payloads to `None`
- `build_fetch_resources_summary_step(resources, source_attempt_info)`:
  - returns success status and `"搜索完成，找到 N 个可用资源"` when resources exist
  - returns warning status and `"本轮未找到新资源"` when empty
  - keeps `resource_count`, `source_order`, `attempts`, and `summary` payload fields
- `build_fetch_done_event_kwargs(...)`:
  - returns current `subscription.item.fetch_done` kwargs
  - keeps success/warning status by resource count
  - extracts `sources_hit` from `fetch_source_selected` trace payloads
- `build_store_new_resources_step(store_stats, created_records)`:
  - returns current `store_new_resources` step kwargs
  - keeps checked/new/duplicate/invalid payload shape
- `build_store_done_event_kwargs(...)`:
  - returns current `subscription.item.store_done` kwargs
  - keeps success/info status, message, trace ID, and extra shape
- module boundary stays free of runtime settings, DB sessions, models, external service clients, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_item_logs.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_item_logs'`.

### Task 2: Implement Helper Module

**Files:**
- Create: `backend/app/services/subscriptions/run_item_logs.py`

- [ ] **Step 1: Add fetch log builders**

Implement:

- `build_fetch_trace_step_log(trace)`
- `build_fetch_resources_summary_step(resources, source_attempt_info)`
- `build_fetch_done_event_kwargs(subscription_id, subscription_title, channel, trace_id, resources, fetch_trace, source_attempt_info)`

Keep current string formatting and payload keys exactly.

- [ ] **Step 2: Add store log builders**

Implement:

- `build_store_new_resources_step(store_stats, created_records)`
- `build_store_done_event_kwargs(subscription_id, subscription_title, trace_id, created_records, store_stats)`

Keep current string formatting and payload keys exactly.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper functions**

Import the five builders from `app.services.subscriptions.run_item_logs`.

- [ ] **Step 2: Replace inline fetch/store log kwargs**

Replace only these inline dict/message constructions:

- fetch trace step log kwargs
- fetch summary step log kwargs
- fetch done background event kwargs
- store step log kwargs
- store done background event kwargs

Do not change `_fetch_resources()`, `_store_new_resources()`, counter updates, auto transfer branches, cleanup branches, commits, rollbacks, or progress callbacks.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_item_logs.py tests/test_subscription_run_loader.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm the service change only replaces fetch/store log dict construction with helper calls.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_item_logs.py backend/tests/test_subscription_run_item_logs.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅单项资源日志"
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
