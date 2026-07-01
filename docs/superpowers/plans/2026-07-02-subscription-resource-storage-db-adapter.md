# Subscription Resource Storage DB Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `_store_new_resources()` database wiring into a DB adapter helper while keeping core resource storage rules unchanged.

**Architecture:** Add `app.services.subscriptions.resource_storage_db_adapter` for `DownloadRecord` querying and construction. Keep duplicate/invalid/offline logic in `resource_storage.py`; keep runtime settings and status enum injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, SQLAlchemy model layer, existing subscription helper module layout.

---

### Task 1: Add DB Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_storage_db_adapter.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `store_new_resources_with_db_adapter(...)` calls injected core runner with `subscription_id`, `resources`, and `ResourceStorageDependencies`.
- Generated `load_existing_resource_urls(subscription_id)`:
  - uses `db.no_autoflush`
  - executes a query
  - returns stringified non-empty URL values
- Generated `add_record(...)` creates a `DownloadRecord`, sets current fields, and calls `db.add(record)`.
- Offline transfer switch and matched status are passed through from adapter dependencies.
- Module boundary stays free of `subscription_service`, runtime settings, external services, and API imports.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage_db_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_storage_db_adapter'`.

### Task 2: Implement DB Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_storage_db_adapter.py`

- [ ] **Step 1: Define dependencies dataclass**

Implement `ResourceStorageDbAdapterDependencies` with:

- `offline_transfer_enabled`
- `record_status_matched`
- `run_store_new_resources`

- [ ] **Step 2: Implement DB helpers**

Implement:

- `load_existing_resource_urls(db, subscription_id)`
- `add_download_record(db, subscription_id, resource_name, resource_url, resource_type, status)`

- [ ] **Step 3: Implement adapter**

Implement `store_new_resources_with_db_adapter(...)` that builds `ResourceStorageDependencies` and calls the injected core runner.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import DB adapter**

Import:

- `ResourceStorageDbAdapterDependencies`
- `store_new_resources_with_db_adapter`

- [ ] **Step 2: Replace `_store_new_resources()` body**

Keep the method signature unchanged. Replace local closures with a call to the DB adapter, injecting:

- `runtime_settings_service.get_subscription_offline_transfer_enabled`
- `MediaStatus.MATCHED`
- `store_new_resources_flow`

Remove direct `ResourceStorageDependencies` import if unused.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_storage_db_adapter.py tests/test_subscription_resource_storage.py tests/test_fetch_resources_waterfall.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm service changes are limited to DB adapter import and `_store_new_resources()` body simplification.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/resource_storage_db_adapter.py backend/tests/test_subscription_resource_storage_db_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅资源入库 DB 适配层"
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
