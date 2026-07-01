# Subscription Resource Fetcher Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract source fetcher runtime wiring from `SubscriptionService` into a dependency-injected adapter helper.

**Architecture:** Add `app.services.subscriptions.resource_fetcher_adapter` to build `ResourceFetcherDependencies` and call the four existing resource fetcher flows. Keep source-specific fetch rules in `resource_fetchers.py`; keep runtime settings, service singletons, and operation logging injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Fetcher Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_fetcher_adapter.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `build_resource_fetcher_dependencies(...)` delegates Pansou TMDB search unchanged.
- Pansou keyword search calls injected keyword search with `res="results"`.
- HDHive, TG, SeedHub, 不太灵, normalize, free preference, free sort, offline switch, and offline logging are wired through.
- `fetch_from_pansou_with_adapter(...)`, `fetch_from_hdhive_with_adapter(...)`, `fetch_from_tg_with_adapter(...)`, and `fetch_offline_magnets_with_adapter(...)` call the injected runner with `sub` and constructed `ResourceFetcherDependencies`.
- Module boundary stays free of runtime settings, DB sessions, models, external service singletons, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetcher_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_fetcher_adapter'`.

### Task 2: Implement Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_fetcher_adapter.py`

- [ ] **Step 1: Define dependencies dataclass**

Implement `ResourceFetcherAdapterDependencies` with the injected callables and four runner functions listed in the design doc.

- [ ] **Step 2: Build core dependencies**

Implement `build_resource_fetcher_dependencies(...)`:

- wrap Pansou keyword search to pass `res="results"`
- wrap offline logging to call injected background event logger
- pass through all other fetcher dependencies

- [ ] **Step 3: Add wrapper functions**

Implement:

- `fetch_from_pansou_with_adapter(sub, dependencies)`
- `fetch_from_hdhive_with_adapter(sub, dependencies)`
- `fetch_from_tg_with_adapter(sub, dependencies)`
- `fetch_offline_magnets_with_adapter(sub, dependencies)`

Each wrapper builds `ResourceFetcherDependencies` and calls the matching runner.

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import adapter**

Import the new dependencies dataclass and four wrapper functions.

- [ ] **Step 2: Replace fetcher dependency method**

Replace `_resource_fetcher_dependencies()` with `_resource_fetcher_adapter_dependencies()` that injects:

- `_search_pansou_pan115_resources`
- `pansou_service.search_115`
- `_normalize_pansou_pan115_list`
- HDHive service methods
- runtime hdhive free/offline settings
- TG service search
- SeedHub and 不太灵 searches
- `operation_log_service.log_background_event`
- four core fetcher flows

- [ ] **Step 3: Replace four fetch wrapper bodies**

Update `_fetch_from_pansou()`, `_fetch_from_hdhive()`, `_fetch_from_tg()`, and `_fetch_offline_magnets()` to call the adapter wrapper functions. Keep signatures unchanged.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_fetcher_adapter.py tests/test_subscription_resource_fetchers.py tests/test_fetch_resources_waterfall.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm service changes are limited to fetcher adapter import, dependency injection method, and four wrapper bodies.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/resource_fetcher_adapter.py backend/tests/test_subscription_resource_fetcher_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅资源来源抓取适配层"
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
