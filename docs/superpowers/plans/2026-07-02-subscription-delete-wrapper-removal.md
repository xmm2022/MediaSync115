# Subscription Delete Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SubscriptionService._delete_subscription_with_records()` with runtime-adapter defaults and delete the service private wrapper.

**Architecture:** Add one default delete callback helper beside `subscription_delete_service`, then let run-channel and completed-cleanup runtime dependency builders use it when no explicit callback is injected. `SubscriptionService` continues exposing public methods, but no longer imports the delete service or passes delete callbacks into default builders.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_delete_service.py`
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Modify: `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`

- [ ] **Step 1: Import the planned delete helper in delete service tests**

Change:

```python
from app.services.subscription_delete_service import subscription_delete_service
```

to:

```python
from app.services.subscription_delete_service import (
    delete_subscription_with_records_with_default_service,
    subscription_delete_service,
)
```

- [ ] **Step 2: Add helper test**

Append to `backend/tests/test_subscription_delete_service.py`:

```python
@pytest.mark.asyncio
async def test_delete_subscription_with_records_helper_wraps_single_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    calls: list[tuple[object, list[int]]] = []

    async def fake_delete_local_subscriptions(
        current_db: object,
        subscription_ids: list[int],
    ) -> int:
        calls.append((current_db, subscription_ids))
        return 1

    monkeypatch.setattr(
        subscription_delete_service,
        "delete_local_subscriptions",
        fake_delete_local_subscriptions,
    )

    result = await delete_subscription_with_records_with_default_service(db, 42)

    assert result == 1
    assert calls == [(db, [42])]
```

- [ ] **Step 3: Update run-channel service wrapper test**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, remove:

```python
    _assert_bound_method(
        builder_kwargs["delete_subscription_with_records"],
        service,
        "_delete_subscription_with_records",
    )
```

and add:

```python
    assert "delete_subscription_with_records" not in builder_kwargs
```

- [ ] **Step 4: Add run-channel default delete tests**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, import:

```python
from app.services.subscription_delete_service import (
    delete_subscription_with_records_with_default_service,
)
```

Add these tests near the other default dependency tests:

```python
def test_default_runtime_dependencies_bind_delete_default_without_service_callback() -> None:
    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records_with_default_service
    )
```

```python
def test_default_runtime_dependencies_pass_default_delete_to_pre_scan_cleanup_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def default_evaluate_pre_scan_cleanup(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    factory_calls: list[tuple[Any, Any]] = []

    def fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
        callback_delete_subscription_with_records: Any,
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(
            (
                callback_delete_subscription_with_records,
                callback_create_step_log,
            )
        )
        return default_evaluate_pre_scan_cleanup

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
    )

    assert dependencies.evaluate_pre_scan_cleanup is default_evaluate_pre_scan_cleanup
    assert factory_calls == [
        (
            delete_subscription_with_records_with_default_service,
            execution_logs_module.create_step_log,
        )
    ]
```

```python
def test_default_runtime_dependencies_preserve_falsy_delete_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    delete_subscription_with_records = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )
```

- [ ] **Step 5: Update completed-cleanup default dependency tests**

In `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`, import:

```python
from app.services.subscription_delete_service import (
    delete_subscription_with_records_with_default_service,
)
```

In `test_default_runtime_dependencies_bind_existing_services_sleep_and_runners()`, remove the local `delete_subscription_with_records` function and call:

```python
    dependencies = build_default_completed_cleanup_runtime_dependencies()
```

Then assert:

```python
    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records_with_default_service
    )
```

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_delete_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    delete_subscription_with_records = FalsyAsyncCallable()

    dependencies = build_default_completed_cleanup_runtime_dependencies(
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )
```

- [ ] **Step 6: Add service dead-wrapper test**

Append to `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`:

```python
def test_subscription_service_drops_delete_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_delete_subscription_with_records",
        "subscription_delete_service",
    ):
        assert name not in source
```

- [ ] **Step 7: Update run-channel boundary test anchor**

In `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`, replace:

```python
        "    async def _delete_subscription_with_records",
```

with:

```python
        "    async def cleanup_completed_subscriptions",
```

