# Subscription Fixed Source Scan Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move fixed-source scan runtime default wiring into `run_channel_runtime_adapter` and delete `SubscriptionService._scan_fixed_sources_for_subscription()`.

**Architecture:** `build_default_run_channel_runtime_dependencies()` keeps explicit scan callback injection, but `scan_fixed_sources_for_subscription` becomes optional. When omitted, the builder uses a small factory to bind `create_step_log` into a callback that calls `scan_fixed_sources_with_runtime_adapter()` with `build_default_fixed_source_scan_runtime_dependencies()`.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Update service wrapper expectations**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, remove this mapping entry:

```python
        "scan_fixed_sources_for_subscription": (
            "_scan_fixed_sources_for_subscription"
        ),
```

Then add this assertion with the existing builder omission assertions:

```python
    assert "scan_fixed_sources_for_subscription" not in builder_kwargs
```

- [ ] **Step 2: Add default fixed source scan dependency test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add this test near the other default dependency tests:

```python
def test_default_runtime_dependencies_bind_fixed_source_scan_default_without_service_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def default_scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    factory_calls: list[Any] = []

    def fake_build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(callback_create_step_log)
        return default_scan_fixed_sources_for_subscription

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies",
        fake_build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies,
        raising=False,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.scan_fixed_sources_for_subscription
        is default_scan_fixed_sources_for_subscription
    )
    assert factory_calls == [create_step_log]
```

- [ ] **Step 3: Add falsy scan callback injection test**

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_fixed_source_scan_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {}

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    scan_fixed_sources_for_subscription = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.scan_fixed_sources_for_subscription
        is scan_fixed_sources_for_subscription
    )
```

- [ ] **Step 4: Add default callback forwarding test**

Add:

```python
@pytest.mark.asyncio
async def test_default_fixed_source_scan_callback_builds_fixed_source_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    sub = object()
    runtime_dependencies = object()
    adapter_kwargs: dict[str, Any] = {}
    builder_calls: list[Any] = []

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    def fake_build_default_fixed_source_scan_runtime_dependencies(
        *,
        create_step_log: Any,
    ) -> object:
        builder_calls.append(create_step_log)
        return runtime_dependencies

    async def fake_scan_fixed_sources_with_runtime_adapter(
        **kwargs: Any,
    ) -> dict[str, Any]:
        adapter_kwargs.update(kwargs)
        return {"saved_count": 2, "failed_count": 1}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_fixed_source_scan_runtime_dependencies",
        fake_build_default_fixed_source_scan_runtime_dependencies,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "scan_fixed_sources_with_runtime_adapter",
        fake_scan_fixed_sources_with_runtime_adapter,
    )

    scan_fixed_sources_for_subscription = (
        run_channel_runtime_module.build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
            create_step_log
        )
    )

    result = await scan_fixed_sources_for_subscription(
        db,
        run_id="run-1",
        channel="all",
        sub=sub,
        tv_missing_snapshot={"missing_count": 3},
        force_auto_download=True,
    )

    assert result == {"saved_count": 2, "failed_count": 1}
    assert builder_calls == [create_step_log]
    assert adapter_kwargs == {
        "db": db,
        "run_id": "run-1",
        "channel": "all",
        "sub": sub,
        "dependencies": runtime_dependencies,
        "tv_missing_snapshot": {"missing_count": 3},
        "force_auto_download": True,
    }
```

- [ ] **Step 5: Add service dead-wrapper boundary test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add:

```python
def test_subscription_service_drops_fixed_source_scan_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_scan_fixed_sources_for_subscription",
        "scan_fixed_sources_with_runtime_adapter",
        "build_default_fixed_source_scan_runtime_dependencies",
    ):
        assert name not in source
```

- [ ] **Step 6: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_fixed_source_scan_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_fixed_source_scan_injection tests/test_subscription_run_channel_runtime_adapter.py::test_default_fixed_source_scan_callback_builds_fixed_source_runtime_dependencies tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because the service still passes `scan_fixed_sources_for_subscription`, the builder still requires the scan callback, the default factory does not exist, and the service still contains the wrapper/imports.

### Task 2: Move Fixed Source Scan Default Into Run Channel Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import fixed source scan runtime adapter defaults**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
```

- [ ] **Step 2: Add default scan callback factory**

Add this function near the other default runtime helper functions:

```python
def build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
    create_step_log: CreateStepLog,
) -> ScanFixedSourcesForSubscription:
    async def scan_fixed_sources_for_subscription(
        db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
        tv_missing_snapshot: dict[str, Any] | None = None,
        force_auto_download: bool = False,
    ) -> dict[str, Any]:
        return await scan_fixed_sources_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_fixed_source_scan_runtime_dependencies(
                create_step_log=create_step_log,
            ),
            tv_missing_snapshot=tv_missing_snapshot,
            force_auto_download=force_auto_download,
        )

    return scan_fixed_sources_for_subscription
```

- [ ] **Step 3: Make scan callback optional in the default builder**

Change:

```python
    scan_fixed_sources_for_subscription: ScanFixedSourcesForSubscription,
```

to:

```python
    scan_fixed_sources_for_subscription: (
        ScanFixedSourcesForSubscription | None
    ) = None,
```

Then change dataclass construction to:

```python
        scan_fixed_sources_for_subscription=(
            scan_fixed_sources_for_subscription
            if scan_fixed_sources_for_subscription is not None
            else build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
                create_step_log
            )
        ),
```

- [ ] **Step 4: Remove service wrapper and imports**

In `backend/app/services/subscription_service.py`, remove this import block:

```python
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
```

Remove this builder kwarg:

```python
                scan_fixed_sources_for_subscription=(
                    self._scan_fixed_sources_for_subscription
                ),
```

Delete `_scan_fixed_sources_for_subscription()`.

- [ ] **Step 5: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
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
rg -n "_scan_fixed_sources_for_subscription|scan_fixed_sources_with_runtime_adapter|build_default_fixed_source_scan_runtime_dependencies" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1. `wc -l` decreases from 243.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅固定来源 scan wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
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
