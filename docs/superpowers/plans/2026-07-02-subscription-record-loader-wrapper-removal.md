# Subscription Record Loader Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move run channel retry-record loader defaults into `run_channel_runtime_adapter` and delete the three service-level record loader wrappers.

**Architecture:** `build_default_run_channel_runtime_dependencies()` will keep explicit injection support, but `load_retryable_records` and `load_force_retry_records` become optional and default to the existing DB adapter helpers. `SubscriptionService` stops importing record loader DB adapters and no longer exposes `_load_retryable_records()`, `_load_force_retry_records()`, or `_load_subscription_resource_urls()`.

**Tech Stack:** Python 3.13, pytest, SQLAlchemy async DB adapter helpers, existing subscriptions runtime adapter style.

---

### Task 1: Write Red Boundary And Default Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Update service wrapper expectations**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, remove these two entries from the bound-method map:

```python
        "load_retryable_records": "_load_retryable_records",
        "load_force_retry_records": "_load_force_retry_records",
```

Then add these absence assertions near the existing default-dependency absence assertions:

```python
    assert "load_retryable_records" not in builder_kwargs
    assert "load_force_retry_records" not in builder_kwargs
```

- [ ] **Step 2: Add default loader dependency test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add this test after `test_default_runtime_dependencies_bind_run_start_defaults_without_service_callbacks()`:

```python
def test_default_runtime_dependencies_bind_record_loader_defaults_without_service_callbacks() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

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
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.load_retryable_records is (
        run_channel_runtime_module.load_retryable_records_with_db_adapter
    )
    assert dependencies.load_force_retry_records is (
        run_channel_runtime_module.load_force_retry_records_with_db_adapter
    )
```

- [ ] **Step 3: Add falsy loader injection test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add this test after the default loader test:

```python
def test_default_runtime_dependencies_preserve_falsy_record_loader_injections() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> Any:
            return []

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

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

    load_retryable_records = FalsyAsyncCallable()
    load_force_retry_records = FalsyAsyncCallable()

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

    assert dependencies.load_retryable_records is load_retryable_records
    assert dependencies.load_force_retry_records is load_force_retry_records
```

- [ ] **Step 4: Update service static boundary**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add a new test:

```python
def test_subscription_service_drops_record_loader_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_load_retryable_records",
        "_load_force_retry_records",
        "_load_subscription_resource_urls",
        "load_retryable_records_with_db_adapter",
        "load_force_retry_records_with_db_adapter",
        "load_subscription_resource_urls_with_db_adapter",
    ):
        assert name not in source
```

- [ ] **Step 5: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_record_loader_defaults_without_service_callbacks tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_record_loader_injections tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because the service still passes loader callbacks, builder still requires loader args for the new default test, and the service still contains the wrappers/imports.

### Task 2: Move Loader Defaults Into Run Channel Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import DB loader defaults**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
)
```

- [ ] **Step 2: Make loader callbacks optional**

Change builder parameters from:

```python
    load_retryable_records: LoadRetryableRecords,
    load_force_retry_records: LoadForceRetryRecords,
```

to:

```python
    load_retryable_records: LoadRetryableRecords | None = None,
    load_force_retry_records: LoadForceRetryRecords | None = None,
```

Change dataclass construction to:

```python
        load_retryable_records=(
            load_retryable_records
            if load_retryable_records is not None
            else load_retryable_records_with_db_adapter
        ),
        load_force_retry_records=(
            load_force_retry_records
            if load_force_retry_records is not None
            else load_force_retry_records_with_db_adapter
        ),
```

- [ ] **Step 3: Remove service loader kwargs and wrappers**

In `backend/app/services/subscription_service.py`, remove the import block:

```python
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
    load_subscription_resource_urls_with_db_adapter,
)
```

In `run_channel_check()`, remove:

```python
                load_retryable_records=self._load_retryable_records,
                load_force_retry_records=self._load_force_retry_records,
```

Delete methods:

```python
    async def _load_retryable_records(...)
    async def _load_force_retry_records(...)
    async def _load_subscription_resource_urls(...)
```

- [ ] **Step 4: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_auto_transfer_record_loaders_db_adapter.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
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
rg -n "_load_retryable_records|_load_force_retry_records|_load_subscription_resource_urls|load_retryable_records_with_db_adapter|load_force_retry_records_with_db_adapter|load_subscription_resource_urls_with_db_adapter" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 because the service no longer contains wrappers/imports. `wc -l` decreases from 361.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅记录 loader wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_auto_transfer_record_loaders_db_adapter.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
```

Expected final status is the two allowed untracked files only.
