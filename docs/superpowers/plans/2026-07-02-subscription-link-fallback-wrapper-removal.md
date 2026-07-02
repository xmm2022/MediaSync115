# Subscription Link Fallback Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the run channel link fallback default callback into `run_channel_runtime_adapter` and delete `SubscriptionService._auto_save_records_with_link_fallback()`.

**Architecture:** `build_default_run_channel_runtime_dependencies()` keeps explicit callback injection, but `auto_save_records_with_link_fallback` becomes optional and defaults to a run-channel helper that calls `link_fallback_runtime_adapter` with default dependencies. `SubscriptionService.run_channel_check()` stops passing the service wrapper, so the service no longer imports link fallback runtime adapter helpers.

**Tech Stack:** Python 3.13, pytest, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Boundary And Default Tests

**Files:**
- Modify: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Update service wrapper expectations**

In `test_subscription_service_wrapper_passes_callbacks_and_concurrency()`, remove this entry from the bound-method map:

```python
        "auto_save_records_with_link_fallback": (
            "_auto_save_records_with_link_fallback"
        ),
```

Then add this absence assertion next to the other default-dependency absence assertions:

```python
    assert "auto_save_records_with_link_fallback" not in builder_kwargs
```

- [ ] **Step 2: Add default link fallback dependency test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add this test after `test_default_runtime_dependencies_bind_record_loader_defaults_without_service_callbacks()`:

```python
def test_default_runtime_dependencies_bind_link_fallback_default_without_service_callback() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

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
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.auto_save_records_with_link_fallback is (
        run_channel_runtime_module.auto_save_records_with_link_fallback_with_default_runtime_dependencies
    )
```

- [ ] **Step 3: Add falsy link fallback injection test**

In `backend/tests/test_subscription_run_channel_runtime_adapter.py`, add this test after the default link fallback test:

```python
def test_default_runtime_dependencies_preserve_falsy_link_fallback_injection() -> None:
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

    auto_save_records_with_link_fallback = FalsyAsyncCallable()

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

    assert (
        dependencies.auto_save_records_with_link_fallback
        is auto_save_records_with_link_fallback
    )
```

- [ ] **Step 4: Add default helper forwarding test**

Add this async test near the existing default helper tests:

```python
async def test_default_link_fallback_helper_builds_link_fallback_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    sub = object()
    records = [object()]
    runtime_dependencies = object()
    adapter_kwargs: dict[str, Any] = {}

    def fake_build_default_link_fallback_runtime_dependencies() -> object:
        return runtime_dependencies

    async def fake_auto_save_records_with_link_fallback_with_runtime_adapter(
        **kwargs: Any,
    ) -> dict[str, Any]:
        adapter_kwargs.update(kwargs)
        return {"saved": 1}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_link_fallback_runtime_dependencies",
        fake_build_default_link_fallback_runtime_dependencies,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "auto_save_records_with_link_fallback_with_runtime_adapter",
        fake_auto_save_records_with_link_fallback_with_runtime_adapter,
    )

    result = await (
        run_channel_runtime_module.auto_save_records_with_link_fallback_with_default_runtime_dependencies(
            db=db,
            run_id="run-1",
            channel="movie",
            sub=sub,
            records=records,
            transfer_source="retry",
            tv_missing_snapshot={"missing_count": 2},
            hdhive_unlock_context={"enabled": True},
            source_order=["hdhive", "tg"],
            enable_link_refetch=False,
        )
    )

    assert result == {"saved": 1}
    assert adapter_kwargs == {
        "db": db,
        "run_id": "run-1",
        "channel": "movie",
        "sub": sub,
        "records": records,
        "transfer_source": "retry",
        "dependencies": runtime_dependencies,
        "tv_missing_snapshot": {"missing_count": 2},
        "hdhive_unlock_context": {"enabled": True},
        "source_order": ["hdhive", "tg"],
        "enable_link_refetch": False,
    }
```

- [ ] **Step 5: Update service boundary tests**

Replace `test_subscription_service_uses_link_fallback_runtime_adapter()` in `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py` with:

