# Subscription Pre-scan Cleanup Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pre-scan cleanup default callback wiring into `run_channel_runtime_adapter` and delete `SubscriptionService._evaluate_pre_scan_cleanup()`.

**Architecture:** `build_default_run_channel_runtime_dependencies()` keeps explicit `evaluate_pre_scan_cleanup` injection, but the parameter becomes optional. When omitted, the builder uses a factory to bind `delete_subscription_with_records` and `create_step_log` into a callback that calls `evaluate_pre_scan_cleanup_with_runtime_adapter()` with `build_default_pre_scan_cleanup_runtime_dependencies()`.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Update service wrapper expectations**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, remove this mapping entry:

```python
        "evaluate_pre_scan_cleanup": "_evaluate_pre_scan_cleanup",
```

Then add this assertion with the existing builder omission assertions:

```python
    assert "evaluate_pre_scan_cleanup" not in builder_kwargs
```

- [ ] **Step 2: Add default pre-scan cleanup dependency test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add:

```python
def test_default_runtime_dependencies_bind_pre_scan_cleanup_default_without_service_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def default_evaluate_pre_scan_cleanup(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"deleted": False}

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
        raising=False,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.evaluate_pre_scan_cleanup is default_evaluate_pre_scan_cleanup
    assert factory_calls == [
        (delete_subscription_with_records, create_step_log)
    ]
```

- [ ] **Step 3: Add falsy pre-scan cleanup injection test**

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_pre_scan_cleanup_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {"deleted": False}

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    evaluate_pre_scan_cleanup = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.evaluate_pre_scan_cleanup is evaluate_pre_scan_cleanup
```

- [ ] **Step 4: Add default callback forwarding test**

Add:

```python
@pytest.mark.asyncio
async def test_default_pre_scan_cleanup_callback_builds_pre_scan_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    sub = object()
    runtime_dependencies = object()
    adapter_calls: list[dict[str, Any]] = []
    builder_calls: list[dict[str, Any]] = []

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    def fake_build_default_pre_scan_cleanup_runtime_dependencies(
        *,
        delete_subscription_with_records: Any,
        create_step_log: Any,
    ) -> object:
        builder_calls.append(
            {
                "delete_subscription_with_records": delete_subscription_with_records,
                "create_step_log": create_step_log,
            }
        )
        return runtime_dependencies

    async def fake_evaluate_pre_scan_cleanup_with_runtime_adapter(
        current_db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
        dependencies: Any,
    ) -> dict[str, Any]:
        adapter_calls.append(
            {
                "db": current_db,
                "run_id": run_id,
                "channel": channel,
                "sub": sub,
                "dependencies": dependencies,
            }
        )
        return {"deleted": False, "tv_missing_snapshot": None}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_pre_scan_cleanup_runtime_dependencies",
        fake_build_default_pre_scan_cleanup_runtime_dependencies,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "evaluate_pre_scan_cleanup_with_runtime_adapter",
        fake_evaluate_pre_scan_cleanup_with_runtime_adapter,
    )

    evaluate_pre_scan_cleanup = (
        run_channel_runtime_module.build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
            delete_subscription_with_records,
            create_step_log,
        )
    )

    result = await evaluate_pre_scan_cleanup(
        db,
        run_id="run-1",
        channel="all",
        sub=sub,
    )

    assert result == {"deleted": False, "tv_missing_snapshot": None}
    assert builder_calls == [
        {
            "delete_subscription_with_records": delete_subscription_with_records,
            "create_step_log": create_step_log,
        }
    ]
    assert adapter_calls == [
        {
            "db": db,
            "run_id": "run-1",
            "channel": "all",
            "sub": sub,
            "dependencies": runtime_dependencies,
        }
    ]
```

- [ ] **Step 5: Add service dead-wrapper boundary test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add:

```python
def test_subscription_service_drops_pre_scan_cleanup_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_evaluate_pre_scan_cleanup",
        "evaluate_pre_scan_cleanup_with_runtime_adapter",
        "build_default_pre_scan_cleanup_runtime_dependencies",
    ):
        assert name not in source
