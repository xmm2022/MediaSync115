# Subscription Run Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `run_channel_check()` active subscription loading and `SubscriptionSnapshot` row mapping into `app.services.subscriptions.run_loader`.

**Architecture:** Keep SQLAlchemy/model access in the new loader module. Keep `SubscriptionService.run_channel_check()` responsible for run state, logging, progress callbacks, concurrency, and per-subscription orchestration.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, SQLAlchemy async test fixtures, existing subscription helper layout.

---

### Task 1: Add Run Loader Tests

**Files:**
- Create: `backend/tests/test_subscription_run_loader.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `snapshot_from_active_subscription_row(row)` preserves current conversions:
  - `id` and optional numeric fields cast to `int`
  - optional string fields cast to `str` when present
  - empty title becomes `""`
  - missing `tv_scope` becomes `"all"`
  - missing `tv_follow_mode` becomes `"missing"`
  - booleans use current truthiness behavior
- `load_active_subscription_snapshots(db)` returns active local mediasync115 subscriptions in ID order.
- External provider mirrors such as MoviePilot and AniRSS are excluded.
- Successful transfer state is true for records with `completed_at`, `MediaStatus.COMPLETED`, or `MediaStatus.OFFLINE_COMPLETED`.
- Module boundary stays free of runtime settings, external service clients, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_loader.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.run_loader'`.

### Task 2: Implement Loader Module

**Files:**
- Create: `backend/app/services/subscriptions/run_loader.py`

- [ ] **Step 1: Add row mapper**

Implement `snapshot_from_active_subscription_row(row)` by moving the current list-comprehension body from `run_channel_check()` without changing defaults or casts.

- [ ] **Step 2: Add DB loader**

Implement `load_active_subscription_snapshots(db)`:

- Build the current `has_successful_transfer` EXISTS expression.
- Select the same fields currently selected by `run_channel_check()`.
- Apply the same active/local provider filters.
- Order by `Subscription.id.asc()`.
- Return mapped snapshots.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import helper**

Import `load_active_subscription_snapshots`.

- [ ] **Step 2: Replace inline query**

Replace the inline EXISTS/select/list-comprehension block with:

```python
subscriptions = await load_active_subscription_snapshots(db)
```

Do not move or change `set_checked_count()`, run_start step log, progress callback, semaphore setup, or processing loop.

### Task 4: Verify

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_loader.py tests/test_subscription_run_state.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm the service change only removes the inline loading block and imports the helper.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/run_loader.py backend/tests/test_subscription_run_loader.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅运行加载器"
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
