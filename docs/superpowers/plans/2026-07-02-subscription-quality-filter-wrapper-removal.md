# Subscription Quality Filter Wrapper Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `SubscriptionService._resolve_subscription_quality_filter()` and route fixed-source/API quality filtering through `runtime_preferences_adapter` directly.

**Architecture:** `fixed_source_scan_runtime_adapter` will provide the default quality-filter dependency itself while preserving explicit injection. The subscription API will import `resolve_subscription_quality_filter_with_runtime_adapter` directly instead of calling a service private method.

**Tech Stack:** Python 3.13, pytest, FastAPI route module, existing subscriptions runtime adapter dependency-injection pattern.

---

### Task 1: Write Red Tests

**Files:**
- Modify: `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`
- Modify: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Modify: `backend/tests/test_subscription_source_api.py`

- [ ] **Step 1: Import runtime preferences helper in fixed source runtime tests**

Add this import to `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`:

```python
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
```

- [ ] **Step 2: Update default dependency test**

Change `test_default_runtime_dependencies_bind_existing_runtime_services()` so it calls the builder without `resolve_quality_filter`:

```python
    dependencies = build_default_fixed_source_scan_runtime_dependencies(
        create_step_log=create_step_log,
    )
```

Then add:

```python
    assert dependencies.resolve_quality_filter is (
        resolve_subscription_quality_filter_with_runtime_adapter
    )
```

- [ ] **Step 3: Add falsy quality-filter injection test**

Add this test after `test_default_runtime_dependencies_bind_existing_runtime_services()`:

```python
def test_default_runtime_dependencies_preserve_falsy_quality_filter_injection() -> None:
    class FalsyCallable:
        def __bool__(self) -> bool:
            return False

        def __call__(self, _sub: Any) -> dict[str, Any]:
            return {"quality": "explicit"}

    async def create_step_log(*_args: Any, **_kwargs: Any) -> None:
        return None

    resolve_quality_filter = FalsyCallable()

    dependencies = build_default_fixed_source_scan_runtime_dependencies(
        resolve_quality_filter=resolve_quality_filter,
        create_step_log=create_step_log,
    )

    assert dependencies.resolve_quality_filter is resolve_quality_filter
```

- [ ] **Step 4: Add service dead-wrapper boundary test**

In `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`, add:

```python
def test_subscription_service_drops_quality_filter_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_resolve_subscription_quality_filter",
        "resolve_subscription_quality_filter_with_runtime_adapter",
    ):
        assert name not in source
```

- [ ] **Step 5: Add API private-call boundary test**

In `backend/tests/test_subscription_source_api.py`, add imports:

```python
from pathlib import Path
```

Then add:

```python
ROOT = Path(__file__).resolve().parents[2]


def test_subscription_source_api_does_not_call_service_quality_filter_wrapper() -> None:
    source = (ROOT / "backend/app/api/subscriptions.py").read_text(
        encoding="utf-8"
    )

    assert "subscription_service._resolve_subscription_quality_filter" not in source
    assert "resolve_subscription_quality_filter_with_runtime_adapter" in source
```

- [ ] **Step 6: Run red tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_runtime_services tests/test_subscription_fixed_source_scan_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_quality_filter_injection tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_source_api.py::test_subscription_source_api_does_not_call_service_quality_filter_wrapper -q
```

Expected: FAIL because the fixed-source builder still requires `resolve_quality_filter`, the service still contains the wrapper/import, and the API still calls the service private method.

### Task 2: Move Quality Filter Defaults Out Of Service

**Files:**
- Modify: `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`
- Modify: `backend/app/services/subscription_service.py`
- Modify: `backend/app/api/subscriptions.py`

- [ ] **Step 1: Add fixed-source runtime default import**

In `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`, add:

```python
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
```

- [ ] **Step 2: Make fixed-source quality filter optional**

Change:

```python
def build_default_fixed_source_scan_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]],
    create_step_log: Callable[..., Awaitable[None]],
) -> FixedSourceScanRuntimeDependencies:
```

to:

```python
def build_default_fixed_source_scan_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]] | None = None,
    create_step_log: Callable[..., Awaitable[None]],
) -> FixedSourceScanRuntimeDependencies:
```

Change dataclass construction to:

```python
        resolve_quality_filter=(
            resolve_quality_filter
            if resolve_quality_filter is not None
            else resolve_subscription_quality_filter_with_runtime_adapter
        ),
```

- [ ] **Step 3: Remove service wrapper and kwarg**

In `backend/app/services/subscription_service.py`, remove this import:

```python
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
```

Remove this builder kwarg:

```python
                resolve_quality_filter=self._resolve_subscription_quality_filter,
```

Delete:

```python
    def _resolve_subscription_quality_filter(self, sub: "SubscriptionSnapshot") -> dict[str, Any]:
        return resolve_subscription_quality_filter_with_runtime_adapter(sub)
```

- [ ] **Step 4: Replace API private service call**

In `backend/app/api/subscriptions.py`, add:

```python
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
```

Change:

```python
            quality_filter=subscription_service._resolve_subscription_quality_filter(
                snapshot
            ),
```

to:

```python
            quality_filter=resolve_subscription_quality_filter_with_runtime_adapter(
                snapshot
            ),
```

- [ ] **Step 5: Run green targeted tests**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_source_api.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_run_channel_runtime_adapter.py -q
```

Expected: PASS with only the existing Starlette deprecation warning.

### Task 3: Commit And Verify

**Files:**
- Commit: `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`
- Commit: `backend/app/services/subscription_service.py`
- Commit: `backend/app/api/subscriptions.py`
- Commit: `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`
- Commit: `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
- Commit: `backend/tests/test_subscription_source_api.py`

- [ ] **Step 1: Check diff hygiene**

Run:

```bash
git diff --check
rg -n "_resolve_subscription_quality_filter|resolve_subscription_quality_filter_with_runtime_adapter" backend/app/services/subscription_service.py
rg -n "subscription_service\\._resolve_subscription_quality_filter" backend/app/api/subscriptions.py
wc -l backend/app/services/subscription_service.py
```

Expected: `git diff --check` exits 0. Both `rg` commands exit 1. `wc -l` decreases from 265.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py backend/app/services/subscription_service.py backend/app/api/subscriptions.py backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py backend/tests/test_subscription_service_dead_wrapper_cleanup.py backend/tests/test_subscription_source_api.py
git commit -m "refactor: 删除订阅质量过滤 wrapper"
```

- [ ] **Step 3: Run required gates**

Run:

```bash
scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_source_api.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_run_channel_runtime_adapter.py -q
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
