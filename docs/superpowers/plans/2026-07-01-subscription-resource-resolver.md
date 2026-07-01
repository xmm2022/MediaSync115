# Subscription Resource Resolver Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `_fetch_resources()` source waterfall orchestration from `SubscriptionService`.

**Architecture:** Add `backend/app/services/subscriptions/resource_resolver.py` with a callback-based dependency dataclass and a single orchestration function. Keep `SubscriptionService._fetch_resources()` as a thin wrapper that injects existing private methods and side-effect callbacks.

**Tech Stack:** Python 3.13 test environment, pytest, existing backend verification scripts, Docker Compose deployment.

---

### Task 1: Resource Resolver Tests

**Files:**
- Modify: `backend/tests/test_fetch_resources_waterfall.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `ResourceResolverDependencies` and `resolve_subscription_resources()` from `app.services.subscriptions.resource_resolver`. Use `types.SimpleNamespace` as the subscription snapshot and fake async callbacks for source fetchers, offline fetcher, logging, and HDHive preparation.

Required assertions:

```python
assert meta["source_order"] == ["pansou", "hdhive"]
assert meta["attempts"] == [{"source": "pansou", "status": "success", "count": 1}]
assert source_calls == ["pansou"]
assert event_calls == [("pansou", "success", 1)]
```

Add an excluded-source fallback test that first returns a URL in `exclude_urls`, then verifies HDHive is tried and selected. Add an empty-order test that verifies no source callbacks run. Add a dependency-boundary test that reads `backend/app/services/subscriptions/resource_resolver.py` and rejects direct imports of service/runtime/database/API/Kafka layers.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
scripts/verify-backend.sh -- tests/test_fetch_resources_waterfall.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.subscriptions.resource_resolver'`.

### Task 2: Extract Resource Resolver Module

**Files:**
- Create: `backend/app/services/subscriptions/resource_resolver.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Implement helper module**

Implement `ResourceResolverDependencies` and `resolve_subscription_resources()` with the same trace names, attempt metadata, sorting/filtering order, offline append behavior, summary shape, and callback swallowing behavior used by the current `_fetch_resources()` implementation.

- [ ] **Step 2: Delegate service wrapper**

Update `SubscriptionService._fetch_resources()` to construct `ResourceResolverDependencies` from existing private methods. Add small private callbacks for logging source fetch results and emitting source attempt events so the new module does not import operation logs or Kafka.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_fetch_resources_waterfall.py tests/test_hdhive_unlock_policy.py tests/test_subscription_source_attempts.py
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
git add docs/superpowers/specs/2026-07-01-subscription-resource-resolver-design.md docs/superpowers/plans/2026-07-01-subscription-resource-resolver.md backend/app/services/subscriptions/resource_resolver.py backend/app/services/subscription_service.py backend/tests/test_fetch_resources_waterfall.py
git commit -m "refactor: 抽离订阅资源来源瀑布"
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
