# Subscription HDHive Prepare Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the unused `SubscriptionService._prepare_hdhive_locked_resources()` wrapper and migrate the remaining test coverage to the HDHive unlock runtime adapter.

**Architecture:** Production resource resolving already uses `prepare_hdhive_locked_resources_with_runtime_adapter` through `resource_resolver_runtime_adapter` defaults. This change removes the stale service wrapper and updates static/behavior tests to assert the new boundary.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter pattern.

---

### Task 1: Write Red Boundary Tests

**Files:**
- Modify: `backend/tests/test_hdhive_unlock_policy.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Modify: `backend/tests/test_subscription_service_resource_resolver_boundary.py`

- [ ] **Step 1: Migrate HDHive policy test to runtime adapter**

In `backend/tests/test_hdhive_unlock_policy.py`, remove:

```python
from app.services.subscription_service import SubscriptionService
```

In `test_prepare_hdhive_locked_resources_stops_after_first_success()`, remove:

```python
        service = SubscriptionService()
```

Change the call from:

```python
            result = asyncio.run(
                service._prepare_hdhive_locked_resources(resources, context, traces)
            )
```

to:

```python
            result = asyncio.run(
                runtime_adapter_module.prepare_hdhive_locked_resources_with_runtime_adapter(
                    resources,
                    context,
                    traces,
                )
            )
```

- [ ] **Step 2: Update service dead wrapper boundary test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, update `test_subscription_service_drops_run_start_default_wrappers()` to assert the prepare wrapper is gone:

```python
def test_subscription_service_drops_run_start_default_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "_build_hdhive_unlock_context" not in source
    assert "_resolve_source_order" not in source
    assert "_prepare_hdhive_locked_resources" not in source
    assert "build_hdhive_unlock_context_with_runtime_adapter" not in source
    assert "resolve_source_order_with_runtime_adapter" not in source
    assert "prepare_hdhive_locked_resources_with_runtime_adapter" not in source
```

- [ ] **Step 3: Update resource resolver boundary test**

In `backend/tests/test_subscription_service_resource_resolver_boundary.py`, replace:

```python
    assert "_prepare_hdhive_locked_resources" in source
```

with:

```python
    assert "_prepare_hdhive_locked_resources" not in source
```

- [ ] **Step 4: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py::TestHDHiveUnlockPolicy::test_prepare_hdhive_locked_resources_stops_after_first_success tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q
```

Expected: FAIL because `subscription_service.py` still contains `_prepare_hdhive_locked_resources` and imports `prepare_hdhive_locked_resources_with_runtime_adapter`.

### Task 2: Delete Service Wrapper

**Files:**
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Remove runtime adapter import from service**

Delete this import block from `backend/app/services/subscription_service.py`:

```python
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
```

- [ ] **Step 2: Delete the wrapper method**

Delete:

```python
    async def _prepare_hdhive_locked_resources(
        self,
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return await prepare_hdhive_locked_resources_with_runtime_adapter(
            resources,
            context,
            traces,
        )
```

- [ ] **Step 3: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_hdhive_unlock_policy.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Commit: `backend/tests/test_subscription_service_resource_resolver_boundary.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_prepare_hdhive_locked_resources|prepare_hdhive_locked_resources_with_runtime_adapter" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 because the service no longer contains the wrapper or import. `wc -l` decreases from 376.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_service.py backend/tests/test_hdhive_unlock_policy.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py backend/tests/test_subscription_service_resource_resolver_boundary.py
git commit -m "refactor: 删除订阅 HDHive prepare wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
```

Expected:

- Targeted backend tests pass.
- Full backend tests pass.
- Frontend build exits 0; existing Vite chunk-size warning is acceptable.
- Quick verifier exits 0.
- Docker build/up exits 0.
- `/healthz` returns `{"status":"healthy"}`.
- Docker inspect returns `running healthy`.
- `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```
