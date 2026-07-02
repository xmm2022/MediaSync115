# Subscription Run Start Runtime Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move run-start source-order and HDHive unlock context default dependency assembly from `SubscriptionService` into `run_channel_runtime_adapter`, then delete the two service wrappers.

**Architecture:** `build_default_run_channel_runtime_dependencies()` will keep explicit dependency injection support, but `build_hdhive_unlock_context` and `resolve_source_order` become optional and default to the existing runtime adapter helpers. `SubscriptionService.run_channel_check()` will stop passing those callbacks and the service will no longer expose `_resolve_source_order()` or `_build_hdhive_unlock_context()`.

**Tech Stack:** Python 3.13, pytest, SQLAlchemy async session patterns, existing `backend/app/services/subscriptions/` runtime adapter helper style.

---

### Task 1: Write Red Boundary And Adapter Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Modify: `backend/tests/test_subscription_service_resource_resolver_boundary.py`

- [ ] **Step 1: Update service wrapper test expectations**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, change `test_subscription_service_wrapper_passes_callbacks_and_concurrency()` so the bound-method map no longer includes `build_hdhive_unlock_context` or `resolve_source_order`, and add explicit absence assertions:

```python
    for key, name in {
        "create_execution_log": "_create_execution_log",
        "create_step_log": "_create_step_log",
        "prune_step_logs": "_prune_step_logs",
        "evaluate_pre_scan_cleanup": "_evaluate_pre_scan_cleanup",
        "load_retryable_records": "_load_retryable_records",
        "load_force_retry_records": "_load_force_retry_records",
        "auto_save_records_with_link_fallback": (
            "_auto_save_records_with_link_fallback"
        ),
        "should_scan_fixed_sources": "_should_scan_fixed_sources",
        "scan_fixed_sources_for_subscription": (
            "_scan_fixed_sources_for_subscription"
        ),
        "delete_subscription_with_records": "_delete_subscription_with_records",
    }.items():
        _assert_bound_method(builder_kwargs[key], service, name)
    assert "build_hdhive_unlock_context" not in builder_kwargs
    assert "resolve_source_order" not in builder_kwargs
    assert "fetch_resources" not in builder_kwargs
    assert "store_new_resources" not in builder_kwargs
```

- [ ] **Step 2: Add default run-start dependency test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, after `test_default_runtime_dependencies_bind_resource_io_defaults_without_service_callbacks()`, add:

```python
def test_default_runtime_dependencies_bind_run_start_defaults_without_service_callbacks() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.build_hdhive_unlock_context is (
        run_channel_runtime_module.build_hdhive_unlock_context_with_runtime_adapter
    )
    assert dependencies.resolve_source_order is (
        run_channel_runtime_module.resolve_source_order_with_runtime_adapter
    )
```

- [ ] **Step 3: Update service static boundary tests**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, replace `test_subscription_service_keeps_used_hdhive_runtime_wrappers()` with:

```python
def test_subscription_service_drops_run_start_default_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "_build_hdhive_unlock_context" not in source
    assert "_resolve_source_order" not in source
    assert "build_hdhive_unlock_context_with_runtime_adapter" not in source
    assert "resolve_source_order_with_runtime_adapter" not in source
    assert "_prepare_hdhive_locked_resources" in source
    assert "prepare_hdhive_locked_resources_with_runtime_adapter" in source
```

In `backend/tests/test_subscription_service_resource_resolver_boundary.py`, replace the last two assertions in `test_subscription_service_drops_fetch_resources_wrapper_and_keeps_hdhive_wrappers()` with:

```python
    assert "_build_hdhive_unlock_context" not in source
    assert "_resolve_source_order" not in source
    assert "_prepare_hdhive_locked_resources" in source
```

- [ ] **Step 4: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_run_start_defaults_without_service_callbacks tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q
```

Expected: FAIL because `SubscriptionService` still passes `build_hdhive_unlock_context` and `resolve_source_order`, the new default-builder call is missing required keyword-only args, and static boundary tests still find the wrappers.

### Task 2: Move Defaults Into Run Channel Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import runtime adapter defaults**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
)
```

- [ ] **Step 2: Make run-start callbacks optional**

Change the builder signature in `backend/app/services/subscriptions/run_channel_runtime_adapter.py` from required callbacks:

```python
    build_hdhive_unlock_context: BuildHdhiveUnlockContext,
    resolve_source_order: ResolveSourceOrder,
```

to optional callbacks:

```python
    build_hdhive_unlock_context: BuildHdhiveUnlockContext | None = None,
    resolve_source_order: ResolveSourceOrder | None = None,
```

Then change the dataclass construction to:

```python
        build_hdhive_unlock_context=(
            build_hdhive_unlock_context
            if build_hdhive_unlock_context is not None
            else build_hdhive_unlock_context_with_runtime_adapter
        ),
        resolve_source_order=(
            resolve_source_order
            if resolve_source_order is not None
            else resolve_source_order_with_runtime_adapter
        ),
```

- [ ] **Step 3: Stop passing service run-start wrappers**

In `backend/app/services/subscription_service.py`, remove these imports:

```python
    resolve_source_order_with_runtime_adapter,
```

and:

```python
    build_hdhive_unlock_context_with_runtime_adapter,
```

In `run_channel_check()`, remove these builder kwargs:

```python
                build_hdhive_unlock_context=self._build_hdhive_unlock_context,
                resolve_source_order=self._resolve_source_order,
```

Delete these methods:

```python
    def _resolve_source_order(self, channel: str) -> list[str]:
        return resolve_source_order_with_runtime_adapter(channel)

    def _build_hdhive_unlock_context(self) -> dict[str, Any]:
        return build_hdhive_unlock_context_with_runtime_adapter()
```

- [ ] **Step 4: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_runtime_preferences_adapter.py tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_hdhive_unlock_policy.py -q
```

Expected: PASS with the existing Starlette deprecation warning only.

### Task 3: Commit Implementation And Verify

**Files:**
- Commit: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Commit: `backend/tests/test_subscription_service_resource_resolver_boundary.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_resolve_source_order|_build_hdhive_unlock_context|resolve_source_order_with_runtime_adapter|build_hdhive_unlock_context_with_runtime_adapter" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 because those names no longer exist in `subscription_service.py`. `wc -l` decreases from 386.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py backend/tests/test_subscription_service_resource_resolver_boundary.py
git commit -m "refactor: 下沉订阅 run start 默认依赖装配"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_runtime_preferences_adapter.py tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_hdhive_unlock_policy.py -q
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
