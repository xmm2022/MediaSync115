# Subscription Execution Log Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move run-channel execution log default callbacks into `run_channel_runtime_adapter` and delete the three logging wrappers from `SubscriptionService`.

**Architecture:** `build_default_run_channel_runtime_dependencies()` will keep explicit log callback injection, but `create_execution_log`, `create_step_log`, and `prune_step_logs` become optional. When omitted, the builder uses `subscriptions.execution_logs` helpers and passes the resolved step-log callback into pre-scan cleanup and fixed-source scan default factories.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Import execution log module in adapter tests**

Add this import near the existing `run_channel_runtime_adapter` module import:

```python
from app.services.subscriptions import execution_logs as execution_logs_module
```

- [ ] **Step 2: Update service wrapper expectation**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, replace the bound-method mapping:

```python
    for key, name in {
        "create_execution_log": "_create_execution_log",
        "create_step_log": "_create_step_log",
        "prune_step_logs": "_prune_step_logs",
        "delete_subscription_with_records": "_delete_subscription_with_records",
    }.items():
        _assert_bound_method(builder_kwargs[key], service, name)
```

with:

```python
    _assert_bound_method(
        builder_kwargs["delete_subscription_with_records"],
        service,
        "_delete_subscription_with_records",
    )
```

Then add these omission assertions beside the existing builder omission assertions:

```python
    assert "create_execution_log" not in builder_kwargs
    assert "create_step_log" not in builder_kwargs
    assert "prune_step_logs" not in builder_kwargs
```

- [ ] **Step 3: Add default log callback binding test**

Add this test after `test_default_runtime_dependencies_bind_existing_services_and_runners()`:

```python
def test_default_runtime_dependencies_bind_execution_log_defaults_without_service_callbacks() -> None:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

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
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.create_execution_log is execution_logs_module.create_execution_log
    assert dependencies.create_step_log is execution_logs_module.create_step_log
    assert dependencies.prune_step_logs is execution_logs_module.prune_step_logs
```

- [ ] **Step 4: Add pre-scan factory binding test for default step log**

Add:

```python
def test_default_runtime_dependencies_pass_default_step_log_to_pre_scan_cleanup_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.evaluate_pre_scan_cleanup is default_evaluate_pre_scan_cleanup
    assert factory_calls == [
        (
            delete_subscription_with_records,
            execution_logs_module.create_step_log,
        )
    ]
```

- [ ] **Step 5: Add fixed-source factory binding test for default step log**

Add:

```python
def test_default_runtime_dependencies_pass_default_step_log_to_fixed_source_scan_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

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
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.scan_fixed_sources_for_subscription
        is default_scan_fixed_sources_for_subscription
    )
    assert factory_calls == [execution_logs_module.create_step_log]
```

- [ ] **Step 6: Add falsy log injection test**

Add:

```python
def test_default_runtime_dependencies_preserve_falsy_execution_log_injections() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    create_execution_log = FalsyAsyncCallable()
    create_step_log = FalsyAsyncCallable()
    prune_step_logs = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.create_execution_log is create_execution_log
    assert dependencies.create_step_log is create_step_log
    assert dependencies.prune_step_logs is prune_step_logs
```

- [ ] **Step 7: Add service dead-wrapper test**

Append to `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`:

```python
def test_subscription_service_drops_execution_log_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_create_execution_log",
        "_create_step_log",
        "_prune_step_logs",
        "create_subscription_execution_log",
        "create_subscription_step_log",
        "prune_subscription_step_logs",
    ):
        assert name not in source
```

- [ ] **Step 8: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_execution_log_defaults_without_service_callbacks tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_pass_default_step_log_to_pre_scan_cleanup_factory tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_pass_default_step_log_to_fixed_source_scan_factory tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_execution_log_injections tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: fail because `build_default_run_channel_runtime_dependencies()` still requires the three log callbacks and service still passes/defines wrappers.

### Task 2: Implement Default Log Dependencies

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import execution log helpers in runtime adapter**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.execution_logs import (
    create_execution_log as create_subscription_execution_log,
    create_step_log as create_subscription_step_log,
    prune_step_logs as prune_subscription_step_logs,
)
```

- [ ] **Step 2: Make log callbacks optional and resolve local defaults**

Change the first three parameters of `build_default_run_channel_runtime_dependencies()` to:

```python
    create_execution_log: CreateExecutionLog | None = None,
    create_step_log: CreateStepLog | None = None,
    prune_step_logs: PruneStepLogs | None = None,
```

At the start of the function body, before returning `RunChannelRuntimeDependencies`, add:

```python
    resolved_create_execution_log = (
        create_execution_log
        if create_execution_log is not None
        else create_subscription_execution_log
    )
    resolved_create_step_log = (
        create_step_log
        if create_step_log is not None
        else create_subscription_step_log
    )
    resolved_prune_step_logs = (
        prune_step_logs
        if prune_step_logs is not None
        else prune_subscription_step_logs
    )
```

Then use the resolved names in the dataclass construction:

```python
        create_execution_log=resolved_create_execution_log,
        create_step_log=resolved_create_step_log,
        prune_step_logs=resolved_prune_step_logs,
```

Also pass `resolved_create_step_log` into:

```python
                resolved_create_step_log,
```

for both `build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies()` and
`build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies()`.

- [ ] **Step 3: Remove service log callback injection and wrappers**

In `backend/app/services/subscription_service.py`, remove these imports:

```python
from datetime import datetime
from app.models.models import ExecutionStatus
from app.services.subscriptions.execution_logs import (
    create_execution_log as create_subscription_execution_log,
    create_step_log as create_subscription_step_log,
    prune_step_logs as prune_subscription_step_logs,
)
```

In `run_channel_check()`, remove these builder kwargs:

```python
                create_execution_log=self._create_execution_log,
                create_step_log=self._create_step_log,
                prune_step_logs=self._prune_step_logs,
```

Delete the three methods:

```python
    async def _create_step_log(...)
    async def _prune_step_logs(...)
    async def _create_execution_log(...)
```

- [ ] **Step 4: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_execution_logs.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_subscription_fixed_source_scan_runtime_adapter.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Check service line count and diff hygiene**

Run:

```bash
wc -l backend/app/services/subscription_service.py
git diff --check
```

Expected: line count decreases and `git diff --check` exits 0.

- [ ] **Step 6: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅执行日志 wrapper"
```

### Task 3: Full Verification

**Files:**
- No code edits.

- [ ] **Step 1: Run targeted tests after commit**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_execution_logs.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_subscription_fixed_source_scan_runtime_adapter.py -q
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

Expected: image builds and `mediasync115` starts.

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

- Spec coverage: every design requirement maps to Task 1 tests, Task 2 implementation, and Task 3 verification.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation language is present.
- Type consistency: callback names match the existing runtime adapter aliases and service method names.