- [ ] **Step 8: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_delete_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_pass_default_delete_to_pre_scan_cleanup_factory tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_delete_injection tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_services_sleep_and_runners tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_delete_injection tests/test_subscription_delete_service.py::test_delete_subscription_with_records_helper_wraps_single_id tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_run_channel_resource_io_boundary.py::test_run_channel_drops_resource_io_callback_assembly -q
```

Expected: fail because helper is missing, builders still require explicit delete callbacks, and service still passes/defines the wrapper.

### Task 2: Implement Default Delete Callback

**Files:**
- Modify: `backend/app/services/subscription_delete_service.py`
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Add delete helper**

In `backend/app/services/subscription_delete_service.py`, add before `subscription_delete_service = SubscriptionDeleteService()`:

```python
async def delete_subscription_with_records_with_default_service(
    db: AsyncSession,
    subscription_id: int,
) -> int:
    return await subscription_delete_service.delete_local_subscriptions(
        db,
        [subscription_id],
    )
```

- [ ] **Step 2: Default run-channel delete callback**

In `run_channel_runtime_adapter.py`, import:

```python
from app.services.subscription_delete_service import (
    delete_subscription_with_records_with_default_service,
)
```

Change the builder parameter to:

```python
    delete_subscription_with_records: DeleteSubscriptionWithRecords | None = None,
```

Resolve it near the other resolved callbacks:

```python
    resolved_delete_subscription_with_records = (
        delete_subscription_with_records
        if delete_subscription_with_records is not None
        else delete_subscription_with_records_with_default_service
    )
```

Use `resolved_delete_subscription_with_records` for:

```python
        delete_subscription_with_records=resolved_delete_subscription_with_records,
```

and pass it into:

```python
            else build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
                resolved_delete_subscription_with_records,
                resolved_create_step_log,
            )
```

- [ ] **Step 3: Default completed-cleanup delete callback**

In `completed_cleanup_runtime_adapter.py`, import:

```python
from app.services.subscription_delete_service import (
    delete_subscription_with_records_with_default_service,
)
```

Change the builder parameter to:

```python
    delete_subscription_with_records: DeleteSubscriptionWithRecords | None = None,
```

Use this in the dataclass construction:

```python
        delete_subscription_with_records=(
            delete_subscription_with_records
            if delete_subscription_with_records is not None
            else delete_subscription_with_records_with_default_service
        ),
```

- [ ] **Step 4: Remove service delete wrapper**

In `subscription_service.py`, remove:

```python
from app.services.subscription_delete_service import subscription_delete_service
```

Remove `delete_subscription_with_records=...` kwargs from:

- `build_default_run_channel_runtime_dependencies(...)`
- `build_default_completed_cleanup_runtime_dependencies(...)` in `cleanup_completed_subscriptions()`
- `build_default_completed_cleanup_runtime_dependencies(...)` in `cleanup_single_subscription()`

Delete:

```python
    async def _delete_subscription_with_records(
        self, db: AsyncSession, subscription_id: int
    ) -> None:
        await subscription_delete_service.delete_local_subscriptions(
            db,
            [subscription_id],
        )
```

- [ ] **Step 5: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_subscription_delete_service.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_completed_cleanup.py -q
```

Expected: all selected tests pass.

- [ ] **Step 6: Check service line count and diff hygiene**

Run:

```bash
wc -l backend/app/services/subscription_service.py
git diff --check
```

Expected: line count decreases and `git diff --check` exits 0.

- [ ] **Step 7: Commit implementation**

Run:

```bash
git add backend/app/services/subscription_delete_service.py backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_delete_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_completed_cleanup_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py backend/tests/test_subscription_service_run_channel_resource_io_boundary.py
git commit -m "refactor: 删除订阅删除 wrapper"
```

### Task 3: Full Verification

**Files:**
- No code edits.

- [ ] **Step 1: Run targeted tests after commit**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_subscription_delete_service.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_completed_cleanup.py -q
```

Expected: all selected tests pass.

- [ ] **Step 2: Run backend full verification**

Run:

```bash
scripts/verify-backend.sh
```

Expected: all backend tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: exit 0. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run quick verification**

Run:

```bash
scripts/verify.sh --quick
```

Expected: exit 0.

- [ ] **Step 5: Build and start Docker service**

Run:

```bash
docker compose up -d --build mediasync115
```

Expected: image builds and service starts.

- [ ] **Step 6: Verify health**

Run:

```bash
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
```

Expected:

```text
{"status":"healthy"}
running healthy
```

- [ ] **Step 7: Final workspace check**

Run:

```bash
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected `git status --short` only shows:

```text
?? backend/scripts/export_hdhive_189_links.py
?? docs/next-session-prompt.md
```

## Self-Review

- Spec coverage: tests cover helper behavior, both default builders, service cleanup, and final verification.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation language is present.
- Type consistency: callback signatures stay `db, subscription_id`; bulk deletion service remains `db, subscription_ids`.
