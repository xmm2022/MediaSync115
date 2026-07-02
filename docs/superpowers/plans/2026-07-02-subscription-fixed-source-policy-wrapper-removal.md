# Subscription Fixed Source Policy Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the fixed-source scan policy default into `run_channel_runtime_adapter` and delete `SubscriptionService._should_scan_fixed_sources()`.

**Architecture:** `build_default_run_channel_runtime_dependencies()` keeps explicit policy injection, but `should_scan_fixed_sources` becomes optional and defaults to the existing pure policy function in `fixed_source_scan.py`. `SubscriptionService.run_channel_check()` stops passing the service wrapper.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Update service wrapper expectations**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, remove:

```python
        "should_scan_fixed_sources": "_should_scan_fixed_sources",
```

Then add:

```python
    assert "should_scan_fixed_sources" not in builder_kwargs
```

- [ ] **Step 2: Add default policy dependency test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add this test near the other default dependency tests:

```python
def test_default_runtime_dependencies_bind_fixed_source_policy_default_without_service_callback() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

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
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.should_scan_fixed_sources is (
        run_channel_runtime_module.should_scan_fixed_sources_policy
    )
```

- [ ] **Step 3: Add falsy policy injection test**

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_fixed_source_policy_injection() -> None:
    class FalsyCallable:
        def __bool__(self) -> bool:
            return False

        def __call__(self, *_args: Any, **_kwargs: Any) -> bool:
            return True

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

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

    should_scan_fixed_sources = FalsyCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.should_scan_fixed_sources is should_scan_fixed_sources
```

- [ ] **Step 4: Add service dead-wrapper boundary test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add:

```python
def test_subscription_service_drops_fixed_source_policy_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_should_scan_fixed_sources",
        "should_scan_fixed_sources_policy",
    ):
        assert name not in source
```

- [ ] **Step 5: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_fixed_source_policy_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_fixed_source_policy_injection tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because the service still passes `should_scan_fixed_sources`, the builder still requires the policy parameter, and the service still contains the wrapper/import.

### Task 2: Move Policy Default Into Run Channel Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import fixed source policy default**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.fixed_source_scan import (
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
```

- [ ] **Step 2: Make policy callback optional**

Change:

```python
    should_scan_fixed_sources: ShouldScanFixedSources,
```

to:

```python
    should_scan_fixed_sources: ShouldScanFixedSources | None = None,
```

Then change dataclass construction to:

```python
        should_scan_fixed_sources=(
            should_scan_fixed_sources
            if should_scan_fixed_sources is not None
            else should_scan_fixed_sources_policy
        ),
```

- [ ] **Step 3: Remove service wrapper and kwarg**

In `backend/app/services/subscription_service.py`, remove this import block:

```python
from app.services.subscriptions.fixed_source_scan import (
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
```

Remove this builder kwarg:

```python
                should_scan_fixed_sources=self._should_scan_fixed_sources,
```

Delete `_should_scan_fixed_sources()`.

- [ ] **Step 4: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_should_scan_fixed_sources|should_scan_fixed_sources_policy" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1. `wc -l` decreases from 258.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅固定来源 policy wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected final status is the two allowed untracked files only.
