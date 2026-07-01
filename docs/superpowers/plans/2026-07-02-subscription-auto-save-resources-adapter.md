# Subscription Auto Save Resources Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `_auto_save_resources()` runtime-to-batch wiring into a dependency-injected adapter helper.

**Architecture:** Add `app.services.subscriptions.auto_save_resources_adapter` to construct `AutoTransferBatchDependencies` and call an injected batch runner. Keep the actual transfer loop in `auto_transfer_batch.py`; keep runtime settings, service singletons, Kafka producer access, and ORM model statuses injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_auto_save_resources_adapter.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `auto_save_resources_with_adapter(...)` creates a pan service from the injected cookie.
- It resolves parent folder id from `get_pan115_default_folder()`.
- It resolves quality filter from the injected resolver and passes it to the batch runner.
- It passes statuses through unchanged.
- Generated batch dependencies:
  - `create_step_log()` adds run/channel/subscription context.
  - `fetch_tv_missing_status()` always uses `sub.tmdb_id`.
  - `get_offline_folder_id()` reads the injected offline folder.
  - `submit_offline_task()` delegates to the pan service.
  - `emit_transfer_success()` delegates to the injected event emitter with subscription id.
  - `select_precise_missing_episode_files()` delegates with pan service `pick_best_video_file`.
  - pan115 methods, postprocess, notify, operation log, clock, and video predicate are wired through.
- Module boundary stays free of runtime settings, DB sessions, models, external service clients, Kafka, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.auto_save_resources_adapter'`.

### Task 2: Implement Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/auto_save_resources_adapter.py`

- [ ] **Step 1: Define dependencies dataclass**

Implement `AutoSaveResourcesAdapterDependencies` with the callables listed in the design doc.

- [ ] **Step 2: Implement adapter**

Implement `auto_save_resources_with_adapter(...)`:

- create pan service from cookie
- derive `parent_folder_id`
- derive `quality_filter`
- build closure functions matching current `_auto_save_resources()` behavior
- construct `AutoTransferBatchDependencies`
- call injected `run_batch` with `sub`, `records`, `source`, `parent_folder_id`, `quality_filter`, `statuses`, `dependencies`, `tv_missing_snapshot`, and `trace_id=run_id`

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import adapter**

Import:

- `AutoSaveResourcesAdapterDependencies`
- `auto_save_resources_with_adapter`

- [ ] **Step 2: Replace `_auto_save_resources()` body**

Keep the public private-method signature unchanged. Inside it:

- build `AutoTransferBatchStatuses` from `MediaStatus`
- define a small `emit_transfer_success(subscription_id, data)` wrapper that preserves current Kafka producer behavior
- call `auto_save_resources_with_adapter(...)` with injected runtime settings, pan service factory, TV missing service, step log method, selection helper, postprocess, notification, archive trigger, operation log, clock, video predicate, and `auto_save_resources_batch`

Remove local adapter closures that moved into the helper. Do not change callers.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm service changes are limited to adapter import and `_auto_save_resources()` body simplification.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/auto_save_resources_adapter.py backend/tests/test_subscription_auto_save_resources_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅自动转存批处理适配层"
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