```

- [ ] **Step 6: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_pre_scan_cleanup_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_pre_scan_cleanup_injection tests/test_subscription_run_channel_runtime_adapter.py::test_default_pre_scan_cleanup_callback_builds_pre_scan_runtime_dependencies tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because the service still passes `evaluate_pre_scan_cleanup`, the builder still requires the callback, the default factory does not exist, and the service still contains the wrapper/imports.

### Task 2: Move Pre-scan Cleanup Default Into Run Channel Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/tests/test_pre_scan_cleanup.py`
- Modify: `backend/tests/test_subscription_source_run_integration.py`

- [ ] **Step 1: Import pre-scan cleanup runtime adapter defaults**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.pre_scan_cleanup_runtime_adapter import (
    build_default_pre_scan_cleanup_runtime_dependencies,
    evaluate_pre_scan_cleanup_with_runtime_adapter,
)
```

- [ ] **Step 2: Add default pre-scan cleanup callback factory**

Add this function near the other default runtime helper functions:

```python
def build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
    delete_subscription_with_records: DeleteSubscriptionWithRecords,
    create_step_log: CreateStepLog,
) -> EvaluatePreScanCleanup:
    async def evaluate_pre_scan_cleanup(
        db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
    ) -> dict[str, Any]:
        return await evaluate_pre_scan_cleanup_with_runtime_adapter(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_pre_scan_cleanup_runtime_dependencies(
                delete_subscription_with_records=delete_subscription_with_records,
                create_step_log=create_step_log,
            ),
        )

    return evaluate_pre_scan_cleanup
```

- [ ] **Step 3: Make pre-scan cleanup callback optional in run channel builder**

Change:

```python
    evaluate_pre_scan_cleanup: EvaluatePreScanCleanup,
```

to:

```python
    evaluate_pre_scan_cleanup: EvaluatePreScanCleanup | None = None,
```

Then change dataclass construction to:

```python
        evaluate_pre_scan_cleanup=(
            evaluate_pre_scan_cleanup
            if evaluate_pre_scan_cleanup is not None
            else build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
                delete_subscription_with_records,
                create_step_log,
            )
        ),
```

- [ ] **Step 4: Remove service wrapper and imports**

In `backend/app/services/subscription_service.py`, remove this import block:

```python
from app.services.subscriptions.pre_scan_cleanup_runtime_adapter import (
    build_default_pre_scan_cleanup_runtime_dependencies,
    evaluate_pre_scan_cleanup_with_runtime_adapter,
)
```

Remove this builder kwarg:

```python
                evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup,
```

Delete `_evaluate_pre_scan_cleanup()`.

- [ ] **Step 5: Remove obsolete service wrapper test**

In `backend/tests/test_pre_scan_cleanup.py`, delete
`test_subscription_service_wrapper_injects_dependencies_for_snapshots()`.

- [ ] **Step 6: Update source run integration monkeypatches**

In both tests in `backend/tests/test_subscription_source_run_integration.py`, replace:

```python
    monkeypatch.setattr(service, "_evaluate_pre_scan_cleanup", fake_cleanup)
```

with:

```python
    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        lambda *_args: fake_cleanup,
    )
```

- [ ] **Step 7: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_subscription_source_run_integration.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Commit: `backend/tests/test_pre_scan_cleanup.py`
- Commit: `backend/tests/test_subscription_source_run_integration.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_evaluate_pre_scan_cleanup|evaluate_pre_scan_cleanup_with_runtime_adapter|build_default_pre_scan_cleanup_runtime_dependencies" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1. `wc -l` decreases from 195.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_pre_scan_cleanup.py backend/tests/test_subscription_source_run_integration.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅 pre-scan cleanup wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_subscription_source_run_integration.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
scripts/verify-backend.sh
npm --prefix frontend run build
scripts/verify.sh --quick
docker compose up -d --build mediasync115
curl -fsS http://127.0.0.1:5173/healthz
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' mediasync115
git status --short
wc -l backend/app/services/subscription_service.py
```

Expected final status is the two allowed untracked files only, and Docker health output includes `running healthy`.
