# Subscription Resource Resolver Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `_fetch_resources()` resolver wiring into a dependency-injected adapter helper.

**Architecture:** Add `app.services.subscriptions.resource_resolver_adapter` to construct `ResourceResolverDependencies`, source fetch background logs, and source attempt event payloads. Keep resolver algorithm in `resource_resolver.py`; keep operation log service, Kafka producer access, runtime settings, and service methods injected from `SubscriptionService`.

**Tech Stack:** Python 3.12/3.13 test environment, pytest, existing subscription helper module layout.

---

### Task 1: Add Resolver Adapter Tests

**Files:**
- Create: `backend/tests/test_subscription_resource_resolver_adapter.py`

- [ ] **Step 1: Write the failing tests**

Cover the future helper API:

- `fetch_subscription_resources_with_adapter(...)` calls the injected resolver runner with `channel`, `sub`, `hdhive_unlock_context`, `source_order`, and `exclude_urls`.
- It passes through fetchers, source order resolver, quality/resolution resolvers, HDHive unlock helpers, and URL exclusion helper into `ResourceResolverDependencies`.
- Generated `log_source_fetch(sub, source, count)` emits current `subscription.item.fetch_source` event kwargs:
  - `status="success"` when count is non-zero
  - `status="info"` when count is zero
  - message and extra keep current shape
- Generated `emit_source_attempt(sub, attempt_info)` emits current payload with default `status="empty"` and `resource_count=0`.
- Module boundary stays free of runtime settings, DB sessions, models, external service clients, Kafka, API imports, and `SubscriptionService`.

- [ ] **Step 2: Run red test**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_adapter.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_resolver_adapter'`.

### Task 2: Implement Adapter Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_resolver_adapter.py`

- [ ] **Step 1: Define dependencies dataclass**

Implement `ResourceResolverAdapterDependencies` with the callables listed in the design doc.

- [ ] **Step 2: Implement adapter**

Implement `fetch_subscription_resources_with_adapter(...)`:

- build `log_source_fetch()` with the existing operation log kwargs
- build `emit_source_attempt()` with the existing event payload
- construct `ResourceResolverDependencies`
- call injected `run_resolver(...)`

### Task 3: Wire Into SubscriptionService

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import adapter**

Import:

- `ResourceResolverAdapterDependencies`
- `fetch_subscription_resources_with_adapter`

- [ ] **Step 2: Replace `_fetch_resources()` body**

Keep the method signature unchanged. Inside it:

- define a small `emit_source_attempt_event(subscription_id, data)` wrapper that preserves current Kafka producer behavior
- call `fetch_subscription_resources_with_adapter(...)`
- inject existing fetcher methods, resolver helpers, `filter_resources_excluding_urls`, `operation_log_service.log_background_event`, the Kafka wrapper, and `resolve_subscription_resources`

Remove only local logging/event/dependency construction that moved into the helper. Do not change callers.

### Task 4: Verify and Commit

- [ ] **Step 1: Green targeted tests**

```bash
scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_fetchers.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py
```

- [ ] **Step 2: Inspect diff**

Confirm service changes are limited to adapter import and `_fetch_resources()` body simplification.

- [ ] **Step 3: Commit implementation**

```bash
git status --short
git add backend/app/services/subscriptions/resource_resolver_adapter.py backend/tests/test_subscription_resource_resolver_adapter.py backend/app/services/subscription_service.py
git commit -m "refactor: 抽离订阅资源抓取调度适配层"
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