```python
def test_subscription_service_drops_link_fallback_runtime_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "async def _auto_save_records_with_link_fallback",
        "auto_save_records_with_link_fallback_with_runtime_adapter",
        "build_default_link_fallback_runtime_dependencies",
    ):
        assert name not in source
```

Extend `test_subscription_service_drops_record_loader_wrappers()` in `backend/tests/test_subscription_service_dead_wrapper_cleanup.py` or add a new test:

```python
def test_subscription_service_drops_link_fallback_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_auto_save_records_with_link_fallback",
        "auto_save_records_with_link_fallback_with_runtime_adapter",
        "build_default_link_fallback_runtime_dependencies",
    ):
        assert name not in source
```

- [ ] **Step 6: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_link_fallback_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_link_fallback_injection tests/test_subscription_run_channel_runtime_adapter.py::test_default_link_fallback_helper_builds_link_fallback_runtime_dependencies tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py -q
```

Expected: FAIL because the service still passes the wrapper callback, the run-channel builder still requires `auto_save_records_with_link_fallback`, the default helper does not exist yet, and the service still contains the link fallback wrapper/imports.

### Task 2: Move Link Fallback Default Into Run Channel Runtime Adapter

**Files:**
- Modify: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Import link fallback runtime defaults**

In `backend/app/services/subscriptions/run_channel_runtime_adapter.py`, add:

```python
from app.services.subscriptions.link_fallback_runtime_adapter import (
    auto_save_records_with_link_fallback_with_runtime_adapter,
    build_default_link_fallback_runtime_dependencies,
)
```

- [ ] **Step 2: Add default helper**

Add this helper before `build_default_run_channel_runtime_dependencies()`:

```python
async def auto_save_records_with_link_fallback_with_default_runtime_dependencies(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    transfer_source: str,
    tv_missing_snapshot: dict[str, Any] | None = None,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    enable_link_refetch: bool = True,
) -> dict[str, Any]:
    return await auto_save_records_with_link_fallback_with_runtime_adapter(
        db=db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        records=records,
        transfer_source=transfer_source,
        dependencies=build_default_link_fallback_runtime_dependencies(),
        tv_missing_snapshot=tv_missing_snapshot,
        hdhive_unlock_context=hdhive_unlock_context,
        source_order=source_order,
        enable_link_refetch=enable_link_refetch,
    )
```

- [ ] **Step 3: Make builder callback optional**

Change:

```python
    auto_save_records_with_link_fallback: AutoSaveRecordsWithLinkFallback,
```

to:

```python
    auto_save_records_with_link_fallback: AutoSaveRecordsWithLinkFallback | None = None,
```

Then change dataclass construction to:

```python
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
            if auto_save_records_with_link_fallback is not None
            else auto_save_records_with_link_fallback_with_default_runtime_dependencies
        ),
```

- [ ] **Step 4: Remove service wrapper**

In `backend/app/services/subscription_service.py`, remove this import block:

```python
from app.services.subscriptions.link_fallback_runtime_adapter import (
    auto_save_records_with_link_fallback_with_runtime_adapter,
    build_default_link_fallback_runtime_dependencies,
)
```

Remove this builder kwarg:

```python
                auto_save_records_with_link_fallback=(
                    self._auto_save_records_with_link_fallback
                ),
```

Delete the entire `_auto_save_records_with_link_fallback()` method.

- [ ] **Step 5: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/tests/test_subscription_run_channel_runtime_adapter.py`
- Commit: `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_auto_save_records_with_link_fallback|auto_save_records_with_link_fallback_with_runtime_adapter|build_default_link_fallback_runtime_dependencies" backend/app/services/subscription_service.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 because the service no longer contains the wrapper/imports. `wc -l` decreases from 329.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/run_channel_runtime_adapter.py backend/app/services/subscription_service.py backend/tests/test_subscription_run_channel_runtime_adapter.py backend/tests/test_subscription_service_link_fallback_runtime_boundary.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py
git commit -m "refactor: 删除订阅 link fallback wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py -q
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
